using System.Collections.Concurrent;
using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;

namespace RadikalPlayers.Radikal;

public sealed class PlayerAuthService
{
    private static readonly TimeSpan SessionLifetime = TimeSpan.FromHours(8);

    private readonly RadikalClient _client;
    private readonly RadikalOptions _options;
    private readonly ILogger<PlayerAuthService> _logger;
    private readonly SharedProfileStore _sharedProfiles;
    private readonly ConcurrentDictionary<string, PlayerSession> _sessions = new(StringComparer.Ordinal);

    public PlayerAuthService(
        RadikalClient client,
        IOptions<RadikalOptions> options,
        ILogger<PlayerAuthService> logger,
        SharedProfileStore sharedProfiles)
    {
        _client = client;
        _options = options.Value;
        _logger = logger;
        _sharedProfiles = sharedProfiles;
    }

    public async Task<(string SessionId, PlayerProfileDto Profile)> LoginAsync(
        string dni,
        string password,
        CancellationToken ct)
    {
        dni = (dni ?? string.Empty).Trim();
        password ??= string.Empty;

        if (string.IsNullOrWhiteSpace(dni) || string.IsNullOrWhiteSpace(password))
            throw new PlayerAuthException("Introduce tu Radikal ID y tu contraseña.");

        var attempt = await TryLoginAsync(dni, password, ct);

        // Compatibilidad con cuentas legacy que conservan un espacio final en la clave.
        if (!attempt.Success && !password.EndsWith(' '))
            attempt = await TryLoginAsync(dni, password + " ", ct);

        if (!attempt.Success || attempt.Cookies is null || attempt.Profile is null)
            throw new PlayerAuthException(attempt.Message ?? "Radikal ID o contraseña incorrectos.");

        var session = NewSession(dni, attempt.Cookies, attempt.Profile, isDemo: false);
        _sessions[session.Id] = session;

        // Si el jugador comparte sus medias, se guardan para su ficha pública.
        _sharedProfiles.SaveOnLogin(session.Dni, attempt.Profile.Ppd, attempt.Profile.Mpr);

        // En segundo plano se completa el perfil público con competiciones e historial.
        _ = Task.Run(async () =>
        {
            try
            {
                var rating = await GetRatingAsync(
                    session.Id,
                    session.Dni,
                    null,
                    session.Profile.Alias,
                    CancellationToken.None);

                if (rating is not null)
                    _sharedProfiles.Update(session.Dni, rating);
            }
            catch
            {
                // Silencioso: el perfil privado sigue funcionando aunque falle el público.
            }
        });

        return (session.Id, attempt.Profile);
    }

    private sealed record LoginAttempt(
        bool Success,
        string? Message,
        CookieContainer? Cookies,
        PlayerProfileDto? Profile);

    private async Task<LoginAttempt> TryLoginAsync(string dni, string password, CancellationToken ct)
    {
        var cookies = new CookieContainer();
        using var http = CreateClient(cookies);

        using var content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["accion"] = "login",
            ["dni"] = dni,
            ["clave"] = password
        });

        using var response = await http.PostAsync("ajax.gateway.php", content, ct);
        var body = await response.Content.ReadAsStringAsync(ct);

        var result = ParseLoginResult(body);
        if (!string.Equals(result.Resultado, "OK", StringComparison.OrdinalIgnoreCase))
        {
            return new LoginAttempt(
                false,
                string.IsNullOrWhiteSpace(result.Motivo) ? "Radikal ID o contraseña incorrectos." : result.Motivo,
                null,
                null);
        }

        var sessionCookies = cookies.GetCookies(new Uri(_options.EspBaseUrl));
        if (sessionCookies.Count == 0)
            return new LoginAttempt(false, "Radikal ha aceptado el acceso pero no ha devuelto una sesión válida.", null, null);

        var html = await GetProfileHtmlAsync(http, ct);
        if (LooksLikeLoginPage(html))
            return new LoginAttempt(false, "No se pudo abrir tu área de jugador. Revisa tus credenciales.", null, null);

        var profile = BuildProfileFromHtml(html, dni);
        return new LoginAttempt(true, null, cookies, profile);
    }

    private static PlayerProfileDto BuildProfileFromHtml(string html, string dni)
    {
        var form = PlayerAreaParser.ParseForm(html, dni);
        var account = PlayerAreaParser.ParseAccount(html, dni, form);
        return new PlayerProfileDto(
            dni,
            account.Alias,
            account.FullName,
            account.PhotoUrl,
            null,
            account.CountryCode,
            account.CurrentMpr,
            account.CurrentPpd,
            null,
            Array.Empty<PlayerStatDto>(),
            Array.Empty<PlayerCompetitionDto>(),
            Array.Empty<PlayerInfoItemDto>(),
            DateTimeOffset.UtcNow,
            false);
    }

    public async Task<PlayerProfileDto?> GetSessionProfileAsync(
        string? sessionId,
        bool refresh = false,
        CancellationToken ct = default)
    {
        var session = GetSession(sessionId);
        if (session is null) return null;

        if (!refresh || session.IsDemo) return session.Profile;

        try
        {
            using var http = CreateClient(session.Cookies);
            var html = await GetProfileHtmlAsync(http, ct);
            if (!LooksLikeLoginPage(html))
            {
                session.Profile = BuildProfileFromHtml(html, session.Dni);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "No se pudo refrescar el perfil de {Dni}", session.Dni);
        }

        session.LastSeen = DateTimeOffset.UtcNow;
        return session.Profile;
    }

    /// <summary>
    /// Lee el rating actual (PPD/MPR) y el historial desde el área privada de Radikal.
    /// Fuente oficial: el bloque <c>.puntajes</c> y las tablas de <c>jugadores5.php</c> /
    /// <c>jugadores8_1.php</c>. Solo funciona con una sesión activa.
    /// </summary>
    public async Task<PlayerRatingDto?> GetRatingAsync(
        string? sessionId,
        string dni,
        string? userId,
        string? expectedAlias,
        CancellationToken ct = default)
    {
        var session = GetSession(sessionId);
        if (session is null) return null;

        var isSelf = string.Equals(session.Dni, dni, StringComparison.OrdinalIgnoreCase);

        // El rating y su historial solo son accesibles para la cuenta conectada. Radikal no
        // expone el rating privado de otros jugadores en ninguna página pública.
        if (!isSelf) return null;

        if (session.Rating is not null &&
            DateTimeOffset.UtcNow - session.RatingFetchedAt < TimeSpan.FromMinutes(5))
            return session.Rating;

        var ppd = session.Profile.Ppd;
        var mpr = session.Profile.Mpr;
        string? preferredDiana = null;
        int? radikalPoints = null;
        int? bonus = null;
        string? memberType = null;
        string? memberUntil = null;
        var history = new List<PlayerHistoryTableDto>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var found = false;

        using var http = CreateClient(session.Cookies);
        var candidates = new[] { "jugadores5.php", "jugadores8_1.php", "jugadores2.php" };
        foreach (var path in candidates)
        {
            try
            {
                var html = await GetPageAsync(http, path, ct);
                if (LooksLikeLoginPage(html)) continue;

                var parsed = PlayerAreaParser.ParseRating(html, dni, expectedAlias);
                if (parsed is null) continue;

                found = true;
                if (string.IsNullOrWhiteSpace(ppd)) ppd = parsed.Ppd;
                if (string.IsNullOrWhiteSpace(mpr)) mpr = parsed.Mpr;
                preferredDiana ??= parsed.PreferredDiana;
                radikalPoints ??= parsed.RadikalPoints;
                bonus ??= parsed.Bonus;
                memberType ??= parsed.MemberType;

                foreach (var table in parsed.History)
                {
                    var key = $"{table.Title}|{string.Join('|', table.Headers)}";
                    if (seen.Add(key)) history.Add(table);
                }

                if (history.Count > 0 && !string.IsNullOrWhiteSpace(ppd)) break;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch
            {
                // 401 o página sin datos: se prueba el siguiente candidato.
            }
        }

        if (!found && string.IsNullOrWhiteSpace(ppd) && string.IsNullOrWhiteSpace(mpr) && history.Count == 0)
            return null;

        var competitions = new List<PlayerAreaCompetitionDto>();
        try
        {
            // jugadores10.php = "Mi Diana" / competiciones del jugador.
            var competitionsHtml = await GetPageAsync(http, "jugadores10.php", ct);
            if (!LooksLikeLoginPage(competitionsHtml))
                competitions = PlayerAreaParser.ParseCompetitions(competitionsHtml).Take(20).ToList();
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch
        {
            // Sin competiciones públicas o página no disponible.
        }

        try
        {
            // subscriptions.php = suscripción/member hasta.
            var subscriptionHtml = await GetPageAsync(http, "subscriptions.php", ct);
            if (!LooksLikeLoginPage(subscriptionHtml))
            {
                var subscription = PlayerAreaParser.ParseSubscription(subscriptionHtml);
                memberType ??= subscription?.Name;
                memberUntil = subscription?.ValidUntil;
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch
        {
            // Sin suscripción o página no disponible.
        }

        var rating = new PlayerRatingDto(
            string.IsNullOrWhiteSpace(ppd) ? null : ppd,
            string.IsNullOrWhiteSpace(mpr) ? null : mpr,
            preferredDiana,
            radikalPoints,
            bonus,
            memberType,
            memberUntil,
            competitions,
            history,
            DateTimeOffset.UtcNow);

        if (isSelf)
        {
            session.Rating = rating;
            session.RatingFetchedAt = DateTimeOffset.UtcNow;
            _sharedProfiles.Update(session.Dni, rating);
        }

        return rating;
    }

    public bool GetShareRatings(string? sessionId)
    {
        var session = GetSession(sessionId);
        return session is not null && _sharedProfiles.GetShareRatings(session.Dni);
    }

    public async Task<bool> SetShareRatingsAsync(string? sessionId, bool share, CancellationToken ct)
    {
        var session = GetSession(sessionId);
        if (session is null) return false;

        _sharedProfiles.SetShareRatings(session.Dni, share);
        if (share)
        {
            // Guardar inmediatamente la media y competiciones actuales.
            session.Rating = null;
            session.RatingFetchedAt = DateTimeOffset.MinValue;
            var rating = await GetRatingAsync(session.Id, session.Dni, null, session.Profile.Alias, ct);
            if (rating is not null) _sharedProfiles.Update(session.Dni, rating);
        }

        return _sharedProfiles.GetShareRatings(session.Dni);
    }

    public async Task<PlayerAreaDto?> GetAreaAsync(string? sessionId, bool refresh, CancellationToken ct)
    {
        var session = GetSession(sessionId);
        if (session is null) return null;

        if (session.IsDemo)
            return session.Area ??= await BuildDemoAreaAsync(ct);

        if (!refresh && session.Area is not null &&
            DateTimeOffset.UtcNow - session.AreaFetchedAt < TimeSpan.FromMinutes(2))
            return session.Area;

        using var http = CreateClient(session.Cookies);
        var profileTask = GetPageAsync(http, "jugadores2.php", ct);
        var competitionsTask = GetPageAsync(http, "jugadores10.php", ct);
        var pointsTask = GetPageAsync(http, "jugadores4.php", ct);
        var subscriptionTask = GetPageAsync(http, "subscriptions.php", ct);
        var awardsTask = GetPageAsync(http, "jugadores7.php", ct);
        var statsTask = PostFormAsync(http, "ajax.newstats.php", new Dictionary<string, string>
        {
            ["action"] = "total_user",
            ["userid"] = session.Dni
        }, ct);

        await Task.WhenAll(profileTask, competitionsTask, pointsTask, subscriptionTask, awardsTask, statsTask);

        var area = PlayerAreaParser.ParseArea(
            await profileTask,
            await competitionsTask,
            await pointsTask,
            await subscriptionTask,
            await awardsTask,
            await statsTask,
            session.Dni,
            false);

        session.Area = area;
        session.AreaFetchedAt = DateTimeOffset.UtcNow;
        session.LastSeen = DateTimeOffset.UtcNow;
        return area;
    }

    public async Task<PlayerStatsDto> GetCompetitionStatsAsync(
        string? sessionId,
        int competitionId,
        CancellationToken ct)
    {
        var session = GetSession(sessionId);
        if (session is null) throw new PlayerAuthException("Sesión no válida.");
        if (session.IsDemo)
            return new PlayerStatsDto($"Competición #{competitionId}", DemoX01(), DemoCricket());

        using var http = CreateClient(session.Cookies);
        var json = await PostFormAsync(http, "ajax.newstats.php", new Dictionary<string, string>
        {
            ["action"] = "total_comp_unic_user",
            ["userid"] = session.Dni,
            ["compid"] = competitionId.ToString()
        }, ct);

        var allCompetitions = session.Area is null
            ? Enumerable.Empty<PlayerAreaCompetitionDto>()
            : session.Area.CurrentCompetitions.Concat(session.Area.FinishedCompetitions);
        var name = allCompetitions.FirstOrDefault(c => c.Id == competitionId)?.Name;
        return PlayerAreaParser.ParseStats(json, name);
    }

    public async Task<IReadOnlyList<string>> GetCitiesAsync(
        string? sessionId,
        string country,
        string province,
        CancellationToken ct)
    {
        var session = GetSession(sessionId);
        if (session is null) return Array.Empty<string>();

        using var http = CreateClient(session.Cookies);
        var json = await PostFormAsync(http, "ajax.jugadores2.php", new Dictionary<string, string>
        {
            ["accion"] = "ciudades",
            ["pais"] = country,
            ["prov"] = province
        }, ct);

        return PlayerAreaParser.ParseCities(json);
    }

    public async Task<PlayerActionResult> UpdateProfileAsync(
        string? sessionId,
        PlayerProfileUpdateRequest request,
        CancellationToken ct)
    {
        var session = GetSession(sessionId);
        if (session is null) return new PlayerActionResult(false, "La sesión ha caducado. Vuelve a iniciar sesión.");
        if (session.IsDemo) return new PlayerActionResult(false, "El modo demo no permite modificar datos reales.");

        var alias = string.IsNullOrWhiteSpace(request.Alias)
            ? (session.Area?.Form.Alias ?? session.Profile.Alias)
            : request.Alias.Trim();

        var form = new Dictionary<string, string>
        {
            ["procesar"] = "1",
            ["bot_enviar"] = "Modificar",
            ["Alias"] = alias,
            ["Nombre"] = request.Nombre ?? string.Empty,
            ["Apellidos"] = request.Apellidos ?? string.Empty,
            ["registro_sex"] = string.Equals(request.Sexo, "F", StringComparison.OrdinalIgnoreCase) ? "F" : "M",
            ["PayPalMe"] = request.PayPalMe ?? string.Empty,
            ["di_calle"] = request.Calle ?? string.Empty,
            ["di_numero"] = request.Numero ?? string.Empty,
            ["di_piso"] = request.Piso ?? string.Empty,
            ["di_puerta"] = request.Puerta ?? string.Empty,
            ["di_cp"] = request.CodigoPostal ?? string.Empty,
            ["di_provincia"] = request.Provincia ?? string.Empty,
            ["di_ciudad"] = request.Ciudad ?? string.Empty,
            ["TelMovil"] = request.Telefono ?? string.Empty,
            ["Email"] = request.Email ?? string.Empty
        };
        if (request.Newsletter) form["newsletter"] = "1";

        using var http = CreateClient(session.Cookies);
        var (status, html) = await PostFormAllowErrorAsync(http, "jugadores2.php", form, ct);
        var message = ExtractProfileMessage(html);
        var isError = status >= 400 ||
                      (!string.IsNullOrWhiteSpace(message) &&
                       (message.Contains("no se", StringComparison.OrdinalIgnoreCase) ||
                        message.Contains("error", StringComparison.OrdinalIgnoreCase) ||
                        message.Contains("debe", StringComparison.OrdinalIgnoreCase) ||
                        message.Contains("falta", StringComparison.OrdinalIgnoreCase) ||
                        message.Contains("incorrect", StringComparison.OrdinalIgnoreCase)));

        if (status >= 400 && string.IsNullOrWhiteSpace(message))
            message = "Radikal Players no ha aceptado los cambios. Revisa los datos e inténtalo de nuevo.";

        if (!isError)
        {
            if (!string.IsNullOrWhiteSpace(alias))
                session.Profile = session.Profile with { Alias = alias };
            session.Area = null;
            session.AreaFetchedAt = DateTimeOffset.MinValue;
        }

        return new PlayerActionResult(
            !isError,
            string.IsNullOrWhiteSpace(message)
                ? (isError ? "No se pudieron actualizar los datos." : "Datos actualizados correctamente.")
                : message);
    }

    public async Task<PlayerActionResult> UpdateAliasAsync(
        string? sessionId,
        string? alias,
        CancellationToken ct)
    {
        var session = GetSession(sessionId);
        if (session is null) return new PlayerActionResult(false, "La sesión ha caducado. Vuelve a iniciar sesión.");
        if (session.IsDemo) return new PlayerActionResult(false, "El modo demo no permite modificar datos reales.");

        var clean = (alias ?? string.Empty).Trim();
        if (clean.Length < 2 || clean.Length > 30)
            return new PlayerActionResult(false, "El alias debe tener entre 2 y 30 caracteres.");
        if (clean.Any(char.IsControl) || clean.Contains('<') || clean.Contains('>'))
            return new PlayerActionResult(false, "El alias contiene caracteres no permitidos.");

        var area = session.Area ?? await GetAreaAsync(sessionId, false, ct);
        if (area is null)
            return new PlayerActionResult(false, "No se pudo leer tu perfil de Radikal.");

        var form = area.Form;
        var request = new PlayerProfileUpdateRequest(
            Alias: clean,
            Nombre: form.Name,
            Apellidos: form.Surname,
            Sexo: form.Sex,
            PayPalMe: form.PayPal,
            Calle: form.Street,
            Numero: form.Number,
            Piso: form.Floor,
            Puerta: form.Door,
            CodigoPostal: form.PostalCode,
            Provincia: form.Province,
            Ciudad: form.City,
            Telefono: form.Phone,
            Email: form.Email,
            Newsletter: form.Newsletter);

        var result = await UpdateProfileAsync(sessionId, request, ct);
        if (result.Ok)
        {
            session.Profile = session.Profile with { Alias = clean };
            session.Area = null;
            session.AreaFetchedAt = DateTimeOffset.MinValue;
        }

        return result;
    }

    public async Task<PlayerActionResult> ChangePasswordAsync(
        string? sessionId,
        PlayerPasswordChangeRequest request,
        CancellationToken ct)
    {
        var session = GetSession(sessionId);
        if (session is null) return new PlayerActionResult(false, "La sesión ha caducado. Vuelve a iniciar sesión.");
        if (session.IsDemo) return new PlayerActionResult(false, "El modo demo no permite cambiar contraseñas.");

        var clave = request.Clave ?? string.Empty;
        var clave2 = request.Clave2 ?? string.Empty;
        if (clave.Length < 6)
            return new PlayerActionResult(false, "La nueva contraseña debe tener al menos 6 caracteres.");
        if (!string.Equals(clave, clave2, StringComparison.Ordinal))
            return new PlayerActionResult(false, "Las dos contraseñas no coinciden.");

        using var http = CreateClient(session.Cookies);
        var (status, json) = await PostFormAllowErrorAsync(http, "ajax.cambioclave.php", new Dictionary<string, string>
        {
            ["clave"] = clave,
            ["clave2"] = clave2
        }, ct);

        if (status >= 400)
            return new PlayerActionResult(false, "No se pudo cambiar la contraseña.");

        try
        {
            using var doc = JsonDocument.Parse(json);
            var result = doc.RootElement.TryGetProperty("RES", out var res) ? res.GetString() : null;
            return string.Equals(result, "OK", StringComparison.OrdinalIgnoreCase)
                ? new PlayerActionResult(true, "Contraseña actualizada correctamente.")
                : new PlayerActionResult(false, "No se pudo cambiar la contraseña.");
        }
        catch
        {
            return new PlayerActionResult(false, "No se pudo cambiar la contraseña.");
        }
    }

    public async Task<(byte[] Bytes, string ContentType)?> GetPhotoAsync(string? sessionId, CancellationToken ct)    {
        var session = GetSession(sessionId);
        if (session is null || session.IsDemo) return null;

        var userId = session.Area?.Account.UserId;
        if (string.IsNullOrWhiteSpace(userId))
        {
            using var profileHttp = CreateClient(session.Cookies);
            var html = await GetPageAsync(profileHttp, "jugadores2.php", ct);
            var match = System.Text.RegularExpressions.Regex.Match(html, @"userID=([^&""]+)", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            if (match.Success) userId = Uri.UnescapeDataString(match.Groups[1].Value);
        }

        if (string.IsNullOrWhiteSpace(userId)) return null;

        using var http = CreateClient(session.Cookies);
        using var response = await http.GetAsync($"api.foto.php?userID={Uri.EscapeDataString(userId)}", ct);
        if (!response.IsSuccessStatusCode) return null;

        var bytes = await response.Content.ReadAsByteArrayAsync(ct);
        return (bytes, response.Content.Headers.ContentType?.MediaType ?? "image/jpeg");
    }

    /// <summary>
    /// Sube una foto de perfil a Radikal (ajax.setphoto.php) usando la sesión del jugador.
    /// Se envía el archivo con varios nombres de campo porque Radikal no documenta el suyo.
    /// </summary>
    public async Task<PlayerActionResult> UpdatePhotoAsync(
        string? sessionId,
        byte[] bytes,
        string fileName,
        string contentType,
        CancellationToken ct)
    {
        var session = GetSession(sessionId);
        if (session is null) return new PlayerActionResult(false, "La sesión ha caducado. Vuelve a iniciar sesión.");
        if (session.IsDemo) return new PlayerActionResult(false, "El modo demo no permite cambiar la foto.");

        if (bytes.Length == 0)
            return new PlayerActionResult(false, "La imagen está vacía.");
        if (bytes.Length > 6 * 1024 * 1024)
            return new PlayerActionResult(false, "La imagen no puede superar los 6 MB.");
        if (!contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
            return new PlayerActionResult(false, "El archivo debe ser una imagen JPG, PNG o WebP.");

        using var http = CreateClient(session.Cookies);
        var userId = session.Area?.Account.UserId;
        if (string.IsNullOrWhiteSpace(userId))
        {
            try
            {
                var html = await GetPageAsync(http, "jugadores2.php", ct);
                var match = System.Text.RegularExpressions.Regex.Match(html, @"userID=([^&""]+)", RegexOptions.IgnoreCase);
                if (match.Success) userId = Uri.UnescapeDataString(match.Groups[1].Value);
            }
            catch
            {
                // Se intenta igualmente sin userID.
            }
        }

        // Radikal valida la cara antes de guardar la foto. Si falla, se intenta guardar igualmente.
        try
        {
            using var checkForm = new MultipartFormDataContent();
            var checkFile = new ByteArrayContent(bytes);
            checkFile.Headers.ContentType = new MediaTypeHeaderValue(contentType);
            checkForm.Add(checkFile, "foto", fileName);
            checkForm.Add(new StringContent(session.Dni), "userid");
            using var checkResponse = await http.PostAsync("ajax.checkface.php", checkForm, ct);
            // No se bloquea por el resultado: algunas cuentas no necesitan esta validación.
        }
        catch
        {
            // Se continúa con la subida.
        }

        using var form = new MultipartFormDataContent();
        var fieldNames = new[] { "foto", "photo", "file", "archivo" };
        foreach (var field in fieldNames)
        {
            var fileContent = new ByteArrayContent(bytes);
            fileContent.Headers.ContentType = new MediaTypeHeaderValue(contentType);
            form.Add(fileContent, field, fileName);
        }

        if (!string.IsNullOrWhiteSpace(userId))
            form.Add(new StringContent(userId), "userid");
        form.Add(new StringContent(session.Dni), "dni");

        using var response = await http.PostAsync("ajax.setphoto.php", form, ct);
        var body = await response.Content.ReadAsStringAsync(ct);
        var rejected = body.Contains("\"result\":false", StringComparison.OrdinalIgnoreCase) ||
                       body.Contains("error", StringComparison.OrdinalIgnoreCase);

        if (!response.IsSuccessStatusCode || rejected)
        {
            _logger.LogDebug("Radikal no aceptó la foto: {Status} {Body}", response.StatusCode, body);
            return new PlayerActionResult(
                false,
                "Radikal no ha aceptado la foto. Usa una imagen de frente, con una sola cara y buena luz.");
        }

        session.Area = null;
        session.AreaFetchedAt = DateTimeOffset.MinValue;
        session.Profile = session.Profile with
        {
            PhotoUrl = $"/api/player/photo?v={DateTimeOffset.UtcNow.ToUnixTimeSeconds()}"
        };

        return new PlayerActionResult(true, "Foto de perfil actualizada en Radikal.");
    }

    /// <summary>
    /// "Mis Items": personalizaciones compradas (fondo, dardos, feats, goodshots) con su estado.
    /// Requiere sesión real de Radikal; el modo demo devuelve una muestra ilustrativa.
    /// </summary>
    public async Task<PlayerItemsDto> GetItemsAsync(string? sessionId, CancellationToken ct)
    {
        var session = GetSession(sessionId);
        if (session is null)
            return new PlayerItemsDto(Array.Empty<PlayerItemDto>(), true, "Inicia sesión con tu Radikal ID para ver tus items.");

        if (session.IsDemo)
            return BuildDemoItems();

        try
        {
            using var http = CreateClient(session.Cookies);
            var (status, html) = await PostFormAllowErrorAsync(http, "items.php", new Dictionary<string, string>(), ct);
            if (status == 401 || status == 403)
                return new PlayerItemsDto(Array.Empty<PlayerItemDto>(), true, "Radikal pide volver a iniciar sesión para ver tus items.");

            return PlayerItemParser.Parse(html);
        }
        catch (Exception ex) when (ex is HttpRequestException or IOException)
        {
            _logger.LogDebug(ex, "No se pudieron leer los items del jugador");
            return new PlayerItemsDto(Array.Empty<PlayerItemDto>(), false, "No se pudo conectar con Radikal para leer tus items.");
        }
    }

    /// <summary>Activa o desactiva un item en Radikal (POST a ajax.item.php).</summary>
    public async Task<PlayerActionResult> ToggleItemAsync(string? sessionId, string itemKey, CancellationToken ct)
    {
        var session = GetSession(sessionId);
        if (session is null) return new PlayerActionResult(false, "La sesión ha caducado. Vuelve a iniciar sesión.");
        if (session.IsDemo) return new PlayerActionResult(false, "El modo demo no permite activar items reales.");

        var parts = (itemKey ?? string.Empty).Split(':');
        if (parts.Length != 3 ||
            !int.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var itemId) ||
            !int.TryParse(parts[2], NumberStyles.Integer, CultureInfo.InvariantCulture, out var itemIndex))
            return new PlayerActionResult(false, "Item no válido.");

        var itemType = parts[0].ToUpperInvariant();

        try
        {
            using var http = CreateClient(session.Cookies);

            // Necesitamos el Radikal ID y el estado actual: se leen de la propia página.
            var (_, html) = await PostFormAllowErrorAsync(http, "items.php", new Dictionary<string, string>(), ct);
            var items = PlayerItemParser.Parse(html);
            var item = items.Items.FirstOrDefault(i => i.Id == itemKey);
            if (item is null) return new PlayerActionResult(false, "Ese item ya no está en tu perfil.");

            var userId = Regex.Match(html, $@"(?i)userid=""([^""]+)""[^>]*itemtypeid=""{Regex.Escape(itemType)}""[^>]*itemid=""{itemId}""").Groups[1].Value;
            if (string.IsNullOrWhiteSpace(userId))
            {
                userId = Regex.Match(html, @"(?i)userid=""([^""]+)""").Groups[1].Value;
            }
            if (string.IsNullOrWhiteSpace(userId))
                return new PlayerActionResult(false, "No se pudo identificar tu Radikal ID en la página de items.");

            var valor = item.Active ? "1" : "0";

            var body = await PostFormAsync(http, "ajax.item.php", new Dictionary<string, string>
            {
                ["userid"] = userId,
                ["itemtypeid"] = itemType,
                ["itemid"] = itemId.ToString(CultureInfo.InvariantCulture),
                ["itemindex"] = itemIndex.ToString(CultureInfo.InvariantCulture),
                ["valor"] = valor
            }, ct);

            var ok = string.IsNullOrWhiteSpace(body) ||
                     !body.Contains("error", StringComparison.OrdinalIgnoreCase);

            return ok
                ? new PlayerActionResult(true, item.Active ? "Item desactivado." : "Item activado.")
                : new PlayerActionResult(false, "Radikal no ha aceptado el cambio.");
        }
        catch (Exception ex) when (ex is HttpRequestException or IOException)
        {
            _logger.LogDebug(ex, "No se pudo cambiar el item {ItemKey}", itemKey);
            return new PlayerActionResult(false, "No se pudo conectar con Radikal.");
        }
    }

    private static PlayerItemsDto BuildDemoItems()
    {
        var items = new List<PlayerItemDto>
        {
            new("BACKGROUND:19:10", "BACKGROUND", 19, 10, "TORMENTA", "Rayos, truenos y centellas.", "/api/shop/media/15/poster", "/api/shop/media/15/video", true, "Caduca en 2 meses", "/shop/product.php?product_id=5"),
            new("DART:35:4", "DART", 35, 4, "ELECTRIC SHARK", "Personaliza tu dardo RadikalDarts.", "/api/shop/media/81/poster", "/api/shop/media/81/video", true, null, "/shop/product.php?product_id=21"),
            new("FEAT:47:4", "FEAT", 47, 4, "FULL SPEED", "Fondo animado para la diana.", "/api/shop/media/179/poster", "/api/shop/media/179/video", false, null, "/shop/product.php?product_id=45")
        };

        return new PlayerItemsDto(items, false, null);
    }

    private async Task<PlayerAreaDto> BuildDemoAreaAsync(CancellationToken ct)    {
        var mprRankingTask = _client.GetRankingAsync("724", null, "MPR", "aa", "0", ct);
        var provincesTask = _client.GetProvincesAsync("724", ct);
        var competitionsTask = _client.GetCompetitionsAsync("724", null, null, null, "0", "upcoming", 0, 0, 0, null, false, 1, 6, ct);

        await Task.WhenAll(mprRankingTask, provincesTask, competitionsTask);

        var mprRanking = await mprRankingTask;
        var provinces = await provincesTask;
        var competitions = await competitionsTask;

        var player = mprRanking.Players.FirstOrDefault(p =>
                         !string.Equals(p.OfficialPlayerType, "NONE", StringComparison.OrdinalIgnoreCase))
                     ?? mprRanking.Players.First();

        var provinceOptions = provinces
            .Select(p => new PlayerFormOptionDto(p.Value, p.Label, p.Value == "Madrid"))
            .ToList();

        var form = new PlayerFormDto(
            Alias: player.Alias,
            Dni: "DEMO",
            DniNumber: "****1234*",
            BirthDate: "01/01/1990",
            Country: "España",
            Name: player.FirstName,
            Surname: player.LastName,
            Sex: "M",
            PayPal: "demo@radikalplayers.com",
            Street: "Calle Mayor",
            Number: "10",
            Floor: "2",
            Door: "A",
            PostalCode: "28013",
            Province: "Madrid",
            City: "Madrid",
            Phone: "600 000 000",
            Email: "demo@radikalplayers.com",
            Newsletter: true,
            Provinces: provinceOptions);

        var account = new PlayerAccountDto(
            Dni: "DEMO",
            Alias: player.Alias,
            FullName: $"{player.FirstName} {player.LastName}".Trim(),
            PhotoUrl: player.PhotoUrl,
            MemberType: "RADIKAL DARTS MEMBER",
            MemberUntil: "2028-07-24",
            CurrentPpd: "18.92",
            CurrentMpr: "2.17",
            RadikalPoints: 1840,
            Bonus: 0,
            CountryCode: "ES",
            UserId: player.UserId);

        var current = competitions.Items.Take(4).Select(c => new PlayerAreaCompetitionDto(c.Id, c.Name, c.Type, false)).ToList();
        var finished = new List<PlayerAreaCompetitionDto>
        {
            new(4084, "1 - BURMA-ROAD", "CAMP", true),
            new(924, "LA MARATÓN 2", "CAMP", true),
            new(5633, "UNITED LEAGUE G-58", "LIGA", true)
        };

        var points = new List<PlayerPointDto>
        {
            new(DateTimeOffset.UtcNow.AddDays(-2), 5, "Disponible", "Máquina 0003015562"),
            new(DateTimeOffset.UtcNow.AddDays(-6), 5, "Disponible", "Máquina 0003015562"),
            new(DateTimeOffset.UtcNow.AddDays(-30), 800, "Disponible", "RADIKAL GIFT"),
            new(DateTimeOffset.UtcNow.AddDays(-50), 10, "Disponible", "Máquina 0003015562")
        };

        return new PlayerAreaDto(
            account,
            form,
            new PlayerStatsDto(null, DemoX01(), DemoCricket()),
            current,
            finished,
            points,
            new PlayerSubscriptionDto("RADIKAL DARTS MEMBER", "2028-07-24"),
            new List<string> { "Radikal Shark 2026 · Clasificado", "Liga Nacional 2026 · Top 10" },
            DateTimeOffset.UtcNow,
            true);
    }

    private static PlayerStatsModeDto DemoX01() => new(
        "PPD", "18.92", 192, 113, 79, 58.85,
        new Dictionary<string, string>
        {
            ["hattricks"] = "3",
            ["lowtons"] = "47",
            ["5RO"] = "1",
            ["6RO"] = "1",
            ["7RO"] = "2",
            ["8RO"] = "2",
            ["12DO"] = "1",
            ["bull"] = "279",
            ["doublebull"] = "44"
        });

    private static PlayerStatsModeDto DemoCricket() => new(
        "MPR", "2.17", 192, 113, 79, 58.85,
        new Dictionary<string, string>
        {
            ["hattricks"] = "3",
            ["whitehorses"] = "0",
            ["5MR"] = "73",
            ["6MR"] = "27",
            ["7MR"] = "16",
            ["bull"] = "279",
            ["doublebull"] = "44"
        });

    private static async Task<string> GetPageAsync(HttpClient http, string path, CancellationToken ct)
    {
        using var response = await http.GetAsync(path, ct);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadAsStringAsync(ct);
    }

    private static async Task<string> PostFormAsync(
        HttpClient http,
        string path,
        Dictionary<string, string> form,
        CancellationToken ct)
    {
        using var content = new FormUrlEncodedContent(form);
        using var response = await http.PostAsync(path, content, ct);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadAsStringAsync(ct);
    }

    private static async Task<(int Status, string Body)> PostFormAllowErrorAsync(
        HttpClient http,
        string path,
        Dictionary<string, string> form,
        CancellationToken ct)
    {
        using var content = new FormUrlEncodedContent(form);
        using var response = await http.PostAsync(path, content, ct);
        return ((int)response.StatusCode, await response.Content.ReadAsStringAsync(ct));
    }

    private static string? ExtractProfileMessage(string html)
    {
        var match = System.Text.RegularExpressions.Regex.Match(html, @"var\s+mailMod\s*=\s*'([^']*)'");
        if (match.Success && !string.IsNullOrWhiteSpace(match.Groups[1].Value))
            return System.Net.WebUtility.HtmlDecode(match.Groups[1].Value).Trim();

        var doc = new AngleSharp.Html.Parser.HtmlParser().ParseDocument(html);
        var message = doc.QuerySelector("#mailModificado")?.TextContent?.Trim();
        return string.IsNullOrWhiteSpace(message) ? null : message;
    }

    public async Task<(string SessionId, PlayerProfileDto Profile)> CreateDemoAsync(CancellationToken ct)
    {
        var ranking = await _client.GetRankingAsync("724", null, "MPR", "aa", "0", ct);
        var player = ranking.Players.FirstOrDefault(p => !string.Equals(p.OfficialPlayerType, "NONE", StringComparison.OrdinalIgnoreCase))
                     ?? ranking.Players.First();

        var competitions = await _client.GetCompetitionsAsync(
            "724", null, null, null, "0", "upcoming", 0, 0, 0, null, false, 1, 4, ct);

        var profile = new PlayerProfileDto(
            Dni: "DEMO",
            Alias: player.Alias,
            Name: $"{player.FirstName} {player.LastName}".Trim(),
            PhotoUrl: player.PhotoUrl,
            Province: player.Location,
            Country: "España",
            Mpr: player.Value,
            Ppd: null,
            Rank: $"#{player.Rank} MPR",
            Stats: new List<PlayerStatDto>
            {
                new("MPR", player.Value),
                new("Ranking", $"#{player.Rank}"),
                new("Official", player.OfficialPlayerType),
                new("Member", player.Premium ? "Sí" : "No")
            },
            Competitions: competitions.Items.Select(c => new PlayerCompetitionDto(c.Id, c.Name, c.Type)).ToList(),
            Info: new List<PlayerInfoItemDto>
            {
                new("Radikal ID", "DEMO"),
                new("Cuenta", "Vista de demostración"),
                new("Fuente", "Datos públicos de Radikal Players")
            },
            FetchedAt: DateTimeOffset.UtcNow,
            IsDemo: true);

        var session = NewSession("DEMO", new CookieContainer(), profile, isDemo: true);
        _sessions[session.Id] = session;
        return (session.Id, profile);
    }

    public PlayerSession? GetSession(string? sessionId)
    {
        if (string.IsNullOrWhiteSpace(sessionId)) return null;
        if (!_sessions.TryGetValue(sessionId, out var session)) return null;
        if (DateTimeOffset.UtcNow - session.LastSeen > SessionLifetime)
        {
            _sessions.TryRemove(sessionId, out _);
            return null;
        }
        session.LastSeen = DateTimeOffset.UtcNow;
        return session;
    }

    public async Task LogoutAsync(string? sessionId, CancellationToken ct)
    {
        var session = GetSession(sessionId);
        if (session is null) return;

        if (!session.IsDemo)
        {
            try
            {
                using var http = CreateClient(session.Cookies);
                using var content = new FormUrlEncodedContent(new Dictionary<string, string>
                {
                    ["accion"] = "logout"
                });
                await http.PostAsync("ajax.gateway.php", content, ct);
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "No se pudo cerrar la sesión remota de Radikal");
            }
        }

        _sessions.TryRemove(session.Id, out _);
    }

    public string RegisterSession(PlayerSession session)
    {
        _sessions[session.Id] = session;
        return session.Id;
    }

    private PlayerSession NewSession(string dni, CookieContainer cookies, PlayerProfileDto profile, bool isDemo) =>
        new()
        {
            Id = Guid.NewGuid().ToString("N"),
            Dni = dni,
            Cookies = cookies,
            Profile = profile,
            IsDemo = isDemo,
            CreatedAt = DateTimeOffset.UtcNow,
            LastSeen = DateTimeOffset.UtcNow
        };

    private HttpClient CreateClient(CookieContainer cookies)
    {
        var handler = new SocketsHttpHandler
        {
            CookieContainer = cookies,
            UseCookies = true,
            AutomaticDecompression = DecompressionMethods.All,
            PooledConnectionLifetime = TimeSpan.FromMinutes(5)
        };

        var http = new HttpClient(handler)
        {
            BaseAddress = new Uri(_options.EspBaseUrl),
            Timeout = TimeSpan.FromSeconds(_options.TimeoutSeconds)
        };
        http.DefaultRequestHeaders.UserAgent.ParseAdd(_options.UserAgent);
        http.DefaultRequestHeaders.AcceptLanguage.ParseAdd("es-ES,es;q=0.9,en;q=0.8");
        http.DefaultRequestHeaders.Referrer = new Uri(_options.EspBaseUrl);
        http.DefaultRequestHeaders.TryAddWithoutValidation("X-Requested-With", "XMLHttpRequest");
        return http;
    }

    private static async Task<string> GetProfileHtmlAsync(HttpClient http, CancellationToken ct)
    {
        using var response = await http.GetAsync("jugadores2.php", ct);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadAsStringAsync(ct);
    }

    private static bool LooksLikeLoginPage(string html)
    {
        // Cuando hay sesión, el layout incluye el enlace de cierre de sesión.
        if (html.Contains("cerrar_sesion", StringComparison.OrdinalIgnoreCase)) return false;
        return html.Contains("bot_entrar", StringComparison.OrdinalIgnoreCase) ||
               html.Contains("identificacion_usuario", StringComparison.OrdinalIgnoreCase);
    }

    private static (string? Resultado, string? Motivo) ParseLoginResult(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            var result = root.TryGetProperty("resultado", out var r) ? r.GetString() : null;
            var motivo = root.TryGetProperty("motivo", out var m) ? m.GetString() : null;
            return (result, motivo);
        }
        catch
        {
            return (null, null);
        }
    }
}

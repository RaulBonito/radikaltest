using System.Globalization;
using RadikalPlayers.Radikal;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Processing;

namespace RadikalPlayers.Api;

public static class ApiEndpoints
{
    public static IEndpointRouteBuilder MapRadikalApi(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api");

        api.MapGet("/meta", () => Results.Ok(new
        {
            name = "Radikal Players Experience",
            version = "1.0.0",
            dataSource = "https://esp.radikalplayers.com",
            defaultCountry = "724",
            countries = RadikalMetadata.Countries.Select(c => new { code = c.Code, name = c.Name }),
            games = new[]
            {
                new { code = "MPR", name = "MPR", description = "Marks Per Round" },
                new { code = "PPD", name = "PPD", description = "Points Per Dart" }
            },
            dartboards = new[]
            {
                new { code = "aa", name = "Aro ancho" },
                new { code = "ae", name = "Aro estrecho" },
                new { code = "bb", name = "Bristle Board" }
            }
        }));

        api.MapGet("/home", async (RadikalClient client, CancellationToken ct) =>
            Results.Ok(await client.GetHomeAsync(ct)));

        api.MapGet("/rankings", async (
            string? country,
            string? province,
            string? game,
            string? diana,
            string? gender,
            RadikalClient client,
            CancellationToken ct) =>
            Results.Ok(await client.GetRankingAsync(
                country ?? "724",
                province,
                game ?? "MPR",
                diana ?? "aa",
                gender ?? "0",
                ct)));

        api.MapGet("/rankings/global", async (
            string? game,
            string? diana,
            string? gender,
            RadikalClient client,
            CancellationToken ct) =>
            Results.Ok(await client.GetGlobalRankingAsync(
                game ?? "MPR",
                diana ?? "aa",
                gender ?? "0",
                ct)));

        api.MapGet("/geo/provinces", async (string? country, RadikalClient client, CancellationToken ct) =>
            Results.Ok(await client.GetProvincesAsync(country ?? "724", ct)));

        api.MapGet("/geo/localities", async (
            string? country,
            string province,
            RadikalClient client,
            CancellationToken ct) =>
            Results.Ok(await client.GetLocalitiesAsync(country ?? "724", province, ct)));

        api.MapGet("/geo/locales", async (string locality, RadikalClient client, CancellationToken ct) =>
            Results.Ok(await client.GetLocalesAsync(locality, ct)));

        api.MapGet("/competitions", async (
            string? country,
            string? province,
            string? locality,
            string? localId,
            string? type,
            string? status,
            int? year,
            int? month,
            int? day,
            string? q,
            bool? includeFinished,
            int? page,
            int? pageSize,
            RadikalClient client,
            CancellationToken ct) =>
            Results.Ok(await client.GetCompetitionsAsync(
                country ?? "724",
                province,
                locality,
                localId,
                type ?? "0",
                status ?? "0",
                year ?? 0,
                month ?? 0,
                day ?? 0,
                q,
                includeFinished ?? false,
                page ?? 1,
                pageSize ?? 12,
                ct)));

        api.MapGet("/competitions/search", async (string q, RadikalClient client, CancellationToken ct) =>
            Results.Ok(await client.SearchTournamentsAsync(q, ct)));

        api.MapGet("/competitions/{id:int}", async (
            int id,
            string? type,
            RadikalClient client,
            CancellationToken ct) =>
            Results.Ok(await client.GetCompetitionDetailAsync(id, type ?? "TORX", ct)));

        api.MapGet("/live", async (RadikalClient client, CancellationToken ct) =>
            Results.Ok(await client.GetLiveAsync(ct)));

        api.MapGet("/live/matches", async (RadikalClient client, CancellationToken ct) =>
            Results.Ok(await client.GetLiveMatchesAsync(ct)));

        api.MapGet("/live/darts", async (
            int compid,
            long encid,
            int? ngame,
            RadikalClient client,
            LiveRecordingStore recordings,
            CancellationToken ct) =>
        {
            if (compid <= 0 || encid <= 0)
                return Results.BadRequest(new { title = "Parámetros de partida no válidos" });

            var game = ngame is > 0 ? ngame.Value : 1;
            var darts = await client.GetLiveDartsAsync(compid, encid, game, ct);

            // Mientras alguien mide la partida también la grabamos, así el histórico se rellena
            // aunque el servicio de fondo acabe de arrancar.
            if (darts.Darts.Count > 0 || darts.IsFinished)
            {
                await recordings.UpsertAsync(
                    new LiveMatchDto(compid, encid, game, string.Empty, string.Empty),
                    darts,
                    ct);
            }

            return Results.Ok(darts);
        });

        api.MapGet("/tournaments/search", async (string q, RadikalClient client, CancellationToken ct) =>
            Results.Ok(await client.SearchTournamentsAsync(q, ct)));

        api.MapGet("/tournaments/{id:int}", async (int id, RadikalClient client, CancellationToken ct) =>
            Results.Ok(await client.GetTournamentAsync(id, ct)));

        api.MapGet("/tournaments/{id:int}/matches/{cellId:int}", async (
            int id,
            int cellId,
            RadikalClient client,
            CancellationToken ct) =>
            Results.Ok(await client.GetActaAsync(id, cellId, ct)));

        api.MapGet("/dianas", async (RadikalClient client, CancellationToken ct) =>
            Results.Ok(await client.GetDianasAsync(ct)));

        api.MapGet("/dianas/{id:long}", async (long id, RadikalClient client, CancellationToken ct) =>
            Results.Ok(await client.GetDianaDetailAsync(id, ct)));

        api.MapGet("/places", async (RadikalClient client, CancellationToken ct) =>
            Results.Ok(await client.GetTopPlacesAsync(ct)));

        api.MapGet("/news", async (
            int? page,
            int? pageSize,
            RadikalClient client,
            CancellationToken ct) =>
            Results.Ok(await client.GetNewsAsync(page ?? 1, pageSize ?? 9, ct)));

        api.MapGet("/news/{id:int}", async (int id, RadikalClient client, CancellationToken ct) =>
            Results.Ok(await client.GetNewsDetailAsync(id, ct)));

        api.MapGet("/official-players", async (RadikalClient client, CancellationToken ct) =>
            Results.Ok(await client.GetOfficialPlayersAsync(ct)));

        api.MapGet("/official-players/{id:int}", async (int id, RadikalClient client, CancellationToken ct) =>
            Results.Ok(await client.GetOfficialPlayerAsync(id, ct)));

        api.MapGet("/search", async (
            string q,
            RadikalClient client,
            PlayerDirectoryService directory,
            PlayerAuthService auth,
            HttpContext context,
            CancellationToken ct) =>
        {
            var sessionId = context.Session.GetString("radikal.session");
            var self = await auth.GetSessionProfileAsync(sessionId, false, ct);

            var playersTask = directory.SearchAsync(q, self, 8, ct);
            var restTask = client.SearchAsync(q, ct);
            await Task.WhenAll(playersTask, restTask);

            // Los jugadores van primero: es lo que la gente busca en el 90% de los casos.
            return Results.Ok((await playersTask).Concat(await restTask));
        });

        api.MapGet("/players/search", async (
            string q,
            PlayerDirectoryService directory,
            PlayerAuthService auth,
            HttpContext context,
            CancellationToken ct) =>
        {
            var sessionId = context.Session.GetString("radikal.session");
            var self = await auth.GetSessionProfileAsync(sessionId, false, ct);
            return Results.Ok(await directory.SearchAsync(q, self, 20, ct));
        });

        api.MapGet("/players/lookup", async (
            string radikalId,
            PlayerDirectoryService directory,
            PlayerAuthService auth,
            SharedProfileStore sharedProfiles,
            HttpContext context,
            CancellationToken ct) =>
        {
            var card = await directory.LookupByRadikalIdAsync(radikalId, ct);
            if (card is null)
                return Results.NotFound(new { title = "Jugador no encontrado" });

            var sessionId = context.Session.GetString("radikal.session");
            var rating = await auth.GetRatingAsync(
                sessionId,
                card.RadikalId ?? radikalId,
                card.UserId,
                card.Alias,
                ct);

            return Results.Ok(ApplySharedProfile(card, rating, sharedProfiles));
        });

        api.MapGet("/players/{userId}", async (
            string userId,
            PlayerDirectoryService directory,
            PlayerAuthService auth,
            SharedProfileStore sharedProfiles,
            HttpContext context,
            CancellationToken ct) =>
        {
            var sessionId = context.Session.GetString("radikal.session");

            // Un Radikal ID (DNI) se resuelve directamente contra Radikal.
            var byRadikalId = await directory.LookupByRadikalIdAsync(userId, ct);
            if (byRadikalId is not null)
            {
                var rating = await auth.GetRatingAsync(
                    sessionId,
                    byRadikalId.RadikalId ?? userId,
                    byRadikalId.UserId,
                    byRadikalId.Alias,
                    ct);

                return Results.Ok(ApplySharedProfile(byRadikalId, rating, sharedProfiles));
            }

            var card = await directory.GetPlayerAsync(userId, ct);
            if (card is not null) return Results.Ok(card);

            // El propio perfil no siempre aparece en los rankings públicos: se resuelve con la sesión.
            var self = await auth.GetSessionProfileAsync(sessionId, false, ct);
            if (self is not null &&
                string.Equals(self.Dni, userId, StringComparison.OrdinalIgnoreCase))
            {
                var selfCard = directory.BuildSelfCard(self);
                var rating = await auth.GetRatingAsync(sessionId, self.Dni, null, self.Alias, ct);
                return Results.Ok(ApplySharedProfile(selfCard, rating, sharedProfiles));
            }

            return Results.NotFound(new { title = "Jugador no encontrado" });
        });

        api.MapGet("/photos/player", async (
            string userId,
            IHttpClientFactory factory,
            HttpContext context,
            CancellationToken ct) =>
        {
            var http = factory.CreateClient("radikal-esp");
            using var response = await http.GetAsync($"api.foto.php?userID={Uri.EscapeDataString(userId)}", ct);
            if (!response.IsSuccessStatusCode)
                return Results.NotFound();

            var bytes = await response.Content.ReadAsByteArrayAsync(ct);
            context.Response.Headers.CacheControl = "public,max-age=86400";
            return Results.File(bytes, response.Content.Headers.ContentType?.MediaType ?? "image/jpeg");
        });

        api.MapGet("/photos/official", async (
            string mediaId,
            int? w,
            OfficialMediaService media,
            HttpContext context,
            CancellationToken ct) =>
        {
            if (!long.TryParse(mediaId, NumberStyles.Integer, CultureInfo.InvariantCulture, out var id))
                return Results.BadRequest();

            context.Response.Headers.CacheControl = "public,max-age=604800";

            // Miniatura opcional: evita enviar 1,5 MB para una tarjeta de 230 px.
            if (w is > 0)
            {
                var thumb = await media.EnsureThumbAsync(id, Math.Clamp(w.Value, 80, 2000), ct);
                if (thumb is not null) return Results.File(thumb, "image/jpeg");
            }

            if (!await media.EnsureAsync(id, ct))
                return Results.NotFound();

            return Results.File(media.OriginalPath(id), "image/jpeg");
        });

        api.MapGet("/health", () => Results.Ok(new { status = "ok", at = DateTimeOffset.UtcNow }));

        return app;
    }

    /// <summary>
    /// Aplica el perfil público compartido: competiciones siempre, medias solo si el jugador
    /// ha activado "compartir medias". La sesión privada tiene prioridad sobre lo guardado.
    /// </summary>
    private static PlayerCardDto ApplySharedProfile(
        PlayerCardDto card,
        PlayerRatingDto? rating,
        SharedProfileStore sharedProfiles)
    {
        var shared = sharedProfiles.GetPublic(card.RadikalId ?? string.Empty);
        var sharedRatings = shared is not null &&
                            shared.ShareRatings &&
                            !string.IsNullOrWhiteSpace(shared.Ppd);

        var competitions = (rating?.Competitions.Count ?? 0) > 0
            ? rating!.Competitions
            : shared?.Competitions
                .Select(competition => new PlayerAreaCompetitionDto(
                    competition.Id,
                    competition.Name,
                    competition.Type,
                    competition.Finished))
                .ToList()
              ?? (IReadOnlyList<PlayerAreaCompetitionDto>)Array.Empty<PlayerAreaCompetitionDto>();

        return card with
        {
            RatingPpd = rating?.Ppd ?? (sharedRatings ? shared!.Ppd : null),
            RatingMpr = rating?.Mpr ?? (sharedRatings ? shared!.Mpr : null),
            RatingHistory = rating?.History,
            PreferredDiana = rating?.PreferredDiana ?? (sharedRatings ? shared!.PreferredDiana : null),
            Competitions = competitions,
            RadikalPoints = rating?.RadikalPoints,
            Bonus = rating?.Bonus,
            MemberType = rating?.MemberType,
            MemberUntil = rating?.MemberUntil,
            RatingsShared = sharedRatings
        };
    }
}

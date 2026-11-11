using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using AngleSharp.Dom;
using AngleSharp.Html.Parser;

namespace RadikalPlayers.Radikal;

public static partial class PlayerAreaParser
{
    private static readonly HtmlParser Parser = new();

    [GeneratedRegex(@"compid=(\d+)", RegexOptions.IgnoreCase)]
    private static partial Regex CompIdRegex();

    [GeneratedRegex(@"tipo=([A-Z]+)", RegexOptions.IgnoreCase)]
    private static partial Regex TipoRegex();

    [GeneratedRegex(@"userID=([^&]+)", RegexOptions.IgnoreCase)]
    private static partial Regex UserIdRegex();

    [GeneratedRegex(@"Radikal ID:\s*([A-Z0-9]+)", RegexOptions.IgnoreCase)]
    private static partial Regex RadikalIdRegex();

    [GeneratedRegex(@"DNI:\s*([0-9A-Z]+)", RegexOptions.IgnoreCase)]
    private static partial Regex DniRegex();

    [GeneratedRegex(@"Fecha de nacimiento[^:]*:\s*([0-9/]+)", RegexOptions.IgnoreCase)]
    private static partial Regex BirthDateRegex();

    [GeneratedRegex(@"País:\s*([^\s].*?)\s+Correo", RegexOptions.IgnoreCase)]
    private static partial Regex CountryRegex();

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespaceRegex();

    /// <summary>
    /// Extrae el rating actual (PPD/MPR) y las tablas de historial de una página autenticada
    /// del área de jugador: <c>jugadores2.php</c>, <c>jugadores5.php</c> o <c>jugadores8_1.php</c>.
    /// </summary>
    public static PlayerRatingDto? ParseRating(string html, string expectedDni, string? expectedAlias)
    {
        var doc = Parser.ParseDocument(html);

        // Las páginas privadas llevan el bloque .puntajes y el enlace de cierre de sesión.
        if (doc.QuerySelector(".puntajes") is null && doc.QuerySelector("#cerrar_sesion") is null)
            return null;

        var container = doc.QuerySelector("ul.contenedor_usuario");
        var alias = Clean(container?.QuerySelector(".user")?.TextContent);
        if (!string.IsNullOrWhiteSpace(alias))
        {
            var match = Regex.Match(alias, @"\(([A-Z]{2})\)");
            if (match.Success) alias = Clean(alias.Replace(match.Value, string.Empty));
        }

        var expected = Clean(expectedAlias);
        if (!string.IsNullOrWhiteSpace(expected) &&
            !string.Equals(alias, expected, StringComparison.OrdinalIgnoreCase))
            return null;

        var pageDni = Clean(doc.QuerySelector("#dni")?.GetAttribute("value"));
        if (!string.IsNullOrWhiteSpace(pageDni) &&
            !string.IsNullOrWhiteSpace(expectedDni) &&
            !string.Equals(pageDni, expectedDni, StringComparison.OrdinalIgnoreCase))
            return null;

        var ppdElement = doc.QuerySelector(".puntajes .ppd li:last-child");
        var mprElement = doc.QuerySelector(".puntajes .mpr li:last-child");
        var ppd = Clean(ppdElement?.TextContent);
        var mpr = Clean(mprElement?.TextContent);
        var preferredDiana = ParsePreferredDiana(ppdElement, ppd) ?? ParsePreferredDiana(mprElement, mpr);

        var form = ParseForm(html, expectedDni);
        var account = ParseAccount(html, expectedDni, form);

        var history = new List<PlayerHistoryTableDto>();
        var scope = doc.QuerySelector("#jugadores") ?? doc.QuerySelector("#content") ?? doc.Body;
        if (scope is not null)
        {
            var tables = scope.QuerySelectorAll("table")
                .Select(ParseHistoryTable)
                .Where(table => table is not null)
                .Select(table => table!)
                .Select(table => (Table: table, Score: RatingTableScore(table)))
                .Where(item => item.Score > 0)
                .OrderByDescending(item => item.Score)
                .Select(item => item.Table)
                .ToList();

            history.AddRange(tables);
        }

        if (string.IsNullOrWhiteSpace(ppd) && string.IsNullOrWhiteSpace(mpr) && history.Count == 0)
            return null;

        return new PlayerRatingDto(
            string.IsNullOrWhiteSpace(ppd) ? null : ppd,
            string.IsNullOrWhiteSpace(mpr) ? null : mpr,
            preferredDiana,
            account.RadikalPoints,
            account.Bonus,
            account.MemberType,
            null,
            Array.Empty<PlayerAreaCompetitionDto>(),
            history,
            DateTimeOffset.UtcNow);
    }

    private static string? ParsePreferredDiana(IElement? element, string? value)
    {
        var title = Clean(element?.GetAttribute("title"));
        var match = Regex.Match(title, @"^([a-z]{2})=", RegexOptions.IgnoreCase);
        if (match.Success) return match.Groups[1].Value.ToLowerInvariant();

        var suffix = Regex.Match(value ?? string.Empty, @"\(([a-z]{2})\)", RegexOptions.IgnoreCase);
        return suffix.Success ? suffix.Groups[1].Value.ToLowerInvariant() : null;
    }

    private static PlayerHistoryTableDto? ParseHistoryTable(IElement table)
    {
        var headers = new List<string>();
        var headerRow = table.QuerySelector("thead tr");
        if (headerRow is not null)
        {
            foreach (var cell in headerRow.QuerySelectorAll("th, td"))
                headers.Add(Clean(cell.TextContent));
        }

        var rows = new List<IReadOnlyList<string>>();
        var bodyRows = table.QuerySelectorAll("tbody tr");
        if (bodyRows.Length == 0)
            bodyRows = table.QuerySelectorAll("tr");

        foreach (var row in bodyRows)
        {
            if (row.ParentElement is not null &&
                string.Equals(row.ParentElement.TagName, "THEAD", StringComparison.OrdinalIgnoreCase))
                continue;

            var cells = row.QuerySelectorAll("td, th")
                .Select(cell => Clean(cell.TextContent))
                .ToList();
            if (cells.Count == 0) continue;

            if (headers.Count == 0 && row.QuerySelector("th") is not null)
            {
                headers.AddRange(cells);
                continue;
            }

            rows.Add(cells);
            if (rows.Count >= 120) break;
        }

        if (rows.Count == 0) return null;

        // Las tablas de menú o de una sola columna no son historial.
        var width = Math.Max(headers.Count, rows[0].Count);
        if (width < 2) return null;

        var title = Clean(table.QuerySelector("caption")?.TextContent);
        if (string.IsNullOrWhiteSpace(title))
            title = Clean(table.ParentElement?.QuerySelector("#titulo h2")?.TextContent);

        if (string.IsNullOrWhiteSpace(title))
        {
            var previous = table.PreviousElementSibling;
            while (previous is not null &&
                   previous.TagName is not ("H2" or "H3" or "H4"))
                previous = previous.PreviousElementSibling;
            title = Clean(previous?.TextContent);
        }

        return new PlayerHistoryTableDto(
            string.IsNullOrWhiteSpace(title) ? null : title,
            headers,
            rows);
    }

    private static int RatingTableScore(PlayerHistoryTableDto table)
    {
        var headers = string.Join(' ', table.Headers).ToLowerInvariant();
        var title = (table.Title ?? string.Empty).ToLowerInvariant();

        var score = 0;
        if (headers.Contains("ppd") || headers.Contains("mpr")) score += 6;
        if (headers.Contains("rating")) score += 5;
        if (title.Contains("rating") || title.Contains("historial") ||
            title.Contains("evoluci") || title.Contains("estadíst") || title.Contains("estadistic"))
            score += 4;
        if (headers.Contains("fecha")) score += 3;
        if (headers.Contains("media") || headers.Contains("promedio") ||
            headers.Contains("puntuaci") || headers.Contains("valor"))
            score += 2;

        // Tablas de items/menús: no son historial.
        if (headers.Contains("muestra") || headers.Contains("acciones")) score -= 8;
        if (headers.Contains("descripci") && headers.Contains("tipo")) score -= 4;
        if (table.Rows.Count < 2) score -= 2;

        return score;
    }

    public static PlayerAreaDto ParseArea(
        string profileHtml,
        string competitionsHtml,
        string pointsHtml,
        string subscriptionHtml,
        string awardsHtml,
        string statsJson,
        string dni,
        bool isDemo)
    {
        var form = ParseForm(profileHtml, dni);
        var account = ParseAccount(profileHtml, dni, form);
        var subscription = ParseSubscription(subscriptionHtml);
        if (subscription?.ValidUntil is not null)
            account = account with { MemberUntil = subscription.ValidUntil, MemberType = account.MemberType ?? subscription.Name };

        var competitions = ParseCompetitions(competitionsHtml);
        var points = ParsePoints(pointsHtml);
        var awards = ParseAwards(awardsHtml);
        var stats = ParseStats(statsJson, null);

        return new PlayerAreaDto(
            account,
            form,
            stats,
            competitions.Where(c => !c.Finished).ToList(),
            competitions.Where(c => c.Finished).ToList(),
            points,
            subscription,
            awards,
            DateTimeOffset.UtcNow,
            isDemo);
    }

    public static PlayerAccountDto ParseAccount(string html, string dni, PlayerFormDto form)
    {
        var doc = Parser.ParseDocument(html);
        var container = doc.QuerySelector("ul.contenedor_usuario");

        var alias = Clean(container?.QuerySelector(".user")?.TextContent);
        var countryCode = "ES";
        if (!string.IsNullOrWhiteSpace(alias))
        {
            var match = Regex.Match(alias, @"\(([A-Z]{2})\)");
            if (match.Success)
            {
                countryCode = match.Groups[1].Value;
                alias = Clean(alias.Replace(match.Value, string.Empty));
            }
        }

        if (string.IsNullOrWhiteSpace(alias)) alias = form.Alias;
        if (string.IsNullOrWhiteSpace(alias)) alias = dni;

        var photoSrc = doc.QuerySelector("#photo")?.GetAttribute("src") ?? string.Empty;
        var userIdMatch = UserIdRegex().Match(photoSrc);
        var userId = userIdMatch.Success ? Uri.UnescapeDataString(userIdMatch.Groups[1].Value) : null;

        var memberType = Clean(doc.QuerySelector("#premiumhead")?.TextContent);
        if (string.IsNullOrWhiteSpace(memberType))
            memberType = Clean(doc.QuerySelector("#photo-label")?.GetAttribute("title"));
        if (string.IsNullOrWhiteSpace(memberType))
            memberType = Clean(doc.QuerySelector("#photo-label")?.GetAttribute("src"));

        var ppd = Clean(doc.QuerySelector(".puntajes .ppd li:last-child")?.TextContent);
        var mpr = Clean(doc.QuerySelector(".puntajes .mpr li:last-child")?.TextContent);

        var points = 0;
        var bonus = 0;
        foreach (var item in doc.QuerySelectorAll(".puntajes .bonus li"))
        {
            var label = Clean(item.QuerySelector(".align-left")?.TextContent);
            var value = Clean(item.QuerySelector(".align-right")?.TextContent);
            if (label.Contains("Radikal Points", StringComparison.OrdinalIgnoreCase))
                points = ParseInt(value);
            else if (label.Contains("Bonus", StringComparison.OrdinalIgnoreCase))
                bonus = ParseInt(value);
        }

        var photoUrl = string.IsNullOrWhiteSpace(userId)
            ? null
            : $"/api/player/photo?v={DateTimeOffset.UtcNow.ToUnixTimeSeconds()}";

        return new PlayerAccountDto(
            dni,
            alias,
            string.Join(' ', new[] { form.Name, form.Surname }.Where(v => !string.IsNullOrWhiteSpace(v))),
            photoUrl,
            string.IsNullOrWhiteSpace(memberType) ? null : memberType,
            null,
            string.IsNullOrWhiteSpace(ppd) ? null : ppd,
            string.IsNullOrWhiteSpace(mpr) ? null : mpr,
            points,
            bonus,
            countryCode,
            userId);
    }

    public static PlayerFormDto ParseForm(string html, string dni)
    {
        var doc = Parser.ParseDocument(html);
        var bodyText = Clean(doc.Body?.TextContent);

        string Value(string name) => Clean(doc.QuerySelector($"#{name}")?.GetAttribute("value"));
        string SelectedRadio(string name) =>
            doc.QuerySelectorAll($"input[name='{name}']").FirstOrDefault(i => i.HasAttribute("checked"))?.GetAttribute("value") ?? "M";

        var provinceSelect = doc.QuerySelector("select[name='di_provincia']");
        var provinces = provinceSelect?.QuerySelectorAll("option")
            .Select(option => new PlayerFormOptionDto(
                option.GetAttribute("value") ?? string.Empty,
                Clean(option.TextContent),
                option.HasAttribute("selected")))
            .Where(option => option.Value.Length > 0)
            .ToList() ?? new List<PlayerFormOptionDto>();

        var citySelect = doc.QuerySelector("select[name='di_ciudad']");
        var city = Clean(citySelect?.QuerySelector("option[selected]")?.GetAttribute("value"));

        var identity = doc.QuerySelector("#ficha_indentificacion");
        string? DatoValue(string prefix)
        {
            var span = identity?.QuerySelectorAll("span.dato")
                .FirstOrDefault(s => Clean(s.TextContent).StartsWith(prefix, StringComparison.OrdinalIgnoreCase));
            if (span is null) return null;

            var bold = Clean(span.QuerySelector("b")?.TextContent);
            if (!string.IsNullOrWhiteSpace(bold)) return bold;

            var text = Clean(span.TextContent);
            var separator = text.IndexOf(':');
            return separator >= 0 ? Clean(text[(separator + 1)..]) : text;
        }

        var birthDate = DatoValue("Fecha de nacimiento")
                        ?? BirthDateRegex().Match(bodyText).Groups[1].Value;
        var country = DatoValue("País")
                      ?? DatoValue("Pais")
                      ?? "España";
        var dniNumber = DatoValue("DNI")
                        ?? DniRegex().Match(bodyText).Groups[1].Value;
        var alias = Value("Alias");
        if (string.IsNullOrWhiteSpace(alias))
        {
            var idMatch = RadikalIdRegex().Match(bodyText);
            alias = idMatch.Success ? idMatch.Groups[1].Value : dni;
        }

        var maskedDni = string.IsNullOrWhiteSpace(dniNumber)
            ? null
            : dniNumber.Length > 6
                ? $"{dniNumber[..4]}{new string('*', dniNumber.Length - 5)}{dniNumber[^1]}"
                : dniNumber;

        return new PlayerFormDto(
            Alias: alias,
            Dni: dni,
            DniNumber: maskedDni,
            BirthDate: string.IsNullOrWhiteSpace(birthDate) ? null : birthDate,
            Country: string.IsNullOrWhiteSpace(country) ? "España" : country,
            Name: Value("Nombre"),
            Surname: Value("Apellidos"),
            Sex: SelectedRadio("registro_sex"),
            PayPal: Value("PayPalMe"),
            Street: Value("di_calle"),
            Number: Value("di_numero"),
            Floor: Value("di_piso"),
            Door: Value("di_puerta"),
            PostalCode: Value("di_cp"),
            Province: Clean(provinceSelect?.QuerySelector("option[selected]")?.GetAttribute("value")),
            City: city,
            Phone: Value("TelMovil"),
            Email: Value("Email"),
            Newsletter: doc.QuerySelector("#newsletter")?.HasAttribute("checked") ?? false,
            Provinces: provinces);
    }

    public static IReadOnlyList<PlayerAreaCompetitionDto> ParseCompetitions(string html)
    {
        var doc = Parser.ParseDocument(html);
        var root = doc.QuerySelector("#mycompetitions");
        if (root is null) return Array.Empty<PlayerAreaCompetitionDto>();

        var result = new List<PlayerAreaCompetitionDto>();
        var seen = new HashSet<int>();
        var finished = false;

        foreach (var child in root.Children)
        {
            if (child.ClassList.Contains("header"))
            {
                var title = Clean(child.TextContent).ToLowerInvariant();
                finished = title.Contains("finalizada");
                continue;
            }

            if (!child.ClassList.Contains("lista_competiciones")) continue;

            foreach (var card in child.QuerySelectorAll(".comp_activa"))
            {
                var href = card.QuerySelector("a[href*='compid=']")?.GetAttribute("href") ?? string.Empty;
                var idMatch = CompIdRegex().Match(href);
                if (!idMatch.Success) continue;
                var id = int.Parse(idMatch.Groups[1].Value, CultureInfo.InvariantCulture);
                if (!seen.Add(id)) continue;

                var name = CleanCompetitionName(Clean(card.QuerySelector("h4")?.TextContent));
                if (string.IsNullOrWhiteSpace(name)) continue;
                var typeIcon = card.QuerySelector("img[src*='ico-']");
                var type = RadikalParsers.MapCompetitionType(typeIcon?.GetAttribute("alt"), TipoRegex().Match(href).Groups[1].Value);

                result.Add(new PlayerAreaCompetitionDto(id, name, type, finished));
            }
        }

        return result;
    }

    public static IReadOnlyList<PlayerPointDto> ParsePoints(string html)
    {
        var doc = Parser.ParseDocument(html);
        var table = doc.QuerySelectorAll("table").FirstOrDefault(t =>
            Clean(t.TextContent).Contains("Cantidad", StringComparison.OrdinalIgnoreCase) &&
            Clean(t.TextContent).Contains("Concepto", StringComparison.OrdinalIgnoreCase));
        if (table is null) return Array.Empty<PlayerPointDto>();

        var points = new List<PlayerPointDto>();
        foreach (var row in table.QuerySelectorAll("tbody tr"))
        {
            var cells = row.QuerySelectorAll("td").Select(td => Clean(td.TextContent)).ToArray();
            if (cells.Length < 5) continue;
            if (!int.TryParse(cells[2], NumberStyles.Integer, CultureInfo.InvariantCulture, out var amount)) continue;

            DateTimeOffset? date = null;
            if (DateTime.TryParse(cells[0], CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed))
                date = new DateTimeOffset(parsed, TimeSpan.Zero);

            points.Add(new PlayerPointDto(date, amount, cells[3], cells[4]));
        }

        return points;
    }

    public static PlayerSubscriptionDto? ParseSubscription(string html)
    {
        var doc = Parser.ParseDocument(html);
        var table = doc.QuerySelectorAll("table").FirstOrDefault(t =>
            Clean(t.TextContent).Contains("Suscripción", StringComparison.OrdinalIgnoreCase));
        if (table is null) return null;

        foreach (var row in table.QuerySelectorAll("tr"))
        {
            var cells = row.QuerySelectorAll("td").Select(td => Clean(td.TextContent)).ToArray();
            if (cells.Length < 2) continue;
            if (cells[0].Contains("Suscripción", StringComparison.OrdinalIgnoreCase)) continue;
            if (string.IsNullOrWhiteSpace(cells[0])) continue;
            return new PlayerSubscriptionDto(cells[0], cells.Length > 1 && cells[1].Length > 0 ? cells[1] : null);
        }

        return null;
    }

    public static IReadOnlyList<string> ParseAwards(string html)
    {
        var doc = Parser.ParseDocument(html);
        var text = Clean(doc.Body?.TextContent);
        if (text.Contains("No tienes Premios", StringComparison.OrdinalIgnoreCase) ||
            text.Contains("No tienes histórico", StringComparison.OrdinalIgnoreCase))
            return Array.Empty<string>();

        var awards = new List<string>();
        foreach (var table in doc.QuerySelectorAll("table"))
        {
            foreach (var row in table.QuerySelectorAll("tr"))
            {
                var cells = row.QuerySelectorAll("td").Select(td => Clean(td.TextContent)).Where(c => c.Length > 0).ToArray();
                if (cells.Length >= 2) awards.Add(string.Join(" · ", cells));
            }
        }

        return awards.Distinct(StringComparer.OrdinalIgnoreCase).Take(20).ToList();
    }

    public static PlayerStatsDto ParseStats(string json, string? competitionName)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            PlayerStatsModeDto? x01 = null;
            if (root.TryGetProperty("PPD", out var ppd) && ppd.ValueKind == JsonValueKind.Array && ppd.GetArrayLength() > 0)
                x01 = ParseStatsMode(ppd[0], "PPD", new[]
                {
                    "hattricks", "superhattricks", "threeinabeds", "ton80s", "hitons", "lowtons", "maxton",
                    "4RO", "5RO", "6RO", "7RO", "8RO", "9RO", "10RO", "11RO", "12RO", "AST", "bull", "doublebull"
                });

            PlayerStatsModeDto? cricket = null;
            if (root.TryGetProperty("MPR", out var mpr) && mpr.ValueKind == JsonValueKind.Array && mpr.GetArrayLength() > 0)
                cricket = ParseStatsMode(mpr[0], "MPR", new[]
                {
                    "hattricks", "superhattricks", "threeinabeds", "ton80s", "whitehorses",
                    "5MR", "6MR", "7MR", "8MR", "9MR", "bull", "doublebull"
                });

            return new PlayerStatsDto(competitionName, x01, cricket);
        }
        catch
        {
            return new PlayerStatsDto(competitionName, null, null);
        }
    }

    public static IReadOnlyList<string> ParseCities(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array)
                return data.EnumerateArray()
                    .Select(item => Clean(item.GetString()))
                    .Where(item => item.Length > 0)
                    .ToList();
        }
        catch
        {
            // ignore
        }
        return Array.Empty<string>();
    }

    private static PlayerStatsModeDto ParseStatsMode(JsonElement element, string avgKey, IEnumerable<string> metricKeys)
    {
        var metrics = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var key in metricKeys)
        {
            if (element.TryGetProperty(key, out var value))
                metrics[key] = value.ValueKind == JsonValueKind.String ? value.GetString() ?? "" : value.ToString();
        }

        return new PlayerStatsModeDto(
            avgKey,
            GetString(element, $"Avg{avgKey}") ?? "—",
            ParseInt(GetString(element, "games")),
            ParseInt(GetString(element, "Wins")),
            ParseInt(GetString(element, "losts")),
            ParseDouble(GetString(element, "%Win")),
            metrics);
    }

    private static string? GetString(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value)
            ? value.ValueKind == JsonValueKind.String ? value.GetString() : value.ToString()
            : null;

    private static int ParseInt(string? value) =>
        int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) ? parsed : 0;

    private static double ParseDouble(string? value) =>
        double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed) ? parsed : 0;

    private static string Clean(string? value) =>
        string.IsNullOrWhiteSpace(value) ? string.Empty : WhitespaceRegex().Replace(value, " ").Trim();

    private static string CleanCompetitionName(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return value;

        var normalized = value.Replace("\uFFFD", string.Empty).Trim();
        if (normalized.Contains("0.50", StringComparison.OrdinalIgnoreCase) ||
            normalized.Contains("0,50", StringComparison.OrdinalIgnoreCase))
        {
            normalized = Regex.Replace(normalized, @"0[.,]50.*$", "0,50 €", RegexOptions.IgnoreCase).Trim();
        }
        return normalized;
    }
}

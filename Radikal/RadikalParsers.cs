using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using AngleSharp.Dom;
using AngleSharp.Html.Parser;

namespace RadikalPlayers.Radikal;

public static partial class RadikalParsers
{
    private static readonly HtmlParser Parser = new();

    [GeneratedRegex(@"compid=(\d+)", RegexOptions.IgnoreCase)]
    private static partial Regex CompIdRegex();

    [GeneratedRegex(@"tipo=([A-Z0-9]+)", RegexOptions.IgnoreCase)]
    private static partial Regex TipoRegex();

    [GeneratedRegex(@"/noticias/(\d+)/", RegexOptions.IgnoreCase)]
    private static partial Regex NewsIdRegex();

    [GeneratedRegex(@"machines\.push\(\{location:\{lat:\s*(-?[0-9.]+),\s*lng:\s*(-?[0-9.]+)\},\s*label:""([^""]*)"",\s*id:(\d+),\s*board_type:""([^""]*)""", RegexOptions.IgnoreCase)]
    private static partial Regex MachineRegex();

    [GeneratedRegex(@"officialplayermedia_id=(\d+)", RegexOptions.IgnoreCase)]
    private static partial Regex OfficialMediaRegex();

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespaceRegex();

    [GeneratedRegex(@"add_product_to_cart\(\s*(?<qty>[+-]?\d+)\s*,\s*(?<pt>\d+)\s*,\s*(?<ps>\d+)\s*,\s*['""](?<pd>[^'""]*)['""]\s*,\s*(?<p>\d+)\s*,\s*(?<c>\d+)\s*,\s*(?<v>\d+)\s*,\s*(?<pg>\d+)\s*,\s*(?<api>\d+)", RegexOptions.IgnoreCase)]
    private static partial Regex AddProductArgsRegex();

    [GeneratedRegex(@"delete_product_from_cart\(\s*(\d+)", RegexOptions.IgnoreCase)]
    private static partial Regex CartLineRegex();

    [GeneratedRegex(@"Identificador de Carrito \((\d+)\)", RegexOptions.IgnoreCase)]
    private static partial Regex CartIdRegex();

    public static string Clean(string? value) =>
        string.IsNullOrWhiteSpace(value) ? string.Empty : WhitespaceRegex().Replace(value, " ").Trim();

    public static string? DecodeBase64(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        try
        {
            return Encoding.UTF8.GetString(Convert.FromBase64String(value));
        }
        catch
        {
            return value;
        }
    }

    public static IReadOnlyList<ShopProductDto> ParseShopProducts(string html)
    {
        var doc = Parser.ParseDocument(html);
        var products = new List<ShopProductDto>();
        var baseUri = new Uri("https://esp.radikalplayers.com/shop/");

        foreach (var item in doc.QuerySelectorAll("li[id^='product_']"))
        {
            var idMatch = Regex.Match(item.Id ?? string.Empty, @"product_(\d+)_");
            if (!idMatch.Success || !int.TryParse(idMatch.Groups[1].Value, out var id)) continue;

            var title = Clean(item.QuerySelector("[itemprop='name']")?.TextContent);
            if (string.IsNullOrWhiteSpace(title)) continue;

            var description = Clean(item.QuerySelector("[itemprop='description']")?.TextContent);
            var url = item.QuerySelector("link[itemprop='url']")?.GetAttribute("href");
            var media = ParseShopMedia(item, baseUri);
            var image = media.FirstOrDefault(itemMedia => itemMedia.Type == "video")?.PreviewUrl
                        ?? media.FirstOrDefault()?.PreviewUrl
                        ?? item.QuerySelector("img[itemprop='image']")?.GetAttribute("src");
            var pointsText = Clean(item.QuerySelector(".product_points [itemprop='price']")?.TextContent);
            var priceText = Clean(item.QuerySelector(".product_price [itemprop='price']")?.TextContent);
            var category = Clean(item.QuerySelector("meta[itemprop='category']")?.GetAttribute("content"));
            var priceGroup = ParsePriceGroup(item.QuerySelector(".product_pricegroup")?.GetAttribute("onclick"));

            int? points = int.TryParse(pointsText, NumberStyles.Integer, CultureInfo.InvariantCulture, out var pointsValue)
                ? pointsValue
                : null;
            decimal? price = decimal.TryParse(priceText.Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out var priceValue)
                ? priceValue
                : null;

            products.Add(new ShopProductDto(
                id,
                title,
                string.IsNullOrWhiteSpace(description) ? null : description,
                ResolveImageUrl(image, baseUri),
                points,
                price,
                string.IsNullOrWhiteSpace(category) ? null : category,
                url is null ? new Uri(baseUri, $"product.php?product_id={id}").ToString() : new Uri(baseUri, url).ToString(),
                priceGroup,
                media));
        }

        return products;
    }

    /// <summary>
    /// Medios oficiales del producto (vídeos MP4 e imágenes) en el orden del carrusel de Radikal.
    /// Los vídeos se sirven por nuestro proxy para poder hacer streaming con Range.
    /// </summary>
    public static IReadOnlyList<ShopMediaDto> ParseShopMedia(AngleSharp.Dom.IElement scope, Uri baseUri)
    {
        var media = new List<ShopMediaDto>();

        foreach (var slide in scope.QuerySelectorAll(".flexslider .slides li, .product_media li"))
        {
            var video = slide.QuerySelector("video");
            if (video is not null)
            {
                var source = video.QuerySelector("source")?.GetAttribute("src");
                var poster = video.GetAttribute("poster")
                             ?? video.QuerySelector("meta[itemprop='image']")?.GetAttribute("content");
                var mediaId = ExtractMediaId(source ?? poster);
                if (mediaId is null) continue;

                media.Add(new ShopMediaDto(
                    "video",
                    $"/api/shop/media/{mediaId}/video",
                    $"/api/shop/media/{mediaId}/poster"));
                continue;
            }

            var image = slide.QuerySelector("img");
            var imageSource = image?.GetAttribute("src") ?? image?.GetAttribute("data-src");
            if (string.IsNullOrWhiteSpace(imageSource)) continue;

            media.Add(new ShopMediaDto("image", new Uri(baseUri, imageSource).ToString(), null));
        }

        if (media.Count == 0)
        {
            var poster = scope.QuerySelector("video")?.GetAttribute("poster");
            var mediaId = ExtractMediaId(poster);
            if (mediaId is not null)
            {
                media.Add(new ShopMediaDto(
                    "video",
                    $"/api/shop/media/{mediaId}/video",
                    $"/api/shop/media/{mediaId}/poster"));
            }
        }

        return media;
    }

    private static string? ExtractMediaId(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var match = Regex.Match(value, @"productmedia_id=(\d+)", RegexOptions.IgnoreCase);
        return match.Success ? match.Groups[1].Value : null;
    }

    /// <summary>
    /// Las rutas locales (/api/...) son de nuestra app y deben quedarse absolutas; cualquier
    /// otro valor relativo de Radikal se resuelve contra su base.
    /// </summary>
    private static string? ResolveImageUrl(string? image, Uri baseUri)
    {
        if (string.IsNullOrWhiteSpace(image)) return null;
        if (image.StartsWith("/api/", StringComparison.Ordinal)) return image;
        return new Uri(baseUri, image).ToString();
    }

    /// <summary>
    /// Ficha oficial de un producto: título, descripción larga, precio, grupos de precio y galería
    /// completa (vídeos e imágenes) tal y como los publica Radikal.
    /// </summary>
    public static ShopProductDto ParseShopProductDetail(string html, int id, string? category = null)
    {
        var doc = Parser.ParseDocument(html);
        var baseUri = new Uri("https://esp.radikalplayers.com/shop/");

        var container = doc.QuerySelector(".product_container") ?? doc.Body;
        var title = Clean(container?.QuerySelector("[itemprop='name']")?.TextContent);
        if (string.IsNullOrWhiteSpace(title))
            title = Clean(doc.QuerySelector("meta[itemprop='name']")?.GetAttribute("content"))
                    ?? Clean(doc.QuerySelector("title")?.TextContent)?.Split(" - ")[0];

        var description = Clean(container?.QuerySelector("[itemprop='description']")?.TextContent);
        if (string.IsNullOrWhiteSpace(description))
            description = Clean(doc.QuerySelector("meta[itemprop='description']")?.GetAttribute("content"))
                          ?? Clean(doc.QuerySelector("meta[name='description']")?.GetAttribute("content"));

        var media = container is null
            ? Array.Empty<ShopMediaDto>()
            : ParseShopMedia(container, baseUri);

        var pointsText = Clean(doc.QuerySelector(".product_points [itemprop='price']")?.TextContent);
        var priceText = Clean(doc.QuerySelector(".product_price [itemprop='price']")?.TextContent);
        var priceGroup = ParsePriceGroup(doc.QuerySelector(".product_pricegroup")?.GetAttribute("onclick"));

        var ogImage = doc.QuerySelector("meta[property='og:image']")?.GetAttribute("content")
                      ?? doc.QuerySelector("meta[name='og:image']")?.GetAttribute("content");

        var image = media.FirstOrDefault(item => item.Type == "video")?.PreviewUrl
                    ?? media.FirstOrDefault()?.PreviewUrl
                    ?? ogImage;

        int? points = int.TryParse(pointsText, NumberStyles.Integer, CultureInfo.InvariantCulture, out var pointsValue)
            ? pointsValue
            : null;
        decimal? price = decimal.TryParse(priceText.Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out var priceValue)
            ? priceValue
            : null;

        return new ShopProductDto(
            id,
            string.IsNullOrWhiteSpace(title) ? $"Producto #{id}" : title,
            string.IsNullOrWhiteSpace(description) ? null : description,
            image,
            points,
            price,
            category,
            new Uri(baseUri, $"product.php?product_id={id}").ToString(),
            priceGroup,
            media);
    }

    public static ShopPriceGroupDto? ParsePriceGroup(string? onclick)
    {
        if (string.IsNullOrWhiteSpace(onclick)) return null;
        var match = AddProductArgsRegex().Match(onclick);
        if (!match.Success) return null;

        return new ShopPriceGroupDto(
            ParseInt(match.Groups["pt"].Value),
            ParseInt(match.Groups["ps"].Value),
            match.Groups["pd"].Value,
            ParseInt(match.Groups["p"].Value),
            ParseInt(match.Groups["c"].Value),
            ParseInt(match.Groups["v"].Value),
            ParseInt(match.Groups["pg"].Value),
            ParseInt(match.Groups["api"].Value) == 1);
    }

    public static ShopCartDto ParseShopCart(string html)
    {
        var doc = Parser.ParseDocument(html);
        var bodyText = Clean(doc.Body?.TextContent);
        long? cartId = null;
        var cartIdMatch = CartIdRegex().Match(bodyText);
        if (cartIdMatch.Success && long.TryParse(cartIdMatch.Groups[1].Value, out var parsedCartId))
            cartId = parsedCartId;

        var baseUri = new Uri("https://esp.radikalplayers.com/shop/");
        var lines = new List<ShopCartLineDto>();

        foreach (var input in doc.QuerySelectorAll("input.attr_QTY"))
        {
            var row = input.Closest("tr");
            if (row is null) continue;

            var deleteLink = row.QuerySelector("a.deleteProduct")
                             ?? row.QuerySelector("a[onclick*='delete_product_from_cart']");
            var lineMatch = CartLineRegex().Match(deleteLink?.GetAttribute("onclick") ?? string.Empty);
            if (!lineMatch.Success || !long.TryParse(lineMatch.Groups[1].Value, out var lineId))
                continue;

            var productIdText = input.GetAttribute("product_id");
            if (!int.TryParse(productIdText, NumberStyles.Integer, CultureInfo.InvariantCulture, out var productId))
                continue;

            var title = Clean(row.QuerySelector(".cart_product_title")?.TextContent);
            if (string.IsNullOrWhiteSpace(title))
                title = Clean(input.GetAttribute("product_desc"));

            var description = Clean(row.QuerySelector(".cart_product_short_description")?.TextContent);
            var productHref = row.QuerySelector("a[href*='product.php?product_id=']")?.GetAttribute("href");
            var image = row.QuerySelector("img.img_cart")?.GetAttribute("src")
                        ?? row.QuerySelector("video")?.GetAttribute("poster")
                        ?? row.QuerySelector("img[itemprop='image']")?.GetAttribute("src");

            var quantityText = input.GetAttribute("value");
            var quantity = int.TryParse(quantityText, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedQuantity)
                ? Math.Max(1, parsedQuantity)
                : 1;

            var moneyCells = row.QuerySelectorAll("td.moneyCol");
            var lineTotal = moneyCells.Length > 0
                ? ParseCartMoney(moneyCells[moneyCells.Length - 1])
                : new ShopCartMoneyDto(0, 0);
            var unitPrice = quantity > 0
                ? new ShopCartMoneyDto(lineTotal.Points / quantity, lineTotal.Euros / quantity)
                : lineTotal;

            var priceGroup = ParsePriceGroup(
                row.QuerySelector("a[id^='buttonQuantityAdd_']")?.GetAttribute("onclick")
                ?? row.QuerySelector("a[id^='buttonQuantityDel_']")?.GetAttribute("onclick"));

            lines.Add(new ShopCartLineDto(
                lineId,
                productId,
                title,
                string.IsNullOrWhiteSpace(description) ? null : description,
                image is null ? null : new Uri(baseUri, image).ToString(),
                productHref is null ? new Uri(baseUri, $"product.php?product_id={productId}").ToString() : new Uri(baseUri, productHref).ToString(),
                quantity,
                unitPrice,
                lineTotal,
                priceGroup));
        }

        var subtotal = ParseCartMoney(doc.QuerySelector(".trSubtotal th:last-child")
                                      ?? doc.QuerySelector(".trSubtotal td:last-child"));
        var total = ParseCartMoney(doc.QuerySelector(".trTotal td:last-child")
                                   ?? doc.QuerySelector(".trTotal th:last-child"));

        if (lines.Count > 0 && subtotal.IsEmpty)
            subtotal = new ShopCartMoneyDto(lines.Sum(line => line.Total.Points), lines.Sum(line => line.Total.Euros));
        if (lines.Count > 0 && total.IsEmpty)
            total = subtotal;

        return new ShopCartDto(cartId, lines, subtotal, total, DateTimeOffset.UtcNow);
    }

    private static ShopCartMoneyDto ParseCartMoney(IElement? cell)
    {
        if (cell is null) return new ShopCartMoneyDto(0, 0);

        var text = Clean(cell.TextContent);
        var hasPoints = cell.QuerySelector("img.RadikalPt") is not null
                        || text.Contains("Radikal Points", StringComparison.OrdinalIgnoreCase);

        var euroMatch = Regex.Match(text, @"([0-9][0-9.,]*)\s*€");
        var euros = euroMatch.Success ? ParseMoneyDecimal(euroMatch.Groups[1].Value) : 0m;

        var pointsText = euroMatch.Success
            ? text.Remove(euroMatch.Index, euroMatch.Length)
            : text;
        var pointMatch = Regex.Match(pointsText, @"([0-9][0-9.,]*)");
        var points = hasPoints && pointMatch.Success ? ParseDigitsInt(pointMatch.Groups[1].Value) : 0;

        return new ShopCartMoneyDto(points, euros);
    }

    private static int ParseDigitsInt(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return 0;
        var digits = Regex.Replace(value, @"[^\d]", string.Empty);
        return int.TryParse(digits, NumberStyles.Integer, CultureInfo.InvariantCulture, out var result) ? result : 0;
    }

    private static decimal ParseMoneyDecimal(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return 0m;
        value = value.Trim();

        if (value.Contains(','))
            value = value.Replace(".", string.Empty).Replace(',', '.');
        else if (value.Count(character => character == '.') > 0)
        {
            var lastDot = value.LastIndexOf('.');
            var decimals = value.Length - lastDot - 1;
            if (decimals != 2)
                value = value.Replace(".", string.Empty);
        }

        return decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out var result) ? result : 0m;
    }

    public static RankingResultDto ParseRanking(
        string json,
        string countryCode,
        string? province,
        string game,
        string diana,
        string gender)
    {
        using var doc = JsonDocument.Parse(json);
        var players = new List<RankingPlayerDto>();
        if (doc.RootElement.ValueKind != JsonValueKind.Array)
            return new RankingResultDto(countryCode, province, game, diana, gender, DateTimeOffset.UtcNow, players);

        foreach (var item in doc.RootElement.EnumerateArray())
        {
            var userId = GetString(item, "UserID") ?? string.Empty;
            var gameCode = GetString(item, "Game") ?? game;
            var value = GetString(item, gameCode) ?? GetString(item, "MPR") ?? GetString(item, "PPD") ?? string.Empty;

            players.Add(new RankingPlayerDto(
                Rank: ParseInt(GetString(item, "rank")),
                UserId: userId,
                Alias: Clean(GetString(item, "Alias")),
                FirstName: DecodeBase64(GetString(item, "Nombre")) ?? string.Empty,
                LastName: DecodeBase64(GetString(item, "Apellidos")) ?? string.Empty,
                CountryCode: GetString(item, "Pais") ?? countryCode,
                Location: Clean(GetString(item, "Local")),
                ValidUntil: GetString(item, "NotValidAfter"),
                Premium: GetBool(item, "Premium"),
                OfficialPlayerType: GetString(item, "OfficialPlayerType") ?? "NONE",
                Game: gameCode,
                Value: value,
                PhotoUrl: $"/api/photos/player?userId={Uri.EscapeDataString(userId)}"));
        }

        return new RankingResultDto(countryCode, province, game, diana, gender, DateTimeOffset.UtcNow, players);
    }

    private static readonly (string Key, string Label)[] PpdStatLabels =
    {
        ("games", "Partidas"),
        ("Wins", "Victorias"),
        ("losts", "Derrotas"),
        ("%Win", "% victorias"),
        ("WinsInd", "Victorias individuales"),
        ("WinsTeam", "Victorias por equipos"),
        ("ClosedLegs", "Piernas cerradas"),
        ("hattricks", "Hat tricks"),
        ("superhattricks", "Super hat tricks"),
        ("threeinabeds", "Three in a bed"),
        ("ton80s", "Ton 80"),
        ("hitons", "High tons"),
        ("lowtons", "Low tons"),
        ("maxton", "Mejor tono"),
        ("4RO", "Salidas en 4 rondas"),
        ("5RO", "Salidas en 5 rondas"),
        ("6RO", "Salidas en 6 rondas"),
        ("7RO", "Salidas en 7 rondas"),
        ("8RO", "Salidas en 8 rondas"),
        ("6DO", "Dobles fuera 6"),
        ("7DO", "Dobles fuera 7"),
        ("8DO", "Dobles fuera 8"),
        ("9DO", "Dobles fuera 9"),
        ("10DO", "Dobles fuera 10"),
        ("11DO", "Dobles fuera 11"),
        ("12DO", "Dobles fuera 12"),
        ("AST", "Asistencias"),
        ("bull", "Bulls"),
        ("doublebull", "Doble bull")
    };

    private static readonly (string Key, string Label)[] MprStatLabels =
    {
        ("games", "Partidas"),
        ("Wins", "Victorias"),
        ("losts", "Derrotas"),
        ("%Win", "% victorias"),
        ("WinsInd", "Victorias individuales"),
        ("WinsTeam", "Victorias por equipos"),
        ("hattricks", "Hat tricks"),
        ("superhattricks", "Super hat tricks"),
        ("threeinabeds", "Three in a bed"),
        ("ton80s", "Ton 80"),
        ("whitehorses", "White horses"),
        ("5MR", "Rondas de 5 marcas"),
        ("6MR", "Rondas de 6 marcas"),
        ("7MR", "Rondas de 7 marcas"),
        ("8MR", "Rondas de 8 marcas"),
        ("9MR", "Rondas de 9 marcas"),
        ("bull", "Bulls"),
        ("doublebull", "Doble bull")
    };

    /// <summary>
    /// Convierte la respuesta de <c>ajax.newstats.php?action=total_user</c> en una ficha.
    /// Es el único endpoint público que acepta un Radikal ID (DNI) y devuelve los datos del jugador.
    /// </summary>
    public static PlayerLookupDto? ParsePlayerLookup(string json, string radikalId)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        var ppd = FirstStatItem(root, "PPD");
        var mpr = FirstStatItem(root, "MPR");
        if (ppd is null && mpr is null) return null;

        var identity = mpr ?? ppd;
        var alias = Clean(GetString(identity!.Value, "Alias"));
        var firstName = Clean(GetString(identity.Value, "Nombre"));
        var lastName = Clean(GetString(identity.Value, "Apellidos"));
        var userId = GetString(identity.Value, "UserID") ?? string.Empty;
        var team = Clean(GetString(identity.Value, "Team"));
        if (team is "-" or "") team = null;

        var games = new List<PlayerGameStatsDto>();
        if (ppd is not null) games.Add(BuildGameStats("PPD", ppd.Value, "AvgPPD", PpdStatLabels));
        if (mpr is not null) games.Add(BuildGameStats("MPR", mpr.Value, "AvgMPR", MprStatLabels));

        return new PlayerLookupDto(
            radikalId.Trim().ToUpperInvariant(),
            userId,
            string.IsNullOrWhiteSpace(alias) ? radikalId : alias,
            firstName,
            lastName,
            team,
            games);
    }

    private static JsonElement? FirstStatItem(JsonElement root, string game)
    {
        if (root.ValueKind != JsonValueKind.Object ||
            !root.TryGetProperty(game, out var array) ||
            array.ValueKind != JsonValueKind.Array ||
            array.GetArrayLength() == 0)
            return null;

        var first = array[0];
        return first.ValueKind == JsonValueKind.Object ? first : null;
    }

    private static PlayerGameStatsDto BuildGameStats(
        string game,
        JsonElement element,
        string averageKey,
        (string Key, string Label)[] labels)
    {
        var average = GetString(element, averageKey) ?? "0";
        var games = GetString(element, "games") ?? "0";
        var wins = GetString(element, "Wins") ?? "0";
        var losses = GetString(element, "losts") ?? "0";
        var winPercent = GetString(element, "%Win") ?? "0";

        var details = new List<PlayerStatItemDto>();
        foreach (var (key, label) in labels)
        {
            if (key is "games" or "Wins" or "losts" or "%Win") continue;

            var raw = GetString(element, key);
            if (string.IsNullOrWhiteSpace(raw)) continue;

            // Estas métricas se muestran siempre, aunque estén a cero.
            var alwaysShow = key is "WinsTeam" or "lowtons" or "bull" or "doublebull";
            if (raw == "0" && !alwaysShow) continue;

            details.Add(new PlayerStatItemDto(label, raw));
        }

        return new PlayerGameStatsDto(game, average, games, wins, losses, winPercent, details);
    }

    public static IReadOnlyList<ProvinceDto> ParseProvinces(string json)
    {
        var list = new List<ProvinceDto>();
        using var doc = JsonDocument.Parse(json);
        if (doc.RootElement.ValueKind != JsonValueKind.Array || doc.RootElement.GetArrayLength() < 2)
            return list;

        var rows = doc.RootElement[1];
        if (rows.ValueKind != JsonValueKind.Array) return list;

        foreach (var row in rows.EnumerateArray())
        {
            var value = GetString(row, "Local3");
            if (string.IsNullOrWhiteSpace(value)) continue;
            list.Add(new ProvinceDto(value, Clean(GetString(row, "Local33") ?? value)));
        }

        return list;
    }

    public static IReadOnlyList<LocalityDto> ParseLocalities(string json)
    {
        var list = new List<LocalityDto>();
        using var doc = JsonDocument.Parse(json);
        if (doc.RootElement.ValueKind != JsonValueKind.Array || doc.RootElement.GetArrayLength() < 2)
            return list;

        var rows = doc.RootElement[1];
        if (rows.ValueKind != JsonValueKind.Array) return list;

        foreach (var row in rows.EnumerateArray())
        {
            var value = GetString(row, "Local2");
            if (string.IsNullOrWhiteSpace(value)) continue;
            list.Add(new LocalityDto(value, Clean(GetString(row, "Local22") ?? value)));
        }

        return list;
    }

    public static IReadOnlyList<LocalDto> ParseLocales(string json)
    {
        var list = new List<LocalDto>();
        using var doc = JsonDocument.Parse(json);
        if (doc.RootElement.ValueKind != JsonValueKind.Array || doc.RootElement.GetArrayLength() < 2)
            return list;

        var rows = doc.RootElement[1];
        if (rows.ValueKind != JsonValueKind.Array) return list;

        foreach (var row in rows.EnumerateArray())
        {
            var machineId = GetString(row, "MaquinaID");
            if (string.IsNullOrWhiteSpace(machineId)) continue;
            list.Add(new LocalDto(machineId, Clean(GetString(row, "Nomlocal") ?? machineId)));
        }

        return list;
    }

    public static IReadOnlyList<CompetitionSummaryDto> ParseCompetitionCards(string html, bool includePlaceholders = false)
    {
        var doc = Parser.ParseDocument(html);
        var result = new Dictionary<(int Id, string Type), CompetitionSummaryDto>();

        foreach (var card in doc.QuerySelectorAll("div.comp_activa"))
        {
            var name = Clean(card.QuerySelector("h4")?.TextContent);
            if (string.IsNullOrWhiteSpace(name)) continue;
            if (!includePlaceholders && name.All(c => c == '-')) continue;

            var anchor = card.QuerySelector("a[href*='compid=']");
            var href = anchor?.GetAttribute("href") ?? string.Empty;
            var idMatch = CompIdRegex().Match(href);
            if (!idMatch.Success) continue;
            var id = int.Parse(idMatch.Groups[1].Value, CultureInfo.InvariantCulture);

            var typeIcon = card.QuerySelector("img[src*='ico-']") ??
                           card.QuerySelectorAll("img").FirstOrDefault(i =>
                               !i.ClassList.Contains("pin_live") &&
                               !string.Equals(i.GetAttribute("alt"), "Info", StringComparison.OrdinalIgnoreCase));
            var typeLabel = Clean(typeIcon?.GetAttribute("alt"));
            var type = MapCompetitionType(typeLabel, TipoRegex().Match(href).Groups[1].Value);

            var statusIcon = card.QuerySelector("img.pin_live");
            var statusTitle = Clean(statusIcon?.GetAttribute("title"));
            var status = MapCompetitionStatus(statusTitle);
            var isLive = status == "live" ||
                         (statusIcon?.GetAttribute("src")?.Contains("bullet-green", StringComparison.OrdinalIgnoreCase) ?? false);

            string? game = null;
            foreach (var row in card.QuerySelectorAll("table.competi_table tr"))
            {
                var cells = row.QuerySelectorAll("td").ToArray();
                if (cells.Length < 2) continue;
                if (Clean(cells[0].TextContent).StartsWith("Juego", StringComparison.OrdinalIgnoreCase))
                {
                    game = Clean(cells[1].TextContent);
                    break;
                }
            }

            var start = ParseDate(Clean(card.QuerySelector(".fecha_i")?.TextContent));
            var end = ParseDate(Clean(card.QuerySelector(".fecha_f")?.TextContent));

            var item = new CompetitionSummaryDto(
                Id: id,
                Type: type,
                TypeLabel: string.IsNullOrWhiteSpace(typeLabel) ? type : typeLabel,
                Name: name,
                Status: status,
                IsLive: isLive,
                Game: game,
                StartsAt: start,
                EndsAt: end);

            result[(id, type)] = item;
        }

        return result.Values
            .OrderBy(c => StatusOrder(c.Status))
            .ThenBy(c => c.Status == "live"
                ? -(c.StartsAt?.Ticks ?? long.MinValue)
                : (c.StartsAt?.Ticks ?? long.MaxValue))
            .ThenBy(c => c.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public static StandingTableDto? ParseStandings(string html)
    {
        var doc = Parser.ParseDocument(html);
        var table = doc.QuerySelector("table.tablaClasifica") ??
                    doc.QuerySelectorAll("table").FirstOrDefault(t =>
                        Clean(t.ClassName).Contains("clasifica", StringComparison.OrdinalIgnoreCase));

        if (table is null) return null;

        var columns = table.QuerySelectorAll("thead th")
            .Select(th => Clean(th.TextContent))
            .Where(c => !string.IsNullOrWhiteSpace(c))
            .ToList();

        var rows = new List<IReadOnlyList<string>>();
        foreach (var tr in table.QuerySelectorAll("tbody tr"))
        {
            var cells = tr.QuerySelectorAll("td").Select(td => Clean(td.TextContent)).ToList();
            if (cells.Count < 2) continue;
            if (cells.All(string.IsNullOrWhiteSpace)) continue;
            rows.Add(cells);
        }

        if (rows.Count == 0 && columns.Count == 0) return null;

        if (columns.Count == 0)
        {
            columns = Enumerable.Range(1, rows[0].Count).Select(i => $"Col {i}").ToList();
        }

        return new StandingTableDto(
            Caption: Clean(table.QuerySelector("caption")?.TextContent),
            Columns: columns,
            Rows: rows);
    }

    public static CompetitionInfoDto ParseCompetitionInfo(string html)
    {
        var doc = Parser.ParseDocument(html);
        var name = Clean(doc.QuerySelector("ul#competiciones h2, #competiciones h2, h2")?.TextContent);
        string? description = null;
        string? game = null;
        DateTime? start = null;
        DateTime? end = null;
        string? scope = null;

        var metaDescription = doc.QuerySelector("meta[name='description']")?.GetAttribute("content");
        if (!string.IsNullOrWhiteSpace(metaDescription))
            description = Clean(metaDescription);

        var table = doc.QuerySelector("table.information");
        if (table is not null)
        {
            var section = string.Empty;
            foreach (var tr in table.QuerySelectorAll("tr"))
            {
                var cells = tr.QuerySelectorAll("td").ToArray();
                if (cells.Length == 0) continue;

                var titleCell = cells.FirstOrDefault(c => c.ClassList.Contains("title_row"));
                if (titleCell is not null)
                {
                    var title = Clean(titleCell.TextContent);
                    if (!string.IsNullOrWhiteSpace(title)) section = title.ToUpperInvariant();
                    if (section is "DESCRIPCIÓN" or "DESCRIPCION")
                    {
                        var value = cells.Skip(1).Select(c => Clean(c.TextContent)).FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));
                        if (value is not null) description = value;
                    }
                    continue;
                }

                if (section == "FECHA")
                {
                    for (var i = 0; i < cells.Length - 1; i++)
                    {
                        var label = Clean(cells[i].TextContent);
                        if (label.Equals("Fecha Inicio", StringComparison.OrdinalIgnoreCase))
                            start = ParseDate(Clean(cells[i + 1].TextContent));
                        else if (label.Equals("Fecha Fin", StringComparison.OrdinalIgnoreCase))
                            end = ParseDate(Clean(cells[i + 1].TextContent));
                    }
                }
                else if (section == "ÁMBITO" || section == "AMBITO")
                {
                    var value = cells.Select(c => Clean(c.TextContent)).FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));
                    if (value is not null) scope = value;
                }
                else if (section == "JUEGO")
                {
                    var value = cells.Select(c => Clean(c.TextContent)).FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));
                    if (value is not null) game = value;
                }
            }
        }

        return new CompetitionInfoDto(
            string.IsNullOrWhiteSpace(name) ? null : name,
            description,
            game,
            start,
            end,
            scope,
            null);
    }

    public static int ParseNewsTotalPages(string html)
    {
        var doc = Parser.ParseDocument(html);
        var max = 0;
        foreach (var anchor in doc.QuerySelectorAll("a[href*='pageNum_rsNoticias=']"))
        {
            var match = Regex.Match(anchor.GetAttribute("href") ?? string.Empty, @"pageNum_rsNoticias=(\d+)");
            if (match.Success && int.TryParse(match.Groups[1].Value, out var page))
                max = Math.Max(max, page);
        }
        return Math.Max(1, max + 1);
    }

    public static DianaListDto ParseDianas(string html)
    {
        var items = new List<DianaMachineDto>();
        var byType = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

        foreach (Match match in MachineRegex().Matches(html))
        {
            if (!double.TryParse(match.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var lat)) continue;
            if (!double.TryParse(match.Groups[2].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var lng)) continue;
            if (!long.TryParse(match.Groups[4].Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var id)) continue;
            var board = match.Groups[5].Value.Trim().ToUpperInvariant();

            items.Add(new DianaMachineDto(id, lat, lng, board));
            byType[board] = byType.GetValueOrDefault(board) + 1;
        }

        return new DianaListDto(items.Count, byType, items);
    }

    public static DianaDetailDto ParseDianaDetail(string html, long id)
    {
        var doc = Parser.ParseDocument(html);
        var name = Clean(doc.QuerySelector("#machine_name")?.TextContent);
        var address = Clean(doc.QuerySelector("#machine_address")?.TextContent);
        var city = Clean(doc.QuerySelector("#machine_city")?.TextContent);
        var competitions = doc.QuerySelectorAll("#Championships a, #Championships .competition_name")
            .Select(a => Clean(a.TextContent))
            .Where(t => !string.IsNullOrWhiteSpace(t))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(30)
            .ToList();

        return new DianaDetailDto(
            id,
            string.IsNullOrWhiteSpace(name) ? null : name,
            string.IsNullOrWhiteSpace(address) ? null : address,
            string.IsNullOrWhiteSpace(city) ? null : city,
            competitions);
    }

    public static IReadOnlyList<TopPlaceDto> ParseTopPlaces(string html)
    {
        var doc = Parser.ParseDocument(html);
        var places = new List<TopPlaceDto>();

        foreach (var row in doc.QuerySelectorAll("tr.topplace-tr-class"))
        {
            if (!int.TryParse(row.GetAttribute("topplace_id"), out var id)) continue;
            if (!double.TryParse(row.GetAttribute("topplace_latitud"), NumberStyles.Float, CultureInfo.InvariantCulture, out var lat)) continue;
            if (!double.TryParse(row.GetAttribute("topplace_longitud"), NumberStyles.Float, CultureInfo.InvariantCulture, out var lng)) continue;

            var type = row.ClassList.FirstOrDefault(c => c is "PLATINUM" or "GOLDEN" or "SILVER" or "BRONZE") ?? "SILVER";
            var machinesText = Clean(row.QuerySelector(".topplace-td-total_machines-class")?.TextContent);
            _ = int.TryParse(machinesText.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault(), out var machines);

            var nameCell = row.QuerySelector(".topplace-td-name-class");
            var name = Clean(nameCell?.ChildNodes.FirstOrDefault(n => n.NodeType == NodeType.Text)?.TextContent);
            if (string.IsNullOrWhiteSpace(name))
                name = Clean(nameCell?.TextContent);

            var phoneLink = row.QuerySelector("a[title='phone']")?.GetAttribute("href");
            var mapsLink = row.QuerySelector("a[title='maps']")?.GetAttribute("href");
            var facebookLink = row.QuerySelector("a[title='facebook']")?.GetAttribute("href");
            var flag = row.QuerySelector("img[src*='/paises/']")?.GetAttribute("src");

            places.Add(new TopPlaceDto(
                id,
                name,
                type,
                machines,
                lat,
                lng,
                flag is null ? null : new Uri(new Uri("https://esp.radikalplayers.com/"), flag).ToString(),
                phoneLink?.Replace("tel:", string.Empty, StringComparison.OrdinalIgnoreCase),
                mapsLink,
                facebookLink));
        }

        return places;
    }

    public static IReadOnlyList<NewsItemDto> ParseNewsList(string html)
    {
        var doc = Parser.ParseDocument(html);
        var items = new List<NewsItemDto>();
        var seen = new HashSet<int>();

        foreach (var card in doc.QuerySelectorAll("div.noticia-item"))
        {
            var link = card.QuerySelector("a[href*='/noticias/']");
            var href = link?.GetAttribute("href");
            if (string.IsNullOrWhiteSpace(href)) continue;
            var match = NewsIdRegex().Match(href);
            if (!match.Success) continue;
            var id = int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture);
            if (!seen.Add(id)) continue;

            var title = Clean(card.QuerySelector("h3")?.TextContent);
            if (string.IsNullOrWhiteSpace(title)) continue;

            var image = card.QuerySelector("img[src*='/common/noticias/']")?.GetAttribute("src");
            var date = Clean(card.QuerySelector(".date_new")?.TextContent);
            var excerpt = Clean(card.QuerySelector("h4")?.TextContent);

            items.Add(new NewsItemDto(
                id,
                title,
                string.IsNullOrWhiteSpace(excerpt) ? null : excerpt,
                image is null ? null : new Uri(new Uri("https://esp.radikalplayers.com/"), image).ToString(),
                string.IsNullOrWhiteSpace(date) ? null : date,
                new Uri(new Uri("https://esp.radikalplayers.com/"), href).ToString()));
        }

        return items;
    }

    public static NewsDetailDto ParseNewsDetail(string html, int id, string url)
    {
        var doc = Parser.ParseDocument(html);
        var ogTitle = doc.QuerySelector("meta[property='og:title']")?.GetAttribute("content")
                      ?? doc.QuerySelector("meta[name='og:title']")?.GetAttribute("content");
        var title = Clean(ogTitle).Replace(" - Noticias", string.Empty, StringComparison.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(title))
            title = Clean(doc.QuerySelector("h2, h3, h1")?.TextContent);

        var excerpt = Clean(doc.QuerySelector("meta[name='description']")?.GetAttribute("content"));
        var image = doc.QuerySelector("meta[property='og:image']")?.GetAttribute("content")
                    ?? doc.QuerySelector("meta[name='og:image']")?.GetAttribute("content")
                    ?? doc.QuerySelector("meta[name='image']")?.GetAttribute("content");
        var date = Clean(doc.QuerySelector(".date_new")?.TextContent);

        var paragraphs = doc.QuerySelectorAll("#right-large p, #noticias p, .noticia-item p")
            .Select(p => Clean(p.TextContent))
            .Where(p => p.Length > 40)
            .Distinct()
            .Take(20)
            .ToList();

        if (paragraphs.Count == 0 && !string.IsNullOrWhiteSpace(excerpt))
            paragraphs.Add(excerpt);

        return new NewsDetailDto(
            id,
            string.IsNullOrWhiteSpace(title) ? $"Noticia {id}" : title,
            string.IsNullOrWhiteSpace(excerpt) ? null : excerpt,
            image,
            string.IsNullOrWhiteSpace(date) ? null : date,
            url,
            paragraphs);
    }

    public static PlayerProfileDto ParsePlayerProfile(string html, string dni, bool isDemo = false)
    {
        var doc = Parser.ParseDocument(html);
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        foreach (var item in doc.QuerySelectorAll(".listitem"))
        {
            var lines = item.TextContent
                .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(Clean)
                .Where(l => !string.IsNullOrWhiteSpace(l))
                .ToList();
            if (lines.Count >= 2 && !values.ContainsKey(lines[0]))
                values[lines[0]] = lines[^1];
        }

        foreach (var dl in doc.QuerySelectorAll("dl"))
        {
            var dts = dl.QuerySelectorAll("dt").ToArray();
            var dds = dl.QuerySelectorAll("dd").ToArray();
            for (var i = 0; i < Math.Min(dts.Length, dds.Length); i++)
            {
                var key = Clean(dts[i].TextContent);
                if (!string.IsNullOrWhiteSpace(key) && !values.ContainsKey(key))
                    values[key] = Clean(dds[i].TextContent);
            }
        }

        foreach (var row in doc.QuerySelectorAll("table tr"))
        {
            var cells = row.QuerySelectorAll("td").Select(td => Clean(td.TextContent)).ToArray();
            if (cells.Length == 2 && !string.IsNullOrWhiteSpace(cells[0]) && !values.ContainsKey(cells[0]))
                values[cells[0]] = cells[1];
        }

        static string? Value(Dictionary<string, string> source, params string[] keys)
        {
            foreach (var key in keys)
                if (source.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value))
                    return value;
            return null;
        }

        var alias = Value(values, "Alias", "Nick", "Nickname", "Nombre de jugador");
        if (string.IsNullOrWhiteSpace(alias))
            alias = Clean(doc.QuerySelector("#alias, .alias, .nickname, .player-alias, .player-name, h2")?.TextContent);
        if (string.IsNullOrWhiteSpace(alias) || alias.Equals("Mi Radikal", StringComparison.OrdinalIgnoreCase))
            alias = dni;

        var name = Value(values, "Nombre", "Nombre completo");
        var province = Value(values, "Provincia");
        var country = Value(values, "País", "Pais");

        var photo = doc.QuerySelector("img[src*='api.foto.php'], img[src*='foto'], .player-photo img, #profile-picture img")
            ?.GetAttribute("src");
        if (!string.IsNullOrWhiteSpace(photo))
        {
            if (Uri.TryCreate(photo, UriKind.Relative, out _))
                photo = new Uri(new Uri("https://esp.radikalplayers.com/"), photo).ToString();

            var userIdMatch = Regex.Match(photo, @"[?&]userID=([^&]+)", RegexOptions.IgnoreCase);
            if (userIdMatch.Success)
                photo = $"/api/photos/player?userId={Uri.EscapeDataString(Uri.UnescapeDataString(userIdMatch.Groups[1].Value))}";
        }

        var stats = new List<PlayerStatDto>();
        foreach (var item in values)
        {
            if (item.Key.Contains("MPR", StringComparison.OrdinalIgnoreCase) ||
                item.Key.Contains("PPD", StringComparison.OrdinalIgnoreCase))
            {
                stats.Add(new PlayerStatDto(item.Key, item.Value));
            }
        }

        var mpr = stats.FirstOrDefault(s => s.Label.Equals("MPR", StringComparison.OrdinalIgnoreCase))?.Value
                  ?? stats.FirstOrDefault(s => s.Label.Contains("MPR", StringComparison.OrdinalIgnoreCase))?.Value;
        var ppd = stats.FirstOrDefault(s => s.Label.Equals("PPD", StringComparison.OrdinalIgnoreCase))?.Value
                  ?? stats.FirstOrDefault(s => s.Label.Contains("PPD", StringComparison.OrdinalIgnoreCase))?.Value;
        var rank = Value(values, "Ranking", "Rank", "Posición", "Posicion");

        var competitions = new List<PlayerCompetitionDto>();
        var seenCompetitions = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var anchor in doc.QuerySelectorAll("a[href*='compid=']"))
        {
            var href = anchor.GetAttribute("href") ?? string.Empty;
            var idMatch = CompIdRegex().Match(href);
            if (!idMatch.Success) continue;
            var id = int.Parse(idMatch.Groups[1].Value, CultureInfo.InvariantCulture);
            var competitionName = Clean(anchor.TextContent);
            if (string.IsNullOrWhiteSpace(competitionName) || competitionName.Length < 3) continue;
            if (!seenCompetitions.Add($"{id}:{competitionName}")) continue;
            var type = TipoRegex().Match(href).Groups[1].Value.ToUpperInvariant();
            competitions.Add(new PlayerCompetitionDto(id, competitionName, string.IsNullOrWhiteSpace(type) ? null : type));
            if (competitions.Count >= 20) break;
        }

        if (competitions.Count == 0)
        {
            var bodyText = doc.Body?.TextContent ?? string.Empty;
            foreach (var line in bodyText
                         .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                         .Select(Clean)
                         .Where(l => l.StartsWith("LIGA:", StringComparison.OrdinalIgnoreCase) ||
                                     l.StartsWith("TORX:", StringComparison.OrdinalIgnoreCase) ||
                                     l.StartsWith("CAMP:", StringComparison.OrdinalIgnoreCase) ||
                                     l.StartsWith("LVIRT:", StringComparison.OrdinalIgnoreCase))
                         .Distinct(StringComparer.OrdinalIgnoreCase)
                         .Take(20))
            {
                competitions.Add(new PlayerCompetitionDto(null, line, line.Split(':')[0]));
            }
        }

        var knownKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "Alias", "Nick", "Nickname", "Nombre", "Provincia", "País", "Pais", "Ranking", "Rank", "Posición", "Posicion"
        };
        var info = values
            .Where(item => !knownKeys.Contains(item.Key))
            .Where(item => !item.Key.Contains("MPR", StringComparison.OrdinalIgnoreCase) &&
                           !item.Key.Contains("PPD", StringComparison.OrdinalIgnoreCase))
            .Take(20)
            .Select(item => new PlayerInfoItemDto(item.Key, item.Value))
            .ToList();

        return new PlayerProfileDto(
            dni,
            alias,
            name,
            photo,
            province,
            country,
            mpr,
            ppd,
            rank,
            stats,
            competitions,
            info,
            DateTimeOffset.UtcNow,
            isDemo);
    }

    public static IReadOnlyList<OfficialPlayerDto> ParseOfficialPlayers(string html)
    {
        var doc = Parser.ParseDocument(html);
        var players = new List<OfficialPlayerDto>();

        foreach (var li in doc.QuerySelectorAll("li[class^='officialplayer-']"))
        {
            var classType = li.ClassList.FirstOrDefault(c => c.StartsWith("officialplayer-", StringComparison.OrdinalIgnoreCase));
            if (classType is null) continue;
            var type = classType["officialplayer-".Length..].ToUpperInvariant();

            var link = li.QuerySelector("a[href*='officialplayer.php']")?.GetAttribute("href");
            var idMatch = Regex.Match(link ?? string.Empty, @"officialplayer_id=(\d+)", RegexOptions.IgnoreCase);
            if (!idMatch.Success) continue;
            var id = int.Parse(idMatch.Groups[1].Value, CultureInfo.InvariantCulture);

            var alias = Clean(li.TextContent);
            if (string.IsNullOrWhiteSpace(alias)) continue;

            var photo = li.QuerySelector("img")?.GetAttribute("src");
            var mediaMatch = OfficialMediaRegex().Match(photo ?? string.Empty);
            var photoUrl = mediaMatch.Success
                ? $"/api/photos/official?mediaId={mediaMatch.Groups[1].Value}"
                : null;

            // Redes sociales del jugador (bloque "section-sociallinks" del listado oficial).
            var socials = new List<OfficialSocialDto>();
            foreach (var socialLink in li.QuerySelectorAll("a.officialplayer-social-link, .section-sociallinks a[href]"))
            {
                var href = socialLink.GetAttribute("href");
                if (string.IsNullOrWhiteSpace(href) || href == "#") continue;
                var network = (socialLink.GetAttribute("title")
                               ?? socialLink.QuerySelector("img")?.GetAttribute("src")
                               ?? string.Empty).ToLowerInvariant();

                var name = network.Contains("facebook") ? "facebook"
                    : network.Contains("instagram") ? "instagram"
                    : network.Contains("twitter") || network.Contains("x.com") ? "x"
                    : network.Contains("tiktok") ? "tiktok"
                    : network.Contains("youtube") ? "youtube"
                    : network.Contains("twitch") ? "twitch"
                    : "web";

                if (socials.Any(item => item.Network == name)) continue;
                socials.Add(new OfficialSocialDto(name, href));
            }

            players.Add(new OfficialPlayerDto(id, type, alias, photoUrl, socials));
        }

        return players;
    }

    public static OfficialPlayerDetailDto ParseOfficialPlayerDetail(
        string html,
        int id,
        string type,
        string alias,
        string? photoUrl,
        IReadOnlyList<OfficialSocialDto>? socials = null)
    {
        var doc = Parser.ParseDocument(html);
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        foreach (var item in doc.QuerySelectorAll(".listitem"))
        {
            var lines = item.TextContent
                .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(Clean)
                .Where(l => !string.IsNullOrWhiteSpace(l))
                .ToList();
            if (lines.Count >= 2)
                values[lines[0]] = lines[^1];
        }

        values.TryGetValue("Alias", out var parsedAlias);
        values.TryGetValue("Nombre", out var name);
        values.TryGetValue("Provincia", out var province);
        values.TryGetValue("País", out var country);
        values.TryGetValue("Mano de juego", out var hand);

        var stats = new List<OfficialStatDto>();
        foreach (var label in new[] { "PPD AE", "MPR AE", "PPD AA", "MPR AA" })
        {
            if (values.TryGetValue(label, out var value))
                stats.Add(new OfficialStatDto(label, value));
        }

        var competitions = new List<string>();
        var current = doc.QuerySelectorAll(".section-block")
            .FirstOrDefault(b => Clean(b.TextContent).Contains("COMPETICIONES ACTUALES", StringComparison.OrdinalIgnoreCase));
        if (current is not null)
        {
            competitions.AddRange(current.TextContent
                .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(Clean)
                .Where(l => l.Contains(':') && !l.Contains("COMPETICIONES ACTUALES", StringComparison.OrdinalIgnoreCase))
                .Distinct(StringComparer.OrdinalIgnoreCase));
        }

        // Galería: imágenes del carrusel principal y del bloque de medios adicionales.
        var media = new List<OfficialMediaDto>();
        var seenMedia = new HashSet<long>();
        var container = doc.QuerySelector("#officialplayer_container") ?? doc.Body;
        foreach (var element in container.QuerySelectorAll(".officialplayer_media img, .officialplayer_mediaothers img"))
        {
            var source = element.GetAttribute("src") ?? element.GetAttribute("data-src");
            var match = OfficialMediaRegex().Match(source ?? string.Empty);
            if (!match.Success || !long.TryParse(match.Groups[1].Value, out var mediaId)) continue;
            if (!seenMedia.Add(mediaId)) continue;
            media.Add(new OfficialMediaDto(mediaId, $"/api/photos/official?mediaId={mediaId}", 0, 0));
        }

        return new OfficialPlayerDetailDto(
            id,
            type,
            string.IsNullOrWhiteSpace(parsedAlias) ? alias : parsedAlias,
            string.IsNullOrWhiteSpace(name) ? null : name,
            string.IsNullOrWhiteSpace(province) ? null : province,
            string.IsNullOrWhiteSpace(country) ? null : country,
            RadikalMetadata.CountryCodeByName(country),
            string.IsNullOrWhiteSpace(hand) ? null : hand,
            photoUrl,
            stats,
            competitions,
            media,
            socials ?? Array.Empty<OfficialSocialDto>(),
            null,
            null);
    }

    public static TournamentBracketDto ParseTournamentBracket(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        var name = root.TryGetProperty("torneo", out var torneo) ? GetString(torneo, "nombre") : null;
        var level = root.TryGetProperty("torneo", out var torneo2) ? GetString(torneo2, "level_priority") : null;
        var width = root.TryGetProperty("size", out var size) ? GetDouble(size, "width") : 0;
        var height = root.TryGetProperty("size", out var size2) ? GetDouble(size2, "height") : 0;

        var config = new TournamentConfigDto(0, 0, 0, 0, 0, 0, 0, 0);
        if (root.TryGetProperty("config", out var cfg))
        {
            config = new TournamentConfigDto(
                GetDouble(cfg, "width"),
                GetDouble(cfg, "height"),
                GetDouble(cfg, "width_result"),
                GetDouble(cfg, "height_equipo"),
                GetDouble(cfg, "separacion_x"),
                GetDouble(cfg, "separacion_y"),
                GetDouble(cfg, "offsetX"),
                GetDouble(cfg, "offsetY"));
        }

        var cells = new List<TournamentCellDto>();
        if (root.TryGetProperty("casillas", out var casillas) && casillas.ValueKind == JsonValueKind.Array)
        {
            foreach (var c in casillas.EnumerateArray())
            {
                cells.Add(new TournamentCellDto(
                    CellId: GetInt(c, "cellid"),
                    RamaG: GetBool(c, "ramaG"),
                    Team0: Clean(GetString(c, "equipo0")),
                    Team1: Clean(GetString(c, "equipo1")),
                    Machine0: Clean(GetString(c, "maquina0")),
                    Machine1: Clean(GetString(c, "maquina1")),
                    Winner: GetInt(c, "ganador", -1),
                    Score0: GetInt(c, "puntos_equipo0"),
                    Score1: GetInt(c, "puntos_equipo1"),
                    Status: GetString(c, "status"),
                    StatusColor: GetString(c, "color_recuadro_status"),
                    DateTime: GetString(c, "datetime"),
                    Top: GetDouble(c, "top"),
                    Left: GetDouble(c, "left"),
                    Letter: GetString(c, "letra"),
                    Primary: GetInt(c, "primary"),
                    Hash: GetString(c, "hash")));
            }
        }

        var linesX = new List<TournamentLineXDto>();
        if (root.TryGetProperty("lineasX", out var lx) && lx.ValueKind == JsonValueKind.Array)
        {
            foreach (var l in lx.EnumerateArray())
                linesX.Add(new TournamentLineXDto(GetDouble(l, "x"), GetDouble(l, "x_add"), GetDouble(l, "y")));
        }

        var linesY = new List<TournamentLineYDto>();
        if (root.TryGetProperty("lineasY", out var ly) && ly.ValueKind == JsonValueKind.Array)
        {
            foreach (var l in ly.EnumerateArray())
                linesY.Add(new TournamentLineYDto(GetInt(l, "d"), GetDouble(l, "x"), GetDouble(l, "y1"), GetDouble(l, "y2")));
        }

        return new TournamentBracketDto(
            name,
            level,
            width,
            height,
            config,
            cells,
            linesX,
            linesY,
            DateTimeOffset.UtcNow);
    }

    public static ActaDto ParseActa(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        var columns = Math.Max(1, GetInt(root, "NCols", 5));
        var rows = new List<ActaRowDto>();

        if (root.TryGetProperty("ROWS", out var rowsEl) && rowsEl.ValueKind == JsonValueKind.Array)
        {
            foreach (var row in rowsEl.EnumerateArray())
            {
                var cells = new List<string?>();
                for (var i = 1; i <= columns; i++)
                    cells.Add(GetString(row, $"C{i}"));

                rows.Add(new ActaRowDto(
                    Clean(GetString(row, "Nick")),
                    GetString(row, "Nombre"),
                    GetString(row, "Sustitucion"),
                    cells));
            }
        }

        return new ActaDto(
            GetString(root, "TipoComp"),
            GetString(root, "NombreLiga"),
            GetString(root, "Jornada"),
            columns,
            ParseInt(GetString(root, "Pts1")),
            ParseInt(GetString(root, "Pts2")),
            Clean(GetString(root, "Team1")),
            Clean(GetString(root, "Team2")),
            rows,
            DateTimeOffset.UtcNow);
    }

    public static IReadOnlyList<LiveCompetitionDto> ParseLiveCompetitions(string json)
    {
        var list = new List<LiveCompetitionDto>();
        using var doc = JsonDocument.Parse(json);
        if (doc.RootElement.ValueKind != JsonValueKind.Array) return list;

        var fragments = new List<string>();
        foreach (var item in doc.RootElement.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.String)
            {
                fragments.Add(item.GetString() ?? string.Empty);
                continue;
            }

            if (item.ValueKind != JsonValueKind.Object) continue;
            var id = ParseInt(GetString(item, "compid"));
            if (id <= 0) continue;
            var link = GetString(item, "link") ?? string.Empty;
            var name = Clean(Parser.ParseDocument($"<div>{link}</div>").QuerySelector("div")?.TextContent);
            list.Add(new LiveCompetitionDto(id, string.IsNullOrWhiteSpace(name) ? null : name));
        }

        if (fragments.Count == 0) return list;

        var html = string.Concat(fragments);
        var fragmentDoc = Parser.ParseDocument($"<div id=\"live-fragments\">{html}</div>");
        foreach (var link in fragmentDoc.QuerySelectorAll("a[href*='compid='], a[onclick*='compid='], [onclick*='Visualizador.php']"))
        {
            var source = link.GetAttribute("href") ?? link.GetAttribute("onclick") ?? string.Empty;
            var match = Regex.Match(source, @"compid=(\d+)", RegexOptions.IgnoreCase);
            if (!match.Success || !int.TryParse(match.Groups[1].Value, out var id) || id <= 0)
                continue;
            if (list.Any(competition => competition.Id == id))
                continue;

            var name = Clean(link.TextContent);
            if (string.IsNullOrWhiteSpace(name) || name.Length > 90)
                name = Clean(link.Closest("div")?.TextContent);
            if (name.Length > 120) name = name[..120];

            list.Add(new LiveCompetitionDto(id, string.IsNullOrWhiteSpace(name) ? null : name));
        }

        return list;
    }

    public static LiveMatchListDto ParseLiveMatches(string json)
    {
        var matches = new List<LiveMatchDto>();
        using var doc = JsonDocument.Parse(json);
        if (doc.RootElement.ValueKind != JsonValueKind.Array)
            return new LiveMatchListDto(matches, DateTimeOffset.UtcNow);

        var html = string.Concat(doc.RootElement.EnumerateArray()
            .Where(item => item.ValueKind == JsonValueKind.String)
            .Select(item => item.GetString() ?? string.Empty));

        if (string.IsNullOrWhiteSpace(html))
            return new LiveMatchListDto(matches, DateTimeOffset.UtcNow);

        var fragmentDoc = Parser.ParseDocument($"<div id=\"live-fragments\">{html}</div>");
        var seen = new HashSet<(int CompetitionId, long MatchId, int Game)>();
        var elements = fragmentDoc.QuerySelectorAll("a[href*='Visualizador.php'], a[onclick*='Visualizador.php'], [onclick*='Visualizador.php']");

        foreach (var element in elements)
        {
            var source = element.GetAttribute("href") ?? element.GetAttribute("onclick") ?? string.Empty;
            var absoluteMatch = Regex.Match(source, @"https?://[^'""\s>]*Visualizador\.php\?[^'""\s>]+", RegexOptions.IgnoreCase);
            var relativeMatch = Regex.Match(source, @"Visualizador\.php\?[^'""\s>]+", RegexOptions.IgnoreCase);
            if (!absoluteMatch.Success && !relativeMatch.Success) continue;

            var viewerUrl = absoluteMatch.Success
                ? System.Net.WebUtility.HtmlDecode(absoluteMatch.Value)
                : $"https://www.radikalplayers.com/dianas/Radikal/{System.Net.WebUtility.HtmlDecode(relativeMatch.Value)}";
            var queryIndex = viewerUrl.IndexOf('?', StringComparison.Ordinal);
            var query = queryIndex >= 0 ? viewerUrl[(queryIndex + 1)..] : viewerUrl;
            var competitionId = ExtractQueryInt(query, "compid");
            var matchId = ExtractQueryLong(query, "encid");
            var game = ExtractQueryInt(query, "ngame");
            if (competitionId <= 0 || matchId <= 0) continue;
            if (game <= 0) game = 1;

            var key = (competitionId, matchId, game);
            if (!seen.Add(key)) continue;

            var title = Clean(element.TextContent);
            if (string.IsNullOrWhiteSpace(title) || title.Length > 90)
                title = Clean(element.Closest("div")?.TextContent);
            if (title.Length > 120) title = title[..120];
            if (string.IsNullOrWhiteSpace(title)) title = "Partida en directo";

            matches.Add(new LiveMatchDto(competitionId, matchId, game, title, viewerUrl.Replace("http://", "https://", StringComparison.OrdinalIgnoreCase)));
        }

        return new LiveMatchListDto(matches, DateTimeOffset.UtcNow);
    }

    public static LiveDartsDto ParseLiveDarts(string json, int competitionId, long matchId, int game)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        var now = DateTimeOffset.UtcNow;

        if (root.ValueKind == JsonValueKind.Object)
        {
            var finishedWinner = GetString(root, "endwinner");
            return new LiveDartsDto(
                competitionId,
                matchId,
                game,
                null,
                null,
                !string.IsNullOrWhiteSpace(finishedWinner),
                finishedWinner,
                Array.Empty<LiveDartDto>(),
                now);
        }

        if (root.ValueKind != JsonValueKind.Array)
            return new LiveDartsDto(competitionId, matchId, game, null, null, false, null, Array.Empty<LiveDartDto>(), now);

        var darts = new List<LiveDartDto>();
        string? gameType = null;
        bool? isTeam = null;
        string? winner = null;
        var finished = false;
        var infoPanels = new string[6];
        var startScore = 0;
        var stacked = 0;
        var nPlayers = 0;
        string? eqLoc = null;
        string? eqVis = null;
        string? idxLoc = null;
        string? idxVis = null;

        foreach (var item in root.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object) continue;
            gameType ??= GetString(item, "Game");
            if (item.TryGetProperty("isTeam", out var teamElement) && teamElement.ValueKind == JsonValueKind.Number)
                isTeam ??= teamElement.GetInt32() == 1;
            if (startScore <= 0)
            {
                startScore = GetInt(item, "X010");
                if (startScore <= 0)
                {
                    for (var index = 0; index < 8 && startScore <= 0; index++)
                        startScore = GetInt(item, $"X01{index}");
                }
            }
            if (stacked == 0) stacked = GetInt(item, "Stacked");
            if (nPlayers == 0) nPlayers = GetInt(item, "NPlayers");
            eqLoc ??= GetString(item, "EqLoc");
            eqVis ??= GetString(item, "EqVis");
            idxLoc ??= GetString(item, "IdxPlayersLoc");
            idxVis ??= GetString(item, "IdxPlayersVis");
            for (var panel = 0; panel < infoPanels.Length; panel++)
            {
                if (string.IsNullOrWhiteSpace(infoPanels[panel]))
                    infoPanels[panel] = GetString(item, $"InfoPanel{panel}") ?? string.Empty;
            }

            if (item.TryGetProperty("Winner", out var winnerElement))
            {
                finished = true;
                winner = winnerElement.ValueKind == JsonValueKind.String ? winnerElement.GetString() : null;
            }

            var dartNumber = GetInt(item, "Dart");
            if (dartNumber is < 1 or > 3) continue;
            var dartIndex = dartNumber - 1;

            var hitRegion = GetString(item, $"DartHR{dartIndex}");
            if (string.IsNullOrWhiteSpace(hitRegion)) continue;

            var multiplier = GetInt(item, $"DartMult{dartIndex}");
            var sector = GetInt(item, $"DartSector{dartIndex}");
            var playerIndex = GetInt(item, "CurrentPlayer");
            var playerName = GetString(item, $"PlayerName{playerIndex}") ?? $"Jugador {playerIndex + 1}";
            var playerId = GetString(item, $"PlayerId{playerIndex}");
            var round = GetInt(item, "Round");

            darts.Add(new LiveDartDto(
                round,
                playerIndex,
                playerName,
                playerId,
                dartNumber,
                hitRegion,
                multiplier,
                sector,
                CalculateDartScore(hitRegion, sector, multiplier),
                GetInt(item, "Bust") == 1,
                GetInt(item, "Frozen") == 1));
        }

        var uniqueDarts = darts
            .GroupBy(dart => (dart.Round, dart.PlayerIndex, dart.Dart))
            .Select(group => group.Last())
            .OrderBy(dart => dart.Round)
            .ThenBy(dart => dart.PlayerIndex)
            .ThenBy(dart => dart.Dart)
            .ToList();

        var rules = BuildX01Rules(gameType, infoPanels, startScore, stacked, nPlayers, eqLoc, eqVis, idxLoc, idxVis);

        return new LiveDartsDto(competitionId, matchId, game, gameType, isTeam, finished, winner, uniqueDarts, now, rules);
    }

    private static X01RulesDto? BuildX01Rules(
        string? gameType,
        IReadOnlyList<string> infoPanels,
        int startScore,
        int stacked,
        int nPlayers,
        string? eqLoc,
        string? eqVis,
        string? idxLoc,
        string? idxVis)
    {
        var isX01 = string.Equals(gameType, "X01", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(gameType, "TeamX01", StringComparison.OrdinalIgnoreCase) ||
                    (gameType?.Contains("01", StringComparison.OrdinalIgnoreCase) ?? false) ||
                    infoPanels.Any(panel => panel.Contains("X01", StringComparison.OrdinalIgnoreCase) ||
                                            Regex.IsMatch(panel, @"\b(301|501|701|901)\b"));
        if (!isX01) return null;

        var panel1 = infoPanels.ElementAtOrDefault(1) ?? string.Empty;
        var panel2 = infoPanels.ElementAtOrDefault(2) ?? string.Empty;
        var panel5 = infoPanels.ElementAtOrDefault(5) ?? string.Empty;

        if (startScore <= 0)
        {
            var startMatch = Regex.Match(panel1, @"\b(301|501|701|901)\b");
            startScore = startMatch.Success ? int.Parse(startMatch.Value, CultureInfo.InvariantCulture) : 501;
        }

        var (inMode, outMode) = ParseInOutModes(panel2);
        var bullMode = "standard";

        var roundsMatch = Regex.Match(panel5, @"\d+");
        var rounds = roundsMatch.Success && int.TryParse(roundsMatch.Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedRounds)
            ? parsedRounds
            : 15;

        return new X01RulesDto(
            startScore,
            inMode,
            outMode,
            bullMode,
            rounds,
            stacked == 1,
            infoPanels.Where(panel => !string.IsNullOrWhiteSpace(panel)).ToArray(),
            ParsePlayerIndices(idxLoc, nPlayers),
            ParsePlayerIndices(idxVis, nPlayers),
            string.IsNullOrWhiteSpace(eqLoc) ? null : eqLoc.Trim(),
            string.IsNullOrWhiteSpace(eqVis) ? null : eqVis.Trim());
    }

    private static IReadOnlyList<int>? ParsePlayerIndices(string? value, int nPlayers)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;

        var trimmed = value.Trim();
        List<int> indices;
        if (trimmed.Length > 1 && trimmed.All(char.IsDigit))
        {
            indices = trimmed.Select(character => character - '0').ToList();
        }
        else
        {
            indices = Regex.Matches(trimmed, @"\d+")
                .Select(match => int.Parse(match.Value, CultureInfo.InvariantCulture))
                .ToList();
        }

        var valid = indices
            .Where(index => index >= 0 && (nPlayers <= 0 || index < nPlayers))
            .Distinct()
            .ToList();
        return valid.Count > 0 ? valid : null;
    }

    private static (string InMode, string OutMode) ParseInOutModes(string panel)
    {
        var clean = (panel ?? string.Empty)
            .Replace('|', '/')
            .Replace('·', '/')
            .Replace('–', '/')
            .Replace('—', '/');

        var parts = clean.Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (parts.Length >= 2)
            return (ParseMode(parts[0]) ?? "open", ParseMode(parts[1]) ?? "double");
        if (parts.Length == 1)
            return ("open", ParseMode(parts[0]) ?? "double");
        return ("open", "double");
    }

    private static string? ParseMode(string value)
    {
        var text = (value ?? string.Empty).Trim().ToLowerInvariant();
        if (text.Length == 0) return null;
        if (text.Contains("master") || text.Contains("maestr")) return "master";
        if (text.Contains("triple")) return "triple";
        if (text.Contains("double") || text.Contains("doble")) return "double";
        if (text.Contains("open") || text.Contains("abierto") || text.Contains("abierta") || text.Contains("straight"))
            return "open";
        return null;
    }

    private static int CalculateDartScore(string hitRegion, int sector, int multiplier)
    {
        if (string.IsNullOrWhiteSpace(hitRegion) ||
            hitRegion.Contains("MISS", StringComparison.OrdinalIgnoreCase) ||
            hitRegion.Contains("BUST", StringComparison.OrdinalIgnoreCase))
            return 0;

        if (sector is 0 or 25)
            return multiplier >= 2 ? 50 : 25;

        if (sector is >= 1 and <= 20)
            return sector * Math.Max(1, multiplier);

        return 0;
    }

    private static int ExtractQueryInt(string query, string key)
    {
        var match = Regex.Match(query, $@"(?:^|&){Regex.Escape(key)}=(-?\d+)", RegexOptions.IgnoreCase);
        return match.Success && int.TryParse(match.Groups[1].Value, out var value) ? value : 0;
    }

    private static long ExtractQueryLong(string query, string key)
    {
        var match = Regex.Match(query, $@"(?:^|&){Regex.Escape(key)}=(-?\d+)", RegexOptions.IgnoreCase);
        return match.Success && long.TryParse(match.Groups[1].Value, out var value) ? value : 0;
    }

    public static IReadOnlyList<CompetitionSearchItemDto> ParseCompetitionSearch(string text)
    {
        var list = new List<CompetitionSearchItemDto>();
        foreach (var line in text.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var parts = line.Split('|');
            if (parts.Length < 3) continue;
            if (!int.TryParse(parts[2], out var id)) continue;
            var type = parts[1].Trim();
            var viewer = parts.Length > 3 && !string.IsNullOrWhiteSpace(parts[3]) ? parts[3].Trim() : null;
            list.Add(new CompetitionSearchItemDto(id, Clean(parts[0]), type, viewer));
        }

        return list;
    }

    public static string MapCompetitionType(string? typeLabel, string? hrefType)
    {
        var label = Clean(typeLabel).ToUpperInvariant();
        if (label.Contains("LIGA VIRTUAL")) return "LVIRT";
        if (label.Contains("LIGA")) return "LIGA";
        if (label.Contains("CAMPEONATO")) return "CAMP";
        if (label.Contains("TORNEO")) return "TORX";

        var href = Clean(hrefType).ToUpperInvariant();
        return href is "LIGA" or "CAMP" or "TORX" or "LVIRT" ? href : "TORX";
    }

    public static string MapCompetitionStatus(string? title) => Clean(title).ToUpperInvariant() switch
    {
        "EN CURSO" => "live",
        "POR COMENZAR" => "upcoming",
        "FINALIZADO" => "finished",
        _ => "unknown"
    };

    public static int StatusOrder(string status) => status switch
    {
        "live" => 0,
        "upcoming" => 1,
        "unknown" => 2,
        "finished" => 3,
        _ => 4
    };

    public static DateTime? ParseDate(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        return DateTime.TryParseExact(
            value.Trim(),
            new[] { "yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd HH:mm", "yyyy-MM-dd" },
            CultureInfo.InvariantCulture,
            DateTimeStyles.None,
            out var parsed)
            ? parsed
            : null;
    }

    private static string? GetString(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object &&
        element.TryGetProperty(name, out var value) &&
        value.ValueKind is JsonValueKind.String or JsonValueKind.Number
            ? value.ValueKind == JsonValueKind.String ? value.GetString() : value.ToString()
            : null;

    private static int GetInt(JsonElement element, string name, int fallback = 0)
    {
        var value = GetString(element, name);
        return int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) ? parsed : fallback;
    }

    private static double GetDouble(JsonElement element, string name, double fallback = 0)
    {
        if (element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value))
        {
            if (value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number)) return number;
            if (value.ValueKind == JsonValueKind.String &&
                double.TryParse(value.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out number))
                return number;
        }
        return fallback;
    }

    private static bool GetBool(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object &&
        element.TryGetProperty(name, out var value) &&
        value.ValueKind == JsonValueKind.True;

    private static int ParseInt(string? value) =>
        int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) ? parsed : 0;
}

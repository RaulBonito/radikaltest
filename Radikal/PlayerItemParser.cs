using System.Globalization;
using System.Text.RegularExpressions;

namespace RadikalPlayers.Radikal;

/// <summary>
/// Parser de "Mis Items" (items.php) del área de jugador.
///
/// Radikal genera una tabla HTML mal formada (omite &lt;tr&gt; entre items), así que en lugar de
/// recorrer el DOM se procesa el HTML en crudo: cada item termina en un
/// <c>&lt;input class="boton_item"&gt;</c> y todo su contenido (vídeo, título, tipo) está antes
/// de ese botón. Cada item es una personalización con vídeo MP4 de previsualización.
/// </summary>
public static partial class PlayerItemParser
{
    [GeneratedRegex(@"<input[^>]*class=""boton_item[^""]*""[^>]*>", RegexOptions.IgnoreCase)]
    private static partial Regex ButtonRegex();

    [GeneratedRegex(@"(?i)itemtypeid=""([A-Za-z]+)""")]
    private static partial Regex TypeAttrRegex();

    [GeneratedRegex(@"(?i)itemid=""(\d+)""")]
    private static partial Regex ItemIdAttrRegex();

    [GeneratedRegex(@"(?i)itemindex=""(\d+)""")]
    private static partial Regex ItemIndexAttrRegex();

    [GeneratedRegex(@"(?i)valor=""(\d+)""")]
    private static partial Regex ValorAttrRegex();

    [GeneratedRegex(@"(?i)userid=""([^""]+)""")]
    private static partial Regex UserIdAttrRegex();

    [GeneratedRegex(@"(?i)poster=""([^""]+)""")]
    private static partial Regex PosterRegex();

    [GeneratedRegex(@"(?i)<source[^>]*src=""([^""]+)""")]
    private static partial Regex VideoRegex();

    [GeneratedRegex(@"(?i)itemprop=""name""[^>]*>([^<]+)<")]
    private static partial Regex NameRegex();

    [GeneratedRegex(@"(?i)itemprop=""description""[^>]*>([^<]+)<")]
    private static partial Regex DescriptionRegex();

    [GeneratedRegex(@"(?i)title=""([^""]*caduca[^""]*)""")]
    private static partial Regex ExpiryRegex();

    [GeneratedRegex(@"(?i)href=""([^""]*product\.php\?product_id=\d+[^""]*)""")]
    private static partial Regex ProductRegex();

    [GeneratedRegex(@"(?i)productmedia_id=(\d+)")]
    private static partial Regex MediaIdRegex();

    public static PlayerItemsDto Parse(string html)
    {
        if (string.IsNullOrWhiteSpace(html))
            return new PlayerItemsDto(Array.Empty<PlayerItemDto>(), false, "Radikal no ha devuelto tus items.");

        var text = Regex.Replace(html, @"<[^>]+>", " ");
        if (text.Contains("Debes identificarte", StringComparison.OrdinalIgnoreCase) ||
            text.Contains("must sign in", StringComparison.OrdinalIgnoreCase))
        {
            return new PlayerItemsDto(Array.Empty<PlayerItemDto>(), true,
                "Inicia sesión con tu Radikal ID para ver tus items.");
        }

        var buttons = ButtonRegex().Matches(html);
        if (buttons.Count == 0)
        {
            return new PlayerItemsDto(Array.Empty<PlayerItemDto>(), false,
                "No tienes items comprados todavía. Puedes conseguirlos en la tienda.");
        }

        var items = new List<PlayerItemDto>(buttons.Count);
        var previousEnd = 0;

        foreach (Match button in buttons)
        {
            var chunk = html[previousEnd..button.Index];
            previousEnd = button.Index + button.Length;

            var type = TypeAttrRegex().Match(button.Value).Groups[1].Value.ToUpperInvariant();
            var itemId = ParseInt(ItemIdAttrRegex().Match(button.Value).Groups[1].Value);
            var itemIndex = ParseInt(ItemIndexAttrRegex().Match(button.Value).Groups[1].Value);
            var valor = ParseInt(ValorAttrRegex().Match(button.Value).Groups[1].Value);

            // "valor" invertido: 0 = activo (el botón dice "Desactivar").
            var active = valor == 0;

            var name = Clean(System.Net.WebUtility.HtmlDecode(NameRegex().Match(chunk).Groups[1].Value));
            if (string.IsNullOrWhiteSpace(name)) name = type;

            var description = Clean(System.Net.WebUtility.HtmlDecode(DescriptionRegex().Match(chunk).Groups[1].Value));
            var poster = PosterRegex().Match(chunk).Groups[1].Value;
            var video = VideoRegex().Match(chunk).Groups[1].Value;
            var expiry = Clean(System.Net.WebUtility.HtmlDecode(ExpiryRegex().Match(chunk).Groups[1].Value));
            var product = ProductRegex().Match(chunk).Groups[1].Value;

            var mediaId = MediaIdRegex().Match(string.IsNullOrWhiteSpace(poster) ? video : poster).Groups[1].Value;
            var hasMedia = !string.IsNullOrWhiteSpace(mediaId);

            items.Add(new PlayerItemDto(
                $"{type}:{itemId}:{itemIndex}",
                type,
                itemId,
                itemIndex,
                name,
                string.IsNullOrWhiteSpace(description) ? null : description,
                hasMedia ? $"/api/shop/media/{mediaId}/poster" : null,
                hasMedia && !string.IsNullOrWhiteSpace(video) ? $"/api/shop/media/{mediaId}/video" : null,
                active,
                string.IsNullOrWhiteSpace(expiry) ? null : expiry,
                string.IsNullOrWhiteSpace(product) ? null : product));
        }

        return new PlayerItemsDto(items, false, null);
    }

    private static int ParseInt(string value) =>
        int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) ? parsed : 0;

    private static string Clean(string? value) =>
        string.IsNullOrWhiteSpace(value) ? string.Empty : Regex.Replace(value, @"\s+", " ").Trim();
}

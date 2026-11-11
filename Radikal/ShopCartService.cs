using System.Collections.Concurrent;
using System.Globalization;
using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace RadikalPlayers.Radikal;

public sealed class ShopCartService
{
    private static readonly TimeSpan CartLifetime = TimeSpan.FromHours(6);
    private static readonly TimeSpan CleanupInterval = TimeSpan.FromMinutes(15);

    private readonly ConcurrentDictionary<string, CartSession> _sessions = new(StringComparer.Ordinal);
    private readonly RadikalClient _client;
    private readonly RadikalOptions _options;
    private readonly ILogger<ShopCartService> _logger;
    private DateTimeOffset _lastCleanup = DateTimeOffset.MinValue;

    public ShopCartService(
        RadikalClient client,
        IOptions<RadikalOptions> options,
        ILogger<ShopCartService> logger)
    {
        _client = client;
        _options = options.Value;
        _logger = logger;
    }

    public async Task<ShopCartDto> GetAsync(string sessionKey, bool refresh, CancellationToken ct)
    {
        var session = GetSession(sessionKey);
        await session.Gate.WaitAsync(ct);
        try
        {
            if (!refresh && session.Cart is not null)
                return session.Cart;

            session.Cart = await FetchCartAsync(session, ct);
            return session.Cart;
        }
        finally
        {
            session.Gate.Release();
        }
    }

    public async Task<ShopCartDto> AddAsync(string sessionKey, int productId, int quantity, CancellationToken ct)
    {
        quantity = Math.Clamp(quantity, 1, 20);
        var session = GetSession(sessionKey);
        await session.Gate.WaitAsync(ct);
        try
        {
            var product = await FindProductAsync(productId, ct)
                          ?? throw new ShopCartException("El producto ya no está disponible en la tienda de Radikal.");

            if (product.PriceGroup is null)
                throw new ShopCartException("No se pudo leer la configuración de compra de este producto.");

            if (product.PriceGroup.ApiManaged)
                throw new ShopCartException("Este producto necesita elegir una competición. Ábrelo en la tienda oficial para completar la inscripción.");

            await PostAddAsync(session, product.PriceGroup, quantity, ct);
            session.Cart = await FetchCartAsync(session, ct);
            return session.Cart;
        }
        finally
        {
            session.Gate.Release();
        }
    }

    public async Task<ShopCartDto> SetQuantityAsync(string sessionKey, long lineId, int quantity, CancellationToken ct)
    {
        var session = GetSession(sessionKey);
        await session.Gate.WaitAsync(ct);
        try
        {
            var current = session.Cart ?? await FetchCartAsync(session, ct);
            var line = current.Lines.FirstOrDefault(item => item.LineId == lineId)
                       ?? throw new ShopCartException("Ese producto ya no está en tu carrito.");

            if (quantity <= 0)
            {
                await PostDeleteAsync(session, lineId, ct);
            }
            else
            {
                quantity = Math.Clamp(quantity, 1, 20);
                var delta = quantity - line.Quantity;
                if (delta != 0)
                {
                    var priceGroup = line.PriceGroup;
                    if (priceGroup is null)
                    {
                        var product = await FindProductAsync(line.ProductId, ct);
                        priceGroup = product?.PriceGroup;
                    }

                    if (priceGroup is null)
                        throw new ShopCartException("No se pudo actualizar la cantidad de este producto.");

                    await PostAddAsync(session, priceGroup, delta, ct);
                }
            }

            session.Cart = await FetchCartAsync(session, ct);
            return session.Cart;
        }
        finally
        {
            session.Gate.Release();
        }
    }

    public async Task<ShopCartDto> RemoveAsync(string sessionKey, long lineId, CancellationToken ct)
    {
        var session = GetSession(sessionKey);
        await session.Gate.WaitAsync(ct);
        try
        {
            var current = session.Cart ?? await FetchCartAsync(session, ct);
            if (current.Lines.Any(line => line.LineId == lineId))
                await PostDeleteAsync(session, lineId, ct);

            session.Cart = await FetchCartAsync(session, ct);
            return session.Cart;
        }
        finally
        {
            session.Gate.Release();
        }
    }

    public async Task<ShopCartDto> ClearAsync(string sessionKey, CancellationToken ct)
    {
        var session = GetSession(sessionKey);
        await session.Gate.WaitAsync(ct);
        try
        {
            var current = session.Cart ?? await FetchCartAsync(session, ct);
            foreach (var line in current.Lines)
                await PostDeleteAsync(session, line.LineId, ct);

            session.Cart = await FetchCartAsync(session, ct);
            return session.Cart;
        }
        finally
        {
            session.Gate.Release();
        }
    }

    private async Task<ShopProductDto?> FindProductAsync(int productId, CancellationToken ct)
    {
        var shop = await _client.GetShopAsync(ct);
        return shop.Categories
            .SelectMany(category => category.Products)
            .FirstOrDefault(product => product.Id == productId);
    }

    private async Task<ShopCartDto> FetchCartAsync(CartSession session, CancellationToken ct)
    {
        try
        {
            using var http = CreateClient(session.Cookies);
            using var response = await http.GetAsync("shop/cart.php", ct);
            response.EnsureSuccessStatusCode();
            var html = await response.Content.ReadAsStringAsync(ct);
            return RadikalParsers.ParseShopCart(html);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex) when (ex is HttpRequestException or IOException)
        {
            _logger.LogDebug(ex, "No se pudo consultar el carrito de Radikal");
            throw new ShopCartException("No se pudo conectar con la tienda de Radikal. Inténtalo de nuevo en unos segundos.");
        }
    }

    private async Task PostAddAsync(CartSession session, ShopPriceGroupDto priceGroup, int quantity, CancellationToken ct)
    {
        var form = new Dictionary<string, string>
        {
            ["action"] = "add_product_to_cart",
            ["cartline_quantity"] = quantity.ToString(CultureInfo.InvariantCulture),
            ["productpricegroup_producttype_id"] = priceGroup.ProductTypeId.ToString(CultureInfo.InvariantCulture),
            ["productpricegroup_productsubtype_id"] = priceGroup.ProductSubTypeId.ToString(CultureInfo.InvariantCulture),
            ["productpricegroup_distributor_id"] = priceGroup.DistributorId,
            ["productpricegroup_product_id"] = priceGroup.ProductId.ToString(CultureInfo.InvariantCulture),
            ["productpricegroup_countrycode"] = priceGroup.CountryCode.ToString(CultureInfo.InvariantCulture),
            ["productpricegroup_productvattype_id"] = priceGroup.VatTypeId.ToString(CultureInfo.InvariantCulture),
            ["productpricegroup_id"] = priceGroup.PriceGroupId.ToString(CultureInfo.InvariantCulture),
            ["productapimanaged"] = priceGroup.ApiManaged ? "1" : "0",
            ["productcompetition_id"] = "0"
        };

        var body = await PostCartFormAsync(session, form, ct);
        EnsureCartResult(body, "Radikal no ha podido añadir el producto al carrito.");
    }

    private async Task PostDeleteAsync(CartSession session, long lineId, CancellationToken ct)
    {
        var body = await PostCartFormAsync(session, new Dictionary<string, string>
        {
            ["action"] = "delete_product_from_cart",
            ["cartline_id"] = lineId.ToString(CultureInfo.InvariantCulture)
        }, ct);

        EnsureCartResult(body, "Radikal no ha podido quitar el producto del carrito.");
    }

    private async Task<string> PostCartFormAsync(CartSession session, Dictionary<string, string> form, CancellationToken ct)
    {
        try
        {
            using var http = CreateClient(session.Cookies);
            using var content = new FormUrlEncodedContent(form);
            using var request = new HttpRequestMessage(HttpMethod.Post, "shop/ajax.cart.php") { Content = content };
            request.Headers.TryAddWithoutValidation("X-Requested-With", "XMLHttpRequest");
            request.Headers.Referrer = new Uri("https://esp.radikalplayers.com/shop/");
            request.Headers.Accept.ParseAdd("application/json, text/javascript, */*; q=0.01");

            using var response = await http.SendAsync(request, ct);
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadAsStringAsync(ct);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex) when (ex is HttpRequestException or IOException)
        {
            _logger.LogDebug(ex, "No se pudo actualizar el carrito de Radikal");
            throw new ShopCartException("No se pudo conectar con la tienda de Radikal. Inténtalo de nuevo en unos segundos.");
        }
    }

    private static void EnsureCartResult(string body, string fallbackMessage)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            var result = root.TryGetProperty("result", out var resultElement) ? resultElement.GetString() : null;
            if (string.Equals(result, "OK", StringComparison.OrdinalIgnoreCase))
                return;

            var message = root.TryGetProperty("error_msg", out var errorElement) ? errorElement.GetString() : null;
            throw new ShopCartException(string.IsNullOrWhiteSpace(message) ? fallbackMessage : message);
        }
        catch (JsonException)
        {
            throw new ShopCartException(fallbackMessage);
        }
    }

    private CartSession GetSession(string sessionKey)
    {
        if (string.IsNullOrWhiteSpace(sessionKey))
            throw new ShopCartException("No se pudo identificar tu carrito. Recarga la página e inténtalo de nuevo.");

        var session = _sessions.GetOrAdd(sessionKey, _ => new CartSession());
        session.LastSeen = DateTimeOffset.UtcNow;
        CleanupSessions();
        return session;
    }

    private void CleanupSessions()
    {
        var now = DateTimeOffset.UtcNow;
        if (now - _lastCleanup < CleanupInterval) return;
        _lastCleanup = now;

        foreach (var pair in _sessions)
        {
            if (now - pair.Value.LastSeen <= CartLifetime) continue;
            if (_sessions.TryRemove(pair.Key, out var removed))
                _logger.LogDebug("Carrito temporal {CartKey} eliminado por inactividad", pair.Key[..Math.Min(8, pair.Key.Length)]);
        }
    }

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
        http.DefaultRequestHeaders.Referrer = new Uri("https://esp.radikalplayers.com/shop/");
        return http;
    }

    private sealed class CartSession
    {
        public CookieContainer Cookies { get; } = new();
        public SemaphoreSlim Gate { get; } = new(1, 1);
        public ShopCartDto? Cart { get; set; }
        public DateTimeOffset LastSeen { get; set; } = DateTimeOffset.UtcNow;
    }
}

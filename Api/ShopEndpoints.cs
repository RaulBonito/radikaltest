using RadikalPlayers.Radikal;

namespace RadikalPlayers.Api;

public static class ShopEndpoints
{
    public static IEndpointRouteBuilder MapShopCartApi(this IEndpointRouteBuilder app)
    {
        var shop = app.MapGroup("/api/shop");

        shop.MapGet("", async (RadikalClient client, CancellationToken ct) =>
            Results.Ok(await client.GetShopAsync(ct)));

        shop.MapGet("/products/{id:int}", async (
            int id,
            string? category,
            RadikalClient client,
            CancellationToken ct) =>
            Results.Ok(await client.GetShopProductAsync(id, category, ct)));

        // Vídeo oficial del producto. Se descarga completo y es ASP.NET quien gestiona los
        // rangos: si le reenviamos el Range a Radikal, la respuesta llega ya troceada y el
        // Content-Range saldría incorrecto (el navegador no podría cargar el vídeo).
        shop.MapGet("/media/{mediaId:int}/video", async (
            int mediaId,
            HttpContext context,
            RadikalClient client,
            CancellationToken ct) =>
        {
            using var response = await client.GetShopMediaVideoAsync(mediaId, null, ct);
            if (!response.IsSuccessStatusCode)
                return Results.NotFound();

            var contentType = response.Content.Headers.ContentType?.MediaType ?? "video/mp4";
            var bytes = await response.Content.ReadAsByteArrayAsync(ct);

            context.Response.Headers.CacheControl = "public,max-age=86400";

            // Los MP4 de Radikal llevan el índice (moov) al final del archivo. Con peticiones
            // parciales el navegador se queda sin metadatos y no arranca, así que aquí no
            // anunciamos soporte de rangos: se entrega el archivo completo y el reproductor
            // puede reproducirlo o adelantarlo ya sobre datos locales.
            return Results.File(bytes, contentType, enableRangeProcessing: false);
        });

        shop.MapGet("/media/{mediaId:int}/poster", async (
            int mediaId,
            IHttpClientFactory factory,
            HttpContext context,
            CancellationToken ct) =>
        {
            using var response = await factory.CreateClient("radikal-esp")
                .GetAsync($"shop/mediapreview.php?productmedia_id={mediaId}", ct);
            if (!response.IsSuccessStatusCode)
                return Results.NotFound();

            var bytes = await response.Content.ReadAsByteArrayAsync(ct);
            context.Response.Headers.CacheControl = "public,max-age=86400";
            return Results.File(bytes, response.Content.Headers.ContentType?.MediaType ?? "image/jpeg");
        });

        shop.MapGet("/cart", async (
            bool? refresh,
            ShopCartService service,
            HttpContext context,
            CancellationToken ct) =>
        {
            return await ExecuteAsync(() => service.GetAsync(GetCartSessionKey(context), refresh ?? false, ct));
        });

        shop.MapPost("/cart/items", async (
            ShopCartAddRequest request,
            ShopCartService service,
            HttpContext context,
            CancellationToken ct) =>
        {
            return await ExecuteAsync(() => service.AddAsync(GetCartSessionKey(context), request.ProductId, request.Quantity, ct));
        });

        shop.MapPatch("/cart/items/{lineId:long}", async (
            long lineId,
            ShopCartQuantityRequest request,
            ShopCartService service,
            HttpContext context,
            CancellationToken ct) =>
        {
            return await ExecuteAsync(() => service.SetQuantityAsync(GetCartSessionKey(context), lineId, request.Quantity, ct));
        });

        shop.MapDelete("/cart/items/{lineId:long}", async (
            long lineId,
            ShopCartService service,
            HttpContext context,
            CancellationToken ct) =>
        {
            return await ExecuteAsync(() => service.RemoveAsync(GetCartSessionKey(context), lineId, ct));
        });

        shop.MapPost("/cart/clear", async (
            ShopCartService service,
            HttpContext context,
            CancellationToken ct) =>
        {
            return await ExecuteAsync(() => service.ClearAsync(GetCartSessionKey(context), ct));
        });

        return app;
    }

    private static string GetCartSessionKey(HttpContext context)
    {
        // ASP.NET Core no envía la cookie de sesión hasta que la sesión tiene contenido.
        // Guardamos una marca mínima para que el carrito sobreviva entre peticiones.
        if (context.Session.GetInt32("radikal.cart") is null)
            context.Session.SetInt32("radikal.cart", 1);

        return context.Session.Id;
    }

    private static async Task<IResult> ExecuteAsync(Func<Task<ShopCartDto>> action)
    {
        try
        {
            return Results.Ok(await action());
        }
        catch (ShopCartException ex)
        {
            return Results.Json(new
            {
                title = "No se pudo actualizar el carrito",
                detail = ex.Message,
                status = StatusCodes.Status400BadRequest
            }, statusCode: StatusCodes.Status400BadRequest);
        }
    }
}

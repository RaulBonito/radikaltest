using Microsoft.Extensions.Configuration;
using RadikalPlayers.Radikal;

namespace RadikalPlayers.Api;

/// <summary>
/// Recursos de marca de la web oficial (vídeos de cabecera, imágenes de campaña).
/// Se descargan una vez y se cachean en disco para servirlos rápido y sin depender de Radikal.
/// </summary>
public static class MediaEndpoints
{
    private static readonly Dictionary<string, string> AllowedAssets = new(StringComparer.OrdinalIgnoreCase)
    {
        ["premium"] = "userfiles/banner_premium_web.mp4",
        ["premium-top"] = "userfiles/banner_top_premium_en.mp4",
        ["carousel"] = "userfiles/carousel2.jpg"
    };

    public static IEndpointRouteBuilder MapMediaApi(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/media/brand/{name}", async (
            string name,
            IWebHostEnvironment environment,
            IConfiguration configuration,
            IHttpClientFactory factory,
            HttpContext context,
            CancellationToken ct) =>
        {
            if (!AllowedAssets.TryGetValue(name, out var path))
                return Results.NotFound();

            var cacheDirectory = Path.Combine(AppDataPaths.Resolve(environment, configuration), "media");
            Directory.CreateDirectory(cacheDirectory);
            var fileName = Path.GetFileName(path);
            var cachePath = Path.Combine(cacheDirectory, fileName);

            if (!File.Exists(cachePath))
            {
                using var response = await factory.CreateClient("radikal-www")
                    .GetAsync(path, HttpCompletionOption.ResponseHeadersRead, ct);
                if (!response.IsSuccessStatusCode)
                    return Results.NotFound();

                await using var source = await response.Content.ReadAsStreamAsync(ct);
                await using var target = File.Create(cachePath);
                await source.CopyToAsync(target, ct);
            }

            var contentType = fileName.EndsWith(".mp4", StringComparison.OrdinalIgnoreCase)
                ? "video/mp4"
                : "image/jpeg";

            context.Response.Headers.CacheControl = "public,max-age=604800";

            // Results.File con processing de rangos permite streaming/seeking del MP4.
            return Results.File(cachePath, contentType, enableRangeProcessing: true);
        });

        return app;
    }
}

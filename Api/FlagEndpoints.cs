using Microsoft.Extensions.Configuration;
using RadikalPlayers.Radikal;

namespace RadikalPlayers.Api;

/// <summary>
/// Banderas de país como imágenes. Windows no dibuja los emoji de bandera, así que servimos
/// PNG desde nuestro dominio, con caché en disco para no depender de terceros en cada carga.
/// </summary>
public static class FlagEndpoints
{

    public static IEndpointRouteBuilder MapFlagApi(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/flags/{iso}", async (
            string iso,
            IWebHostEnvironment environment,
            IConfiguration configuration,
            IHttpClientFactory factory,
            HttpContext context,
            CancellationToken ct) =>
        {
            var code = (iso ?? string.Empty).Trim().ToLowerInvariant();
            // Cualquier código ISO alfa-2 válido; el CDN devuelve 404 si no existe la bandera.
            if (code.Length != 2 || !code.All(char.IsAsciiLetterLower))
                return Results.NotFound();

            var cacheDirectory = Path.Combine(AppDataPaths.Resolve(environment, configuration), "flags");
            Directory.CreateDirectory(cacheDirectory);
            var cachePath = Path.Combine(cacheDirectory, $"{code}.png");

            if (!File.Exists(cachePath))
            {
                try
                {
                    using var response = await factory.CreateClient("flags")
                        .GetAsync($"{code}.png", HttpCompletionOption.ResponseHeadersRead, ct);
                    if (!response.IsSuccessStatusCode)
                        return Results.NotFound();

                    await using var source = await response.Content.ReadAsStreamAsync(ct);
                    await using var target = File.Create(cachePath);
                    await source.CopyToAsync(target, ct);
                }
                catch (Exception ex) when (ex is HttpRequestException or IOException)
                {
                    return Results.NotFound();
                }
            }

            context.Response.Headers.CacheControl = "public,max-age=2592000";
            return Results.File(cachePath, "image/png");
        });

        return app;
    }
}

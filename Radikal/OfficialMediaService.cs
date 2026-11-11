using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Processing;
using Microsoft.Extensions.Configuration;

namespace RadikalPlayers.Radikal;

/// <summary>
/// Imágenes de los Official Players: descarga, caché en disco, miniaturas y detección de
/// dimensiones (para distinguir el retrato del jugador de su ficha técnica apaisada).
/// </summary>
public sealed class OfficialMediaService
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<OfficialMediaService> _logger;
    private readonly string _directory;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly Dictionary<long, (int Width, int Height)> _sizes = new();

    public OfficialMediaService(
        IHttpClientFactory httpClientFactory,
        IHostEnvironment environment,
        IConfiguration configuration,
        ILogger<OfficialMediaService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
        _directory = Path.Combine(AppDataPaths.Resolve(environment, configuration), "official-media");
        Directory.CreateDirectory(_directory);
    }

    public string OriginalPath(long id) => Path.Combine(_directory, $"{id}.img");

    public string ThumbPath(long id, int width) => Path.Combine(_directory, $"{id}-{width}.jpg");

    /// <summary>Descarga la imagen original si no está en disco. Devuelve false si no existe en Radikal.</summary>
    public async Task<bool> EnsureAsync(long id, CancellationToken ct)
    {
        var path = OriginalPath(id);
        if (File.Exists(path)) return true;

        try
        {
            var http = _httpClientFactory.CreateClient("radikal-esp");
            using var response = await http.GetAsync(
                $"officialplayers/officialplayermedia.php?officialplayermedia_id={id}", ct);
            if (!response.IsSuccessStatusCode) return false;

            var bytes = await response.Content.ReadAsByteArrayAsync(ct);
            var temp = $"{path}.tmp";
            await File.WriteAllBytesAsync(temp, bytes, ct);
            File.Move(temp, path, true);
            return true;
        }
        catch (Exception ex) when (ex is HttpRequestException or IOException)
        {
            _logger.LogDebug(ex, "No se pudo descargar la imagen oficial {MediaId}", id);
            return false;
        }
    }

    /// <summary>Tamaño de la imagen (cacheado en memoria). 0x0 si no se puede leer.</summary>
    public async Task<(int Width, int Height)> GetSizeAsync(long id, CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            if (_sizes.TryGetValue(id, out var cached)) return cached;

            if (!await EnsureAsync(id, ct)) return (0, 0);

            var info = await Image.IdentifyAsync(OriginalPath(id), ct);
            var size = info is null ? (0, 0) : (info.Width, info.Height);
            _sizes[id] = size;
            return size;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogDebug(ex, "No se pudo leer el tamaño de la imagen oficial {MediaId}", id);
            return (0, 0);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>Genera (y cachea) una miniatura del ancho indicado.</summary>
    public async Task<string?> EnsureThumbAsync(long id, int width, CancellationToken ct)
    {
        var thumb = ThumbPath(id, width);
        if (File.Exists(thumb)) return thumb;
        if (!await EnsureAsync(id, ct)) return null;

        try
        {
            using var image = await Image.LoadAsync(OriginalPath(id), ct);
            if (image.Width > width)
            {
                var height = (int)Math.Round(image.Height * (width / (double)image.Width));
                image.Mutate(x => x.Resize(width, height));
            }

            var temp = $"{thumb}.tmp";
            await image.SaveAsJpegAsync(temp, new SixLabors.ImageSharp.Formats.Jpeg.JpegEncoder { Quality = 82 }, ct);
            File.Move(temp, thumb, true);
            return thumb;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogDebug(ex, "No se pudo generar la miniatura {MediaId}", id);
            return null;
        }
    }
}

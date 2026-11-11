namespace RadikalPlayers.Radikal;

public sealed class CacheWarmupService : BackgroundService
{
    private readonly RadikalClient _client;
    private readonly PlayerDirectoryService _directory;
    private readonly ILogger<CacheWarmupService> _logger;

    public CacheWarmupService(
        RadikalClient client,
        PlayerDirectoryService directory,
        ILogger<CacheWarmupService> logger)
    {
        _client = client;
        _directory = directory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);

        await WarmAsync("ranking", async () =>
            await _client.GetRankingAsync("724", null, "MPR", "aa", "0", stoppingToken), stoppingToken);

        await WarmAsync("provincias", async () =>
            await _client.GetProvincesAsync("724", stoppingToken), stoppingToken);

        await Task.WhenAll(
            WarmAsync("catálogo", async () =>
                await _client.GetCompetitionCatalogAsync("724", "0", "0", "0", "0", "0", 0, 0, 0, stoppingToken), stoppingToken),
            WarmAsync("top places", async () =>
                await _client.GetTopPlacesAsync(stoppingToken), stoppingToken),
            WarmAsync("noticias", async () =>
                await _client.GetNewsAsync(1, 9, stoppingToken), stoppingToken),
            WarmAsync("official players", async () =>
                await _client.GetOfficialPlayersAsync(stoppingToken), stoppingToken),
            WarmAsync("en directo", async () =>
                await _client.GetLiveAsync(stoppingToken), stoppingToken));

        await WarmAsync("mapa de dianas", async () =>
            await _client.GetDianasAsync(stoppingToken), stoppingToken);

        await WarmAsync("directorio de jugadores", async () =>
            await _directory.GetIndexAsync(stoppingToken), stoppingToken);
    }

    private async Task WarmAsync(string name, Func<Task> action, CancellationToken stoppingToken)
    {
        try
        {
            var started = DateTimeOffset.UtcNow;
            await action();
            _logger.LogInformation("Caché caliente: {Name} ({Ms} ms)", name, (DateTimeOffset.UtcNow - started).TotalMilliseconds);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "No se pudo precalentar la caché de {Name}", name);
        }
    }
}

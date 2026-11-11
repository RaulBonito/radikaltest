namespace RadikalPlayers.Radikal;

/// <summary>
/// Graba las partidas del directo a nivel de datos: cada 6 segundos recorre las partidas
/// retransmitidas y guarda cada dardo nuevo (ronda, jugador, número de dardo, zona, sector,
/// multiplicador y puntos) en <see cref="LiveRecordingStore"/>.
/// El visor de la app sigue pidiendo los dardos al API, pero es este servicio quien alimenta
/// la grabación para que el histórico completo exista aunque nadie tenga la pestaña abierta.
/// </summary>
public sealed class LiveRecordingService : BackgroundService
{
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(6);
    private static readonly TimeSpan IdleInterval = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan MaxMatchAge = TimeSpan.FromHours(6);

    private readonly RadikalClient _client;
    private readonly LiveRecordingStore _store;
    private readonly ILogger<LiveRecordingService> _logger;

    public LiveRecordingService(RadikalClient client, LiveRecordingStore store, ILogger<LiveRecordingService> logger)
    {
        _client = client;
        _store = store;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(TimeSpan.FromSeconds(4), stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            var delay = IdleInterval;
            try
            {
                delay = await CaptureAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "No se pudo grabar el directo de Radikal");
                delay = IdleInterval;
            }

            try
            {
                await Task.Delay(delay, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    /// <summary>Lanza un sondeo inmediato sin esperar al ciclo automático (lo usa la API).</summary>
    public async Task<RecordedRecordingDto?> PollNowAsync(
        LiveMatchDto match,
        CancellationToken ct = default)
    {
        try
        {
            var darts = await _client.GetLiveDartsAsync(match.CompetitionId, match.MatchId, match.Game, ct);
            await _store.UpsertAsync(match, darts, ct);
            return await _store.GetAsync(match.CompetitionId, match.MatchId, match.Game, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogDebug(ex, "Sondeo manual fallido para {MatchId}", match.MatchId);
            return null;
        }
    }

    private async Task<TimeSpan> CaptureAsync(CancellationToken ct)
    {
        var activity = await _client.GetLiveAsync(ct);
        var matches = new List<LiveMatchDto>();

        if (activity.IsLive)
        {
            try
            {
                var list = await _client.GetLiveMatchesAsync(ct);
                matches.AddRange(list.Matches);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "No se pudieron listar las partidas en directo");
            }
        }

        if (matches.Count > 0)
        {
            await Task.WhenAll(matches.Select(match => CaptureMatchAsync(match, ct)));
            return PollInterval;
        }

        // Radikal puede tener partidas abiertas aunque aún no marque la competición como "en directo":
        // revisamos solo las grabaciones recientes para no quedarnos sin capturar el final.
        var recent = await _store.GetActiveAsync(MaxMatchAge, ct);
        if (recent.Count > 0)
        {
            await Task.WhenAll(recent.Select(item => CaptureMatchAsync(
                new LiveMatchDto(item.CompetitionId, item.MatchId, item.Game, item.Title, string.Empty),
                ct)));
            return PollInterval;
        }

        return IdleInterval;
    }

    private async Task CaptureMatchAsync(LiveMatchDto match, CancellationToken ct)
    {
        try
        {
            var darts = await _client.GetLiveDartsAsync(match.CompetitionId, match.MatchId, match.Game, ct);
            if (darts.Darts.Count == 0 && !darts.IsFinished)
                return;

            await _store.UpsertAsync(match, darts, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "No se pudo grabar la partida {MatchId} (juego {Game})", match.MatchId, match.Game);
        }
    }
}

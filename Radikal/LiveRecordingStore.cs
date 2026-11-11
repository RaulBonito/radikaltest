using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Configuration;

namespace RadikalPlayers.Radikal;

public sealed class LiveRecordingStore
{
    private const int MaxRecordings = 500;
    private const int MockCompetitionId = 900001;
    private const long MockMatchId = 900001;
    private const int MockGame = 1;

    private readonly string _filePath;
    private readonly ILogger<LiveRecordingStore> _logger;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly Dictionary<string, StoredRecording> _recordings = new(StringComparer.Ordinal);
    private readonly Dictionary<string, DateTimeOffset> _lastSync = new(StringComparer.Ordinal);
    private readonly JsonSerializerOptions _jsonOptions = new() { WriteIndented = true };

    public LiveRecordingStore(IHostEnvironment environment, IConfiguration configuration, ILogger<LiveRecordingStore> logger)
    {
        _logger = logger;
        var dataDirectory = AppDataPaths.Resolve(environment, configuration);
        Directory.CreateDirectory(dataDirectory);
        _filePath = Path.Combine(dataDirectory, "live-recordings.json");
        Load();
    }

    /// <summary>Momento del último sondeo real que ha encontrado dardos nuevos para cada grabación.</summary>
    public DateTimeOffset? GetLastSync(int competitionId, long matchId, int game)
    {
        lock (_lastSync)
        {
            return _lastSync.TryGetValue(Key(competitionId, matchId, game), out var value) ? value : null;
        }
    }

    public async Task<IReadOnlyList<RecordedRecordingSummaryDto>> GetAllAsync(CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try
        {
            return _recordings.Values
                .Where(recording => recording.IsMock || recording.Darts.Count > 0)
                .OrderByDescending(recording => recording.IsMock)
                .ThenByDescending(recording => recording.LastUpdatedAt)
                .Select(ToSummary)
                .ToList();
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<RecordedRecordingDto?> GetAsync(
        int competitionId,
        long matchId,
        int game,
        CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try
        {
            return _recordings.TryGetValue(Key(competitionId, matchId, game), out var recording)
                ? ToDto(recording)
                : null;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<IReadOnlyList<RecordedRecordingSummaryDto>> GetActiveAsync(
        TimeSpan maxAge,
        CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try
        {
            var threshold = DateTimeOffset.UtcNow - maxAge;
            return _recordings.Values
                .Where(recording => !recording.IsMock && !recording.IsFinished && recording.LastUpdatedAt >= threshold)
                .OrderByDescending(recording => recording.LastUpdatedAt)
                .Select(ToSummary)
                .ToList();
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<RecordedRecordingSummaryDto?> UpsertAsync(
        LiveMatchDto match,
        LiveDartsDto darts,
        CancellationToken ct = default)
    {
        var now = DateTimeOffset.UtcNow;
        await _gate.WaitAsync(ct);
        try
        {
            var key = Key(match.CompetitionId, match.MatchId, match.Game);

            if (!_recordings.TryGetValue(key, out var recording))
            {
                // No guardamos actas de partidas ya terminadas de las que no llegamos a capturar ningún dardo.
                if (darts.IsFinished && darts.Darts.Count == 0)
                    return null;

                recording = new StoredRecording
                {
                    CompetitionId = match.CompetitionId,
                    MatchId = match.MatchId,
                    Game = match.Game,
                    Title = CleanTitle(match.Title) ?? DefaultTitle(match.MatchId, match.Game),
                    GameType = darts.GameType,
                    IsTeam = darts.IsTeam,
                    X01Rules = darts.X01Rules,
                    FirstSeenAt = now,
                    LastUpdatedAt = now
                };
                _recordings[key] = recording;
                _logger.LogInformation(
                    "Grabación iniciada: {Title} ({CompetitionId}/{MatchId}/{Game})",
                    recording.Title, recording.CompetitionId, recording.MatchId, recording.Game);
            }

            var changed = false;
            var seenDarts = recording.Darts
                .Select(dart => (dart.Round, dart.PlayerIndex, dart.Dart))
                .ToHashSet();

            foreach (var dart in darts.Darts)
            {
                if (!seenDarts.Add((dart.Round, dart.PlayerIndex, dart.Dart)))
                {
                    // Partidas antiguas: si Radikal ya nos da el ID del jugador, lo rellenamos
                    // para poder resolver su ficha y su foto aunque el dardo estuviera guardado.
                    if (!string.IsNullOrWhiteSpace(dart.PlayerId))
                    {
                        var existingIndex = recording.Darts.FindIndex(stored =>
                            stored.Round == dart.Round &&
                            stored.PlayerIndex == dart.PlayerIndex &&
                            stored.Dart == dart.Dart);

                        if (existingIndex >= 0 && string.IsNullOrWhiteSpace(recording.Darts[existingIndex].PlayerId))
                        {
                            recording.Darts[existingIndex] = recording.Darts[existingIndex] with { PlayerId = dart.PlayerId };
                            changed = true;
                        }
                    }
                    continue;
                }

                recording.Darts.Add(new RecordedDartDto(
                    match.Game,
                    dart.Round,
                    dart.PlayerIndex,
                    string.IsNullOrWhiteSpace(dart.PlayerName)
                        ? $"Jugador {dart.PlayerIndex + 1}"
                        : dart.PlayerName,
                    dart.PlayerId,
                    dart.Dart,
                    dart.HitRegion,
                    dart.Multiplier,
                    dart.Sector,
                    dart.Score,
                    now,
                    dart.Bust,
                    dart.Frozen));
                changed = true;
            }

            if (!string.IsNullOrWhiteSpace(darts.GameType) &&
                !string.Equals(recording.GameType, darts.GameType, StringComparison.Ordinal))
            {
                recording.GameType = darts.GameType;
                changed = true;
            }

            if (darts.IsTeam is not null && recording.IsTeam != darts.IsTeam)
            {
                recording.IsTeam = darts.IsTeam;
                changed = true;
            }

            if (darts.X01Rules is not null && !RulesEqual(recording.X01Rules, darts.X01Rules))
            {
                recording.X01Rules = darts.X01Rules;
                changed = true;
            }

            var title = CleanTitle(match.Title);
            if (title is not null && !string.Equals(recording.Title, title, StringComparison.Ordinal))
            {
                recording.Title = title;
                changed = true;
            }

            if (darts.IsFinished && !recording.IsFinished)
            {
                recording.IsFinished = true;
                recording.Winner = ResolveWinner(recording, darts.Winner);
                changed = true;
                _logger.LogInformation(
                    "Grabación finalizada: {Title} ({Darts} dardos)",
                    recording.Title, recording.Darts.Count);
            }
            else if (darts.IsFinished && recording.Winner is null && !string.IsNullOrWhiteSpace(darts.Winner))
            {
                recording.Winner = ResolveWinner(recording, darts.Winner);
                changed = true;
            }

            if (recording.IsFinished && recording.Darts.Count == 0)
            {
                _recordings.Remove(key);
                changed = true;
                return null;
            }

            if (changed)
            {
                recording.LastUpdatedAt = now;
                TrimRecordings();
                SaveNoLock();
                MarkSynced(key, now);
            }

            return ToSummary(recording);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<bool> DeleteAsync(int competitionId, long matchId, int game, CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try
        {
            var key = Key(competitionId, matchId, game);
            if (!_recordings.Remove(key))
                return false;

            lock (_lastSync)
            {
                _lastSync.Remove(key);
            }

            SaveNoLock();
            return true;
        }
        finally
        {
            _gate.Release();
        }
    }

    private void MarkSynced(string key, DateTimeOffset at)
    {
        lock (_lastSync)
        {
            _lastSync[key] = at;
        }
    }

    private void Load()
    {
        try
        {
            if (File.Exists(_filePath))
            {
                var json = File.ReadAllText(_filePath, Encoding.UTF8);
                var stored = JsonSerializer.Deserialize<List<StoredRecording>>(json, _jsonOptions);
                if (stored is not null)
                {
                    foreach (var recording in stored)
                    {
                        if (recording.CompetitionId <= 0 || recording.MatchId <= 0 || recording.Game <= 0)
                            continue;
                        recording.X01Rules ??= DefaultX01Rules(recording);
                        _recordings[Key(recording.CompetitionId, recording.MatchId, recording.Game)] = recording;
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "No se pudo leer el archivo de grabaciones; se creará uno nuevo");
            TryBackupCorruptFile();
        }

        var mocks = new List<StoredRecording>
        {
            BuildMock(),
            BuildCricketMock(2, false),
            BuildCricketMock(3, true),
            BuildTeamX01Mock(4)
        };
        mocks.AddRange(BuildSimulatedDuoMatch());
        var changed = false;
        foreach (var mock in mocks)
        {
            var key = Key(mock.CompetitionId, mock.MatchId, mock.Game);
            if (_recordings.TryGetValue(key, out var existing) && !existing.IsMock)
                continue;

            _recordings[key] = mock;
            changed = true;
        }

        if (changed) SaveNoLock();
    }

    private void TryBackupCorruptFile()
    {
        try
        {
            if (!File.Exists(_filePath)) return;
            var backup = $"{_filePath}.corrupt-{DateTimeOffset.UtcNow:yyyyMMddHHmmss}";
            File.Move(_filePath, backup, true);
        }
        catch
        {
            // best effort
        }
    }

    private void TrimRecordings()
    {
        if (_recordings.Count <= MaxRecordings) return;

        var removable = _recordings.Values
            .Where(recording => !recording.IsMock && recording.IsFinished)
            .OrderBy(recording => recording.LastUpdatedAt)
            .Take(_recordings.Count - MaxRecordings)
            .Select(recording => Key(recording.CompetitionId, recording.MatchId, recording.Game))
            .ToList();

        foreach (var key in removable)
            _recordings.Remove(key);
    }

    private void SaveNoLock()
    {
        try
        {
            var temp = $"{_filePath}.tmp";
            var json = JsonSerializer.Serialize(
                _recordings.Values
                    .OrderBy(recording => recording.FirstSeenAt)
                    .ToList(),
                _jsonOptions);
            File.WriteAllText(temp, json, new UTF8Encoding(false));
            File.Move(temp, _filePath, true);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "No se pudo guardar el archivo de grabaciones");
        }
    }

    /// <summary>
    /// Radikal devuelve el ganador con el nombre del jugador. Si coincide con otro jugador del
    /// acta (por ejemplo, el nombre de la máquina), buscamos el alias que realmente lanzó los dardos.
    /// </summary>
    private static string? ResolveWinner(StoredRecording recording, string? winner)
    {
        if (string.IsNullOrWhiteSpace(winner))
            return null;

        var value = winner.Trim();
        var dartNames = recording.Darts
            .Select(dart => dart.PlayerName)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var exact = dartNames.FirstOrDefault(name => string.Equals(name, value, StringComparison.OrdinalIgnoreCase));
        return exact ?? value;
    }

    private static string? CleanTitle(string? title)
    {
        if (string.IsNullOrWhiteSpace(title))
            return null;

        var value = title.Trim();
        if (value.StartsWith("Partida #", StringComparison.OrdinalIgnoreCase))
            return null;
        if (value.Equals("Partida en directo", StringComparison.OrdinalIgnoreCase))
            return null;
        if (value.Length > 120)
            value = value[..120];
        return value;
    }

    private static string DefaultTitle(long matchId, int game) => $"Partida #{matchId} · juego {game}";

    private static RecordedRecordingSummaryDto ToSummary(StoredRecording recording)
    {
        var players = PlayerNames(recording);
        var turns = recording.Darts
            .GroupBy(dart => (dart.Round, dart.PlayerIndex))
            .Count();

        return new RecordedRecordingSummaryDto(
            recording.CompetitionId,
            recording.MatchId,
            recording.Game,
            recording.Title,
            recording.IsMock,
            recording.IsFinished,
            recording.Winner,
            recording.GameType,
            recording.IsTeam,
            recording.Darts.Count,
            turns,
            players.Count,
            players,
            recording.FirstSeenAt,
            recording.LastUpdatedAt,
            BuildPreview(recording),
            recording.X01Rules);
    }

    /// <summary>
    /// Muestreo de dardos para la miniatura de la tarjeta: como mucho 120 impactos, conservando
    /// el final de la partida, que es lo que más interesa reconocer de un vistazo.
    /// </summary>
    private static List<RecordedDartViewDto> BuildPreview(StoredRecording recording)
    {
        const int maxPreview = 120;

        var ordered = recording.Darts
            .OrderBy(dart => dart.Round)
            .ThenBy(dart => dart.PlayerIndex)
            .ThenBy(dart => dart.Dart)
            .ToList();

        var step = Math.Max(1, (int)Math.Ceiling(ordered.Count / (double)maxPreview));
        var selected = new List<RecordedDartDto>(Math.Min(ordered.Count, maxPreview));

        for (var index = 0; index < ordered.Count && selected.Count < maxPreview; index += step)
            selected.Add(ordered[index]);

        if (selected.Count < maxPreview && ordered.Count > 0 && !selected.Contains(ordered[^1]))
            selected.Add(ordered[^1]);

        return selected
            .OrderBy(dart => dart.Round)
            .ThenBy(dart => dart.PlayerIndex)
            .ThenBy(dart => dart.Dart)
            .Select((dart, index) => new RecordedDartViewDto(
                index,
                dart.Game,
                dart.Round,
                dart.PlayerIndex,
                dart.PlayerName,
                dart.PlayerId,
                dart.Dart,
                dart.HitRegion,
                dart.Multiplier,
                dart.Sector,
                dart.Score,
                dart.CapturedAt,
                dart.Bust,
                dart.Frozen))
            .ToList();
    }

    private static RecordedRecordingDto ToDto(StoredRecording recording)
    {
        var orderedDarts = recording.Darts
            .OrderBy(dart => dart.Round)
            .ThenBy(dart => dart.PlayerIndex)
            .ThenBy(dart => dart.Dart)
            .ToList();

        var darts = orderedDarts
            .Select((dart, index) => new RecordedDartViewDto(
                index,
                dart.Game,
                dart.Round,
                dart.PlayerIndex,
                dart.PlayerName,
                dart.PlayerId,
                dart.Dart,
                dart.HitRegion,
                dart.Multiplier,
                dart.Sector,
                dart.Score,
                dart.CapturedAt,
                dart.Bust,
                dart.Frozen))
            .ToList();

        var turns = orderedDarts
            .GroupBy(dart => (dart.Round, dart.PlayerIndex))
            .Select(group => new
            {
                Key = (group.Key.Round, group.Key.PlayerIndex),
                PlayerIndex = group.Key.PlayerIndex,
                Name = group.Select(dart => dart.PlayerName).FirstOrDefault(name => !string.IsNullOrWhiteSpace(name)) ?? string.Empty,
                Darts = group.ToList()
            })
            .OrderBy(turn => turn.Key.Round)
            .ThenBy(turn => turn.Key.PlayerIndex)
            .ToList();

        var stats = new List<RecordedPlayerDto>();
        foreach (var turnGroup in turns.GroupBy(turn => turn.PlayerIndex).OrderBy(group => group.Key))
        {
            var playerTurns = turnGroup.ToList();
            var playerDarts = playerTurns.SelectMany(turn => turn.Darts).ToList();
            var name = playerTurns.Select(turn => turn.Name).FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))
                       ?? $"Jugador {turnGroup.Key + 1}";
            var scored = playerDarts.Count(dart => dart.Score > 0);
            var total = playerDarts.Sum(dart => dart.Score);

            stats.Add(new RecordedPlayerDto(
                turnGroup.Key,
                name,
                recording.IsFinished && !string.IsNullOrWhiteSpace(recording.Winner) &&
                    string.Equals(recording.Winner, name, StringComparison.OrdinalIgnoreCase),
                playerDarts.Count,
                scored,
                playerDarts.Count(dart => dart.Multiplier == 3 && dart.Score > 0),
                playerDarts.Count(dart => dart.Multiplier == 2 && dart.Score > 0),
                playerDarts.Count(dart => dart.Sector is 0 or 25),
                total,
                playerTurns.Max(turn => turn.Darts.Sum(dart => dart.Score)),
                scored == 0 ? 0 : Math.Round((double)total / scored, 2)));
        }

        return new RecordedRecordingDto(
            recording.CompetitionId,
            recording.MatchId,
            recording.Game,
            recording.Title,
            recording.IsMock,
            recording.IsFinished,
            recording.Winner,
            recording.GameType,
            recording.IsTeam,
            darts,
            PlayerNames(recording),
            stats,
            turns.Count,
            darts.Count,
            darts.Sum(dart => dart.Score),
            recording.FirstSeenAt,
            recording.LastUpdatedAt,
            recording.X01Rules);
    }

    private static List<string> PlayerNames(StoredRecording recording) => recording.Darts
        .Select(dart => dart.PlayerName)
        .Where(name => !string.IsNullOrWhiteSpace(name))
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .ToList();

    private static bool RulesEqual(X01RulesDto? left, X01RulesDto right)
    {
        if (left is null) return false;
        return left.StartScore == right.StartScore &&
               string.Equals(left.InMode, right.InMode, StringComparison.OrdinalIgnoreCase) &&
               string.Equals(left.OutMode, right.OutMode, StringComparison.OrdinalIgnoreCase) &&
               string.Equals(left.BullMode, right.BullMode, StringComparison.OrdinalIgnoreCase) &&
               left.Rounds == right.Rounds &&
               left.Stacked == right.Stacked &&
               SameIndices(left.TeamLocPlayers, right.TeamLocPlayers) &&
               SameIndices(left.TeamVisPlayers, right.TeamVisPlayers) &&
               string.Equals(left.TeamLocName, right.TeamLocName, StringComparison.OrdinalIgnoreCase) &&
               string.Equals(left.TeamVisName, right.TeamVisName, StringComparison.OrdinalIgnoreCase);
    }

    private static bool SameIndices(IReadOnlyList<int>? left, IReadOnlyList<int>? right)
    {
        if (left is null || right is null) return left is null && right is null;
        return left.SequenceEqual(right);
    }

    private static X01RulesDto? DefaultX01Rules(StoredRecording recording)
    {
        if (!string.Equals(recording.GameType, "X01", StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(recording.GameType, "TeamX01", StringComparison.OrdinalIgnoreCase) &&
            !(recording.GameType?.Contains("01", StringComparison.OrdinalIgnoreCase) ?? false) &&
            !(recording.Title.Contains("X01", StringComparison.OrdinalIgnoreCase)))
            return null;

        var text = $"{recording.Title} {recording.GameType}";
        var startMatch = Regex.Match(text, @"\b(301|501|701|901)\b");
        var startScore = startMatch.Success ? int.Parse(startMatch.Value, CultureInfo.InvariantCulture) : 501;

        var inMode = Regex.IsMatch(text, @"master\s*in|entrada\s*master|maestro\s*in", RegexOptions.IgnoreCase)
            ? "master"
            : Regex.IsMatch(text, @"double\s*in|doble\s*entrada|entrada\s*doble", RegexOptions.IgnoreCase)
                ? "double"
                : "open";
        var outMode = Regex.IsMatch(text, @"triple\s*out|salida\s*triple", RegexOptions.IgnoreCase)
            ? "triple"
            : Regex.IsMatch(text, @"master\s*out|salida\s*master|maestro\s*out", RegexOptions.IgnoreCase)
                ? "master"
                : "double";

        return new X01RulesDto(startScore, inMode, outMode, "standard", 15, false, Array.Empty<string>());
    }

    private static string Key(int competitionId, long matchId, int game) =>
        $"{competitionId}:{matchId}:{game}";

    private static StoredRecording BuildMock()
    {
        var now = DateTimeOffset.UtcNow;
        var firstSeen = now.AddMinutes(-58);
        var lastUpdated = now.AddMinutes(-44);
        var players = new[] { "BONY", "MAD" };
        var playerIds = new[] { "RB08071998", "a8vSqIcLuXTNPwubkIb8Rw,," };
        // Leg de 501 con Double In / Double Out: BONY abre con D20 y cierra en 10 dardos.
        var bony = new[]
        {
            new[] { (20, 2), (20, 3), (20, 3) },
            new[] { (20, 3), (20, 3), (20, 3) },
            new[] { (20, 3), (17, 3), (0, 2) }
        };
        var rival = new[]
        {
            new[] { (20, 1), (20, 1), (20, 1) },
            new[] { (19, 1), (19, 1), (19, 1) },
            new[] { (18, 1), (18, 1), (18, 1) }
        };

        var darts = new List<RecordedDartDto>();
        for (var round = 0; round < bony.Length; round++)
        {
            for (var playerIndex = 0; playerIndex < players.Length; playerIndex++)
            {
                var pattern = playerIndex == 0 ? bony[round] : rival[round];
                for (var dartIndex = 0; dartIndex < 3; dartIndex++)
                {
                    var (sector, multiplier) = pattern[dartIndex];
                    var hitRegion = sector == 0
                        ? multiplier == 2 ? "DBULL" : "SBULL"
                        : $"{(multiplier == 3 ? "T" : multiplier == 2 ? "D" : "S")}{sector}";
                    var score = sector == 0 ? (multiplier == 2 ? 50 : 25) : sector * multiplier;

                    darts.Add(new RecordedDartDto(
                        1,
                        round + 1,
                        playerIndex,
                        players[playerIndex],
                        playerIds[playerIndex],
                        dartIndex + 1,
                        hitRegion,
                        multiplier,
                        sector,
                        score,
                        firstSeen.AddMinutes(round * 2 + playerIndex)));
                }
            }
        }

        return new StoredRecording
        {
            CompetitionId = MockCompetitionId,
            MatchId = MockMatchId,
            Game = MockGame,
            Title = "BONY vs MAD · 501 Double In / Double Out",
            IsMock = true,
            IsFinished = true,
            Winner = "BONY",
            GameType = "X01",
            IsTeam = false,
            X01Rules = MockRules("501", "Doble / Doble"),
            FirstSeenAt = firstSeen,
            LastUpdatedAt = lastUpdated,
            Darts = darts
        };
    }

    private static StoredRecording BuildCricketMock(int game, bool teamMode)
    {
        var now = DateTimeOffset.UtcNow;
        var firstSeen = now.AddMinutes(game == 2 ? -40 : -25);
        var lastUpdated = now.AddMinutes(game == 2 ? -32 : -18);
        var players = teamMode
            ? new[] { "BONY", "DAVID", "MAD", "ANGEL" }
            : new[] { "BONY", "MAD" };
        var playerIds = teamMode
            ? new[] { "RB08071998", "o3z0-5mlycbNPwubkIb8Rw,,", "a8vSqIcLuXTNPwubkIb8Rw,,", "PfbTqWBYAd4," }
            : new[] { "RB08071998", "a8vSqIcLuXTNPwubkIb8Rw,," };

        var bony = new[]
        {
            new[] { (20, 3), (20, 1), (20, 1) },
            new[] { (19, 3), (19, 1), (19, 1) },
            new[] { (18, 3), (18, 1), (18, 1) },
            new[] { (17, 3), (17, 1), (17, 1) },
            new[] { (16, 3), (16, 1), (16, 1) },
            new[] { (15, 3), (15, 1), (15, 1) },
            new[] { (0, 2), (0, 1), (20, 3) },
            new[] { (20, 3), (20, 3), (20, 3) },
            new[] { (19, 3), (19, 3), (19, 3) },
            new[] { (18, 3), (18, 3), (18, 3) }
        };

        var rival = new[]
        {
            new[] { (20, 1), (20, 1), (19, 1) },
            new[] { (19, 1), (19, 1), (18, 1) },
            new[] { (18, 1), (18, 1), (17, 1) },
            new[] { (17, 1), (17, 1), (16, 1) },
            new[] { (16, 1), (16, 1), (15, 1) },
            new[] { (15, 1), (15, 1), (20, 1) },
            new[] { (0, 1), (0, 1), (20, 1) },
            new[] { (20, 3), (20, 1), (19, 1) },
            new[] { (19, 3), (19, 1), (18, 1) },
            new[] { (18, 3), (18, 1), (17, 1) }
        };

        var patterns = teamMode
            ? new[] { bony, bony, rival, rival }
            : new[] { bony, rival };

        var darts = new List<RecordedDartDto>();
        for (var round = 0; round < 10; round++)
        {
            for (var playerIndex = 0; playerIndex < players.Length; playerIndex++)
            {
                var pattern = patterns[playerIndex][round % patterns[playerIndex].Length];
                for (var dartIndex = 0; dartIndex < 3; dartIndex++)
                {
                    var (sector, multiplier) = pattern[dartIndex];
                    var hitRegion = sector == 0
                        ? multiplier == 2 ? "DBULL" : "SBULL"
                        : $"{(multiplier == 3 ? "T" : multiplier == 2 ? "D" : "S")}{sector}";
                    var score = sector == 0 ? (multiplier == 2 ? 50 : 25) : sector * multiplier;

                    darts.Add(new RecordedDartDto(
                        game,
                        round + 1,
                        playerIndex,
                        players[playerIndex],
                        playerIds[playerIndex],
                        dartIndex + 1,
                        hitRegion,
                        multiplier,
                        sector,
                        score,
                        firstSeen.AddSeconds(round * 12 + playerIndex * 2)));
                }
            }
        }

        return new StoredRecording
        {
            CompetitionId = MockCompetitionId,
            MatchId = MockMatchId,
            Game = game,
            Title = teamMode
                ? "BONY / DAVID vs MAD / ANGEL · Cricket por equipos"
                : "BONY vs MAD · Cricket de ejemplo",
            IsMock = true,
            IsFinished = true,
            Winner = "BONY",
            GameType = "CRICKET",
            IsTeam = teamMode,
            FirstSeenAt = firstSeen,
            LastUpdatedAt = lastUpdated,
            Darts = darts
        };
    }

    private static StoredRecording BuildTeamX01Mock(int game)
    {
        var now = DateTimeOffset.UtcNow;
        var firstSeen = now.AddMinutes(-12);
        var lastUpdated = now.AddMinutes(-6);
        var players = new[] { "BONY", "DAVID", "MAD", "ANGEL" };
        var playerIds = new[] { "RB08071998", "o3z0-5mlycbNPwubkIb8Rw,,", "a8vSqIcLuXTNPwubkIb8Rw,,", "PfbTqWBYAd4," };
        var bony = new[]
        {
            new[] { (20, 3), (20, 3), (20, 3) },
            new[] { (20, 3), (20, 3), (20, 3) },
            new[] { (20, 3), (19, 3), (12, 2) }
        };
        var david = new[]
        {
            new[] { (20, 3), (20, 3), (20, 3) },
            new[] { (20, 3), (20, 3), (20, 3) },
            new[] { (20, 1), (20, 1), (20, 1) }
        };
        var rival = new[] { (20, 1), (20, 1), (20, 1) };
        var angel = new[] { (19, 1), (19, 1), (19, 1) };

        var darts = new List<RecordedDartDto>();
        for (var round = 0; round < 3; round++)
        {
            for (var playerIndex = 0; playerIndex < players.Length; playerIndex++)
            {
                var pattern = playerIndex switch
                {
                    0 => bony[round],
                    1 => david[round],
                    2 => rival,
                    _ => angel
                };

                for (var dartIndex = 0; dartIndex < 3; dartIndex++)
                {
                    var (sector, multiplier) = pattern[dartIndex];
                    var hitRegion = sector == 0 && multiplier == 0
                        ? "MISS"
                        : sector == 0
                            ? multiplier == 2 ? "DBULL" : "SBULL"
                            : $"{(multiplier == 3 ? "T" : multiplier == 2 ? "D" : "S")}{sector}";
                    var score = sector == 0
                        ? multiplier == 2 ? 50 : multiplier == 1 ? 25 : 0
                        : sector * multiplier;

                    darts.Add(new RecordedDartDto(
                        game,
                        round + 1,
                        playerIndex,
                        players[playerIndex],
                        playerIds[playerIndex],
                        dartIndex + 1,
                        hitRegion,
                        multiplier,
                        sector,
                        score,
                        firstSeen.AddSeconds(round * 18 + playerIndex * 3)));
                }
            }
        }

        return new StoredRecording
        {
            CompetitionId = MockCompetitionId,
            MatchId = MockMatchId,
            Game = game,
            Title = "BONY / DAVID vs MAD / ANGEL · X01 por equipos",
            IsMock = true,
            IsFinished = true,
            Winner = "BONY",
            GameType = "X01",
            IsTeam = true,
            X01Rules = MockRules("Team 501", "Abierto / Doble"),
            FirstSeenAt = firstSeen,
            LastUpdatedAt = lastUpdated,
            Darts = darts
        };
    }

    private static StoredRecording BuildSimulatedDuoGame(
        int game,
        string title,
        string gameType,
        string winner,
        DateTimeOffset firstSeen,
        DateTimeOffset lastUpdated,
        (int Sector, int Multiplier)[][] player0,
        (int Sector, int Multiplier)[][] player1)
    {
        var players = new[] { "BONY", "MARIONA" };
        var playerIds = new[] { "RB08071998", "MS05061997" };
        var darts = new List<RecordedDartDto>();
        var rounds = Math.Max(player0.Length, player1.Length);
        var order = 0;

        for (var round = 0; round < rounds; round++)
        {
            for (var playerIndex = 0; playerIndex < 2; playerIndex++)
            {
                var pattern = playerIndex == 0 ? player0 : player1;
                if (round >= pattern.Length) continue;

                var hits = pattern[round];
                for (var dartIndex = 0; dartIndex < hits.Length; dartIndex++)
                {
                    var (sector, multiplier) = hits[dartIndex];
                    var hitRegion = sector == 0
                        ? multiplier == 2 ? "DBULL" : "SBULL"
                        : $"{(multiplier == 3 ? "T" : multiplier == 2 ? "D" : "S")}{sector}";
                    var score = sector == 0
                        ? multiplier == 2 ? 50 : multiplier == 1 ? 25 : 0
                        : sector * multiplier;

                    darts.Add(new RecordedDartDto(
                        game,
                        round + 1,
                        playerIndex,
                        players[playerIndex],
                        playerIds[playerIndex],
                        dartIndex + 1,
                        hitRegion,
                        multiplier,
                        sector,
                        score,
                        firstSeen.AddSeconds(order * 7)));
                    order++;
                }
            }
        }

        return new StoredRecording
        {
            CompetitionId = 900002,
            MatchId = 900002,
            Game = game,
            Title = title,
            IsMock = true,
            IsFinished = true,
            Winner = winner,
            GameType = gameType,
            IsTeam = false,
            X01Rules = string.Equals(gameType, "X01", StringComparison.OrdinalIgnoreCase)
                ? MockRules("501", "Abierto / Doble")
                : null,
            FirstSeenAt = firstSeen,
            LastUpdatedAt = lastUpdated,
            Darts = darts
        };
    }

    private static X01RulesDto MockRules(string startLabel, string inOut)
    {
        var startMatch = Regex.Match(startLabel, @"\b(301|501|701|901)\b");
        var startScore = startMatch.Success ? int.Parse(startMatch.Value, CultureInfo.InvariantCulture) : 501;
        var lower = (inOut ?? string.Empty).ToLowerInvariant();
        var parts = lower.Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var inPart = parts.Length > 0 ? parts[0] : lower;
        var outPart = parts.Length > 1 ? parts[1] : lower;
        var inMode = inPart.Contains("doble") || inPart.Contains("double")
            ? "double"
            : inPart.Contains("master") || inPart.Contains("maestr")
                ? "master"
                : "open";
        var outMode = outPart.Contains("triple")
            ? "triple"
            : outPart.Contains("master") || outPart.Contains("maestr")
                ? "master"
                : outPart.Contains("abierto") || outPart.Contains("open")
                    ? "open"
                    : "double";
        return new X01RulesDto(
            startScore,
            inMode,
            outMode,
            "standard",
            15,
            false,
            new[] { "Simulación", startLabel, inOut, "Diana 50/50", string.Empty, "15 Rondas" });
    }

    /// <summary>
    /// Partida de ejemplo entre BONY (RB08071998) y MARIONA (MS05061997): X01, Cricket y X01.
    /// Sirve para ver la agrupación por juegos, el marcador grande y el directo por partida.
    /// </summary>
    private static IEnumerable<StoredRecording> BuildSimulatedDuoMatch()
    {
        var now = DateTimeOffset.UtcNow;
        var start = now.AddMinutes(-96);

        var rbX01 = new[]
        {
            new[] { (20, 3), (20, 3), (20, 3) },
            new[] { (20, 3), (19, 3), (20, 3) },
            new[] { (20, 3), (20, 1), (20, 3) },
            new[] { (2, 2) }
        };
        var msX01 = new[]
        {
            new[] { (15, 1), (20, 3), (15, 1) },
            new[] { (20, 1), (13, 2), (20, 1) },
            new[] { (20, 1), (20, 1), (20, 1) }
        };

        yield return BuildSimulatedDuoGame(
            1,
            "BONY vs MARIONA · X01 simulado",
            "X01",
            "BONY",
            start,
            start.AddMinutes(18),
            rbX01,
            msX01);

        var rbCricket = new[]
        {
            new[] { (20, 1), (20, 1), (20, 1) },
            new[] { (1, 1), (5, 1), (17, 1) },
            new[] { (18, 1), (18, 1), (18, 1) },
            new[] { (16, 1), (16, 1), (16, 1) }
        };
        var msCricket = new[]
        {
            new[] { (20, 3), (19, 3), (18, 3) },
            new[] { (17, 3), (16, 3), (15, 3) },
            new[] { (19, 3), (17, 3), (16, 3) },
            new[] { (0, 2), (0, 1), (15, 3) }
        };

        yield return BuildSimulatedDuoGame(
            2,
            "BONY vs MARIONA · Cricket simulado",
            "CRICKET",
            "MARIONA",
            start.AddMinutes(24),
            start.AddMinutes(46),
            rbCricket,
            msCricket);

        var rbLast = new[]
        {
            new[] { (20, 3), (20, 3), (20, 3) },
            new[] { (20, 3), (20, 3), (20, 1) },
            new[] { (20, 3), (20, 1), (20, 1) },
            new[] { (19, 3), (12, 2) }
        };
        var msLast = new[]
        {
            new[] { (20, 3), (20, 3), (20, 1) },
            new[] { (20, 3), (20, 1), (20, 1) },
            new[] { (20, 1), (20, 1), (20, 1) }
        };

        yield return BuildSimulatedDuoGame(
            3,
            "BONY vs MARIONA · X01 simulado",
            "X01",
            "BONY",
            start.AddMinutes(52),
            start.AddMinutes(74),
            rbLast,
            msLast);
    }

    public sealed class StoredRecording
    {
        public int CompetitionId { get; set; }
        public long MatchId { get; set; }
        public int Game { get; set; }
        public string Title { get; set; } = string.Empty;
        public bool IsMock { get; set; }
        public bool IsFinished { get; set; }
        public string? Winner { get; set; }
        public string? GameType { get; set; }
        public bool? IsTeam { get; set; }
        public X01RulesDto? X01Rules { get; set; }
        public DateTimeOffset FirstSeenAt { get; set; }
        public DateTimeOffset LastUpdatedAt { get; set; }
        public List<RecordedDartDto> Darts { get; set; } = new();
    }
}

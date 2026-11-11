namespace RadikalPlayers.Radikal;

public sealed record RecordedDartDto(
    int Game,
    int Round,
    int PlayerIndex,
    string PlayerName,
    string? PlayerId,
    int Dart,
    string HitRegion,
    int Multiplier,
    int Sector,
    int Score,
    DateTimeOffset CapturedAt,
    bool Bust = false,
    bool Frozen = false);

/// <summary>Dardo tal y como se ha capturado, marcado con el índice de la grabación para pintarlo.</summary>
public sealed record RecordedDartViewDto(
    int Index,
    int Game,
    int Round,
    int PlayerIndex,
    string PlayerName,
    string? PlayerId,
    int Dart,
    string HitRegion,
    int Multiplier,
    int Sector,
    int Score,
    DateTimeOffset CapturedAt,
    bool Bust = false,
    bool Frozen = false);

public sealed record RecordedPlayerDto(
    int PlayerIndex,
    string Name,
    bool IsWinner,
    int Darts,
    int Hits,
    int Triples,
    int Doubles,
    int Bulls,
    int Score,
    int HighestTurn,
    double Average);

public sealed record RecordedRecordingSummaryDto(
    int CompetitionId,
    long MatchId,
    int Game,
    string Title,
    bool IsMock,
    bool IsFinished,
    string? Winner,
    string? GameType,
    bool? IsTeam,
    int DartsCount,
    int TurnsCount,
    int PlayersCount,
    IReadOnlyList<string> Players,
    DateTimeOffset FirstSeenAt,
    DateTimeOffset LastUpdatedAt,
    IReadOnlyList<RecordedDartViewDto> Preview,
    X01RulesDto? X01Rules = null);

public sealed record RecordedRecordingDto(
    int CompetitionId,
    long MatchId,
    int Game,
    string Title,
    bool IsMock,
    bool IsFinished,
    string? Winner,
    string? GameType,
    bool? IsTeam,
    IReadOnlyList<RecordedDartViewDto> Darts,
    IReadOnlyList<string> Players,
    IReadOnlyList<RecordedPlayerDto> PlayerStats,
    int TotalTurns,
    int TotalDarts,
    int TotalScore,
    DateTimeOffset FirstSeenAt,
    DateTimeOffset LastUpdatedAt,
    X01RulesDto? X01Rules = null);

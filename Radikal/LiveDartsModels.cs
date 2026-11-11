namespace RadikalPlayers.Radikal;

/// <summary>
/// Reglas X01 que publica la propia diana en visualizaPartidaJSON.php.
/// Las guardamos para que el visor pueda aplicar bust, entrada/salida y freeze.
/// </summary>
public sealed record X01RulesDto(
    int StartScore,
    string InMode,
    string OutMode,
    string BullMode,
    int Rounds,
    bool Stacked,
    IReadOnlyList<string> InfoPanels,
    IReadOnlyList<int>? TeamLocPlayers = null,
    IReadOnlyList<int>? TeamVisPlayers = null,
    string? TeamLocName = null,
    string? TeamVisName = null);

public sealed record LiveDartDto(
    int Round,
    int PlayerIndex,
    string PlayerName,
    string? PlayerId,
    int Dart,
    string HitRegion,
    int Multiplier,
    int Sector,
    int Score,
    bool Bust = false,
    bool Frozen = false);

public sealed record LiveDartsDto(
    int CompetitionId,
    long MatchId,
    int Game,
    string? GameType,
    bool? IsTeam,
    bool IsFinished,
    string? Winner,
    IReadOnlyList<LiveDartDto> Darts,
    DateTimeOffset FetchedAt,
    X01RulesDto? X01Rules = null);

public sealed record LiveMatchDto(
    int CompetitionId,
    long MatchId,
    int Game,
    string Title,
    string Url);

public sealed record LiveMatchListDto(
    IReadOnlyList<LiveMatchDto> Matches,
    DateTimeOffset FetchedAt);

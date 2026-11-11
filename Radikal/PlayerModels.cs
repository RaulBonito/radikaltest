using System.Net;

namespace RadikalPlayers.Radikal;

public sealed record PlayerStatDto(string Label, string Value);

public sealed record PlayerCompetitionDto(int? Id, string Name, string? Type);

public sealed record PlayerInfoItemDto(string Label, string Value);

public sealed record PlayerProfileDto(
    string Dni,
    string Alias,
    string? Name,
    string? PhotoUrl,
    string? Province,
    string? Country,
    string? Mpr,
    string? Ppd,
    string? Rank,
    IReadOnlyList<PlayerStatDto> Stats,
    IReadOnlyList<PlayerCompetitionDto> Competitions,
    IReadOnlyList<PlayerInfoItemDto> Info,
    DateTimeOffset FetchedAt,
    bool IsDemo);

public sealed class PlayerSession
{
    public required string Id { get; init; }
    public required string Dni { get; init; }
    public required CookieContainer Cookies { get; init; }
    public required PlayerProfileDto Profile { get; set; }
    public PlayerAreaDto? Area { get; set; }
    public DateTimeOffset AreaFetchedAt { get; set; }
    public PlayerRatingDto? Rating { get; set; }
    public DateTimeOffset RatingFetchedAt { get; set; }
    public bool IsDemo { get; init; }
    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
    public DateTimeOffset LastSeen { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class PlayerAuthException : Exception
{
    public PlayerAuthException(string message) : base(message)
    {
    }
}

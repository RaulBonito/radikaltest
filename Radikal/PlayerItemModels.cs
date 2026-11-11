namespace RadikalPlayers.Radikal;

public sealed record PlayerItemDto(
    string Id,
    string Type,
    int ItemId,
    int ItemIndex,
    string Name,
    string? Description,
    string? PosterUrl,
    string? VideoUrl,
    bool Active,
    string? ExpiryText,
    string? ProductUrl);

public sealed record PlayerItemsDto(
    IReadOnlyList<PlayerItemDto> Items,
    bool RequiresLogin,
    string? Message);

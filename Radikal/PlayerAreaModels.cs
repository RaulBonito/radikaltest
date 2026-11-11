namespace RadikalPlayers.Radikal;

public sealed record PlayerAccountDto(
    string Dni,
    string Alias,
    string? FullName,
    string? PhotoUrl,
    string? MemberType,
    string? MemberUntil,
    string? CurrentPpd,
    string? CurrentMpr,
    int RadikalPoints,
    int Bonus,
    string? CountryCode,
    string? UserId);

public sealed record PlayerFormOptionDto(string Value, string Label, bool Selected);

public sealed record PlayerFormDto(
    string Alias,
    string Dni,
    string? DniNumber,
    string? BirthDate,
    string Country,
    string Name,
    string Surname,
    string Sex,
    string PayPal,
    string Street,
    string Number,
    string Floor,
    string Door,
    string PostalCode,
    string Province,
    string City,
    string Phone,
    string Email,
    bool Newsletter,
    IReadOnlyList<PlayerFormOptionDto> Provinces);

public sealed record PlayerAreaCompetitionDto(int Id, string Name, string Type, bool Finished);

public sealed record PlayerPointDto(
    DateTimeOffset? Date,
    int Amount,
    string Status,
    string Concept);

public sealed record PlayerSubscriptionDto(string Name, string? ValidUntil);

public sealed record PlayerStatsModeDto(
    string AverageLabel,
    string Average,
    int Games,
    int Wins,
    int Losses,
    double WinPercent,
    IReadOnlyDictionary<string, string> Metrics);

public sealed record PlayerStatsDto(
    string? CompetitionName,
    PlayerStatsModeDto? X01,
    PlayerStatsModeDto? Cricket);

public sealed record PlayerAreaDto(
    PlayerAccountDto Account,
    PlayerFormDto Form,
    PlayerStatsDto Stats,
    IReadOnlyList<PlayerAreaCompetitionDto> CurrentCompetitions,
    IReadOnlyList<PlayerAreaCompetitionDto> FinishedCompetitions,
    IReadOnlyList<PlayerPointDto> Points,
    PlayerSubscriptionDto? Subscription,
    IReadOnlyList<string> Awards,
    DateTimeOffset FetchedAt,
    bool IsDemo);

public sealed record PlayerProfileUpdateRequest(
    string? Alias,
    string? Nombre,
    string? Apellidos,
    string? Sexo,
    string? PayPalMe,
    string? Calle,
    string? Numero,
    string? Piso,
    string? Puerta,
    string? CodigoPostal,
    string? Provincia,
    string? Ciudad,
    string? Telefono,
    string? Email,
    bool Newsletter);

public sealed record PlayerPasswordChangeRequest(string? Clave, string? Clave2);

public sealed record ShareRatingsRequest(bool Share);

public sealed record PlayerAliasUpdateRequest(string? Alias);

public sealed record PlayerActionResult(bool Ok, string Message);

namespace RadikalPlayers.Radikal;

public sealed record RankingPlayerDto(
    int Rank,
    string UserId,
    string Alias,
    string FirstName,
    string LastName,
    string CountryCode,
    string Location,
    string? ValidUntil,
    bool Premium,
    string OfficialPlayerType,
    string Game,
    string Value,
    string PhotoUrl);

public sealed record RankingResultDto(
    string CountryCode,
    string? Province,
    string Game,
    string Diana,
    string Gender,
    DateTimeOffset FetchedAt,
    IReadOnlyList<RankingPlayerDto> Players);

public sealed record RankingCountryDto(
    string CountryCode,
    string CountryName,
    int Players,
    double Best,
    double Average,
    string? TopAlias);

public sealed record RankingGlobalDto(
    string Game,
    string Diana,
    string Gender,
    IReadOnlyList<RankingPlayerDto> Top,
    IReadOnlyList<RankingCountryDto> Countries,
    DateTimeOffset FetchedAt);

public sealed record ProvinceDto(string Value, string Label);
public sealed record LocalityDto(string Value, string Label);

public sealed record LocalDto(string Value, string Label);

public sealed record CompetitionSummaryDto(
    int Id,
    string Type,
    string TypeLabel,
    string Name,
    string Status,
    bool IsLive,
    string? Game,
    DateTime? StartsAt,
    DateTime? EndsAt);

public sealed record CompetitionListDto(
    int Total,
    int Page,
    int PageSize,
    int TotalPages,
    DateTimeOffset FetchedAt,
    IReadOnlyList<CompetitionSummaryDto> Items);

public sealed record StandingTableDto(
    string? Caption,
    IReadOnlyList<string> Columns,
    IReadOnlyList<IReadOnlyList<string>> Rows);

public sealed record CompetitionInfoDto(
    string? Name,
    string? Description,
    string? Game,
    DateTime? StartsAt,
    DateTime? EndsAt,
    string? Scope,
    string? Organizer);

public sealed record CompetitionDetailDto(
    CompetitionSummaryDto Summary,
    CompetitionInfoDto Info,
    StandingTableDto? Standings,
    bool HasBracket,
    DateTimeOffset FetchedAt);

public sealed record TournamentConfigDto(
    double Width,
    double Height,
    double WidthResult,
    double HeightTeam,
    double SeparacionX,
    double SeparacionY,
    double OffsetX,
    double OffsetY);

public sealed record TournamentCellDto(
    int CellId,
    bool RamaG,
    string? Team0,
    string? Team1,
    string? Machine0,
    string? Machine1,
    int Winner,
    int Score0,
    int Score1,
    string? Status,
    string? StatusColor,
    string? DateTime,
    double Top,
    double Left,
    string? Letter,
    int Primary,
    string? Hash);

public sealed record TournamentLineXDto(double X, double XAdd, double Y);

public sealed record TournamentLineYDto(int D, double X, double Y1, double Y2);

public sealed record TournamentBracketDto(
    string? Name,
    string? LevelPriority,
    double Width,
    double Height,
    TournamentConfigDto Config,
    IReadOnlyList<TournamentCellDto> Cells,
    IReadOnlyList<TournamentLineXDto> LinesX,
    IReadOnlyList<TournamentLineYDto> LinesY,
    DateTimeOffset FetchedAt);

public sealed record ActaRowDto(
    string Nick,
    string? Name,
    string? Substitution,
    IReadOnlyList<string?> Cells);

public sealed record ActaDto(
    string? Type,
    string? League,
    string? Round,
    int Columns,
    int Score1,
    int Score2,
    string Team1,
    string Team2,
    IReadOnlyList<ActaRowDto> Rows,
    DateTimeOffset FetchedAt);

public sealed record DianaMachineDto(long Id, double Lat, double Lng, string BoardType);

public sealed record DianaListDto(
    int Total,
    IReadOnlyDictionary<string, int> ByType,
    IReadOnlyList<DianaMachineDto> Items);

public sealed record DianaDetailDto(
    long Id,
    string? Name,
    string? Address,
    string? City,
    IReadOnlyList<string> Competitions);

public sealed record TopPlaceDto(
    int Id,
    string Name,
    string Type,
    int Machines,
    double Lat,
    double Lng,
    string? CountryFlagUrl,
    string? Phone,
    string? MapsUrl,
    string? FacebookUrl);

public sealed record NewsItemDto(
    int Id,
    string Title,
    string? Excerpt,
    string? ImageUrl,
    string? Date,
    string Url);

public sealed record NewsListDto(
    int Page,
    int PageSize,
    int TotalPages,
    IReadOnlyList<NewsItemDto> Items);

public sealed record NewsDetailDto(
    int Id,
    string Title,
    string? Excerpt,
    string? ImageUrl,
    string? Date,
    string Url,
    IReadOnlyList<string> Paragraphs);

public sealed record OfficialSocialDto(string Network, string Url);

public sealed record OfficialPlayerDto(
    int Id,
    string Type,
    string Alias,
    string? PhotoUrl,
    IReadOnlyList<OfficialSocialDto>? Socials = null);

public sealed record OfficialPlayerListDto(
    int Total,
    IReadOnlyDictionary<string, int> ByType,
    IReadOnlyList<OfficialPlayerDto> Items);

public sealed record OfficialStatDto(string Label, string Value);

public sealed record OfficialMediaDto(long Id, string Url, int Width, int Height)
{
    /// <summary>true si es apaisada (ficha técnica); false si es retrato (foto del jugador).</summary>
    public bool IsLandscape => Width > 0 && Height > 0 && Width >= Height * 1.15;

    public bool IsPortrait => Width > 0 && Height > 0 && Height >= Width * 1.15;
}

public sealed record OfficialPlayerDetailDto(
    int Id,
    string Type,
    string Alias,
    string? Name,
    string? Province,
    string? Country,
    string? CountryCode,
    string? Hand,
    string? PhotoUrl,
    IReadOnlyList<OfficialStatDto> Stats,
    IReadOnlyList<string> CurrentCompetitions,
    IReadOnlyList<OfficialMediaDto> Media,
    IReadOnlyList<OfficialSocialDto> Socials,
    string? PortraitUrl,
    string? TechCardUrl);

public sealed record LiveCompetitionDto(int Id, string? Name);

public sealed record LiveStatusDto(
    bool IsLive,
    string Message,
    IReadOnlyList<LiveCompetitionDto> Competitions,
    DateTimeOffset CheckedAt);

public sealed record HomeStatsDto(
    int Dianas,
    int OfficialPlayers,
    int Countries,
    int TopPlayers,
    int Competitions);

public sealed record HomeDto(
    LiveStatusDto Live,
    RankingResultDto Ranking,
    IReadOnlyList<CompetitionSummaryDto> Competitions,
    IReadOnlyList<TopPlaceDto> Places,
    IReadOnlyList<NewsItemDto> News,
    HomeStatsDto Stats,
    DateTimeOffset FetchedAt);

public sealed record CompetitionSearchItemDto(
    int Id,
    string Name,
    string Type,
    string? ViewerUrl);

public sealed record SearchResultDto(
    string Kind,
    string Id,
    string Title,
    string? Subtitle,
    string? Url,
    string? PhotoUrl = null);

/// <summary>Puesto de un jugador en un ranking concreto (país o global).</summary>
public sealed record PlayerRankEntryDto(
    string Game,
    string Diana,
    int Rank,
    string Value,
    string ScopeCode)
{
    public bool IsGlobal => ScopeCode == "0";
}

/// <summary>Jugador del directorio público construido a partir de los rankings de Radikal.</summary>
public sealed record PlayerSummaryDto(
    string UserId,
    string Alias,
    string FirstName,
    string LastName,
    string CountryCode,
    string Location,
    bool Premium,
    string OfficialPlayerType,
    string PhotoUrl,
    IReadOnlyList<PlayerRankEntryDto> Ranks);

/// <summary>Estadística con etiqueta legible para la ficha.</summary>
public sealed record PlayerStatItemDto(string Label, string Value);

/// <summary>Resumen de un juego (PPD/MPR) devuelto por ajax.newstats.php.</summary>
public sealed record PlayerGameStatsDto(
    string Game,
    string Average,
    string Games,
    string Wins,
    string Losses,
    string WinPercent,
    IReadOnlyList<PlayerStatItemDto> Stats);

/// <summary>Datos devueltos al buscar un Radikal ID (DNI) en ajax.newstats.php.</summary>
public sealed record PlayerLookupDto(
    string RadikalId,
    string UserId,
    string Alias,
    string FirstName,
    string LastName,
    string? Team,
    IReadOnlyList<PlayerGameStatsDto> Games);

/// <summary>Tabla del historial de rating del área privada de Radikal.</summary>
public sealed record PlayerHistoryTableDto(
    string? Title,
    IReadOnlyList<string> Headers,
    IReadOnlyList<IReadOnlyList<string>> Rows);

/// <summary>Rating actual (PPD/MPR), diana preferida, competiciones e historial del área privada.</summary>
public sealed record PlayerRatingDto(
    string? Ppd,
    string? Mpr,
    string? PreferredDiana,
    int? RadikalPoints,
    int? Bonus,
    string? MemberType,
    string? MemberUntil,
    IReadOnlyList<PlayerAreaCompetitionDto> Competitions,
    IReadOnlyList<PlayerHistoryTableDto> History,
    DateTimeOffset FetchedAt);

/// <summary>Ficha de jugador. Se sirve tanto para jugadores del directorio como para la sesión conectada.</summary>
public sealed record PlayerCardDto(
    string UserId,
    string Alias,
    string FirstName,
    string LastName,
    string? CountryCode,
    string? CountryName,
    string? Location,
    bool Premium,
    string OfficialPlayerType,
    string PhotoUrl,
    int? OfficialPlayerId,
    IReadOnlyList<PlayerRankEntryDto> Ranks,
    string? RadikalId = null,
    string? Team = null,
    IReadOnlyList<PlayerGameStatsDto>? Stats = null,
    string? RatingPpd = null,
    string? RatingMpr = null,
    IReadOnlyList<PlayerHistoryTableDto>? RatingHistory = null,
    string? PreferredDiana = null,
    IReadOnlyList<PlayerAreaCompetitionDto>? Competitions = null,
    int? RadikalPoints = null,
    int? Bonus = null,
    string? MemberType = null,
    string? MemberUntil = null,
    bool RatingsShared = false);

public static class RadikalMetadata
{
    public static readonly IReadOnlyList<(string Code, string Name)> Countries = new[]
    {
        ("0", "Todos los países"), ("20", "Andorra"), ("36", "Australia"), ("40", "Austria"),
        ("56", "Bélgica"), ("76", "Brasil"), ("100", "Bulgaria"), ("124", "Canadá"),
        ("156", "China"), ("158", "Taiwán"), ("208", "Dinamarca"), ("246", "Finlandia"),
        ("250", "Francia"), ("276", "Alemania"), ("300", "Grecia"), ("344", "Hong Kong"),
        ("348", "Hungría"), ("360", "Indonesia"), ("372", "Irlanda"), ("376", "Israel"),
        ("380", "Italia"), ("392", "Japón"), ("428", "Letonia"), ("438", "Liechtenstein"),
        ("442", "Luxemburgo"), ("446", "Macao"), ("458", "Malasia"), ("528", "Países Bajos"),
        ("554", "Nueva Zelanda"), ("578", "Noruega"), ("591", "Panamá"), ("616", "Polonia"),
        ("620", "Portugal"), ("642", "Rumanía"), ("702", "Singapur"), ("703", "Eslovaquia"),
        ("705", "Eslovenia"), ("724", "España"), ("752", "Suecia"), ("756", "Suiza"),
        ("784", "Emiratos Árabes"), ("792", "Turquía"), ("826", "Reino Unido"), ("840", "Estados Unidos")
    };

    public static string CountryName(string code) =>
        Countries.FirstOrDefault(c => c.Code == code).Name ?? code;

    /// <summary>
    /// Código numérico Radikal a partir del nombre del país tal y como aparece en la web oficial
    /// ("España", "Portugal", "Reino Unido"...). Tolera acentos, mayúsculas y alias habituales.
    /// </summary>
    public static string? CountryCodeByName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return null;
        var target = NormalizeCountry(name);

        var match = Countries.FirstOrDefault(c => NormalizeCountry(c.Name) == target);
        if (!string.IsNullOrEmpty(match.Code)) return match.Code;

        return target switch
        {
            "espana" or "spain" => "724",
            "portugal" => "620",
            "francia" or "france" => "250",
            "alemania" or "germany" or "deutschland" => "276",
            "italia" or "italy" => "380",
            "reinounido" or "inglaterra" or "uk" or "england" or "granbretana" => "826",
            "estadosunidos" or "eeuu" or "usa" or "unitedstates" => "840",
            "paisesbajos" or "holanda" or "netherlands" => "528",
            "belgica" or "belgium" => "56",
            "suiza" or "switzerland" => "756",
            "austria" => "40",
            "brasil" or "brazil" => "76",
            "mexico" => "484",
            "canada" => "124",
            "australia" => "36",
            _ => null
        };
    }

    private static string NormalizeCountry(string value)
    {
        var normalized = value.Normalize(System.Text.NormalizationForm.FormD);
        var builder = new System.Text.StringBuilder(normalized.Length);
        foreach (var character in normalized)
        {
            if (System.Globalization.CharUnicodeInfo.GetUnicodeCategory(character)
                == System.Globalization.UnicodeCategory.NonSpacingMark)
                continue;
            if (char.IsLetterOrDigit(character))
                builder.Append(char.ToLowerInvariant(character));
        }
        return builder.ToString();
    }
}

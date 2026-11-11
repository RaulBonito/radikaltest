using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Caching.Memory;

namespace RadikalPlayers.Radikal;

/// <summary>
/// Directorio de jugadores construido con los rankings públicos de Radikal (top por país, juego y diana).
/// Radikal no expone un buscador público de jugadores, así que se agregan todas las clasificaciones
/// en un índice en memoria que permite buscar por alias, nombre completo o ID.
/// </summary>
public sealed class PlayerDirectoryService
{
    private const string EspClient = "radikal-esp";
    private const string IndexKey = "player-directory:index:v1";
    private static readonly TimeSpan IndexFreshFor = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan IndexKeepFor = TimeSpan.FromHours(6);

    private static readonly (string Game, string Diana)[] Combos =
    {
        ("MPR", "aa"), ("MPR", "ae"), ("MPR", "bb"),
        ("PPD", "aa"), ("PPD", "ae"), ("PPD", "bb")
    };

    private static readonly Regex TestAlias = new(
        @"^(id\s*nulo|nulo|test|prueba|usuario\s*prueba)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Dictionary<string, int> GameOrder = new(StringComparer.OrdinalIgnoreCase)
    {
        ["MPR"] = 0,
        ["PPD"] = 1
    };

    private static readonly Dictionary<string, int> DianaOrder = new(StringComparer.OrdinalIgnoreCase)
    {
        ["aa"] = 0,
        ["ae"] = 1,
        ["bb"] = 2
    };

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IMemoryCache _cache;
    private readonly RadikalClient _client;
    private readonly ILogger<PlayerDirectoryService> _logger;
    private readonly SemaphoreSlim _buildLock = new(1, 1);
    private int _refreshing;

    public PlayerDirectoryService(
        IHttpClientFactory httpClientFactory,
        IMemoryCache cache,
        RadikalClient client,
        ILogger<PlayerDirectoryService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _cache = cache;
        _client = client;
        _logger = logger;
    }

    public async Task<IReadOnlyList<PlayerSummaryDto>> GetIndexAsync(CancellationToken ct = default)
    {
        if (_cache.TryGetValue(IndexKey, out DirectorySnapshot? snapshot) && snapshot is not null)
        {
            if (DateTimeOffset.UtcNow - snapshot.BuiltAt < IndexFreshFor)
                return snapshot.Players;

            // Datos obsoletos: se devuelven al instante y se refrescan en segundo plano.
            TriggerBackgroundRefresh();
            return snapshot.Players;
        }

        await _buildLock.WaitAsync(ct);
        try
        {
            if (_cache.TryGetValue(IndexKey, out snapshot) && snapshot is not null)
                return snapshot.Players;

            var started = DateTimeOffset.UtcNow;
            var players = await BuildIndexAsync(ct);
            Store(players, started);
            _logger.LogInformation(
                "Directorio de jugadores listo: {Count} jugadores en {Ms} ms",
                players.Count,
                (DateTimeOffset.UtcNow - started).TotalMilliseconds);
            return players;
        }
        finally
        {
            _buildLock.Release();
        }
    }

    private void TriggerBackgroundRefresh()
    {
        if (Interlocked.CompareExchange(ref _refreshing, 1, 0) != 0) return;

        _ = Task.Run(async () =>
        {
            var started = DateTimeOffset.UtcNow;
            try
            {
                var players = await BuildIndexAsync(CancellationToken.None);
                Store(players, started);
                _logger.LogInformation(
                    "Directorio de jugadores refrescado en segundo plano: {Count} jugadores en {Ms} ms",
                    players.Count,
                    (DateTimeOffset.UtcNow - started).TotalMilliseconds);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "No se pudo refrescar el directorio de jugadores");
            }
            finally
            {
                Interlocked.Exchange(ref _refreshing, 0);
            }
        });
    }

    private void Store(IReadOnlyList<PlayerSummaryDto> players, DateTimeOffset builtAt)
    {
        _cache.Set(
            IndexKey,
            new DirectorySnapshot(players, builtAt),
            new MemoryCacheEntryOptions { AbsoluteExpirationRelativeToNow = IndexKeepFor });
    }

    private bool TryGetCachedIndex(out IReadOnlyList<PlayerSummaryDto> players)
    {
        if (_cache.TryGetValue(IndexKey, out DirectorySnapshot? snapshot) && snapshot is not null)
        {
            players = snapshot.Players;
            return true;
        }

        players = Array.Empty<PlayerSummaryDto>();
        return false;
    }

    /// <summary>
    /// Normaliza un Radikal ID (DNI). Debe ser alfanumérico, sin espacios ni comas y contener algún dígito.
    /// Devuelve null cuando el texto no puede ser un Radikal ID (por ejemplo, un UserID opaco del ranking).
    /// </summary>
    private static string? NormalizeRadikalId(string? value)
    {
        var id = (value ?? string.Empty).Trim().ToUpperInvariant();
        if (id.Length is < 4 or > 24) return null;
        if (!id.All(char.IsLetterOrDigit)) return null;
        if (!id.Any(char.IsDigit)) return null;
        return id;
    }

    public async Task<IReadOnlyList<SearchResultDto>> SearchAsync(
        string query,
        PlayerProfileDto? self,
        int limit,
        CancellationToken ct = default)
    {
        query = (query ?? string.Empty).Trim();
        if (query.Length < 2) return Array.Empty<SearchResultDto>();

        // Un Radikal ID se resuelve directamente contra Radikal, sin esperar al directorio.
        var radikalId = NormalizeRadikalId(query);
        if (radikalId is not null)
        {
            var lookup = await LookupByRadikalIdAsync(radikalId, ct);
            if (lookup is not null)
            {
                var fullName = $"{lookup.FirstName} {lookup.LastName}".Trim();
                var subtitle = string.IsNullOrWhiteSpace(fullName)
                    ? $"Radikal ID {radikalId}"
                    : $"{fullName} · Radikal ID {radikalId}";

                return new[]
                {
                    new SearchResultDto(
                        "player",
                        radikalId,
                        lookup.Alias,
                        subtitle,
                        $"#/jugador/{Uri.EscapeDataString(radikalId)}",
                        lookup.PhotoUrl)
                };
            }
        }

        var index = await GetIndexAsync(ct);
        var needle = Normalize(query);
        var idNeedle = IdKey(query);

        var matches = new List<(int Score, SearchResultDto Item)>();

        foreach (var player in index)
        {
            var score = ScorePlayer(player, needle, idNeedle);
            if (score < 0) continue;
            matches.Add((score, ToSearchResult(player)));
        }

        if (self is not null)
        {
            var selfScore = ScoreSelf(self, needle, idNeedle);
            if (selfScore >= 0)
            {
                matches.Insert(0, (selfScore, new SearchResultDto(
                    "player",
                    self.Dni,
                    string.IsNullOrWhiteSpace(self.Alias) ? self.Dni : self.Alias,
                    $"Tu perfil · Radikal ID {self.Dni}",
                    $"#/jugador/{Uri.EscapeDataString(self.Dni)}",
                    self.PhotoUrl)));
            }
        }

        try
        {
            var official = await _client.GetOfficialPlayersAsync(ct);
            foreach (var player in official.Items)
            {
                var score = ScoreOfficial(player, needle, idNeedle);
                if (score < 0) continue;
                matches.Add((score, new SearchResultDto(
                    "official",
                    player.Id.ToString(CultureInfo.InvariantCulture),
                    player.Alias,
                    $"Official Player · ID {player.Id}",
                    $"#/official/{player.Id}",
                    string.IsNullOrWhiteSpace(player.PhotoUrl) ? null : $"{player.PhotoUrl}&w=80")));
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "No se pudieron añadir los Official Players al buscador");
        }

        return matches
            .GroupBy(match => $"{match.Item.Kind}:{match.Item.Id}", StringComparer.OrdinalIgnoreCase)
            .Select(group => group.OrderBy(match => match.Score).First())
            .OrderBy(match => match.Score)
            .ThenBy(match => match.Item.Title, StringComparer.OrdinalIgnoreCase)
            .Take(Math.Clamp(limit, 1, 30))
            .Select(match => match.Item)
            .ToList();
    }

    public async Task<PlayerCardDto?> GetPlayerAsync(string userId, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(userId)) return null;

        var index = await GetIndexAsync(ct);
        var player = FindPlayer(index, userId);
        if (player is null) return null;

        int? officialPlayerId = null;
        try
        {
            var official = await _client.GetOfficialPlayersAsync(ct);
            var alias = Normalize(player.Alias);
            officialPlayerId = official.Items
                .FirstOrDefault(item => Normalize(item.Alias) == alias)?.Id;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "No se pudo enlazar {UserId} con un Official Player", userId);
        }

        return ToCard(player, officialPlayerId);
    }

    /// <summary>
    /// Busca cualquier jugador dado de alta por su Radikal ID (DNI) usando el endpoint público
    /// <c>ajax.newstats.php?action=total_user</c>. Devuelve identidad y estadísticas reales.
    /// </summary>
    public async Task<PlayerCardDto?> LookupByRadikalIdAsync(string? radikalId, CancellationToken ct = default)
    {
        var id = NormalizeRadikalId(radikalId);
        if (id is null) return null;

        var cacheKey = $"player-lookup:{id}";
        if (_cache.TryGetValue(cacheKey, out PlayerCardDto? cached) && cached is not null)
            return cached;

        try
        {
            var http = _httpClientFactory.CreateClient(EspClient);
            using var content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["action"] = "total_user",
                ["userid"] = id
            });

            using var response = await http.PostAsync("ajax.newstats.php", content, ct);
            if (!response.IsSuccessStatusCode) return null;

            var json = await response.Content.ReadAsStringAsync(ct);
            var lookup = RadikalParsers.ParsePlayerLookup(json, id);
            if (lookup is null) return null;
            if (string.IsNullOrWhiteSpace(lookup.Alias) || TestAlias.IsMatch(lookup.Alias.Trim()))
                return null;

            // Enriquecer con país, localidad y rankings si el directorio ya está construido.
            PlayerSummaryDto? directoryPlayer = null;
            if (TryGetCachedIndex(out var index) && !string.IsNullOrWhiteSpace(lookup.UserId))
                directoryPlayer = FindPlayer(index, lookup.UserId);

            int? officialPlayerId = null;
            try
            {
                var official = await _client.GetOfficialPlayersAsync(ct);
                var alias = Normalize(lookup.Alias);
                officialPlayerId = official.Items
                    .FirstOrDefault(item => Normalize(item.Alias) == alias)?.Id;
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "No se pudo enlazar el Radikal ID {RadikalId} con un Official Player", id);
            }

            var photoUrl = directoryPlayer?.PhotoUrl;
            if (string.IsNullOrWhiteSpace(photoUrl) && !string.IsNullOrWhiteSpace(lookup.UserId))
                photoUrl = $"/api/photos/player?userId={Uri.EscapeDataString(lookup.UserId)}";

            var card = new PlayerCardDto(
                string.IsNullOrWhiteSpace(lookup.UserId) ? id : lookup.UserId,
                lookup.Alias,
                lookup.FirstName,
                lookup.LastName,
                directoryPlayer?.CountryCode,
                directoryPlayer is null ? null : CountryName(directoryPlayer.CountryCode),
                directoryPlayer?.Location,
                directoryPlayer?.Premium ?? false,
                directoryPlayer?.OfficialPlayerType ?? "NONE",
                photoUrl ?? string.Empty,
                officialPlayerId,
                directoryPlayer?.Ranks ?? Array.Empty<PlayerRankEntryDto>(),
                id,
                lookup.Team,
                lookup.Games);

            _cache.Set(
                cacheKey,
                card,
                new MemoryCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(15) });

            return card;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "No se pudo buscar el Radikal ID {RadikalId}", id);
            return null;
        }
    }

    /// <summary>Ficha de la sesión conectada, para que siempre se pueda encontrar el propio perfil.</summary>
    public PlayerCardDto BuildSelfCard(PlayerProfileDto self)
    {
        var userId = self.Dni;
        var ranks = new List<PlayerRankEntryDto>();
        if (!string.IsNullOrWhiteSpace(self.Mpr))
            ranks.Add(new PlayerRankEntryDto("MPR", "aa", 0, self.Mpr!, "self"));
        if (!string.IsNullOrWhiteSpace(self.Ppd))
            ranks.Add(new PlayerRankEntryDto("PPD", "aa", 0, self.Ppd!, "self"));

        return new PlayerCardDto(
            userId,
            string.IsNullOrWhiteSpace(self.Alias) ? self.Dni : self.Alias,
            SplitName(self.Name).First,
            SplitName(self.Name).Last,
            null,
            self.Country,
            self.Province,
            false,
            "NONE",
            self.PhotoUrl ?? $"/api/photos/player?userId={Uri.EscapeDataString(userId)}",
            null,
            ranks,
            userId,
            null,
            null,
            self.Ppd,
            self.Mpr);
    }

    private async Task<IReadOnlyList<PlayerSummaryDto>> BuildIndexAsync(CancellationToken ct)
    {
        var http = _httpClientFactory.CreateClient(EspClient);
        var countries = RadikalMetadata.Countries
            .Select(country => country.Code)
            .Where(code => !string.IsNullOrWhiteSpace(code))
            .Distinct()
            .ToList();

        var jobs = new List<(string Country, string Game, string Diana)>();
        foreach (var country in countries)
        {
            foreach (var (game, diana) in Combos)
                jobs.Add((country, game, diana));
        }

        var builders = new Dictionary<string, PlayerBuilder>(StringComparer.Ordinal);
        using var gate = new SemaphoreSlim(16);
        var tasks = jobs.Select(async job =>
        {
            await gate.WaitAsync(ct);
            try
            {
                var json = await PostRankingAsync(http, job.Country, job.Game, job.Diana, ct);
                var ranking = RadikalParsers.ParseRanking(
                    json,
                    job.Country,
                    null,
                    job.Game,
                    job.Diana,
                    "0");

                lock (builders)
                {
                    Merge(builders, ranking, job.Country);
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogDebug(
                    ex,
                    "Ranking {Country}/{Game}/{Diana} no disponible para el directorio",
                    job.Country,
                    job.Game,
                    job.Diana);
            }
            finally
            {
                gate.Release();
            }
        });

        await Task.WhenAll(tasks);

        return builders.Values
            .Where(builder =>
                !string.IsNullOrWhiteSpace(builder.Alias) &&
                !TestAlias.IsMatch(builder.Alias.Trim()))
            .Select(builder => new PlayerSummaryDto(
                builder.UserId,
                builder.Alias,
                builder.FirstName,
                builder.LastName,
                string.IsNullOrWhiteSpace(builder.CountryCode) ? "0" : builder.CountryCode,
                builder.Location,
                builder.Premium,
                builder.OfficialPlayerType,
                string.IsNullOrWhiteSpace(builder.PhotoUrl)
                    ? $"/api/photos/player?userId={Uri.EscapeDataString(builder.UserId)}"
                    : builder.PhotoUrl,
                builder.Ranks
                    .OrderBy(rank => GameOrder.GetValueOrDefault(rank.Game, 9))
                    .ThenBy(rank => DianaOrder.GetValueOrDefault(rank.Diana, 9))
                    .ThenBy(rank => rank.ScopeCode == "0" ? 1 : 0)
                    .ToList()))
            .OrderBy(player => player.Alias, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static async Task<string> PostRankingAsync(
        HttpClient http,
        string country,
        string game,
        string diana,
        CancellationToken ct)
    {
        using var content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["action"] = "ranking",
            ["pais"] = country,
            ["provinciaID"] = string.Empty,
            ["diana"] = diana,
            ["game"] = game,
            ["gender"] = "0"
        });

        using var response = await http.PostAsync("ajax.ranking.php", content, ct);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadAsStringAsync(ct);
    }

    private static void Merge(
        Dictionary<string, PlayerBuilder> builders,
        RankingResultDto ranking,
        string scopeCode)
    {
        foreach (var player in ranking.Players)
        {
            if (string.IsNullOrWhiteSpace(player.UserId)) continue;

            if (!builders.TryGetValue(player.UserId, out var builder))
            {
                builder = new PlayerBuilder { UserId = player.UserId };
                builders[player.UserId] = builder;
            }

            if (string.IsNullOrWhiteSpace(builder.Alias) && !string.IsNullOrWhiteSpace(player.Alias))
                builder.Alias = player.Alias;
            if (string.IsNullOrWhiteSpace(builder.FirstName) && !string.IsNullOrWhiteSpace(player.FirstName))
                builder.FirstName = player.FirstName;
            if (string.IsNullOrWhiteSpace(builder.LastName) && !string.IsNullOrWhiteSpace(player.LastName))
                builder.LastName = player.LastName;
            if (string.IsNullOrWhiteSpace(builder.Location) && !string.IsNullOrWhiteSpace(player.Location))
                builder.Location = player.Location;
            if (string.IsNullOrWhiteSpace(builder.PhotoUrl) && !string.IsNullOrWhiteSpace(player.PhotoUrl))
                builder.PhotoUrl = player.PhotoUrl;
            if (string.IsNullOrWhiteSpace(builder.CountryCode) || builder.CountryCode == "0")
            {
                if (!string.IsNullOrWhiteSpace(player.CountryCode) && player.CountryCode != "0")
                    builder.CountryCode = player.CountryCode;
            }
            builder.Premium |= player.Premium;
            if (player.OfficialPlayerType is not null && player.OfficialPlayerType != "NONE")
                builder.OfficialPlayerType = player.OfficialPlayerType;

            var key = $"{ranking.Game}:{ranking.Diana}:{scopeCode}";
            if (!builder.RankKeys.Add(key)) continue;

            builder.Ranks.Add(new PlayerRankEntryDto(
                ranking.Game,
                ranking.Diana,
                player.Rank,
                player.Value,
                scopeCode));
        }
    }

    private static PlayerSummaryDto? FindPlayer(IReadOnlyList<PlayerSummaryDto> index, string userId)
    {
        var exact = index.FirstOrDefault(player =>
            string.Equals(player.UserId, userId, StringComparison.OrdinalIgnoreCase));
        if (exact is not null) return exact;

        var key = IdKey(userId);
        return index.FirstOrDefault(player =>
            string.Equals(IdKey(player.UserId), key, StringComparison.OrdinalIgnoreCase));
    }

    private static SearchResultDto ToSearchResult(PlayerSummaryDto player)
    {
        var best = BestRank(player.Ranks);
        var parts = new List<string>();

        var fullName = $"{player.FirstName} {player.LastName}".Trim();
        if (!string.IsNullOrWhiteSpace(fullName)) parts.Add(fullName);
        if (best is not null)
            parts.Add(best.Rank > 0 ? $"#{best.Rank} {best.Game}" : $"{best.Game} {best.Value}");
        parts.Add(best?.ScopeCode is null or "0" ? "Global" : CountryName(best.ScopeCode));

        return new SearchResultDto(
            "player",
            player.UserId,
            string.IsNullOrWhiteSpace(player.Alias) ? player.UserId : player.Alias,
            string.Join(" · ", parts),
            $"#/jugador/{Uri.EscapeDataString(player.UserId)}",
            player.PhotoUrl);
    }

    private static PlayerCardDto ToCard(PlayerSummaryDto player, int? officialPlayerId)
    {
        return new PlayerCardDto(
            player.UserId,
            player.Alias,
            player.FirstName,
            player.LastName,
            player.CountryCode,
            CountryName(player.CountryCode),
            player.Location,
            player.Premium,
            player.OfficialPlayerType,
            player.PhotoUrl,
            officialPlayerId,
            player.Ranks);
    }

    private static PlayerRankEntryDto? BestRank(IReadOnlyList<PlayerRankEntryDto> ranks)
    {
        if (ranks.Count == 0) return null;

        // El ranking global es el más representativo; si no hay, el mejor puesto nacional.
        var global = ranks
            .Where(rank => rank.ScopeCode == "0" && rank.Rank > 0)
            .OrderBy(rank => rank.Rank)
            .FirstOrDefault();
        if (global is not null) return global;

        return ranks
            .Where(rank => rank.Rank > 0)
            .OrderBy(rank => rank.Rank)
            .FirstOrDefault()
            ?? ranks[0];
    }

    private static int ScorePlayer(PlayerSummaryDto player, string needle, string idNeedle)
    {
        var alias = Normalize(player.Alias);
        var first = Normalize(player.FirstName);
        var last = Normalize(player.LastName);
        var full = $"{first} {last}".Trim();
        var reverse = $"{last} {first}".Trim();
        var id = IdKey(player.UserId);

        if (alias == needle || id == idNeedle) return 0;
        if (alias.StartsWith(needle, StringComparison.Ordinal) || id.StartsWith(idNeedle, StringComparison.Ordinal)) return 1;
        if (full.StartsWith(needle, StringComparison.Ordinal) || reverse.StartsWith(needle, StringComparison.Ordinal)) return 2;
        if (full.Contains(needle, StringComparison.Ordinal) || reverse.Contains(needle, StringComparison.Ordinal)) return 3;
        if (alias.Contains(needle, StringComparison.Ordinal)) return 4;
        if (id.Contains(idNeedle, StringComparison.Ordinal)) return 5;
        return -1;
    }

    private static int ScoreSelf(PlayerProfileDto self, string needle, string idNeedle)
    {
        var alias = Normalize(self.Alias);
        var name = Normalize(self.Name);
        var dni = IdKey(self.Dni);

        if (alias == needle || dni == idNeedle) return 0;
        if (alias.StartsWith(needle, StringComparison.Ordinal)) return 1;
        if (name.Contains(needle, StringComparison.Ordinal)) return 2;
        if (dni.StartsWith(idNeedle, StringComparison.Ordinal)) return 2;
        return -1;
    }

    private static int ScoreOfficial(OfficialPlayerDto player, string needle, string idNeedle)
    {
        var alias = Normalize(player.Alias);
        var id = IdKey(player.Id.ToString(CultureInfo.InvariantCulture));

        if (id == idNeedle) return 0;
        if (alias == needle) return 1;
        if (alias.StartsWith(needle, StringComparison.Ordinal)) return 2;
        if (alias.Contains(needle, StringComparison.Ordinal)) return 3;
        if (id.StartsWith(idNeedle, StringComparison.Ordinal)) return 4;
        return -1;
    }

    private static string CountryName(string? code)
    {
        if (string.IsNullOrWhiteSpace(code) || code == "0") return "Global";
        return RadikalMetadata.Countries.FirstOrDefault(country => country.Code == code).Name ?? code;
    }

    private static string IdKey(string? value)
    {
        return (value ?? string.Empty).Trim().TrimEnd(',').ToLowerInvariant();
    }

    private static string Normalize(string? value)
    {
        var text = (value ?? string.Empty).Trim();
        if (text.Length == 0) return string.Empty;

        var decomposed = text.Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(decomposed.Length);
        foreach (var character in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(character) != UnicodeCategory.NonSpacingMark)
                builder.Append(character);
        }

        return builder.ToString().Normalize(NormalizationForm.FormC).ToLowerInvariant();
    }

    private static (string First, string Last) SplitName(string? fullName)
    {
        var text = (fullName ?? string.Empty).Trim();
        if (text.Length == 0) return (string.Empty, string.Empty);

        var space = text.IndexOf(' ');
        return space < 0 ? (text, string.Empty) : (text[..space], text[(space + 1)..]);
    }

    private sealed record DirectorySnapshot(
        IReadOnlyList<PlayerSummaryDto> Players,
        DateTimeOffset BuiltAt);

    private sealed class PlayerBuilder
    {
        public string UserId { get; init; } = string.Empty;
        public string Alias { get; set; } = string.Empty;
        public string FirstName { get; set; } = string.Empty;
        public string LastName { get; set; } = string.Empty;
        public string CountryCode { get; set; } = string.Empty;
        public string Location { get; set; } = string.Empty;
        public string OfficialPlayerType { get; set; } = "NONE";
        public string PhotoUrl { get; set; } = string.Empty;
        public bool Premium { get; set; }
        public HashSet<string> RankKeys { get; } = new(StringComparer.OrdinalIgnoreCase);
        public List<PlayerRankEntryDto> Ranks { get; } = new();
    }
}

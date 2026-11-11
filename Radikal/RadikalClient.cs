using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace RadikalPlayers.Radikal;

public sealed class RadikalClient
{
    private const string EspClient = "radikal-esp";
    private const string WwwClient = "radikal-www";

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IMemoryCache _cache;
    private readonly RadikalOptions _options;
    private readonly ILogger<RadikalClient> _logger;
    private readonly OfficialMediaService _officialMedia;

    private static readonly TimeSpan RankingTtl = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan GeoTtl = TimeSpan.FromHours(12);
    private static readonly TimeSpan CompetitionsTtl = TimeSpan.FromMinutes(3);
    private static readonly TimeSpan DetailTtl = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan LiveTtl = TimeSpan.FromSeconds(20);
    private static readonly TimeSpan TournamentTtl = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan DianasTtl = TimeSpan.FromHours(12);
    private static readonly TimeSpan PlacesTtl = TimeSpan.FromHours(1);
    private static readonly TimeSpan NewsTtl = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan OfficialTtl = TimeSpan.FromHours(1);
    private static readonly TimeSpan ShopTtl = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan SearchTtl = TimeSpan.FromMinutes(2);

    public RadikalClient(
        IHttpClientFactory httpClientFactory,
        IMemoryCache cache,
        IOptions<RadikalOptions> options,
        ILogger<RadikalClient> logger,
        OfficialMediaService officialMedia)
    {
        _httpClientFactory = httpClientFactory;
        _cache = cache;
        _options = options.Value;
        _logger = logger;
        _officialMedia = officialMedia;
    }

    public Task<RankingResultDto> GetRankingAsync(
        string countryCode,
        string? province,
        string game,
        string diana,
        string gender,
        CancellationToken ct = default)
    {
        countryCode = string.IsNullOrWhiteSpace(countryCode) ? "724" : countryCode.Trim();
        game = string.IsNullOrWhiteSpace(game) ? "MPR" : game.Trim().ToUpperInvariant();
        diana = string.IsNullOrWhiteSpace(diana) ? "aa" : diana.Trim().ToLowerInvariant();
        gender = string.IsNullOrWhiteSpace(gender) ? "0" : gender.Trim().ToUpperInvariant();
        province ??= string.Empty;

        var key = $"ranking:{countryCode}:{province}:{game}:{diana}:{gender}";
        return CachedAsync(key, RankingTtl, async token =>
        {
            var http = _httpClientFactory.CreateClient(EspClient);
            var json = await PostFormAsync(http, "ajax.ranking.php", new Dictionary<string, string>
            {
                ["action"] = "ranking",
                ["pais"] = countryCode,
                ["provinciaID"] = province,
                ["diana"] = diana,
                ["game"] = game,
                ["gender"] = gender
            }, token);

            return RadikalParsers.ParseRanking(json, countryCode, string.IsNullOrWhiteSpace(province) ? null : province, game, diana, gender);
        }, ct);
    }

    /// <summary>
    /// Comparativa entre países: top global real (pais=0) y resumen agregado por país a partir
    /// de una muestra de cada uno. Sirve para "ranking global para comparar por países".
    /// </summary>
    public async Task<RankingGlobalDto> GetGlobalRankingAsync(
        string game,
        string diana,
        string gender,
        CancellationToken ct = default)
    {
        game = string.IsNullOrWhiteSpace(game) ? "MPR" : game.Trim().ToUpperInvariant();
        diana = string.IsNullOrWhiteSpace(diana) ? "aa" : diana.Trim().ToLowerInvariant();
        gender = string.IsNullOrWhiteSpace(gender) ? "0" : gender.Trim().ToUpperInvariant();

        var key = $"ranking:global:{game}:{diana}:{gender}";
        return await CachedAsync(key, RankingTtl, async token =>
        {
            var overall = await GetRankingAsync("0", null, game, diana, gender, token);

            // Muestra de los países con actividad: jugadores del top global.
            var countryCodes = overall.Players
                .Select(player => player.CountryCode)
                .Where(code => !string.IsNullOrWhiteSpace(code) && code != "0")
                .Distinct()
                .ToList();

            var summaries = new List<RankingCountryDto>();
            foreach (var code in countryCodes)
            {
                try
                {
                    var ranking = await GetRankingAsync(code, null, game, diana, gender, token);
                    if (ranking.Players.Count == 0) continue;

                    var values = ranking.Players
                        .Select(player => ParseRankingValue(player.Value))
                        .Where(value => value > 0)
                        .ToList();

                    if (values.Count == 0) continue;

                    summaries.Add(new RankingCountryDto(
                        code,
                        RadikalMetadata.CountryName(code),
                        ranking.Players.Count,
                        Math.Round(values.Max(), 2),
                        Math.Round(values.Average(), 2),
                        ranking.Players.FirstOrDefault()?.Alias));
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    _logger.LogDebug(ex, "No se pudo leer el ranking de {Country}", code);
                }
            }

            return new RankingGlobalDto(
                game,
                diana,
                gender,
                overall.Players,
                summaries
                    .OrderByDescending(item => item.Best)
                    .ThenByDescending(item => item.Average)
                    .ToList(),
                DateTimeOffset.UtcNow);
        }, ct);
    }

    private static double ParseRankingValue(string value) =>
        double.TryParse(value?.Replace(',', '.'),
            System.Globalization.NumberStyles.Float,
            System.Globalization.CultureInfo.InvariantCulture,
            out var parsed)
            ? parsed
            : 0;

    public Task<IReadOnlyList<ProvinceDto>> GetProvincesAsync(string countryCode, CancellationToken ct = default)
    {
        countryCode = string.IsNullOrWhiteSpace(countryCode) ? "724" : countryCode.Trim();
        var key = $"geo:provinces:{countryCode}";
        return CachedAsync(key, GeoTtl, async token =>
        {
            var http = _httpClientFactory.CreateClient(EspClient);
            var json = await PostFormAsync(http, "ajax.navegacion_competiciones.php", new Dictionary<string, string>
            {
                ["accion"] = "listarProvincias",
                ["paisID"] = countryCode
            }, token);
            return RadikalParsers.ParseProvinces(json);
        }, ct);
    }

    public Task<IReadOnlyList<LocalityDto>> GetLocalitiesAsync(string countryCode, string province, CancellationToken ct = default)
    {
        countryCode = string.IsNullOrWhiteSpace(countryCode) ? "724" : countryCode.Trim();
        var key = $"geo:localities:{countryCode}:{province}";
        return CachedAsync(key, GeoTtl, async token =>
        {
            var http = _httpClientFactory.CreateClient(EspClient);
            var json = await PostFormAsync(http, "ajax.navegacion_competiciones.php", new Dictionary<string, string>
            {
                ["accion"] = "listarLocalidades",
                ["provinciaID"] = province,
                ["paisID"] = countryCode
            }, token);
            return RadikalParsers.ParseLocalities(json);
        }, ct);
    }

    public Task<IReadOnlyList<LocalDto>> GetLocalesAsync(string locality, CancellationToken ct = default)
    {
        var key = $"geo:locales:{locality}";
        return CachedAsync(key, GeoTtl, async token =>
        {
            var http = _httpClientFactory.CreateClient(EspClient);
            var json = await PostFormAsync(http, "ajax.navegacion_competiciones.php", new Dictionary<string, string>
            {
                ["accion"] = "listarLocales",
                ["localidadID"] = locality
            }, token);
            return RadikalParsers.ParseLocales(json);
        }, ct);
    }

    public Task<IReadOnlyList<CompetitionSummaryDto>> GetCompetitionCatalogAsync(
        string countryCode,
        string? province,
        string? locality,
        string? localId,
        string? type,
        string? status,
        int year,
        int month,
        int day,
        CancellationToken ct = default)
    {
        countryCode = string.IsNullOrWhiteSpace(countryCode) ? "724" : countryCode.Trim();
        type = string.IsNullOrWhiteSpace(type) ? "0" : type.Trim().ToUpperInvariant();
        status = string.IsNullOrWhiteSpace(status) ? "0" : status.Trim().ToLowerInvariant();
        province ??= "0";
        locality ??= "0";
        localId ??= "0";

        var upstreamStatus = status switch
        {
            "live" => "cursando",
            "upcoming" => "por_comenzar",
            "finished" => "finalizado",
            _ => "0"
        };

        var key = $"competitions:{countryCode}:{province}:{locality}:{localId}:{type}:{upstreamStatus}:{year}:{month}:{day}";
        return CachedAsync(key, CompetitionsTtl, async token =>
        {
            var http = _httpClientFactory.CreateClient(EspClient);
            var json = await PostFormAsync(http, "ajax.competiciones.php", new Dictionary<string, string>
            {
                ["action"] = "filtro",
                ["año"] = year.ToString(CultureInfo.InvariantCulture),
                ["mes"] = month.ToString(CultureInfo.InvariantCulture),
                ["dia"] = day.ToString(CultureInfo.InvariantCulture),
                ["pais"] = countryCode,
                ["provinciaID"] = string.IsNullOrWhiteSpace(province) ? "0" : province,
                ["localidadID"] = string.IsNullOrWhiteSpace(locality) ? "0" : locality,
                ["localID"] = string.IsNullOrWhiteSpace(localId) ? "0" : localId,
                ["game"] = type,
                ["operadorID"] = "0",
                ["estadocomp"] = upstreamStatus,
                ["timezone"] = _options.DefaultTimezone
            }, token);

            var html = UnwrapJsonString(json);
            return RadikalParsers.ParseCompetitionCards(html);
        }, ct);
    }

    public async Task<CompetitionListDto> GetCompetitionsAsync(
        string countryCode,
        string? province,
        string? locality,
        string? localId,
        string? type,
        string? status,
        int year,
        int month,
        int day,
        string? query,
        bool includeFinished,
        int page,
        int pageSize,
        CancellationToken ct = default)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 60);

        var catalog = await GetCompetitionCatalogAsync(
            countryCode, province, locality, localId, type, status, year, month, day, ct);

        IEnumerable<CompetitionSummaryDto> filtered = catalog;

        if (!includeFinished && string.IsNullOrWhiteSpace(status))
            filtered = filtered.Where(c => c.Status != "finished");

        if (!string.IsNullOrWhiteSpace(query))
        {
            var q = query.Trim();
            filtered = filtered.Where(c =>
                c.Name.Contains(q, StringComparison.OrdinalIgnoreCase) ||
                c.TypeLabel.Contains(q, StringComparison.OrdinalIgnoreCase) ||
                (c.Game?.Contains(q, StringComparison.OrdinalIgnoreCase) ?? false));
        }

        var list = filtered.ToList();
        var total = list.Count;
        var totalPages = Math.Max(1, (int)Math.Ceiling(total / (double)pageSize));
        if (page > totalPages) page = totalPages;

        return new CompetitionListDto(
            Total: total,
            Page: page,
            PageSize: pageSize,
            TotalPages: totalPages,
            FetchedAt: DateTimeOffset.UtcNow,
            Items: list.Skip((page - 1) * pageSize).Take(pageSize).ToList());
    }

    public Task<CompetitionDetailDto> GetCompetitionDetailAsync(int id, string type, CancellationToken ct = default)
    {
        type = string.IsNullOrWhiteSpace(type) ? "TORX" : type.Trim().ToUpperInvariant();
        var key = $"competition-detail:{id}:{type}";

        return CachedAsync(key, DetailTtl, async token =>
        {
            var http = _httpClientFactory.CreateClient(EspClient);
            var standingsTask = GetStringAsync(http,
                $"competiciones2.php?compid={id}&tipo={Uri.EscapeDataString(type)}&ident=0", token);
            var infoTask = GetStringAsync(http,
                $"competiciones.info.php?compid={id}&tipo={Uri.EscapeDataString(type)}&ident=0", token);

            await Task.WhenAll(standingsTask, infoTask);

            var standings = RadikalParsers.ParseStandings(await standingsTask);
            var info = RadikalParsers.ParseCompetitionInfo(await infoTask);

            CompetitionSummaryDto? summary = null;
            try
            {
                var catalog = await GetCompetitionCatalogAsync("724", "0", "0", "0", "0", "0", 0, 0, 0, token);
                summary = catalog.FirstOrDefault(c => c.Id == id && c.Type == type) ??
                          catalog.FirstOrDefault(c => c.Id == id);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "No se pudo cargar el catálogo para la competición {Id}", id);
            }

            summary ??= new CompetitionSummaryDto(
                id,
                type,
                type,
                info.Name ?? $"Competición {id}",
                "unknown",
                false,
                info.Game,
                info.StartsAt,
                info.EndsAt);

            return new CompetitionDetailDto(
                summary,
                info,
                standings,
                type == "TORX",
                DateTimeOffset.UtcNow);
        }, ct);
    }

    public Task<LiveStatusDto> GetLiveAsync(CancellationToken ct = default)
    {
        return CachedAsync("live:status", LiveTtl, async token =>
        {
            var http = _httpClientFactory.CreateClient(EspClient);

            var statusTask = PostFormAsync(http, "ajax.gateway.php", new Dictionary<string, string>
            {
                ["accion"] = "endirecto"
            }, token);

            var liveTask = PostFormAsync(http, "competiciones.online.ajax.php", new Dictionary<string, string>
            {
                ["accion"] = "live"
            }, token);

            await Task.WhenAll(statusTask, liveTask);

            var isLive = (await statusTask).Contains("\"OK\"", StringComparison.OrdinalIgnoreCase);
            IReadOnlyList<LiveCompetitionDto> competitions = Array.Empty<LiveCompetitionDto>();
            try
            {
                competitions = RadikalParsers.ParseLiveCompetitions(await liveTask);
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "No se pudieron parsear las competiciones en directo");
            }

            return new LiveStatusDto(
                isLive || competitions.Count > 0,
                isLive || competitions.Count > 0
                    ? "Hay competiciones Radikal en directo"
                    : "Ahora mismo no hay partidas en directo",
                competitions,
                DateTimeOffset.UtcNow);
        }, ct);
    }

    public Task<LiveMatchListDto> GetLiveMatchesAsync(CancellationToken ct = default)
    {
        return CachedAsync("live:matches", TimeSpan.FromSeconds(10), async token =>
        {
            var http = _httpClientFactory.CreateClient(EspClient);
            var json = await PostFormAsync(http, "competiciones.online.ajax.php", new Dictionary<string, string>
            {
                ["accion"] = "accion"
            }, token);
            return RadikalParsers.ParseLiveMatches(json);
        }, ct);
    }

    public Task<LiveDartsDto> GetLiveDartsAsync(int competitionId, long matchId, int game, CancellationToken ct = default)
    {
        var key = $"live:darts:{competitionId}:{matchId}:{game}";
        return CachedAsync(key, TimeSpan.FromSeconds(2), async token =>
        {
            var http = _httpClientFactory.CreateClient(WwwClient);
            var json = await GetStringAsync(http,
                $"dianas/Radikal/visualizaPartidaJSON.php?all=1&compid={competitionId}&encid={matchId}&ngame={game}&t={DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}",
                token);
            return RadikalParsers.ParseLiveDarts(json, competitionId, matchId, game);
        }, ct);
    }

    public Task<TournamentBracketDto> GetTournamentAsync(int competitionId, CancellationToken ct = default)
    {
        var key = $"tournament:{competitionId}";
        return CachedAsync(key, TournamentTtl, async token =>
        {
            var http = _httpClientFactory.CreateClient(WwwClient);
            var json = await GetStringAsync(http,
                $"dianas/Radikal/visualizaTorneoJSON.php?compid={competitionId}&t={DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}&timezonevt={Uri.EscapeDataString(_options.DefaultTimezone)}",
                token);
            return RadikalParsers.ParseTournamentBracket(json);
        }, ct);
    }

    public Task<ActaDto> GetActaAsync(int competitionId, int cellId, CancellationToken ct = default)
    {
        var key = $"acta:{competitionId}:{cellId}";
        return CachedAsync(key, TournamentTtl, async token =>
        {
            var http = _httpClientFactory.CreateClient(WwwClient);
            var json = await GetStringAsync(http,
                $"dianas/Radikal/visualizaTorneoJSON.php?compid={competitionId}&encid={cellId}&t={DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}&timezonevt={Uri.EscapeDataString(_options.DefaultTimezone)}",
                token);
            return RadikalParsers.ParseActa(json);
        }, ct);
    }

    public Task<IReadOnlyList<CompetitionSearchItemDto>> SearchTournamentsAsync(string query, CancellationToken ct = default)
    {
        query = (query ?? string.Empty).Trim();
        if (query.Length < 2) return Task.FromResult<IReadOnlyList<CompetitionSearchItemDto>>(Array.Empty<CompetitionSearchItemDto>());

        var key = $"search:tournaments:{query.ToLowerInvariant()}";
        return CachedAsync<IReadOnlyList<CompetitionSearchItemDto>>(key, SearchTtl, async token =>
        {
            var http = _httpClientFactory.CreateClient(EspClient);
            var text = await GetStringAsync(http,
                $"ajax.competiciones.autocomplete.php?q={Uri.EscapeDataString(query)}", token);
            return RadikalParsers.ParseCompetitionSearch(text)
                .Where(c => c.Type == "TORX")
                .Take(25)
                .ToList();
        }, ct);
    }

    public Task<DianaListDto> GetDianasAsync(CancellationToken ct = default)
    {
        return CachedAsync("dianas:all", DianasTtl, async token =>
        {
            var http = _httpClientFactory.CreateClient(WwwClient);
            var html = await GetStringAsync(http, "dianas/Radikal/Maps/mapav4.php", token);
            return RadikalParsers.ParseDianas(html);
        }, ct);
    }

    public Task<DianaDetailDto> GetDianaDetailAsync(long id, CancellationToken ct = default)
    {
        var key = $"diana:{id}";
        return CachedAsync(key, PlacesTtl, async token =>
        {
            var http = _httpClientFactory.CreateClient(WwwClient);
            var html = await GetStringAsync(http, $"dianas/Radikal/Maps/iframev4.php?ident={id}", token);
            return RadikalParsers.ParseDianaDetail(html, id);
        }, ct);
    }

    public Task<IReadOnlyList<TopPlaceDto>> GetTopPlacesAsync(CancellationToken ct = default)
    {
        return CachedAsync("places:top", PlacesTtl, async token =>
        {
            var http = _httpClientFactory.CreateClient(EspClient);
            var html = await GetStringAsync(http, "topplaces/", token);
            return RadikalParsers.ParseTopPlaces(html);
        }, ct);
    }

    public Task<NewsListDto> GetNewsAsync(int page, int pageSize, CancellationToken ct = default)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 24);
        var key = $"news:{page}:{pageSize}";

        return CachedAsync(key, NewsTtl, async token =>
        {
            var http = _httpClientFactory.CreateClient(EspClient);
            var html = await GetStringAsync(http, $"noticias.php?pageNum_rsNoticias={page - 1}", token);
            var items = RadikalParsers.ParseNewsList(html);
            var totalPages = RadikalParsers.ParseNewsTotalPages(html);

            return new NewsListDto(page, items.Count, totalPages, items.Take(pageSize).ToList());
        }, ct);
    }

    public Task<NewsDetailDto> GetNewsDetailAsync(int id, CancellationToken ct = default)
    {
        var key = $"news:detail:{id}";
        return CachedAsync(key, NewsTtl, async token =>
        {
            var http = _httpClientFactory.CreateClient(EspClient);
            var url = $"noticias-detalle.php?noticiaID={id}";
            var html = await GetStringAsync(http, url, token);
            return RadikalParsers.ParseNewsDetail(html, id, new Uri(new Uri(_options.EspBaseUrl), url).ToString());
        }, ct);
    }

    public Task<OfficialPlayerListDto> GetOfficialPlayersAsync(CancellationToken ct = default)
    {
        return CachedAsync("official:all", OfficialTtl, async token =>
        {
            var http = _httpClientFactory.CreateClient(EspClient);
            var html = await GetStringAsync(http, "officialplayers/index.php", token);
            var items = RadikalParsers.ParseOfficialPlayers(html);
            var byType = items
                .GroupBy(p => p.Type)
                .ToDictionary(g => g.Key, g => g.Count(), StringComparer.OrdinalIgnoreCase);
            return new OfficialPlayerListDto(items.Count, byType, items);
        }, ct);
    }

    public async Task<OfficialPlayerDetailDto> GetOfficialPlayerAsync(int id, CancellationToken ct = default)
    {
        var key = $"official:detail:{id}";
        return await CachedAsync(key, OfficialTtl, async token =>
        {
            var http = _httpClientFactory.CreateClient(EspClient);
            var detailTask = GetStringAsync(http, $"officialplayers/officialplayer.php?officialplayer_id={id}", token);
            var listTask = GetOfficialPlayersAsync(token);
            await Task.WhenAll(detailTask, listTask);

            var list = await listTask;
            var summary = list.Items.FirstOrDefault(p => p.Id == id);
            var type = summary?.Type ?? "SILVER";
            var alias = summary?.Alias ?? string.Empty;
            var photo = summary?.PhotoUrl;

            var detail = RadikalParsers.ParseOfficialPlayerDetail(await detailTask, id, type, alias, photo, summary?.Socials);

            // Medimos cada imagen para distinguir el retrato de la ficha técnica apaisada.
            var enriched = new List<OfficialMediaDto>(detail.Media.Count);
            foreach (var item in detail.Media)
            {
                var (width, height) = await _officialMedia.GetSizeAsync(item.Id, token);
                enriched.Add(item with { Width = width, Height = height });
            }

            var portrait = enriched.FirstOrDefault(item => item.IsPortrait) ?? enriched.FirstOrDefault();
            var techCard = enriched.FirstOrDefault(item => item.IsLandscape);

            var portraitUrl = portrait is null
                ? detail.PhotoUrl
                : $"{portrait.Url}&w=900";

            var techCardUrl = techCard is null ? null : $"{techCard.Url}&w=1600";

            return detail with
            {
                Media = enriched,
                PortraitUrl = portraitUrl,
                TechCardUrl = techCardUrl
            };
        }, ct);
    }

    public Task<ShopDto> GetShopAsync(CancellationToken ct = default)
    {
        return CachedAsync("shop:all", ShopTtl, async token =>
        {
            var http = _httpClientFactory.CreateClient(EspClient);
            var definitions = new[]
            {
                (Id: 1, Name: "Personalización"),
                (Id: 7, Name: "Material"),
                (Id: 3, Name: "Suscripción"),
                (Id: 5, Name: "Inscripción")
            };

            var tasks = definitions
                .Select(definition => GetStringAsync(http, $"shop/index.php?type_id={definition.Id}", token))
                .ToArray();
            await Task.WhenAll(tasks);

            var categories = new List<ShopCategoryDto>();
            for (var i = 0; i < definitions.Length; i++)
            {
                var products = RadikalParsers.ParseShopProducts(await tasks[i]);
                categories.Add(new ShopCategoryDto(definitions[i].Id, definitions[i].Name, products));
            }

            return new ShopDto(categories, DateTimeOffset.UtcNow);
        }, ct);
    }

    public Task<ShopProductDto> GetShopProductAsync(int productId, string? category = null, CancellationToken ct = default)
    {
        return CachedAsync($"shop:product:{productId}", ShopTtl, async token =>
        {
            var http = _httpClientFactory.CreateClient(EspClient);
            var html = await GetStringAsync(http, $"shop/product.php?product_id={productId}", token);
            return RadikalParsers.ParseShopProductDetail(html, productId, category);
        }, ct);
    }

    /// <summary>Flujo del vídeo oficial de un producto (soporta Range para poder buscar en la barra).</summary>
    public async Task<HttpResponseMessage> GetShopMediaVideoAsync(
        int mediaId,
        string? range,
        CancellationToken ct)
    {
        var http = _httpClientFactory.CreateClient(EspClient);
        var request = new HttpRequestMessage(HttpMethod.Get, $"shop/media.php?productmedia_id={mediaId}");
        if (!string.IsNullOrWhiteSpace(range))
            request.Headers.TryAddWithoutValidation("Range", range);

        return await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
    }

    /// <summary>Fotograma de previsualización del vídeo oficial de un producto.</summary>
    public async Task<HttpResponseMessage> GetShopMediaPosterAsync(int mediaId, CancellationToken ct)
    {
        var http = _httpClientFactory.CreateClient(EspClient);
        return await http.GetAsync($"shop/mediapreview.php?productmedia_id={mediaId}", ct);
    }

    public async Task<HomeDto> GetHomeAsync(CancellationToken ct = default)
    {
        var rankingTask = GetRankingAsync("724", null, "MPR", "aa", "0", ct);
        var competitionsTask = GetCompetitionsAsync("724", null, null, null, "0", "0", 0, 0, 0, null, false, 1, 60, ct);
        var upcomingTask = GetCompetitionsAsync("724", null, null, null, "0", "upcoming", 0, 0, 0, null, false, 1, 12, ct);
        var placesTask = GetTopPlacesAsync(ct);
        var newsTask = GetNewsAsync(1, 4, ct);
        var liveTask = GetLiveAsync(ct);
        var officialTask = GetOfficialPlayersAsync(ct);
        var dianasTask = GetDianasAsync(ct);

        await Task.WhenAll(rankingTask, competitionsTask, upcomingTask, placesTask, newsTask, liveTask, officialTask, dianasTask);

        var ranking = await rankingTask;
        var competitions = await competitionsTask;
        var upcoming = await upcomingTask;
        var places = await placesTask;
        var news = await newsTask;
        var live = await liveTask;
        var official = await officialTask;
        var dianas = await dianasTask;

        var featured = (upcoming.Items.Count > 0 ? upcoming.Items : competitions.Items)
            .Where(c => c.Status is "upcoming" or "live" or "unknown")
            .OrderBy(c => c.Status == "upcoming" ? 0 : 1)
            .ThenBy(c => c.StartsAt ?? DateTime.MaxValue)
            .Take(6)
            .ToList();

        return new HomeDto(
            live,
            ranking,
            featured,
            places.OrderByDescending(p => p.Type == "PLATINUM")
                  .ThenByDescending(p => p.Machines)
                  .Take(4)
                  .ToList(),
            news.Items,
            new HomeStatsDto(
                Dianas: dianas.Total,
                OfficialPlayers: official.Total,
                Countries: RadikalMetadata.Countries.Count(c => c.Code != "0"),
                TopPlayers: ranking.Players.Count,
                Competitions: competitions.Total),
            DateTimeOffset.UtcNow);
    }

    public async Task<IReadOnlyList<SearchResultDto>> SearchAsync(string query, CancellationToken ct = default)
    {
        query = (query ?? string.Empty).Trim();
        if (query.Length < 2) return Array.Empty<SearchResultDto>();

        var key = $"search:all:{query.ToLowerInvariant()}";
        return await CachedAsync(key, SearchTtl, async token =>
        {
            var http = _httpClientFactory.CreateClient(EspClient);

            var compTask = GetStringAsync(http, $"ajax.competiciones.autocomplete.php?q={Uri.EscapeDataString(query)}", token);
            var machineTask = GetStringAsync(http, $"ajax.maquina.autocomplete.php?q={Uri.EscapeDataString(query)}", token);
            var placeTask = GetStringAsync(http, $"topplaces/ajax.location.autocomplete.php?q={Uri.EscapeDataString(query)}", token);

            await Task.WhenAll(compTask, machineTask, placeTask);

            var results = new List<SearchResultDto>();

            foreach (var comp in RadikalParsers.ParseCompetitionSearch(await compTask).Take(5))
            {
                results.Add(new SearchResultDto(
                    "competition",
                    comp.Id.ToString(CultureInfo.InvariantCulture),
                    comp.Name,
                    $"{comp.Type} · #{comp.Id}",
                    $"#/competiciones/{comp.Id}?type={Uri.EscapeDataString(comp.Type)}"));
            }

            foreach (var line in (await machineTask).Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Take(5))
            {
                var parts = line.Split('|');
                if (parts.Length < 2) continue;
                var labels = parts[0].Split(':');
                results.Add(new SearchResultDto(
                    "diana",
                    parts[1],
                    labels[0],
                    string.Join(" · ", labels.Skip(1)),
                    $"#/lugares?machine={Uri.EscapeDataString(parts[1])}"));
            }

            foreach (var line in (await placeTask).Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Take(5))
            {
                var parts = line.Split('|');
                if (parts.Length < 2) continue;
                results.Add(new SearchResultDto(
                    "place",
                    parts[1],
                    RadikalParsers.Clean(parts[0]),
                    "Top Place",
                    $"#/lugares?place={Uri.EscapeDataString(parts[1])}"));
            }

            return results;
        }, ct);
    }

    private async Task<T> CachedAsync<T>(string key, TimeSpan ttl, Func<CancellationToken, Task<T>> factory, CancellationToken ct)
    {
        if (_cache.TryGetValue(key, out T? cached) && cached is not null)
            return cached;

        var value = await factory(ct);
        _cache.Set(key, value, new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = ttl
        });
        return value;
    }

    private static async Task<string> GetStringAsync(HttpClient http, string path, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.TryAddWithoutValidation("Accept", "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8");
        request.Headers.TryAddWithoutValidation("X-Requested-With", "XMLHttpRequest");
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadAsStringAsync(ct);
    }

    private static async Task<string> PostFormAsync(
        HttpClient http,
        string path,
        Dictionary<string, string> form,
        CancellationToken ct)
    {
        using var content = new FormUrlEncodedContent(form);
        using var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = content };
        request.Headers.TryAddWithoutValidation("Accept", "application/json, text/javascript, */*; q=0.01");
        request.Headers.TryAddWithoutValidation("X-Requested-With", "XMLHttpRequest");
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadAsStringAsync(ct);
    }

    private static string UnwrapJsonString(string value)
    {
        var trimmed = value.Trim();
        if (trimmed.Length >= 2 && trimmed[0] == '"' && trimmed[^1] == '"')
        {
            try
            {
                return System.Text.Json.JsonSerializer.Deserialize<string>(trimmed) ?? string.Empty;
            }
            catch
            {
                // El endpoint devuelve HTML serializado como string JSON.
            }
        }
        return trimmed;
    }
}

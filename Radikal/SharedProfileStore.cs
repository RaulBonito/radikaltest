using System.Text.Json;
using Microsoft.Extensions.Configuration;

namespace RadikalPlayers.Radikal;

/// <summary>
/// Guarda el perfil público que el jugador decide compartir: medias PPD/MPR y competiciones.
/// Persiste en App_Data/shared-ratings.json para sobrevivir a reinicios.
/// </summary>
public sealed class SharedProfileStore
{
    private readonly string _filePath;
    private readonly ILogger<SharedProfileStore> _logger;
    private readonly object _gate = new();
    private Dictionary<string, SharedProfileRecord> _records;

    public SharedProfileStore(IWebHostEnvironment environment, IConfiguration configuration, ILogger<SharedProfileStore> logger)
    {
        _logger = logger;
        var directory = AppDataPaths.Resolve(environment, configuration);
        Directory.CreateDirectory(directory);
        _filePath = Path.Combine(directory, "shared-ratings.json");
        _records = Load();
    }

    public bool GetShareRatings(string radikalId)
    {
        lock (_gate)
        {
            return NormalizeId(radikalId) is { } id &&
                   _records.TryGetValue(id, out var record) &&
                   record.ShareRatings;
        }
    }

    public SharedProfileRecord? GetPublic(string radikalId)
    {
        lock (_gate)
        {
            var id = NormalizeId(radikalId);
            if (id is null || !_records.TryGetValue(id, out var record)) return null;
            return Clone(record);
        }
    }

    public void SetShareRatings(string radikalId, bool share)
    {
        var id = NormalizeId(radikalId);
        if (id is null) return;

        lock (_gate)
        {
            if (!_records.TryGetValue(id, out var record))
            {
                record = new SharedProfileRecord();
                _records[id] = record;
            }

            record.ShareRatings = share;
            if (!share)
            {
                // Al desactivarlo no se publican medias.
                record.Ppd = null;
                record.Mpr = null;
                record.PreferredDiana = null;
            }

            record.UpdatedAt = DateTimeOffset.UtcNow;
            SaveLocked();
        }
    }

    /// <summary>Guarda las medias y competiciones reales del jugador en su perfil público.</summary>
    public void Update(string radikalId, PlayerRatingDto rating)
    {
        var id = NormalizeId(radikalId);
        if (id is null) return;

        lock (_gate)
        {
            if (!_records.TryGetValue(id, out var record))
            {
                record = new SharedProfileRecord();
                _records[id] = record;
            }

            // Las competiciones son públicas; las medias solo si el jugador las comparte.
            record.Competitions = rating.Competitions
                .Take(20)
                .Select(competition => new SharedCompetitionRecord
                {
                    Id = competition.Id,
                    Name = competition.Name,
                    Type = competition.Type,
                    Finished = competition.Finished
                })
                .ToList();

            if (record.ShareRatings)
            {
                record.Ppd = rating.Ppd;
                record.Mpr = rating.Mpr;
                record.PreferredDiana = rating.PreferredDiana;
            }

            record.UpdatedAt = DateTimeOffset.UtcNow;
            SaveLocked();
        }
    }

    /// <summary>Guarda las medias del login si el jugador ya había activado compartirlas.</summary>
    public void SaveOnLogin(string radikalId, string? ppd, string? mpr)
    {
        var id = NormalizeId(radikalId);
        if (id is null) return;

        lock (_gate)
        {
            if (!_records.TryGetValue(id, out var record) || !record.ShareRatings) return;

            record.Ppd = ppd;
            record.Mpr = mpr;
            record.PreferredDiana = ParseDiana(ppd) ?? ParseDiana(mpr);
            record.UpdatedAt = DateTimeOffset.UtcNow;
            SaveLocked();
        }
    }

    private static string? ParseDiana(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var start = value.IndexOf('(');
        var end = value.IndexOf(')', start + 1);
        return start >= 0 && end > start + 1 ? value[(start + 1)..end] : null;
    }

    private static string? NormalizeId(string? value)
    {
        var id = (value ?? string.Empty).Trim().ToUpperInvariant();
        return id.Length is < 4 or > 24 ? null : id;
    }

    private static SharedProfileRecord Clone(SharedProfileRecord record) => new()
    {
        ShareRatings = record.ShareRatings,
        Ppd = record.Ppd,
        Mpr = record.Mpr,
        PreferredDiana = record.PreferredDiana,
        Competitions = record.Competitions.Select(competition => new SharedCompetitionRecord
        {
            Id = competition.Id,
            Name = competition.Name,
            Type = competition.Type,
            Finished = competition.Finished
        }).ToList(),
        UpdatedAt = record.UpdatedAt
    };

    private Dictionary<string, SharedProfileRecord> Load()
    {
        try
        {
            if (!File.Exists(_filePath)) return new Dictionary<string, SharedProfileRecord>(StringComparer.OrdinalIgnoreCase);
            var json = File.ReadAllText(_filePath);
            var records = JsonSerializer.Deserialize<Dictionary<string, SharedProfileRecord>>(json);
            return new Dictionary<string, SharedProfileRecord>(
                records ?? new Dictionary<string, SharedProfileRecord>(),
                StringComparer.OrdinalIgnoreCase);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "No se pudo leer el perfil público compartido");
            return new Dictionary<string, SharedProfileRecord>(StringComparer.OrdinalIgnoreCase);
        }
    }

    private void SaveLocked()
    {
        try
        {
            var json = JsonSerializer.Serialize(_records, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(_filePath, json);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "No se pudo guardar el perfil público compartido");
        }
    }
}

public sealed class SharedProfileRecord
{
    public bool ShareRatings { get; set; }
    public string? Ppd { get; set; }
    public string? Mpr { get; set; }
    public string? PreferredDiana { get; set; }
    public List<SharedCompetitionRecord> Competitions { get; set; } = new();
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed class SharedCompetitionRecord
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public bool Finished { get; set; }
}

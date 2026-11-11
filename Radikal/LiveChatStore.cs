using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;

namespace RadikalPlayers.Radikal;

/// <summary>Mensaje del chat de un directo.</summary>
public sealed record ChatMessageDto(
    long Id,
    string Room,
    string Name,
    string Text,
    DateTimeOffset SentAt);

/// <summary>
/// Chat local de los directos. No depende de Radikal: guarda los mensajes en
/// <c>App_Data/chat/{sala}.json</c> para que la conversación sobreviva a reinicios.
/// </summary>
public sealed class LiveChatStore
{
    private const int MaxMessages = 300;

    private readonly string _root;
    private readonly ILogger<LiveChatStore> _logger;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly Dictionary<string, List<ChatMessageDto>> _rooms = new(StringComparer.Ordinal);
    private readonly JsonSerializerOptions _json = new() { WriteIndented = true };

    public LiveChatStore(IWebHostEnvironment environment, IConfiguration configuration, ILogger<LiveChatStore> logger)
    {
        _root = Path.Combine(AppDataPaths.Resolve(environment, configuration), "chat");
        _logger = logger;
    }

    public async Task<IReadOnlyList<ChatMessageDto>> GetAsync(string room, long after, CancellationToken ct)
    {
        var key = NormalizeRoom(room);
        await _gate.WaitAsync(ct);
        try
        {
            var messages = await LoadNoLockAsync(key, ct);
            if (after <= 0) return messages.ToList();
            return messages.Where(message => message.Id > after).ToList();
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<ChatMessageDto> AddAsync(string room, string? name, string? text, CancellationToken ct)
    {
        var key = NormalizeRoom(room);
        var author = Sanitize(name, 28);
        if (string.IsNullOrWhiteSpace(author)) author = "Aficionado";

        var body = Sanitize(text, 400);
        if (string.IsNullOrWhiteSpace(body))
            throw new ArgumentException("El mensaje está vacío.");

        await _gate.WaitAsync(ct);
        try
        {
            var messages = await LoadNoLockAsync(key, ct);
            var id = messages.Count == 0 ? 1 : messages[^1].Id + 1;
            var message = new ChatMessageDto(id, key, author, body, DateTimeOffset.UtcNow);
            messages.Add(message);
            if (messages.Count > MaxMessages)
                messages.RemoveRange(0, messages.Count - MaxMessages);

            await SaveNoLockAsync(key, messages, ct);
            return message;
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task<List<ChatMessageDto>> LoadNoLockAsync(string room, CancellationToken ct)
    {
        if (_rooms.TryGetValue(room, out var cached)) return cached;

        var path = PathFor(room);
        var messages = new List<ChatMessageDto>();
        try
        {
            if (File.Exists(path))
            {
                await using var stream = File.OpenRead(path);
                var loaded = await JsonSerializer.DeserializeAsync<List<ChatMessageDto>>(stream, _json, ct);
                if (loaded is not null) messages = loaded;
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "No se pudo leer el chat {Room}; se empieza de cero", room);
            messages = new List<ChatMessageDto>();
        }

        _rooms[room] = messages;
        return messages;
    }

    private async Task SaveNoLockAsync(string room, List<ChatMessageDto> messages, CancellationToken ct)
    {
        try
        {
            Directory.CreateDirectory(_root);
            var path = PathFor(room);
            var temp = $"{path}.tmp";
            await using (var stream = File.Create(temp))
            {
                await JsonSerializer.SerializeAsync(stream, messages, _json, ct);
            }
            File.Move(temp, path, true);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "No se pudo guardar el chat {Room}", room);
        }
    }

    private string PathFor(string room) => Path.Combine(_root, $"{room}.json");

    private static string NormalizeRoom(string room)
    {
        var builder = new StringBuilder();
        foreach (var ch in (room ?? string.Empty).Trim().ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(ch) && ch < 128) builder.Append(ch);
            else if (ch is '-' or '_') builder.Append(ch);
            if (builder.Length >= 60) break;
        }

        var value = builder.ToString().Trim('-', '_');
        return string.IsNullOrWhiteSpace(value) ? "general" : value;
    }

    private static string Sanitize(string? value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;

        var builder = new StringBuilder(value.Length);
        var lastWasSpace = false;
        foreach (var ch in value)
        {
            if (char.IsControl(ch)) continue;
            if (char.IsWhiteSpace(ch))
            {
                if (!lastWasSpace) builder.Append(' ');
                lastWasSpace = true;
                continue;
            }

            lastWasSpace = false;
            builder.Append(ch);
            if (builder.Length >= maxLength) break;
        }

        return builder.ToString().Trim();
    }
}

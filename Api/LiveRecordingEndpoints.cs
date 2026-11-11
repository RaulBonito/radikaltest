using System.Globalization;
using System.Text;
using RadikalPlayers.Radikal;

namespace RadikalPlayers.Api;

public static class LiveRecordingEndpoints
{
    public static IEndpointRouteBuilder MapLiveRecordingApi(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api");

        api.MapGet("/live/recordings", async (
            bool? active,
            LiveRecordingStore store,
            CancellationToken ct) =>
        {
            var items = active == true
                ? await store.GetActiveAsync(TimeSpan.FromHours(6), ct)
                : await store.GetAllAsync(ct);
            return Results.Ok(new { items, fetchedAt = DateTimeOffset.UtcNow });
        });

        api.MapGet("/live/recordings/{compid:int}/{encid:long}/{ngame:int}", async (
            int compid,
            long encid,
            int ngame,
            LiveRecordingStore store,
            CancellationToken ct) =>
        {
            var recording = await store.GetAsync(compid, encid, ngame, ct);
            return recording is null
                ? Results.NotFound(new { title = "No hay ninguna grabación para esta partida." })
                : Results.Ok(recording);
        });

        api.MapGet("/live/recordings/{compid:int}/{encid:long}/{ngame:int}/csv", async (
            int compid,
            long encid,
            int ngame,
            LiveRecordingStore store,
            CancellationToken ct) =>
        {
            var recording = await store.GetAsync(compid, encid, ngame, ct);
            if (recording is null)
                return Results.NotFound(new { title = "No hay ninguna grabación para esta partida." });

            var bytes = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(BuildCsv(recording))).ToArray();
            var slug = Slug($"{recording.Title}-{compid}-{encid}-{ngame}");
            return Results.File(bytes, "text/csv; charset=utf-8", $"{slug}.csv");
        });

        api.MapDelete("/live/recordings/{compid:int}/{encid:long}/{ngame:int}", async (
            int compid,
            long encid,
            int ngame,
            LiveRecordingStore store,
            CancellationToken ct) =>
        {
            var deleted = await store.DeleteAsync(compid, encid, ngame, ct);
            return deleted ? Results.NoContent() : Results.NotFound();
        });

        // Fuerza un sondeo ahora mismo (por si el usuario abre la grabación de una partida recién lanzada).
        api.MapPost("/live/recordings/{compid:int}/{encid:long}/{ngame:int}/sync", async (
            int compid,
            long encid,
            int ngame,
            LiveRecordingService service,
            LiveRecordingStore store,
            CancellationToken ct) =>
        {
            var summary = await service.PollNowAsync(
                new LiveMatchDto(compid, encid, ngame, string.Empty, string.Empty),
                ct);

            if (summary is null)
                return Results.Ok(new { captured = 0, live = false });

            return Results.Ok(new
            {
                captured = summary.TotalDarts,
                live = !summary.IsFinished,
                lastSeenAt = store.GetLastSync(compid, encid, ngame)
            });
        });

        return app;
    }

    private static string BuildCsv(RecordedRecordingDto recording)
    {
        var builder = new StringBuilder();
        builder.AppendLine("Dardo;Ronda;Jugador;Jugador index;Tirada;Zona;Sector;Multiplicador;Puntos;Capturado");

        foreach (var dart in recording.Darts)
        {
            builder.AppendLine(string.Join(';',
                Escape(dart.Index + 1),
                Escape(dart.Round),
                Escape(dart.PlayerName),
                Escape(dart.PlayerIndex + 1),
                Escape(dart.Dart),
                Escape(dart.HitRegion),
                Escape(dart.Sector == 0 ? "BULL" : dart.Sector),
                Escape(dart.Multiplier),
                Escape(dart.Score),
                Escape(dart.CapturedAt.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture))));
        }

        if (recording.PlayerStats.Count > 0)
        {
            builder.AppendLine();
            builder.AppendLine("Jugador;Dardos;Aciertos;Triples;Dobles;Bulls;Puntos;Mejor turno;Media por dardo");

            foreach (var player in recording.PlayerStats)
            {
                builder.AppendLine(string.Join(';',
                    Escape(player.Name),
                    Escape(player.Darts),
                    Escape(player.Hits),
                    Escape(player.Triples),
                    Escape(player.Doubles),
                    Escape(player.Bulls),
                    Escape(player.Score),
                    Escape(player.HighestTurn),
                    Escape(player.Average.ToString("0.00", CultureInfo.InvariantCulture))));
            }
        }

        return builder.ToString();
    }

    private static string Escape(object value)
    {
        var text = Convert.ToString(value, CultureInfo.InvariantCulture) ?? string.Empty;
        return text.Contains(';') || text.Contains('"')
            ? $"\"{text.Replace("\"", "\"\"")}\""
            : text;
    }

    private static string Slug(string value)
    {
        var builder = new StringBuilder();
        foreach (var character in value.Normalize(NormalizationForm.FormD))
        {
            if (CharUnicodeInfo.GetUnicodeCategory(character) == UnicodeCategory.NonSpacingMark)
                continue;

            builder.Append(char.IsLetterOrDigit(character) ? char.ToLowerInvariant(character) : '-');
        }

        var slug = builder.ToString().Trim('-');
        while (slug.Contains("--", StringComparison.Ordinal))
            slug = slug.Replace("--", "-", StringComparison.Ordinal);

        return string.IsNullOrWhiteSpace(slug) ? "grabacion" : slug[..Math.Min(slug.Length, 80)];
    }
}

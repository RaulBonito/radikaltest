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
}

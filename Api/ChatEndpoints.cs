using RadikalPlayers.Radikal;

namespace RadikalPlayers.Api;

public sealed record ChatPostRequest(string? Name, string? Text);

public static class ChatEndpoints
{
    public static IEndpointRouteBuilder MapChatApi(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api");

        api.MapGet("/chat/{room}", async (
            string room,
            long? after,
            LiveChatStore store,
            CancellationToken ct) =>
        {
            var messages = await store.GetAsync(room, after ?? 0, ct);
            return Results.Ok(new { messages, fetchedAt = DateTimeOffset.UtcNow });
        });

        api.MapPost("/chat/{room}", async (
            string room,
            ChatPostRequest body,
            LiveChatStore store,
            CancellationToken ct) =>
        {
            try
            {
                var message = await store.AddAsync(room, body.Name, body.Text, ct);
                return Results.Ok(message);
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new { title = ex.Message });
            }
        }).DisableAntiforgery();

        return app;
    }
}

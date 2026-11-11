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
            PlayerAuthService auth,
            HttpContext context,
            CancellationToken ct) =>
        {
            var sessionId = context.Session.GetString(AuthEndpoints.SessionKey);
            var profile = await auth.GetSessionProfileAsync(sessionId, refresh: false, ct);
            if (profile is null)
                return Results.Unauthorized();

            try
            {
                var author = string.IsNullOrWhiteSpace(profile.Alias) ? profile.Dni : profile.Alias;
                var message = await store.AddAsync(room, author, body.Text, ct);
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

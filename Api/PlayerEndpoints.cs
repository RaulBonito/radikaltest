using Microsoft.AspNetCore.Mvc;
using RadikalPlayers.Radikal;

namespace RadikalPlayers.Api;

public static class PlayerEndpoints
{
    private const string SessionKey = "radikal.session";

    public static IEndpointRouteBuilder MapPlayerApi(this IEndpointRouteBuilder app)
    {
        var player = app.MapGroup("/api/player");

        player.MapGet("/area", async (
            bool? refresh,
            PlayerAuthService service,
            HttpContext context,
            CancellationToken ct) =>
        {
            var sessionId = context.Session.GetString(SessionKey);
            var area = await service.GetAreaAsync(sessionId, refresh ?? false, ct);
            return area is null ? Results.Unauthorized() : Results.Ok(area);
        });

        player.MapGet("/stats", async (
            int? competitionId,
            PlayerAuthService service,
            HttpContext context,
            CancellationToken ct) =>
        {
            var sessionId = context.Session.GetString(SessionKey);
            if (string.IsNullOrWhiteSpace(sessionId)) return Results.Unauthorized();
            var stats = await service.GetCompetitionStatsAsync(sessionId, competitionId ?? 0, ct);
            return Results.Ok(stats);
        });

        player.MapGet("/cities", async (
            [FromQuery] string country,
            [FromQuery] string province,
            PlayerAuthService service,
            HttpContext context,
            CancellationToken ct) =>
        {
            var sessionId = context.Session.GetString(SessionKey);
            if (string.IsNullOrWhiteSpace(sessionId)) return Results.Unauthorized();
            var cities = await service.GetCitiesAsync(sessionId, country, province, ct);
            return Results.Ok(cities);
        });

        player.MapPost("/profile", async (
            PlayerProfileUpdateRequest request,
            PlayerAuthService service,
            HttpContext context,
            CancellationToken ct) =>
        {
            var sessionId = context.Session.GetString(SessionKey);
            if (string.IsNullOrWhiteSpace(sessionId)) return Results.Unauthorized();
            return Results.Ok(await service.UpdateProfileAsync(sessionId, request, ct));
        });

        player.MapPost("/alias", async (
            PlayerAliasUpdateRequest request,
            PlayerAuthService service,
            HttpContext context,
            CancellationToken ct) =>
        {
            var sessionId = context.Session.GetString(SessionKey);
            if (string.IsNullOrWhiteSpace(sessionId)) return Results.Unauthorized();
            return Results.Ok(await service.UpdateAliasAsync(sessionId, request.Alias, ct));
        });

        player.MapPost("/photo", async (
            IFormFile file,
            PlayerAuthService service,
            HttpContext context,
            CancellationToken ct) =>
        {
            var sessionId = context.Session.GetString(SessionKey);
            if (string.IsNullOrWhiteSpace(sessionId)) return Results.Unauthorized();
            if (file is null || file.Length == 0)
                return Results.BadRequest(new { title = "Selecciona una imagen." });

            using var stream = new MemoryStream();
            await file.CopyToAsync(stream, ct);
            var result = await service.UpdatePhotoAsync(
                sessionId,
                stream.ToArray(),
                file.FileName,
                file.ContentType,
                ct);
            return Results.Ok(result);
        }).DisableAntiforgery();

        player.MapPost("/password", async (
            PlayerPasswordChangeRequest request,
            PlayerAuthService service,
            HttpContext context,
            CancellationToken ct) =>
        {
            var sessionId = context.Session.GetString(SessionKey);
            if (string.IsNullOrWhiteSpace(sessionId)) return Results.Unauthorized();
            return Results.Ok(await service.ChangePasswordAsync(sessionId, request, ct));
        });

        player.MapGet("/photo", async (
            PlayerAuthService service,
            HttpContext context,
            CancellationToken ct) =>
        {
            var sessionId = context.Session.GetString(SessionKey);
            var photo = await service.GetPhotoAsync(sessionId, ct);
            if (photo is null) return Results.NotFound();

            context.Response.Headers.CacheControl = "private,max-age=300";
            return Results.File(photo.Value.Bytes, photo.Value.ContentType);
        });

        player.MapGet("/items", async (
            PlayerAuthService service,
            HttpContext context,
            CancellationToken ct) =>
        {
            var sessionId = context.Session.GetString(SessionKey);
            return Results.Ok(await service.GetItemsAsync(sessionId, ct));
        });

        player.MapPost("/items/{itemId}/toggle", async (
            string itemId,
            PlayerAuthService service,
            HttpContext context,
            CancellationToken ct) =>
        {
            var sessionId = context.Session.GetString(SessionKey);
            if (string.IsNullOrWhiteSpace(sessionId)) return Results.Unauthorized();
            return Results.Ok(await service.ToggleItemAsync(sessionId, itemId, ct));
        });

        player.MapGet("/share-ratings", (PlayerAuthService service, HttpContext context) =>
        {
            var sessionId = context.Session.GetString(SessionKey);
            return Results.Ok(new { share = service.GetShareRatings(sessionId) });
        });

        player.MapPost("/share-ratings", async (
            ShareRatingsRequest request,
            PlayerAuthService service,
            HttpContext context,
            CancellationToken ct) =>
        {
            var sessionId = context.Session.GetString(SessionKey);
            if (string.IsNullOrWhiteSpace(sessionId)) return Results.Unauthorized();
            var share = await service.SetShareRatingsAsync(sessionId, request.Share, ct);
            return Results.Ok(new { share });
        });

        return app;
    }
}

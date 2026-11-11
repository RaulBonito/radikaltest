using RadikalPlayers.Radikal;

namespace RadikalPlayers.Api;

public static class AuthEndpoints
{
    public const string SessionKey = "radikal.session";

    public sealed record LoginRequest(string Dni, string Clave);

    public static IEndpointRouteBuilder MapAuthApi(this IEndpointRouteBuilder app)
    {
        var auth = app.MapGroup("/api/auth");

        auth.MapPost("/login", async (
            LoginRequest request,
            PlayerAuthService service,
            HttpContext context,
            CancellationToken ct) =>
        {
            try
            {
                var (sessionId, profile) = await service.LoginAsync(request.Dni, request.Clave, ct);
                context.Session.SetString(SessionKey, sessionId);
                return Results.Ok(profile);
            }
            catch (PlayerAuthException ex)
            {
                return Results.Json(new
                {
                    title = "No se pudo iniciar sesión",
                    detail = ex.Message,
                    status = StatusCodes.Status401Unauthorized
                }, statusCode: StatusCodes.Status401Unauthorized);
            }
        });

        auth.MapPost("/demo", async (
            PlayerAuthService service,
            HttpContext context,
            CancellationToken ct) =>
        {
            var (sessionId, profile) = await service.CreateDemoAsync(ct);
            context.Session.SetString(SessionKey, sessionId);
            return Results.Ok(profile);
        });

        auth.MapGet("/me", async (
            PlayerAuthService service,
            HttpContext context,
            bool? refresh,
            CancellationToken ct) =>
        {
            var sessionId = context.Session.GetString(SessionKey);
            var profile = await service.GetSessionProfileAsync(sessionId, refresh ?? false, ct);
            return profile is null ? Results.Unauthorized() : Results.Ok(profile);
        });

        auth.MapPost("/logout", async (
            PlayerAuthService service,
            HttpContext context,
            CancellationToken ct) =>
        {
            var sessionId = context.Session.GetString(SessionKey);
            await service.LogoutAsync(sessionId, ct);
            context.Session.Clear();
            return Results.Ok(new { ok = true });
        });

        return app;
    }
}

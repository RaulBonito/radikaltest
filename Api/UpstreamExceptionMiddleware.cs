namespace RadikalPlayers.Api;

public sealed class UpstreamExceptionMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<UpstreamExceptionMiddleware> _logger;

    public UpstreamExceptionMiddleware(RequestDelegate next, ILogger<UpstreamExceptionMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (HttpRequestException ex) when (!context.Response.HasStarted)
        {
            _logger.LogWarning(ex, "Fallo consultando Radikal Players");
            context.Response.Clear();
            context.Response.StatusCode = StatusCodes.Status502BadGateway;
            context.Response.ContentType = "application/problem+json";
            await context.Response.WriteAsJsonAsync(new
            {
                type = "https://httpstatuses.com/502",
                title = "Radikal Players no respondió",
                status = 502,
                detail = "El servicio de origen no está disponible en este momento. Inténtalo de nuevo en unos segundos."
            });
        }
        catch (TaskCanceledException ex) when (!context.RequestAborted.IsCancellationRequested && !context.Response.HasStarted)
        {
            _logger.LogWarning(ex, "Timeout consultando Radikal Players");
            context.Response.Clear();
            context.Response.StatusCode = StatusCodes.Status504GatewayTimeout;
            context.Response.ContentType = "application/problem+json";
            await context.Response.WriteAsJsonAsync(new
            {
                type = "https://httpstatuses.com/504",
                title = "Radikal Players tardó demasiado",
                status = 504,
                detail = "La consulta al servicio de origen superó el tiempo de espera."
            });
        }
    }
}

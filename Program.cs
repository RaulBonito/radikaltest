using System.IO.Compression;
using System.Net;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.Options;
using RadikalPlayers.Api;
using RadikalPlayers.Radikal;

var builder = WebApplication.CreateBuilder(args);

// Render (y la mayoría de PaaS) inyecta el puerto HTTP en PORT y espera 0.0.0.0.
var renderPort = Environment.GetEnvironmentVariable("PORT");
if (!string.IsNullOrWhiteSpace(renderPort) && int.TryParse(renderPort, out var portNumber) && portNumber > 0)
{
    builder.WebHost.UseUrls($"http://0.0.0.0:{portNumber}");
}

builder.Services.Configure<RadikalOptions>(builder.Configuration.GetSection("Radikal"));
builder.Services.AddMemoryCache();
builder.Services.AddDistributedMemoryCache();
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.KnownIPNetworks.Clear();
    options.KnownProxies.Clear();
});
builder.Services.AddSession(options =>
{
    options.Cookie.Name = "radikal.area";
    options.Cookie.HttpOnly = true;
    options.Cookie.IsEssential = true;
    options.Cookie.SameSite = SameSiteMode.Lax;
    options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
    options.IdleTimeout = TimeSpan.FromHours(8);
});
builder.Services.AddProblemDetails();
builder.Services.AddResponseCompression(options =>
{
    options.EnableForHttps = true;
    options.MimeTypes = ResponseCompressionDefaults.MimeTypes.Concat(new[]
    {
        "application/json",
        "application/problem+json",
        "text/html",
        "application/javascript",
        "text/css",
        "image/svg+xml"
    });
});
builder.Services.Configure<GzipCompressionProviderOptions>(o => o.Level = CompressionLevel.Fastest);
builder.Services.Configure<BrotliCompressionProviderOptions>(o => o.Level = CompressionLevel.Fastest);

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    options.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
});

builder.Services.AddHttpClient("radikal-esp", (services, http) => ConfigureRadikalClient(services, http, useViewer: false))
    .ConfigurePrimaryHttpMessageHandler(CreateHandler);
builder.Services.AddHttpClient("radikal-www", (services, http) => ConfigureRadikalClient(services, http, useViewer: true))
    .ConfigurePrimaryHttpMessageHandler(CreateHandler);
builder.Services.AddHttpClient("flags", http =>
{
    http.BaseAddress = new Uri("https://flagcdn.com/w80/");
    http.Timeout = TimeSpan.FromSeconds(15);
    http.DefaultRequestHeaders.UserAgent.ParseAdd("RadikalPlayersExperience/1.0");
});

builder.Services.AddSingleton<RadikalClient>();
builder.Services.AddSingleton<PlayerDirectoryService>();
builder.Services.AddSingleton<SharedProfileStore>();
builder.Services.AddSingleton<OfficialMediaService>();
builder.Services.AddSingleton<PlayerAuthService>();
builder.Services.AddSingleton<ShopCartService>();
builder.Services.AddSingleton<LiveRecordingStore>();
builder.Services.AddSingleton<LiveChatStore>();
builder.Services.AddSingleton<LiveRecordingService>();
builder.Services.AddHostedService(services => services.GetRequiredService<LiveRecordingService>());
builder.Services.AddHostedService<CacheWarmupService>();

var app = builder.Build();

AppDataPaths.EnsureSeeded(app.Environment, app.Configuration, app.Logger);
app.Logger.LogInformation(
    "Datos de la aplicación: {DataPath} (semilla: {SeedPath})",
    AppDataPaths.Resolve(app.Environment, app.Configuration),
    AppDataPaths.SeedDirectory(app.Environment));

app.UseForwardedHeaders();
if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
}
app.UseResponseCompression();
app.UseMiddleware<UpstreamExceptionMiddleware>();

// JS y CSS se revalidan siempre: evita quedarse con módulos viejos en caché tras un despliegue.
app.Use(async (context, next) =>
{
    context.Response.OnStarting(() =>
    {
        if (context.Request.Path.StartsWithSegments("/js") || context.Request.Path.StartsWithSegments("/css"))
        {
            context.Response.Headers.CacheControl = "no-cache, no-store, must-revalidate";
            context.Response.Headers.Pragma = "no-cache";
            context.Response.Headers.Expires = "0";
        }
        return Task.CompletedTask;
    });
    await next();
});

app.Use(async (context, next) =>
{
    context.Response.OnStarting(() =>
    {
        var contentType = context.Response.ContentType;
        if (!string.IsNullOrWhiteSpace(contentType) &&
            !contentType.Contains("charset", StringComparison.OrdinalIgnoreCase) &&
            (contentType.StartsWith("text/", StringComparison.OrdinalIgnoreCase) ||
             contentType.Contains("javascript", StringComparison.OrdinalIgnoreCase) ||
             contentType.Contains("json", StringComparison.OrdinalIgnoreCase)))
        {
            context.Response.ContentType = $"{contentType}; charset=utf-8";
        }
        return Task.CompletedTask;
    });
    await next();
});

app.UseDefaultFiles();
var contentTypeProvider = new FileExtensionContentTypeProvider();
contentTypeProvider.Mappings[".webmanifest"] = "application/manifest+json";

app.UseStaticFiles(new StaticFileOptions
{
    ContentTypeProvider = contentTypeProvider,
    OnPrepareResponse = context =>
    {
        // Vídeos e imágenes de marca: se cachean una semana en el navegador.
        if (context.Context.Request.Path.StartsWithSegments("/media") ||
            context.Context.Request.Path.StartsWithSegments("/img"))
        {
            context.Context.Response.Headers.CacheControl = "public,max-age=604800,immutable";
        }
    }
});
app.UseSession();

app.MapRadikalApi();
app.MapAuthApi();
app.MapPlayerApi();
app.MapShopCartApi();
app.MapLiveRecordingApi();
app.MapChatApi();
app.MapMediaApi();
app.MapFlagApi();

// Health check barato para Render: no depende de Radikal ni de servicios externos.
app.MapGet("/health", () => Results.Ok(new
{
    status = "ok",
    service = "radikal-players",
    environment = app.Environment.EnvironmentName,
    utc = DateTimeOffset.UtcNow
}));

app.MapFallback(async context =>
{
    if (context.Request.Path.StartsWithSegments("/api"))
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
    }

    context.Response.ContentType = "text/html; charset=utf-8";
    var index = Path.Combine(app.Environment.WebRootPath ?? Path.Combine(app.Environment.ContentRootPath, "wwwroot"), "index.html");
    await context.Response.SendFileAsync(index);
});

app.Run();

void ConfigureRadikalClient(IServiceProvider services, HttpClient http, bool useViewer)
{
    var options = services.GetRequiredService<IOptions<RadikalOptions>>().Value;
    http.BaseAddress = new Uri(useViewer ? options.ViewerBaseUrl : options.EspBaseUrl);
    http.Timeout = TimeSpan.FromSeconds(options.TimeoutSeconds);
    http.DefaultRequestHeaders.UserAgent.ParseAdd(options.UserAgent);
    http.DefaultRequestHeaders.AcceptLanguage.ParseAdd("es-ES,es;q=0.9,en;q=0.8");
    http.DefaultRequestHeaders.Referrer = http.BaseAddress;
}

static HttpMessageHandler CreateHandler() => new SocketsHttpHandler
{
    AutomaticDecompression = DecompressionMethods.All,
    PooledConnectionLifetime = TimeSpan.FromMinutes(10),
    MaxConnectionsPerServer = 16
};

public partial class Program
{
}

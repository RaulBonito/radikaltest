using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.DataProtection;
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

// Las claves de Data Protection deben sobrevivir a reinicios y despliegues. La app incluye
// una key ring de respaldo en el propio binario, así que las cookies de sesión se pueden
// descifrar aunque el hosting use un disco efímero. DATA_PROTECTION_KEY_FILE o
// DATA_PROTECTION_KEY_XML permiten sustituirla por una clave propia.
var appDataPath = AppDataPaths.Resolve(builder.Environment, builder.Configuration);
var dataProtectionKeysPath = Path.Combine(appDataPath, "dataprotection-keys");
Directory.CreateDirectory(dataProtectionKeysPath);

void WriteDataProtectionKeyRing(string xml)
{
    var keyId = System.Text.RegularExpressions.Regex.Match(xml, "<key\\s+id=\"([^\"]+)\"");
    if (!keyId.Success) return;

    var keyPath = Path.Combine(dataProtectionKeysPath, $"key-{keyId.Groups[1].Value}.xml");
    if (!File.Exists(keyPath))
        File.WriteAllText(keyPath, xml);
}

var keyXml = builder.Configuration["DataProtection:KeyXml"];
var keyFile = builder.Configuration["DataProtection:KeyFile"];
if (string.IsNullOrWhiteSpace(keyXml))
    keyXml = Environment.GetEnvironmentVariable("DATA_PROTECTION_KEY_XML");
if (string.IsNullOrWhiteSpace(keyFile))
    keyFile = Environment.GetEnvironmentVariable("DATA_PROTECTION_KEY_FILE");

if (string.IsNullOrWhiteSpace(keyXml) && !string.IsNullOrWhiteSpace(keyFile) && File.Exists(keyFile))
{
    try
    {
        keyXml = File.ReadAllText(keyFile);
    }
    catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
    {
        keyXml = null;
    }
}

if (!string.IsNullOrWhiteSpace(keyXml))
{
    var xml = keyXml.Trim();
    if (!xml.StartsWith('<'))
    {
        try
        {
            xml = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(xml));
        }
        catch (FormatException)
        {
            xml = string.Empty;
        }
    }

    WriteDataProtectionKeyRing(xml);
}

// Si no hay clave externa (o no era válida), se usa la key ring incluida en el binario.
if (!Directory.EnumerateFiles(dataProtectionKeysPath, "key-*.xml").Any())
{
    var assembly = System.Reflection.Assembly.GetExecutingAssembly();
    var resourceName = assembly.GetManifestResourceNames()
        .FirstOrDefault(name => name.EndsWith("fallback-key.xml", StringComparison.OrdinalIgnoreCase));

    if (resourceName is not null)
    {
        using var stream = assembly.GetManifestResourceStream(resourceName);
        if (stream is not null)
        {
            using var reader = new StreamReader(stream);
            WriteDataProtectionKeyRing(reader.ReadToEnd());
        }
    }
}

builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(dataProtectionKeysPath))
    .SetApplicationName("RadikalPlayers")
    .SetDefaultKeyLifetime(TimeSpan.FromDays(3650));

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
    // Nombre nuevo: las cookies antiguas se ignoran y no provocan errores de key ring.
    options.Cookie.Name = "radikal.session.v2";
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
    .ConfigurePrimaryHttpMessageHandler(services => CreateHandler(services.GetRequiredService<IConfiguration>()));
builder.Services.AddHttpClient("radikal-www", (services, http) => ConfigureRadikalClient(services, http, useViewer: true))
    .ConfigurePrimaryHttpMessageHandler(services => CreateHandler(services.GetRequiredService<IConfiguration>()));
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
    appDataPath,
    AppDataPaths.SeedDirectory(app.Environment));
var keyFiles = Directory.EnumerateFiles(dataProtectionKeysPath, "key-*.xml")
    .Select(Path.GetFileName)
    .ToArray();
app.Logger.LogInformation("Claves de sesión: {KeysPath} ({Keys})", dataProtectionKeysPath, string.Join(", ", keyFiles));
if (keyFiles.Length == 0 && !app.Environment.IsDevelopment())
{
    app.Logger.LogWarning(
        "Data Protection sin clave estable. Configura DATA_PROTECTION_KEY_FILE o DATA_PROTECTION_KEY_XML " +
        "para que las sesiones sobrevivan a reinicios y despliegues.");
}

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
// Limpia la cookie de sesión antigua para que no quede dando vueltas en el navegador.
app.Use(async (context, next) =>
{
    if (context.Request.Cookies.ContainsKey("radikal.area"))
        context.Response.Cookies.Delete("radikal.area");

    await next();
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

static HttpMessageHandler CreateHandler(IConfiguration configuration)
{
    var handler = new SocketsHttpHandler
    {
        AutomaticDecompression = DecompressionMethods.All,
        PooledConnectionLifetime = TimeSpan.FromMinutes(10),
        MaxConnectionsPerServer = 16
    };

    // Proxy opcional para hostings cuya IP no puede acceder a Radikal.
    var proxyUrl = configuration["Radikal:ProxyUrl"]
        ?? Environment.GetEnvironmentVariable("RADIKAL_PROXY_URL");
    if (!string.IsNullOrWhiteSpace(proxyUrl) &&
        Uri.TryCreate(proxyUrl, UriKind.Absolute, out var proxyUri))
    {
        var proxy = new WebProxy(proxyUri);
        if (!string.IsNullOrWhiteSpace(proxyUri.UserInfo))
        {
            var userInfo = proxyUri.UserInfo.Split(':', 2);
            proxy.Credentials = new NetworkCredential(
                Uri.UnescapeDataString(userInfo[0]),
                userInfo.Length > 1 ? Uri.UnescapeDataString(userInfo[1]) : string.Empty);
        }

        handler.Proxy = proxy;
        handler.UseProxy = true;
        return handler;
    }

    // Sin proxy, fuerza IPv4 y limita el connect: en algunos hostings el intento IPv6
    // se queda colgado hasta agotar el timeout completo de HttpClient.
    handler.ConnectCallback = async (connection, cancellationToken) =>
    {
        var addresses = await Dns.GetHostAddressesAsync(
            connection.DnsEndPoint.Host,
            AddressFamily.InterNetwork,
            cancellationToken);

        Exception? lastError = null;
        foreach (var address in addresses)
        {
            var socket = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp)
            {
                NoDelay = true
            };

            try
            {
                using var attempt = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                attempt.CancelAfter(TimeSpan.FromSeconds(5));
                await socket.ConnectAsync(new IPEndPoint(address, connection.DnsEndPoint.Port), attempt.Token);
                return new NetworkStream(socket, ownsSocket: true);
            }
            catch (Exception exception)
            {
                socket.Dispose();
                lastError = exception;
            }
        }

        throw lastError ?? new HttpRequestException(
            $"No se pudo resolver una dirección IPv4 para {connection.DnsEndPoint.Host}.");
    };

    return handler;
}

public partial class Program
{
}

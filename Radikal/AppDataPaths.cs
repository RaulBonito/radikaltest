using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace RadikalPlayers.Radikal;

/// <summary>
/// Resuelve la carpeta de datos de la aplicación. En local y por defecto usa
/// <c>ContentRoot/App_Data</c>. En hosting (por ejemplo Render) se puede apuntar
/// a un disco persistente con la variable de entorno <c>APP_DATA_PATH</c>.
/// </summary>
public static class AppDataPaths
{
    public const string EnvironmentVariable = "APP_DATA_PATH";

    public static string Resolve(IHostEnvironment environment, IConfiguration? configuration = null)
    {
        var configured = configuration?[EnvironmentVariable] ?? System.Environment.GetEnvironmentVariable(EnvironmentVariable);
        if (!string.IsNullOrWhiteSpace(configured))
        {
            return Path.GetFullPath(configured.Trim());
        }

        return Path.Combine(environment.ContentRootPath, "App_Data");
    }

    public static string SeedDirectory(IHostEnvironment environment)
        => Path.Combine(environment.ContentRootPath, "App_Data");

    /// <summary>
    /// Copia los datos iniciales incluidos en la imagen a la carpeta persistente
    /// cuando esta aún no contiene esos archivos. No sobrescribe datos existentes.
    /// </summary>
    public static void EnsureSeeded(IHostEnvironment environment, IConfiguration configuration, ILogger? logger = null)
    {
        var target = Resolve(environment, configuration);
        Directory.CreateDirectory(target);

        var seed = SeedDirectory(environment);
        if (!Directory.Exists(seed))
        {
            return;
        }

        var comparison = OperatingSystem.IsWindows()
            ? StringComparison.OrdinalIgnoreCase
            : StringComparison.Ordinal;

        if (string.Equals(Path.GetFullPath(target), Path.GetFullPath(seed), comparison))
        {
            return;
        }

        foreach (var source in Directory.EnumerateFiles(seed, "*", SearchOption.AllDirectories))
        {
            var relative = Path.GetRelativePath(seed, source);
            var destination = Path.Combine(target, relative);
            if (File.Exists(destination))
            {
                continue;
            }

            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                File.Copy(source, destination);
            }
            catch (IOException exception)
            {
                logger?.LogWarning(exception, "No se pudo copiar el archivo inicial {File} a {Target}", relative, target);
            }
            catch (UnauthorizedAccessException exception)
            {
                logger?.LogWarning(exception, "Sin permisos para copiar el archivo inicial {File} a {Target}", relative, target);
            }
        }
    }
}

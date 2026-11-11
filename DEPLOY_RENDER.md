# Desplegar Radikal Players en Render

Esta guía deja el proyecto listo para un **Web Service Docker** en Render.

## 1. Subir el código a GitHub

Render despliega desde un repositorio de GitHub, GitLab o Bitbucket.

1. Crea un repositorio.
2. Sube el contenido de `apps/RadikalPlayers`.
3. No subas `bin`, `obj` ni las cachés de `App_Data`
   (`flags`, `media`, `official-media`). El `.dockerignore` ya las excluye del build.

Si usas un monorepo, la carpeta del servicio es `apps/RadikalPlayers`.

## 2. Crear el servicio en Render

En el dashboard:

1. **New → Web Service**.
2. Conecta el repositorio.
3. Si el proyecto no está en la raíz del repo, indica:
   - **Root Directory**: `apps/RadikalPlayers`
4. Configura:
   - **Runtime**: `Docker`
   - **Dockerfile Path**: `./Dockerfile`
   - **Docker Context**: `.`
   - **Health Check Path**: `/health`
   - **Plan**: `Free` para probar o `Starter` si quieres disco persistente.
5. Crea el servicio.

También puedes usar **New → Blueprint** y el `render.yaml` incluido.

## 3. Variables de entorno

Añade estas variables en **Environment**:

| Variable | Valor |
|---|---|
| `ASPNETCORE_ENVIRONMENT` | `Production` |
| `APP_DATA_PATH` | `/var/data` |
| `Radikal__EspBaseUrl` | `https://esp.radikalplayers.com/` |
| `Radikal__ViewerBaseUrl` | `https://www.radikalplayers.com/` |
| `Radikal__TimeoutSeconds` | `35` |
| `Radikal__UseFallbackData` | `true` |

Render inyecta `PORT` automáticamente. La aplicación ya lo lee y escucha en
`http://0.0.0.0:PORT`. No hace falta definir `PORT` a mano.

## 4. Disco persistente (recomendado)

Sin disco, todo lo que escribe la app se pierde al reiniciar o desplegar:
chat, grabaciones, medias compartidas y cachés.

Los discos persistentes requieren un plan de pago (`Starter` o superior):

1. Cambia el plan del servicio a **Starter**.
2. Ve a **Disks → Add Disk**.
3. Configura:
   - **Name**: `radikal-data`
   - **Mount Path**: `/var/data`
   - **Size**: `1 GB`
4. Mantén `APP_DATA_PATH=/var/data`.

La app copia automáticamente los datos iniciales de `App_Data` a `/var/data`
en el primer arranque, sin sobrescribir archivos existentes. Solo se incluye
`live-recordings.json` como dato de ejemplo; no se publican `shared-ratings.json`
ni chats locales.

Nota: un servicio con disco no puede escalar horizontalmente ni usar
despliegues sin downtime.

## 5. Comprobar el despliegue

Cuando el deploy termine:

1. Abre `https://TU-SERVICIO.onrender.com/health`.
   Debe devolver un JSON con `"status":"ok"`.
2. Abre la portada.
3. Prueba login con un Radikal ID real.
4. Revisa **Logs** si algo falla.

La primera carga puede tardar porque el inicio consulta datos a Radikal y
rellena cachés.

## 6. Probar la imagen en local

Con Docker instalado:

```bash
docker build -t radikal-players .
docker run --rm -p 8080:8080 -e PORT=8080 -e APP_DATA_PATH=/var/data -v radikal-data:/var/data radikal-players
```

Abre `http://localhost:8080`.

## Notas

- El health check `/health` no consulta Radikal: sirve para saber si el proceso
  está vivo aunque el proveedor externo tarde o falle.
- La primera carga del inicio puede tardar unos segundos porque se precalientan
  rankings, noticias, directo y mapa.
- `SixLabors.ImageSharp` 3.1.12 es la última versión con licencia gratuita y
  .NET muestra avisos NU1902/NU1903. No impide el despliegue. Actualizar a
  3.2+ requiere una licencia comercial de Six Labors.
- Las sesiones de Radikal se guardan en memoria y se pierden al reiniciar el
  servicio. Con el plan Free esto también ocurre tras un periodo de inactividad.

## Problemas habituales

### “No open ports detected”

La app debe escuchar en `0.0.0.0` y en el puerto de `PORT`.
Este proyecto ya lo hace en `Program.cs` y el Dockerfile expone `10000`.
Revisa los logs de Render para confirmar:

```text
Now listening on: http://0.0.0.0:10000
```

### La web carga pero el login no mantiene la sesión

La sesión se guarda en memoria. Se pierde al reiniciar el servicio. En Render
debe haber **una sola instancia**. Si necesitas varias instancias, habría que
mover sesiones y datos a un almacén compartido.

### Se pierden datos tras un deploy

Falta el disco persistente o `APP_DATA_PATH` no apunta a `/var/data`.

### Las banderas o imágenes tardan en aparecer la primera vez

Se regeneran desde Radikal/flagcdn y quedan cacheadas en `APP_DATA_PATH`.

### El build falla por .NET 10

El Dockerfile usa `mcr.microsoft.com/dotnet/sdk:10.0` y
`mcr.microsoft.com/dotnet/aspnet:10.0`. Asegúrate de que Render está usando
el Dockerfile del repositorio y no un runtime nativo.

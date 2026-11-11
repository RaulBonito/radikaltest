# Radikal Players Experience

Prototipo de producto para la comunidad **Radikal Darts**: una experiencia web moderna que reúne
rankings, competiciones, directo, mapa de dianas, noticias, Official Players y área de jugador.

## Stack

- **Backend:** ASP.NET Core (.NET 10) + Minimal APIs + AngleSharp.
- **Frontend:** HTML/CSS/JavaScript ES Modules, sin framework y sin build step.
- **Datos:** endpoints públicos de Radikal Players consultados **desde el servidor**.
- **Caché:** `IMemoryCache` por recurso (rankings, competiciones, directo, dianas, noticias...).
- **Auth:** login real contra Radikal Players; sesión propia en servidor; modo demo incluido.

## Cómo arrancar

```powershell
dotnet run --project apps/RadikalPlayers/RadikalPlayers.csproj --urls http://localhost:5188
```

Abre `http://localhost:5188`.

## Rutas

| Ruta | Pantalla |
|---|---|
| `#/` | Inicio / dashboard |
| `#/rankings` | Rankings con filtros y exportación CSV |
| `#/jugador/{id}` | Ficha pública de cualquier jugador del directorio |
| `#/competiciones` | Buscador y listado de competiciones |
| `#/competiciones/{id}?type=TORX` | Detalle + clasificación |
| `#/directo` | En directo, partidas y buscador de torneos || `#/directo/torneo/{id}` | Visor de cuadrante interactivo + actas |
| `#/directo/dardos/{compid}/{encid}/{ngame}` | Mapa de dardos de una partida en directo |
| `#/directo/dardos/demo` | Vista previa del mapa de dardos |
| `#/directo/finalizadas` | Partidas finalizadas agrupadas por juegos |
| `#/directo/finalizadas/{compid}/{encid}/{ngame}` | Directo en vivo de la partida (por defecto) |
| `#/directo/finalizadas/{compid}/{encid}/{ngame}?tab=partida` | Repetición dardo a dardo con controles |
| `#/directo/partidas/{compid}/{encid}/{ngame}/avanzado` | Informe avanzado por ronda y jugador |
| `#/lugares` | Mapa de 5.918 dianas + Top Places |
| `#/noticias` | Noticias |
| `#/noticias/{id}` | Detalle de noticia |
| `#/official` | Official Players con logos oficiales |
| `#/tienda` | Catálogo real de la tienda Radikal |
| `#/tienda/{id}` | Ficha de producto con vídeo e imágenes oficiales |
| `#/carrito` | Carrito con productos, cantidades y totales |
| `#/mi-area` | Login / área de jugador |
| `#/mi-area?demo=1` | Área de jugador en modo demo |

## Área de jugador

- Login real con **Radikal ID + contraseña** contra `ajax.gateway.php`.
- La contraseña **no se almacena**: se envía a Radikal y solo se conserva la cookie de sesión.
- Nuestra sesión se guarda en el servidor y se identifica con una cookie `HttpOnly`.
- Dashboard real con:
  - perfil (alias, nombre, foto, member hasta, Radikal Points, bonus);
  - rating actual PPD/MPR y estadísticas totales X01/Cricket;
  - competiciones en curso y finalizadas;
  - estadísticas por competición bajo demanda;
  - historial de Radikal Points y suscripción;
  - edición de datos personales/dirección y cambio de contraseña;
  - proxy de la foto privada usando la cookie de sesión.
- **Modo demo** para presentaciones, sin credenciales, en `#/mi-area?demo=1`.
- Botón de cierre de sesión que también invalida la sesión remota de Radikal.
- Las credenciales de prueba no se guardan en el proyecto; solo se usan en memoria para validar el flujo.

### Endpoints del área

| Endpoint | Uso |
|---|---|
| `GET /api/player/area` | Dashboard completo (perfil, stats, competiciones, puntos, suscripción). |
| `GET /api/player/stats?competitionId=` | Estadísticas de una competición. |
| `GET /api/player/items` | **Mis items**: personalizaciones compradas y su estado. |
| `POST /api/player/items/{itemId}/toggle` | Activa o desactiva un item siguiendo la acción de Radikal. |
| `GET /api/player/cities?country=724&province=` | Ciudades para el formulario de dirección. |
| `POST /api/player/profile` | Guardar datos personales/dirección. |
| `POST /api/player/password` | Cambiar contraseña. |
| `GET /api/player/photo` | Foto privada del jugador (proxy con cookies de sesión). |
| `GET /api/auth/me` | Estado de la sesión. |
| `POST /api/auth/login` | Login real con Radikal ID y contraseña. |
| `POST /api/auth/demo` | Sesión de demostración. |

## Mis items (personalizaciones)

- En Radikal las **personalizaciones** (fondos, dardos, feats, goodshots) se compran en la tienda y
  aparecen en **"Mis Items"** (`items.php`) del perfil, donde se activan o desactivan.
- La app carga esa página con la **sesión real del jugador** (mismas cookies que el login) y muestra
  tarjetas con imagen, nombre y estado, con botón **Activar / Desactivar**.
- La activación se resuelve **siguiendo la acción que expone la propia página** (validando que sea del
  dominio de Radikal), sin replicar parámetros internos.
- En **modo demo** se muestra una muestra ilustrativa y se bloquea la escritura.

## Tienda y carrito
- **Vídeos automáticos**: las tarjetas de la tienda reproducen el vídeo oficial del producto
  (silenciado, en bucle y solo cuando entra en pantalla). La ficha del producto también arranca el
  vídeo automáticamente, con controles para activar el sonido.
- **Agrupación por tipo de item**: chips con contador (Fondos, Dardos, Feats, Goodshots, Merchandising,
  Tarjetas, Suscripciones…) y secciones con cabecera cuando se ven todos los grupos.
- Catálogo real de `shop/index.php` (Personalización, Material, Suscripción e Inscripción).
- Productos con imagen oficial, descripción, precio en euros y precio en Radikal Points.
- **Ficha de producto** (`#/tienda/{id}`) con la galería oficial (`product.php`): **vídeo MP4** cuando
  Radikal lo publica, con póster y reproductor, o imagen si solo hay foto. El vídeo se sirve por
  nuestro proxy (`/api/shop/media/{id}/video`) y se carga al pulsar reproducir para no gastar datos.
- **Carrito real** contra `shop/ajax.cart.php`, con sesión de tienda independiente por visitante.
- Añadir, cambiar cantidades, quitar líneas, vaciar y recalcular totales con Radikal.
- **Handoff oficial:** al tramitar, los artículos se añaden al carrito de Radikal en una pestaña nueva
  mediante `cart.php?action=ADD_PRODUCT`; el pago se completa en Radikal.
- Los productos de inscripción que requieren competición se derivan a su ficha oficial.
- Enlace visible en la navegación superior, en la **bottom bar móvil**, en la portada y en la cabecera (badge).

### Endpoints del carrito
| Endpoint | Uso |
|---|---|
| `GET /api/shop/cart` | Carrito actual con líneas, cantidades y totales. |
| `POST /api/shop/cart/items` | Añadir producto (`{ productId, quantity }`). |
| `PATCH /api/shop/cart/items/{lineId}` | Cambiar cantidad. |
| `DELETE /api/shop/cart/items/{lineId}` | Quitar línea. |
| `POST /api/shop/cart/clear` | Vaciar el carrito. |

### Endpoints de medios

| Endpoint | Uso |
|---|---|
| `GET /api/shop/products/{id}` | Ficha oficial del producto con su galería (vídeo e imágenes). |
| `GET /api/shop/media/{id}/video` | Vídeo MP4 oficial del producto (proxy). |
| `GET /api/shop/media/{id}/poster` | Fotograma de previsualización del vídeo. |
| `GET /api/media/brand/{name}` | Vídeos de marca de Radikal (`premium`, `premium-top`), cacheados en disco. |

## Dardos en directo

- El visor oficial `visualizaPartidaJSON.php` expone, **mientras la partida está en directo**, cada
  dardo con `DartHR`, `DartMult` y `DartSector`; también el turno, ronda y jugador.
- La app normaliza esos datos y pinta un **mapa de impactos por sector/multiplicador** y el detalle
  de las 3 tiradas de cada turno.
- **Limitación real:** cuando la partida termina, Radikal devuelve solo el ganador (`endwinner`).
  Las partidas antiguas no permiten reconstruir la posición de cada dardo; la app lo indica de forma
  explícita en lugar de inventar coordenadas.
- `#/directo/dardos/demo` permite revisar el mapa con datos de ejemplo, claramente etiquetados.

### Endpoints de directo

| Endpoint | Uso |
|---|---|
| `GET /api/live` | Estado y competiciones en directo. |
| `GET /api/live/matches` | Partidas en directo con `compid`, `encid` y `ngame`. |
| `GET /api/live/darts?compid=&encid=&ngame=` | Dardos normalizados de la partida. |

## Partidas finalizadas y visor de juego

- **Captura automática:** un servicio de fondo recorre cada 6 s las partidas retransmitidas y guarda
  **cada dardo** en `App_Data/live-recordings.json` (ronda, jugador, número de dardo, zona, sector,
  multiplicador, puntos y momento de captura). El visor de dardos también alimenta la captura.
- **Histórico completo:** cuando Radikal deja de exponer los dardos (partida terminada), la
  partida conserva todo lo capturado y se puede abrir cuando se quiera.
- **Agrupación por partida:** una partida puede tener varios juegos. La tarjeta muestra cada juego
  con su modalidad (X01/Cricket), sus dardos y su estado.
- **Directo oficial:** la pestaña Directo incrusta el visor oficial de Radikal para esa diana y
  partida (`visualizaPartida.php?compid=…&encid=…&ngame=…`). El propio visor muestra
  **WAITING FOR DARTS** hasta que llega la primera tirada. Incluye el chat de la partida y un acceso
  para abrirlo en Radikal. En las partidas de ejemplo se muestra un aviso porque no existen upstream.
- **Partida en directo:** la pestaña Partida es el marcador propio, también en vivo. Arranca siempre en
  **Inicio**: ronda 1, marcador antes de la primera tirada y las tres rayitas vacías. Sigue la captura
  cada 3 s, revela los dardos nuevos uno a uno y mantiene un botón **Ir al directo** si te has ido
  hacia atrás en la repetición. Al cambiar el turno se animan foto, marcador y paneles.
- **Plantilla en capas:** el botón **Jugadores** (cabecera y barra de juego) abre una capa por encima
  del layout, sin mover nada. Al pulsar un jugador se abre su **resumen deportivo** y, si comparte
  medias, su PPD/MPR. Los jugadores se resuelven por Radikal ID, aunque el alias no esté en el índice
  público. En equipos, los marcadores inferiores muestran los miembros y los puntos de cada uno.
- **Resumen final:** el último paso muestra al ganador con corona, foto, alias, PPD/MPR, puntos, dardos
  y la serie de juegos. Desde ahí se puede repetir o cambiar de pestaña.
- **Marcador grande:** el restante del jugador que tira ocupa el centro. Debajo, **tres rayitas del
  color de su equipo**; cada tirada deja su registro debajo de su rayita (`S18`, `T20`, `BULL`, `SX`…).
  El PPD/MPR va grande junto a la foto y la **ronda** se muestra arriba a la derecha de los
  marcadores inferiores. Sin parcial, sin contador de turno y sin selector de salida.
- **Solo alias:** en la partida y en la ficha del jugador se muestra el alias y la foto, nunca el
  nombre completo; el perfil completo sigue disponible al abrir la ficha.
- **Mi Área móvil:** menú de secciones en tarjetas (Resumen, Competiciones, Rendimiento, Puntos,
  Mis items y Mis datos) y el login admite letras además de números en el Radikal ID.
- **Webapp instalable:** manifiesto `manifest.webmanifest`, iconos 192/512 y `apple-touch-icon`,
  modo `standalone`, barra de estado `black-translucent` y `viewport-fit=cover`. El header, la
  navegación inferior y el visor respetan `env(safe-area-inset-*)`, por lo que la app se integra
  en el notch y en el home indicator del iPhone. En modo instalado el documento no hace scroll:
  el contenido se desplaza dentro del shell fijo.
- **UI limpia:** el visor y las tarjetas de partidas no muestran contadores de dardos ni turnos;
  solo el alias, la foto, el marcador, la media y los datos de modalidad imprescindibles.
- **Modalidad automática:** X01/Cricket y equipo/individual salen del dato `isTeam` de Radikal
  (con respaldo por tipo de juego y jugadores); no hay ningún interruptor para cambiarlos.
- **Reglas X01 reales:** el visor aplica la modalidad que publica la diana (`InfoPanel2`, `Stacked`,
  `X01N`): **Open/Double/Master In** y **Open/Double/Master/Triple Out**. Un turno es **bust** si se
  pasa de cero, deja 1 (salvo salida abierta) o llega a cero sin el multiplicador de cierre; se anula
  el turno, suena el aviso de fallo y se pasa al siguiente jugador. La información de la modalidad y
  las rondas aparece en la barra de la partida, en el marcador y en el resumen.
- **Freeze en equipos:** con marcadores separados (Team 501, `Stacked=0`) cada jugador no puede cerrar
  mientras su compañero tenga más puntos que la suma de los dos rivales. El visor marca al jugador
  congelado con ❄ y, si intenta cerrar, lo cuenta como bust. Los equipos LOC/VIS se resuelven con
  `IdxPlayersLoc`/`IdxPlayersVis` y sus nombres con `EqLoc`/`EqVis`.
- **Modo inmersivo:** el visor ocupa toda la pantalla sin topbar ni footer, con fondo fotográfico,
  paneles rojos y azules de la aplicación y animación del último impacto (triple, doble, bull u OUT).
- **Repetición:** la pestaña Partida mantiene play/pausa, 1×/2×/4×, **Inicio**/dardo
  anterior/siguiente/**Final**, barra de progreso y salto por rondas. Teclado: ← / → dardo, espacio
  play/pausa, Inicio/Fin, `F` pantalla completa y `M` silenciar.
- **Cricket visual:** fila de objetivos 20/19/18/17/16/15/BULL y una fila por jugador o equipo con
  sus marcas gigantes (`/`, `✕`, `Ⓧ`), puntos y MPR. Las celdas se iluminan al recibir el dardo.
- **Marcadores de retransmisión:** paneles rojos y azules, jugador activo elevado, corona para el
  ganador y animación de número al cambiar la tirada.
- **Pantalla completa:** botón de maximizado con Fullscreen API y modo cine como respaldo.
- **Sonido y ambiente:** efectos de sonido sintetizados según la tirada y la puntuación (sin voz),
  confeti y pulso del jugador activo.
- **Sin recargas de página:** los cambios de dardo actualizan solo el marcador, no toda la pantalla.
- **Identidad real del jugador:** cada dardo guarda también su Radikal ID. El visor resuelve la ficha, el nombre completo y la foto por ID aunque el alias no esté en el índice público de rankings.
- **Diana avanzada (enlace "Avanzado"):** la diana pinta la zona real de cada impacto con el color del
  jugador. Los dardos fuera de la diana no se representan y, si dos jugadores coinciden, la zona se
  divide en franjas. Incluye filtro por jugador, detalle de un dardo y exportación a CSV.

### Endpoints de partidas finalizadas y chat

| Endpoint | Uso |
|---|---|
| `GET /api/live/recordings` | Listado de partidas finalizadas agrupadas por juegos. |
| `GET /api/live/recordings/{compid}/{encid}/{ngame}` | Partida completa con estadísticas por jugador. |
| `GET /api/live/recordings/{compid}/{encid}/{ngame}/csv` | Volcado CSV de dardos y resumen. |
| `POST /api/live/recordings/{compid}/{encid}/{ngame}/sync` | Fuerza un sondeo inmediato del directo. |
| `DELETE /api/live/recordings/{compid}/{encid}/{ngame}` | Borra una partida finalizada. |
| `GET /api/chat/{sala}?after={id}` | Mensajes nuevos del chat de la partida. |
| `POST /api/chat/{sala}` | Publica `{ name, text }` en el chat (máx. 300 mensajes por sala). |

El chat se guarda en `App_Data/chat/{sala}.json` y el visor lo sincroniza cada 3,5 s mientras está
abierta la pestaña **Directo**.

## Personalización tras el login

- La portada cambia a una versión personalizada con alias, PPD actual, MPR actual, Radikal Points,
  member hasta, competiciones en curso y próxima cita.
- Accesos directos a rendimiento, competiciones, puntos y perfil.
- Recomendación de productos de la tienda ajustada a los Radikal Points disponibles.
- El **Coach Radikal** del área de jugador responde con datos reales del perfil (PPD, MPR, victorias,
  competiciones y puntos). Es una guía basada en reglas, no un LLM, y no inventa coordenadas de dardos.

## Inicio y experiencia móvil

- **Inicio simplificado** en cuatro bloques: hero con vídeo de marca de Radikal (a sangre, sin
  redondeos y pegado bajo la cabecera), accesos rápidos, directo + top players y agenda + locales.
- **Vídeo ambiental con contenido real**: además del MP4 de marca, el hero carga la **playlist oficial
  de Radikal en YouTube** (campeonatos, jugadores, eventos) silenciada, en bucle y sin controles, como
  capa de animación. Si el navegador la bloquea queda el MP4 como respaldo.
- El vídeo arranca silenciado y en bucle, se pausa fuera de pantalla y se desactiva con
  `prefers-reduced-motion`.
- **Modo app en móvil:** sin zoom (viewport + gestos + inputs de 16px para evitar el zoom de iOS),
  contenido centrado, navegación inferior fija con safe areas, sin desbordes horizontales y
  modales como hoja inferior. Verificado en 390 px en todas las pantallas.

## País, ranking global y tema

- **Selector de país en la cabecera**: menú desplegable con **bandera real (PNG) + nombre**, buscador
  interno, grupos (comunidad activa / resto) y marca del país activo. España por defecto; la elección
  se guarda en `localStorage` y la comparten rankings, competiciones y la portada. Las banderas se
  sirven desde `/api/flags/{iso}` con caché en disco (Windows no dibuja emoji de bandera).
- **Rankings con dos vistas**:
  - *Mi país*: ranking por juego, diana y género (sin selector de país ni provincia: el país se cambia
    desde la cabecera). Pódium destacado y lista en tarjetas con **bandera de cada jugador**, posición
    con acento metálico en el top-3 y azul en el top-10.
  - *Global*: `pais=0` de Radikal —top real de todos los países— más una **comparativa por país**
    (mejor marca, media y jugadores). Pulsar un país abre su ranking local.
- **Topbar**: el elemento activo se marca con un **subrayado doble azul/rojo** que crece de fuera
  hacia dentro (azul de izquierda a derecha y rojo de derecha a izquierda, hasta el 65 % cada uno).
- **Competiciones** con tarjetas rediseñadas (riel por tipo, estado, fechas y CTA) y filtros de tipo
  y estado como segmentos; el país activo se muestra como chip.
- **Tema claro/oscuro** con botón en la cabecera, persistencia y respeto a `prefers-color-scheme`.
  Cubre todas las pantallas, incluidas diana, tienda, áreas y mapas.

### Endpoints de ranking

| Endpoint | Uso |
|---|---|
| `GET /api/rankings?country=&...` | Ranking de un país (o `country=0` para el global). |
| `GET /api/rankings/global?game=&diana=&gender=` | Top global + resumen agregado por país. |

## Directorio de jugadores y buscador global

- **Buscador global (Ctrl + K)** con búsqueda por:
  - **alias** (`DAVID RUIZ`),
  - **nombre completo** (`David Ruiz Bautista`),
  - **Radikal ID** (`RB08071998`, el DNI con el que se da de alta el jugador),
  - **ID de jugador** (`S021Myu7iyc`) y **ID de Official Player** (`405`).
- Los resultados muestran avatar, nombre real y mejor puesto; los jugadores aparecen en el grupo
  **Jugadores** y los oficiales en **Official Players**.
- **Ficha pública** en `#/jugador/{id}`:
  - hero con foto, alias, nombre completo, país, localidad, equipo e IDs copiables;
  - **estadísticas oficiales PPD/MPR** (media, partidas, victorias, % de victorias, hat tricks, ton 80,
    bulls, doble bull, salidas, etc.) cuando se busca por Radikal ID;
  - **diana preferida** (se deduce del sufijo del rating o de los rankings);
  - tarjetas destacadas con **victorias, victorias por equipo, win rate, low tons, bulls y doble bulls**.
    No se muestran las listas interminables de hat tricks, salidas, etc.;
  - **competiciones, torneos y ligas** del jugador con enlace a cada competición;
  - si hay sesión de Radikal, se añade el **rating actual PPD/MPR** del área privada junto a la media
    total pública. Fuente oficial: el bloque `.puntajes` de `jugadores2.php` (18.92 PPD / 2.17 MPR en
    el ejemplo), `jugadores10.php` para las competiciones, `subscriptions.php` para el member hasta y
    las tablas de historial de `jugadores5.php` (Rating) y `jugadores8_1.php` (Mis Estadísticas).
    Sin sesión, Radikal no expone el rating privado. El botón **Conectar mi cuenta** lleva a Mi área
    con un `next` y, tras el login, vuelve automáticamente a la ficha;
  - **Cuenta Radikal**: Radikal Points, bonus, tipo de miembro y validez;
  - **privacidad de medias**: en Mi área → Mis datos el jugador puede activar
    “Compartir mis medias PPD/MPR en mi ficha pública”. Si no lo activa, la ficha pública **no muestra
    ninguna media** (solo el resumen deportivo). Si lo activa, al iniciar sesión se guardan sus medias
    reales y sus competiciones en `App_Data/shared-ratings.json`, de modo que la ficha pública por
    Radikal ID las muestre sin necesidad de sesión. Las competiciones se guardan al iniciar sesión
    aunque no se compartan las medias;
  - tabla de clasificaciones (puesto nacional y global por juego/diana);
  - enlace a la ficha oficial si el jugador es Official Player.
- **Búsqueda por Radikal ID**: `GET /api/players/lookup?radikalId=` consulta el endpoint público
  `ajax.newstats.php?action=total_user` de Radikal, que acepta el DNI y devuelve identidad + estadísticas
  de **cualquier jugador con actividad registrada**, aunque no esté en ningún ranking.
- El directorio se construye agregando los rankings públicos de Radikal (top por país, juego y diana)
  y se refresca cada 30 minutos en segundo plano.

| Endpoint | Uso |
|---|---|
| `GET /api/players/lookup?radikalId=` | Busca por Radikal ID (DNI) y devuelve identidad + estadísticas. |
| `GET /api/players/search?q=` | Busca jugadores por alias, nombre completo o ID. |
| `GET /api/players/{id}` | Ficha pública: acepta tanto el ID opaco del ranking como el Radikal ID. |
| `GET /api/search?q=` | Buscador global: jugadores + oficiales + competiciones + dianas + Top Places. |

## Official Players

- Selector Platinum / Golden / Silver con **fondo blanco fijo** (los PNG oficiales llevan tipografía
  negra y necesitan contraste en ambos temas).
- Tarjetas rediseñadas: foto vertical, **recuadro blanco con el PNG del nivel**, alias y acento de color
  según Platinum/Golden/Silver. Carga por tandas de 24 para no saturar la red.
- **Ficha propia** en `#/official/{id}`: hero con el color del nivel, **foto (retrato)**, **ficha técnica
  como fondo de cabecera**, bandera del país, provincia, mano de juego, estadísticas (PPD/MPR AE y AA),
  **galería de imágenes** con visor (teclado ← → y Esc), competiciones actuales, **redes sociales del
  jugador** y botones de compartir.
- El backend **mide cada imagen** (ImageSharp) y clasifica: retrato (vertical) para la foto y
  apaisada (ficha técnica) para el fondo. Si no hay retrato usa la primera imagen como respaldo.
- Las imágenes oficiales (≈1,5 MB cada una) se cachean en disco y se sirven **redimensionadas**
  (`?w=460/560/720` con ImageSharp), reduciendo cada tarjeta a ~35 KB.

### Endpoints de Official Players

| Endpoint | Uso |
|---|---|
| `GET /api/official-players/{id}` | Ficha con medios, estadísticas, competiciones y redes. |
| `GET /api/photos/official?mediaId=&w=` | Imagen oficial cacheada; `w` genera miniatura redimensionada. |

## Identidad visual
- Azul oficial `#1899c9` / cian `#00c2ff` y rosa `#ff30a4` (paleta del logo oficial).
- Logos oficiales de **Radikal Darts Players**, **Radikal Darts**, **Platinum**, **Golden** y **Silver**.
- Tipografías Archivo Black + Raleway, alineadas con la comunicación de Radikal.
- Interfaz corporativa clara sobre fondo `#f3f6fa`, cabecera blanca y paneles de marca en azul marino.
- **Navegación inferior móvil** con Inicio, Rankings, Directo, Tienda y Mi área.
- El resumen del jugador usa exclusivamente **PPD actual** y **MPR actual** como medias.

## Arquitectura

```
Navegador
   │  fetch JSON / cookies de sesión
   ▼
RadikalPlayers.Web (ASP.NET Core)
   │  HttpClient tipado + caché + parseo AngleSharp
   ▼
esp.radikalplayers.com / www.radikalplayers.com
```

El navegador **nunca llama directamente** a los endpoints de Radikal: todo pasa por nuestra API,
lo que permite cachear, normalizar, limitar peticiones y añadir la capa de autenticación.

## Estructura

```
apps/RadikalPlayers/
  Program.cs
  Api/                 Endpoints REST + auth + middleware de errores
  Radikal/             Cliente, modelos, parsers, caché y servicio de sesión
  wwwroot/
    index.html
    css/app.css
    js/                Router, vistas, componentes, auth
    img/brand/         Logos oficiales
    vendor/            Leaflet + MarkerCluster
```

## Notas

- Prototipo **no oficial** para presentación comercial.
- Los datos pertenecen a Radikal Darts / Radikal Players.
- En producción: HTTPS, almacenamiento distribuido de sesiones, rate limiting y revisión legal/privacidad.
- Para el pitch: `#/mi-area?demo=1` abre el área de jugador sin credenciales.

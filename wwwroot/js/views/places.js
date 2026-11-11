import { api } from "../api.js?v=77";
import { esc, icon, formatNumber, debounce, officialBadge, emptyState } from "../ui.js?v=77";

const BOARD_LABELS = {
    AMERICAN: "American",
    EUROPEAN: "European",
    BRISTLE: "Bristle"
};

export async function render(container, params, query) {
    let map = null;
    let cluster = null;
    let placesLayer = null;
    let allDianas = [];
    let allPlaces = [];
    let boardFilter = "ALL";
    let searchController = null;
    let selectedDiana = null;

    container.innerHTML = shell();
    bindFilters();

    try {
        const [dianas, places] = await Promise.all([api.dianas(), api.places()]);
        allDianas = dianas.items || [];
        allPlaces = places || [];

        updateStats(dianas);
        renderPlacesList(allPlaces);
        renderTopPlaces(allPlaces);
        initMap();
        applyBoardFilter();

        // Leaflet necesita medir el contenedor ya visible antes de centrar.
        window.setTimeout(() => {
            if (!map) return;
            map.invalidateSize();
            const machineId = query.get("machine");
            const placeId = query.get("place");
            if (machineId) focusDiana(Number(machineId));
            else if (placeId) focusPlace(Number(placeId));
            else map.setView([40.4168, -3.7038], 5);
        }, 120);
    } catch (error) {
        container.querySelector("#map-canvas").innerHTML = `
            <div class="empty-state" style="margin:20px">
                ${icon("info")}
                <h3>No se pudo cargar el mapa</h3>
                <p>${esc(error.message)}</p>
                <button class="btn btn-outline btn-sm" id="places-retry" style="margin-top:14px">Reintentar</button>
            </div>
        `;
        container.querySelector("#places-retry")?.addEventListener("click", () => render(container, params, query));
    }

    function shell() {
        return `
            <div class="page container">
                <div class="section-head" style="margin-bottom:18px">
                    <div class="section-head-left">
                        <span class="kicker">${icon("pin")}Busca tu diana</span>
                        <h1 class="section-title">Tu diana, <span class="accent">en el mapa</span></h1>
                        <p class="section-sub">Localiza dianas Radikal, consulta sus máquinas y abre la ruta.</p>
                    </div>
                    <a class="btn btn-outline btn-sm" href="https://esp.radikalplayers.com/localizador-de-dianas.php?dp=Y" target="_blank" rel="noopener">${icon("external")} Localizador oficial</a>
                </div>

                <div class="kpi-grid" style="margin-bottom:16px">
                    <div class="kpi"><strong id="stat-dianas">—</strong><span>Dianas Radikal</span></div>
                    <div class="kpi"><strong id="stat-places">—</strong><span>Top Places</span></div>
                    <div class="kpi"><strong id="stat-american">—</strong><span>American</span></div>
                    <div class="kpi"><strong id="stat-european">—</strong><span>European</span></div>
                </div>

                <div class="map-layout">
                    <aside class="map-sidebar">
                        <div class="map-sidebar-head">
                            <h2>Dianas cerca de ti</h2>
                            <p>Busca por local o diana y el mapa irá contigo.</p>
                            <div class="search-field" style="margin-top:12px">
                                ${icon("search")}
                                <input class="form-control" id="place-search" type="search" placeholder="Busca un local o una diana..." autocomplete="off" />
                            </div>
                        </div>
                        <div class="map-filters" id="board-filters">
                            <button class="map-filter active" data-board="ALL">Todas</button>
                            <button class="map-filter" data-board="AMERICAN">American</button>
                            <button class="map-filter" data-board="EUROPEAN">European</button>
                            <button class="map-filter" data-board="BRISTLE">Bristle</button>
                        </div>
                        <div class="map-list" id="map-list">
                            <div class="skeleton skeleton-line" style="height:58px;margin:4px"></div>
                            <div class="skeleton skeleton-line" style="height:58px;margin:4px"></div>
                            <div class="skeleton skeleton-line" style="height:58px;margin:4px"></div>
                        </div>
                    </aside>
                    <div class="map-canvas" id="map-canvas">
                        <div id="map"></div>
                        <div class="place-map-card" id="map-card" hidden></div>
                    </div>
                </div>

                <section class="section">
                    <div class="section-head">
                        <div class="section-head-left">
                            <span class="kicker">${icon("map")}Top Places</span>
                            <h2 class="section-title">Los locales <span class="accent">de referencia</span></h2>
                            <p class="section-sub">Locales con más actividad y máquinas Radikal.</p>
                        </div>
                    </div>
                    <div class="place-grid" id="top-places">
                        <div class="skeleton skeleton-card"></div>
                        <div class="skeleton skeleton-card"></div>
                        <div class="skeleton skeleton-card"></div>
                    </div>
                </section>
            </div>
        `;
    }

    function bindFilters() {
        container.querySelectorAll("#board-filters .map-filter").forEach((button) => {
            button.addEventListener("click", () => {
                container.querySelectorAll("#board-filters .map-filter").forEach((b) => b.classList.remove("active"));
                button.classList.add("active");
                boardFilter = button.dataset.board;
                applyBoardFilter();
            });
        });

        container.querySelector("#place-search")?.addEventListener("input", debounce((event) => {
            const value = event.target.value.trim();
            if (value.length < 2) {
                renderPlacesList(allPlaces);
                return;
            }
            runSearch(value);
        }, 300));
    }

    function updateStats(dianas) {
        const byType = dianas.byType || {};
        container.querySelector("#stat-dianas").textContent = formatNumber(dianas.total);
        container.querySelector("#stat-places").textContent = formatNumber(allPlaces.length);
        container.querySelector("#stat-american").textContent = formatNumber(byType.AMERICAN || 0);
        container.querySelector("#stat-european").textContent = formatNumber(byType.EUROPEAN || 0);
    }

    function renderPlacesList(places) {
        const list = container.querySelector("#map-list");
        if (!list) return;
        if (!places.length) {
            list.innerHTML = `<p class="small muted" style="padding:14px">Sin resultados.</p>`;
            return;
        }
        list.innerHTML = places.slice(0, 80).map((place) => `
            <button class="map-list-item" data-place-id="${place.id}">
                <span class="map-pin"></span>
                <span>
                    <strong>${esc(place.name)}</strong>
                    <small>${esc(place.type)} · ${formatNumber(place.machines)} dianas</small>
                </span>
            </button>
        `).join("");

        list.querySelectorAll("[data-place-id]").forEach((button) => {
            button.addEventListener("click", () => focusPlace(Number(button.dataset.placeId)));
        });
    }

    function renderTopPlaces(places) {
        const target = container.querySelector("#top-places");
        if (!target) return;
        target.innerHTML = places.slice(0, 9).map((place) => `
            <article class="place-card">
                <div class="place-card-top">
                    ${officialBadge(place.type)}
                    <span class="chip chip-soft">${formatNumber(place.machines)} dianas</span>
                </div>
                <h4>${esc(place.name)}</h4>
                <div class="place-meta">${esc(place.type)} · ${place.lat.toFixed(3)}, ${place.lng.toFixed(3)}</div>
                <div class="place-actions">
                    ${place.mapsUrl ? `<a href="${esc(place.mapsUrl)}" target="_blank" rel="noopener">${icon("map")} Maps</a>` : ""}
                    ${place.phone ? `<a href="tel:${esc(place.phone)}">${icon("phone")} Llamar</a>` : ""}
                    ${place.facebookUrl ? `<a href="${esc(place.facebookUrl)}" target="_blank" rel="noopener">${icon("facebook")} Facebook</a>` : ""}
                    <a href="#/lugares?place=${place.id}">${icon("pin")} Ver en mapa</a>
                </div>
            </article>
        `).join("");
    }

    function initMap() {
        if (!window.L) return;
        map = L.map("map", {
            zoomControl: true,
            attributionControl: true,
            minZoom: 2,
            worldCopyJump: true
        }).setView([40.4168, -3.7038], 5);

        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 19
        }).addTo(map);

        cluster = L.markerClusterGroup({
            chunkedLoading: true,
            maxClusterRadius: 55,
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
            iconCreateFunction: (clusterGroup) => {
                const count = clusterGroup.getChildCount();
                const size = count > 200 ? 48 : count > 50 ? 42 : 36;
                return L.divIcon({
                    html: `<span class="cluster-marker" style="width:${size}px;height:${size}px">${count}</span>`,
                    className: "",
                    iconSize: [size, size]
                });
            }
        });
        map.addLayer(cluster);

        placesLayer = L.layerGroup().addTo(map);
        allPlaces.forEach((place) => {
            const marker = L.marker([place.lat, place.lng], {
                icon: L.divIcon({
                    html: `<span class="place-marker">${icon("trophy")}</span>`,
                    className: "",
                    iconSize: [28, 28]
                }),
                title: place.name
            });
            marker.on("click", () => showPlaceCard(place));
            marker.addTo(placesLayer);
        });
    }

    function applyBoardFilter() {
        if (!map || !cluster) return;
        cluster.clearLayers();
        const filtered = boardFilter === "ALL" ? allDianas : allDianas.filter((d) => d.boardType === boardFilter);
        const markers = filtered.map((diana) => {
            const marker = L.marker([diana.lat, diana.lng], {
                icon: L.divIcon({
                    html: `<span class="diana-marker ${diana.boardType.toLowerCase()}"></span>`,
                    className: "",
                    iconSize: [12, 12]
                }),
                title: `Diana #${diana.id}`
            });
            marker.on("click", () => focusDiana(diana.id, false));
            return marker;
        });
        cluster.addLayers(markers);
    }

    async function focusDiana(id, fit = true) {
        const diana = allDianas.find((item) => Number(item.id) === Number(id));
        if (!diana || !map) {
            showMapCard(`<h4>Diana #${esc(id)}</h4><p>No se encontró en el mapa actual.</p>`);
            return;
        }
        if (fit) map.setView([diana.lat, diana.lng], 15);
        showMapCard(`<h4>Diana #${esc(diana.id)}</h4><p>${esc(BOARD_LABELS[diana.boardType] || diana.boardType)} · ${diana.lat.toFixed(4)}, ${diana.lng.toFixed(4)}</p><p class="small muted" style="margin-top:8px">Cargando ficha…</p>`);
        try {
            const detail = await api.diana(diana.id);
            selectedDiana = detail;
            showMapCard(`
                <h4>${esc(detail.name || `Diana #${diana.id}`)}</h4>
                <p>${esc([detail.address, detail.city].filter(Boolean).join(" · ") || "Sin dirección publicada")}</p>
                <p class="small muted" style="margin-top:6px">${esc(BOARD_LABELS[diana.boardType] || diana.boardType)} · ${detail.competitions?.length || 0} competiciones</p>
                <div class="actions">
                    <a href="https://www.google.com/maps?q=${diana.lat},${diana.lng}" target="_blank" rel="noopener">Google Maps</a>
                    <a href="https://www.radikalplayers.com/dianas/Radikal/Maps/iframev4.php?ident=${diana.id}" target="_blank" rel="noopener">Ficha oficial</a>
                </div>
            `);
        } catch {
            showMapCard(`<h4>Diana #${esc(diana.id)}</h4><p>${esc(BOARD_LABELS[diana.boardType] || diana.boardType)}</p><p class="small muted" style="margin-top:8px">No se pudo cargar la ficha del local.</p>`);
        }
    }

    function focusPlace(id) {
        const place = allPlaces.find((item) => Number(item.id) === Number(id));
        if (!place || !map) return;
        map.setView([place.lat, place.lng], 13);
        showPlaceCard(place);
    }

    function showPlaceCard(place) {
        showMapCard(`
            <h4>${esc(place.name)}</h4>
            <p>${esc(place.type)} · ${formatNumber(place.machines)} dianas</p>
            <div class="actions">
                ${place.mapsUrl ? `<a href="${esc(place.mapsUrl)}" target="_blank" rel="noopener">Maps</a>` : ""}
                ${place.phone ? `<a href="tel:${esc(place.phone)}">Llamar</a>` : ""}
                ${place.facebookUrl ? `<a href="${esc(place.facebookUrl)}" target="_blank" rel="noopener">Facebook</a>` : ""}
            </div>
        `);
    }

    function showMapCard(htmlContent) {
        const card = container.querySelector("#map-card");
        if (!card) return;
        card.hidden = false;
        card.innerHTML = `
            <button class="icon-btn" id="map-card-close" style="position:absolute;right:10px;top:10px;width:28px;height:28px" aria-label="Cerrar">${icon("close")}</button>
            ${htmlContent}
        `;
        card.querySelector("#map-card-close")?.addEventListener("click", () => {
            card.hidden = true;
            selectedDiana = null;
        });
    }

    async function runSearch(query) {
        searchController?.abort();
        searchController = new AbortController();
        const list = container.querySelector("#map-list");
        if (!list) return;
        list.innerHTML = `<p class="small muted" style="padding:14px">Buscando “${esc(query)}”…</p>`;

        try {
            const results = await api.search(query, searchController.signal);
            const relevant = results.filter((r) => r.kind === "diana" || r.kind === "place");
            if (!relevant.length) {
                list.innerHTML = `<p class="small muted" style="padding:14px">Sin resultados para “${esc(query)}”.</p>`;
                return;
            }
            list.innerHTML = relevant.map((item) => `
                <button class="map-list-item" data-kind="${esc(item.kind)}" data-id="${esc(item.id)}">
                    <span class="map-pin ${item.kind === "place" ? "bristle" : ""}"></span>
                    <span>
                        <strong>${esc(item.title)}</strong>
                        <small>${esc(item.subtitle || (item.kind === "place" ? "Top Place" : "Diana"))}</small>
                    </span>
                </button>
            `).join("");

            list.querySelectorAll("[data-kind]").forEach((button) => {
                button.addEventListener("click", () => {
                    if (button.dataset.kind === "diana") focusDiana(Number(button.dataset.id));
                    else focusPlace(Number(button.dataset.id));
                });
            });
        } catch (error) {
            if (error.name === "AbortError") return;
            list.innerHTML = `<p class="small muted" style="padding:14px">No se pudo buscar: ${esc(error.message)}</p>`;
        }
    }

    return () => {
        searchController?.abort();
        if (map) map.remove();
        map = null;
        cluster = null;
        placesLayer = null;
    };
}

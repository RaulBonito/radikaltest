import { api } from "../api.js?v=79";
import {
    esc, icon, avatarHtml, formatNumber, emptyState, openModal, toast, officialBadge
} from "../ui.js?v=78";
import { getCurrentPlayer, setCurrentPlayer, logout, openLoginModal } from "../auth.js?v=81";

const TYPE_LABELS = {
    LIGA: "Liga",
    CAMP: "Campeonato",
    TORX: "Torneo",
    LVIRT: "Liga virtual"
};

const METRIC_LABELS = {
    hattricks: "Hattricks",
    superhattricks: "Super hattricks",
    threeinabeds: "3 in a bed",
    ton80s: "Ton 80",
    hitons: "High tons",
    lowtons: "Low tons",
    maxton: "Mejor tono",
    whitehorses: "White horses",
    "4RO": "4 rondas",
    "5RO": "5 rondas",
    "6RO": "6 rondas",
    "7RO": "7 rondas",
    "8RO": "8 rondas",
    "9RO": "9 rondas",
    "10RO": "10 rondas",
    "11RO": "11 rondas",
    "12RO": "12 rondas",
    "4DO": "4 dardos",
    "5DO": "5 dardos",
    "6DO": "6 dardos",
    "7DO": "7 dardos",
    "8DO": "8 dardos",
    "9DO": "9 dardos",
    "10DO": "10 dardos",
    "11DO": "11 dardos",
    "12DO": "12 dardos",
    AST: "Asistencias",
    bull: "Bulls",
    doublebull: "Doble bull",
    "5MR": "5MR",
    "6MR": "6MR",
    "7MR": "7MR",
    "8MR": "8MR",
    "9MR": "9MR"
};

const X01_METRICS = ["hattricks", "lowtons", "5RO", "6RO", "7RO", "8RO", "12DO", "bull", "doublebull"];
const CRICKET_METRICS = ["5MR", "6MR", "7MR", "8MR", "9MR", "whitehorses", "bull", "doublebull"];

const TABS = [
    { id: "overview", label: "Resumen" },
    { id: "competitions", label: "Competiciones" },
    { id: "performance", label: "Rendimiento" },
    { id: "points", label: "Puntos" },
    { id: "items", label: "Mis items" },
    { id: "data", label: "Mis datos" }
];

const TAB_ICONS = {
    overview: "chart",
    competitions: "trophy",
    performance: "spark",
    points: "fire",
    items: "bag",
    data: "camera"
};

export async function render(container, params, query) {
    let player = getCurrentPlayer();
    let area = null;
    const nextRoute = query?.get("next") || null;
    let activeTab = "overview";
    let activeCompetitionTab = "current";
    let autoLoginShown = false;
    const itemsState = { data: null, loading: false, error: null, busy: null, type: "ALL" };
    let shareState = { share: false, loading: true };
    let photoState = { version: Date.now(), uploading: false };
    let loading = true;

    const requestedTab = query?.get("tab");
    if (requestedTab && TABS.some((tab) => tab.id === requestedTab)) activeTab = requestedTab;

    if (!player) {
        try {
            player = await api.authMe();
            setCurrentPlayer(player);
        } catch {
            player = null;
        }
    }

    if (!player) {
        drawGuest();
        return;
    }

    container.innerHTML = loadingView();
    await loadArea(false);

    async function loadArea(refresh) {
        loading = true;
        try {
            area = await api.playerArea(refresh);
            if (!area) {
                player = null;
                drawGuest();
                return;
            }
            loading = false;
            drawShell();
            void loadShareState();
        } catch (error) {
            if (error.status === 401) {
                player = null;
                drawGuest();
                return;
            }
            container.innerHTML = `
                <div class="page container">
                    <div class="error-box">
                        <strong>No se pudo cargar tu área.</strong>
                        <p style="margin:6px 0 14px">${esc(error.message)}</p>
                        <button class="btn btn-outline btn-sm" id="area-retry">Reintentar</button>
                    </div>
                </div>
            `;
            container.querySelector("#area-retry")?.addEventListener("click", () => loadArea(true));
        }
    }

    async function loadShareState() {
        try {
            const data = await api.playerShareRatings();
            shareState = { share: Boolean(data?.share), loading: false };
        } catch {
            shareState = { share: false, loading: false };
        }
        if (activeTab === "data") drawTab();
    }

    function drawShell() {
        const account = area.account;
        const stats = area.stats;
        const winRate = stats?.x01?.winPercent ?? stats?.cricket?.winPercent ?? 0;

        container.innerHTML = `
            <div class="page container">
                <div class="section-head player-area-head">
                    <div class="section-head-left">
                        <span class="kicker">${icon("users")}Mi área</span>
                        <h1 class="section-title">Tu perfil <span class="accent">Radikal</span></h1>
                    </div>
                    <div class="player-area-actions">
                        <button class="btn btn-outline btn-sm" id="area-refresh" aria-label="Actualizar">${icon("refresh")} <span>Actualizar</span></button>
                        <button class="btn btn-ghost btn-sm" id="area-logout" aria-label="Cerrar sesión">${icon("close")} <span>Cerrar sesión</span></button>
                    </div>
                </div>

                <div class="player-mobile-menu" aria-label="Secciones de Mi Área">
                    ${TABS.map((tab) => `
                        <button class="player-mobile-menu-item ${tab.id === activeTab ? "is-active" : ""}"
                                type="button" data-mobile-tab="${tab.id}">
                            <span class="player-mobile-menu-icon">${icon(TAB_ICONS[tab.id] || "chart")}</span>
                            <strong>${tab.label}</strong>
                        </button>
                    `).join("")}
                </div>

                <div class="player-overview-hero" data-overview-hero ${activeTab === "overview" ? "" : "hidden"}>
                    <section class="player-hero reveal">
                        <div class="player-avatar-xl">
                            ${avatarHtml(account.alias, account.photoUrl)}
                            <span class="avatar-badge">MEMBER</span>
                        </div>
                        <div class="player-hero-info">
                            ${account.memberType ? `
                                <div class="player-hero-top">
                                    <span class="badge badge-member">${esc(account.memberType)}</span>
                                </div>
                            ` : ""}
                            <h1>${esc(account.alias)}</h1>
                            <div class="player-badges">
                                <span class="badge badge-silver">${esc(account.countryCode || "ES")}</span>
                                ${account.memberUntil ? `<span class="badge badge-outline">${icon("shield")} Member hasta ${esc(account.memberUntil)}</span>` : ""}
                            </div>
                            <div class="player-hero-actions">
                                <a class="btn btn-primary btn-sm" href="#/jugador/${encodeURIComponent(account.dni || "")}">${icon("external")} Ver ficha</a>
                                <button class="btn btn-outline btn-sm" type="button" data-shell-tab="data">${icon("camera")} Editar perfil</button>
                            </div>
                        </div>
                        <div class="player-hero-side">
                            <div class="hero-mini-stat">
                                <span>PPD actual</span>
                                <strong>${esc(splitRating(account.currentPpd).value)}</strong>
                                <small>${esc(splitRating(account.currentPpd).suffix || "aro ancho")}</small>
                            </div>
                            <div class="hero-mini-stat">
                                <span>MPR actual</span>
                                <strong>${esc(splitRating(account.currentMpr).value)}</strong>
                                <small>${esc(splitRating(account.currentMpr).suffix || "aro ancho")}</small>
                            </div>
                            <div class="hero-mini-stat">
                                <span>Radikal Points</span>
                                <strong>${formatNumber(account.radikalPoints)}</strong>
                                <small>Bonus ${formatNumber(account.bonus)}</small>
                            </div>
                        </div>
                    </section>
                </div>

                <div class="player-tabs" role="tablist" aria-label="Secciones del área">
                    ${TABS.map((tab) => `<button class="player-tab ${tab.id === activeTab ? "active" : ""}" data-tab="${tab.id}" type="button">${tab.label}</button>`).join("")}
                </div>

                <div id="player-tab-content"></div>
            </div>
        `;

        container.querySelector("#area-refresh")?.addEventListener("click", () => loadArea(true));
        container.querySelector("#area-logout")?.addEventListener("click", logout);
        container.querySelectorAll(".player-tab").forEach((button) => {
            button.addEventListener("click", () => selectTab(button.dataset.tab));
        });
        container.querySelectorAll("[data-mobile-tab]").forEach((button) => {
            button.addEventListener("click", () => selectTab(button.dataset.mobileTab));
        });
        container.querySelectorAll("[data-shell-tab]").forEach((button) => {
            button.addEventListener("click", () => selectTab(button.dataset.shellTab));
        });

        drawTab();
        animateCounters();
    }

    function selectTab(tabId) {
        if (!TABS.some((tab) => tab.id === tabId)) return;
        activeTab = tabId;
        container.querySelectorAll(".player-tab").forEach((button) => {
            button.classList.toggle("active", button.dataset.tab === activeTab);
        });
        container.querySelectorAll("[data-mobile-tab]").forEach((button) => {
            button.classList.toggle("is-active", button.dataset.mobileTab === activeTab);
        });
        const overviewHero = container.querySelector("[data-overview-hero]");
        if (overviewHero) overviewHero.hidden = activeTab !== "overview";
        drawTab();
        if (activeTab === "items") loadItems();
        if (window.matchMedia?.("(max-width: 760px)")?.matches) {
            container.querySelector(".player-mobile-menu")?.scrollIntoView({ block: "start", behavior: "smooth" });
        }
    }

    function drawTab() {
        const content = container.querySelector("#player-tab-content");
        if (!content) return;

        if (activeTab === "overview") content.innerHTML = overviewView();
        else if (activeTab === "competitions") content.innerHTML = competitionsView();
        else if (activeTab === "performance") content.innerHTML = performanceView();
        else if (activeTab === "points") content.innerHTML = pointsView();
        else if (activeTab === "items") content.innerHTML = itemsView();
        else content.innerHTML = dataView();

        content.classList.remove("tab-enter");
        void content.offsetWidth;
        content.classList.add("tab-enter");
        bindTab();
        animateCounters();
        revealStagger();
    }

    function overviewView() {
        const account = area.account;
        const current = area.currentCompetitions || [];
        const points = (area.points || []).slice(0, 3);
        return `
            <div class="player-section">
                <div class="player-section-head">
                    <div>
                        <span class="kicker">${icon("chart")}Rendimiento total</span>
                        <h2 class="player-section-title">Tu juego, <span class="accent">en números</span></h2>
                    </div>
                    <button class="btn btn-ghost btn-sm" data-tab-jump="performance">Ver detalle ${icon("arrow")}</button>
                </div>
                <div class="stats-highlight-grid stats-overview">
                    ${statModeCard("X01", area.stats?.x01, X01_METRICS, false, splitRating(account.currentPpd).value, "PPD actual")}
                    ${statModeCard("Cricket", area.stats?.cricket, CRICKET_METRICS, false, splitRating(account.currentMpr).value, "MPR actual")}
                </div>
            </div>

            ${coachView(area)}

            <div class="player-section">
                <div class="player-section-head">
                    <div>
                        <span class="kicker">${icon("play")}En juego</span>
                        <h2 class="player-section-title">Competiciones <span class="accent">en curso</span></h2>
                    </div>
                    <button class="btn btn-ghost btn-sm" data-tab-jump="competitions">Ver todas ${icon("arrow")}</button>
                </div>
                ${current.length ? `<div class="comp-grid">${current.slice(0, 2).map(playerCompetitionCard).join("")}</div>` : emptyState("Sin competiciones activas", "Cuando te inscribas en una competición aparecerá aquí.", "trophy")}
            </div>

            <div class="player-columns">
                <section class="player-section">
                    <div class="player-section-head">
                        <div>
                            <span class="kicker">${icon("spark")}Radikal Points</span>
                            <h2 class="player-section-title">Últimos <span class="accent">movimientos</span></h2>
                        </div>
                        <button class="btn btn-ghost btn-sm" data-tab-jump="points">Historial ${icon("arrow")}</button>
                    </div>
                    ${points.length ? `<div class="points-list">${points.map(pointRow).join("")}</div>` : emptyState("Sin movimientos", "Todavía no hay movimientos de puntos.", "spark")}
                </section>

                <aside class="player-side">
                    <div class="info-card premium-card">
                        <h4>Suscripción</h4>
                        <strong class="premium-name">${esc(area.subscription?.name || account.memberType || "Radikal Player")}</strong>
                        <p class="small muted">${area.subscription?.validUntil ? `Válida hasta ${esc(area.subscription.validUntil)}` : "Sin suscripción activa"}</p>
                        <div class="premium-points"><span>Radikal Points</span><strong>${formatNumber(account.radikalPoints)}</strong></div>
                        <a class="btn btn-outline btn-sm btn-block" href="https://esp.radikalplayers.com/shop/" target="_blank" rel="noopener">Renovar en Radikal ${icon("external")}</a>
                    </div>
                    <div class="info-card">
                        <h4>Accesos rápidos</h4>
                        <div class="quick-links">
                            <a href="#/rankings">${icon("users")} Mi ranking</a>
                            <a href="#/directo">${icon("play")} En directo</a>
                            <a href="#/lugares">${icon("pin")} Buscar diana</a>
                            <a href="https://www.radikalplayers.com/jugadores2.php" target="_blank" rel="noopener">${icon("external")} Web oficial</a>
                        </div>
                    </div>
                </aside>
            </div>
        `;
    }

    function coachView(state) {
        const account = state.account || {};
        const x01 = state.stats?.x01;
        const cricket = state.stats?.cricket;
        const current = state.currentCompetitions || [];
        const win = Math.max(Number(x01?.winPercent) || 0, Number(cricket?.winPercent) || 0);
        const ppd = splitRating(account.currentPpd).value;
        const mpr = splitRating(account.currentMpr).value;
        const points = account.radikalPoints || 0;
        const next = current[0];
        const insights = [
            {
                tag: "Tu base",
                title: win ? `${formatNumber(win)}% de victorias` : "Construye tu base",
                text: win >= 55
                    ? `Con ${ppd} PPD y ${mpr} MPR tu nivel actual es sólido. El siguiente salto está en cerrar antes los dobles y repetir tiradas de 60+.`
                    : `Con ${ppd} PPD y ${mpr} MPR tu prioridad es la constancia: asegura el 20, evita los 26 y entrena los dobles de cierre.`
            },
            {
                tag: "Próxima cita",
                title: next?.name || "Elige tu próxima competición",
                text: next
                    ? `Tu próxima competición es ${next.name}. Calienta con una rutina corta y revisa tus métricas al terminar.`
                    : "Cuando te apuntes a una liga o torneo aparecerá aquí con su cuadrante y sus partidas."
            },
            {
                tag: "Radikal Points",
                title: `${formatNumber(points)} puntos disponibles`,
                text: points >= 1000
                    ? "Ya puedes canjear productos de la tienda. Tu portada personalizada te muestra una selección con tus puntos."
                    : "Sigue jugando y sumando puntos para desbloquear personalizaciones, material y suscripciones."
            }
        ];

        return `
            <div class="player-section">
                <div class="player-section-head">
                    <div>
                        <span class="kicker">${icon("spark")}Coach Radikal</span>
                        <h2 class="player-section-title">Tu perfil, <span class="accent">en perspectiva</span></h2>
                        <p class="section-sub">Ideas calculadas con tus medias, tus victorias y tus competiciones reales.</p>
                    </div>
                </div>
                <div class="coach-layout">
                    <div class="coach-insights">
                        ${insights.map((insight) => `
                            <article class="coach-insight">
                                <span class="coach-insight-tag">${esc(insight.tag)}</span>
                                <h3>${esc(insight.title)}</h3>
                                <p>${esc(insight.text)}</p>
                            </article>
                        `).join("")}
                    </div>
                    <div class="coach-chat">
                        <div class="coach-chat-head">
                            <span class="coach-avatar">${icon("spark")}</span>
                            <div><strong>Coach Radikal</strong><small>Basado en tus datos reales</small></div>
                        </div>
                        <div class="coach-messages" id="coach-messages">
                            <div class="coach-message coach-message-bot">Pregúntame por tu PPD, tu MPR, tus victorias, tus competiciones o tus Radikal Points.</div>
                        </div>
                        <div class="coach-suggestions">
                            <button type="button" data-coach-q="¿Cómo puedo mejorar mi PPD?">Mejorar PPD</button>
                            <button type="button" data-coach-q="¿Cómo va mi cricket?">Mi cricket</button>
                            <button type="button" data-coach-q="¿Qué competiciones tengo?">Mis competiciones</button>
                        </div>
                        <form class="coach-form" id="coach-form">
                            <input class="form-control" id="coach-input" type="text" maxlength="160" placeholder="Pregunta sobre tu juego..." autocomplete="off" />
                            <button class="btn btn-primary btn-sm" type="submit" aria-label="Enviar pregunta">${icon("arrow")}</button>
                        </form>
                    </div>
                </div>
            </div>
        `;
    }

    function competitionsView() {
        const current = area.currentCompetitions || [];
        const finished = area.finishedCompetitions || [];
        const list = activeCompetitionTab === "current" ? current : finished;
        return `
            <div class="player-section">
                <div class="player-section-head">
                    <div>
                        <span class="kicker">${icon("chart")}Mi actividad</span>
                        <h2 class="player-section-title">Mis <span class="accent">competiciones</span></h2>
                    </div>
                    <div class="segmented" id="player-comp-tabs">
                        <button data-comp-tab="current" class="${activeCompetitionTab === "current" ? "active" : ""}" type="button">En curso (${current.length})</button>
                        <button data-comp-tab="finished" class="${activeCompetitionTab === "finished" ? "active" : ""}" type="button">Finalizadas (${finished.length})</button>
                    </div>
                </div>
                ${list.length ? `<div class="comp-grid">${list.map(playerCompetitionCard).join("")}</div>` : emptyState("Sin competiciones", "No hay competiciones en esta categoría.", "trophy")}
            </div>
        `;
    }

    function performanceView() {
        return `
            <div class="player-section">
                <div class="player-section-head">
                    <div>
                        <span class="kicker">${icon("chart")}Estadísticas</span>
                        <h2 class="player-section-title">Rendimiento <span class="accent">detallado</span></h2>
                        <p class="section-sub">Tu PPD y MPR actuales, con el detalle acumulado de partidas, victorias y métricas.</p>
                    </div>
                </div>
                <div class="stats-highlight-grid">
                    ${statModeCard("X01", area.stats?.x01, X01_METRICS, true, splitRating(area.account.currentPpd).value, "PPD actual")}
                    ${statModeCard("Cricket", area.stats?.cricket, CRICKET_METRICS, true, splitRating(area.account.currentMpr).value, "MPR actual")}
                </div>
            </div>
            <div class="player-section">
                <div class="player-section-head">
                    <div>
                        <span class="kicker">${icon("chart")}Métricas</span>
                        <h2 class="player-section-title">Cada detalle <span class="accent">cuenta</span></h2>
                    </div>
                </div>
                <div class="metrics-grid">
                    ${metricsGrid(area.stats?.x01, X01_METRICS)}
                    ${metricsGrid(area.stats?.cricket, CRICKET_METRICS)}
                </div>
            </div>
        `;
    }

    function itemsView() {
        if (itemsState.loading) {
            return `
                <div class="player-section">
                    <div class="player-section-head">
                        <div>
                            <span class="kicker">${icon("sliders")}Personalizaciones</span>
                            <h2 class="player-section-title">Mis <span class="accent">items</span></h2>
                        </div>
                    </div>
                    <div class="player-items-grid">
                        ${Array.from({ length: 3 }, () => `<div class="skeleton skeleton-card" style="height:240px"></div>`).join("")}
                    </div>
                </div>
            `;
        }

        if (itemsState.error && !itemsState.data) {
            return `
                <div class="player-section">
                    <div class="player-section-head">
                        <div>
                            <span class="kicker">${icon("sliders")}Personalizaciones</span>
                            <h2 class="player-section-title">Mis <span class="accent">items</span></h2>
                        </div>
                    </div>
                    <div class="error-box">${esc(itemsState.error)}</div>
                </div>
            `;
        }

        const all = itemsState.data?.items || [];
        const types = [...new Set(all.map((item) => item.type))];
        const items = itemsState.type === "ALL" ? all : all.filter((item) => item.type === itemsState.type);
        const labels = { BACKGROUND: "Fondos", DART: "Dardos", FEAT: "Feats", GOODSHOT: "Goodshots", AVATAR: "Avatares" };

        return `
            <div class="player-section">
                <div class="player-section-head">
                    <div>
                        <span class="kicker">${icon("sliders")}Personalizaciones</span>
                        <h2 class="player-section-title">Mis <span class="accent">items</span></h2>
                        <p class="section-sub">Fondos, dardos, feats y goodshots que has comprado en Radikal. Actívalos o desactívalos cuando quieras.</p>
                    </div>
                    <a class="btn btn-outline btn-sm" href="#/tienda">Ir a la tienda ${icon("arrow")}</a>
                </div>

                ${itemsState.error ? `<div class="error-box" style="margin-bottom:14px">${esc(itemsState.error)}</div>` : ""}

                ${itemsState.data?.requiresLogin
                    ? `<div class="empty-state">${icon("users")}<h3>Conecta tu Radikal ID</h3><p>Radikal pide tu sesión para mostrar los items de tu perfil.</p><button class="btn btn-primary btn-sm" id="items-connect" type="button">Iniciar sesión</button></div>`
                    : all.length
                        ? `<div class="items-toolbar">
                               <div class="items-filters">
                                   <button class="items-filter ${itemsState.type === "ALL" ? "is-active" : ""}" type="button" data-item-type="ALL">Todos <span>${all.length}</span></button>
                                   ${types.map((type) => `
                                       <button class="items-filter ${itemsState.type === type ? "is-active" : ""}" type="button" data-item-type="${esc(type)}">
                                           ${esc(labels[type] || type)} <span>${all.filter((item) => item.type === type).length}</span>
                                       </button>
                                   `).join("")}
                               </div>
                               <span class="small muted">${items.filter((item) => item.active).length} activos</span>
                           </div>
                           <div class="player-items-grid">
                               ${items.map(playerItemCard).join("")}
                           </div>`
                        : emptyState("Sin items todavía", "Cuando compres una personalización aparecerá aquí para activarla.", "spark")}
            </div>
        `;
    }

    function playerItemCard(item) {
        const busy = itemsState.busy === item.id;
        const labels = { BACKGROUND: "Fondo", DART: "Dardo", FEAT: "Feat", GOODSHOT: "Goodshot", AVATAR: "Avatar" };
        const typeLabel = labels[item.type] || item.type;
        const name = !item.name || item.name === item.type ? `${typeLabel} #${item.itemId}` : item.name;

        return `
            <article class="player-item ${item.active ? "is-active" : ""}">
                <div class="player-item-media">
                    ${item.videoUrl
                        ? `<video class="player-item-video" src="${esc(item.videoUrl)}" ${item.posterUrl ? `poster="${esc(item.posterUrl)}"` : ""}
                                  muted loop playsinline preload="metadata" data-item-video></video>`
                        : item.posterUrl
                            ? `<img src="${esc(item.posterUrl)}" alt="${esc(name)}" loading="lazy" data-hide-on-error>`
                            : `<span class="player-item-placeholder">${icon("spark")}<small>${esc(typeLabel)}</small></span>`}
                    <span class="player-item-type">${esc(typeLabel)}</span>
                    ${item.active ? `<span class="player-item-badge">${icon("check")} Activo</span>` : ""}
                </div>
                <div class="player-item-body">
                    <strong>${esc(name)}</strong>
                    ${item.description ? `<small>${esc(item.description)}</small>` : ""}
                    ${item.expiryText ? `<span class="player-item-expiry">${icon("clock")} ${esc(item.expiryText)}</span>` : ""}
                    <div class="player-item-actions">
                        <button class="btn ${item.active ? "btn-ghost" : "btn-primary"} btn-sm player-item-toggle"
                                type="button" data-item-toggle="${esc(item.id)}" ${busy ? "disabled" : ""}>
                            ${busy ? "Guardando…" : item.active ? "Desactivar" : "Activar"}
                        </button>
                        ${item.productUrl ? `<a class="btn btn-outline btn-sm" href="https://esp.radikalplayers.com${esc(item.productUrl)}" target="_blank" rel="noopener">Renovar</a>` : ""}
                    </div>
                </div>
            </article>
        `;
    }

    async function loadItems(force = false) {
        if (itemsState.data && !force) return;
        itemsState.loading = true;
        itemsState.error = null;
        if (activeTab === "items") drawTab();
        try {
            itemsState.data = await api.playerItems();
        } catch (error) {
            itemsState.error = error.message || "No se pudieron cargar tus items.";
        } finally {
            itemsState.loading = false;
            if (activeTab === "items") drawTab();
        }
    }

    async function toggleItem(itemId) {
        itemsState.busy = itemId;
        itemsState.error = null;
        drawTab();
        try {
            const result = await api.playerItemToggle(itemId);
            if (!result?.ok) {
                itemsState.error = result?.message || "Radikal no ha aceptado el cambio.";
            } else {
                itemsState.data = null;
                await loadItems(true);
            }
        } catch (error) {
            itemsState.error = error.message || "No se pudo activar el item.";
        } finally {
            itemsState.busy = null;
            if (activeTab === "items") drawTab();
        }
    }

    function pointsView() {
        return `
            <div class="player-section">
                <div class="player-section-head">
                    <div>
                        <span class="kicker">${icon("spark")}Radikal Points</span>
                        <h2 class="player-section-title">Historial de <span class="accent">puntos</span></h2>
                    </div>
                    <div class="points-total"><strong>${formatNumber(area.account.radikalPoints)}</strong><span>puntos disponibles</span></div>
                </div>
                ${area.points?.length ? `<div class="points-list">${area.points.map(pointRow).join("")}</div>` : emptyState("Sin movimientos", "Todavía no hay movimientos de puntos.", "spark")}
            </div>
            <div class="player-section">
                <div class="player-section-head">
                    <div>
                        <span class="kicker">${icon("shield")}Suscripción</span>
                        <h2 class="player-section-title">Tu <span class="accent">membership</span></h2>
                    </div>
                </div>
                <div class="subscription-card">
                    <div>
                        <span class="badge badge-member">${esc(area.subscription?.name || area.account.memberType || "RADIKAL DARTS MEMBER")}</span>
                        <h3>${esc(area.account.memberType || "Radikal Darts Member")}</h3>
                        <p class="muted">${area.subscription?.validUntil ? `Válida hasta el ${esc(area.subscription.validUntil)}` : "Sin suscripción activa"}</p>
                    </div>
                    <a class="btn btn-primary" href="https://esp.radikalplayers.com/shop/" target="_blank" rel="noopener">Renovar ${icon("external")}</a>
                </div>
            </div>
            <div class="player-section">
                <div class="player-section-head">
                    <div>
                        <span class="kicker">${icon("trophy")}Reconocimientos</span>
                        <h2 class="player-section-title">Mis <span class="accent">premios</span></h2>
                    </div>
                </div>
                ${area.awards?.length
                    ? `<div class="awards-list">${area.awards.map((award) => `<div class="award-row">${icon("trophy")}<span>${esc(award)}</span></div>`).join("")}</div>`
                    : emptyState("Sin premios pendientes", "No tienes premios a tramitar ni histórico de premios. Cuando ganes uno aparecerá aquí.", "trophy")}
            </div>
        `;
    }

    function dataView() {
        const form = area.form;
        const account = area.account || {};
        return `
            <div class="player-section">
                <div class="player-section-head">
                    <div>
                        <span class="kicker">${icon("users")}Mis datos</span>
                        <h2 class="player-section-title">Perfil y <span class="accent">dirección</span></h2>
                        <p class="section-sub">Los cambios se envían directamente a Radikal Players.</p>
                    </div>
                </div>

                <section class="profile-top-card">
                    <div class="profile-photo-block">
                        <div class="profile-avatar-xl">
                            ${avatarHtml(account.alias, versionedPhoto(account.photoUrl, photoState.version))}
                        </div>
                        <div class="profile-photo-meta">
                            <label class="btn btn-outline btn-sm profile-photo-btn ${photoState.uploading ? "is-busy" : ""}">
                                ${icon("camera")} ${photoState.uploading ? "Subiendo…" : "Cambiar foto"}
                                <input type="file" id="profile-photo-input" accept="image/jpeg,image/png,image/webp" hidden ${photoState.uploading ? "disabled" : ""} />
                            </label>
                            <small class="muted">JPG, PNG o WebP · máx. 6 MB</small>
                        </div>
                    </div>

                    <form class="profile-alias-form" id="profile-alias-form">
                        <span class="kicker">${icon("users")}Identidad</span>
                        <h3>Alias y foto de perfil</h3>
                        <label class="login-label" for="profile-alias-input">Alias</label>
                        <div class="profile-alias-row">
                            <input class="form-control" id="profile-alias-input" maxlength="30" value="${esc(account.alias || "")}" autocomplete="nickname" />
                            <button class="btn btn-primary btn-sm" type="submit" id="profile-alias-save">${icon("check")} Guardar alias</button>
                        </div>
                        <p class="small muted">Es el nombre que aparece en rankings, cuadrantes y tu ficha pública.</p>
                    </form>
                </section>

                <div class="data-layout">
                    <form class="profile-form" id="profile-form">
                        <div class="form-section">
                            <h3>Identificación</h3>
                            <div class="form-grid">
                                ${readonlyField("Radikal ID", form.dni)}
                                ${readonlyField("DNI", form.dniNumber || "—")}
                                ${readonlyField("Fecha de nacimiento", form.birthDate || "—")}
                                ${readonlyField("País", form.country)}
                                ${textField("Nombre", "Nombre", form.name, true)}
                                ${textField("Apellidos", "Apellidos", form.surname, true)}
                                <div class="field">
                                    <label>Género</label>
                                    <div class="segmented is-readonly" id="profile-sex">
                                        <button type="button" disabled data-sex="M" class="${form.sex !== "F" ? "active" : ""}">Hombre</button>
                                        <button type="button" disabled data-sex="F" class="${form.sex === "F" ? "active" : ""}">Mujer</button>
                                    </div>
                                    <small class="field-hint">Solo lectura · contacta con Radikal para cambiarlo</small>
                                </div>
                                ${textField("PayPal", "PayPal para premios", form.paypal, false, "email")}
                            </div>
                        </div>

                        <div class="form-section">
                            <h3>Dirección</h3>
                            <div class="form-grid">
                                ${textField("Calle", "Calle", form.street, true)}
                                ${textField("Numero", "Número", form.number, true)}
                                ${textField("Piso", "Piso", form.floor)}
                                ${textField("Puerta", "Puerta", form.door)}
                                ${textField("CodigoPostal", "Código postal", form.postalCode, true)}
                                <div class="field">
                                    <label for="profile-province">Provincia</label>
                                    <select id="profile-province" class="form-select" data-required="true">
                                        <option value="">Selecciona provincia</option>
                                        ${(form.provinces || []).map((option) => `<option value="${esc(option.value)}" ${option.value === form.province ? "selected" : ""}>${esc(option.label)}</option>`).join("")}
                                    </select>
                                </div>
                                <div class="field">
                                    <label for="profile-city">Ciudad</label>
                                    <select id="profile-city" class="form-select" data-required="true">
                                        <option value="">${form.city ? esc(form.city) : "Selecciona provincia"}</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div class="form-section">
                            <h3>Contacto</h3>
                            <div class="form-grid">
                                ${textField("Telefono", "Teléfono móvil", form.phone, true, "tel")}
                                ${textField("Email", "Email", form.email, true, "email")}
                            </div>
                            <label class="checkbox-row">
                                <input type="checkbox" id="profile-newsletter" ${form.newsletter ? "checked" : ""} />
                                <span>Quiero recibir noticias y novedades de Radikal Players</span>
                            </label>
                        </div>

                        <div class="form-actions">
                            <button class="btn btn-primary" type="submit" id="profile-save">${icon("check")} Guardar cambios</button>
                            <span class="small muted">Se enviará a tu cuenta Radikal.</span>
                        </div>
                        <div class="login-error" id="profile-error" hidden></div>
                    </form>

                    <aside class="player-side">
                        <div class="info-card">
                            <h4>Cuenta Radikal</h4>
                            <dl>
                                <div><dt>Alias</dt><dd>${esc(form.alias)}</dd></div>
                                <div><dt>Radikal ID</dt><dd>${esc(form.dni)}</dd></div>
                                <div><dt>Member hasta</dt><dd>${esc(area.account.memberUntil || "—")}</dd></div>
                                <div><dt>País</dt><dd>${esc(form.country)}</dd></div>
                            </dl>
                            <p class="small muted" style="margin:12px 0 0">El alias y la foto se cambian en la tarjeta superior. Para datos fiscales, contacta con Radikal Darts.</p>
                        </div>

                        <div class="info-card privacy-card">
                            <h4>Privacidad de mis medias</h4>
                            <label class="checkbox-row">
                                <input type="checkbox" id="profile-share-ratings" ${shareState.share ? "checked" : ""} ${shareState.loading ? "disabled" : ""} />
                                <span>Compartir mis medias PPD/MPR en mi ficha pública</span>
                            </label>
                            <p class="small muted" style="margin:8px 0 0">
                                Si lo activas, guardaremos tu rating real y se mostrará en tu ficha pública.
                                Si lo desactivas, no se mostrará ninguna media.
                            </p>
                        </div>

                        <div class="info-card password-card">
                            <h4>Cambiar contraseña</h4>
                            <p class="small muted" style="margin:0 0 12px">Mínimo 6 caracteres. Se aplicará en Radikal Players.</p>
                            <div class="field">
                                <label for="new-password">Nueva contraseña</label>
                                <input class="form-control" id="new-password" type="password" autocomplete="new-password" placeholder="Nueva contraseña" />
                            </div>
                            <div class="field">
                                <label for="new-password-2">Repite la contraseña</label>
                                <input class="form-control" id="new-password-2" type="password" autocomplete="new-password" placeholder="Repite la contraseña" />
                            </div>
                            <div class="login-error" id="password-error" hidden></div>
                            <button class="btn btn-outline btn-block" id="password-save" type="button" style="margin-top:12px">${icon("shield")} Actualizar contraseña</button>
                        </div>
                    </aside>
                </div>
            </div>
        `;
    }

    function bindTab() {
        container.querySelector("#profile-share-ratings")?.addEventListener("change", async (event) => {
            const checkbox = event.currentTarget;
            checkbox.disabled = true;
            try {
                const data = await api.playerSetShareRatings(checkbox.checked);
                shareState = { share: Boolean(data?.share), loading: false };
                toast(
                    data?.share
                        ? "Medias compartidas en tu ficha pública"
                        : "Medias ocultas de tu ficha pública",
                    "success"
                );
            } catch (error) {
                checkbox.checked = !checkbox.checked;
                toast(error.message || "No se pudo actualizar la privacidad", "error");
            } finally {
                checkbox.disabled = false;
            }
        });

        container.querySelectorAll("[data-item-type]").forEach((button) => {
            button.addEventListener("click", () => {
                itemsState.type = button.dataset.itemType;
                drawTab();
            });
        });

        // Reproduce las previsualizaciones de los items visibles (silenciadas y en bucle).
        const itemVideos = [...container.querySelectorAll("[data-item-video]")];
        itemVideos.forEach((video) => {
            const observer = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) video.play?.().catch(() => {});
                    else video.pause?.();
                });
            }, { threshold: 0.25 });
            observer.observe(video);
        });

        container.querySelectorAll("[data-item-toggle]").forEach((button) => {
            button.addEventListener("click", () => toggleItem(button.dataset.itemToggle));
        });

        container.querySelector("#items-connect")?.addEventListener("click", () => {
            openLoginModal({ onSuccess: () => { itemsState.data = null; loadItems(true); } });
        });

        container.querySelectorAll("[data-tab-jump]").forEach((button) => {
            button.addEventListener("click", () => selectTab(button.dataset.tabJump));
        });

        container.querySelectorAll("[data-comp-tab]").forEach((button) => {
            button.addEventListener("click", () => {
                activeCompetitionTab = button.dataset.compTab;
                drawTab();
            });
        });

        container.querySelectorAll("[data-comp-stats]").forEach((button) => {
            button.addEventListener("click", () => openCompetitionStats(Number(button.dataset.compStats)));
        });

        container.querySelectorAll("[data-sex]").forEach((button) => {
            button.addEventListener("click", () => {
                container.querySelectorAll("[data-sex]").forEach((b) => b.classList.remove("active"));
                button.classList.add("active");
            });
        });

        const province = container.querySelector("#profile-province");
        const city = container.querySelector("#profile-city");
        if (province && city) {
            province.addEventListener("change", async () => {
                await loadCities(province.value, city);
            });
            if (province.value) loadCities(province.value, city);
        }

        container.querySelector("#profile-form")?.addEventListener("submit", saveProfile);
        container.querySelector("#profile-alias-form")?.addEventListener("submit", saveAlias);
        container.querySelector("#profile-photo-input")?.addEventListener("change", uploadPhoto);
        container.querySelector("#password-save")?.addEventListener("click", savePassword);

        container.querySelectorAll("[data-coach-q]").forEach((button) => {
            button.addEventListener("click", () => askCoach(button.dataset.coachQ));
        });

        container.querySelector("#coach-form")?.addEventListener("submit", (event) => {
            event.preventDefault();
            const input = container.querySelector("#coach-input");
            const question = input?.value || "";
            if (input) input.value = "";
            askCoach(question);
        });
    }

    function askCoach(question) {
        const text = String(question || "").trim();
        if (!text) return;
        const messages = container.querySelector("#coach-messages");
        if (!messages) return;

        messages.insertAdjacentHTML("beforeend", `<div class="coach-message coach-message-user">${esc(text)}</div>`);
        messages.scrollTop = messages.scrollHeight;

        setTimeout(() => {
            if (!messages.isConnected) return;
            messages.insertAdjacentHTML("beforeend", `<div class="coach-message coach-message-bot">${esc(coachAnswer(text, area))}</div>`);
            messages.scrollTop = messages.scrollHeight;
        }, 220);
    }

    function coachAnswer(question, state) {
        const query = question.toLowerCase();
        const account = state.account || {};
        const x01 = state.stats?.x01;
        const cricket = state.stats?.cricket;
        const ppd = splitRating(account.currentPpd).value;
        const mpr = splitRating(account.currentMpr).value;
        const points = formatNumber(account.radikalPoints);
        const current = state.currentCompetitions || [];
        const win = Math.max(Number(x01?.winPercent) || 0, Number(cricket?.winPercent) || 0);

        if (query.includes("ppd") || query.includes("media") || query.includes("501") || query.includes("x01")) {
            return `Tu PPD actual es ${ppd}. Es tu media por dardo en 501. Para subirlo, prioriza tiradas de 60+ y evita dejar 26 o 41: elige una salida que te deje un doble cómodo.`;
        }

        if (query.includes("mpr") || query.includes("cricket") || query.includes("crik")) {
            return `Tu MPR actual es ${mpr}. En cricket, asegura el 20 y el 19 antes de abrir nuevos números, y usa el bull para cerrar ventajas. Con ${mpr} MPR, la constancia en triples es tu palanca más directa.`;
        }

        if (query.includes("victoria") || query.includes("ganar") || query.includes("win")) {
            return win
                ? `Ganas el ${formatNumber(win)}% de tus partidas registradas. Con ${ppd} PPD, el margen de mejora está en cerrar los dobles y no regalar turnos de 26 o menos.`
                : "Todavía no tengo suficientes partidas registradas para calcular tu porcentaje de victorias.";
        }

        if (query.includes("competicion") || query.includes("competiciones") || query.includes("torneo") || query.includes("liga")) {
            if (!current.length) return "No tienes competiciones activas. Busca una liga o torneo en la agenda y apúntate.";
            return `Ahora mismo tienes ${current.length} competiciones en curso: ${current.slice(0, 4).map((competition) => competition.name).join(", ")}. En tu área puedes abrir cada una y consultar su clasificación.`;
        }

        if (query.includes("punto") || query.includes("points") || query.includes("tienda") || query.includes("canjear")) {
            return `Tienes ${points} Radikal Points. En la tienda puedes canjear personalizaciones, material, suscripciones e inscripciones. Tu portada personalizada te muestra una selección ajustada a tus puntos.`;
        }

        if (query.includes("dardo") || query.includes("diana") || query.includes("mapa") || query.includes("calor") || query.includes("tirada")) {
            return "El mapa de dardos está disponible para partidas en directo: Radikal expone cada impacto con sector y multiplicador mientras la partida está activa. Para partidas antiguas solo se conserva el resultado por juegos, no la posición de cada dardo.";
        }

        if (query.includes("mejorar") || query.includes("entrenar") || query.includes("entreno") || query.includes("consejo") || query.includes("subir")) {
            return `Tu foto actual es ${ppd} PPD y ${mpr} MPR. Plan corto: 10 minutos de calentamiento al 20, 5 series de dobles de cierre y una partida de práctica con objetivo de no bajar de 60 por turno. Revisa tus métricas después.`;
        }

        return "Puedo ayudarte con tu PPD, tu MPR, tus victorias, tus competiciones y tus Radikal Points. Pregúntame, por ejemplo: “¿Cómo puedo mejorar mi PPD?”.";
    }

    async function loadCities(province, citySelect) {
        if (!province) {
            citySelect.innerHTML = `<option value="">Selecciona provincia</option>`;
            return;
        }
        citySelect.innerHTML = `<option value="">Cargando ciudades…</option>`;
        try {
            const cities = await api.playerCities("724", province);
            const current = area.form.city;
            citySelect.innerHTML = `<option value="">Selecciona ciudad</option>` +
                cities.map((city) => `<option value="${esc(city)}" ${city === current ? "selected" : ""}>${esc(city)}</option>`).join("");
        } catch {
            citySelect.innerHTML = `<option value="">No se pudieron cargar las ciudades</option>`;
        }
    }

    async function saveProfile(event) {
        event.preventDefault();
        const formEl = container.querySelector("#profile-form");
        const errorBox = container.querySelector("#profile-error");
        const save = container.querySelector("#profile-save");
        errorBox.hidden = true;

        const value = (id) => formEl.querySelector(`#profile-${id}`)?.value.trim() ?? "";
        const sex = formEl.querySelector("[data-sex].active")?.dataset.sex ?? "M";
        const required = [
            ["Nombre", value("Nombre")],
            ["Apellidos", value("Apellidos")],
            ["Calle", value("Calle")],
            ["Número", value("Numero")],
            ["Código postal", value("CodigoPostal")],
            ["Provincia", value("province")],
            ["Ciudad", value("city")],
            ["Teléfono", value("Telefono")],
            ["Email", value("Email")]
        ];
        const missing = required.filter(([, v]) => !v).map(([label]) => label);
        if (missing.length) {
            errorBox.hidden = false;
            errorBox.textContent = `Completa los campos obligatorios: ${missing.join(", ")}.`;
            return;
        }

        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailPattern.test(value("Email"))) {
            errorBox.hidden = false;
            errorBox.textContent = "Introduce un email válido.";
            return;
        }
        if (value("PayPal") && !emailPattern.test(value("PayPal"))) {
            errorBox.hidden = false;
            errorBox.textContent = "El correo de PayPal no tiene un formato válido.";
            return;
        }

        const payload = {
            nombre: value("Nombre"),
            apellidos: value("Apellidos"),
            sexo: sex,
            payPalMe: value("PayPal"),
            calle: value("Calle"),
            numero: value("Numero"),
            piso: value("Piso"),
            puerta: value("Puerta"),
            codigoPostal: value("CodigoPostal"),
            provincia: value("province"),
            ciudad: value("city"),
            telefono: value("Telefono"),
            email: value("Email"),
            newsletter: formEl.querySelector("#profile-newsletter")?.checked ?? false
        };

        save.disabled = true;
        save.textContent = "Guardando…";
        try {
            const result = await api.playerProfile(payload);
            if (!result.ok) {
                errorBox.hidden = false;
                errorBox.textContent = result.message;
                return;
            }
            toast(result.message || "Datos actualizados", "success");
            await loadArea(true);
        } catch (error) {
            errorBox.hidden = false;
            errorBox.textContent = error.message;
        } finally {
            save.disabled = false;
            save.innerHTML = `${icon("check")} Guardar cambios`;
        }
    }

    async function saveAlias(event) {
        event.preventDefault();
        const input = container.querySelector("#profile-alias-input");
        const button = container.querySelector("#profile-alias-save");
        if (!input || !button) return;

        const alias = input.value.trim();
        if (alias.length < 2) {
            toast("El alias debe tener al menos 2 caracteres", "error");
            input.focus();
            return;
        }
        if (alias.length > 30) {
            toast("El alias no puede superar los 30 caracteres", "error");
            input.focus();
            return;
        }

        button.disabled = true;
        const original = button.innerHTML;
        button.innerHTML = `${icon("clock")} Guardando…`;
        try {
            const result = await api.playerAlias(alias);
            if (!result?.ok) throw new Error(result?.message || "No se pudo cambiar el alias.");
            const current = getCurrentPlayer();
            if (current) setCurrentPlayer({ ...current, alias });
            toast(result.message || "Alias actualizado correctamente", "success");
            await loadArea(true);
        } catch (error) {
            toast(error.message || "No se pudo cambiar el alias", "error");
        } finally {
            button.disabled = false;
            button.innerHTML = original;
        }
    }

    async function uploadPhoto(event) {
        const input = event.currentTarget;
        const file = input.files?.[0];
        if (!file) return;

        if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
            toast("Usa una imagen JPG, PNG o WebP", "error");
            input.value = "";
            return;
        }
        if (file.size > 6 * 1024 * 1024) {
            toast("La imagen no puede superar los 6 MB", "error");
            input.value = "";
            return;
        }

        photoState.uploading = true;
        drawTab();
        try {
            const result = await api.playerPhoto(file);
            if (!result?.ok) throw new Error(result?.message || "No se pudo cambiar la foto.");
            photoState.version = Date.now();
            photoState.uploading = false;
            toast(result.message || "Foto de perfil actualizada", "success");
            await loadArea(true);
        } catch (error) {
            photoState.uploading = false;
            toast(error.message || "No se pudo cambiar la foto", "error");
            drawTab();
        }
    }

    async function savePassword() {
        const errorBox = container.querySelector("#password-error");
        const button = container.querySelector("#password-save");
        const pass = container.querySelector("#new-password")?.value ?? "";
        const pass2 = container.querySelector("#new-password-2")?.value ?? "";
        errorBox.hidden = true;
        if (pass.length < 6) {
            errorBox.hidden = false;
            errorBox.textContent = "La contraseña debe tener al menos 6 caracteres.";
            return;
        }
        if (pass !== pass2) {
            errorBox.hidden = false;
            errorBox.textContent = "Las dos contraseñas no coinciden.";
            return;
        }

        button.disabled = true;
        button.textContent = "Actualizando…";
        try {
            const result = await api.playerPassword({ clave: pass, clave2: pass2 });
            if (!result.ok) {
                errorBox.hidden = false;
                errorBox.textContent = result.message;
                return;
            }
            container.querySelector("#new-password").value = "";
            container.querySelector("#new-password-2").value = "";
            toast(result.message || "Contraseña actualizada", "success");
        } catch (error) {
            errorBox.hidden = false;
            errorBox.textContent = error.message;
        } finally {
            button.disabled = false;
            button.innerHTML = `${icon("shield")} Actualizar contraseña`;
        }
    }

    async function openCompetitionStats(competitionId) {
        const modal = openModal({
            title: "Estadísticas de la competición",
            subtitle: "Tu rendimiento en esta competición",
            content: `<div class="skeleton skeleton-card" style="height:260px"></div>`
        });
        try {
            const stats = await api.playerStats(competitionId);
            modal.backdrop.querySelector(".modal-body").innerHTML = `
                ${stats.competitionName ? `<p class="small muted" style="margin:0 0 14px">${esc(stats.competitionName)}</p>` : ""}
                <div class="stats-highlight-grid">
                    ${statModeCard("X01", stats.x01, X01_METRICS, true, stats.x01?.average, "PPD en competición")}
                    ${statModeCard("Cricket", stats.cricket, CRICKET_METRICS, true, stats.cricket?.average, "MPR en competición")}
                </div>
            `;
        } catch (error) {
            modal.backdrop.querySelector(".modal-body").innerHTML = `<div class="error-box">${esc(error.message)}</div>`;
        }
    }

    function drawGuest() {
        container.innerHTML = `
            <div class="page container">
                <div class="player-guest">
                    <section>
                        <div class="section-head-left">
                            <span class="kicker">${icon("users")}Mi área</span>
                            <h1 class="section-title">Tu perfil de jugador <span class="accent">Radikal</span></h1>
                            <p class="section-sub" style="max-width:56ch">Inicia sesión con tu Radikal ID para consultar tu rating PPD/MPR, tus competiciones, tus puntos y los datos de tu cuenta.</p>
                        </div>
                        <div class="guest-benefits">
                            <div class="guest-benefit">${icon("users")}<div><strong>Tu perfil Radikal</strong><span>Alias, foto, localidad y condición de miembro.</span></div></div>
                            <div class="guest-benefit">${icon("trophy")}<div><strong>Tus competiciones</strong><span>Ligas, torneos y campeonatos en los que participas.</span></div></div>
                            <div class="guest-benefit">${icon("target")}<div><strong>Tus estadísticas</strong><span>PPD, MPR, win rate y todos tus registros.</span></div></div>
                        </div>
                        <div class="login-trust">${icon("shield")} Tu contraseña se envía directamente a Radikal Players. No se guarda en esta aplicación.</div>
                    </section>
                    <section class="login-panel card">
                        <div class="login-brand"><img src="/img/brand/radikalplayers-transparent.png" alt="Radikal Players" /></div>
                        <h2>Accede a tu área</h2>
                        <p class="small muted">Radikal ID (números y letras) y contraseña de Radikal Players.</p>
                        <form id="area-login">
                            <label class="login-label" for="area-dni">Radikal ID</label>
                            <input class="form-control" id="area-dni" name="dni" type="text" inputmode="text"
                                   autocapitalize="characters" autocorrect="off" spellcheck="false"
                                   autocomplete="username" placeholder="Tu Radikal ID" required />
                            <label class="login-label" for="area-password">Contraseña</label>
                            <input class="form-control" id="area-password" name="clave" type="password" autocomplete="current-password" placeholder="Tu contraseña" required />
                            <div class="login-error" id="area-error" hidden></div>
                            <button class="btn btn-primary btn-block" type="submit" id="area-submit" style="margin-top:18px">Entrar en mi área ${icon("arrow")}</button>
                        </form>
                        <p class="small muted" style="margin:14px 0 0">¿No tienes acceso? <a class="login-link" href="https://esp.radikalplayers.com/usuario-registro.php" target="_blank" rel="noopener">Regístrate en Radikal</a></p>
                    </section>
                </div>

                <section class="section guest-info-section">
                    <div class="section-head">
                        <div class="section-head-left">
                            <span class="kicker">${icon("globe")}Dentro de tu área</span>
                            <h2 class="section-title">Lo que puedes <span class="accent">consultar</span></h2>
                            <p class="section-sub">Datos reales de tu cuenta Radikal, sin introducirlos dos veces.</p>
                        </div>
                    </div>
                    <div class="kpi-grid">
                        <div class="kpi"><strong>01</strong><span>Rating y posición</span><p class="small muted" style="margin:8px 0 0">PPD/MPR actual, win rate y estadísticas totales de tu cuenta.</p></div>
                        <div class="kpi"><strong>02</strong><span>Tus competiciones</span><p class="small muted" style="margin:8px 0 0">Ligas, torneos y campeonatos con su cuadrante y sus actas.</p></div>
                        <div class="kpi"><strong>03</strong><span>Partidas y actas</span><p class="small muted" style="margin:8px 0 0">Abre el acta de cada partida y la diana completa con cada dardo.</p></div>
                        <div class="kpi"><strong>04</strong><span>Dianas cercanas</span><p class="small muted" style="margin:8px 0 0">Localiza la máquina Radikal más próxima y sus competiciones.</p></div>
                    </div>
                </section>
            </div>
        `;

        const form = container.querySelector("#area-login");
        const errorBox = container.querySelector("#area-error");
        const submit = container.querySelector("#area-submit");

        form?.addEventListener("submit", async (event) => {
            event.preventDefault();
            errorBox.hidden = true;
            const dni = form.querySelector("#area-dni")?.value.trim();
            const clave = form.querySelector("#area-password")?.value;
            if (!dni || !clave) {
                errorBox.hidden = false;
                errorBox.textContent = "Introduce tu Radikal ID y tu contraseña.";
                return;
            }
            submit.disabled = true;
            submit.textContent = "Conectando con Radikal…";
            try {
                const profile = await api.authLogin(dni, clave);
                setCurrentPlayer(profile);
                toast(`Bienvenido, ${profile.alias}`, "success");
                if (nextRoute && nextRoute.startsWith("/")) {
                    location.hash = `#${nextRoute}`;
                    return;
                }
                await loadArea(true);
            } catch (error) {
                errorBox.hidden = false;
                errorBox.textContent = error.message || "No se pudo iniciar sesión.";
                submit.disabled = false;
                submit.innerHTML = `Entrar en mi área ${icon("arrow")}`;
            }
        });

        // En móvil, si no hay sesión, el diálogo de acceso aparece solo.
        if (!autoLoginShown && window.matchMedia("(max-width: 900px)").matches) {
            autoLoginShown = true;
            window.setTimeout(() => {
                if (window.location.hash.startsWith("#/mi-area")) {
                    openLoginModal({ onSuccess: () => loadArea(true) });
                }
            }, 130);
        }
    }
}

function loadingView() {
    return `
        <div class="page container">
            <div class="skeleton skeleton-line" style="width:180px;height:18px"></div>
            <div class="skeleton" style="height:220px;border-radius:26px;margin:18px 0"></div>
            <div class="skeleton skeleton-card" style="height:420px"></div>
        </div>
    `;
}

function statModeCard(label, mode, metricKeys, expanded = false, displayAverage = null, displayLabel = null) {
    if (!mode) {
        return `<div class="stat-mode-card"><div class="stat-mode-head"><span class="chip chip-type">${esc(label)}</span></div><p class="small muted">Sin datos todavía.</p></div>`;
    }
    const metrics = (metricKeys || []).filter((key) => mode.metrics?.[key] !== undefined);
    const displayMetrics = expanded ? metrics : metrics.slice(0, 6);
    const win = Math.max(0, Math.min(100, Number(mode.winPercent) || 0));
    const average = displayAverage ?? mode.average;
    const averageLabel = displayLabel ?? mode.averageLabel;
    return `
        <article class="stat-mode-card reveal">
            <div class="stat-mode-head">
                <span class="chip chip-type">${esc(label)}</span>
                <span class="stat-mode-sub">${esc(averageLabel)}</span>
            </div>
            <div class="stat-mode-body">
                <div class="stat-average">
                    <strong>${esc(average)}</strong>
                    <span>${esc(averageLabel)}</span>
                </div>
                <div class="win-ring" style="--win:${win}">
                    <div><strong>${win.toFixed(1)}%</strong><span>win rate</span></div>
                </div>
            </div>
            <div class="stat-mode-meta">
                <span><strong>${formatNumber(mode.games)}</strong> partidas</span>
                <span><strong>${formatNumber(mode.wins)}</strong> victorias</span>
                <span><strong>${formatNumber(mode.losses)}</strong> derrotas</span>
            </div>
            <div class="metric-chips">
                ${displayMetrics.map((key) => `<span class="metric-chip"><small>${esc(METRIC_LABELS[key] || key)}</small><strong>${esc(mode.metrics[key])}</strong></span>`).join("")}
            </div>
        </article>
    `;
}

function metricsGrid(mode, keys) {
    if (!mode) return `<div class="info-card"><p class="small muted">Sin datos.</p></div>`;
    return `
        <div class="metrics-panel">
            <h4>Métricas ${esc(mode.averageLabel)}</h4>
            <div class="metrics-grid-inner">
                ${keys.filter((key) => mode.metrics?.[key] !== undefined).map((key) => `
                    <div class="metric-tile"><span>${esc(METRIC_LABELS[key] || key)}</span><strong>${esc(mode.metrics[key])}</strong></div>
                `).join("")}
            </div>
        </div>
    `;
}

function playerCompetitionCard(competition) {
    return `
        <article class="comp-card card-hover">
            <div class="comp-top">
                <span class="comp-type">${icon("trophy")} ${esc(TYPE_LABELS[competition.type] || competition.type)}</span>
                <span class="chip ${competition.finished ? "chip-finished" : "chip-live"}">${competition.finished ? "Finalizada" : "En curso"}</span>
            </div>
            <h3 class="comp-name">${esc(competition.name)}</h3>
            <div class="comp-meta"><span>${icon("target")} Competición #${esc(competition.id)}</span></div>
            <div class="comp-footer">
                <a href="#/competiciones/${competition.id}?type=${encodeURIComponent(competition.type)}">Ver competición ${icon("arrow")}</a>
                <button class="btn btn-ghost btn-sm" data-comp-stats="${competition.id}" type="button">${icon("list")} Mis stats</button>
            </div>
        </article>
    `;
}

function pointRow(point) {
    return `
        <div class="point-row">
            <div class="point-date">${point.date ? formatPointDate(point.date) : "—"}</div>
            <div class="point-concept"><strong>${esc(point.concept)}</strong><span>${esc(formatPointStatus(point.status))}</span></div>
            <div class="point-amount ${point.amount >= 0 ? "positive" : "negative"}">${point.amount >= 0 ? "+" : ""}${formatNumber(point.amount)}</div>
        </div>
    `;
}

function readonlyField(label, value) {
    return `<div class="field"><label>${esc(label)}</label><div class="readonly-value">${esc(value || "—")}</div></div>`;
}

function textField(id, label, value, required = false, type = "text") {
    return `
        <div class="field">
            <label for="profile-${id}">${esc(label)}</label>
            <input class="form-control" id="profile-${id}" type="${esc(type)}" value="${esc(value || "")}" ${required ? 'data-required="true"' : ""} />
        </div>
    `;
}

function splitRating(value) {
    if (!value) return { value: "—", suffix: "" };
    const match = String(value).match(/^([0-9.,]+)\s*(.*)$/);
    return match ? { value: match[1], suffix: match[2].replace(/[()]/g, "").trim() } : { value: value, suffix: "" };
}

function formatPointStatus(status) {
    const map = {
        AVAILABLE: "Disponible",
        USED: "Usado",
        PENDING: "Pendiente",
        EXPIRED: "Caducado",
        CANCELLED: "Cancelado"
    };
    return map[String(status || "").toUpperCase()] || status || "";
}

function formatPointDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function animateCounters() {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    document.querySelectorAll("[data-count]").forEach((element) => {
        if (element.dataset.animated === "true") return;
        element.dataset.animated = "true";
        const target = Number(element.dataset.count);
        if (!Number.isFinite(target)) return;
        const decimals = Number(element.dataset.decimals || 0);
        const duration = 850;
        const start = performance.now();
        const format = (value) => {
            if (decimals > 0) return value.toFixed(decimals);
            return new Intl.NumberFormat("es-ES").format(Math.round(value));
        };
        const step = (now) => {
            const progress = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - progress, 3);
            element.textContent = format(target * eased);
            if (progress < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
        setTimeout(() => { element.textContent = format(target); }, duration + 150);
    });

}

function revealStagger() {
    document.querySelectorAll(".reveal").forEach((element, index) => {
        element.style.animationDelay = `${Math.min(index * 60, 360)}ms`;
    });
}

function versionedPhoto(url, version) {
    if (!url) return url;
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}v=${version}`;
}

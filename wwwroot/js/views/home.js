import { api } from "../api.js?v=79";
import { esc, icon, formatNumber, avatarHtml } from "../ui.js?v=78";
import { competitionCard, cleanRanking } from "../components.js?v=77";
import { ambientVideo, observeAmbientVideos } from "../media.js?v=77";

const videos = [
    {
        src: "/media/brand/premium-top.mp4",
        poster: "/media/brand/hero-poster.jpg",
        label: "Vídeo oficial de Radikal Darts"
    },
    {
        src: "/media/brand/premium.mp4",
        poster: "/media/brand/hero-poster.jpg",
        label: "Vídeo oficial de Radikal Darts"
    }
];

export async function render(container) {
    container.innerHTML = loadingView();

    let disposeVideo = () => {};

    try {
        const [data, area] = await Promise.all([
            api.home(),
            api.playerArea().catch(() => null)
        ]);

        container.innerHTML = area
            ? memberView(data, area)
            : guestView(data);

        disposeVideo = observeAmbientVideos(container);
        revealHome(container);

        // La tienda no bloquea el inicio: se carga después y se inyecta si hay recomendaciones.
        if (area) loadRecommendations(container, area);
    } catch (error) {
        console.error(error);
        container.innerHTML = `
            <div class="page container">
                <div class="error-box">
                    <strong>No se pudo cargar el inicio.</strong>
                    <p style="margin:6px 0 14px">${esc(error.message)}</p>
                    <button class="btn btn-outline btn-sm" id="home-retry">Reintentar</button>
                </div>
            </div>
        `;
        container.querySelector("#home-retry")?.addEventListener("click", () => render(container));
    }

    return () => disposeVideo();
}

function loadingView() {
    return `
        <div class="page container home-page">
            <div class="home-hero home-hero-skeleton">
                <div class="home-hero-inner">
                    <div class="home-hero-copy">
                        <div class="skeleton skeleton-line" style="width:170px;height:22px"></div>
                        <div class="skeleton skeleton-line" style="width:82%;height:54px;margin:20px 0 8px"></div>
                        <div class="skeleton skeleton-line" style="width:64%;height:54px;margin:0 0 18px"></div>
                        <div class="skeleton skeleton-line" style="width:70%;height:14px"></div>
                    </div>
                </div>
            </div>
            <div class="home-shortcuts">
                ${Array.from({ length: 4 }, () => `<div class="skeleton skeleton-card" style="height:78px"></div>`).join("")}
            </div>
            <div class="home-now-grid">
                <div class="skeleton skeleton-card" style="height:240px"></div>
                <div class="skeleton skeleton-card" style="height:240px"></div>
            </div>
        </div>
    `;
}

/* =====================================================================
   Visitante / socio
   ===================================================================== */

function guestView(data) {
    return `
        ${guestHero(data)}
        <div class="page container home-page">
            ${quickLinks(data)}
            ${nowSection(data)}
            ${agendaSection(data)}
            ${placesSection(data)}
            ${newsSection(data)}
            ${shopStrip()}
        </div>
    `;
}

function memberView(data, area) {
    return `
        ${memberHero(data, area)}
        <div class="page container home-page">
            ${quickLinks(data)}
            ${memberNext(area)}
            ${nowSection(data)}
            ${agendaSection(data)}
            ${placesSection(data)}
            ${newsSection(data)}
            <div data-home-recommendations>${recommendationsSkeleton()}</div>
            ${shopStrip()}
        </div>
    `;
}

function guestHero(data) {
    const stats = data.stats || {};
    const live = data.live || {};
    const video = videos[0];

    return `
        <section class="home-hero">
            ${ambientVideo({ src: video.src, poster: video.poster, className: "home-hero-video", label: video.label })}
            <div class="home-hero-inner">
                <div class="home-hero-copy">
                    <div class="home-hero-topline">
                        <span class="home-eyebrow">${icon("target")} Radikal Darts Players</span>
                        ${liveStatusChip(live)}
                    </div>
                    <h1 class="home-title">Cada dardo.<br><span class="accent">En directo.</span></h1>
                    <p class="home-lead">
                        Cuadrantes en vivo, ranking de tu país y el mapa completo de dianas Radikal.
                        Todo lo que pasa en la máquina, aquí.
                    </p>
                    <div class="home-actions">
                        <a class="btn btn-primary" href="#/directo">${icon("play")} Ver el directo</a>
                        <a class="btn btn-hero-ghost" href="#/rankings">Explorar ranking</a>
                    </div>
                    <div class="home-hero-stats">
                        <div><strong>${formatNumber(stats.dianas)}</strong><span>Dianas</span></div>
                        <div><strong>${formatNumber(stats.competitions)}</strong><span>Competiciones</span></div>
                        <div><strong>${formatNumber(stats.topPlayers)}</strong><span>Top players</span></div>
                        <div><strong>${formatNumber(stats.countries)}</strong><span>Países</span></div>
                    </div>
                </div>
            </div>
        </section>
    `;
}

function memberHero(data, area) {
    const account = area.account || {};
    const live = data.live || {};
    const alias = account.alias || "jugador";
    const video = videos[1];

    return `
        <section class="home-hero home-hero-member">
            ${ambientVideo({ src: video.src, poster: video.poster, className: "home-hero-video", label: "Vídeo oficial de Radikal Darts" })}
            <div class="home-hero-inner">
                <div class="home-hero-copy">
                    <div class="home-hero-topline">
                        <span class="home-eyebrow">${icon("shield")} Sesión Radikal activa</span>
                        ${liveStatusChip(live)}
                    </div>
                    <h1 class="home-title">Hola,<br><span class="accent">${esc(alias)}.</span></h1>
                    <p class="home-lead">
                        Tu rating, tus competiciones y tus puntos. Lo último que has jugado y lo que viene después.
                    </p>
                    <div class="home-actions">
                        <a class="btn btn-primary" href="#/mi-area">Abrir mi área ${icon("arrow")}</a>
                        <a class="btn btn-hero-ghost" href="#/directo">${icon("play")} Ver el directo</a>
                    </div>
                    <div class="home-hero-stats">
                        <div><strong>${esc(cleanRating(account.currentPpd))}</strong><span>PPD actual</span></div>
                        <div><strong>${esc(cleanRating(account.currentMpr))}</strong><span>MPR actual</span></div>
                        <div><strong>${formatNumber(account.radikalPoints)}</strong><span>Radikal Points</span></div>
                        <div><strong>${esc(formatMemberUntil(account.memberUntil))}</strong><span>Member hasta</span></div>
                    </div>
                </div>
            </div>
        </section>
    `;
}

/* =====================================================================
   Accesos rápidos
   ===================================================================== */

function quickLinks(data) {
    const stats = data.stats || {};
    const live = data.live || {};

    const items = [
        {
            href: "#/directo",
            icon: "play",
            title: "Directo",
            subtitle: live.isLive ? "En juego ahora" : "Cuadrantes y actas",
            live: live.isLive
        },
        {
            href: "#/rankings",
            icon: "trophy",
            title: "Rankings",
            subtitle: "PPD y MPR"
        },
        {
            href: "#/competiciones",
            icon: "calendar",
            title: "Competiciones",
            subtitle: "Ligas y torneos"
        },
        {
            href: "#/lugares",
            icon: "pin",
            title: "Dianas",
            subtitle: `${formatNumber(stats.dianas)} cerca`
        }
    ];

    return `
        <nav class="home-shortcuts" aria-label="Accesos rápidos">
            ${items.map((item) => `
                <a href="${item.href}" class="home-shortcut ${item.live ? "is-live" : ""}">
                    <span class="home-shortcut-icon">${icon(item.icon)}</span>
                    <span class="home-shortcut-copy">
                        <strong>${item.title}</strong>
                        <small>${item.subtitle}</small>
                    </span>
                    <span class="home-shortcut-arrow">${icon("arrow")}</span>
                </a>
            `).join("")}
        </nav>
    `;
}

/* =====================================================================
   Tu actividad (solo socios)
   ===================================================================== */

function memberNext(area) {
    const current = area.currentCompetitions || [];

    return `
        <section class="home-block home-member-activity">
            <header class="home-block-head">
                <div>
                    <span class="home-block-kicker">Tu actividad</span>
                    <h2>Competiciones en curso</h2>
                </div>
                <a href="#/mi-area?tab=competitions">Ver todas ${icon("arrow")}</a>
            </header>
            ${current.length ? `
                <div class="home-member-list">
                    ${current.slice(0, 3).map((competition) => `
                        <a class="home-member-row" href="#/competiciones/${competition.id}?type=${encodeURIComponent(competition.type || "")}">
                            <span class="home-member-icon">${icon("trophy")}</span>
                            <span class="home-member-copy">
                                <strong>${esc(competition.name || `Competición #${competition.id}`)}</strong>
                                <small>${esc(competition.typeLabel || competition.type || "Competición")} · En curso</small>
                            </span>
                            <span class="home-member-badge">En curso</span>
                            <span class="home-member-arrow">${icon("arrow")}</span>
                        </a>
                    `).join("")}
                </div>
            ` : `
                <div class="home-now-empty">
                    <span class="home-now-empty-icon">${icon("trophy")}</span>
                    <span>
                        <strong>Sin competiciones en curso</strong>
                        <small>Cuando te apuntes a una liga o torneo aparecerá aquí.</small>
                    </span>
                    <a class="btn btn-outline btn-sm" href="#/competiciones">Buscar</a>
                </div>
            `}
        </section>
    `;
}

/* =====================================================================
   Ahora mismo: directo + ranking
   ===================================================================== */

function nowSection(data) {
    const live = data.live || {};
    const competitions = (live.competitions || []).slice(0, 3);
    const top = cleanRanking(data.ranking?.players || []).slice(0, 4);

    return `
        <section class="home-block home-now">
            <header class="home-block-head">
                <div>
                    <span class="home-block-kicker">Ahora mismo</span>
                    <h2>Lo que está pasando</h2>
                </div>
                <a href="#/directo">Abrir directo ${icon("arrow")}</a>
            </header>

            <div class="home-now-grid">
                <article class="home-now-card home-now-live ${live.isLive ? "is-live" : ""}">
                    <header class="home-now-head">
                        <div class="home-now-title">
                            <span class="home-now-label">
                                <span class="live-dot ${live.isLive ? "" : "is-off"}"></span>
                                En directo
                            </span>
                            <strong>${competitions.length ? `${competitions.length} competiciones` : "Sin emisión"}</strong>
                        </div>
                        ${live.isLive
                            ? `<span class="chip chip-live">En emisión</span>`
                            : `<span class="chip chip-finished">Sin partidas</span>`}
                    </header>

                    ${competitions.length ? `
                        <div class="home-now-list">
                            ${competitions.map((competition) => `
                                <a class="home-now-row" href="#/directo/torneo/${competition.id}">
                                    <span class="home-now-icon">${icon("trophy")}</span>
                                    <span class="home-now-copy">
                                        <strong>${esc(competition.name || `Competición #${competition.id}`)}</strong>
                                        <small>Cuadrante oficial en directo</small>
                                    </span>
                                    <span class="home-now-arrow">${icon("arrow")}</span>
                                </a>
                            `).join("")}
                        </div>
                    ` : `
                        <div class="home-now-empty">
                            <span class="home-now-empty-icon">${icon("clock")}</span>
                            <span>
                                <strong>No hay partidas en emisión</strong>
                                <small>Revisa las finalizadas o la agenda.</small>
                            </span>
                            <a class="btn btn-outline btn-sm" href="#/directo/finalizadas">Finalizadas</a>
                        </div>
                    `}
                </article>

                <article class="home-now-card">
                    <header class="home-now-head">
                        <div class="home-now-title">
                            <span class="home-now-label">${icon("trophy")} Ranking</span>
                            <strong>Top España</strong>
                        </div>
                        <a class="home-now-link" href="#/rankings">Ver todo ${icon("arrow")}</a>
                    </header>

                    <ol class="home-now-rank">
                        ${top.map((player, index) => `
                            <li class="home-now-rank-row">
                                <a href="${player.userId ? `#/jugador/${encodeURIComponent(player.userId)}` : "#/rankings"}">
                                    <span class="home-now-pos">${index + 1}</span>
                                    ${avatarHtml(player.alias, player.photoUrl, "home-now-avatar")}
                                    <span class="home-now-rank-name">
                                        <strong>${esc(player.alias)}</strong>
                                        <small>${esc(player.location || player.countryCode || "")}</small>
                                    </span>
                                    <span class="home-now-value">${esc(player.value)}<small>${esc(player.game || "MPR")}</small></span>
                                </a>
                            </li>
                        `).join("") || `<li class="home-now-rank-empty">Sin datos de ranking ahora mismo.</li>`}
                    </ol>
                </article>
            </div>
        </section>
    `;
}

/* =====================================================================
   Agenda, dianas y noticias
   ===================================================================== */

function agendaSection(data) {
    const competitions = (data.competitions || []).slice(0, 4);

    return `
        <section class="home-block home-agenda">
            <header class="home-block-head">
                <div>
                    <span class="home-block-kicker">Agenda</span>
                    <h2>Próximas competiciones</h2>
                </div>
                <a href="#/competiciones">Ver todas ${icon("arrow")}</a>
            </header>
            ${competitions.length
                ? `<div class="home-comp-rail">${competitions.map(competitionCard).join("")}</div>`
                : `<div class="home-now-empty"><span class="home-now-empty-icon">${icon("trophy")}</span><span><strong>Sin competiciones próximas</strong><small>La agenda se actualiza en cuanto Radikal publica nuevas citas.</small></span></div>`}
        </section>
    `;
}

function placesSection(data) {
    const places = (data.places || []).slice(0, 3);
    if (!places.length) return "";

    return `
        <section class="home-block home-places">
            <header class="home-block-head">
                <div>
                    <span class="home-block-kicker">Mapa</span>
                    <h2>Dónde jugar</h2>
                </div>
                <a href="#/lugares">Abrir mapa ${icon("arrow")}</a>
            </header>
            <div class="home-place-list">
                ${places.map((place) => `
                    <a class="home-place-row" href="#/lugares?place=${place.id}">
                        <span class="home-place-icon">${icon("pin")}</span>
                        <span class="home-place-copy">
                            <strong>${esc(place.name)}</strong>
                            <small>${esc(place.type)} · ${formatNumber(place.machines)} dianas</small>
                        </span>
                        <span class="home-place-arrow">${icon("arrow")}</span>
                    </a>
                `).join("")}
            </div>
        </section>
    `;
}

function newsSection(data) {
    const items = (data.news || []).slice(0, 3);
    if (!items.length) return "";

    return `
        <section class="home-block home-news">
            <header class="home-block-head">
                <div>
                    <span class="home-block-kicker">Actualidad</span>
                    <h2>Últimas noticias</h2>
                </div>
                <a href="#/noticias">Ver noticias ${icon("arrow")}</a>
            </header>
            <div class="home-news-rail">
                ${items.map((item) => `
                    <a class="home-news-card" href="#/noticias/${item.id}">
                        <span class="home-news-media">
                            ${item.imageUrl
                                ? `<img src="${esc(item.imageUrl)}" alt="" loading="lazy" data-hide-on-error>`
                                : icon("newspaper")}
                        </span>
                        <span class="home-news-copy">
                            <small>${esc(item.date || "Noticia")}</small>
                            <strong>${esc(item.title)}</strong>
                        </span>
                    </a>
                `).join("")}
            </div>
        </section>
    `;
}

function shopStrip() {
    return `
        <section class="home-strip home-shop-strip">
            <span class="home-shop-icon">${icon("bag")}</span>
            <div class="home-strip-copy">
                <span class="home-block-kicker">Radikal Shop</span>
                <h2>Personaliza tu diana. Canjea tus puntos.</h2>
                <p>Fondos, dardos, feats y goodshots oficiales. También material y suscripciones Radikal.</p>
            </div>
            <a class="btn btn-primary btn-sm" href="#/tienda">Ver la tienda ${icon("arrow")}</a>
        </section>
    `;
}

function recommendationsSkeleton() {
    return `
        <section class="home-block">
            <header class="home-block-head">
                <div>
                    <span class="home-block-kicker">Con tus puntos</span>
                    <h2>Para tu diana</h2>
                </div>
                <a href="#/tienda">Toda la tienda ${icon("arrow")}</a>
            </header>
            <div class="shop-grid">
                ${Array.from({ length: 3 }, () => `<div class="skeleton skeleton-card" style="height:260px"></div>`).join("")}
            </div>
        </section>
    `;
}

async function loadRecommendations(container, area) {
    const mount = container.querySelector("[data-home-recommendations]");
    if (!mount) return;

    try {
        const shop = await api.shop();
        const account = area.account || {};
        const products = (shop?.categories || []).flatMap((category) => category.products || []);
        const affordable = products.filter((product) => product.points && product.points <= account.radikalPoints);
        const picks = (affordable.length ? affordable : products.filter((product) => product.points))
            .sort((left, right) => (right.points || 0) - (left.points || 0))
            .slice(0, 3);

        if (!picks.length) {
            mount.remove();
            return;
        }

        mount.outerHTML = `
            <section class="home-block">
                <header class="home-block-head">
                    <div>
                        <span class="home-block-kicker">Con tus ${formatNumber(account.radikalPoints)} puntos</span>
                        <h2>Para tu diana</h2>
                    </div>
                    <a href="#/tienda">Toda la tienda ${icon("arrow")}</a>
                </header>
                <div class="shop-grid">
                    ${picks.map(productTeaser).join("")}
                </div>
            </section>
        `;
    } catch {
        mount.remove();
    }
}

function productTeaser(product) {
    return `
        <article class="shop-card">
            <a class="shop-media" href="#/tienda/${product.id}">
                ${product.imageUrl ? `<img src="${esc(product.imageUrl)}" alt="${esc(product.title)}" loading="lazy" data-hide-on-error>` : ""}
                ${product.category ? `<span class="shop-category">${esc(product.category)}</span>` : ""}
            </a>
            <div class="shop-card-body">
                <h3><a href="#/tienda/${product.id}">${esc(product.title)}</a></h3>
                <div class="shop-price-row">
                    <span class="shop-points">${formatNumber(product.points)} <small>pts</small></span>
                    <a class="btn btn-outline btn-sm" href="#/tienda/${product.id}">Ver producto</a>
                </div>
            </div>
        </article>
    `;
}

function liveStatusChip(live) {
    if (live?.isLive) {
        return `<a class="home-live-chip" href="#/directo"><span class="live-dot"></span>En directo ahora</a>`;
    }
    return `<span class="home-live-chip is-off">${icon("clock")}Sin partidas ahora</span>`;
}

function revealHome(container) {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
    const nodes = container.querySelectorAll(".home-shortcut, .home-now-card, .home-block, .home-strip");
    nodes.forEach((node, index) => {
        node.classList.add("reveal");
        node.style.animationDelay = `${Math.min(index * 40, 280)}ms`;
    });
}

function cleanRating(value) {
    return String(value || "—").replace(/\s*\(.*\)\s*$/, "").trim() || "—";
}

function formatMemberUntil(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("es-ES", { month: "short", year: "numeric" }).format(date);
}

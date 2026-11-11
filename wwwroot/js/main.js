import { api } from "./api.js?v=77";
import { esc, icon, avatarHtml, setupImageFallbacks, debounce } from "./ui.js?v=77";
import { refreshAuth, openLoginModal } from "./auth.js?v=80";
import { loadCart, updateCartBadge } from "./cart.js?v=77";
import {
    COUNTRIES, countryFallback, countryFlagUrl, countryName, featuredCountries, otherCountries,
    getCountry, initPreferences, setCountry, subscribeCountry, toggleTheme
} from "./preferences.js?v=77";

const preferences = initPreferences();
void preferences;

const app = document.getElementById("app");
const nav = document.getElementById("main-nav");
const menuToggle = document.getElementById("menu-toggle");
const navBackdrop = document.querySelector("[data-nav-backdrop]");
const navClose = document.getElementById("nav-close");
const searchOverlay = document.getElementById("search-overlay");
const searchInput = document.getElementById("global-search");
const searchResults = document.getElementById("search-results");
const navLiveDot = document.getElementById("nav-live-dot");
const bottomLiveDot = document.getElementById("bottom-live-dot");

const standaloneQuery = window.matchMedia?.("(display-mode: standalone)");
const isStandalone = Boolean(standaloneQuery?.matches || window.navigator.standalone === true);
document.documentElement.classList.toggle("is-standalone", isStandalone);
standaloneQuery?.addEventListener?.("change", (event) => {
    document.documentElement.classList.toggle("is-standalone", event.matches);
});

let cleanup = null;
let currentRoute = null;

// Versión de assets: se incrementa al cambiar vistas para evitar módulos cacheados.
const ASSET_VERSION = "126";
const view = (name) => import(`./views/${name}.js?v=${ASSET_VERSION}`);

const routes = [
    { name: "home", pattern: /^\/$/, loader: () => view("home") },
    { name: "rankings", pattern: /^\/rankings\/?$/, loader: () => view("rankings") },
    { name: "playerDetail", pattern: /^\/jugador\/([^/]+)\/?$/, loader: () => view("player") },
    { name: "competitions", pattern: /^\/competiciones\/?$/, loader: () => view("competitions") },
    { name: "competition", pattern: /^\/competiciones\/(\d+)\/?$/, loader: () => view("competition") },
    { name: "live", pattern: /^\/directo\/?$/, loader: () => view("live") },
    { name: "tournament", pattern: /^\/directo\/torneo\/(\d+)\/?$/, loader: () => view("tournament") },
    { name: "dartsDemo", pattern: /^\/directo\/dardos\/demo\/?$/, loader: () => view("live-darts") },
    { name: "darts", pattern: /^\/directo\/dardos\/(\d+)\/(\d+)\/(\d+)\/?$/, loader: () => view("live-darts") },
    { name: "finished", pattern: /^\/directo\/finalizadas\/?$/, loader: () => view("recordings") },
    { name: "finishedGame", pattern: /^\/directo\/finalizadas\/(\d+)\/(\d+)\/(\d+)\/?$/, loader: () => view("game-replay") },
    { name: "report", pattern: /^\/directo\/partidas\/(\d+)\/(\d+)\/(\d+)\/avanzado\/?$/, loader: () => view("live-report") },
    { name: "places", pattern: /^\/lugares\/?$/, loader: () => view("places") },
    { name: "news", pattern: /^\/noticias\/?$/, loader: () => view("news") },
    { name: "newsDetail", pattern: /^\/noticias\/(\d+)\/?$/, loader: () => view("news-detail") },
    { name: "official", pattern: /^\/official\/?$/, loader: () => view("official") },
    { name: "officialPlayer", pattern: /^\/official\/(\d+)\/?$/, loader: () => view("official-player") },
    { name: "shop", pattern: /^\/tienda\/?$/, loader: () => view("shop") },
    { name: "product", pattern: /^\/tienda\/(\d+)\/?$/, loader: () => view("product") },
    { name: "cart", pattern: /^\/carrito\/?$/, loader: () => view("cart") },
    { name: "player", pattern: /^\/mi-area\/?$/, loader: () => view("player-area") }
];

function parseHash() {
    const raw = (window.location.hash || "#/").slice(1);
    const [pathPart, queryPart] = raw.split("?");
    const path = pathPart || "/";
    const query = new URLSearchParams(queryPart || "");
    return { path, query };
}

function setActiveNav(name) {
    document.querySelectorAll("[data-nav]").forEach((link) => {
        const active = link.dataset.nav === name;
        link.classList.toggle("active", active);
        if (active) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
    });

    document.querySelectorAll("[data-bottom]").forEach((link) => {
        const active = link.dataset.bottom === name;
        link.classList.toggle("active", active);
        if (active) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
    });
}

function openMobileNav() {
    if (!nav) return;
    nav.classList.add("open");
    document.body.classList.add("nav-open");
    menuToggle?.setAttribute("aria-expanded", "true");
    menuToggle?.setAttribute("aria-label", "Cerrar menú");
    window.requestAnimationFrame(() => navClose?.focus({ preventScroll: true }));
}

function closeMobileNav() {
    if (!nav?.classList.contains("open")) return;
    nav.classList.remove("open");
    document.body.classList.remove("nav-open");
    menuToggle?.setAttribute("aria-expanded", "false");
    menuToggle?.setAttribute("aria-label", "Abrir menú");
    menuToggle?.focus({ preventScroll: true });
}

async function renderRoute() {
    const { path, query } = parseHash();

    // Compatibilidad: las antiguas URLs de "grabaciones" pasan a "finalizadas".
    if (path.startsWith("/directo/grabaciones")) {
        const target = path.replace("/directo/grabaciones", "/directo/finalizadas");
        window.location.replace(`#${target}${query.toString() ? `?${query}` : ""}`);
        return;
    }

    const matched = routes
        .map((route) => ({ route, match: path.match(route.pattern) }))
        .find((entry) => entry.match);

    if (!matched) {
        window.location.hash = "#/";
        return;
    }

    // El visor de partidas ocupa toda la pantalla: sin topbar, footer ni navegación inferior.
    document.body.classList.toggle("is-immersive", matched.route.name === "finishedGame");
    document.body.classList.toggle("is-home", matched.route.name === "home");

    if (currentRoute === path + "?" + query.toString() && app.childElementCount > 0) {
        return;
    }
    currentRoute = path + "?" + query.toString();

    if (typeof cleanup === "function") {
        try { cleanup(); } catch { /* noop */ }
        cleanup = null;
    }

    closeMobileNav();
    const activeName = matched.route.name === "competition" ? "competitions"
        : matched.route.name === "tournament" || matched.route.name === "darts" || matched.route.name === "dartsDemo"
            || matched.route.name === "finished" || matched.route.name === "finishedGame" || matched.route.name === "report" ? "live"
        : matched.route.name === "officialPlayer" ? "official"
        : matched.route.name === "newsDetail" ? "news"
        : matched.route.name === "cart" ? "shop"
        : matched.route.name === "product" ? "shop"
        : matched.route.name === "playerDetail" ? "rankings"
        : matched.route.name;
    setActiveNav(activeName);
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    app.innerHTML = "";
    app.setAttribute("aria-busy", "true");

    try {
        const module = await matched.route.loader();
        const params = matched.match.slice(1);
        cleanup = await module.render(app, params, query);
    } catch (error) {
        console.error(error);
        app.innerHTML = `
            <div class="page container">
                <div class="error-box">
                    <h3 style="margin-top:0;font-family:var(--font-display);text-transform:uppercase">No se pudo abrir la página</h3>
                    <p style="margin:0 0 14px;color:var(--text-soft)">${esc(error?.message || "Error inesperado")}</p>
                    <button class="btn btn-outline btn-sm" id="route-retry">Reintentar</button>
                </div>
            </div>
        `;
        document.getElementById("route-retry")?.addEventListener("click", () => {
            currentRoute = null;
            renderRoute();
        });
    } finally {
        app.removeAttribute("aria-busy");
    }
}

window.addEventListener("hashchange", renderRoute);

// La navegación inferior siempre cierra el menú móvil y navega al href exacto.
document.querySelectorAll(".bottom-nav a").forEach((link) => {
    link.addEventListener("click", (event) => {
        closeMobileNav();
        const href = link.getAttribute("href");
        if (!href || !href.startsWith("#/")) return;
        event.preventDefault();
        if (window.location.hash === href) return;
        window.location.hash = href;
    });
});

/* ===== Modo app en móvil: sin zoom por doble toque ni pinch ===== */
const isTouchDevice = window.matchMedia?.("(pointer: coarse)")?.matches;
if (isTouchDevice) {
    const blockGesture = (event) => event.preventDefault();
    document.addEventListener("gesturestart", blockGesture, { passive: false });
    document.addEventListener("gesturechange", blockGesture, { passive: false });
    document.addEventListener("gestureend", blockGesture, { passive: false });

    // Doble toque: sólo se bloquea si no cae sobre algo pulsable, para no retrasar botones.
    let lastTouchEnd = 0;
    document.addEventListener("touchend", (event) => {
        const now = Date.now();
        if (now - lastTouchEnd < 320 && !event.target.closest("a, button, input, select, textarea, [role='button']")) {
            event.preventDefault();
        }
        lastTouchEnd = now;
    }, { passive: false });
}

menuToggle?.addEventListener("click", () => {
    if (nav?.classList.contains("open")) closeMobileNav();
    else openMobileNav();
});

navClose?.addEventListener("click", closeMobileNav);
navBackdrop?.addEventListener("click", closeMobileNav);

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && nav?.classList.contains("open")) {
        closeMobileNav();
    }
});

nav?.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusables = [...nav.querySelectorAll("a[href], button:not([disabled])")]
        .filter((element) => element.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
});

window.matchMedia?.("(min-width: 1021px)").addEventListener?.("change", (event) => {
    if (event.matches) closeMobileNav();
});

document.getElementById("login-open")?.addEventListener("click", () => openLoginModal());

nav?.addEventListener("click", (event) => {
    if (event.target.closest("a, [data-nav-login]")) closeMobileNav();
});

document.getElementById("footer-year").textContent = new Date().getFullYear();

/* ===== Búsqueda global ===== */
function openSearch() {
    if (!searchOverlay) return;
    searchOverlay.hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(() => searchInput?.focus(), 30);
}

function closeSearch() {
    if (!searchOverlay) return;
    searchOverlay.hidden = true;
    document.body.style.overflow = "";
}

// Permite abrir el buscador global con una consulta desde cualquier vista.
window.openSearchWithQuery = (query) => {
    openSearch();
    if (!searchInput) return;
    searchInput.value = query || "";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
};

document.getElementById("search-open")?.addEventListener("click", openSearch);
document.getElementById("search-close")?.addEventListener("click", closeSearch);
searchOverlay?.addEventListener("click", (event) => {
    if (event.target === searchOverlay) closeSearch();
});

document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearch();
    }
    if (event.key === "Escape") closeSearch();
});

const searchKinds = {
    player: "Jugadores",
    official: "Official Players",
    competition: "Competiciones",
    diana: "Dianas",
    place: "Top Places"
};

const runSearch = debounce(async (query) => {
    if (!searchResults) return;
    if (query.trim().length < 2) {
        searchResults.innerHTML = `<p class="search-hint">Busca por alias, nombre completo o ID. Escribe al menos 2 caracteres o usa <kbd>Ctrl</kbd> + <kbd>K</kbd>.</p>`;
        return;
    }

    searchResults.innerHTML = `<p class="search-hint">Buscando “${esc(query)}”…</p>`;
    try {
        const results = await api.search(query);
        if (!results.length) {
            searchResults.innerHTML = `<p class="search-hint">Sin resultados para “${esc(query)}”.</p>`;
            return;
        }

        const groups = results.reduce((acc, item) => {
            (acc[item.kind] ||= []).push(item);
            return acc;
        }, {});

        searchResults.innerHTML = Object.entries(groups).map(([kind, items]) => `
            <div class="search-group-title">${esc(searchKinds[kind] || kind)}</div>
            ${items.map((item) => `
                <a class="search-result" href="${esc(item.url || "#/")}">
                    <span class="search-result-main">
                        ${item.photoUrl
                            ? `<span class="search-result-avatar">${avatarHtml(item.title, item.photoUrl)}</span>`
                            : ""}
                        <span>
                            <strong>${esc(item.title)}</strong>
                            <small>${esc(item.subtitle || "")}</small>
                        </span>
                    </span>
                    <span class="search-kind">${esc(searchKinds[kind] || kind)}</span>
                </a>
            `).join("")}
        `).join("");
    } catch (error) {
        searchResults.innerHTML = `<p class="search-hint">No se pudo buscar: ${esc(error.message)}</p>`;
    }
}, 260);

searchInput?.addEventListener("input", (event) => runSearch(event.target.value));
searchResults?.addEventListener("click", (event) => {
    if (event.target.closest("a")) closeSearch();
});

/* ===== Estado live del menú ===== */
let liveTimer = null;
async function refreshLiveDot() {
    try {
        const live = await api.live();
        if (navLiveDot) navLiveDot.hidden = !live.isLive;
        if (bottomLiveDot) bottomLiveDot.hidden = !live.isLive;
    } catch {
        // silencioso: es un indicador secundario
    }
}

refreshLiveDot();
liveTimer = setInterval(refreshLiveDot, 60000);

// Mantén el carrito sincronizado si el usuario cambia de pestaña o vuelve a la app.
window.addEventListener("focus", () => loadCart({ force: true }).catch(() => {}));
document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadCart({ force: true }).catch(() => {});
});

/* ===== Preferencias: país y tema ===== */
function flagHtml(code, className = "country-option-flag") {
    const url = countryFlagUrl(code);
    if (!url) {
        return `<span class="${className} country-flag-text" aria-hidden="true">${esc(countryFallback(code))}</span>`;
    }
    return `<span class="${className}"><img src="${esc(url)}" alt="" width="20" height="14" decoding="async"></span>`;
}

function setupPreferences() {
    const picker = document.querySelector("[data-country-picker]");
    const toggle = picker?.querySelector("[data-country-toggle]");
    const menu = picker?.querySelector("[data-country-menu]");
    const list = picker?.querySelector("[data-country-list]");
    const search = picker?.querySelector("[data-country-search]");
    const flagNode = picker?.querySelector("[data-country-flag]");
    const nameNode = picker?.querySelector("[data-country-name]");

    function renderList(filter = "") {
        if (!list) return;
        const term = filter.trim().toLowerCase();
        const selected = getCountry();
        const matches = (country) => !term || country.name.toLowerCase().includes(term);
        const featured = featuredCountries().filter(matches);
        const others = otherCountries().filter(matches);

        const optionHtml = (country) => `
            <button class="country-option ${country.code === selected ? "is-selected" : ""}"
                    type="button" role="option" aria-selected="${country.code === selected}"
                    data-country="${country.code}">
                ${flagHtml(country.code)}
                <span class="country-option-name">${esc(country.name)}</span>
                <span class="country-option-check" aria-hidden="true">${country.code === selected ? "✓" : ""}</span>
            </button>`;

        if (!featured.length && !others.length) {
            list.innerHTML = `<p class="country-menu-empty">Sin resultados para “${esc(filter)}”</p>`;
            return;
        }

        list.innerHTML = `
            ${featured.length ? `<p class="country-menu-label">Con comunidad activa</p>${featured.map(optionHtml).join("")}` : ""}
            ${others.length ? `<p class="country-menu-label">Resto de países</p>${others.map(optionHtml).join("")}` : ""}
        `;

        list.querySelectorAll("[data-country]").forEach((button) => {
            button.addEventListener("click", () => {
                setCountry(button.dataset.country);
                closeMenu();
                renderActiveRoute();
            });
        });
    }

    function syncLabel(code) {
        if (flagNode) flagNode.innerHTML = flagHtml(code, "country-picker-flag");
        if (nameNode) nameNode.textContent = countryName(code);
    }

    function openMenu() {
        if (!menu) return;
        menu.hidden = false;
        picker?.classList.add("is-open");
        toggle?.setAttribute("aria-expanded", "true");
        renderList(search?.value || "");
        window.requestAnimationFrame(() => search?.focus());
    }

    function closeMenu() {
        if (!menu) return;
        menu.hidden = true;
        picker?.classList.remove("is-open");
        toggle?.setAttribute("aria-expanded", "false");
    }

    toggle?.addEventListener("click", () => {
        if (menu?.hidden) openMenu();
        else closeMenu();
    });

    search?.addEventListener("input", () => renderList(search.value));
    search?.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeMenu();
        if (event.key === "Enter") {
            const first = list?.querySelector("[data-country]");
            if (first) first.click();
        }
    });

    document.addEventListener("click", (event) => {
        if (!picker?.contains(event.target)) closeMenu();
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeMenu();
    });

    syncLabel(getCountry());
    subscribeCountry(syncLabel);

    document.querySelector("[data-theme-toggle]")?.addEventListener("click", () => toggleTheme());
}

// Vuelve a pintar la ruta actual para que las vistas usen el país recién elegido.
function renderActiveRoute() {
    currentRoute = null;
    renderRoute();
}

/* ===== Arranque ===== */
setupPreferences();
setupImageFallbacks();
refreshAuth();
loadCart().catch(() => {});
updateCartBadge();
if (!window.location.hash) window.location.hash = "#/";
renderRoute();

window.addEventListener("beforeunload", () => {
    if (liveTimer) clearInterval(liveTimer);
    if (typeof cleanup === "function") cleanup();
});

/**
 * Preferencias globales de la app: país de referencia y tema visual.
 * Se guardan en localStorage para que la elección sobreviva entre visitas.
 */

const COUNTRY_KEY = "radikal.country";
const THEME_KEY = "radikal.theme";

/**
 * Catálogo de países Radikal (código numérico ISO 3166-1) con su ISO alfa-2 para la bandera.
 * Orden: primero los países con comunidad activa, después el resto por nombre.
 */
export const COUNTRIES = [
    { code: "724", iso: "es", name: "España" },
    { code: "620", iso: "pt", name: "Portugal" },
    { code: "250", iso: "fr", name: "Francia" },
    { code: "276", iso: "de", name: "Alemania" },
    { code: "380", iso: "it", name: "Italia" },
    { code: "826", iso: "gb", name: "Reino Unido" },
    { code: "840", iso: "us", name: "Estados Unidos" },
    { code: "528", iso: "nl", name: "Países Bajos" },
    { code: "56", iso: "be", name: "Bélgica" },
    { code: "756", iso: "ch", name: "Suiza" },
    { code: "40", iso: "at", name: "Austria" },
    { code: "76", iso: "br", name: "Brasil" },
    { code: "484", iso: "mx", name: "México" },
    { code: "124", iso: "ca", name: "Canadá" },
    { code: "36", iso: "au", name: "Australia" },
    { code: "20", iso: "ad", name: "Andorra" },
    { code: "100", iso: "bg", name: "Bulgaria" },
    { code: "156", iso: "cn", name: "China" },
    { code: "158", iso: "tw", name: "Taiwán" },
    { code: "208", iso: "dk", name: "Dinamarca" },
    { code: "246", iso: "fi", name: "Finlandia" },
    { code: "300", iso: "gr", name: "Grecia" },
    { code: "344", iso: "hk", name: "Hong Kong" },
    { code: "348", iso: "hu", name: "Hungría" },
    { code: "360", iso: "id", name: "Indonesia" },
    { code: "372", iso: "ie", name: "Irlanda" },
    { code: "376", iso: "il", name: "Israel" },
    { code: "392", iso: "jp", name: "Japón" },
    { code: "428", iso: "lv", name: "Letonia" },
    { code: "438", iso: "li", name: "Liechtenstein" },
    { code: "442", iso: "lu", name: "Luxemburgo" },
    { code: "446", iso: "mo", name: "Macao" },
    { code: "458", iso: "my", name: "Malasia" },
    { code: "554", iso: "nz", name: "Nueva Zelanda" },
    { code: "578", iso: "no", name: "Noruega" },
    { code: "591", iso: "pa", name: "Panamá" },
    { code: "616", iso: "pl", name: "Polonia" },
    { code: "642", iso: "ro", name: "Rumanía" },
    { code: "702", iso: "sg", name: "Singapur" },
    { code: "703", iso: "sk", name: "Eslovaquia" },
    { code: "705", iso: "si", name: "Eslovenia" },
    { code: "752", iso: "se", name: "Suecia" },
    { code: "784", iso: "ae", name: "Emiratos Árabes" },
    { code: "792", iso: "tr", name: "Turquía" }
];

export const DEFAULT_COUNTRY = "724";

/** Países que aparecen primero en el menú (comunidad activa). */
const FEATURED = ["724", "620", "250", "276", "380", "826", "840", "528", "56", "756", "40", "76", "484", "124", "36"];

export function featuredCountries() {
    return COUNTRIES.filter((country) => FEATURED.includes(country.code));
}

export function otherCountries() {
    return COUNTRIES.filter((country) => !FEATURED.includes(country.code));
}

const listeners = new Set();

function read(key) {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

function write(key, value) {
    try {
        window.localStorage.setItem(key, value);
    } catch {
        // modo privado o almacenamiento bloqueado: seguimos en memoria
    }
}

/* ---------- País ---------- */

export function getCountry() {
    const stored = read(COUNTRY_KEY);
    // "0" era el antiguo "global": ahora es una vista del ranking, no un país.
    if (stored && stored !== "0" && COUNTRIES.some((country) => country.code === stored)) return stored;
    return DEFAULT_COUNTRY;
}

export function countryInfo(code) {
    return COUNTRIES.find((country) => country.code === String(code)) ?? null;
}

export function countryName(code) {
    return countryInfo(code)?.name ?? `País ${code}`;
}

/** URL de la bandera (PNG servido por nuestra API). Cadena vacía si no hay bandera. */
export function countryFlagUrl(code) {
    const iso = countryInfo(code)?.iso;
    return iso ? `/api/flags/${iso}` : "";
}

/** Iniciales de respaldo cuando no hay bandera (p. ej. "Global"). */
export function countryFallback(code) {
    if (String(code) === "0") return "ALL";
    return String(code ?? "").slice(-2);
}

export function setCountry(code) {
    const value = String(code || DEFAULT_COUNTRY);
    write(COUNTRY_KEY, value);
    listeners.forEach((listener) => {
        try { listener(value); } catch { /* noop */ }
    });
    return value;
}

export function subscribeCountry(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/* ---------- Tema ---------- */

export function getTheme() {
    const stored = read(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
}

export function setTheme(theme) {
    const value = theme === "dark" ? "dark" : "light";
    write(THEME_KEY, value);
    applyTheme(value);
    return value;
}

export function toggleTheme() {
    const root = document.documentElement;
    root.classList.add("theme-anim");
    const theme = setTheme(getTheme() === "dark" ? "light" : "dark");
    setTimeout(() => root.classList.remove("theme-anim"), 320);
    return theme;
}

export function applyTheme(theme = getTheme()) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
        button.setAttribute("aria-pressed", String(theme === "dark"));
        button.setAttribute("aria-label", theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro");
        button.setAttribute("title", theme === "dark" ? "Modo claro" : "Modo oscuro");
    });
    window.dispatchEvent(new CustomEvent("radikal:theme", { detail: { theme } }));
}

export function initPreferences() {
    applyTheme(getTheme());

    // Si quedó guardado el antiguo "global" (0), normalizamos al país por defecto.
    const stored = read(COUNTRY_KEY);
    if (stored === "0") write(COUNTRY_KEY, DEFAULT_COUNTRY);

    return { country: getCountry(), theme: getTheme() };
}

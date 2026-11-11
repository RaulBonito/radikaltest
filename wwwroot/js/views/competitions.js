import { api } from "../api.js?v=79";
import { countryName, getCountry, subscribeCountry } from "../preferences.js?v=77";
import { esc, icon, formatNumber, formatRelative, emptyState, debounce } from "../ui.js?v=78";
import { competitionCard, countryFlagHtml } from "../components.js?v=77";

const TYPES = [
    { code: "0", label: "Todas" },
    { code: "LIGA", label: "Ligas" },
    { code: "CAMP", label: "Campeonatos" },
    { code: "TORX", label: "Torneos" }
];

const STATUSES = [
    { code: "0", label: "Todos los estados" },
    { code: "live", label: "En curso" },
    { code: "upcoming", label: "Próximas" },
    { code: "finished", label: "Finalizadas" }
];

export async function render(container) {
    const state = {
        country: getCountry(),
        type: "0",
        status: "0",
        includeFinished: false,
        query: "",
        page: 1
    };

    let controller = null;
    let totalPages = 1;
    let total = 0;
    let fetchedAt = null;
    let unsubscribe = null;

    container.innerHTML = shell();
    bindShell();

    try {
        await load(1);
    } catch (error) {
        showError(error);
    }

    function shell() {
        return `
            <div class="page container">
                <div class="section-head" style="margin-bottom:18px">
                    <div class="section-head-left">
                        <span class="kicker">${icon("trophy")}Competiciones</span>
                        <h1 class="section-title">Ligas, campeonatos <span class="accent">y torneos</span></h1>
                        <p class="section-sub">Encuentra tu próxima competición, consulta la clasificación y abre el cuadrante en directo.</p>
                    </div>
                    <a class="btn btn-outline btn-sm" href="#/directo">${icon("play")} Ir a En directo</a>
                </div>

                <div class="filter-bar" id="comp-filters">
                    <div class="filter-group">
                        <span class="filter-label">País</span>
                        <span class="filter-country" id="cp-current-country">
                            <span id="cp-current-flag" aria-hidden="true"></span>
                            <strong id="cp-current-name"></strong>
                        </span>
                    </div>
                    <div class="filter-group">
                        <span class="filter-label">Tipo</span>
                        <div class="segmented" id="cp-type">
                            ${TYPES.map((type) => `<button type="button" data-value="${type.code}" class="${type.code === "0" ? "active" : ""}">${type.label}</button>`).join("")}
                        </div>
                    </div>
                    <div class="filter-group">
                        <span class="filter-label">Estado</span>
                        <div class="segmented" id="cp-status-seg">
                            ${STATUSES.map((status) => `<button type="button" data-value="${status.code}" class="${status.code === "0" ? "active" : ""}">${status.label}</button>`).join("")}
                        </div>
                    </div>
                    <div class="search-field comp-search">
                        ${icon("search")}
                        <input class="form-control" id="cp-search" type="search" placeholder="Buscar competición…" autocomplete="off" />
                    </div>
                    <button class="btn btn-ghost btn-sm" id="cp-change-country" type="button">
                        ${icon("globe")} Cambiar país
                    </button>
                </div>

                <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin:14px 0 20px">
                    <span class="small muted" id="cp-summary">Cargando competiciones…</span>
                    <span class="small muted">Fuente: Radikal Players</span>
                </div>

                <div id="competition-results">
                    <div class="comp-grid">${Array.from({ length: 6 }, () => `<div class="skeleton skeleton-card"></div>`).join("")}</div>
                </div>

                <div id="competition-pagination" style="display:flex;justify-content:center;gap:8px;margin-top:24px"></div>
            </div>
        `;
    }

    function bindShell() {
        container.querySelector("#cp-change-country")?.addEventListener("click", () => {
            document.querySelector("[data-country-toggle]")?.click();
        });

        const statusGroup = container.querySelector("#cp-status-seg");
        statusGroup?.querySelectorAll("button").forEach((button) => {
            button.addEventListener("click", () => {
                statusGroup.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
                button.classList.add("active");
                state.status = button.dataset.value;
                state.includeFinished = state.status === "finished";
                load(1);
            });
        });

        container.querySelector("#cp-search")?.addEventListener("input", debounce((event) => {
            state.query = event.target.value.trim();
            load(1);
        }, 350));

        const typeGroup = container.querySelector("#cp-type");
        typeGroup?.querySelectorAll("button").forEach((button) => {
            button.addEventListener("click", () => {
                typeGroup.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
                button.classList.add("active");
                state.type = button.dataset.value;
                load(1);
            });
        });
    }

    function syncCountryLabel() {
        const name = container.querySelector("#cp-current-name");
        const flag = container.querySelector("#cp-current-flag");
        if (name) name.textContent = countryName(state.country);
        if (flag) flag.innerHTML = countryFlagHtml(state.country);
    }

    /** Sigue el selector de país de la cabecera. */
    unsubscribe = subscribeCountry((code) => {
        if (code === state.country) return;
        state.country = code;
        syncCountryLabel();
        load(1);
    });

    syncCountryLabel();
    async function load(page = 1) {
        controller?.abort();
        controller = new AbortController();
        state.page = page;

        const results = container.querySelector("#competition-results");
        const summary = container.querySelector("#cp-summary");
        if (results) {
            results.innerHTML = `<div class="comp-grid">${Array.from({ length: 6 }, () => `<div class="skeleton skeleton-card"></div>`).join("")}</div>`;
        }
        if (summary) summary.textContent = "Cargando competiciones…";
        container.querySelector("#competition-pagination").innerHTML = "";

        try {
            const response = await api.competitions({
                country: state.country,
                type: state.type,
                status: state.status,
                q: state.query,
                includeFinished: state.includeFinished || state.status === "finished",
                page,
                pageSize: 12
            }, controller.signal);

            total = response.total;
            totalPages = response.totalPages;
            fetchedAt = response.fetchedAt;
            drawResults(response);
        } catch (error) {
            if (error.name === "AbortError") return;
            showError(error);
        }
    }

    function drawResults(response) {
        const results = container.querySelector("#competition-results");
        const summary = container.querySelector("#cp-summary");
        const pagination = container.querySelector("#competition-pagination");
        if (!results) return;

        if (summary) {
            summary.innerHTML = `<strong style="color:var(--text)">${formatNumber(total)} competiciones</strong> · página ${response.page} de ${response.totalPages} · actualizado ${esc(formatRelative(fetchedAt))}`;
        }

        if (!response.items.length) {
            results.innerHTML = emptyState("Sin competiciones", "No hay competiciones para los filtros aplicados. Prueba a ampliar la búsqueda.", "trophy");
            pagination.innerHTML = "";
            return;
        }

        results.innerHTML = `<div class="comp-grid">${response.items.map(competitionCard).join("")}</div>`;
        drawPagination(response);
    }

    function drawPagination(response) {
        const pagination = container.querySelector("#competition-pagination");
        if (!pagination || totalPages <= 1) {
            if (pagination) pagination.innerHTML = "";
            return;
        }

        const pages = [];
        const start = Math.max(1, response.page - 2);
        const end = Math.min(totalPages, response.page + 2);
        for (let i = start; i <= end; i++) pages.push(i);

        pagination.innerHTML = `
            <button class="btn btn-outline btn-sm" data-page="${response.page - 1}" ${response.page <= 1 ? "disabled" : ""}>${icon("chevronLeft")} Anterior</button>
            ${pages.map((page) => `<button class="btn ${page === response.page ? "btn-primary" : "btn-outline"} btn-sm" data-page="${page}">${page}</button>`).join("")}
            <button class="btn btn-outline btn-sm" data-page="${response.page + 1}" ${response.page >= totalPages ? "disabled" : ""}>Siguiente ${icon("chevronRight")}</button>
        `;

        pagination.querySelectorAll("button[data-page]").forEach((button) => {
            button.addEventListener("click", () => {
                const page = Number(button.dataset.page);
                if (page >= 1 && page <= totalPages) load(page);
            });
        });
    }

    function showError(error) {
        const results = container.querySelector("#competition-results");
        if (!results) return;
        results.innerHTML = `
            <div class="error-box">
                <strong>No se pudieron cargar las competiciones.</strong>
                <p style="margin:6px 0 14px">${esc(error.message)}</p>
                <button class="btn btn-outline btn-sm" id="cp-retry">Reintentar</button>
            </div>
        `;
        results.querySelector("#cp-retry")?.addEventListener("click", () => load(state.page));
    }

    return () => {
        controller?.abort();
        unsubscribe?.();
    };
}

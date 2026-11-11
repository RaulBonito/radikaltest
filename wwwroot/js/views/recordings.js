import { api } from "../api.js?v=79";
import { esc, icon, formatRelative, emptyState } from "../ui.js?v=78";
import { playerColor } from "../dartboard.js?v=78";

export async function render(container, params = [], query = new URLSearchParams()) {
    let destroyed = false;
    let timer = null;
    let items = [];
    let filter = query.get("q") || "";
    let mode = query.get("mode") || "finished";

    container.innerHTML = shell();
    bind();
    await load();

    if (!destroyed) timer = setInterval(load, 15000);

    function shell() {
        return `
            <div class="page container recordings-page rec-page">
                <div class="section-head rec-head">
                    <div class="section-head-left">
                        <span class="kicker">${icon("history")}Radikal Live</span>
                        <h1 class="section-title">Partidas <span class="accent">finalizadas</span></h1>
                    </div>
                    <div class="rec-head-actions">
                        <a class="btn btn-ghost btn-sm" href="#/directo">${icon("arrowLeft")} En directo</a>
                        <button class="btn btn-ghost btn-sm" id="recordings-refresh" type="button">${icon("refresh")} Actualizar</button>
                    </div>
                </div>

                <div class="recordings-toolbar rec-toolbar">
                    <div class="search-field">
                        ${icon("search")}
                        <input class="form-control" id="recordings-search" type="search"
                               placeholder="Busca por jugador, partida o competición…"
                               autocomplete="off" value="${esc(filter)}" />
                    </div>
                    <div class="recordings-tabs" role="tablist">
                        <button class="recordings-tab" type="button" data-mode="all">Todas</button>
                        <button class="recordings-tab" type="button" data-mode="live">En juego</button>
                        <button class="recordings-tab" type="button" data-mode="finished">Finalizadas</button>
                    </div>
                </div>

                <div id="recordings-meta" class="rec-meta"></div>
                <div id="recordings-list" class="rec-list">
                    ${Array.from({ length: 6 }, () => `<div class="skeleton skeleton-line rec-row-skeleton"></div>`).join("")}
                </div>
            </div>
        `;
    }

    function bind() {
        container.querySelector("#recordings-refresh")?.addEventListener("click", load);
        container.querySelector("#recordings-search")?.addEventListener("input", (event) => {
            filter = event.target.value;
            paint();
        });
        container.querySelectorAll(".recordings-tab").forEach((button) => {
            button.addEventListener("click", () => {
                mode = button.dataset.mode;
                paint();
            });
        });
    }

    async function load() {
        try {
            const data = await api.liveRecordings();
            if (destroyed) return;
            items = (data?.items || []).slice().sort((a, b) => {
                if (Boolean(a.isMock) !== Boolean(b.isMock)) return a.isMock ? 1 : -1;
                return new Date(b.lastUpdatedAt) - new Date(a.lastUpdatedAt);
            });
            paint(data?.fetchedAt);
        } catch (error) {
            if (destroyed) return;
            const list = container.querySelector("#recordings-list");
            if (list) {
                list.innerHTML = `
                    <div class="error-box">
                        <strong>No se pudieron cargar las partidas finalizadas.</strong>
                        <p style="margin:6px 0 14px">${esc(error.message || "Error inesperado")}</p>
                        <button class="btn btn-outline btn-sm" id="recordings-retry">Reintentar</button>
                    </div>
                `;
                list.querySelector("#recordings-retry")?.addEventListener("click", load);
            }
        }
    }

    function paint(fetchedAt) {
        container.querySelectorAll(".recordings-tab").forEach((button) => {
            const active = button.dataset.mode === mode;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-selected", String(active));
        });

        const term = filter.trim().toLowerCase();
        const listItems = items.filter((item) => {
            if (mode === "live" && item.isFinished) return false;
            if (mode === "finished" && !item.isFinished) return false;
            if (!term) return true;
            const haystack = [
                item.title,
                item.winner,
                `#${item.matchId}`,
                `${item.competitionId}`,
                item.gameType,
                ...(item.players || [])
            ].join(" ").toLowerCase();
            return haystack.includes(term);
        });

        const meta = container.querySelector("#recordings-meta");
        if (meta) {
            meta.innerHTML = `
                <span><strong>${listItems.length}</strong> ${listItems.length === 1 ? "partida" : "partidas"}</span>
                <span>${formatRelative(fetchedAt || new Date().toISOString())}</span>
            `;
        }

        const list = container.querySelector("#recordings-list");
        if (!list) return;

        if (!listItems.length) {
            list.innerHTML = items.length
                ? emptyState("Sin resultados", "Ninguna partida coincide con el filtro.", "search")
                : emptyState(
                    "Todavía no hay partidas finalizadas",
                    "En cuanto termine una partida del directo aparecerá aquí automáticamente.",
                    "target"
                );
            return;
        }

        list.innerHTML = listItems.map(recRow).join("");
    }

    function recRow(item) {
        const base = `#/directo/finalizadas/${item.competitionId}/${item.matchId}/${item.game}`;
        const fullTitle = item.title || `Partida #${item.matchId}`;
        const title = compactTitle(fullTitle);
        const players = item.players?.length ? item.players : [];
        const status = item.isFinished
            ? `<span class="chip chip-finished">Finalizada</span>`
            : `<span class="chip chip-live">En juego</span>`;

        return `
            <article class="rec-row ${item.isMock ? "is-mock" : ""}">
                <a class="rec-row-main" href="${base}?tab=partida">
                    <span class="rec-row-game">J${item.game}</span>
                    <span class="rec-row-copy">
                        <strong title="${esc(fullTitle)}">${esc(title)}</strong>
                        <small>
                            ${players.length
                                ? players.map((name, index) => `<span class="rec-player"><i style="background:${playerColor(index)}"></i>${esc(name)}</span>`).join("")
                                : "Sin jugadores identificados"}
                        </small>
                    </span>
                    <span class="rec-row-tags">
                        ${status}
                        <span>${esc(modalityLabel(item.gameType))}</span>
                        <span>${item.dartsCount || 0} dardos</span>
                        <span>${esc(formatRelative(item.lastUpdatedAt))}</span>
                    </span>
                    <span class="rec-row-go">${icon("arrow")}</span>
                </a>
                <div class="rec-row-actions">
                    <a class="rec-action" href="${base}" title="Abrir partida" aria-label="Abrir partida">${icon("tv")} Directo</a>
                    <a class="rec-action" href="#/directo/partidas/${item.competitionId}/${item.matchId}/${item.game}/avanzado" title="Informe avanzado" aria-label="Informe avanzado">${icon("chart")} Avanzado</a>
                </div>
            </article>
        `;
    }

    function compactTitle(value) {
        const text = String(value || "").trim();
        if (!text) return "Partida finalizada";
        const first = text.split(/\s+\/\s+/)[0]?.trim();
        return first || text;
    }

    function modalityLabel(gameType) {
        const type = String(gameType || "").toUpperCase();
        if (/CRICKET|MPR/.test(type)) return "Cricket";
        if (/X01|PPD|501|301|701|901/.test(type)) return "X01";
        return "Partida";
    }

    return () => {
        destroyed = true;
        if (timer) clearInterval(timer);
    };
}

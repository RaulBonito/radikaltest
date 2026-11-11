import { api } from "../api.js?v=79";
import { esc, icon, debounce } from "../ui.js?v=78";

export async function render(container) {
    let liveController = null;
    let timer = null;
    let recordingsByKey = new Map();

    container.innerHTML = shell();
    bind();

    await Promise.all([loadStatus(), loadRecordings()]);
    await loadLiveMatches();

    timer = setInterval(async () => {
        await loadRecordings();
        loadStatus();
        loadLiveMatches();
    }, 30000);

    function shell() {
        return `
            <div class="page container live-page">
                <div class="section-head live-head">
                    <div class="section-head-left">
                        <span class="kicker">${icon("tv")}Radikal Live</span>
                        <h1 class="section-title">En directo</h1>
                    </div>
                    <div class="live-head-actions">
                        <span class="chip chip-soft" id="live-status">Comprobando…</span>
                        <span class="live-head-count" id="live-match-count"></span>
                        <button class="btn btn-ghost btn-sm" id="live-refresh" type="button">${icon("refresh")} Actualizar</button>
                        <a class="btn btn-ghost btn-sm" href="#/directo/finalizadas">${icon("list")} Finalizadas</a>
                    </div>
                </div>

                <div id="live-matches" class="live-match-list">
                    ${Array.from({ length: 3 }, () => `<div class="skeleton skeleton-line live-row-skeleton"></div>`).join("")}
                </div>

                <div id="live-empty" class="live-empty" hidden>
                    ${icon("tv")}
                    <strong>No hay partidas en directo ahora</strong>
                    <span>Cuando empiece una partida aparecerá aquí automáticamente.</span>
                    <a class="btn btn-outline btn-sm" href="#/directo/finalizadas">Ver finalizadas</a>
                </div>

                <div class="live-search-min">
                    <div class="tournament-search">
                        <div class="search-field">
                            ${icon("search")}
                            <input class="form-control" id="tournament-search" type="search" placeholder="Buscar torneo o cuadrante…" autocomplete="off" />
                        </div>
                        <button class="btn btn-ghost btn-sm" id="tournament-search-button" type="button">${icon("search")} Buscar</button>
                    </div>
                    <div class="autocomplete-list" id="tournament-results"></div>
                </div>
            </div>
        `;
    }

    function bind() {
        const input = container.querySelector("#tournament-search");
        const button = container.querySelector("#tournament-search-button");
        const run = debounce(() => searchTournaments(input?.value || ""), 300);
        input?.addEventListener("input", run);
        input?.addEventListener("keydown", (event) => {
            if (event.key === "Enter") searchTournaments(input.value);
        });
        button?.addEventListener("click", () => searchTournaments(input?.value || ""));
        container.querySelector("#live-refresh")?.addEventListener("click", async () => {
            await loadRecordings();
            await Promise.all([loadStatus(), loadLiveMatches()]);
        });
    }

    async function loadStatus() {
        liveController?.abort();
        liveController = new AbortController();
        const status = container.querySelector("#live-status");
        try {
            const live = await api.live(liveController.signal);
            if (!status) return;
            status.className = `chip ${live.isLive ? "chip-live" : "chip-soft"}`;
            status.textContent = live.isLive ? "En directo" : "Sin directo ahora";
        } catch (error) {
            if (error?.name === "AbortError") return;
            if (status) {
                status.className = "chip chip-soft";
                status.textContent = "Sin conexión";
            }
        }
    }

    async function loadRecordings() {
        try {
            const data = await api.liveRecordings();
            recordingsByKey = new Map((data?.items || []).map((recording) => [
                `${recording.competitionId}/${recording.matchId}/${recording.game}`,
                recording
            ]));
        } catch {
            // Sin grabaciones seguimos mostrando las partidas en directo.
        }
    }

    async function loadLiveMatches() {
        const list = container.querySelector("#live-matches");
        const empty = container.querySelector("#live-empty");
        const count = container.querySelector("#live-match-count");
        if (!list || !empty) return;

        try {
            const data = await api.liveMatches();
            const matches = data?.matches || [];
            if (count) count.textContent = matches.length ? `${matches.length} en juego` : "";

            if (!matches.length) {
                list.hidden = true;
                list.innerHTML = "";
                empty.hidden = false;
                return;
            }

            empty.hidden = true;
            list.hidden = false;
            list.innerHTML = matches.slice(0, 12).map(liveMatchRow).join("");
        } catch {
            list.hidden = true;
            list.innerHTML = "";
            empty.hidden = false;
            if (count) count.textContent = "";
        }
    }

    function liveMatchRow(match) {
        const key = `${match.competitionId}/${match.matchId}/${match.game}`;
        const recording = recordingsByKey.get(key);
        const fullTitle = recording?.title || match.title || `Partida #${match.matchId}`;
        const title = compactLiveTitle(fullTitle);
        const players = recording?.players?.length ? recording.players.join(" · ") : "Jugadores en pista";
        const rules = liveMatchRules(recording);
        const base = `#/directo/finalizadas/${match.competitionId}/${match.matchId}/${match.game}`;

        return `
            <article class="live-match-row">
                <a class="live-match-main" href="${base}">
                    <span class="live-match-badge">J${match.game}</span>
                    <span class="live-match-copy">
                        <strong title="${esc(fullTitle)}">${esc(title)}</strong>
                        <small>${esc(players)}</small>
                        ${rules ? `<em>${icon("target")} ${esc(rules)}</em>` : ""}
                    </span>
                    <span class="live-match-live"><i></i>EN DIRECTO</span>
                    <span class="live-match-go">${icon("arrow")}</span>
                </a>
                <a class="live-match-replay" href="${base}?tab=partida" title="Abrir partida">
                    ${icon("chart")}<span>Partida</span>
                </a>
            </article>
        `;
    }

    function compactLiveTitle(value) {
        const text = String(value || "").trim();
        if (!text) return "Partida en directo";
        const first = text.split(/\s+\/\s+/)[0]?.trim();
        return first || text;
    }

    function liveMatchRules(recording) {
        const type = String(recording?.gameType || "").toUpperCase();
        if (!type.includes("X01")) return "";
        const raw = recording?.x01Rules || {};
        const panels = Array.isArray(raw.infoPanels) ? raw.infoPanels : [];
        const text = `${raw.bullMode || ""} ${panels.join(" ")}`.toUpperCase();
        const bull = /50\s*\/\s*50/.test(text) ? "50/50" : "25/50";
        const start = raw.startScore || 501;
        return `${start} · BULL ${bull}`;
    }

    async function searchTournaments(query) {
        const results = container.querySelector("#tournament-results");
        if (!results) return;
        const value = query.trim();
        if (value.length < 2) {
            results.innerHTML = `<p class="small muted" style="margin:8px 0 0">Escribe al menos 2 caracteres para buscar torneos.</p>`;
            return;
        }

        results.innerHTML = `<p class="small muted" style="margin:8px 0 0">Buscando “${esc(value)}”…</p>`;
        try {
            const items = await api.tournamentSearch(value);
            if (!items.length) {
                results.innerHTML = `<p class="small muted" style="margin:8px 0 0">Sin torneos para “${esc(value)}”.</p>`;
                return;
            }
            results.innerHTML = items.slice(0, 10).map((item) => `
                <a class="autocomplete-item" href="#/directo/torneo/${item.id}">
                    <span>
                        <strong>${esc(item.name)}</strong>
                        <small style="display:block;margin-top:2px">${esc(item.type)} · #${esc(item.id)}</small>
                    </span>
                    <span class="section-link">Abrir ${icon("arrow")}</span>
                </a>
            `).join("");
        } catch (error) {
            results.innerHTML = `<p class="small muted" style="margin:8px 0 0">No se pudo buscar: ${esc(error.message)}</p>`;
        }
    }

    return () => {
        if (timer) clearInterval(timer);
        liveController?.abort();
    };
}

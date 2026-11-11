import { api } from "../api.js?v=77";
import { esc, icon, debounce } from "../ui.js?v=77";

export async function render(container) {
    let liveController = null;
    let timer = null;
    let recordingsByKey = new Map();

    container.innerHTML = shell();
    bindSearch();
    await Promise.all([loadLive(), loadRecordings()]);
    await loadLiveMatches();
    timer = setInterval(async () => {
        await loadRecordings();
        loadLive();
        loadLiveMatches();
    }, 30000);

    function shell() {
        return `
            <div class="page container live-page">
                <section class="live-hero live-hero-compact">
                    <div class="live-hero-main is-off" id="live-main">
                        <div class="live-hero-topline">
                            <span class="chip chip-soft" id="live-chip">Comprobando directo…</span>
                            <span class="live-hero-count"><strong id="live-count">—</strong> competiciones</span>
                        </div>
                        <h1>En directo</h1>
                        <p id="live-message">Comprobando si hay partidas en emisión.</p>
                        <div class="live-hero-actions">
                            <button class="btn btn-outline btn-sm" id="live-refresh">${icon("refresh")} Actualizar</button>
                            <a class="btn btn-ghost btn-sm" href="#/directo/finalizadas">${icon("list")} Finalizadas</a>
                        </div>
                    </div>
                </section>

                <section class="section live-section" id="live-matches-section" hidden>
                    <div class="section-head live-section-head">
                        <div class="section-head-left">
                            <h2 class="section-title">Partidas en directo</h2>
                        </div>
                        <span class="section-count" id="live-match-count"></span>
                    </div>
                    <div id="live-matches" class="live-match-list"></div>
                </section>

                <section class="section live-section" id="live-competitions-section" hidden>
                    <div class="section-head live-section-head">
                        <div class="section-head-left">
                            <h2 class="section-title">Competiciones en directo</h2>
                        </div>
                    </div>
                    <div id="live-competitions" class="live-comp-list"></div>
                </section>

                <section class="section live-section" id="recordings-section" hidden>
                    <div class="section-head live-section-head">
                        <div class="section-head-left">
                            <h2 class="section-title">Últimas finalizadas</h2>
                        </div>
                        <a class="section-link" href="#/directo/finalizadas">Ver todas ${icon("arrow")}</a>
                    </div>
                    <div id="recordings-list" class="live-recording-list"></div>
                </section>

                <section class="section live-section live-search-section">
                    <div class="section-head live-section-head">
                        <div class="section-head-left">
                            <h2 class="section-title">Buscar cuadrante</h2>
                        </div>
                    </div>

                    <div class="live-search-panel">
                        <div class="tournament-search">
                            <div class="search-field">
                                ${icon("search")}
                                <input class="form-control" id="tournament-search" type="search" placeholder="Torneo, liga, campeonato…" autocomplete="off" />
                            </div>
                            <button class="btn btn-primary btn-sm" id="tournament-search-button">${icon("search")} Buscar</button>
                        </div>
                        <div class="autocomplete-list" id="tournament-results"></div>
                    </div>
                </section>
            </div>
        `;
    }

    function bindSearch() {
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
            loadLive();
            loadLiveMatches();
        });
    }

    async function loadLive() {
        liveController?.abort();
        liveController = new AbortController();
        try {
            const live = await api.live(liveController.signal);
            const main = container.querySelector("#live-main");
            const chip = container.querySelector("#live-chip");
            const message = container.querySelector("#live-message");
            const count = container.querySelector("#live-count");
            const section = container.querySelector("#live-competitions-section");
            const list = container.querySelector("#live-competitions");

            if (!main) return;
            main.classList.toggle("is-off", !live.isLive);
            chip.className = `chip ${live.isLive ? "chip-live" : "chip-soft"}`;
            chip.textContent = live.isLive ? "En directo" : "Sin directo ahora";
            message.textContent = live.isLive
                ? `${live.message}. Abre el cuadrante para seguir los resultados.`
                : "No hay partidas en retransmisión en este momento. Puedes explorar los próximos torneos y abrir su cuadrante.";
            count.textContent = String(live.competitions?.length || 0);

            if (live.competitions?.length) {
                section.hidden = false;
                list.innerHTML = live.competitions.slice(0, 8).map((competition) => `
                    <a class="live-comp-row" href="#/directo/torneo/${competition.id}">
                        <span class="live-comp-dot" aria-hidden="true"></span>
                        <strong>${esc(competition.name || `Competición #${competition.id}`)}</strong>
                        <span class="live-comp-open">Abrir ${icon("arrow")}</span>
                    </a>
                `).join("");
            } else {
                section.hidden = true;
            }
        } catch (error) {
            if (error.name === "AbortError") return;
            const message = container.querySelector("#live-message");
            if (message) message.textContent = "No se pudo comprobar el estado del directo. Inténtalo de nuevo.";
        }
    }

    async function loadRecordings() {
        const section = container.querySelector("#recordings-section");
        const list = container.querySelector("#recordings-list");
        if (!section || !list) return;

        try {
            const data = await api.liveRecordings();
            const recordings = data?.items || [];
            recordingsByKey = new Map(recordings.map((recording) => [
                `${recording.competitionId}/${recording.matchId}/${recording.game}`,
                recording
            ]));

            if (!recordings.length) {
                section.hidden = true;
                return;
            }

            section.hidden = false;
            list.innerHTML = recordings.slice(0, 4).map(recordingRow).join("");
        } catch {
            section.hidden = true;
        }
    }

    function recordingRow(recording) {
        const players = recording.players?.length ? recording.players.join(" · ") : "Partida finalizada";
        return `
            <a class="live-recording-row ${recording.isMock ? "is-mock" : ""}"
               href="#/directo/finalizadas/${recording.competitionId}/${recording.matchId}/${recording.game}">
                <span class="live-recording-icon">${icon(recording.isFinished ? "check" : "play")}</span>
                <span class="live-recording-body">
                    <strong>${esc(recording.title || `Partida #${recording.matchId}`)}</strong>
                    <small>${esc(players)}</small>
                </span>
                <span class="live-recording-game">J${recording.game}</span>
                ${icon("arrow")}
            </a>
        `;
    }

    async function loadLiveMatches() {
        const section = container.querySelector("#live-matches-section");
        const list = container.querySelector("#live-matches");
        if (!section || !list) return;

        try {
            const data = await api.liveMatches();
            const matches = data?.matches || [];
            const visibleMatches = matches.slice(0, 6);
            const count = container.querySelector("#live-match-count");
            if (count) {
                count.textContent = matches.length
                    ? (visibleMatches.length === matches.length
                        ? `${matches.length} en juego`
                        : `${visibleMatches.length} de ${matches.length} en juego`)
                    : "";
            }
            if (!matches.length) {
                section.hidden = true;
                return;
            }

            section.hidden = false;
            list.innerHTML = visibleMatches.map((match) => {
                const key = `${match.competitionId}/${match.matchId}/${match.game}`;
                const recording = recordingsByKey.get(key);
                const title = recording?.title || match.title || `Partida #${match.matchId}`;
                const players = recording?.players?.length ? recording.players.join(" · ") : "";
                return `
                    <article class="live-match-card">
                        <div class="live-match-top">
                            <span class="chip chip-live">En directo</span>
                            <span class="live-match-game">J${match.game}</span>
                        </div>
                        <h3>${esc(title)}</h3>
                        ${players ? `<p class="live-match-players">${esc(players)}</p>` : ""}
                        <div class="live-match-actions">
                            <a class="btn btn-primary btn-sm" href="#/directo/finalizadas/${match.competitionId}/${match.matchId}/${match.game}">
                                ${icon("play")} Ver directo
                            </a>
                            <a class="btn btn-ghost btn-sm" href="#/directo/finalizadas/${match.competitionId}/${match.matchId}/${match.game}?tab=partida">
                                Partida ${icon("arrow")}
                            </a>
                        </div>
                    </article>
                `;
            }).join("");
        } catch {
            section.hidden = true;
            const count = container.querySelector("#live-match-count");
            if (count) count.textContent = "";
        }
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

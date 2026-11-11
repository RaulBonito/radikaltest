import { api } from "../api.js?v=79";
import {
    esc, icon, formatNumber, formatRelative, emptyState, toast
} from "../ui.js?v=78";
import {
    normalizeDarts, groupTurns, groupRounds, dartChip, dartboardSvg, playerColor, hitLabel
} from "../dartboard.js?v=78";

export async function render(container, params = []) {
    const competitionId = Number(params[0]);
    const matchId = Number(params[1]);
    const game = Number(params[2]);

    let recording = null;
    let activePlayer = null;
    let activeRound = null;
    let activeDart = 0;
    let timer = null;
    let destroyed = false;

    container.innerHTML = shell();
    container.querySelector("#report-back")?.addEventListener("click", () => {
        window.location.hash = "#/directo";
    });
    container.querySelector("#report-refresh")?.addEventListener("click", () => load(true));

    await load();

    async function load(showToast = false) {
        try {
            const next = await api.liveRecording(competitionId, matchId, game);
            if (destroyed) return;
            recording = next;
            draw();
            if (showToast) toast("Informe actualizado");
            scheduleRefresh();
        } catch (error) {
            if (destroyed) return;
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
            const content = container.querySelector("#report-content");
            if (!content) return;
            content.innerHTML = error.name === "ApiError" && error.status === 404
                ? emptyState("Partida finalizada no encontrada", "Todavía no hay dardos registrados para esta partida. La partida empieza automáticamente cuando está en directo.", "clock")
                : `
                    <div class="error-box">
                        <strong>No se pudo cargar el informe.</strong>
                        <p style="margin:6px 0 14px">${esc(error.message || "Radikal no ha respondido.")}</p>
                        <button class="btn btn-outline btn-sm" id="report-retry">Reintentar</button>
                    </div>
                `;
            content.querySelector("#report-retry")?.addEventListener("click", () => load());
        }
    }

    function scheduleRefresh() {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
        if (!recording || recording.isFinished) return;
        timer = setInterval(() => load(), 8000);
    }

    function explorerState() {
        const darts = normalizeDarts(recording?.darts || []);
        const players = collectPlayers(darts);
        const rounds = groupRounds(darts);
        if (activePlayer !== null && !players.some((player) => player.playerIndex === activePlayer)) {
            activePlayer = null;
        }
        if (activeRound !== null && !rounds.some((round) => round.round === activeRound)) {
            activeRound = null;
        }
        const filtered = darts.filter((dart) =>
            (activePlayer === null || Number(dart.playerIndex) === activePlayer) &&
            (activeRound === null || Number(dart.round) === activeRound)
        );
        return { darts, players, rounds, filtered };
    }

    function draw() {
        const content = container.querySelector("#report-content");
        if (!content) return;

        const state = explorerState();
        const { darts, players, rounds, filtered } = state;
        if (!filtered.length) activeDart = 0;
        else activeDart = Math.max(0, Math.min(activeDart, filtered.length - 1));

        const stats = computeStats(darts);
        const selectedStats = computeStats(filtered);
        const isMock = Boolean(recording.isMock);
        const finished = Boolean(recording.isFinished);
        const winner = recording.winner;
        const active = filtered[activeDart] || null;
        const activePlayerName = players.find((player) => player.playerIndex === activePlayer)?.name || "Todos";
        const roundLabel = activeRound === null ? "Todas" : `R${activeRound}`;

        content.innerHTML = `
            <div class="report-head">
                <div>
                    <span class="kicker">${icon("chart")}Informe avanzado</span>
                    <h1 class="report-title">${esc(displayTitle(recording.title) || `Partida #${matchId}`)}</h1>
                    <p class="section-sub">
                        Juego ${esc(recording.game)} · ${players.length} ${players.length === 1 ? "jugador" : "jugadores"} ·
                        ${stats.darts} dardos registrados · actualizado ${esc(formatRelative(recording.lastUpdatedAt))}
                    </p>
                </div>
                <div class="report-actions">
                    ${isMock
                        ? `<span class="chip chip-upcoming">Simulación</span>`
                        : finished
                            ? `<span class="chip chip-finished">Finalizada</span>`
                            : `<span class="chip chip-live">Partida en juego</span>`}
                    <button class="btn btn-outline btn-sm" id="report-refresh" type="button">${icon("refresh")} Actualizar</button>
                    <button class="btn btn-ghost btn-sm" id="report-back" type="button">${icon("arrowLeft")} En directo</button>
                </div>
            </div>

            ${isMock ? `
                <div class="report-demo-note">
                    ${icon("info")}
                    <span>Partida de ejemplo para previsualizar el informe. Los datos no pertenecen a ninguna partida real.</span>
                </div>
            ` : ""}

            <div class="report-summary">
                <div class="report-summary-item"><span>Dardos</span><strong>${stats.darts}</strong></div>
                <div class="report-summary-item"><span>Turnos</span><strong>${stats.turns}</strong></div>
                <div class="report-summary-item"><span>Puntos</span><strong>${formatNumber(stats.points)}</strong></div>
                <div class="report-summary-item"><span>Media/dardo</span><strong>${formatNumber(stats.averageDart)}</strong></div>
                <div class="report-summary-item"><span>Media/turno</span><strong>${formatNumber(stats.averageTurn)}</strong></div>
                <div class="report-summary-item"><span>Ganador</span><strong>${esc(winner || (finished ? "—" : "En juego"))}</strong></div>
            </div>

            ${darts.length ? `
                <div class="report-layout">
                    <section class="report-board-card">
                        <div class="report-card-head">
                            <div>
                                <span class="kicker">${icon("target")}Explorador de tiradas</span>
                                <h2>Diana interactiva</h2>
                            </div>
                            <span class="small muted" data-dart-count>${filtered.length} dardos visibles</span>
                        </div>

                        <div class="round-nav">
                            <div class="round-nav-controls">
                                <div class="round-nav-current">
                                    <span>Ronda</span>
                                    <strong>${esc(roundLabel)}</strong>
                                    <span class="round-nav-player">${esc(activePlayerName)}</span>
                                </div>
                                <div class="round-nav-actions">
                                    <button class="btn btn-ghost btn-sm" type="button" data-round-prev aria-label="Ronda anterior">${icon("chevronLeft")}</button>
                                    <button class="btn btn-ghost btn-sm" type="button" data-round-next aria-label="Ronda siguiente">${icon("chevronRight")}</button>
                                </div>
                            </div>
                            <div class="round-chips">
                                <button class="round-chip ${activeRound === null ? "is-active" : ""}" type="button" data-round="all">
                                    <strong>Todas</strong><small>${darts.length}</small>
                                </button>
                                ${rounds.map((round) => `
                                    <button class="round-chip ${activeRound === round.round ? "is-active" : ""}" type="button" data-round="${round.round}">
                                        <strong>R${round.round}</strong><small>${round.darts.length}</small>
                                    </button>
                                `).join("")}
                            </div>
                            <div class="round-nav-secondary">
                                <button class="recordings-tab ${activePlayer === null ? "is-active" : ""}" type="button" data-report-player="all">Todos</button>
                                ${players.map((player) => `
                                    <button class="recordings-tab ${activePlayer === player.playerIndex ? "is-active" : ""}" type="button" data-report-player="${player.playerIndex}">
                                        ${esc(player.name)}
                                    </button>
                                `).join("")}
                            </div>
                            <div class="board-scope-bar">
                                <span class="board-scope">${icon("target")} ${filtered.length} dardos · ${esc(activePlayerName)} · ${esc(roundLabel)}</span>
                                <button class="btn btn-ghost btn-sm" type="button" data-clear-filters>Ver todo</button>
                            </div>
                        </div>

                        <div class="report-board-wrap" data-report-board>
                            ${filtered.length
                                ? dartboardSvg(filtered, {
                                    highlightIndex: activeDart,
                                    trackable: true,
                                    showNumbers: true,
                                    label: "Diana interactiva de tiradas"
                                })
                                : `<div class="report-board-empty">${icon("target")} Sin tiradas para estos filtros.</div>`}
                        </div>

                        <div class="darts-legend">
                            ${players.map((player) => `<span><i class="legend-dot" style="background:${playerColor(player.playerIndex)}"></i>${esc(player.name)}</span>`).join("")}
                        </div>

                        ${active ? `
                            <div class="report-dart-detail" data-dart-detail>
                                ${dartDetailHtml(active)}
                            </div>
                            <div class="report-explorer-nav">
                                <button class="btn btn-outline btn-sm" type="button" data-dart-prev>${icon("chevronLeft")} Anterior</button>
                                <span class="report-explorer-pos" data-dart-pos>${activeDart + 1} / ${filtered.length}</span>
                                <button class="btn btn-outline btn-sm" type="button" data-dart-next>Siguiente ${icon("chevronRight")}</button>
                            </div>
                            <div class="report-throw-list" data-throw-list>
                                ${filtered.map((dart, index) => `
                                    <button class="report-throw ${index === activeDart ? "is-active" : ""}" type="button" data-dart-select="${index}"
                                            style="--player-color:${playerColor(dart.playerIndex)}">
                                        <span class="rt-round">R${dart.round}</span>
                                        <span class="rt-player"><i></i>${esc(dart.playerName || `Jugador ${dart.playerIndex + 1}`)}</span>
                                        <strong class="rt-hit">${esc(hitLabel(dart))}</strong>
                                        <span class="rt-score">${formatNumber(dart.score)}</span>
                                    </button>
                                `).join("")}
                            </div>
                            <p class="small muted report-filter-note">
                                ${formatNumber(selectedStats.averageDart)} media/dardo · ${selectedStats.triples} triples · ${selectedStats.bulls} bulls.
                            </p>
                        ` : ""}
                    </section>

                    <section class="report-turns-card">
                        <div class="report-card-head">
                            <div>
                                <span class="kicker">${icon("list")}Ronda a ronda</span>
                                <h2>Matriz de tiradas</h2>
                            </div>
                        </div>
                        <div class="report-matrix-wrap">
                            ${roundMatrix(darts, players, rounds)}
                        </div>
                    </section>
                </div>

                <section class="report-players-lower">
                    <div class="report-card-head">
                        <div>
                            <span class="kicker">${icon("users")}Jugadores</span>
                            <h2>Estadísticas por jugador</h2>
                        </div>
                    </div>
                    <div class="report-player-grid">
                        ${players.map((player) => playerCard(player, darts, winner)).join("")}
                    </div>
                </section>
            ` : emptyState(
                finished ? "Sin dardos registrados" : "Partida en juego",
                finished
                    ? "La partida terminó sin que se capturaran dardos. Radikal no expone el histórico de impactos de partidas antiguas."
                    : "En cuanto el primer jugador lance un dardo, aparecerá aquí el informe por ronda y jugador.",
                "target")}
        `;

        bindExplorer(state);
    }

    function bindExplorer(state) {
        const { players, rounds, filtered } = state;
        container.querySelector("[data-report-refresh]")?.addEventListener("click", () => load(true));
        container.querySelector("#report-refresh")?.addEventListener("click", () => load(true));
        container.querySelector("#report-back")?.addEventListener("click", () => { window.location.hash = "#/directo"; });

        container.querySelectorAll("[data-report-player]").forEach((button) => {
            button.addEventListener("click", () => {
                const value = button.dataset.reportPlayer;
                activePlayer = value === "all" ? null : Number(value);
                activeDart = 0;
                draw();
            });
        });

        container.querySelectorAll("[data-round]").forEach((button) => {
            button.addEventListener("click", () => {
                activeRound = button.dataset.round === "all" ? null : Number(button.dataset.round);
                activeDart = 0;
                draw();
            });
        });

        container.querySelector("[data-round-prev]")?.addEventListener("click", () => stepRound(-1, rounds));
        container.querySelector("[data-round-next]")?.addEventListener("click", () => stepRound(1, rounds));
        container.querySelector("[data-clear-filters]")?.addEventListener("click", () => {
            activePlayer = null;
            activeRound = null;
            activeDart = 0;
            draw();
        });

        container.querySelector("[data-dart-prev]")?.addEventListener("click", () => selectDart(activeDart - 1));
        container.querySelector("[data-dart-next]")?.addEventListener("click", () => selectDart(activeDart + 1));
        bindBoard();

        container.querySelectorAll("[data-dart-select]").forEach((button) => {
            button.addEventListener("click", () => selectDart(Number(button.dataset.dartSelect)));
        });

        container.querySelectorAll("[data-matrix-round][data-matrix-player]").forEach((cell) => {
            const selectCell = () => {
                activeRound = Number(cell.dataset.matrixRound);
                activePlayer = Number(cell.dataset.matrixPlayer);
                activeDart = 0;
                draw();
            };
            cell.addEventListener("click", selectCell);
            cell.addEventListener("keydown", (event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    selectCell();
                }
            });
        });
    }

    function bindBoard() {
        const board = container.querySelector("[data-report-board]");
        board?.querySelectorAll("[data-dart-index]").forEach((zone) => {
            zone.addEventListener("click", () => selectDart(Number(zone.dataset.dartIndex)));
            zone.addEventListener("keydown", (event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    selectDart(Number(zone.dataset.dartIndex));
                }
            });
        });
    }

    function selectDart(index) {
        const state = explorerState();
        const { filtered } = state;
        if (!filtered.length) return;
        activeDart = Math.max(0, Math.min(filtered.length - 1, Number(index) || 0));

        const board = container.querySelector("[data-report-board]");
        if (board) {
            board.innerHTML = dartboardSvg(filtered, {
                highlightIndex: activeDart,
                trackable: true,
                showNumbers: true,
                label: "Diana interactiva de tiradas"
            });
            bindBoard();
        }

        const active = filtered[activeDart];
        const detail = container.querySelector("[data-dart-detail]");
        if (detail) detail.innerHTML = dartDetailHtml(active);

        container.querySelectorAll("[data-dart-select]").forEach((button) => {
            button.classList.toggle("is-active", Number(button.dataset.dartSelect) === activeDart);
        });
        container.querySelectorAll("[data-dart-select]").forEach((button) => {
            if (Number(button.dataset.dartSelect) === activeDart) {
                button.scrollIntoView({ block: "nearest" });
            }
        });

        const pos = container.querySelector("[data-dart-pos]");
        if (pos) pos.textContent = `${activeDart + 1} / ${filtered.length}`;
        const count = container.querySelector("[data-dart-count]");
        if (count) count.textContent = `${filtered.length} dardos visibles`;
    }

    function stepRound(direction, rounds) {
        const values = rounds.map((round) => round.round);
        if (!values.length) return;
        const currentIndex = activeRound === null ? -1 : values.indexOf(activeRound);
        const nextIndex = currentIndex === -1
            ? (direction > 0 ? 0 : values.length - 1)
            : Math.max(0, Math.min(values.length - 1, currentIndex + direction));
        activeRound = values[nextIndex];
        activeDart = 0;
        draw();
    }

    function dartDetailHtml(dart) {
        return `
            <span class="report-dart-round">R${dart.round}</span>
            <span class="report-dart-player"><i style="background:${playerColor(dart.playerIndex)}"></i>${esc(dart.playerName || `Jugador ${dart.playerIndex + 1}`)}</span>
            <strong class="report-dart-hit">${esc(hitLabel(dart))}</strong>
            <span class="report-dart-score">${formatNumber(dart.score)} pts</span>
            <span class="report-dart-index">Dardo ${dart.dart} de la ronda</span>
        `;
    }

    function playerCard(player, darts, winner) {
        const stats = computeStats(darts.filter((dart) => Number(dart.playerIndex) === player.playerIndex));
        const isWinner = winner && String(winner).toLowerCase() === player.name.toLowerCase();
        return `
            <article class="report-player-card ${isWinner ? "is-winner" : ""}">
                <div class="report-player-head">
                    <span class="report-player-avatar">${esc(initials(player.name))}</span>
                    <div>
                        <span class="kicker">${icon("users")}Jugador ${player.playerIndex + 1}</span>
                        <h3>${esc(player.name)}</h3>
                    </div>
                    ${isWinner ? `<span class="chip chip-live">Ganador</span>` : ""}
                </div>
                <div class="report-player-stats">
                    <div><span>Dardos</span><strong>${stats.darts}</strong></div>
                    <div><span>Turnos</span><strong>${stats.turns}</strong></div>
                    <div><span>Puntos</span><strong>${formatNumber(stats.points)}</strong></div>
                    <div><span>Media/dardo</span><strong>${formatNumber(stats.averageDart)}</strong></div>
                    <div><span>Media/turno</span><strong>${formatNumber(stats.averageTurn)}</strong></div>
                    <div><span>Triples</span><strong>${stats.triples}</strong></div>
                    <div><span>Dobles</span><strong>${stats.doubles}</strong></div>
                    <div><span>Bulls</span><strong>${stats.bulls}</strong></div>
                    <div><span>Mejor turno</span><strong>${stats.bestTurn}</strong></div>
                    <div><span>180s</span><strong>${stats.oneEighties}</strong></div>
                </div>
            </article>
        `;
    }

    function roundMatrix(darts, players, rounds) {
        if (!darts.length) return "";
        const byCell = new Map();
        for (const dart of darts) {
            const key = `${dart.round}-${dart.playerIndex}`;
            if (!byCell.has(key)) byCell.set(key, []);
            byCell.get(key).push(dart);
        }

        const totals = new Map();
        for (const dart of darts) {
            totals.set(dart.playerIndex, (totals.get(dart.playerIndex) || 0) + dart.score);
        }

        return `
            <table class="report-matrix">
                <thead>
                    <tr>
                        <th>Ronda</th>
                        ${players.map((player) => `<th class="${activePlayer === player.playerIndex ? "is-active-player" : ""}">${esc(player.name)}</th>`).join("")}
                    </tr>
                </thead>
                <tbody>
                    ${rounds.map((round) => `
                        <tr class="${activeRound === round.round ? "is-active-round" : ""}">
                            <th>R${round.round}</th>
                            ${players.map((player) => {
                                const turn = (byCell.get(`${round.round}-${player.playerIndex}`) || []).sort((a, b) => a.dart - b.dart);
                                const total = turn.reduce((sum, dart) => sum + dart.score, 0);
                                const isActive = activeRound === round.round && activePlayer === player.playerIndex;
                                if (!turn.length) {
                                    return `<td class="report-matrix-cell"><span class="muted">—</span></td>`;
                                }
                                return `
                                    <td class="report-matrix-cell ${isActive ? "is-active-cell" : ""}"
                                        tabindex="0" role="button"
                                        data-matrix-round="${round.round}" data-matrix-player="${player.playerIndex}">
                                        <div class="matrix-darts">${turn.map(dartChip).join("")}</div>
                                        <span class="matrix-total">${total} pts</span>
                                    </td>
                                `;
                            }).join("")}
                        </tr>
                    `).join("")}
                </tbody>
                <tfoot>
                    <tr>
                        <th>Total</th>
                        ${players.map((player) => `<td><strong>${formatNumber(totals.get(player.playerIndex) || 0)} pts</strong></td>`).join("")}
                    </tr>
                </tfoot>
            </table>
        `;
    }

    return () => {
        destroyed = true;
        if (timer) clearInterval(timer);
    };
}

function shell() {
    return `
        <div class="page container report-page">
            <div id="report-content">
                <div class="report-head">
                    <div>
                        <span class="kicker">${icon("chart")}Informe avanzado</span>
                        <h1 class="report-title">Cargando informe...</h1>
                    </div>
                </div>
                <div class="skeleton" style="height:420px;border-radius:20px"></div>
            </div>
        </div>
    `;
}

function displayTitle(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    const first = text.split(/\s+\/\s+/)[0]?.trim();
    return first || text;
}

function collectPlayers(darts) {
    const map = new Map();
    for (const dart of darts) {
        const index = Number(dart.playerIndex);
        if (!map.has(index)) {
            map.set(index, {
                playerIndex: index,
                name: dart.playerName || `Jugador ${index + 1}`
            });
        }
    }
    return [...map.values()].sort((a, b) => a.playerIndex - b.playerIndex);
}

function computeStats(darts) {
    const turns = groupTurns(darts);
    const points = darts.reduce((sum, dart) => sum + (Number(dart.score) || 0), 0);
    const turnScores = turns.map((turn) => turn.darts.reduce((sum, dart) => sum + (Number(dart.score) || 0), 0));
    return {
        darts: darts.length,
        turns: turns.length,
        points,
        averageDart: darts.length ? points / darts.length : 0,
        averageTurn: turns.length ? points / turns.length : 0,
        triples: darts.filter((dart) => dart.multiplier === 3).length,
        doubles: darts.filter((dart) => dart.multiplier === 2).length,
        bulls: darts.filter((dart) => dart.sector === 0 || dart.sector === 25 || /BULL/i.test(dart.hitRegion || "")).length,
        bestTurn: turnScores.length ? Math.max(...turnScores) : 0,
        oneEighties: turnScores.filter((score) => score === 180).length
    };
}

function initials(name) {
    return String(name || "?")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((word) => word[0] || "")
        .join("")
        .toUpperCase() || "?";
}

import { api } from "../api.js?v=77";
import {
    esc, icon, formatNumber, formatRelative, formatDate, emptyState, downloadCsv, toast
} from "../ui.js?v=77";
import {
    normalizeDarts, groupTurns, dartChip, cleanHitLabel, dartboardSvg, playerColor
} from "../dartboard.js?v=77";

export async function render(container, params = []) {
    const competitionId = Number(params[0]);
    const matchId = Number(params[1]);
    const game = Number(params[2]);

    let recording = null;
    let activePlayer = null;
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
                ? emptyState("Partida finalizada no encontrada", "Todavía no hay dardos registrados para esta partida. La partida empieza automáticamente cuando la partida está en directo.", "clock")
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

    function draw() {
        const content = container.querySelector("#report-content");
        if (!content) return;

        const darts = normalizeDarts(recording.darts || []);
        const players = collectPlayers(darts);
        const selected = activePlayer === null ? darts : darts.filter((dart) => Number(dart.playerIndex) === activePlayer);
        const stats = computeStats(darts);
        const selectedStats = computeStats(selected);
        const isMock = Boolean(recording.isMock);
        const finished = Boolean(recording.isFinished);
        const winner = recording.winner;

        content.innerHTML = `
            <div class="report-head">
                <div>
                    <span class="kicker">${icon("chart")}Informe avanzado</span>
                    <h1 class="report-title">${esc(recording.title || `Partida #${matchId}`)}</h1>
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

            ${stats.darts ? `
                <div class="report-player-grid">
                    ${players.map((player) => playerCard(player, darts, winner)).join("")}
                </div>

                <div class="report-layout">
                    <section class="report-board-card">
                        <div class="report-card-head">
                            <div>
                                <span class="kicker">${icon("target")}Mapa de impactos</span>
                                <h2>Dónde han caído</h2>
                            </div>
                            <span class="small muted">${selected.length} dardos</span>
                        </div>
                        <div class="report-tabs" role="tablist" aria-label="Filtrar diana por jugador">
                            <button class="report-tab ${activePlayer === null ? "active" : ""}" data-report-player="all" type="button">Todos</button>
                            ${players.map((player) => `
                                <button class="report-tab ${activePlayer === player.playerIndex ? "active" : ""}" data-report-player="${player.playerIndex}" type="button">
                                    ${esc(player.name)}
                                </button>
                            `).join("")}
                        </div>
                        <div class="report-board-wrap">
                            ${dartboardSvg(selected)}
                        </div>
                        <div class="darts-legend">
                            ${players.map((player) => `<span><i class="legend-dot" style="background:${playerColor(player.playerIndex)}"></i>${esc(player.name)}</span>`).join("")}
                        </div>
                        ${activePlayer !== null ? `
                            <p class="small muted report-filter-note">
                                Mostrando ${esc(players.find((player) => player.playerIndex === activePlayer)?.name || "jugador")}:
                                ${formatNumber(selectedStats.averageDart)} media/dardo · ${selectedStats.triples} triples · ${selectedStats.bulls} bulls.
                            </p>
                        ` : ""}
                    </section>

                    <section class="report-turns-card">
                        <div class="report-card-head">
                            <div>
                                <span class="kicker">${icon("list")}Tiradas por ronda</span>
                                <h2>Ronda a ronda</h2>
                            </div>
                            <button class="btn btn-outline btn-sm" id="report-csv" type="button">${icon("download")} CSV</button>
                        </div>
                        <div class="report-matrix-wrap">
                            ${roundMatrix(darts, players)}
                        </div>
                    </section>
                </div>
            ` : emptyState(
                finished ? "Sin dardos registrados" : "Partida en juego",
                finished
                    ? "La partida terminó sin que se capturaran dardos. Radikal no expone el histórico de impactos de partidas antiguas."
                    : "En cuanto el primer jugador lance un dardo, aparecerá aquí el informe por ronda y jugador.",
                "target")}
        `;

        content.querySelectorAll("[data-report-player]").forEach((button) => {
            button.addEventListener("click", () => {
                const value = button.dataset.reportPlayer;
                activePlayer = value === "all" ? null : Number(value);
                draw();
            });
        });

        content.querySelector("#report-csv")?.addEventListener("click", () => exportCsv(darts, players));
        content.querySelector("#report-refresh")?.addEventListener("click", () => load(true));
        content.querySelector("#report-back")?.addEventListener("click", () => { window.location.hash = "#/directo"; });
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

    function roundMatrix(darts, players) {
        if (!darts.length) return "";
        const rounds = [...new Set(darts.map((dart) => Number(dart.round)))].sort((a, b) => a - b);
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
                        ${players.map((player) => `<th>${esc(player.name)}</th>`).join("")}
                    </tr>
                </thead>
                <tbody>
                    ${rounds.map((round) => `
                        <tr>
                            <th>R${round}</th>
                            ${players.map((player) => {
                                const turn = (byCell.get(`${round}-${player.playerIndex}`) || []).sort((a, b) => a.dart - b.dart);
                                const total = turn.reduce((sum, dart) => sum + dart.score, 0);
                                return `
                                    <td>
                                        ${turn.length ? `
                                            <div class="matrix-darts">${turn.map(dartChip).join("")}</div>
                                            <span class="matrix-total">${total} pts</span>
                                        ` : `<span class="muted">—</span>`}
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

    function exportCsv(darts, players) {
        const rounds = [...new Set(darts.map((dart) => Number(dart.round)))].sort((a, b) => a - b);
        const byCell = new Map();
        for (const dart of darts) {
            const key = `${dart.round}-${dart.playerIndex}`;
            if (!byCell.has(key)) byCell.set(key, []);
            byCell.get(key).push(dart);
        }

        const rows = [["Ronda", ...players.flatMap((player) => [`${player.name} dardos`, `${player.name} total`])]];
        for (const round of rounds) {
            const row = [`R${round}`];
            for (const player of players) {
                const turn = (byCell.get(`${round}-${player.playerIndex}`) || []).sort((a, b) => a.dart - b.dart);
                row.push(turn.map(cleanHitLabel).join(" · ") || "—");
                row.push(turn.reduce((sum, dart) => sum + dart.score, 0));
            }
            rows.push(row);
        }

        const totals = players.map((player) => darts
            .filter((dart) => Number(dart.playerIndex) === player.playerIndex)
            .reduce((sum, dart) => sum + dart.score, 0));
        rows.push(["Total", ...players.flatMap((_, index) => ["", totals[index]])]);
        downloadCsv(`radikal-informe-${competitionId}-${matchId}-j${game}.csv`, rows);
        toast("CSV descargado", "success");
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

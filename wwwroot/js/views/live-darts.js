import { api } from "../api.js?v=79";
import { esc, icon, formatRelative, emptyState } from "../ui.js?v=78";
import {
    boardSvg,
    hitKind,
    hitLabel,
    KIND_LABELS,
    normalizeDart,
    playerColor
} from "../dartboard.js?v=78";

export async function render(container, params = []) {
    const isDemo = params.length === 0;
    const competitionId = Number(params[0]);
    const matchId = Number(params[1]);
    const game = Number(params[2]);

    let data = null;
    let dataKey = "";
    let timer = null;
    let destroyed = false;
    let selectedDart = null;
    let selectedPlayer = "all";

    container.innerHTML = shell(isDemo, competitionId, matchId, game);
    container.querySelector("#darts-back")?.addEventListener("click", () => {
        window.location.hash = "#/directo";
    });
    container.querySelector("#darts-refresh")?.addEventListener("click", () => refresh());

    if (isDemo) {
        data = demoData();
        draw(data, true);
    } else {
        await refresh();
        timer = setInterval(refresh, 5000);
    }

    async function refresh() {
        if (isDemo || destroyed) return;
        try {
            const next = await api.liveDarts(competitionId, matchId, game);
            if (destroyed) return;

            const key = `${next?.isFinished}:${(next?.darts || []).map((dart) => `${dart.round}-${dart.playerIndex}-${dart.dart}-${dart.hitRegion}`).join("|")}`;
            if (data && key === dataKey) {
                data = next;
                return;
            }

            data = next;
            dataKey = key;
            draw(next, false);

            if (next?.isFinished && timer) {
                clearInterval(timer);
                timer = null;
            }
        } catch (error) {
            if (!data) {
                const content = container.querySelector("#darts-content");
                if (content) {
                    content.innerHTML = `
                        <div class="error-box">
                            <strong>No se pudo leer el directo de esta partida.</strong>
                            <p style="margin:6px 0 14px">${esc(error.message || "Radikal no ha respondido.")}</p>
                            <button class="btn btn-outline btn-sm" id="darts-retry">Reintentar</button>
                        </div>
                    `;
                    content.querySelector("#darts-retry")?.addEventListener("click", refresh);
                }
            }
        }
    }

    function draw(next, demo) {
        const content = container.querySelector("#darts-content");
        if (!content) return;

        const previousTurns = content.querySelector(".darts-turns");
        const previousScroll = previousTurns?.scrollTop || 0;
        const wasNearBottom = previousTurns
            ? previousTurns.scrollHeight - previousTurns.scrollTop - previousTurns.clientHeight < 24
            : false;

        const darts = (next?.darts || []).map(normalizeDart);
        const turns = groupTurns(darts);
        const finished = Boolean(next?.isFinished);
        const players = uniquePlayers(darts);
        const triples = darts.filter((dart) => hitKind(dart) === "triple").length;
        const bulls = darts.filter((dart) => hitKind(dart) === "dbull" || hitKind(dart) === "sbull").length;
        const best = darts.reduce((winner, dart) => (dart.score > (winner?.score || 0) ? dart : winner), null);
        const recordedHref = `#/directo/finalizadas/${competitionId}/${matchId}/${game}`;

        content.innerHTML = `
            <div class="darts-page-head">
                <div>
                    <span class="kicker">${icon("play")}Radikal Live</span>
                    <h1 class="darts-title">Mapa de <span class="accent">dardos</span></h1>
                    <p class="section-sub">
                        ${demo
                            ? "Vista previa con dardos de ejemplo. Con una partida en directo, este mapa se rellena con los impactos reales de Radikal."
                            : "Cada punto es un dardo real de la partida. Se graba dardo a dardo, así que cuando termine podrás abrir el histórico completo."}
                    </p>
                </div>
                <div class="darts-actions">
                    ${demo
                        ? `<span class="chip chip-upcoming">Vista previa</span>`
                        : finished
                            ? `<span class="chip chip-finished">Partida finalizada</span>`
                            : `<span class="chip chip-live">En directo</span>`}
                    <button class="btn btn-outline btn-sm" id="darts-refresh" type="button">${icon("refresh")} Actualizar</button>
                    ${demo
                        ? `<a class="btn btn-ghost btn-sm" href="#/directo/finalizadas">${icon("list")} Finalizadas</a>`
                        : `<a class="btn btn-primary btn-sm" href="${recordedHref}">${icon("list")} Avanzado</a>`}
                    <button class="btn btn-ghost btn-sm" id="darts-back" type="button">${icon("arrowLeft")} En directo</button>
                </div>
            </div>

            ${demo ? `
                <div class="darts-demo-note">
                    ${icon("info")}
                    <span>Estos dardos son de ejemplo para que puedas ver el mapa y el detalle por turnos. No son datos de tu cuenta.</span>
                </div>
            ` : ""}

            <div class="darts-stats">
                <div class="darts-stat"><strong>${darts.length}</strong><span>Dardos</span></div>
                <div class="darts-stat"><strong>${triples}</strong><span>Triples</span></div>
                <div class="darts-stat"><strong>${bulls}</strong><span>Bulls</span></div>
                <div class="darts-stat"><strong>${best ? esc(hitLabel(best)) : "—"}</strong><span>Mejor impacto</span></div>
            </div>

            <div class="darts-layout">
                <section class="darts-board-card">
                    <div class="darts-board-head">
                        <div>
                            <span class="kicker">${icon("target")}Diana</span>
                            <h2>Dónde han caído</h2>
                        </div>
                        <span class="small muted">${darts.length ? `Actualizado ${esc(formatRelative(next?.fetchedAt))}` : "Sin dardos todavía"}</span>
                    </div>

                    ${players.length > 1 ? `
                        <div class="darts-players-filter">
                            <button class="player-filter is-active" type="button" data-player="all">
                                <i style="background:#0a7ea4"></i> Todos
                            </button>
                            ${players.map((player) => `
                                <button class="player-filter" type="button" data-player="${esc(player.playerIndex)}">
                                    <i style="background:${playerColor(player.playerIndex)}"></i> ${esc(player.name)}
                                </button>
                            `).join("")}
                        </div>
                    ` : ""}

                    <div class="darts-board-wrap">
                        ${dartboard(darts, players)}
                    </div>
                    <div class="darts-legend">
                        ${players.length
                            ? players.map((player) => `<span><i class="legend-dot" style="background:${playerColor(player.playerIndex)}"></i>${esc(player.name)}</span>`).join("")
                            : `<span><i class="legend-dot single"></i>Impactos</span>`}
                        <span><i class="legend-dot" style="background:#94a3b8"></i>Fuera</span>
                    </div>
                    ${selectedDart === null ? "" : dartReadout(darts[selectedDart], selectedDart)}
                </section>

                <section class="darts-turns-card">
                    <div class="darts-board-head">
                        <div>
                            <span class="kicker">${icon("list")}Turno a turno</span>
                            <h2>Detalle por turno</h2>
                        </div>
                        <span class="small muted">${turns.length} turnos</span>
                    </div>
                    ${turns.length
                        ? `<div class="darts-turns">${turns.map(turnCard).join("")}</div>`
                        : dartsEmptyState(finished, next?.winner)}
                </section>
            </div>
        `;

        const nextTurns = content.querySelector(".darts-turns");
        if (nextTurns) {
            nextTurns.scrollTop = wasNearBottom
                ? nextTurns.scrollHeight
                : Math.min(previousScroll, Math.max(0, nextTurns.scrollHeight - nextTurns.clientHeight));
        }

        content.querySelector("#darts-refresh")?.addEventListener("click", () => refresh());
        content.querySelector("#darts-back")?.addEventListener("click", () => { window.location.hash = "#/directo"; });

        content.querySelectorAll(".player-filter").forEach((button) => {
            button.addEventListener("click", () => {
                selectedPlayer = button.dataset.player;
                selectedDart = null;
                draw(data, demo);
            });
        });

        const selectDart = (index) => {
            selectedDart = index;
            draw(data, demo);
        };

        content.querySelectorAll("[data-dart-index]").forEach((node) => {
            node.addEventListener("click", () => selectDart(Number(node.dataset.dartIndex)));
            node.addEventListener("keydown", (event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    selectDart(Number(node.dataset.dartIndex));
                }
            });
        });

        content.querySelectorAll("[data-turn-dart]").forEach((node) => {
            node.addEventListener("click", () => selectDart(Number(node.dataset.turnDart)));
        });

        content.querySelector("#dart-close")?.addEventListener("click", () => {
            selectedDart = null;
            draw(data, demo);
        });
    }

    function dartboard(darts, players) {
        const visible = selectedPlayer === "all"
            ? darts
            : darts.filter((dart) => String(dart.playerIndex) === String(selectedPlayer));

        if (!visible.length) {
            return `<div class="recording-board-empty">${icon("target")}<p>En cuanto caiga el primer dardo aparecerá en la diana.</p></div>`;
        }

        // Solo se pintan los dardos del jugador filtrado; los OUT no tienen zona y no se dibujan.
        const marks = visible.map((dart) => {
            const index = darts.indexOf(dart);
            return {
                index,
                dart,
                color: playerColor(dart.playerIndex),
                highlight: selectedDart === index,
                title: `Ronda ${dart.round} · ${dart.playerName || `Jugador ${dart.playerIndex + 1}`} · ${hitLabel(dart)} (${dart.score} pts)`
            };
        });

        return boardSvg(marks, {
            trackable: true,
            pulse: true,
            label: "Diana en directo con las zonas golpeadas en la partida"
        });
    }

    function dartReadout(dart, index) {
        if (!dart) return "";
        const kind = hitKind(dart);
        return `
            <div class="recording-readout" style="--player-color:${playerColor(dart.playerIndex)}">
                <div class="recording-readout-head">
                    <span class="chip chip-type">Dardo #${index + 1}</span>
                    <span class="small muted">Ronda ${esc(dart.round)} · tirada ${esc(dart.dart)}</span>
                    <button class="icon-btn" id="dart-close" type="button" aria-label="Cerrar detalle">${icon("close")}</button>
                </div>
                <div class="recording-readout-body">
                    <div class="recording-readout-hit">
                        <strong style="color:${playerColor(dart.playerIndex)}">${esc(hitLabel(dart))}</strong>
                        <span>${dart.score} pts</span>
                    </div>
                    <ul class="recording-readout-meta">
                        <li><span>Jugador</span><strong>${esc(dart.playerName || `Jugador ${dart.playerIndex + 1}`)}</strong></li>
                        <li><span>Zona</span><strong>${esc(KIND_LABELS[kind] || "—")}${dart.sector ? ` · sector ${dart.sector}` : ""}</strong></li>
                    </ul>
                </div>
            </div>
        `;
    }

    function dartsEmptyState(finished, winner) {
        if (finished) {
            return emptyState(
                winner ? `Ganador: ${winner}` : "Partida finalizada",
                "Radikal ya no expone los dardos al terminar. Si esta partida se registró mientras estaba en directo, abre su histórico para ver la diana completa.",
                "target");
        }
        return emptyState("Esperando el primer dardo", "El mapa se actualizará automáticamente en cuanto el jugador lance el primer dardo.", "clock");
    }

    return () => {
        destroyed = true;
        if (timer) clearInterval(timer);
    };
}

function shell(isDemo, competitionId, matchId, game) {
    return `
        <div class="page container darts-page">
            <div id="darts-content">
                <div class="darts-page-head">
                    <div>
                        <span class="kicker">${icon("play")}Radikal Live</span>
                        <h1 class="darts-title">Mapa de <span class="accent">dardos</span></h1>
                        <p class="section-sub">${isDemo ? "Vista previa del mapa de impactos." : `Partida #${matchId} · juego ${game} · competición #${competitionId}`}</p>
                    </div>
                </div>
                <div class="skeleton" style="height:420px;border-radius:20px"></div>
            </div>
        </div>
    `;
}

function uniquePlayers(darts) {
    const players = new Map();
    for (const dart of darts) {
        if (players.has(dart.playerIndex)) continue;
        players.set(dart.playerIndex, {
            playerIndex: dart.playerIndex,
            name: dart.playerName || `Jugador ${dart.playerIndex + 1}`
        });
    }
    return [...players.values()].sort((a, b) => a.playerIndex - b.playerIndex);
}

function groupTurns(darts) {
    const turns = [];
    const index = new Map();

    darts.forEach((dart, dartIndex) => {
        const key = `${dart.round}-${dart.playerIndex}`;
        let turn = index.get(key);
        if (!turn) {
            turn = {
                key,
                round: dart.round,
                playerIndex: dart.playerIndex,
                player: dart.playerName || `Jugador ${dart.playerIndex + 1}`,
                darts: []
            };
            index.set(key, turn);
            turns.push(turn);
        }
        turn.darts.push({ ...dart, index: dartIndex });
    });

    return turns;
}

function turnCard(turn) {
    return `
        <article class="dart-turn">
            <div class="dart-turn-head">
                <span class="dart-turn-player">
                    <i class="legend-dot" style="display:inline-block;background:${playerColor(turn.playerIndex)}"></i>
                    ${esc(turn.player)}
                </span>
                <span class="dart-turn-round">Ronda ${esc(turn.round)}</span>
            </div>
            <div class="dart-turn-darts">
                ${turn.darts.map(dartChip).join("")}
            </div>
            <strong class="dart-turn-score">${turn.darts.reduce((total, dart) => total + dart.score, 0)} pts</strong>
        </article>
    `;
}

function dartChip(dart) {
    const kind = hitKind(dart);
    return `
        <button class="dart-chip is-${kind}" type="button" data-turn-dart="${dart.index}"
                title="Ronda ${dart.round} · dardo ${dart.dart} · ${esc(KIND_LABELS[kind] || "")}">
            <strong>${esc(hitLabel(dart))}</strong>
            <small>${dart.score} pts</small>
        </button>
    `;
}

function demoData() {
    const turns = [
        [["T20", 20, 3], ["S20", 20, 1], ["D16", 16, 2]],
        [["T19", 19, 3], ["S19", 19, 1], ["D20", 20, 2]],
        [["T18", 18, 3], ["S18", 18, 1], ["D10", 10, 2]],
        [["T20", 20, 3], ["S1", 1, 1], ["D20", 20, 2]],
        [["S5", 5, 1], ["T20", 20, 3], ["D16", 16, 2]],
        [["T19", 19, 3], ["S19", 19, 1], ["DBULL", 0, 2]],
        [["SBULL", 0, 1], ["S20", 20, 1], ["D20", 20, 2]],
        [["T20", 20, 3], ["S20", 20, 1], ["D16", 16, 2]]
    ];

    const darts = [];
    turns.forEach((turn, turnIndex) => {
        const playerIndex = turnIndex % 2;
        const playerName = playerIndex === 0 ? "Tú" : "Rival";
        turn.forEach(([hitRegion, sector, multiplier], dartIndex) => {
            darts.push({
                round: Math.floor(turnIndex / 2) + 1,
                playerIndex,
                playerName,
                dart: dartIndex + 1,
                hitRegion,
                multiplier,
                sector,
                score: scoreFor(sector, multiplier)
            });
        });
    });

    return {
        competitionId: 0,
        matchId: 0,
        game: 1,
        gameType: "X01",
        isFinished: false,
        winner: null,
        darts,
        fetchedAt: new Date().toISOString()
    };
}

function scoreFor(sector, multiplier) {
    if (sector === 0 || sector === 25) return multiplier === 2 ? 50 : 25;
    return sector * multiplier;
}

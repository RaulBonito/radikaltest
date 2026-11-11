import { api } from "../api.js?v=77";
import { esc, icon, formatRelative, formatDate, emptyState, formatNumber, toast } from "../ui.js?v=77";
import {
    boardSvg,
    dartRegion,
    groupRounds,
    hitKind,
    hitLabel,
    KIND_LABELS,
    normalizeDart,
    playerColor,
    summarizeDarts
} from "../dartboard.js?v=77";

const PLAYBACK_SPEEDS = [1, 2, 4];
const PLAYBACK_BASE_MS = 1100;

export async function render(container, params = []) {
    const competitionId = Number(params[0]);
    const matchId = Number(params[1]);
    const game = Number(params[2]);

    let destroyed = false;
    let timer = null;
    let recording = null;

    // Modo de exploración de la diana: "all" = todos los dardos, número = esa ronda.
    let roundView = "all";
    let selectedDart = null;
    let selectedPlayer = "all";
    let playing = false;
    let playSpeed = 1;
    let playTimer = null;
    let hasPainted = false;

    container.innerHTML = `
        <div class="page container darts-page recording-detail">
            <div class="darts-page-head">
                <div>
                    <span class="kicker">${icon("play")}Partida finalizada</span>
                    <h1 class="darts-title">Cargando <span class="accent">histórico</span></h1>
                </div>
                <a class="btn btn-ghost btn-sm" href="#/directo/finalizadas">${icon("arrowLeft")} Finalizadas</a>
            </div>
            <div class="skeleton" style="height:460px;border-radius:20px"></div>
        </div>
    `;

    await load();

    return () => {
        destroyed = true;
        if (timer) clearInterval(timer);
        stopPlayback(false);
    };

    async function load() {
        try {
            const data = await api.liveRecording(competitionId, matchId, game);
            if (destroyed) return;
            recording = data;
            paint();

            if (!data?.isFinished && !data?.isMock) {
                timer = setInterval(refreshLive, 8000);
            }
        } catch (error) {
            if (destroyed) return;
            const isMissing = error.status === 404;
            container.innerHTML = `
                <div class="page container darts-page">
                    <div class="darts-page-head">
                        <div>
                            <span class="kicker">${icon("play")}Partida finalizada</span>
                            <h1 class="darts-title">Histórico <span class="accent">no disponible</span></h1>
                        </div>
                        <a class="btn btn-ghost btn-sm" href="#/directo/finalizadas">${icon("arrowLeft")} Finalizadas</a>
                    </div>
                    <div class="error-box">
                        <strong>${isMissing ? "Esta partida no está registrada." : "No se pudo abrir la partida."}</strong>
                        <p style="margin:6px 0 14px">
                            ${esc(isMissing
                                ? "Solo se pueden abrir partidas que se capturaron mientras estaban en directo."
                                : (error.message || "Error inesperado"))}
                        </p>
                        <a class="btn btn-outline btn-sm" href="#/directo/finalizadas">Ver finalizadas</a>
                    </div>
                </div>
            `;
        }
    }

    async function refreshLive() {
        if (destroyed) return;
        try {
            await api.recordingSync(competitionId, matchId, game);
            const next = await api.liveRecording(competitionId, matchId, game);
            if (destroyed) return;
            if (!next) return;

            const changed = next.totalDarts !== recording?.totalDarts || next.isFinished !== recording?.isFinished;
            recording = next;
            if (changed) paint();
            if (next.isFinished) {
                clearInterval(timer);
                timer = null;
            }
        } catch {
            // silencioso: seguimos con lo que ya tenemos grabado
        }
    }

    function paint() {
        const darts = (recording.darts || []).map(normalizeDart);
        const players = recording.playerStats?.length
            ? recording.playerStats
            : (recording.players || []).map((name, index) => ({ playerIndex: index, name }));

        const turns = groupTurns(darts);
        const rounds = groupRounds(darts);
        const totalScore = recording.totalScore ?? darts.reduce((total, dart) => total + dart.score, 0);
        const hits = darts.filter((dart) => dart.score > 0).length;
        const activeRound = getActiveRound(rounds);

        // Si la ronda seleccionada ha desaparecido (p. ej. se borró la partida) volvemos a "todas".
        if (roundView !== "all" && !activeRound) roundView = "all";
        const visibleDarts = activeRound ? activeRound.darts : darts;
        const boardStats = summarizeDarts(activeRound ? activeRound.darts : darts);
        const marks = buildMarks(darts, activeRound, players);

        container.innerHTML = `
            <div class="page container darts-page recording-detail">
                <div class="darts-page-head">
                    <div>
                        <span class="kicker">${icon("play")}${recording.isMock ? "Partida de ejemplo" : "Partida finalizada · Radikal Live"}</span>
                        <h1 class="darts-title">${esc(recording.title || `Partida #${matchId}`)}</h1>
                        <p class="section-sub">
                            Competición #${esc(competitionId)} · Partida #${esc(matchId)} · Juego ${esc(game)}
                            · Registrada ${esc(formatDate(recording.firstSeenAt, true))}
                        </p>
                    </div>
                    <div class="darts-actions">
                        ${recording.isFinished
                            ? `<span class="chip chip-finished">Finalizada</span>`
                            : `<span class="chip chip-live">En juego</span>`}
                        ${recording.gameType ? `<span class="chip chip-type">${esc(recording.gameType)}</span>` : ""}
                        <button class="btn btn-outline btn-sm" id="recording-refresh" type="button">${icon("refresh")} Sincronizar</button>
                        <a class="btn btn-outline btn-sm" href="#/directo/partidas/${competitionId}/${matchId}/${game}/avanzado">${icon("list")} Avanzado</a>
                        <a class="btn btn-outline btn-sm" href="${esc(api.recordingCsvUrl(competitionId, matchId, game))}" download>${icon("download")} CSV</a>
                        <a class="btn btn-ghost btn-sm" href="#/directo/finalizadas">${icon("arrowLeft")} Finalizadas</a>
                        ${!recording.isMock
                            ? `<button class="btn btn-ghost btn-sm" id="recording-delete" type="button">${icon("trash")} Borrar</button>`
                            : ""}
                    </div>
                </div>

                ${recording.isMock ? `
                    <div class="darts-demo-note">
                        ${icon("info")}
                        <span>Esta es una partida de ejemplo para que veas cómo queda el histórico completo. Las partidas reales se graban solas mientras están en directo.</span>
                    </div>
                ` : ""}

                ${recording.isFinished && recording.winner
                    ? `<div class="recording-banner">${icon("crown")} Ganador: <strong>${esc(recording.winner)}</strong></div>`
                    : ""}

                <div class="darts-stats">
                    <div class="darts-stat"><strong>${formatNumber(darts.length)}</strong><span>Dardos registrados</span></div>
                    <div class="darts-stat"><strong>${formatNumber(rounds.length)}</strong><span>Rondas</span></div>
                    <div class="darts-stat"><strong>${formatNumber(totalScore)}</strong><span>Puntos totales</span></div>
                    <div class="darts-stat"><strong>${hits ? Math.round((totalScore / hits) * 100) / 100 : "—"}</strong><span>Media por acierto</span></div>
                </div>

                <div class="recording-players-grid">
                    ${players.map((player) => playerCard(player, players, darts)).join("")}
                </div>

                <div class="darts-layout recording-layout">
                    <section class="darts-board-card">
                        <div class="darts-board-head">
                            <div>
                                <span class="kicker">${icon("target")}Diana de la partida</span>
                                <h2>${activeRound ? `Ronda ${esc(activeRound.round)}` : "Todos los dardos"}</h2>
                            </div>
                            <span class="small muted">
                                ${activeRound
                                    ? `${activeRound.darts.length} dardos · ${formatNumber(activeRound.score)} pts`
                                    : `${darts.length} impactos`}
                            </span>
                        </div>

                        ${roundNavigator(rounds, activeRound, players)}

                        ${players.length > 1 ? `
                            <div class="darts-players-filter" id="recording-filter">
                                <button class="player-filter ${selectedPlayer === "all" ? "is-active" : ""}" type="button" data-player="all">
                                    <i style="background:#0a7ea4"></i> Todos
                                </button>
                                ${players.map((player) => `
                                    <button class="player-filter ${String(selectedPlayer) === String(player.playerIndex) ? "is-active" : ""}"
                                            type="button" data-player="${esc(player.playerIndex)}">
                                        <i style="background:${playerColor(player.playerIndex)}"></i> ${esc(player.name)}
                                    </button>
                                `).join("")}
                            </div>
                        ` : ""}

                        ${(activeRound || selectedPlayer !== "all")
                            ? `<div class="board-scope-bar">
                                <span class="board-scope">
                                    ${icon("target")}
                                    ${activeRound ? `Ronda ${esc(activeRound.round)}` : "Toda la partida"}
                                    ${selectedPlayer !== "all"
                                        ? ` · ${esc(players.find((player) => String(player.playerIndex) === String(selectedPlayer))?.name || "jugador")}`
                                        : ""}
                                    · ${visibleCount(activeRound, darts, selectedPlayer)} dardos
                                </span>
                                <button class="btn btn-ghost btn-sm" id="board-reset" type="button">
                                    ${icon("close")} Quitar filtros
                                </button>
                            </div>`
                            : ""}

                        <div class="darts-board-wrap">
                            ${marks.length
                                ? boardSvg(marks, {
                                    trackable: true,
                                    pulse: true,
                                    label: activeRound
                                        ? `Zonas golpeadas en la ronda ${activeRound.round}`
                                        : `Zonas golpeadas en ${recording.title}`
                                })
                                : `<div class="recording-board-empty">${icon("target")}<p>${activeRound
                                    ? (outOnly(activeRound)
                                        ? "Todos los dardos de esta ronda han quedado fuera de la diana (OUT)."
                                        : "Esta ronda no tiene dardos capturados.")
                                    : "Aún no se han capturado dardos de esta partida."}</p></div>`}
                        </div>

                        ${activeRound ? roundSummaryBar(activeRound, boardStats, players) : ""}

                        <div class="darts-legend">
                            ${players
                                .filter((player) => selectedPlayer === "all" || String(player.playerIndex) === String(selectedPlayer))
                                .map((player) => `
                                    <span><i class="legend-dot" style="background:${playerColor(player.playerIndex)}"></i>
                                        ${esc(player.name)}${player.isWinner ? " · ganador" : ""}</span>
                                `).join("")}
                            <span><i class="legend-zone"></i>Zona golpeada (parpadea)</span>
                        </div>
                        <p class="small muted recording-hint">
                            ${icon("info")} Cada zona golpeada se ilumina parpadeando con el color del jugador.
                            Los dardos fuera de la diana (OUT) no se dibujan: si una ronda cae entera fuera, la
                            diana queda limpia.
                            ${activeRound ? "Usa las flechas del teclado para cambiar de ronda." : ""}
                        </p>
                        ${selectedDart !== null ? dartReadout(darts[selectedDart], selectedDart) : ""}
                    </section>

                    <section class="darts-turns-card">
                        <div class="darts-board-head">
                            <div>
                                <span class="kicker">${icon("history")}Histórico</span>
                                <h2>Ronda a ronda</h2>
                            </div>
                            <span class="small muted">${esc(formatRelative(recording.lastUpdatedAt))}</span>
                        </div>
                        ${rounds.length
                            ? `<div class="darts-turns recording-turns" id="rounds-list">
                                ${rounds.map((round) => roundCard(round, players, activeRound)).join("")}
                            </div>`
                            : emptyState("Sin tiradas registradas", "Cuando se capture el primer dardo aparecerá aquí.", "clock")}
                    </section>
                </div>
            </div>
        `;

        bind(rounds);
    }

    /* ---------- Exploración por rondas ---------- */

    function getActiveRound(rounds) {
        if (roundView === "all") return null;
        return rounds.find((round) => String(round.round) === String(roundView)) || null;
    }

    function pillPlayer(players) {
        if (selectedPlayer === "all") return "";
        const player = players.find((item) => String(item.playerIndex) === String(selectedPlayer));
        if (!player) return "";
        return `<span class="round-nav-player" style="--player-color:${playerColor(player.playerIndex)}">
            <i class="legend-dot" style="background:${playerColor(player.playerIndex)}"></i>${esc(player.name)}
        </span>`;
    }

    function roundNavigator(rounds, activeRound, players) {
        if (!rounds.length) return "";
        const currentIndex = activeRound ? rounds.findIndex((round) => round.round === activeRound.round) : -1;
        const previous = currentIndex > 0 ? rounds[currentIndex - 1] : null;
        const next = currentIndex >= 0 && currentIndex < rounds.length - 1
            ? rounds[currentIndex + 1]
            : currentIndex === -1
                ? rounds[0]
                : null;

        return `
            <div class="round-nav" id="round-nav">
                <div class="round-nav-controls">
                    <button class="btn btn-ghost btn-sm" id="round-prev" type="button"
                            ${previous ? `data-round="${previous.round}"` : "disabled"} title="Ronda anterior">
                        ${icon("chevronLeft")} Anterior
                    </button>
                    <div class="round-nav-current">
                        <span class="small muted">${activeRound ? "Ronda" : "Vista"}</span>
                        <strong>${activeRound ? esc(activeRound.round) : "Todas"}</strong>
                        <span class="small muted">/ ${rounds.length}</span>
                        ${pillPlayer(players)}
                    </div>
                    <button class="btn btn-ghost btn-sm" id="round-next" type="button"
                            ${next ? `data-round="${next.round}"` : "disabled"} title="Ronda siguiente">
                        Siguiente ${icon("chevronRight")}
                    </button>
                </div>

                <div class="round-nav-secondary">
                    <button class="recordings-tab ${roundView === "all" ? "is-active" : ""}" id="round-all" type="button">
                        Todos los dardos
                    </button>
                    <button class="btn btn-outline btn-sm" id="round-play" type="button"
                            ${rounds.length ? "" : "disabled"}>
                        ${playing ? `${icon("close")} Detener` : `${icon("play")} Reproducir`}
                    </button>
                    <div class="round-speed" role="group" aria-label="Velocidad de reproducción">
                        ${PLAYBACK_SPEEDS.map((speed) => `
                            <button class="round-speed-btn ${speed === playSpeed ? "is-active" : ""}" type="button"
                                    data-speed="${speed}">${speed}×</button>
                        `).join("")}
                    </div>
                </div>

                <div class="round-chips" role="list" aria-label="Rondas de la partida">
                    ${rounds.map((round) => `
                        <button class="round-chip ${activeRound && activeRound.round === round.round ? "is-active" : ""}"
                                type="button" data-round="${round.round}" role="listitem"
                                title="Ronda ${round.round} · ${round.darts.length} dardos · ${round.score} pts">
                            <strong>${round.round}</strong>
                            <small>${round.score}</small>
                        </button>
                    `).join("")}
                </div>
            </div>
        `;
    }

    function roundSummaryBar(round, stats, players) {
        return `
            <div class="round-summary">
                <div class="round-summary-turns">
                    ${round.turns.map((turn) => `
                        <span class="round-summary-turn" style="--player-color:${playerColor(turn.playerIndex)}">
                            <i class="legend-dot" style="background:${playerColor(turn.playerIndex)}"></i>
                            <strong>${esc(turn.player)}</strong>
                            <span>${turn.darts.reduce((total, dart) => total + dart.score, 0)} pts</span>
                            <em>${esc(turn.darts.map((dart) => hitLabel(dart)).join(" "))}</em>
                        </span>
                    `).join("")}
                </div>
                <div class="round-summary-stats">
                    <span><strong>${formatNumber(stats.score)}</strong> pts</span>
                    <span><strong>${stats.average}</strong> media</span>
                    <span><strong>${stats.triples}</strong> triples</span>
                    <span><strong>${stats.bulls}</strong> bulls</span>
                </div>
            </div>
        `;
    }

    function buildMarks(darts, activeRound, players) {
        // Qué dardos existen en la vista: la ronda elegida (o toda la partida) y, además, el jugador filtrado.
        // Los OUT no tienen zona en la diana, así que se omiten directamente.
        const source = activeRound ? activeRound.darts : darts;

        return source
            .filter((dart) => selectedPlayer === "all" || String(dart.playerIndex) === String(selectedPlayer))
            .filter((dart) => dartRegion(dart) !== null)
            .map((dart) => {
                const index = dart.index;
                const name = dart.playerName || players.find((player) => player.playerIndex === dart.playerIndex)?.name
                    || `Jugador ${dart.playerIndex + 1}`;

                return {
                    index,
                    dart,
                    color: playerColor(dart.playerIndex),
                    highlight: selectedDart === index,
                    label: `${name} · ${hitLabel(dart)} · ${dart.score} pts`,
                    title: `Ronda ${dart.round} · ${name} · ${hitLabel(dart)} (${dart.score} pts)`
                };
            });
    }

    function showRound(value) {
        stopPlayback(false);
        roundView = value;
        selectedDart = null;
        paint();
        scrollRoundIntoView();
    }

    function scrollRoundIntoView() {
        const active = container.querySelector(".round-chip.is-active");
        active?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });

        const activeCard = container.querySelector(".dart-round.is-active");
        const list = container.querySelector("#rounds-list");
        if (activeCard && list) {
            const top = activeCard.offsetTop - list.offsetTop - list.clientHeight / 2 + activeCard.clientHeight / 2;
            list.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
        }
    }

    /* ---------- Reproducción ronda a ronda ---------- */

    function togglePlayback(rounds) {
        if (playing) {
            stopPlayback(true);
            return;
        }
        if (!rounds.length) return;

        playing = true;
        // Si estamos en "todas", empezamos por la primera ronda.
        if (roundView === "all") roundView = rounds[0].round;
        paint();
        scrollRoundIntoView();
        scheduleNextRound(rounds);
    }

    function scheduleNextRound(rounds) {
        if (playTimer) clearTimeout(playTimer);
        playTimer = setTimeout(() => {
            if (!playing || destroyed) return;
            const roundsNow = groupRounds((recording?.darts || []).map(normalizeDart));
            const index = roundsNow.findIndex((round) => String(round.round) === String(roundView));
            if (index < 0 || index >= roundsNow.length - 1) {
                stopPlayback(true);
                return;
            }

            roundView = roundsNow[index + 1].round;
            selectedDart = null;
            paint();
            scrollRoundIntoView();
            scheduleNextRound(roundsNow);
        }, PLAYBACK_BASE_MS / playSpeed);
    }

    function stopPlayback(repaint) {
        const wasPlaying = playing;
        playing = false;
        if (playTimer) {
            clearTimeout(playTimer);
            playTimer = null;
        }
        if (repaint && wasPlaying && !destroyed) paint();
    }

    function bind(rounds) {
        container.querySelector("#recording-refresh")?.addEventListener("click", async () => {
            await refreshLive();
        });

        container.querySelector("#recording-delete")?.addEventListener("click", async () => {
            if (!window.confirm("¿Borrar esta partida? Se perderá el histórico de dardos de la partida.")) return;
            try {
                await api.recordingDelete(competitionId, matchId, game);
                toast("Partida finalizada borrada", "success");
                window.location.hash = "#/directo/finalizadas";
            } catch (error) {
                toast(error.message || "No se pudo borrar la partida", "error");
            }
        });

        container.querySelectorAll("#recording-filter .player-filter").forEach((button) => {
            button.addEventListener("click", () => {
                selectedPlayer = button.dataset.player;
                selectedDart = null;
                paint();
            });
        });

        container.querySelector("#board-reset")?.addEventListener("click", () => {
            stopPlayback(false);
            roundView = "all";
            selectedPlayer = "all";
            selectedDart = null;
            paint();
        });

        // Navegación y reproducción por rondas.
        container.querySelector("#round-all")?.addEventListener("click", () => showRound("all"));
        container.querySelector("#round-prev")?.addEventListener("click", (event) => {
            const value = event.currentTarget.dataset.round;
            if (value) showRound(value);
        });
        container.querySelector("#round-next")?.addEventListener("click", (event) => {
            const value = event.currentTarget.dataset.round;
            if (value) showRound(value);
        });
        container.querySelector("#round-play")?.addEventListener("click", () => togglePlayback(rounds));

        container.querySelectorAll(".round-speed-btn").forEach((button) => {
            button.addEventListener("click", () => {
                playSpeed = Number(button.dataset.speed) || 1;
                paint();
                if (playing) scheduleNextRound(groupRounds((recording?.darts || []).map(normalizeDart)));
            });
        });

        container.querySelectorAll(".round-chip").forEach((button) => {
            button.addEventListener("click", () => {
                const value = button.dataset.round;
                // Volver a pulsar la ronda activa nos devuelve a la vista completa.
                showRound(String(roundView) === String(value) ? "all" : value);
            });
        });

        // Desde el histórico: pulsar una ronda la abre en la diana.
        container.querySelectorAll("[data-round-open]").forEach((node) => {
            node.addEventListener("click", () => showRound(node.dataset.roundOpen));
        });

        const board = container.querySelector(".dartboard-svg");

        const showDart = (index) => {
            selectedDart = index;
            paint();
            requestAnimationFrame(() => {
                container.querySelector(".recording-readout")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
            });
        };

        board?.querySelectorAll("[data-dart-index]").forEach((node) => {
            node.addEventListener("click", () => showDart(Number(node.dataset.dartIndex)));
            node.addEventListener("keydown", (event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    showDart(Number(node.dataset.dartIndex));
                }
            });
        });

        container.querySelectorAll("[data-turn-dart]").forEach((node) => {
            node.addEventListener("click", () => showDart(Number(node.dataset.turnDart)));
        });

        container.querySelector("#recording-dart-close")?.addEventListener("click", () => {
            selectedDart = null;
            paint();
        });

        // Flechas izquierda/derecha para recorrer rondas cuando la diana tiene el foco.
        board?.addEventListener("keydown", (event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            if (event.target.closest("[data-dart-index]")) return;
            event.preventDefault();
            stepRound(event.key === "ArrowLeft" ? -1 : 1);
        });

        const turnList = container.querySelector(".recording-turns");
        if (turnList && !hasPainted) {
            // En la primera carga nos situamos en el final de la partida; después respetamos el scroll.
            turnList.scrollTop = turnList.scrollHeight;
            hasPainted = true;
        }
    }

    function stepRound(direction) {
        const roundsNow = groupRounds((recording?.darts || []).map(normalizeDart));
        if (!roundsNow.length) return;

        const index = roundsNow.findIndex((round) => String(round.round) === String(roundView));
        if (index < 0) {
            showRound(direction > 0 ? roundsNow[0].round : roundsNow[roundsNow.length - 1].round);
            return;
        }

        const target = index + direction;
        if (target < 0 || target >= roundsNow.length) return;
        showRound(roundsNow[target].round);
    }

    function dartReadout(dart, index) {
        if (!dart) return "";
        const kind = hitKind(dart);
        const name = dart.playerName || `Jugador ${dart.playerIndex + 1}`;
        return `
            <div class="recording-readout" style="--player-color:${playerColor(dart.playerIndex)}">
                <div class="recording-readout-head">
                    <span class="chip chip-type">Dardo #${index + 1}</span>
                    <span class="small muted">Ronda ${esc(dart.round)} · tirada ${esc(dart.dart)}</span>
                    <button class="icon-btn" id="recording-dart-close" type="button" aria-label="Cerrar detalle">${icon("close")}</button>
                </div>
                <div class="recording-readout-body">
                    <div class="recording-readout-hit">
                        <strong style="color:${playerColor(dart.playerIndex)}">${esc(hitLabel(dart))}</strong>
                        <span>${dart.score} pts</span>
                    </div>
                    <ul class="recording-readout-meta">
                        <li><span>Jugador</span><strong>${esc(name)}</strong></li>
                        <li><span>Zona</span><strong>${esc(KIND_LABELS[kind] || "—")}${dart.sector ? ` · sector ${dart.sector}` : ""}</strong></li>
                        <li><span>Registro</span><strong>${esc(dart.hitRegion || "—")}</strong></li>
                        <li><span>Capturado</span><strong>${esc(formatRelative(dart.capturedAt))}</strong></li>
                    </ul>
                </div>
            </div>
        `;
    }

    function playerCard(player, allPlayers, list) {
        const color = playerColor(player.playerIndex);
        const active = selectedPlayer !== "all" && String(player.playerIndex) === String(selectedPlayer);
        return `
            <article class="recording-player-card ${active ? "is-active" : ""} ${player.isWinner ? "is-winner" : ""}"
                     style="--player-color:${color}">
                <div class="recording-player-head">
                    <i class="player-dot-lg" style="background:${color}"></i>
                    <strong>${esc(player.name)}</strong>
                    ${player.isWinner ? `<span class="chip chip-live">${icon("crown")} Ganador</span>` : ""}
                </div>
                <div class="recording-player-stats">
                    <span><strong>${formatNumber(player.score ?? 0)}</strong> pts</span>
                    <span><strong>${player.average ?? 0}</strong> media</span>
                    <span><strong>${player.darts ?? 0}</strong> dardos</span>
                    <span><strong>${player.triples ?? 0}</strong> triples</span>
                    <span><strong>${player.doubles ?? 0}</strong> dobles</span>
                    <span><strong>${player.bulls ?? 0}</strong> bulls</span>
                    <span><strong>${player.highestTurn ?? 0}</strong> mejor turno</span>
                    <span><strong>${allPlayers.length > 1 ? shareOf(list, player.playerIndex) : 100}%</strong> de dardos</span>
                </div>
            </article>
        `;
    }

    function visibleCount(activeRound, darts, player) {
        const source = activeRound ? activeRound.darts : darts;
        return player === "all"
            ? source.length
            : source.filter((dart) => String(dart.playerIndex) === String(player)).length;
    }

    function outOnly(activeRound) {
        return activeRound.darts.length > 0 && activeRound.darts.every((dart) => dartRegion(dart) === null);
    }

    function shareOf(list, playerIndex) {
        if (!list.length) return 0;
        const count = list.filter((dart) => dart.playerIndex === Number(playerIndex)).length;
        return Math.round((count / list.length) * 100);
    }
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
        // El índice de la colección completa es el que usan los marcos de la diana.
        turn.darts.push({ ...dart, index: dartIndex });
    });

    return turns;
}

/** Tarjeta de una ronda completa en el histórico (todas las tiradas de esa ronda). */
function roundCard(round, players, activeRound) {
    const isActive = Boolean(activeRound) && activeRound.round === round.round;
    return `
        <article class="dart-round ${isActive ? "is-active" : ""}">
            <div class="dart-round-head">
                <span class="dart-round-number">Ronda ${esc(round.round)}</span>
                <span class="dart-round-total">${round.score} pts</span>
            </div>
            <div class="dart-round-turns">
                ${round.turns.map((turn) => {
                    const name = turn.player || players.find((player) => player.playerIndex === turn.playerIndex)?.name;
                    return `
                        <div class="dart-round-turn">
                            <span class="dart-turn-player" style="color:${playerColor(turn.playerIndex)}">
                                <i class="legend-dot" style="display:inline-block;background:${playerColor(turn.playerIndex)}"></i>
                                ${esc(name)}
                            </span>
                            <div class="dart-turn-darts">
                                ${turn.darts.map((dart) => dartChip(dart)).join("")}
                            </div>
                        </div>
                    `;
                }).join("")}
            </div>
            <button class="dart-round-open" type="button" data-round-open="${round.round}">
                ${isActive ? `${icon("target")} Viendo en la diana` : `${icon("target")} Ver en la diana`}
            </button>
        </article>
    `;
}

function dartChip(dart) {
    const kind = hitKind(dart);
    const index = dart.index;
    const className = `is-${kind}`;
    return `
        <button class="dart-chip ${className}" type="button" ${index === undefined ? "" : `data-turn-dart="${index}"`}
                title="Dardo ${dart.dart} de la ronda ${dart.round} · ${esc(KIND_LABELS[kind] || "")}">
            <strong>${esc(hitLabel(dart))}</strong>
            <small>${dart.score} pts</small>
        </button>
    `;
}

import { api } from "../api.js?v=79";
import { esc, icon, avatarHtml, formatNumber, toast } from "../ui.js?v=78";
import { playerColor, normalizeDart, hitLabel, hitKind } from "../dartboard.js?v=78";
import { getCurrentPlayer, openLoginModal } from "../auth.js?v=81";

const SPEEDS = [1, 2, 4];
const BASE_DART_MS = 950;
const LIVE_DART_MS = 1150;
const TURN_GAP_MS = 420;
const LIVE_POLL_MS = 3000;
const SCORE_DELAY_MS = 700;
const CRICKET_TARGETS = [20, 19, 18, 17, 16, 15, 25];
const PHOTO_CACHE = new Map();
const CHAT_POLL_MS = 3500;

const DIANA_LABELS = {
    aa: "Aro ancho",
    ae: "Aro estrecho",
    bb: "Bristle"
};

function ratingValue(value) {
    const text = String(value || "").trim();
    const match = /^([\d.,]+)/.exec(text);
    return match ? match[1] : (text || "—");
}

export async function render(container, params = [], query = new URLSearchParams()) {
    const competitionId = Number(params[0]);
    const matchId = Number(params[1]);
    const game = Number(params[2]);
    const room = `live-${competitionId}-${matchId}`;

    let destroyed = false;
    let pollTimer = null;
    let playTimer = null;
    let confettiTimer = null;
    let recording = null;
    let games = [];
    let allDarts = [];
    let turns = [];
    let dartCursor = 0;
    let liveFollow = true;
    let tab = query.get("tab") === "partida" ? "partida" : "directo";
    let playing = false;
    let speed = Number(localStorage.getItem("replay-speed")) || 1;
    let sound = localStorage.getItem("replay-audio") !== "0";
    let startScore = 501;
    let rules = resolveX01Rules(null);
    let teamRosters = null;
    let rosterLoading = false;
    let rosterAttempted = false;
    let rosterFailed = false;
    let confettiShown = false;
    let photoLoading = false;
    let lastPlayerIndex = null;
    let liveQueue = [];
    let liveDrainTimer = null;
    let lastShellKey = "";
    let currentCtx = null;
    let scoreAnim = null;
    let chatOpen = false;
    let chatUnread = 0;
    const chat = { messages: [], lastId: 0, timer: null, loading: false, sending: false };
    const controller = new AbortController();

    document.body.classList.add("is-immersive");
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keydown", onTheaterKeyDown);
    const onAuthChange = () => {
        if (!destroyed && tab === "directo") renderChatPanel();
    };
    document.addEventListener("radikal:auth", onAuthChange);

    container.innerHTML = skeleton();
    await load(true);

    function cleanup() {
        destroyed = true;
        document.body.classList.remove("is-immersive");
        controller.abort();
        if (pollTimer) clearInterval(pollTimer);
        if (liveDrainTimer) clearTimeout(liveDrainTimer);
        if (scoreAnim?.timer) clearTimeout(scoreAnim.timer);
        if (playTimer) clearTimeout(playTimer);
        if (confettiTimer) cancelAnimationFrame(confettiTimer);
        stopChat();
        document.removeEventListener("fullscreenchange", onFullscreenChange);
        document.removeEventListener("keydown", onKeyDown);
        document.removeEventListener("keydown", onTheaterKeyDown);
        document.removeEventListener("radikal:auth", onAuthChange);
        document.body.classList.remove("is-video-theater");
        container.querySelector(".replay-page")?.classList.remove("is-video-fullscreen");
        if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    }

    return cleanup;

    /* =================================================================
       Carga de la partida
       ================================================================= */

    function skeleton() {
        return `
            <div class="replay-page replay-page-loading">
                <div class="replay-loading-card">
                    <span class="replay-loading-ball">${icon("target")}</span>
                    <p>Cargando partida…</p>
                    <small>Preparando marcadores, turnos y tiradas.</small>
                </div>
            </div>
        `;
    }

    async function load(first) {
        try {
            const [selected, list] = await Promise.all([
                fetchRecording({ allowSync: true }),
                api.liveRecordings(controller.signal).catch(() => null)
            ]);
            if (destroyed) return;

            recording = selected;
            games = (list?.items || [])
                .filter((item) => item.competitionId === competitionId && item.matchId === matchId)
                .sort((left, right) => left.game - right.game);

            if (!games.length) {
                games = [{
                    competitionId,
                    matchId,
                    game,
                    title: selected.title,
                    gameType: selected.gameType,
                    isFinished: selected.isFinished,
                    isMock: selected.isMock
                }];
            }

            applyRecording(selected, true);
            if (first && (selected.isFinished || selected.isMock)) {
                dartCursor = -1;
            }
            if (first && selected.isMock && !query.has("tab")) tab = "partida";
            paint();
            loadPhotos();
            loadTeamRosters();

            if (!selected.isFinished) {
                startLivePoll();
            }
        } catch (error) {
            if (destroyed || error?.name === "AbortError") return;
            const officialUrl = `https://www.radikalplayers.com/dianas/Radikal/Flash/Visualizador.php?compid=${competitionId}&encid=${matchId}&ngame=${game}&local=1&videos=Y`;
            container.innerHTML = `
                <div class="replay-page replay-page-loading">
                    <div class="replay-loading-card replay-error-card">
                        ${icon("info")}
                        <p>No se pudo abrir esta partida.</p>
                        <small>${esc(error.message || "Radikal no ha devuelto los dardos.")}</small>
                        <div class="replay-error-actions">
                            <button class="btn btn-primary btn-sm" type="button" id="replay-retry">${icon("refresh")} Reintentar</button>
                            <a class="btn btn-outline btn-sm" href="${officialUrl}" target="_blank" rel="noopener">${icon("external")} Visor oficial</a>
                            <a class="btn btn-ghost btn-sm" href="#/directo">${icon("arrowLeft")} Volver al directo</a>
                        </div>
                    </div>
                </div>
            `;
            container.querySelector("#replay-retry")?.addEventListener("click", () => {
                if (destroyed) return;
                container.innerHTML = skeleton();
                load(true);
            });
        }
    }

    /**
     * Devuelve la grabación de la partida. Si todavía no existe, fuerza una captura
     * y, como último recurso, construye una grabación en memoria con /api/live/darts.
     * Esto permite entrar en partidas recién empezadas.
     */
    async function fetchRecording({ allowSync = true } = {}) {
        const getStored = () => api.liveRecording(competitionId, matchId, game, controller.signal)
            .catch((error) => {
                if (error?.name === "AbortError") throw error;
                if (error?.status === 404) return null;
                throw error;
            });

        let selected = await getStored();
        if (!selected && allowSync) {
            await api.recordingSync(competitionId, matchId, game, controller.signal).catch(() => null);
            selected = await getStored();
        }
        if (selected) return selected;

        const live = await api.liveDarts(competitionId, matchId, game, controller.signal);
        return recordingFromLiveDarts(live, await liveMatchTitle());
    }

    async function liveMatchTitle() {
        try {
            const data = await api.liveMatches(controller.signal);
            const match = (data?.matches || []).find((item) =>
                item.competitionId === competitionId &&
                item.matchId === matchId &&
                item.game === game);
            return match?.title || null;
        } catch {
            return null;
        }
    }

    function recordingFromLiveDarts(live, title) {
        const raw = live?.darts || [];
        const darts = raw.map((dart, index) => ({
            ...dart,
            index,
            game: dart.game ?? game,
            capturedAt: dart.capturedAt || live?.fetchedAt || new Date().toISOString()
        }));
        const players = [...new Set(darts.map((dart) => dart.playerName).filter(Boolean))];
        const stamp = live?.fetchedAt || new Date().toISOString();

        return {
            competitionId,
            matchId,
            game,
            title: title || `Partida #${matchId} · J${game}`,
            isMock: false,
            isFinished: Boolean(live?.isFinished),
            winner: live?.winner || null,
            gameType: live?.gameType || null,
            isTeam: typeof live?.isTeam === "boolean" ? live.isTeam : null,
            darts,
            players,
            playerStats: [],
            totalTurns: 0,
            totalDarts: darts.length,
            totalScore: 0,
            firstSeenAt: stamp,
            lastUpdatedAt: stamp,
            x01Rules: live?.x01Rules || null
        };
    }

    function displayTitle(value) {
        const text = String(value || "").trim();
        if (!text) return `Partida #${matchId}`;
        const first = text.split(/\s+\/\s+/)[0]?.trim();
        return first || text;
    }

    function applyRecording(next, first, options = {}) {
        const preserveCursor = options.preserveCursor === true;
        const atEnd = !preserveCursor && (first || dartCursor >= allDarts.length - 1);
        turns = buildTurns(next.darts || []);
        allDarts = turns.flatMap((turn) => turn.darts).sort((left, right) => left.index - right.index);
        rules = resolveX01Rules(next);
        startScore = rules.startScore;
        dartCursor = atEnd
            ? Math.max(0, allDarts.length - 1)
            : Math.min(dartCursor, Math.max(0, allDarts.length - 1));
    }

    function startLivePoll() {
        if (pollTimer) return;
        pollTimer = setInterval(refreshLive, LIVE_POLL_MS);
    }

    async function refreshLive() {
        if (destroyed) return;
        try {
            await api.recordingSync(competitionId, matchId, game, controller.signal).catch(() => null);
            const next = await fetchRecording({ allowSync: false });
            if (destroyed || !next) return;

            const previousCount = allDarts.length;
            recording = next;
            applyRecording(next, false, { preserveCursor: true });

            if (tab === "partida" && allDarts.length > previousCount) {
                if (liveFollow) enqueueLiveDarts(previousCount, allDarts.length);
            }

            if (next.isFinished) {
                if (pollTimer) clearInterval(pollTimer);
                pollTimer = null;
                if (tab === "partida" && (!liveFollow || !liveQueue.length)) paint();
            }
            if (!teamRosters) loadTeamRosters();
        } catch {
            // Silencioso: seguimos mostrando la última información disponible.
        }
    }

    function enqueueLiveDarts(from, to) {
        for (let index = Math.max(0, from); index < to; index += 1) liveQueue.push(index);
        drainLiveDarts();
    }

    function drainLiveDarts() {
        if (destroyed || liveDrainTimer) return;
        const next = liveQueue.shift();
        if (next === undefined || next >= allDarts.length) return;

        dartCursor = next;
        paint({ flash: true, scoreAnim: true });
        announceDart(allDarts[dartCursor]);

        if (liveQueue.length) {
            const current = allDarts[next];
            const following = allDarts[liveQueue[0]];
            const gap = current && following && current.playerIndex !== following.playerIndex ? TURN_GAP_MS : 0;
            liveDrainTimer = setTimeout(() => {
                liveDrainTimer = null;
                drainLiveDarts();
            }, Math.max(450, (LIVE_DART_MS + gap) / speed));
        }
    }

    /* =================================================================
       Pintado general
       ================================================================= */

    function paint(options = {}) {
        const flash = options.flash === true;
        const players = buildPlayers(recording, allDarts);
        const teamMode = detectTeamMode(recording, players);
        const activeRules = rules || resolveX01Rules(recording);
        const teams = buildTeams(recording, players, teamMode, activeRules);
        if (teamMode && teamRosters) {
            for (const team of teams) {
                const roster = rosterForTeam(team, players);
                if (roster?.name && /^Equipo [AB]$/i.test(team.name)) team.name = roster.name;
            }
        }
        const entities = teamMode ? teams : players.map((player) => singleEntity(player));
        const modality = detectModality(recording);
        const totalDarts = allDarts.length;
        const isFinished = Boolean(recording?.isFinished);
        const isLive = !isFinished;
        const maxCursor = totalDarts > 0 ? totalDarts - 1 + (isFinished ? 1 : 0) : -1;
        dartCursor = Math.max(-1, Math.min(dartCursor, maxCursor));
        const isSummary = isFinished && totalDarts > 0 && dartCursor >= totalDarts;
        const currentTurn = turnAt(dartCursor);
        const currentDart = dartCursor >= 0 && dartCursor < totalDarts ? allDarts[dartCursor] : null;
        const turnDarts = currentTurn ? currentTurn.darts.filter((dart) => dart.index <= dartCursor) : [];
        const revealed = allDarts.slice(0, Math.max(0, Math.min(dartCursor + 1, totalDarts)));
        const scores = modality === "cricket"
            ? computeCricket(revealed, entities)
            : computeX01(revealed, players, teams, teamMode, activeRules);
        const finalScores = modality === "cricket"
            ? computeCricket(allDarts, entities)
            : computeX01(allDarts, players, teams, teamMode, activeRules);
        const cricketPlayerScores = modality === "cricket"
            ? (teamMode ? computeCricket(revealed, players.map(singleEntity)) : scores)
            : null;
        const cricketFinalPlayerScores = modality === "cricket"
            ? (teamMode ? computeCricket(allDarts, players.map(singleEntity)) : finalScores)
            : null;
        const playerIndex = currentDart?.playerIndex ?? currentTurn?.playerIndex ?? 0;
        const currentPlayer = players.find((player) => player.playerIndex === playerIndex)
            || { playerIndex, name: currentDart?.playerName || currentTurn?.player || `Jugador ${playerIndex + 1}` };
        const currentTeam = teams.find((team) => team.playerIndices.includes(playerIndex)) || null;
        const currentEntity = teamMode
            ? (currentTeam || entities.find((entity) => entity.playerIndices.includes(playerIndex)) || null)
            : (entities.find((entity) => entity.playerIndices.includes(playerIndex)) || null);
        // En equipos con marcadores separados cada jugador tiene su propia entrada;
        // el color y el nombre de equipo siguen saliendo de currentEntity.
        const currentScore = currentEntity
            ? (modality === "cricket"
                ? scores.find((score) => score.entity.id === currentEntity.id)
                : scores.find((score) => score.playerIndices.includes(playerIndex)))
            : null;
        const frozenPlayers = modality === "x01"
            ? frozenPlayerIndices(scores, teams, teamMode, activeRules.stacked)
            : new Set();
        const dartFlags = scores?.dartFlags || new Map();
        const currentDartFlags = currentDart ? dartFlags.get(currentDart.index) || null : null;
        const currentHasCheckout = modality === "x01" && hasCheckout(currentScore?.remaining, activeRules.outMode);

        // El marcador grande no resta de golpe: primero se ve la tirada y,
        // al terminar su animación, el restante baja con una cuenta atrás.
        const targetRemaining = currentScore?.remaining ?? activeRules.startScore;
        let displayRemaining = targetRemaining;
        let scorePending = false;
        let panelTo = targetRemaining;
        let panelRaw = false;
        if (modality === "x01" && teamMode && !activeRules.stacked) {
            const teamScores = currentTeam
                ? scores.filter((score) => currentTeam.playerIndices.some((index) => score.playerIndices.includes(index)))
                : [];
            if (teamScores.length) {
                panelTo = teamScores.reduce((sum, score) => sum + (score.remaining || 0), 0);
                panelRaw = true;
            }
        }
        const animateScore = options.scoreAnim === true &&
            tab === "partida" &&
            modality === "x01" &&
            !isSummary &&
            Boolean(currentDart) &&
            Boolean(currentScore);

        if (modality === "x01" && tab === "partida" && !isSummary && currentScore) {
            const activeAnim = scoreAnim &&
                scoreAnim.cursor === dartCursor &&
                scoreAnim.entityId === currentScore.entity.id &&
                scoreAnim.active;

            if (activeAnim) {
                displayRemaining = scoreAnim.from;
                scorePending = true;
            } else if (animateScore) {
                const preDarts = allDarts.slice(0, dartCursor);
                const preScores = computeX01(preDarts, players, teams, teamMode, activeRules);
                const pre = preScores.find((score) => score.entity.id === currentScore.entity.id);
                const from = pre?.remaining ?? activeRules.startScore;

                if (scoreAnim?.timer) clearTimeout(scoreAnim.timer);
                if (from !== targetRemaining) {
                    scoreAnim = {
                        cursor: dartCursor,
                        entityId: currentScore.entity.id,
                        from,
                        to: targetRemaining,
                        panelTo,
                        panelRaw,
                        bust: Boolean(currentDartFlags?.bust),
                        timer: null,
                        active: true
                    };
                    displayRemaining = from;
                    scorePending = true;
                } else {
                    scoreAnim = null;
                }
            } else if (scoreAnim) {
                if (scoreAnim.timer) clearTimeout(scoreAnim.timer);
                scoreAnim = null;
            }
        } else if (scoreAnim) {
            if (scoreAnim.timer) clearTimeout(scoreAnim.timer);
            scoreAnim = null;
        }
        let nextIndex = dartCursor + 1;
        while (nextIndex < totalDarts && scores.skipped?.has(nextIndex)) nextIndex += 1;
        const nextDart = nextIndex < totalDarts ? allDarts[nextIndex] : null;
        const nextPlayer = nextDart
            ? players.find((player) => player.playerIndex === nextDart.playerIndex)
            : null;
        const winner = findWinner(recording, players, teams, teamMode);
        const isFinalDart = totalDarts > 0 && dartCursor >= totalDarts - 1;
        const turnPosition = currentTurn ? turns.indexOf(currentTurn) + 1 : 0;
        const turnTotal = turnDarts.reduce((sum, dart) => {
            const flag = dartFlags.get(dart.index);
            return sum + (flag?.valid === false || flag?.skipped ? 0 : Number(dart.score) || 0);
        }, 0);
        const ratingLabel = modality === "cricket" ? "MPR" : "PPD";
        const currentPlayerCricketScore = cricketPlayerScores?.find((score) =>
            score.playerIndices.includes(playerIndex)) || null;
        const ratingValue = modality === "cricket"
            ? (currentPlayerCricketScore?.mpr || 0).toFixed(2)
            : (currentScore?.average || "0.00");
        const currentStats = modality === "cricket"
            ? {
                value: formatNumber(currentScore?.points || 0),
                label: "puntos",
                detail: `${currentScore?.darts || 0} dardos`
            }
            : {
                value: formatNumber(currentScore?.remaining ?? activeRules.startScore),
                label: "restante",
                detail: `${formatNumber(currentScore?.scored || 0)} pts · media ${currentScore?.average || "0.00"}`
            };

        const turnChanged = lastPlayerIndex !== null && lastPlayerIndex !== playerIndex;
        lastPlayerIndex = playerIndex;

        const ctx = {
            players, teams, entities, modality, scores, finalScores, currentTurn, currentDart, turnDarts,
            currentPlayer, currentTeam, currentEntity, currentScore, nextPlayer, winner,
            isFinalDart, turnPosition, currentStats, turnTotal, ratingLabel, ratingValue,
            isLive, turnChanged, totalDarts, maxCursor, isSummary,
            displayRemaining, scorePending, rules: activeRules, dartFlags, currentDartFlags,
            skipped: scores?.skipped || new Set(), frozenPlayers, currentHasCheckout,
            cricketPlayerScores, cricketFinalPlayerScores
        };
        currentCtx = ctx;

        const schedulePendingScore = () => {
            if (!scorePending || !scoreAnim || scoreAnim.timer) return;
            const anim = scoreAnim;
            const delay = Math.max(220, SCORE_DELAY_MS / speed);
            anim.timer = window.setTimeout(() => {
                anim.timer = null;
                anim.active = false;
                if (destroyed || scoreAnim !== anim) return;

                const big = container.querySelector("[data-big-score]");
                if (big) tweenScore(big, anim.from, anim.to);
                const panel = container.querySelector("[data-score-panel]");
                if (panel) panel.textContent = anim.panelRaw ? Math.round(anim.panelTo) : formatNumber(anim.panelTo);
                if (sound) {
                    if (anim.bust) playBustTick();
                    else playScoreTick();
                }
                if (scoreAnim === anim) scoreAnim = null;
            }, delay);
        };

        const shellKey = [
            tab, game, modality, players.length, teamMode,
            recording?.title, recording?.isFinished,
            allDarts.length > 0, games.map((item) => (item.isFinished ? 1 : 0)).join("")
        ].join("|");

        if (shellKey === lastShellKey && tab === "partida" && container.querySelector(".rv-game")) {
            const gameNode = container.querySelector(".rv-game");
            gameNode.outerHTML = gameHtml({ ...ctx, live: false });
            bindGameControls();
            schedulePendingScore();
            if (isSummary && winner && !confettiShown) {
                confettiShown = true;
                startConfetti(container.querySelector("[data-confetti]"));
            }
            return;
        }

        lastShellKey = shellKey;

        container.innerHTML = `
            <div class="replay-page ${tab === "directo" ? "is-live-tab" : ""}">
                ${backgroundHtml()}
                ${topbarHtml()}

                ${tab === "directo"
                    ? directoHtml()
                    : gameHtml({ ...ctx, live: false })}

                <canvas class="replay-confetti" data-confetti aria-hidden="true"></canvas>
            </div>
        `;

        bind({ players, teams, isFinalDart, winner, currentDart });
        schedulePendingScore();

        if (tab === "directo") {
            renderChat();
            startChat();
        } else {
            stopChat();
        }

        if (isSummary && winner && !confettiShown) {
            confettiShown = true;
            startConfetti(container.querySelector("[data-confetti]"));
        }
    }

    function tweenScore(node, from, to) {
        const delta = container.querySelector("[data-score-delta]");
        const duration = Math.max(150, 250 / speed);
        const started = performance.now();
        let finished = false;

        const finish = () => {
            if (finished) return;
            finished = true;
            if (node.isConnected) {
                node.textContent = formatNumber(to);
                node.classList.remove("is-counting", "is-dimmed");
            }
            delta?.remove();
        };

        node.classList.remove("is-dimmed");
        node.classList.add("is-counting");

        const tick = (now) => {
            if (finished) return;
            if (!node.isConnected) {
                delta?.remove();
                finished = true;
                return;
            }
            const t = Math.min(1, (now - started) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            node.textContent = formatNumber(Math.round(from + (to - from) * eased));
            if (t < 1) requestAnimationFrame(tick);
            else finish();
        };
        requestAnimationFrame(tick);
        // Si la pestaña está en segundo plano, rAF se pausa: aseguramos el valor final.
        window.setTimeout(finish, duration + 140);
    }

    function backgroundHtml() {
        return `
            <div class="rv-bg" aria-hidden="true">
                <span class="rv-bg-image"></span>
                <span class="rv-bg-scrim"></span>
            </div>
        `;
    }

    function topbarHtml() {
        const modality = detectModality(recording);
        return `
            <header class="rv-topbar">
                <a class="rv-back" href="#/directo/finalizadas" aria-label="Volver a partidas finalizadas">
                    ${icon("arrowLeft")}
                </a>
                <div class="rv-title">
                    <strong title="${esc(recording.title || `Partida #${matchId}`)}">${esc(displayTitle(recording.title))}</strong>
                    <small>${modality === "cricket" ? "Cricket" : "X01"} · ${recording.isFinished ? "Finalizada" : "En directo"}</small>
                </div>
                <div class="rv-actions">
                    <div class="rv-switch" role="tablist" aria-label="Vista de la partida">
                        <button class="rv-switch-btn ${tab === "partida" ? "is-active" : ""}" type="button" role="tab"
                                aria-selected="${tab === "partida"}" data-tab="partida" title="Modo partida">
                            ${icon("target")}<span>Partida</span>
                        </button>
                        <button class="rv-switch-btn ${tab === "directo" ? "is-active" : ""}" type="button" role="tab"
                                aria-selected="${tab === "directo"}" data-tab="directo" title="Directo oficial">
                            ${icon("tv")}<span>Directo</span><i class="rv-live-dot" aria-hidden="true"></i>
                        </button>
                    </div>
                    <button class="rv-icon" type="button" data-roster-open title="Jugadores y equipos" aria-label="Jugadores y equipos">
                        ${icon("users")}
                    </button>
                    <button class="rv-icon ${sound ? "is-on" : ""}" type="button" data-sound
                            title="${sound ? "Silenciar sonido" : "Activar sonido"}" aria-label="${sound ? "Silenciar sonido" : "Activar sonido"}">
                        ${icon(sound ? "volume" : "volumeOff")}
                    </button>
                    <button class="rv-icon" type="button" data-fullscreen title="Pantalla completa" aria-label="Pantalla completa">
                        ${icon("maximize")}
                    </button>
                </div>
            </header>
        `;
    }

    /* =================================================================
       Vista "Partida": marcador + tirada a tirada
       ================================================================= */

    function directoHtml() {
        if (recording.isMock) {
            return `
                <div class="rv-live-shell ${chatOpen ? "is-chat-open" : ""}">
                    <div class="rv-live-main rv-official">
                        <div class="rv-official-empty">
                            <div class="lv-radar" aria-hidden="true">
                                <span class="lv-radar-ring"></span>
                                <span class="lv-radar-dot"></span>
                                ${icon("target")}
                            </div>
                            <strong>DIRECTO NO DISPONIBLE</strong>
                            <p>Esta partida es una simulación. El directo oficial solo existe para partidas reales de Radikal.</p>
                            <div class="rv-official-empty-actions">
                                <button class="btn btn-primary btn-sm" type="button" data-tab="partida">
                                    ${icon("chart")} Ver partida
                                </button>
                                <button class="btn btn-outline btn-sm" type="button" data-chat-toggle aria-expanded="${chatOpen}">
                                    ${icon("message")} Chat
                                </button>
                            </div>
                        </div>
                    </div>
                    ${chatHtml()}
                </div>
            `;
        }

        const url = officialViewerUrl();
        return `
            <div class="rv-live-shell ${chatOpen ? "is-chat-open" : ""}">
                <div class="rv-live-main rv-official">
                    <div class="rv-official-frame">
                        <iframe
                            src="${esc(url)}"
                            title="Directo oficial de Radikal"
                            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                            allowfullscreen
                            webkitallowfullscreen
                            mozallowfullscreen
                            referrerpolicy="strict-origin-when-cross-origin"></iframe>
                        <div class="rv-video-tools">
                            <button class="rv-video-btn rv-chat-toggle" type="button" data-chat-toggle
                                    aria-expanded="${chatOpen}" aria-controls="rv-chat"
                                    title="${chatOpen ? "Cerrar chat" : "Abrir chat"}">
                                ${icon("message")}<span>Chat</span><i class="rv-chat-badge" data-chat-badge hidden>0</i>
                            </button>
                            <button class="rv-video-btn" type="button" data-video-fullscreen
                                    title="Pantalla completa del vídeo" aria-label="Pantalla completa del vídeo">
                                ${icon("maximize")}<span>Pantalla completa</span>
                            </button>
                            <button class="rv-video-btn" type="button" data-video-reload
                                    title="Recargar directo" aria-label="Recargar directo">
                                ${icon("refresh")}
                            </button>
                        </div>
                    </div>
                    <div class="rv-official-bar">
                        <span class="rv-live-state ${recording.isFinished ? "is-finished" : ""}">
                            <i></i>${recording.isFinished ? "FINALIZADA" : "EN DIRECTO"}
                        </span>
                        <span class="rv-live-meta" title="${esc(recording.title || `Partida #${matchId}`)}">${esc(displayTitle(recording.title))} · J${game}</span>
                        <button class="rv-livebtn" type="button" data-video-fullscreen>
                            ${icon("maximize")} Pantalla completa
                        </button>
                        <a class="rv-livebtn" href="${esc(url)}" target="_blank" rel="noopener">
                            ${icon("external")} Abrir en Radikal
                        </a>
                        <button class="rv-livebtn" type="button" data-tab="partida">
                            ${icon("chart")} Ver partida
                        </button>
                    </div>
                </div>
                ${chatHtml()}
            </div>
        `;
    }

    function officialViewerUrl() {
        return `https://www.radikalplayers.com/dianas/Radikal/visualizaPartida.php?compid=${competitionId}&encid=${matchId}&ngame=${game}`;
    }

    function gameHtml(ctx) {
        const {
            players, entities, modality, scores, currentTurn, currentDart, currentPlayer,
            currentTeam, currentEntity, winner, ratingLabel, ratingValue, isLive, turnChanged,
            isSummary
        } = ctx;

        if (!allDarts.length) return waitingHtml(ctx);

        const teamMode = detectTeamMode(recording, players);
        const isCricket = modality === "cricket";
        const accent = panelColor(entities.indexOf(currentEntity));

        if (isSummary) {
            return `
                <div class="rv-game is-summary">
                    ${gamesStrip(players, teamMode, isLive)}
                    ${summaryHtml(ctx)}
                </div>
            `;
        }

        return `
            <div class="rv-game is-partida ${isLive ? "is-live" : ""}">
                ${gamesStrip(players, teamMode, isLive)}

                <div class="rv-stage">
                    <aside class="rv-left ${turnChanged ? "is-turn-change" : ""}">
                        <div class="rv-player" style="--accent:${accent}">
                            <div class="rv-photo">
                                ${avatarFor(currentPlayer)}
                                <span class="rv-photo-name">${esc(currentPlayer.name)}</span>
                            </div>
                            <div class="rv-player-meta">
                                <strong>${esc(currentPlayer.name)}</strong>
                                <small>${teamMode && currentTeam ? esc(currentTeam.name) : "Individual"}</small>
                            </div>
                        </div>

                        <div class="rv-rating" style="--accent:${accent}">
                            <strong>${esc(ratingValue)}</strong>
                            <span>${esc(ratingLabel)}</span>
                        </div>
                    </aside>

                    <main class="rv-center">
                        ${isCricket
                            ? `<div class="rv-cricket-stage">
                                   ${roundBannerHtml(currentTurn)}
                                   ${currentDart ? cricketHitHtml(currentDart) : ""}
                                   ${throwBarsHtml(ctx)}
                                   ${cricketGrid(ctx)}
                               </div>`
                            : bigScoreHtml(ctx)}
                    </main>
                </div>

                ${isCricket ? "" : `${roundBannerHtml(currentTurn)}${x01Panels(ctx)}`}

                ${controlsHtml(currentTurn, isLive)}
            </div>
        `;
    }

    function bigScoreHtml(ctx) {
        const { currentDart, currentScore, currentEntity, entities, displayRemaining, scorePending } = ctx;
        const activeRules = ctx.rules || rules;
        const target = currentScore?.remaining ?? activeRules.startScore;
        const remaining = displayRemaining ?? target;
        const info = currentDart ? hitDisplay(currentDart) : null;
        const accent = panelColor(entities.indexOf(currentEntity));
        const bust = Boolean(ctx.currentDartFlags?.bust);
        const frozen = Boolean(ctx.currentHasCheckout) && (
            Boolean(ctx.currentDartFlags?.frozen) ||
            Boolean(ctx.frozenPlayers?.has(ctx.currentPlayer?.playerIndex))
        );
        const skipped = Boolean(ctx.currentDartFlags?.skipped);
        const delta = !bust && scorePending ? Math.max(0, remaining - target) : 0;
        const hitDuration = `${Math.max(0.18, 0.7 / speed)}s`;
        const rulesLine = `${activeRules.startScore} · ${rulesShortLabel(activeRules)} · ${bullModeLabel(activeRules)} · ${activeRules.rounds} R`;

        return `
            <div class="rv-big ${bust ? "is-bust" : ""} ${frozen ? "is-frozen" : ""}" style="--player-color:${accent}">
                <div class="rv-big-rules">${esc(rulesLine)}</div>
                ${info ? `
                    <div class="rv-big-hit ${info.className} ${bust ? "is-bust" : ""}"
                         style="--hit-color:${info.color};--hit-duration:${hitDuration}">
                        <strong>${esc(info.notation)}</strong>
                    </div>
                ` : ""}
                ${frozen && !bust ? `<span class="rv-big-freeze">❄ CONGELADO</span>` : ""}
                <div class="rv-big-score ${scorePending ? "is-dimmed" : ""}" data-big-score>${formatNumber(remaining)}</div>
                ${bust
                    ? `<span class="rv-big-bust">${frozen ? "CONGELADO · BUST" : "BUST"}</span>`
                    : skipped
                        ? `<span class="rv-big-bust is-skip">FIN DEL TURNO</span>`
                        : delta > 0
                            ? `<span class="rv-big-delta" data-score-delta>−${formatNumber(delta)}</span>`
                            : ""}
                <div class="rv-big-label">RESTANTE</div>
                ${throwBarsHtml(ctx)}
            </div>
        `;
    }

    function throwBarsHtml(ctx) {
        const { currentTurn, currentEntity, entities } = ctx;
        const darts = currentTurn?.darts || [];
        const color = panelColor(entities.indexOf(currentEntity));

        return `
            <div class="rv-throws" style="--team:${color}">
                ${[0, 1, 2].map((slot) => {
                    const dart = darts[slot];
                    const revealed = Boolean(dart) && dart.index <= dartCursor;
                    const flag = revealed ? ctx.dartFlags?.get(dart.index) : null;
                    const miss = revealed && hitKind(dart) === "miss";
                    const bust = Boolean(flag?.bust);
                    const skipped = Boolean(flag?.skipped);
                    return `
                        <div class="rv-throw ${revealed ? "is-done" : ""} ${miss ? "is-out" : ""} ${bust ? "is-bust" : ""} ${skipped ? "is-skipped" : ""}">
                            <span class="rv-throw-bar"></span>
                            <span class="rv-throw-hit">${revealed && !skipped ? esc(throwLabel(dart)) : ""}</span>
                        </div>
                    `;
                }).join("")}
            </div>
        `;
    }

    function roundBannerHtml(currentTurn) {
        return `
            <div class="rv-round-banner">
                <span>RONDA</span>
                <strong>${currentTurn?.round || 1}</strong>
            </div>
        `;
    }

    function waitingHtml(ctx) {
        const { modality, players } = ctx || {};
        return `
            <div class="lv-waiting-wrap">
                <div class="lv-waiting">
                    <div class="lv-radar" aria-hidden="true">
                        <span class="lv-radar-ring"></span>
                        <span class="lv-radar-dot"></span>
                        ${icon("target")}
                    </div>
                    <strong>WAITING FOR DARTS</strong>
                    <p title="${esc(recording?.title || `Partida #${matchId}`)}">${esc(displayTitle(recording?.title))}</p>
                    <small>${(modality || detectModality(recording)) === "cricket" ? "Cricket" : "X01"} · ${(players || []).length || buildPlayers(recording, allDarts).length} jugadores${recording?.isFinished ? " · Finalizada" : " · En directo"}</small>
                    <div class="lv-waiting-actions">
                        <button class="btn btn-primary btn-sm" type="button" data-tab="directo">${icon("tv")} Ver directo</button>
                        <a class="btn btn-outline btn-sm" href="#/directo/finalizadas">Volver a finalizadas</a>
                    </div>
                </div>
            </div>
        `;
    }

    function gamesStrip(players, teamMode, isLive) {
        const activeRules = rules || resolveX01Rules(recording);
        const isX01 = detectModality(recording) === "x01";
        return `
            <div class="rv-gamebar">
                <div class="rv-gamechips" role="tablist" aria-label="Juegos de la partida">
                    ${games.map((item) => `
                        <button class="rv-gamechip ${item.game === game ? "is-active" : ""}" type="button"
                                data-game="${item.game}" role="tab" aria-selected="${item.game === game}">
                            <span>J${item.game}</span>
                            <small>${esc(modalityLabel(item.gameType))}</small>
                            ${!item.isFinished ? `<i class="rv-live-dot"></i>` : ""}
                        </button>
                    `).join("")}
                </div>
                ${isX01 ? `
                    <span class="rv-rulesbadge" title="${esc(`${activeRules.startScore} · ${rulesDetailLabel(activeRules)} · ${bullModeLabel(activeRules)} · ${activeRules.rounds} rondas`)}">
                        ${icon("shield")} <b>${activeRules.startScore}</b> <span class="rv-rules-io">${esc(rulesShortLabel(activeRules))}</span> <em>· ${esc(bullModeLabel(activeRules))}</em>
                    </span>
                ` : ""}
                <span class="rv-modebadge">${icon("users")} ${teamMode ? "Equipos" : "Individual"}</span>
                <button class="rv-rosterbtn" type="button" data-roster-open>
                    ${icon("users")} <span>${teamMode ? "Equipos" : "Jugadores"}</span>
                </button>
                ${isLive ? followBadgeHtml() : ""}
            </div>
        `;
    }

    function followBadgeHtml() {
        return liveFollow
            ? `<span class="rv-followbadge is-on"><i></i>EN DIRECTO</span>`
            : `<button class="rv-followbadge is-off" type="button" data-follow>${icon("play")} Ir al directo</button>`;
    }

    function liveControlHtml() {
        return liveFollow
            ? `<button class="rv-livefollow is-on" type="button" data-follow title="Ir a la última tirada del directo"><i></i><span>En directo</span></button>`
            : `<button class="rv-livefollow is-off" type="button" data-follow>${icon("play")}<span>Ir al directo</span></button>`;
    }

    function playerIdsMap() {
        const map = new Map();
        for (const dart of allDarts) {
            if (dart.playerName && dart.playerId) {
                map.set(normalizeName(dart.playerName), dart.playerId);
            }
        }
        return map;
    }

    async function loadTeamRosters() {
        if (rosterAttempted || rosterLoading || teamRosters || !recording || recording.isMock) return;
        const livePlayers = buildPlayers(recording, allDarts);
        if (!detectTeamMode(recording, livePlayers)) return;

        rosterAttempted = true;
        rosterLoading = true;
        rosterFailed = false;
        try {
            const acta = await api.acta(competitionId, matchId, controller.signal);
            if (destroyed || !acta?.rows?.length) return;

            const slots = acta.rows.filter((row) =>
                String(row.nick || "").trim().toUpperCase() !== "JUEGOS");
            if (slots.length < 2) return;

            const perTeam = Math.ceil(slots.length / 2);
            const parse = (rows) => rows
                .map((row) => ({
                    name: String(row.nick || "").trim(),
                    playerId: String(row.name || "").trim(),
                    substitution: row.substitution || null
                }))
                .filter((entry) => entry.name && entry.playerId);

            const team1 = { name: acta.team1 || "Equipo 1", players: parse(slots.slice(0, perTeam)) };
            const team2 = { name: acta.team2 || "Equipo 2", players: parse(slots.slice(perTeam)) };
            if (!team1.players.length && !team2.players.length) return;

            teamRosters = { team1, team2 };
            if (!destroyed) {
                paint();
                if (container.querySelector("[data-roster-overlay]")) openRosterOverlay(currentCtx);
            }
        } catch {
            // Sin acta seguimos mostrando los jugadores que están en pista.
            rosterFailed = true;
            rosterAttempted = false;
        } finally {
            rosterLoading = false;
        }
    }

    function rosterForTeam(team, players) {
        if (!teamRosters) return null;
        const sides = [teamRosters.team1, teamRosters.team2];
        const teamName = normalizeName(team.name);
        const byName = sides.find((side) => normalizeName(side.name) === teamName);
        if (byName) return byName;

        const ids = new Set(team.playerIndices.map((index) => {
            const player = players.find((item) => item.playerIndex === index);
            return player ? playerIdsMap().get(normalizeName(player.name)) : null;
        }).filter(Boolean));
        const names = new Set(team.playerIndices.map((index) => {
            const player = players.find((item) => item.playerIndex === index);
            return player ? normalizeName(player.name) : null;
        }).filter(Boolean));
        return sides.find((side) => side.players.some((entry) =>
            ids.has(entry.playerId) || names.has(normalizeName(entry.name)))) || null;
    }

    function substituteRow(entry, teamIndex) {
        const photo = PHOTO_CACHE.get(normalizeName(entry.name))?.photoUrl
            || (entry.playerId ? `/api/photos/player?userId=${encodeURIComponent(entry.playerId)}` : null);
        return `
            <button class="rv-roster-player is-sub" type="button"
                    data-player-id="${esc(entry.playerId)}" data-player-name="${esc(entry.name)}"
                    title="Ver ficha de ${esc(entry.name)}" style="--team:${panelColor(teamIndex)}">
                <span class="rv-roster-avatar">
                    ${avatarHtml(entry.name, photo, "rv-roster-avatar-fallback")}
                </span>
                <span class="rv-roster-info">
                    <strong>${esc(entry.name)}</strong>
                    <small>Suplente</small>
                </span>
                ${icon("arrow")}
            </button>
        `;
    }

    function rosterBodyHtml(ctx) {
        const { players, teams, scores, currentPlayer, winner, modality } = ctx;
        const activeRules = ctx.rules || rules;
        const teamMode = detectTeamMode(recording, players);
        const revealed = allDarts.slice(0, Math.max(0, Math.min(dartCursor + 1, allDarts.length)));
        const perPlayer = modality === "cricket"
            ? computeCricket(revealed, players.map(singleEntity))
            : computeX01(revealed, players, [], false, activeRules);
        const ratingLabel = modality === "cricket" ? "MPR" : "PPD";
        const winnerKey = normalizeName(winner?.name || "");
        const byIndex = new Map(players.map((player) => [player.playerIndex, player]));

        function rowFor(player, teamIndex, showCrown) {
            const key = normalizeName(player.name);
            const photo = PHOTO_CACHE.get(key);
            const active = player.playerIndex === currentPlayer?.playerIndex;
            const isWinner = showCrown && winnerKey && key === winnerKey;
            const single = perPlayer.find((item) => item.entity.playerIndices.includes(player.playerIndex));
            const rating = modality === "cricket" ? (single?.mpr || 0).toFixed(2) : (single?.average || "0.00");
            const value = modality === "cricket" ? (single?.points || 0) : (single?.remaining || 0);
            const frozen = Boolean(ctx.currentHasCheckout) &&
                player.playerIndex === currentPlayer?.playerIndex &&
                Boolean(ctx.frozenPlayers?.has(player.playerIndex) || single?.frozen);

            return `
                <button class="rv-roster-player ${active ? "is-active" : ""} ${isWinner ? "is-winner" : ""} ${frozen ? "is-frozen" : ""}"
                        type="button" data-player-index="${player.playerIndex}"
                        title="Ver resumen de ${esc(player.name)}" style="--team:${panelColor(teamIndex)}">
                    <span class="rv-roster-avatar">
                        ${avatarHtml(player.name, photo?.photoUrl || null, "rv-roster-avatar-fallback")}
                    </span>
                    <span class="rv-roster-info">
                        <strong>${esc(player.name)} ${frozen ? `<em class="rv-freeze-mark" title="Congelado: no puede cerrar">❄</em>` : ""}</strong>
                        <small>${ratingLabel} ${rating}</small>
                    </span>
                    ${value !== null ? `<span class="rv-roster-value">${formatNumber(value)}</span>` : ""}
                    ${isWinner ? `<span class="rv-roster-crown">${icon("crown")}</span>` : ""}
                </button>
            `;
        }

        let body;
        if (teamMode) {
            body = teams.map((team, index) => {
                const teamScore = scores.find((item) => item.entity.id === team.id);
                const memberScores = modality === "cricket"
                    ? []
                    : team.playerIndices
                        .map((playerIndex) => scores.find((item) => item.playerIndices.includes(playerIndex)))
                        .filter(Boolean);
                const value = modality === "cricket"
                    ? (teamScore?.points ?? memberScores.reduce((sum, item) => sum + (item.points || 0), 0))
                    : (teamScore?.remaining ?? (memberScores.length ? memberScores.reduce((sum, item) => sum + (item.remaining || 0), 0) : activeRules.startScore));
                const active = team.playerIndices.includes(currentPlayer?.playerIndex);
                const isWinner = Boolean(winnerKey) && (
                    normalizeName(team.name) === winnerKey ||
                    memberScores.some((item) => item.checkedOut)
                );
                const valueText = modality === "x01" && !teamScore ? String(Math.round(value)) : formatNumber(value);
                const liveEntries = team.playerIndices.map((playerIndex) => byIndex.get(playerIndex)).filter(Boolean);
                const roster = rosterForTeam(team, players);
                let rows;
                let countText;

                if (roster) {
                    const entries = roster.players.map((entry) => {
                        const live = players.find((player) => {
                            const liveId = playerIdsMap().get(normalizeName(player.name));
                            return normalizeName(player.name) === normalizeName(entry.name) ||
                                (entry.playerId && liveId === entry.playerId);
                        });
                        return { entry, live };
                    });
                    entries.sort((left, right) => Number(Boolean(right.live)) - Number(Boolean(left.live)));
                    const covered = new Set(entries.filter((item) => item.live).map((item) => item.live.playerIndex));
                    const extraLive = liveEntries.filter((player) => !covered.has(player.playerIndex));
                    rows = [
                        ...extraLive.map((player) => rowFor(player, index, false)),
                        ...entries.map(({ entry, live }) => live ? rowFor(live, index, false) : substituteRow(entry, index))
                    ].join("");
                    countText = `${roster.players.length + extraLive.length} componentes · ${liveEntries.length} en pista`;
                } else {
                    rows = liveEntries.map((player) => rowFor(player, index, false)).join("");
                    countText = `${liveEntries.length} en pista`;
                }

                return `
                    <section class="rv-roster-group ${active ? "is-active" : ""} ${isWinner ? "is-winner" : ""}"
                             data-team-id="${esc(team.id)}" style="--team:${panelColor(index)}">
                        <header>
                            <strong>${esc(team.name)}</strong>
                            ${isWinner ? icon("crown") : ""}
                            <span>${valueText}</span>
                        </header>
                        <small class="rv-roster-count">${countText}</small>
                        ${rows}
                    </section>
                `;
            }).join("");
        } else {
            body = players.map((player, index) => rowFor(player, index, true)).join("");
        }

        return `<div class="rv-roster-list">${body}</div>`;
    }

    function openRosterOverlay(ctx, focusTeamId = null) {
        if (!ctx) return;
        closePlayerCard();
        container.querySelector("[data-roster-overlay]")?.remove();
        const teamMode = detectTeamMode(recording, ctx.players);
        const rosterNote = teamMode
            ? (teamRosters ? "Plantillas completas: en pista y banquillo" : rosterFailed ? "No se pudieron cargar las plantillas" : "Cargando todas las plantillas…")
            : "Pulsa un jugador para ver su resumen";

        const overlay = document.createElement("div");
        overlay.className = "rv-overlay";
        overlay.dataset.rosterOverlay = "";
        overlay.innerHTML = `
            <div class="rv-overlay-backdrop" data-overlay-close></div>
            <aside class="rv-drawer" role="dialog" aria-modal="true" aria-label="${teamMode ? "Equipos y plantillas" : "Jugadores de la partida"}">
                <header class="rv-drawer-head">
                    <div>
                        <span class="rv-drawer-kicker">${icon("users")} ${teamMode ? "EQUIPOS" : "JUGADORES"}</span>
                        <strong title="${esc(recording?.title || `Partida #${matchId}`)}">${esc(displayTitle(recording?.title))}</strong>
                        <small>${rosterNote}</small>
                    </div>
                    <button class="rv-drawer-close" type="button" data-overlay-close aria-label="Cerrar">
                        ${icon("close")}
                    </button>
                </header>
                <div class="rv-drawer-body">${rosterBodyHtml(ctx)}</div>
            </aside>
        `;

        container.querySelector(".replay-page")?.appendChild(overlay);
        overlay.querySelectorAll("[data-overlay-close]").forEach((node) => {
            node.addEventListener("click", closeRosterOverlay);
        });
        overlay.querySelectorAll("[data-player-index]").forEach((button) => {
            button.addEventListener("click", () => openPlayerCard(Number(button.dataset.playerIndex), ctx));
        });
        overlay.querySelectorAll("[data-player-id]").forEach((button) => {
            button.addEventListener("click", () => openPlayerCardFor({
                name: button.dataset.playerName,
                playerId: button.dataset.playerId,
                role: "SUPLENTE"
            }, ctx));
        });
        requestAnimationFrame(() => overlay.classList.add("is-open"));
        if (focusTeamId) {
            requestAnimationFrame(() => {
                const group = overlay.querySelector(`[data-team-id="${CSS.escape(focusTeamId)}"]`);
                group?.scrollIntoView({ block: "start", behavior: "smooth" });
            });
        }
    }

    function closeRosterOverlay() {
        closePlayerCard();
        container.querySelector("[data-roster-overlay]")?.remove();
    }

    function closePlayerCard() {
        container.querySelector("[data-player-overlay]")?.remove();
    }

    function openPlayerCard(playerIndex, ctx) {
        const player = ctx.players.find((item) => item.playerIndex === Number(playerIndex));
        if (!player) return;
        openPlayerCardFor({
            name: player.name,
            playerId: playerIdsMap().get(normalizeName(player.name))
        }, ctx);
    }

    async function openPlayerCardFor(player, ctx) {
        if (!player?.name) return;
        const playerId = player.playerId || playerIdsMap().get(normalizeName(player.name)) || null;
        const photo = PHOTO_CACHE.get(normalizeName(player.name))?.photoUrl
            || (playerId ? `/api/photos/player?userId=${encodeURIComponent(playerId)}` : null);

        closePlayerCard();
        const overlay = document.createElement("div");
        overlay.className = "rv-overlay rv-player-overlay";
        overlay.dataset.playerOverlay = "";
        overlay.innerHTML = `
            <div class="rv-overlay-backdrop" data-overlay-close></div>
            <article class="rv-player-card" role="dialog" aria-modal="true" aria-label="Resumen de ${esc(player.name)}">
                <header class="rv-player-card-head">
                    <div class="rv-player-card-avatar">
                        ${avatarHtml(player.name, photo)}
                    </div>
                    <div class="rv-player-card-title">
                        <span>${esc(player.role || "JUGADOR")}</span>
                        <h3>${esc(player.name)}</h3>
                        <p>Cargando resumen deportivo…</p>
                    </div>
                    <button class="rv-drawer-close" type="button" data-overlay-close aria-label="Cerrar">
                        ${icon("close")}
                    </button>
                </header>
                <div class="rv-player-card-body" data-player-card-body>
                    <div class="rv-player-card-loading"><span></span><span></span><span></span></div>
                </div>
            </article>
        `;

        container.querySelector(".replay-page")?.appendChild(overlay);
        overlay.querySelectorAll("[data-overlay-close]").forEach((node) => {
            node.addEventListener("click", closePlayerCard);
        });

        if (!playerId) {
            const body = overlay.querySelector("[data-player-card-body]");
            if (body) {
                body.innerHTML = `<p class="rv-player-card-note">No se pudo identificar este jugador en Radikal.</p>`;
            }
            return;
        }

        try {
            const profile = await api.player(playerId, controller.signal);
            if (destroyed || !container.querySelector("[data-player-overlay]") || !overlay.isConnected) return;
            overlay.querySelector(".rv-player-card-title p")?.remove();
            const body = overlay.querySelector("[data-player-card-body]");
            if (body) body.innerHTML = playerCardBodyHtml(profile, { name: player.name });
        } catch (error) {
            if (destroyed || error?.name === "AbortError") return;
            const body = overlay.querySelector("[data-player-card-body]");
            if (body) {
                body.innerHTML = `<p class="rv-player-card-note">No se pudo cargar el resumen deportivo.</p>`;
            }
        }
    }

    function playerCardBodyHtml(profile, fallbackPlayer) {
        const stats = profile.stats || [];
        const ppdStats = stats.find((item) => item.game === "PPD");
        const mprStats = stats.find((item) => item.game === "MPR");
        const primary = ppdStats || mprStats;
        const shared = Boolean(profile.ratingsShared);
        const competitions = profile.competitions || [];
        const activeCompetitions = competitions.filter((item) => !item.finished).length;
        const diana = profile.preferredDiana
            ? `Diana ${esc(DIANA_LABELS[profile.preferredDiana] || profile.preferredDiana)}`
            : "";
        const country = profile.countryName || profile.countryCode || "";

        const ratingTiles = shared
            ? `
                <div class="rv-player-ratings">
                    <div class="rv-player-rating">
                        <span>PPD</span>
                        <strong>${esc(ratingValue(profile.ratingPpd))}</strong>
                    </div>
                    <div class="rv-player-rating">
                        <span>MPR</span>
                        <strong>${esc(ratingValue(profile.ratingMpr))}</strong>
                    </div>
                </div>
            `
            : `<p class="rv-player-card-note">Este jugador no comparte sus medias.</p>`;

        const statTiles = [
            { label: "Partidas", value: primary?.games },
            { label: "Victorias", value: primary?.wins },
            { label: "Win rate", value: primary ? `${primary.winPercent}%` : null },
            { label: "Bulls", value: statValue(ppdStats, "Bulls") ?? statValue(mprStats, "Bulls") }
        ].filter((tile) => tile.value !== null && tile.value !== undefined && tile.value !== "");

        return `
            <div class="rv-player-card-badges">
                ${country ? `<span>${icon("globe")} ${esc(country)}</span>` : ""}
                ${profile.team ? `<span>${icon("users")} ${esc(profile.team)}</span>` : ""}
                ${diana ? `<span>${icon("target")} ${diana}</span>` : ""}
            </div>
            ${ratingTiles}
            <div class="rv-player-stat-grid">
                ${statTiles.map((tile) => `
                    <div class="rv-player-stat">
                        <strong>${esc(tile.value)}</strong>
                        <span>${esc(tile.label)}</span>
                    </div>
                `).join("")}
            </div>
            <div class="rv-player-card-block">
                <div class="rv-player-card-block-head">
                    <span>Competiciones</span>
                    <small>${activeCompetitions} en curso</small>
                </div>
                ${competitions.length ? `
                    <div class="rv-player-comp-list">
                        ${competitions.slice(0, 4).map((competition) => `
                            <span class="${competition.finished ? "is-finished" : ""}">
                                ${esc(competition.name)}
                            </span>
                        `).join("")}
                    </div>
                ` : `<p class="rv-player-card-note">Sin competiciones registradas.</p>`}
            </div>
            <a class="rv-player-card-link" href="#/jugador/${encodeURIComponent(profile.radikalId || profile.userId || "")}">
                Abrir ficha completa ${icon("arrow")}
            </a>
        `;
    }

    function statValue(stats, label) {
        return stats?.stats?.find((item) => item.label === label)?.value ?? null;
    }

    function summaryHtml(ctx) {
        const { players, entities, modality, finalScores, winner } = ctx;
        const activeRules = ctx.rules || rules;
        const teamMode = detectTeamMode(recording, players);
        const winnerEntity = winner
            ? entities.find((entity) =>
                (winner.id && entity.id === winner.id) ||
                normalizeName(entity.name) === normalizeName(winner.name) ||
                (winner.playerIndices &&
                 winner.playerIndices.length === entity.playerIndices.length &&
                 winner.playerIndices.every((index) => entity.playerIndices.includes(index))))
            : null;
        const winnerIndex = winnerEntity ? entities.indexOf(winnerEntity) : 0;
        const entriesFor = (entity) => finalScores.filter((score) =>
            score.entity?.id === entity.id ||
            (score.playerIndices && entity.playerIndices.some((index) => score.playerIndices.includes(index))));
        const statFor = (entity) => {
            const entries = entriesFor(entity);
            const scored = entries.reduce((sum, item) => sum + (item.scored || 0), 0);
            const darts = entries.reduce((sum, item) => sum + (item.darts || 0), 0);
            const remaining = entries.reduce((sum, item) => sum + (item.remaining || 0), 0);
            return {
                scored,
                darts,
                remaining,
                average: darts ? (scored / darts).toFixed(2) : "0.00",
                checkedOut: entries.some((item) => item.checkedOut)
            };
        };
        const winnerScore = winnerEntity ? statFor(winnerEntity) : null;
        const winnerPlayer = teamMode && winnerEntity
            ? (() => {
                const checked = entriesFor(winnerEntity).find((item) => item.checkedOut);
                const checkedIndex = checked?.checkedOutBy ?? checked?.playerIndices?.[0];
                return players.find((player) => player.playerIndex === checkedIndex)
                    || players.find((player) => winnerEntity.playerIndices.includes(player.playerIndex))
                    || winnerEntity.players?.[0];
            })()
            : players.find((player) => normalizeName(player.name) === normalizeName(winner?.name || "")) || players[0];
        const winnerPlayerScore = winnerPlayer && modality === "x01"
            ? finalScores.find((score) => score.playerIndices?.includes(winnerPlayer.playerIndex))
            : null;
        const winnerMembers = teamMode && winnerEntity
            ? players.filter((player) => winnerEntity.playerIndices.includes(player.playerIndex))
            : [];
        const cricketPerPlayer = modality === "cricket"
            ? computeCricket(allDarts, players.map(singleEntity))
            : null;
        const cricketMprFor = (entity) => {
            if (!entity) return 0;
            const scores = entity.playerIndices
                .map((index) => cricketPerPlayer?.find((item) => item.entity.playerIndices.includes(index)))
                .filter(Boolean);
            if (!scores.length) return 0;
            return scores.reduce((sum, item) => sum + (item.mpr || 0), 0) / scores.length;
        };
        const memberStat = (player) => {
            if (modality === "cricket") {
                const single = cricketPerPlayer?.find((item) => item.entity.playerIndices.includes(player.playerIndex));
                return {
                    player,
                    value: single?.points || 0,
                    darts: single?.darts || 0,
                    rating: (single?.mpr || 0).toFixed(2),
                    checkedOut: false
                };
            }
            const entries = winnerEntity ? entriesFor(winnerEntity) : [];
            const entry = entries.find((item) => item.playerIndices?.includes(player.playerIndex)) || entries[0] || null;
            const member = entry?.members?.find((item) => item.playerIndex === player.playerIndex);
            if (member) {
                return {
                    player,
                    value: member.scored || 0,
                    darts: member.darts || 0,
                    rating: member.average || "0.00",
                    checkedOut: false
                };
            }
            return {
                player,
                value: entry?.scored || 0,
                darts: entry?.darts || 0,
                rating: entry?.average || "0.00",
                checkedOut: Boolean(entry?.checkedOut)
            };
        };
        const winnerMemberStats = winnerMembers.map(memberStat);
        const photo = winnerPlayer ? PHOTO_CACHE.get(normalizeName(winnerPlayer.name)) : null;
        const ratingLabel = modality === "cricket" ? "MPR" : "PPD";
        const ratingValue = modality === "cricket"
            ? cricketMprFor(winnerEntity).toFixed(2)
            : (teamMode
                ? (winnerScore?.average || "0.00")
                : (winnerPlayerScore?.average || "0.00"));
        const heroName = teamMode && winnerEntity
            ? winnerEntity.name
            : (winnerPlayer?.name || winnerEntity?.name || winner?.name || "Partida finalizada");
        const winnerSubtitle = teamMode && winnerMembers.length
            ? winnerMembers.map((player) => player.name).join(" · ")
            : "";

        const series = entities.map((entity, index) => ({
            name: entity.name,
            color: panelColor(index),
            wins: games.filter((item) =>
                item.isFinished && item.winner && normalizeName(item.winner) === normalizeName(entity.name)).length
        }));
        const hasSeries = games.length > 1 && series.some((item) => item.wins > 0);

        const stats = entities.map((entity, index) => {
            const item = statFor(entity);
            const isWinner = winnerEntity ? entity.id === winnerEntity.id : false;
            return {
                name: entity.name,
                color: panelColor(index),
                value: modality === "cricket"
                    ? (finalScores.find((score) => score.entity.id === entity.id)?.points || 0)
                    : item.scored,
                darts: item.darts,
                rating: modality === "cricket"
                    ? cricketMprFor(entity).toFixed(2)
                    : item.average,
                isWinner
            };
        });

        return `
            <section class="rv-summary">
                <div class="rv-summary-hero ${teamMode ? "is-team" : ""}" style="--accent:${panelColor(winnerIndex)}">
                    <span class="rv-summary-kicker">${icon("crown")} ${teamMode && winnerMemberStats.length > 1 ? "GANADORES" : "GANADOR"}</span>
                    ${teamMode && winnerMemberStats.length ? `
                        <div class="rv-summary-winners ${winnerMemberStats.length > 2 ? "is-many" : ""} ${winnerMemberStats.length === 1 ? "is-single" : ""}">
                            ${winnerMemberStats.map((member) => `
                                <article class="rv-summary-winner ${member.checkedOut ? "is-checkout" : ""}">
                                    <div class="rv-summary-winner-photo">${avatarFor(member.player)}</div>
                                    <strong class="rv-summary-winner-name">${esc(member.player.name)}</strong>
                                    <div class="rv-summary-winner-media">
                                        <b>${member.rating}</b>
                                        <span>${ratingLabel}</span>
                                    </div>
                                </article>
                            `).join("")}
                        </div>
                        <h2>${esc(winnerEntity?.name || heroName)}</h2>
                    ` : `
                        <div class="rv-summary-photo">
                            ${winnerPlayer ? avatarFor(winnerPlayer) : ""}
                        </div>
                        <h2>${esc(heroName)}</h2>
                        <p>${esc(winnerSubtitle)}</p>
                        <div class="rv-summary-rating">
                            <strong>${ratingValue}</strong>
                            <span>${ratingLabel}</span>
                        </div>
                    `}
                </div>

                ${modality === "x01" ? `
                    <div class="rv-summary-rules">
                        <span>${icon("target")} ${activeRules.startScore}</span>
                        <span>${icon("shield")} ${esc(rulesShortLabel(activeRules))}</span>
                        <span>${icon("target")} ${esc(bullModeLabel(activeRules))}</span>
                        <span>${icon("clock")} ${activeRules.rounds} rondas</span>
                        ${teamMode ? `<span>${icon("users")} ${activeRules.stacked ? "Marcador compartido" : "Marcadores separados"}</span>` : ""}
                    </div>
                ` : ""}

                <div class="rv-summary-stats">
                    ${stats.map((stat) => `
                        <article class="rv-summary-stat ${stat.isWinner ? "is-winner" : ""}" style="--team:${stat.color}">
                            <header>
                                <strong>${esc(stat.name)}</strong>
                                ${stat.isWinner ? icon("crown") : ""}
                            </header>
                            <div class="rv-summary-stat-main">
                                ${formatNumber(stat.value)}
                                <small>puntos</small>
                            </div>
                            <footer>
                                <span>${ratingLabel} ${stat.rating}</span>
                            </footer>
                        </article>
                    `).join("")}
                </div>

                ${hasSeries ? `
                    <div class="rv-summary-series" aria-label="Juegos ganados">
                        ${series.map((item) => `
                            <span style="--team:${item.color}"><strong>${item.wins}</strong>${esc(item.name)}</span>
                        `).join("")}
                    </div>
                ` : ""}

                <div class="rv-summary-actions">
                    <button class="rv-summary-btn is-primary" type="button" data-replay-start>
                        ${icon("refresh")} Repetir
                    </button>
                    <button class="rv-summary-btn" type="button" data-tab="directo">
                        ${icon("tv")} Directo
                    </button>
                    <a class="rv-summary-btn" href="#/directo/finalizadas">
                        ${icon("list")} Finalizadas
                    </a>
                </div>
            </section>
        `;
    }

    function cricketHitHtml(dart) {
        const info = hitDisplay(dart);
        return `
            <div class="rv-hit-badge rv-cricket-hit ${info.className}" style="--hit-color:${info.color}">
                <strong>${esc(info.notation)}</strong>
            </div>
        `;
    }

    function x01Panels(ctx) {
        const { scores, currentPlayer, winner, players, teams } = ctx;
        const activeRules = ctx.rules || rules;
        const teamMode = detectTeamMode(recording, players);
        const stacked = Boolean(teamMode && activeRules?.stacked);
        const activePlayerIndex = currentPlayer?.playerIndex;
        const winnerKey = normalizeName(winner?.name || "");
        const scoreFor = (playerIndex) => scores.find((score) => score.playerIndices.includes(playerIndex)) || null;
        const teamScore = (team) => scores.find((score) => score.entity.id === team.id) || null;
        const pendingActive = Boolean(ctx.scorePending);

        const miniRow = (item) => (item?.lastTurn || []).slice(-3).map((dart) => {
            const flag = ctx.dartFlags?.get(dart.index);
            return `<span class="rv-mini ${dartKindClass(dart)} ${flag?.bust ? "is-bust" : ""}">${esc(throwNotation(dart))}</span>`;
        }).join("");

        const memberRow = (player, value, frozen, note) => `
            <span class="rv-score-member ${frozen ? "is-frozen" : ""}" ${frozen ? `title="${esc(player.name)} está congelado: no puede cerrar hasta que su compañero baje"` : ""}>
                <strong>${esc(player.name)}</strong>
                <span>${formatNumber(value)}${frozen ? `<em class="rv-freeze-mark" aria-hidden="true">❄</em>` : ""}${note ? `<em class="rv-member-note">${esc(note)}</em>` : ""}</span>
            </span>
        `;

        const memberTile = (player, item, frozen) => {
            const remaining = item?.remaining ?? activeRules.startScore;
            const darts = item?.darts || 0;
            const average = item?.average || "0.00";
            const meta = darts ? `${average} PPD` : "";
            return `
                <div class="rv-score-member rv-score-member--big ${frozen ? "is-frozen" : ""}"
                     ${frozen ? `title="${esc(player.name)} está congelado: no puede cerrar hasta que su compañero baje"` : ""}>
                    <strong class="rv-member-name">${esc(player.name)}${frozen ? `<em class="rv-freeze-mark" aria-hidden="true">❄</em>` : ""}</strong>
                    <b class="rv-member-score">${formatNumber(remaining)}</b>
                    ${meta ? `<small class="rv-member-meta">${meta}</small>` : ""}
                </div>
            `;
        };

        const card = (entity, item, members, active, isWinner, value, animate, options = {}) => `
            <article class="rv-score ${options.membersClass === "is-split" ? "is-team-split" : ""} ${active ? "is-active" : ""} ${isWinner ? "is-winner" : ""}"
                     style="--team:${panelColor(teamMode ? teams.indexOf(entity) : players.findIndex((player) => player.name === entity.name))}">
                <header>
                    ${options.teamId
                        ? `<button class="rv-score-team-name" type="button" data-team-open="${esc(options.teamId)}" title="Ver plantilla completa de ${esc(entity.name)}">${esc(entity.name)}</button>`
                        : `<strong>${esc(entity.name)}</strong>`}
                    ${isWinner ? `<span class="rv-crown">${icon("crown")}</span>` : ""}
                    ${active && !isWinner ? `<i class="rv-turn-dot" aria-hidden="true"></i>` : ""}
                </header>
                ${options.mainLabel ? `<span class="rv-score-main-label">${esc(options.mainLabel)}</span>` : ""}
                <div class="rv-score-main" ${animate ? "data-score-panel" : ""}>${options.rawValue ? Math.round(Number(value) || 0) : formatNumber(value)}</div>
                ${members.length ? `<div class="rv-score-members ${options.membersClass || ""}">${members.join("")}</div>` : ""}
                <footer>
                    <span class="rv-minirow">${miniRow(item)}</span>
                </footer>
            </article>
        `;

        if (!teamMode) {
            return `
                <section class="rv-scores">
                    ${players.map((player, index) => {
                        const item = scoreFor(player.playerIndex);
                        const active = player.playerIndex === activePlayerIndex;
                        const isWinner = winnerKey && normalizeName(player.name) === winnerKey;
                        const value = active && pendingActive ? ctx.displayRemaining : item?.remaining;
                        return card(singleEntity(player), item, [], active, isWinner, value ?? activeRules.startScore, active && pendingActive);
                    }).join("")}
                </section>
            `;
        }

        if (stacked) {
            return `
                <section class="rv-scores">
                    ${teams.map((team, index) => {
                        const item = teamScore(team);
                        const active = team.playerIndices.includes(activePlayerIndex);
                        const isWinner = winnerKey && normalizeName(team.name) === winnerKey;
                        const members = team.playerIndices.map((playerIndex) => {
                            const player = players.find((candidate) => candidate.playerIndex === playerIndex);
                            const member = item?.members?.find((candidate) => candidate.playerIndex === playerIndex);
                            return player ? memberRow(player, member?.scored || 0, false) : "";
                        }).filter(Boolean);
                        const value = active && pendingActive ? ctx.displayRemaining : item?.remaining;
                        return card(team, item, members, active, isWinner, value ?? activeRules.startScore, active && pendingActive, { mainLabel: "EQUIPO", teamId: team.id });
                    }).join("")}
                </section>
            `;
        }

        // Equipos con marcadores separados: cada jugador manda y el global es la suma.
        return `
            <section class="rv-scores">
                ${teams.map((team) => {
                    const members = team.playerIndices.map((playerIndex) => {
                        const player = players.find((candidate) => candidate.playerIndex === playerIndex);
                        return player ? { player, item: scoreFor(playerIndex) } : null;
                    }).filter(Boolean);
                    const activeMember = members.find((member) => member.player.playerIndex === activePlayerIndex);
                    const active = Boolean(activeMember);
                    const isWinner = Boolean(winnerKey) && (
                        normalizeName(team.name) === winnerKey ||
                        members.some((member) => member.item?.checkedOut)
                    );
                    const primary = activeMember?.item || members[0]?.item || null;
                    const values = members.map((member) => member.item?.remaining ?? activeRules.startScore);
                    const globalTarget = values.reduce((sum, value) => sum + value, 0);
                    const activeTarget = activeMember?.item?.remaining ?? 0;
                    const globalValue = active && pendingActive
                        ? globalTarget - activeTarget + (ctx.displayRemaining ?? activeTarget)
                        : globalTarget;
                    const rows = members.map((member) => {
                        const frozen = member.player.playerIndex === ctx.currentPlayer?.playerIndex &&
                            ctx.currentHasCheckout &&
                            Boolean(ctx.frozenPlayers?.has(member.player.playerIndex) || member.item?.frozen);
                        return memberTile(member.player, member.item, frozen);
                    });
                    return card(team, primary, rows, active, isWinner, globalValue, active && pendingActive, {
                        mainLabel: "GLOBAL",
                        membersClass: "is-split",
                        rawValue: true,
                        teamId: team.id
                    });
                }).join("")}
            </section>
        `;
    }

    function cricketGrid(ctx) {
        const { entities, scores, currentPlayer, currentDart, players } = ctx;
        const teamMode = detectTeamMode(recording, players);

        return `
            <div class="rv-cricket">
                <div class="rv-cricket-head">
                    <span class="rv-cricket-title">CRICKET</span>
                    ${CRICKET_TARGETS.map((target) => `
                        <span class="rv-target ${target === 25 ? "is-bull" : ""}">${target === 25 ? "BULL" : target}</span>
                    `).join("")}
                </div>

                ${entities.map((entity, index) => {
                    const item = scores.find((score) => score.entity.id === entity.id);
                    const active = entity.playerIndices.includes(currentPlayer.playerIndex);
                    const isWinner = ctx.winner && normalizeName(ctx.winner.name) === normalizeName(entity.name);
                    const hitTarget = currentDart && entity.playerIndices.includes(currentDart.playerIndex)
                        ? cricketTarget(currentDart)
                        : null;
                    const playerScores = ctx.cricketPlayerScores || [];
                    const memberMprs = entity.playerIndices
                        .map((playerIndex) => playerScores.find((score) => score.playerIndices.includes(playerIndex))?.mpr)
                        .filter((value) => Number.isFinite(value));
                    const mpr = memberMprs.length
                        ? memberMprs.reduce((sum, value) => sum + value, 0) / memberMprs.length
                        : (item?.mpr || 0);

                    return `
                        <div class="rv-cricket-row ${active ? "is-active" : ""} ${isWinner ? "is-winner" : ""}"
                             style="--team:${panelColor(index)}">
                            <div class="rv-cricket-player">
                                <strong>${esc(teamMode ? entity.name : entity.shortName)}</strong>
                                <span>${formatNumber(item?.points || 0)}</span>
                                <small>MPR ${mpr.toFixed(2)}</small>
                            </div>
                            ${CRICKET_TARGETS.map((target) => {
                                const marks = item?.marks?.[target] || 0;
                                return `
                                    <div class="rv-cell ${marks >= 3 ? "is-closed" : ""} ${hitTarget === target ? "is-hot" : ""}">
                                        ${markGlyph(marks)}
                                    </div>
                                `;
                            }).join("")}
                        </div>
                    `;
                }).join("")}
            </div>
        `;
    }

    function controlsHtml(currentTurn, isLive = false) {
        const max = maxCursorFor();
        const label = dartCursor < 0
            ? "Inicio"
            : dartCursor >= allDarts.length
                ? "Final"
                : `${dartCursor + 1} / ${allDarts.length}`;

        return `
            <footer class="rv-controls">
                <div class="rv-ctrl-group">
                    <button class="rv-ctrl" type="button" data-first title="Inicio, antes de la primera tirada" aria-label="Inicio">${icon("skipBack")}</button>
                    <button class="rv-ctrl" type="button" data-prev title="Dardo anterior" aria-label="Dardo anterior">${icon("chevronLeft")}</button>
                    <button class="rv-play" type="button" data-play aria-label="${playing ? "Pausa" : "Reproducir"}">
                        ${playing ? icon("pause") : icon("play")}
                    </button>
                    <button class="rv-ctrl" type="button" data-next title="Dardo siguiente" aria-label="Dardo siguiente">${icon("chevronRight")}</button>
                    <button class="rv-ctrl" type="button" data-last title="Final y resumen" aria-label="Final y resumen">${icon("skipForward")}</button>
                </div>

                <div class="rv-progress">
                    ${isLive ? liveControlHtml() : ""}
                    <input type="range" min="-1" max="${max}" value="${dartCursor}" data-progress aria-label="Progreso dardo a dardo" />
                    <span>${label}</span>
                </div>

                <div class="rv-speed" role="group" aria-label="Velocidad">
                    ${SPEEDS.map((value) => `
                        <button class="${value === speed ? "is-active" : ""}" type="button" data-speed="${value}">${value}×</button>
                    `).join("")}
                </div>

                <div class="rv-rounds">
                    ${roundButtons().map((round) => `
                        <button class="${currentTurn && round.round === currentTurn.round ? "is-active" : ""}" type="button"
                                data-round="${round.round}" title="Ronda ${round.round}">
                            ${round.round}
                        </button>
                    `).join("")}
                </div>
            </footer>
        `;
    }

    /* =================================================================
       Chat del directo
       ================================================================= */

    function chatHtml() {
        const me = getCurrentPlayer();
        const canChat = Boolean(me);
        return `
            <aside class="replay-chat rv-chat" id="rv-chat" aria-label="Chat del directo">
                <header class="replay-chat-head">
                    <div class="rv-chat-head-copy">
                        <span class="replay-kicker">${icon("message")}Chat del directo</span>
                        <small data-chat-count></small>
                    </div>
                    <button class="rv-chat-close" type="button" data-chat-close aria-label="Cerrar chat">
                        ${icon("close")}
                    </button>
                </header>
                <div class="replay-chat-list" data-chat-list>
                    <p class="replay-chat-empty">Cargando mensajes…</p>
                </div>
                ${canChat ? `
                    <form class="replay-chat-form" data-chat-form>
                        <span class="rv-chat-as">${icon("shield")} Hablas como <strong>${esc(me.alias || me.dni)}</strong></span>
                        <div class="replay-chat-row">
                            <input class="replay-chat-input" data-chat-input maxlength="400" placeholder="Escribe al directo…"
                                   autocomplete="off" enterkeyhint="send">
                            <button class="replay-chat-send" type="submit" data-chat-send aria-label="Enviar mensaje" title="Enviar mensaje">
                                ${icon("send")}
                            </button>
                        </div>
                    </form>
                ` : `
                    <div class="replay-chat-gate">
                        <span class="rv-chat-gate-icon">${icon("shield")}</span>
                        <strong>Inicia sesión para escribir</strong>
                        <p>Puedes leer el chat, pero para participar necesitas tu cuenta Radikal.</p>
                        <button class="btn btn-primary btn-sm" type="button" data-chat-login>
                            ${icon("users")} Iniciar sesión
                        </button>
                    </div>
                `}
            </aside>
        `;
    }

    /* =================================================================
       Eventos
       ================================================================= */

    function bind({ players, isFinalDart, winner }) {
        container.querySelectorAll("[data-tab]").forEach((button) => {
            if (button.closest(".rv-game")) return;
            button.addEventListener("click", () => setTab(button.dataset.tab));
        });

        container.querySelector("[data-sound]")?.addEventListener("click", () => {
            sound = !sound;
            localStorage.setItem("replay-audio", sound ? "1" : "0");
            if (sound) {
                ensureAudioContext();
                if (allDarts[dartCursor]) announceDart(allDarts[dartCursor]);
            }
            paint();
        });

        container.querySelector("[data-fullscreen]")?.addEventListener("click", () => {
            if (tab === "directo" && container.querySelector(".rv-official-frame iframe")) {
                toggleVideoTheater();
            } else {
                toggleFullscreen();
            }
        });

        container.querySelectorAll("[data-video-fullscreen]").forEach((button) => {
            button.addEventListener("click", (event) => {
                event.preventDefault();
                toggleVideoTheater();
            });
        });
        container.querySelectorAll("[data-video-reload]").forEach((button) => {
            button.addEventListener("click", (event) => {
                event.preventDefault();
                reloadVideo();
            });
        });

        container.querySelectorAll("[data-roster-open]").forEach((button) => {
            if (button.closest(".rv-game")) return;
            button.addEventListener("click", () => openRosterOverlay(currentCtx));
        });

        bindGameControls();
        bindChat();
        onFullscreenChange();
    }

    function bindGameControls() {
        container.querySelectorAll("[data-game]").forEach((button) => {
            button.addEventListener("click", () => {
                const next = Number(button.dataset.game);
                if (!next || next === game) return;
                stopPlayback();
                exitVideoTheater();
                window.location.hash = `#/directo/finalizadas/${competitionId}/${matchId}/${next}${tab === "partida" ? "?tab=partida" : ""}`;
            });
        });

        container.querySelectorAll("[data-follow]").forEach((button) => {
            button.addEventListener("click", () => {
                liveFollow = true;
                liveQueue = [];
                dartCursor = maxCursorFor();
                paint();
            });
        });

        container.querySelectorAll(".rv-game [data-tab]").forEach((button) => {
            button.addEventListener("click", () => setTab(button.dataset.tab));
        });

        container.querySelectorAll(".rv-game [data-roster-open]").forEach((button) => {
            button.addEventListener("click", () => openRosterOverlay(currentCtx));
        });

        container.querySelectorAll(".rv-game [data-team-open]").forEach((button) => {
            button.addEventListener("click", () => openRosterOverlay(currentCtx, button.dataset.teamOpen));
        });

        container.querySelector("[data-replay-start]")?.addEventListener("click", () => {
            liveFollow = false;
            setDart(-1);
        });

        container.querySelector("[data-play]")?.addEventListener("click", () => {
            if (playing) stopPlayback();
            else startPlayback();
        });

        container.querySelector("[data-prev]")?.addEventListener("click", () => setDart(dartCursor - 1));
        container.querySelector("[data-next]")?.addEventListener("click", () => setDart(nextPlayableCursor(dartCursor)));
        container.querySelector("[data-first]")?.addEventListener("click", () => setDart(-1));
        container.querySelector("[data-last]")?.addEventListener("click", () => setDart(maxCursorFor()));

        const progress = container.querySelector("[data-progress]");
        if (progress) {
            progress.dataset.ready = "";
            requestAnimationFrame(() => {
                progress.value = String(dartCursor);
                progress.dataset.ready = "1";
            });
            progress.addEventListener("input", (event) => {
                if (event.currentTarget.dataset.ready !== "1") return;
                stopPlayback();
                setDart(Number(event.target.value));
            });
        }

        container.querySelectorAll("[data-round]").forEach((button) => {
            button.addEventListener("click", () => {
                stopPlayback();
                const round = roundButtons().find((item) => String(item.round) === String(button.dataset.round));
                if (round) setDart(round.firstIndex);
            });
        });

        container.querySelectorAll("[data-speed]").forEach((button) => {
            button.addEventListener("click", () => {
                speed = Number(button.dataset.speed) || 1;
                localStorage.setItem("replay-speed", String(speed));
                if (playing) {
                    clearTimeout(playTimer);
                    scheduleNext();
                }
                paint();
            });
        });
    }

    function setTab(next) {
        const value = next === "partida" ? "partida" : "directo";
        if (tab === value) return;
        closeRosterOverlay();
        exitVideoTheater();
        tab = value;
        stopPlayback();
        if (liveDrainTimer) {
            clearTimeout(liveDrainTimer);
            liveDrainTimer = null;
        }
        liveQueue = [];
        dartCursor = recording?.isFinished ? -1 : maxCursorFor();
        liveFollow = !recording?.isFinished;
        const base = `#/directo/finalizadas/${competitionId}/${matchId}/${game}`;
        history.replaceState(null, "", value === "partida" ? `${base}?tab=partida` : base);
        paint();
    }

    /* =================================================================
       Reproducción dardo a dardo
       ================================================================= */

    function setDart(index, options = {}) {
        if (!allDarts.length) return;
        const max = maxCursorFor();
        const clamped = Math.max(-1, Math.min(max, index));
        if (clamped === dartCursor && options.force !== true) return;
        const forward = clamped === dartCursor + 1;
        liveFollow = false;
        dartCursor = clamped;
        if (dartCursor < max) confettiShown = false;
        paint({ flash: options.flash !== false, scoreAnim: forward });
        if (options.announce !== false && dartCursor >= 0 && dartCursor < allDarts.length) {
            announceDart(allDarts[dartCursor]);
        }
    }

    function startPlayback() {
        if (!allDarts.length) return;
        if (sound) ensureAudioContext();
        liveFollow = false;
        if (dartCursor >= maxCursorFor()) {
            dartCursor = -1;
            confettiShown = false;
            paint({ flash: true });
        }
        playing = true;
        paint({ flash: true });
        if (dartCursor >= 0 && dartCursor < allDarts.length) announceDart(allDarts[dartCursor]);
        scheduleNext();
    }

    function scheduleNext() {
        if (!playing || destroyed) return;
        if (playTimer) clearTimeout(playTimer);

        const current = allDarts[dartCursor];
        const next = allDarts[dartCursor + 1];
        const gap = current && next && current.playerIndex !== next.playerIndex ? TURN_GAP_MS : 0;

        playTimer = setTimeout(() => {
            if (!playing || destroyed) return;
            if (dartCursor >= maxCursorFor()) {
                stopPlayback();
                return;
            }
            dartCursor += 1;
            if (currentCtx?.skipped?.has(dartCursor)) {
                dartCursor = nextPlayableCursor(dartCursor);
            }
            paint({ flash: true, scoreAnim: true });
            if (dartCursor >= 0 && dartCursor < allDarts.length) announceDart(allDarts[dartCursor]);
            scheduleNext();
        }, (BASE_DART_MS + gap) / speed);
    }

    function stopPlayback() {
        playing = false;
        if (playTimer) {
            clearTimeout(playTimer);
            playTimer = null;
        }
        if (!destroyed) paint();
    }

    function announceDart(dart) {
        if (!dart) return;
        const ctx = currentCtx;
        const turnTotal = Number(ctx?.turnTotal) || 0;
        const remainingAfter = ctx?.currentScore?.remaining ?? null;
        const modality = ctx?.modality || detectModality(recording);
        const flags = ctx?.dartFlags?.get(dart.index) || null;

        if (sound) {
            if (flags?.bust) {
                playBustSound();
            } else {
                playHitSound(dart, { turnTotal, remainingAfter, modality });
                if (flags?.frozen && ctx?.currentHasCheckout) playFreezeSound();
            }
        }
    }

    /* =================================================================
       Pantalla completa
       ================================================================= */

    function onKeyDown(event) {
        if (destroyed || tab !== "partida" || !allDarts.length) return;
        const target = event.target;
        if (target?.closest?.("input, textarea, select") || target?.isContentEditable) return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;

        if (event.key === "ArrowRight") {
            event.preventDefault();
            setDart(nextPlayableCursor(dartCursor));
        } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            setDart(dartCursor - 1);
        } else if (event.key === " ") {
            event.preventDefault();
            if (playing) stopPlayback();
            else startPlayback();
        } else if (event.key === "Home") {
            event.preventDefault();
            setDart(-1);
        } else if (event.key === "End") {
            event.preventDefault();
            setDart(maxCursorFor());
        } else if (event.key.toLowerCase() === "f") {
            event.preventDefault();
            toggleFullscreen();
        } else if (event.key.toLowerCase() === "m") {
            event.preventDefault();
            container.querySelector("[data-sound]")?.click();
        }
    }

    function toggleFullscreen() {
        const page = container.querySelector(".replay-page");
        if (!page) return;

        const fallback = () => {
            page.classList.toggle("is-cinema");
            onFullscreenChange();
        };

        if (document.fullscreenElement) {
            Promise.resolve(document.exitFullscreen?.()).catch(fallback).finally(onFullscreenChange);
            return;
        }

        // Si ya estamos en modo cine (navegador sin Fullscreen API), salimos.
        if (page.classList.contains("is-cinema")) {
            fallback();
            return;
        }

        if (document.fullscreenEnabled && typeof page.requestFullscreen === "function") {
            let settled = false;
            const timer = window.setTimeout(() => {
                // El navegador no respondió (permisos/iframe): maximizamos dentro de la app.
                if (!settled && !document.fullscreenElement) {
                    page.classList.add("is-cinema");
                    onFullscreenChange();
                }
            }, 1200);

            const result = page.requestFullscreen();
            if (result?.then) {
                result.then(() => {
                    settled = true;
                    clearTimeout(timer);
                    page.classList.remove("is-cinema");
                    onFullscreenChange();
                }).catch(() => {
                    settled = true;
                    clearTimeout(timer);
                    if (!document.fullscreenElement) {
                        page.classList.add("is-cinema");
                        onFullscreenChange();
                    }
                });
            } else {
                clearTimeout(timer);
                fallback();
            }
            return;
        }

        fallback();
    }

    function officialFrame() {
        return container.querySelector(".rv-official-frame iframe");
    }

    function videoTheaterActive() {
        return Boolean(container.querySelector(".replay-page.is-video-fullscreen"));
    }

    function toggleVideoTheater() {
        if (videoTheaterActive()) exitVideoTheater();
        else enterVideoTheater();
    }

    function enterVideoTheater() {
        const page = container.querySelector(".replay-page");
        if (!page || !officialFrame()) return;
        page.classList.add("is-video-fullscreen");
        document.body.classList.add("is-video-theater");
        updateVideoTheaterUi(true);
    }

    function exitVideoTheater() {
        const page = container.querySelector(".replay-page");
        page?.classList.remove("is-video-fullscreen");
        document.body.classList.remove("is-video-theater");
        updateVideoTheaterUi(false);
    }

    function updateVideoTheaterUi(active) {
        container.querySelectorAll("[data-video-fullscreen]").forEach((button) => {
            button.innerHTML = `${icon(active ? "minimize" : "maximize")}<span>${active ? "Salir" : "Pantalla completa"}</span>`;
            button.title = active ? "Salir de pantalla completa" : "Pantalla completa del vídeo";
            button.setAttribute("aria-label", button.title);
            button.classList.toggle("is-on", active);
        });
    }

    function onTheaterKeyDown(event) {
        if (event.key === "Escape" && videoTheaterActive()) {
            event.preventDefault();
            exitVideoTheater();
        }
    }

    function reloadVideo() {
        const frame = officialFrame();
        if (!frame) return;
        frame.src = `${officialViewerUrl()}&t=${Date.now()}`;
    }

    function onFullscreenChange() {
        const active = Boolean(document.fullscreenElement) || Boolean(container.querySelector(".replay-page.is-cinema"));
        const button = container.querySelector("[data-fullscreen]");
        if (!button) return;
        button.innerHTML = icon(active ? "minimize" : "maximize");
        button.title = active ? "Salir de pantalla completa" : "Pantalla completa";
        button.setAttribute("aria-label", button.title);
        button.classList.toggle("is-on", active);
    }

    /* =================================================================
       Chat del directo
       ================================================================= */

    function startChat() {
        if (chat.timer || destroyed) return;
        if (!chat.messages.length) loadChat(true);
        chat.timer = setInterval(() => loadChat(false), CHAT_POLL_MS);
    }

    function stopChat() {
        if (!chat.timer) return;
        clearInterval(chat.timer);
        chat.timer = null;
    }

    async function loadChat(reset) {
        if (destroyed || chat.loading) return;
        chat.loading = true;
        try {
            const data = await api.chatMessages(room, reset ? 0 : chat.lastId, controller.signal);
            const batch = data?.messages || [];
            if (destroyed) return;

            if (reset) chat.messages = [];
            const known = new Set(chat.messages.map((message) => message.id));
            const me = getCurrentPlayer();
            const myNames = new Set(
                [me?.alias, me?.dni].filter(Boolean).map((value) => String(value).toLowerCase())
            );
            for (const message of batch) {
                if (known.has(message.id)) continue;
                chat.messages.push(message);
                known.add(message.id);
                if (!chatOpen && !myNames.has(String(message.name || "").toLowerCase())) {
                    chatUnread += 1;
                }
            }
            chat.messages.sort((left, right) => left.id - right.id);
            chat.lastId = chat.messages.length ? chat.messages[chat.messages.length - 1].id : 0;
            updateChatBadge();
            renderChat(reset || batch.length > 0);
        } catch (error) {
            if (destroyed || error?.name === "AbortError") return;
        } finally {
            chat.loading = false;
        }
    }

    function renderChat(scroll = false) {
        const list = container.querySelector("[data-chat-list]");
        const counter = container.querySelector("[data-chat-count]");
        if (counter) counter.textContent = chat.messages.length ? `${chat.messages.length} mensajes` : "";
        if (!list) return;

        if (!chat.messages.length) {
            list.innerHTML = `<p class="replay-chat-empty">Todavía no hay mensajes. Sé el primero en animar la partida.</p>`;
            return;
        }

        const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
        list.innerHTML = chat.messages.map(messageHtml).join("");
        if (scroll || atBottom) list.scrollTop = list.scrollHeight;
    }

    function updateChatBadge() {
        const badge = container.querySelector("[data-chat-badge]");
        if (!badge) return;
        const count = chatOpen ? 0 : chatUnread;
        badge.hidden = count <= 0;
        badge.textContent = count > 9 ? "9+" : String(count);
    }

    function toggleChat(open = !chatOpen) {
        chatOpen = Boolean(open);
        const shell = container.querySelector(".rv-live-shell");
        shell?.classList.toggle("is-chat-open", chatOpen);
        container.querySelectorAll("[data-chat-toggle]").forEach((button) => {
            button.setAttribute("aria-expanded", String(chatOpen));
            button.setAttribute("title", chatOpen ? "Cerrar chat" : "Abrir chat");
        });
        if (chatOpen) {
            chatUnread = 0;
            updateChatBadge();
            if (!chat.messages.length) loadChat(true);
            if (getCurrentPlayer()) {
                window.setTimeout(() => container.querySelector("[data-chat-input]")?.focus(), 80);
            }
        }
    }

    function renderChatPanel() {
        const current = container.querySelector(".rv-chat");
        if (!current) return;
        current.outerHTML = chatHtml();
        bindChat();
        renderChat();
        updateChatBadge();
    }

    function openChatLogin() {
        openLoginModal({
            onSuccess: () => {
                chatUnread = 0;
                window.setTimeout(() => {
                    if (destroyed) return;
                    if (!container.querySelector("[data-chat-form]")) renderChatPanel();
                    loadChat(true);
                    container.querySelector("[data-chat-input]")?.focus();
                }, 80);
            }
        });
    }

    function bindChat() {
        container.querySelectorAll("[data-chat-toggle]").forEach((button) => {
            button.addEventListener("click", () => toggleChat());
        });
        container.querySelectorAll("[data-chat-close]").forEach((button) => {
            button.addEventListener("click", () => toggleChat(false));
        });
        container.querySelectorAll("[data-chat-login]").forEach((button) => {
            button.addEventListener("click", openChatLogin);
        });
        updateChatBadge();

        const form = container.querySelector("[data-chat-form]");
        if (!form) return;
        const textInput = form.querySelector("[data-chat-input]");

        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const me = getCurrentPlayer();
            if (!me) {
                openChatLogin();
                return;
            }
            const text = textInput?.value.trim();
            if (!text || chat.sending) return;

            const button = form.querySelector("[data-chat-send]") || form.querySelector("button[type='submit']");
            chat.sending = true;
            if (button) button.disabled = true;
            try {
                const message = await api.chatSend(room, text);
                if (destroyed || !message) return;
                if (!chat.messages.some((item) => item.id === message.id)) {
                    chat.messages.push(message);
                    chat.lastId = Math.max(chat.lastId, message.id);
                }
                chatUnread = 0;
                updateChatBadge();
                if (textInput) textInput.value = "";
                renderChat(true);
                textInput?.focus();
            } catch (error) {
                if (destroyed) return;
                if (error?.status === 401) {
                    openChatLogin();
                } else {
                    toast(error?.message || "No se pudo enviar el mensaje", "error");
                }
            } finally {
                chat.sending = false;
                if (button) button.disabled = false;
            }
        });
    }

    /* =================================================================
       Fotos, confeti y utilidades de vista
       ================================================================= */

    function avatarFor(player) {
        const photo = PHOTO_CACHE.get(normalizeName(player.name));
        if (photo?.url) {
            return `<a href="${esc(photo.url)}" title="Abrir perfil de ${esc(player.name)}">${avatarHtml(player.name, photo.photoUrl)}</a>`;
        }
        return avatarHtml(player.name, photo?.photoUrl || null, "replay-avatar-fallback");
    }

    function loadPhotos() {
        const players = buildPlayers(recording, allDarts);
        const ids = playerIdsMap();

        const missing = players
            .map((player) => player.name)
            .filter((name) => {
                if (!name) return false;
                const key = normalizeName(name);
                const cached = PHOTO_CACHE.get(key);
                const playerId = ids.get(key);
                if (!cached) return true;
                // Si el mismo alias aparece con otro Radikal ID, la foto cacheada no vale.
                if (playerId && cached.playerId !== playerId) return true;
                if (cached.photoUrl) return false;
                return Boolean(playerId);
            });

        if (!missing.length || photoLoading) return;
        photoLoading = true;

        // Foto directa por Radikal ID: no depende de que el buscador devuelva la ficha.
        const provisional = [...new Set(missing)].filter((name) => {
            const key = normalizeName(name);
            const playerId = ids.get(key);
            const cached = PHOTO_CACHE.get(key);
            if (!playerId) return false;
            if (cached?.photoUrl && cached.playerId === playerId) return false;
            PHOTO_CACHE.set(key, {
                url: cached?.url || `#/jugador/${encodeURIComponent(playerId)}`,
                photoUrl: `/api/photos/player?userId=${encodeURIComponent(playerId)}`,
                playerId
            });
            return true;
        });
        if (provisional.length && !destroyed) paint();

        Promise.all([...new Set(missing)].map(async (name) => {
            const key = normalizeName(name);
            const playerId = ids.get(key);
            const cached = PHOTO_CACHE.get(key);
            try {
                // Si Radikal nos dio el ID del jugador, resolvemos su ficha por ID;
                // el alias puede no estar en el índice público de rankings.
                let results = await api.playerSearch(playerId || name, controller.signal);
                if ((!results || !results.length) && playerId) {
                    results = await api.playerSearch(name, controller.signal);
                }

                const match = (results || []).find((item) =>
                    normalizeName(item.title) === key ||
                    normalizeName(item.subtitle || "").includes(key) ||
                    (playerId && item.id === playerId));

                PHOTO_CACHE.set(key, {
                    url: match?.url || cached?.url || (playerId ? `#/jugador/${encodeURIComponent(playerId)}` : null),
                    photoUrl: match?.photoUrl || cached?.photoUrl || null,
                    playerId: playerId || null
                });
            } catch {
                // Mantenemos la foto directa provisional si el buscador falla.
                PHOTO_CACHE.set(key, {
                    url: cached?.url || (playerId ? `#/jugador/${encodeURIComponent(playerId)}` : null),
                    photoUrl: cached?.photoUrl || null,
                    playerId: playerId || null
                });
            }
        })).then(() => {
            photoLoading = false;
            if (!destroyed) paint();
        }).catch(() => {
            photoLoading = false;
        });
    }

    function roundButtons() {
        return roundGroups(turns).map((round) => {
            const darts = round.turns.flatMap((turn) => turn.darts);
            return {
                round: round.round,
                darts: darts.length,
                firstIndex: darts[0]?.index ?? 0
            };
        });
    }

    function maxCursorFor() {
        if (!allDarts.length) return -1;
        return allDarts.length - 1 + (recording?.isFinished ? 1 : 0);
    }

    function nextPlayableCursor(from) {
        let next = from + 1;
        const skipped = currentCtx?.skipped;
        if (skipped) {
            while (next < allDarts.length && skipped.has(next)) next += 1;
        }
        return Math.min(next, maxCursorFor());
    }

    function turnAt(cursor) {
        if (!turns.length) return null;
        if (cursor < 0) return turns[0];
        return turns.find((turn) => turn.darts.some((dart) => dart.index === cursor))
            || turns[turns.length - 1];
    }
}

/* =====================================================================
   Datos y marcadores
   ===================================================================== */

function buildPlayers(recording, darts) {
    if (recording.playerStats?.length) {
        return recording.playerStats.map((player) => ({
            playerIndex: Number(player.playerIndex) || 0,
            name: player.name || `Jugador ${player.playerIndex + 1}`,
            score: player.score,
            average: player.average,
            darts: player.darts,
            isWinner: player.isWinner
        }));
    }

    const names = new Map();
    for (const dart of darts) {
        if (!names.has(dart.playerIndex)) {
            names.set(dart.playerIndex, dart.playerName || `Jugador ${dart.playerIndex + 1}`);
        }
    }
    return [...names.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([playerIndex, name]) => ({ playerIndex, name }));
}

function singleEntity(player) {
    return {
        id: `p${player.playerIndex}`,
        name: player.name,
        shortName: player.name,
        playerIndices: [player.playerIndex],
        color: playerColor(player.playerIndex),
        players: [player]
    };
}

function buildTurns(darts) {
    const map = new Map();
    darts.map(normalizeDart).forEach((dart, position) => {
        const index = Number.isInteger(dart.index) ? dart.index : position;
        const key = `${dart.round}:${dart.playerIndex}`;
        if (!map.has(key)) {
            map.set(key, {
                round: dart.round,
                playerIndex: dart.playerIndex,
                player: dart.playerName || `Jugador ${dart.playerIndex + 1}`,
                darts: [],
                firstIndex: index
            });
        }
        map.get(key).darts.push({ ...dart, index });
    });

    return [...map.values()].sort((left, right) => left.firstIndex - right.firstIndex);
}

function roundGroups(turns) {
    const map = new Map();
    for (const turn of turns) {
        if (!map.has(turn.round)) map.set(turn.round, { round: turn.round, turns: [] });
        map.get(turn.round).turns.push(turn);
    }
    return [...map.values()].sort((left, right) => left.round - right.round);
}

function detectModality(recording) {
    const type = String(recording?.gameType || "").toUpperCase();
    return /CRICKET|MPR/.test(type) ? "cricket" : "x01";
}

function modalityLabel(gameType) {
    const type = String(gameType || "").toUpperCase();
    if (/CRICKET|MPR/.test(type)) return "Cricket";
    if (/X01|PPD|501|301|701|901/.test(type)) return "X01";
    return "Partida";
}

function inferStartScore(recording) {
    const text = `${recording?.gameType || ""} ${recording?.title || ""}`;
    const match = /(301|501|701|901)/.exec(text);
    return match ? Number(match[1]) : 501;
}

function normalizeX01Mode(value) {
    const text = String(value || "").trim().toLowerCase();
    if (!text) return null;
    if (/master|maestr/.test(text)) return "master";
    if (/triple/.test(text)) return "triple";
    if (/double|doble/.test(text)) return "double";
    if (/open|abierto|abierta|straight/.test(text)) return "open";
    return null;
}

function inferInMode(recording) {
    const text = `${recording?.title || ""} ${recording?.gameType || ""}`.toLowerCase();
    if (/master\s*in|entrada\s*master|maestro\s*in/.test(text)) return "master";
    if (/double\s*in|doble\s*entrada|entrada\s*doble/.test(text)) return "double";
    return "open";
}

function inferOutMode(recording) {
    const text = `${recording?.title || ""} ${recording?.gameType || ""}`.toLowerCase();
    if (/triple\s*out|salida\s*triple/.test(text)) return "triple";
    if (/master\s*out|salida\s*master|maestro\s*out/.test(text)) return "master";
    if (/open\s*out|salida\s*abierta|abierto\s*\/\s*abierto/.test(text)) return "open";
    return "double";
}

function resolveX01Rules(recording) {
    const raw = recording?.x01Rules || recording?.X01Rules || {};
    const startScore = Number(raw.startScore || raw.StartScore) || inferStartScore(recording);
    const inMode = normalizeX01Mode(raw.inMode || raw.InMode) || inferInMode(recording);
    const outMode = normalizeX01Mode(raw.outMode || raw.OutMode) || inferOutMode(recording);
    const rounds = Number(raw.rounds || raw.Rounds) || 15;
    const stacked = Boolean(raw.stacked ?? raw.Stacked);
    const infoPanels = Array.isArray(raw.infoPanels || raw.InfoPanels)
        ? (raw.infoPanels || raw.InfoPanels)
        : [];
    const bullMode = normalizeBullMode(raw.bullMode || raw.BullMode, infoPanels);
    const teamLocPlayers = Array.isArray(raw.teamLocPlayers || raw.TeamLocPlayers)
        ? (raw.teamLocPlayers || raw.TeamLocPlayers).map(Number)
        : null;
    const teamVisPlayers = Array.isArray(raw.teamVisPlayers || raw.TeamVisPlayers)
        ? (raw.teamVisPlayers || raw.TeamVisPlayers).map(Number)
        : null;
    return {
        startScore,
        inMode,
        outMode,
        bullMode,
        rounds,
        stacked,
        infoPanels,
        teamLocPlayers,
        teamVisPlayers,
        teamLocName: raw.teamLocName || raw.TeamLocName || null,
        teamVisName: raw.teamVisName || raw.TeamVisName || null
    };
}

function modeLabel(mode) {
    const value = normalizeX01Mode(mode) || "open";
    if (value === "double") return "DOUBLE";
    if (value === "master") return "MASTER";
    if (value === "triple") return "TRIPLE";
    return "OPEN";
}

function rulesDetailLabel(rules) {
    if (!rules) return "";
    return `${modeLabel(rules.inMode)} IN / ${modeLabel(rules.outMode)} OUT`;
}

function rulesShortLabel(rules) {
    if (!rules) return "";
    return `${modeLabel(rules.inMode)} IN · ${modeLabel(rules.outMode)} OUT`;
}

function normalizeBullMode(value, infoPanels = []) {
    const text = `${value || ""} ${(infoPanels || []).join(" ")}`.toUpperCase();
    if (/50\s*\/\s*50/.test(text)) return "50/50";
    if (/25\s*\/\s*50/.test(text)) return "25/50";
    return "25/50";
}

function bullModeLabel(rules) {
    return `BULL ${normalizeBullMode(rules?.bullMode, rules?.infoPanels)}`;
}

function detectTeamMode(recording, players) {
    if (typeof recording?.isTeam === "boolean") return recording.isTeam;
    if (players.length < 4) return false;
    const text = `${recording?.title || ""} ${recording?.gameType || ""}`;
    return /pareja|equipo|team|doble|pair|4\s*jugadores/i.test(text) || /\s+vs\.?\s+/i.test(text);
}

function buildTeams(recording, players, teamMode, rules) {
    if (!teamMode) return players.map(singleEntity);

    const byIndex = new Map(players.map((player) => [player.playerIndex, player]));
    const loc = (rules?.teamLocPlayers || []).map((index) => byIndex.get(Number(index))).filter(Boolean);
    const vis = (rules?.teamVisPlayers || []).map((index) => byIndex.get(Number(index))).filter(Boolean);
    if (loc.length && vis.length && (loc.length + vis.length) === players.length) {
        return [
            makeTeam("A", rules.teamLocName || "Equipo A", loc),
            makeTeam("B", rules.teamVisName || "Equipo B", vis)
        ];
    }

    const title = String(recording?.title || "");
    const sides = title.split(/\s+vs\.?\s+/i);
    if (sides.length === 2) {
        const left = playersInSide(players, sides[0]);
        const right = playersInSide(players, sides[1]);
        const covered = new Set([...left, ...right].map((player) => player.playerIndex));

        if (left.length >= 2 && right.length >= 2 && covered.size === players.length) {
            return [
                makeTeam("A", teamNameFromSide(sides[0]), left),
                makeTeam("B", teamNameFromSide(sides[1]), right)
            ];
        }
    }

    // Radikal alterna los marcadores LOC/VIS: en 2v2 son 0,2 contra 1,3.
    const locName = sides.length === 2 ? teamNameFromSide(sides[0]) : "Equipo A";
    const visName = sides.length === 2 ? teamNameFromSide(sides[1]) : "Equipo B";
    if (players.length === 4) {
        return [
            makeTeam("A", locName, [players[0], players[2]]),
            makeTeam("B", visName, [players[1], players[3]])
        ];
    }

    const half = Math.ceil(players.length / 2);
    return [
        makeTeam("A", locName, players.slice(0, half)),
        makeTeam("B", visName, players.slice(half))
    ];
}

function playersInSide(players, side) {
    const key = normalizeName(side);
    return players.filter((player) => {
        const name = normalizeName(player.name);
        return name.length > 1 && key.includes(name);
    });
}

function teamNameFromSide(side) {
    let value = String(side || "").split("·")[0].trim();
    const parts = value
        .split(/\s*[\/|–—]\s*/)
        .map((part) => part.trim())
        .filter(Boolean);

    if (parts.length > 1 && parts.every((part) => part.length <= 16 && !/\d{3,}/.test(part))) {
        return parts.join(" / ");
    }

    value = parts.length ? parts[parts.length - 1] : value;
    value = value.replace(/^chat\s*\d+\s*/i, "").trim();
    return value || "Equipo";
}

function makeTeam(key, name, players) {
    return {
        id: `t${key}`,
        name: cleanTeamName(name) || `Equipo ${key}`,
        shortName: players.map((player) => player.name).join(" / "),
        playerIndices: players.map((player) => player.playerIndex),
        color: key === "A" ? "#00c2ff" : "#ff30a4",
        players
    };
}

function teamSubtitle(entity) {
    const same = normalizeName(entity.name) === normalizeName(entity.shortName);
    return same ? `${entity.players.length} jugadores` : entity.shortName;
}

function cleanTeamName(value) {
    return String(value || "")
        .split("·")[0]
        .replace(/\s+/g, " ")
        .replace(/^[\s\-–—]+|[\s\-–—]+$/g, "")
        .trim();
}

function buildX01Layout(players, teams, teamMode, rules) {
    if (!teamMode) {
        return {
            teamMode: false,
            stacked: false,
            units: players.map((player) => ({
                id: `p${player.playerIndex}`,
                name: player.name,
                playerIndices: [player.playerIndex],
                teamId: null,
                team: null,
                entity: singleEntity(player)
            }))
        };
    }

    if (rules?.stacked) {
        return {
            teamMode: true,
            stacked: true,
            units: teams.map((team) => ({
                id: team.id,
                name: team.name,
                playerIndices: team.playerIndices,
                teamId: team.id,
                team,
                entity: team
            }))
        };
    }

    return {
        teamMode: true,
        stacked: false,
        units: players.map((player) => {
            const team = teams.find((item) => item.playerIndices.includes(player.playerIndex)) || null;
            return {
                id: `p${player.playerIndex}`,
                name: player.name,
                playerIndices: [player.playerIndex],
                teamId: team?.id || null,
                team,
                entity: { ...singleEntity(player), teamId: team?.id || null }
            };
        })
    };
}

function dartOpens(dart, inMode) {
    const kind = hitKind(dart);
    const multiplier = Number(dart.multiplier) || 0;
    if (inMode === "open") return true;
    if (inMode === "double") return multiplier === 2 || kind === "dbull";
    if (inMode === "master") return multiplier >= 2 || kind === "dbull";
    if (inMode === "triple") return multiplier === 3;
    return true;
}

function dartChecksOut(dart, outMode) {
    const kind = hitKind(dart);
    const multiplier = Number(dart.multiplier) || 0;
    if (outMode === "open") return true;
    if (outMode === "double") return multiplier === 2 || kind === "dbull";
    if (outMode === "master") return multiplier >= 2 || kind === "dbull";
    if (outMode === "triple") return multiplier === 3;
    return true;
}

const CHECKOUT_SCORE_CACHE = new Map();

function checkoutableScores(outMode) {
    const mode = normalizeX01Mode(outMode) || "double";
    if (CHECKOUT_SCORE_CACHE.has(mode)) return CHECKOUT_SCORE_CACHE.get(mode);

    const scoring = new Set([0]);
    for (let value = 1; value <= 20; value += 1) {
        scoring.add(value);
        scoring.add(value * 2);
        scoring.add(value * 3);
    }
    scoring.add(25);
    scoring.add(50);

    const upToTwo = new Set([0]);
    for (const first of scoring) {
        upToTwo.add(first);
        for (const second of scoring) upToTwo.add(first + second);
    }

    const finishing = new Set();
    if (mode === "open") {
        for (const score of scoring) if (score > 0) finishing.add(score);
    } else if (mode === "double") {
        for (let value = 1; value <= 20; value += 1) finishing.add(value * 2);
        finishing.add(50);
    } else if (mode === "master") {
        for (let value = 1; value <= 20; value += 1) {
            finishing.add(value * 2);
            finishing.add(value * 3);
        }
        finishing.add(50);
    } else if (mode === "triple") {
        for (let value = 1; value <= 20; value += 1) finishing.add(value * 3);
    }

    const result = new Set();
    const max = mode === "double" ? 170 : 180;
    for (let remaining = 1; remaining <= max; remaining += 1) {
        for (const finish of finishing) {
            if (finish > remaining) continue;
            if (upToTwo.has(remaining - finish)) {
                result.add(remaining);
                break;
            }
        }
    }

    CHECKOUT_SCORE_CACHE.set(mode, result);
    return result;
}

function hasCheckout(remaining, outMode) {
    const value = Math.round(Number(remaining));
    if (!Number.isFinite(value) || value <= 0) return false;
    return checkoutableScores(outMode).has(value);
}

/**
 * Freeze oficial: un jugador no puede cerrar mientras la puntuación de su
 * compañero sea mayor que la suma de lo que les queda a los rivales.
 */
function frozenPlayerIndices(scores, teams, teamMode, stacked) {    if (!teamMode || stacked) return new Set();
    const remainingFor = (playerIndex) => {
        const score = scores.find((item) => item.playerIndices.includes(playerIndex));
        return score?.remaining;
    };
    const frozen = new Set();

    for (const team of teams) {
        const opponents = teams.filter((item) => item.id !== team.id);
        const opponentRemaining = opponents.reduce((sum, opponent) =>
            sum + opponent.playerIndices.reduce((teamSum, index) =>
                teamSum + (remainingFor(index) ?? 0), 0), 0);

        for (const playerIndex of team.playerIndices) {
            const partnerIndices = team.playerIndices.filter((index) => index !== playerIndex);
            if (!partnerIndices.length) continue;
            const partnerRemaining = Math.min(...partnerIndices.map((index) => remainingFor(index) ?? Infinity));
            if (partnerRemaining > opponentRemaining) frozen.add(playerIndex);
        }
    }

    return frozen;
}

/**
 * Motor X01 por turnos. Aplica las reglas oficiales de Radikal:
 * - bust al pasarse, dejar 1 (salvo salida abierta) o cerrar sin el multiplicador correcto;
 * - Double In / Master In antes de abrir;
 * - Double Out / Master Out / Triple Out al cerrar;
 * - freeze en equipos con marcadores separados.
 *
 * Devuelve una entrada por marcador (jugador o equipo según el modo) y adjunta
 * dartFlags/skipped para que el visor sepa qué tirada fue bust y qué dardos saltar.
 */
function computeX01(darts, players, teams, teamMode, rules) {
    const layout = buildX01Layout(players, teams, teamMode, rules);
    const startScore = Number(rules?.startScore) || 501;
    const inMode = rules?.inMode || "open";
    const outMode = rules?.outMode || "double";
    const stacked = Boolean(teamMode && rules?.stacked);
    const state = new Map();

    for (const unit of layout.units) {
        state.set(unit.id, {
            entity: unit.entity,
            unit,
            playerIndices: unit.playerIndices,
            teamId: unit.teamId,
            remaining: startScore,
            scored: 0,
            darts: 0,
            opened: inMode === "open",
            busts: 0,
            frozen: false,
            checkedOut: false,
            lastTurn: [],
            lastRound: 0,
            members: stacked
                ? unit.playerIndices.map((playerIndex) => ({
                    playerIndex,
                    scored: 0,
                    darts: 0,
                    lastTurn: []
                }))
                : null
        });
    }

    const dartFlags = new Map();
    const skipped = new Set();
    let stopped = false;
    let gameWinner = null;

    for (const turn of buildTurns(darts)) {
        const unit = layout.units.find((entry) => entry.playerIndices.includes(turn.playerIndex));
        if (!unit) continue;
        const item = state.get(unit.id);
        if (!item) continue;

        if (stopped) {
            for (const dart of turn.darts) {
                skipped.add(dart.index);
                dartFlags.set(dart.index, { skipped: true, reason: "game-over" });
            }
            continue;
        }

        const member = item.members?.find((entry) => entry.playerIndex === turn.playerIndex) || null;
        const startRemaining = item.remaining;
        let opened = item.opened || inMode === "open";
        let remaining = item.remaining;
        let turnScored = 0;
        let busted = false;
        let checkedOut = false;

        // Freeze: un jugador no puede cerrar mientras la puntuación de su compañero
        // sea mayor que la suma de lo que les queda a los dos rivales.
        let frozen = false;
        let freezeReason = null;
        if (teamMode && !stacked && unit.team) {
            const opponents = teams.filter((team) => team.id !== unit.team.id);
            const partnerIndices = unit.team.playerIndices.filter((index) => index !== turn.playerIndex);
            const partnerRemaining = partnerIndices.length
                ? Math.min(...partnerIndices.map((index) => {
                    const partnerUnit = layout.units.find((entry) => entry.playerIndices.includes(index));
                    return partnerUnit ? state.get(partnerUnit.id)?.remaining ?? Infinity : Infinity;
                }))
                : Infinity;
            const opponentRemaining = opponents.reduce((sum, team) => sum + team.playerIndices.reduce((teamSum, index) => {
                const opponentUnit = layout.units.find((entry) => entry.playerIndices.includes(index));
                return teamSum + (opponentUnit ? state.get(opponentUnit.id)?.remaining ?? 0 : 0);
            }, 0), 0);
            frozen = partnerRemaining > opponentRemaining;
            if (frozen) freezeReason = { partnerRemaining, opponentRemaining };
        }
        // La diana marca el freeze en su JSON; si viene marcado, manda la diana.
        if (turn.darts.some((dart) => dart.frozen === true)) frozen = true;

        const turnDarts = [];
        for (const dart of turn.darts) {
            item.darts += 1;
            if (member) member.darts += 1;

            const score = Number(dart.score) || 0;
            const opens = dartOpens(dart, inMode);
            const outValid = dartChecksOut(dart, outMode);

            // Antes de abrir, los dardos no restan ni provocan bust.
            if (!opened && !opens) {
                turnDarts.push({ ...dart, valid: false, opened: false, bust: false, frozen });
                dartFlags.set(dart.index, { bust: false, frozen, opened: false, valid: false, reason: "not-opened" });
                continue;
            }
            if (!opened) opened = true;

            const nextRemaining = remaining - score;
            let dartBust = false;
            let reason = null;

            if (nextRemaining < 0) {
                dartBust = true;
                reason = "over";
            } else if (nextRemaining === 1 && outMode !== "open") {
                dartBust = true;
                reason = "one";
            } else if (nextRemaining === 0) {
                if (!outValid) {
                    dartBust = true;
                    reason = "checkout";
                } else if (frozen) {
                    dartBust = true;
                    reason = "frozen";
                } else {
                    checkedOut = true;
                }
            } else if (dart.bust === true) {
                dartBust = true;
                reason = "bust";
            }

            if (dartBust) {
                busted = true;
                item.busts += 1;
                remaining = startRemaining;
                turnScored = 0;
                turnDarts.push({ ...dart, valid: false, bust: true, frozen, reason });
                dartFlags.set(dart.index, { bust: true, frozen, opened, valid: false, reason });
                break;
            }

            remaining = nextRemaining;
            turnScored += score;
            turnDarts.push({ ...dart, valid: true, bust: false, frozen, reason: null });
            dartFlags.set(dart.index, { bust: false, frozen, opened, valid: true, reason: null });

            if (checkedOut) break;
        }

        // Los dardos que ya no se lanzaron tras un bust/cierre no deben reproducirse.
        if (busted || checkedOut) {
            const lastIndex = turnDarts[turnDarts.length - 1]?.index ?? -1;
            for (const dart of turn.darts) {
                if (dart.index > lastIndex) {
                    skipped.add(dart.index);
                    dartFlags.set(dart.index, { bust: false, frozen, opened, valid: false, skipped: true, reason: "turn-ended" });
                }
            }
        }

        item.remaining = remaining;
        item.opened = opened;
        item.frozen = frozen;
        item.freezeReason = freezeReason;
        if (!busted) {
            item.scored += turnScored;
            if (member) member.scored += turnScored;
        }
        item.lastTurn = turnDarts.slice(-3);
        if (member) member.lastTurn = turnDarts.slice(-3);
        item.lastRound = turn.round;
        item.lastPlayerIndex = turn.playerIndex;

        if (checkedOut) {
            item.checkedOut = true;
            item.checkedOutBy = turn.playerIndex;
            item.winner = true;
            gameWinner = unit.team || unit.entity;
            stopped = true;
        }
    }

    const result = [...state.values()].map((item) => ({
        ...item,
        members: item.members
            ? item.members.map((member) => ({
                ...member,
                average: member.darts ? (member.scored / member.darts).toFixed(2) : "0.00"
            }))
            : null,
        average: item.darts ? (item.scored / item.darts).toFixed(2) : "0.00"
    }));
    result.dartFlags = dartFlags;
    result.skipped = skipped;
    result.layout = layout;
    result.gameWinner = gameWinner;
    return result;
}

function computeCricket(darts, entities) {
    const state = new Map(entities.map((entity) => [entity.id, {
        entity,
        marks: Object.fromEntries(CRICKET_TARGETS.map((target) => [target, 0])),
        points: 0,
        darts: 0,
        marksTotal: 0,
        rounds: new Set()
    }]));

    for (const dart of darts) {
        const entity = entityForPlayer(entities, dart.playerIndex);
        if (!entity) continue;
        const item = state.get(entity.id);
        const target = cricketTarget(dart);
        const marks = target ? cricketMarks(dart) : 0;

        item.darts += 1;
        item.rounds.add(dart.round);

        if (!target || !marks) continue;
        item.marksTotal += marks;

        const opponents = entities.filter((other) => other.id !== entity.id);
        const opponentsOpen = opponents.some((other) => state.get(other.id).marks[target] < 3);
        const before = item.marks[target];
        const after = before + marks;

        if (opponentsOpen) {
            if (before >= 3) item.points += marks * targetValue(target);
            else if (after >= 3) item.points += (after - 3) * targetValue(target);
        }

        item.marks[target] = Math.min(3, after);
    }

    return [...state.values()].map((item) => ({
        ...item,
        roundCount: item.rounds.size,
        mpr: item.rounds.size ? item.marksTotal / item.rounds.size : 0
    }));
}

function entityForPlayer(entities, playerIndex) {
    return entities.find((entity) => entity.playerIndices.includes(Number(playerIndex)));
}

function cricketTarget(dart) {
    const kind = hitKind(dart);
    if (kind === "dbull" || kind === "sbull") return 25;
    return CRICKET_TARGETS.includes(Number(dart.sector)) ? Number(dart.sector) : null;
}

function cricketMarks(dart) {
    const kind = hitKind(dart);
    if (kind === "dbull") return 2;
    if (kind === "sbull") return 1;
    if (kind === "miss") return 0;
    return Number(dart.multiplier) || 0;
}

function targetValue(target) {
    return target === 25 ? 25 : target;
}

function findWinner(recording, players, teams, teamMode) {
    if (!recording?.isFinished || !recording.winner) return null;
    const key = normalizeName(recording.winner);
    if (teamMode) {
        return teams.find((team) =>
            normalizeName(team.name) === key ||
            normalizeName(team.shortName).includes(key) ||
            team.players.some((player) => normalizeName(player.name) === key)) || null;
    }
    const player = players.find((item) => normalizeName(item.name) === key);
    return player
        ? { name: player.name, color: playerColor(player.playerIndex) }
        : { name: recording.winner, color: "#f0b84b" };
}

/* =====================================================================
   Impacto del último dardo
   ===================================================================== */

function hitDisplay(dart) {
    const kind = hitKind(dart);
    const notation = throwNotation(dart);
    if (kind === "miss") {
        return { className: "is-miss", notation, color: "#ff5470" };
    }
    if (kind === "dbull") {
        return { className: "is-dbull", notation, color: "#ff30a4" };
    }
    if (kind === "sbull") {
        return { className: "is-sbull", notation, color: "#7fe3ff" };
    }
    if (kind === "triple") {
        return { className: "is-triple", notation, color: "#00a6d9" };
    }
    if (kind === "double") {
        return { className: "is-double", notation, color: "#d93a3a" };
    }
    return { className: "is-single", notation, color: "#7fe3ff" };
}

function throwNotation(dart) {
    const kind = hitKind(dart);
    const region = String(dart?.hitRegion || "").toUpperCase();
    if (kind === "miss") return region.includes("DX") ? "DX" : "SX";
    if (kind === "dbull") return "DBULL";
    if (kind === "sbull") return "BULL";
    if (kind === "triple") return `T${dart.sector}`;
    if (kind === "double") return `D${dart.sector}`;
    return `S${dart.sector}`;
}

function throwLabel(dart) {
    return throwNotation(dart);
}

/* =====================================================================
   Sonido del visor: tiradas, plenos y resta de puntos
   ===================================================================== */

let audioContext = null;

function ensureAudioContext() {
    try {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return null;
        if (!audioContext) audioContext = new Ctor();
        if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
        return audioContext;
    } catch {
        return null;
    }
}

function audioNote(freq, duration, type = "sine", gain = 0.05, delay = 0, slideTo = null) {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    try {
        const startAt = ctx.currentTime + Math.max(0, delay);
        const osc = ctx.createOscillator();
        const amp = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(Math.max(20, freq), startAt);
        if (slideTo) {
            osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), startAt + duration);
        }
        amp.gain.setValueAtTime(0.0001, startAt);
        amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), startAt + 0.012);
        amp.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
        osc.connect(amp).connect(ctx.destination);
        osc.start(startAt);
        osc.stop(startAt + duration + 0.03);
    } catch {
        // El navegador puede bloquear el audio hasta el primer gesto.
    }
}

function playHitSound(dart, context = {}) {
    const kind = hitKind(dart);
    const sector = Number(dart.sector) || 0;
    const modality = context.modality;
    const turnTotal = Number(context.turnTotal) || 0;
    const remainingAfter = context.remainingAfter;

    if (kind === "miss") {
        audioNote(160, 0.22, "sawtooth", 0.045, 0, 80);
        audioNote(72, 0.18, "sine", 0.08, 0.01);
        return;
    }

    if (kind === "dbull") {
        audioNote(150, 0.2, "sine", 0.09);
        [660, 880, 1320].forEach((freq, index) => {
            audioNote(freq, 0.16, "triangle", 0.045, 0.04 + index * 0.055);
        });
    } else if (kind === "sbull") {
        audioNote(180, 0.16, "sine", 0.08);
        audioNote(880, 0.12, "triangle", 0.04, 0.03);
    } else if (kind === "triple") {
        [880, 1175, 1568].forEach((freq, index) => {
            audioNote(freq, 0.14, "triangle", 0.045, index * 0.055);
        });
        audioNote(2093, 0.16, "sine", 0.02, 0.09);
    } else if (kind === "double") {
        audioNote(660, 0.12, "triangle", 0.045);
        audioNote(871, 0.14, "triangle", 0.035, 0.07);
    } else {
        audioNote(520 + (sector % 5) * 35, 0.07, "triangle", 0.03);
    }

    if (modality !== "cricket") {
        if (turnTotal >= 100) {
            audioNote(1760, 0.12, "sine", 0.03, 0.12);
        }
        if (turnTotal >= 140) {
            [880, 1100, 1320].forEach((freq, index) => {
                audioNote(freq, 0.2, "sine", 0.028, 0.16 + index * 0.045);
            });
        }
        if (turnTotal === 180) {
            [660, 880, 1100, 1320, 1760].forEach((freq, index) => {
                audioNote(freq, 0.22, "triangle", 0.04, 0.22 + index * 0.07);
            });
        }
        if (remainingAfter === 0) {
            [523, 659, 784, 1046].forEach((freq, index) => {
                audioNote(freq, 0.26, "triangle", 0.045, 0.18 + index * 0.08);
            });
            [1046, 1318].forEach((freq, index) => {
                audioNote(freq, 0.35, "sine", 0.03, 0.55 + index * 0.02);
            });
        }
    }
}

function playScoreTick() {
    audioNote(320, 0.065, "sine", 0.03, 0, 210);
    audioNote(190, 0.1, "triangle", 0.02, 0.01);
}

function playBustSound() {
    // Fallo seco: el turno se anula y pasa al siguiente jugador.
    audioNote(220, 0.18, "sawtooth", 0.055, 0, 90);
    audioNote(110, 0.28, "square", 0.035, 0.08, 55);
    audioNote(70, 0.2, "sine", 0.06, 0.16);
}

function playBustTick() {
    audioNote(180, 0.12, "triangle", 0.035, 0, 120);
    audioNote(90, 0.18, "sine", 0.045, 0.05);
}

function playFreezeSound() {
    // Aviso cristalino: el jugador está congelado y no puede cerrar.
    audioNote(1480, 0.1, "sine", 0.022, 0);
    audioNote(1760, 0.12, "sine", 0.02, 0.06);
    audioNote(2093, 0.16, "triangle", 0.018, 0.12);
}

/* =====================================================================
   Marcadores HTML
   ===================================================================== */

const PANEL_COLORS = ["#d93a3a", "#0b7fa8", "#b3204e", "#00a6d9"];

function panelColor(index) {
    const value = Number(index);
    if (!Number.isFinite(value) || value < 0) return PANEL_COLORS[0];
    return PANEL_COLORS[value % PANEL_COLORS.length];
}

function markGlyph(marks) {
    if (marks <= 0) return "";
    if (marks === 1) return `<span class="rv-mark">/</span>`;
    if (marks === 2) return `<span class="rv-mark">✕</span>`;
    return `<span class="rv-mark is-closed">✕</span>`;
}

function dartKindClass(dart) {
    return `is-${hitKind(dart)}`;
}

function messageHtml(message) {
    const initials = (message.name || "?").trim().slice(0, 1).toUpperCase() || "?";
    return `
        <article class="replay-chat-msg">
            <span class="replay-chat-avatar" style="--chat-color:${chatColor(message.name)}">${esc(initials)}</span>
            <div class="replay-chat-body">
                <strong>${esc(message.name || "Aficionado")}
                    <time>${esc(formatChatTime(message.sentAt))}</time>
                </strong>
                <p>${esc(message.text)}</p>
            </div>
        </article>
    `;
}

function formatChatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function chatColor(name) {
    const colors = ["#00c2ff", "#ff30a4", "#3ddc84", "#f0b84b", "#a78bfa", "#ff7a59", "#7fe3ff"];
    let hash = 0;
    for (const ch of String(name || "")) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
    return colors[hash % colors.length];
}

function normalizeName(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

function fullNameFromSubtitle(subtitle) {
    const value = String(subtitle || "").split("·")[0].trim();
    return value || null;
}

/* =====================================================================
   Confeti
   ===================================================================== */

function startConfetti(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const colors = ["#00c2ff", "#ff30a4", "#f0b84b", "#3ddc84", "#ffffff"];
    const particles = Array.from({ length: width < 700 ? 55 : 110 }, () => ({
        x: width / 2 + (Math.random() - 0.5) * width * 0.4,
        y: height * 0.35 + Math.random() * 40,
        vx: (Math.random() - 0.5) * 9,
        vy: -Math.random() * 9 - 2,
        size: 3 + Math.random() * 5,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.3,
        life: 0
    }));

    let frame = 0;
    const tick = () => {
        ctx.clearRect(0, 0, width, height);
        for (const particle of particles) {
            particle.vy += 0.22;
            particle.vx *= 0.995;
            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.rotation += particle.spin;
            particle.life += 1;

            ctx.save();
            ctx.translate(particle.x, particle.y);
            ctx.rotate(particle.rotation);
            ctx.globalAlpha = Math.max(0, 1 - frame / 170);
            ctx.fillStyle = particle.color;
            ctx.fillRect(-particle.size / 2, -particle.size / 4, particle.size, particle.size / 2);
            ctx.restore();
        }
        frame += 1;
        if (frame < 170) requestAnimationFrame(tick);
        else ctx.clearRect(0, 0, width, height);
    };
    requestAnimationFrame(tick);
}

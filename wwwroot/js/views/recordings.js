import { api } from "../api.js?v=77";
import { esc, icon, formatRelative, formatDate, emptyState, formatNumber } from "../ui.js?v=77";
import { boardSvg, hitLabel, normalizeDart, playerColor } from "../dartboard.js?v=77";

export async function render(container, params = [], query = new URLSearchParams()) {
    let destroyed = false;
    let timer = null;
    let items = [];
    let filter = query.get("q") || "";
    let mode = query.get("mode") || "all";

    container.innerHTML = shell();
    bind();
    await load();

    if (!destroyed) timer = setInterval(load, 15000);

    function shell() {
        return `
            <div class="page container recordings-page">
                <div class="darts-page-head">
                    <div>
                        <span class="kicker">${icon("history")}Radikal Live · Finalizadas</span>
                        <h1 class="darts-title">Partidas <span class="accent">finalizadas</span></h1>
                        <p class="section-sub">
                            Cada partida del directo, agrupada por juegos. Abre una partida para ver sus
                            marcadores, la modalidad y el turno de cada jugador.
                        </p>
                    </div>
                    <div class="darts-actions">
                        <a class="btn btn-ghost btn-sm" href="#/directo">${icon("arrowLeft")} En directo</a>
                        <button class="btn btn-outline btn-sm" id="recordings-refresh" type="button">${icon("refresh")} Actualizar</button>
                    </div>
                </div>

                <div class="recordings-toolbar">
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

                <div id="recordings-summary" class="recordings-summary"></div>
                <div id="recordings-list" class="recordings-grid">
                    ${Array.from({ length: 6 }, () => `<div class="skeleton skeleton-card" style="height:260px"></div>`).join("")}
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
                    <div class="error-box" style="grid-column:1/-1">
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
        const groups = groupMatches(items).filter((group) => {
            if (mode === "live" && !group.hasLive) return false;
            if (mode === "finished" && !group.hasFinished) return false;
            if (!term) return true;
            const haystack = [
                group.title,
                group.winner,
                `#${group.matchId}`,
                `${group.competitionId}`,
                ...(group.players || []),
                ...group.games.map((game) => game.gameType || "")
            ].join(" ").toLowerCase();
            return haystack.includes(term);
        });

        const summary = container.querySelector("#recordings-summary");
        if (summary) {
            const live = groups.filter((group) => group.hasLive).length;
            const examples = groups.filter((group) => group.isMock).length;
            summary.innerHTML = `
                <div class="darts-stats" style="margin-bottom:0">
                    <div class="darts-stat"><strong>${formatNumber(groups.length)}</strong><span>Partidas${examples ? ` · ${examples} ejemplo` : ""}</span></div>
                    <div class="darts-stat"><strong>${formatNumber(items.length)}</strong><span>Juegos</span></div>
                    <div class="darts-stat"><strong>${formatNumber(live)}</strong><span>En juego ahora</span></div>
                    <div class="darts-stat"><strong>${fetchedAt ? esc(formatRelative(fetchedAt)) : "—"}</strong><span>Actualizado</span></div>
                </div>
            `;
        }

        const list = container.querySelector("#recordings-list");
        if (!list) return;

        if (!groups.length) {
            list.classList.add("is-empty");
            list.innerHTML = items.length
                ? `<div style="grid-column:1/-1">${emptyState("Sin resultados", "Ninguna partida coincide con el filtro.", "search")}</div>`
                : `<div style="grid-column:1/-1">${emptyState(
                    "Todavía no hay partidas finalizadas",
                    "En cuanto termine una partida del directo aparecerá aquí con todos sus juegos.",
                    "target")}</div>`;
            return;
        }

        list.classList.remove("is-empty");
        list.innerHTML = groups.map((group) => card(group)).join("");
    }

    return () => {
        destroyed = true;
        if (timer) clearInterval(timer);
    };
}

function groupMatches(items) {
    const map = new Map();
    for (const item of items) {
        const key = `${item.competitionId}/${item.matchId}`;
        if (!map.has(key)) {
            map.set(key, {
                competitionId: item.competitionId,
                matchId: item.matchId,
                title: item.title || `Partida #${item.matchId}`,
                players: [],
                games: [],
                firstSeenAt: item.firstSeenAt,
                lastUpdatedAt: item.lastUpdatedAt,
                isMock: false,
                winner: null
            });
        }

        const group = map.get(key);
        group.games.push(item);
        group.isMock = group.isMock || Boolean(item.isMock);
        group.title = group.title || item.title;
        group.winner = item.winner || group.winner;
        group.players = [...new Set([...group.players, ...(item.players || [])])];
        if (item.firstSeenAt && (!group.firstSeenAt || new Date(item.firstSeenAt) < new Date(group.firstSeenAt)))
            group.firstSeenAt = item.firstSeenAt;
        if (item.lastUpdatedAt && (!group.lastUpdatedAt || new Date(item.lastUpdatedAt) > new Date(group.lastUpdatedAt)))
            group.lastUpdatedAt = item.lastUpdatedAt;
    }

    return [...map.values()].map((group) => {
        group.games.sort((left, right) => left.game - right.game);
        group.title = group.games[0]?.title || group.title;
        group.hasLive = group.games.some((game) => !game.isFinished);
        group.hasFinished = group.games.some((game) => game.isFinished);
        group.totalDarts = group.games.reduce((total, game) => total + (game.dartsCount || 0), 0);
        return group;
    }).sort((left, right) => {
        if (Boolean(left.isMock) !== Boolean(right.isMock)) return left.isMock ? 1 : -1;
        return new Date(right.lastUpdatedAt) - new Date(left.lastUpdatedAt);
    });
}

function card(group) {
    const firstGame = group.games[0];
    const primaryGame = group.hasLive
        ? (group.games.find((game) => !game.isFinished) || firstGame)
        : firstGame;
    const href = `#/directo/finalizadas/${group.competitionId}/${group.matchId}/${primaryGame.game}`;
    const preview = previewBoard(firstGame);
    const status = group.hasLive
        ? `<span class="chip chip-live">En juego</span>`
        : `<span class="chip chip-finished">Finalizada</span>`;

    return `
        <article class="archive-card ${group.isMock ? "is-mock" : ""} match-card">
            <div class="archive-card-top">
                <div class="archive-card-head">
                    ${status}
                    ${group.isMock ? `<span class="chip chip-upcoming">Ejemplo</span>` : ""}
                    <span class="chip chip-type">${group.games.length} ${group.games.length === 1 ? "juego" : "juegos"}</span>
                </div>
                <span class="small muted">${esc(formatRelative(group.lastUpdatedAt))}</span>
            </div>

            <div class="archive-card-body">
                <div class="archive-card-preview">${preview}</div>
                <div class="archive-card-info">
                    <h3>${esc(group.title)}</h3>
                    <div class="recording-players">
                        ${group.players.length
                            ? group.players.map((name, index) => `
                                <span class="player-dot">
                                    <i style="background:${playerColor(index)}"></i>${esc(name)}
                                </span>`).join("")
                            : `<span class="small muted">Sin jugadores identificados</span>`}
                    </div>
                    ${group.winner
                        ? `<p class="recording-winner">${icon("crown")} Ganador: <strong>${esc(group.winner)}</strong></p>`
                        : ""}
                </div>
            </div>

            <div class="match-games">
                ${group.games.map((game) => `
                    <a class="match-game" href="#/directo/finalizadas/${group.competitionId}/${group.matchId}/${game.game}">
                        <span class="match-game-index">J${game.game}</span>
                        <span class="match-game-body">
                            <strong>${esc(modalityLabel(game.gameType))}</strong>
                        </span>
                        ${game.isFinished ? icon("check") : `<span class="match-live-dot"></span>`}
                        ${icon("arrow")}
                    </a>
                `).join("")}
            </div>

            <div class="archive-card-footer">
                <span class="small muted">${icon("calendar")} ${esc(formatDate(group.firstSeenAt, true))}</span>
                <div class="archive-card-actions">
                    <a class="btn btn-primary btn-sm" href="${href}">
                        ${icon("play")} ${group.hasLive ? "Ver directo" : "Ver partida"}
                    </a>
                    <a class="btn btn-live btn-sm" href="${href}?tab=partida">
                        ${icon("history")} Repetición
                    </a>
                    <a class="btn btn-outline btn-sm" href="#/directo/partidas/${group.competitionId}/${group.matchId}/${primaryGame.game}/avanzado">
                        ${icon("list")} Avanzado
                    </a>
                </div>
            </div>
        </article>
    `;
}

function modalityLabel(gameType) {
    const type = String(gameType || "").toUpperCase();
    if (/CRICKET|MPR/.test(type)) return "Cricket";
    if (/X01|PPD|501|301|701|901/.test(type)) return "X01";
    return "Partida";
}

function previewBoard(item) {
    const darts = (item.preview || []).map(normalizeDart);
    if (!darts.length) {
        return `<div class="archive-preview-empty">${icon("target")}</div>`;
    }

    const marks = darts.map((dart, index) => ({
        index,
        dart,
        color: playerColor(dart.playerIndex),
        label: `${dart.playerName || `Jugador ${dart.playerIndex + 1}`} · ${hitLabel(dart)}`
    }));

    return boardSvg(marks, { showNumbers: false, label: "Resumen de la diana de la partida" });
}

import { api } from "../api.js?v=77";
import { esc, icon, formatRelative, emptyState, openModal } from "../ui.js?v=77";

export async function render(container, params) {
    const id = Number(params[0]);
    let bracket = null;
    let view = { x: 0, y: 0, scale: 1 };
    let hasInteracted = false;
    let timer = null;
    let controller = null;
    let panel = null;

    container.innerHTML = `
        <div class="page container bracket-page">
            <div class="bracket-page-head">
                <div>
                    <a class="section-link" href="#/directo">${icon("arrowLeft")} Volver a En directo</a>
                    <h1 class="section-title">Cuadrante <span class="accent">en directo</span></h1>
                    <p class="section-sub">Partidas, ganadores y actas oficiales. Arrastra para mover, rueda para acercar y clic en una partida para abrir el acta.</p>
                </div>
                <div class="bracket-page-actions">
                    <span class="bracket-live-status" id="bracket-live-status">${icon("refresh")} Cargando</span>
                    <span class="small muted">Actualización cada 30 s</span>
                </div>
            </div>

            <div class="bracket-panel" id="bracket-panel">
                <div class="bracket-toolbar">
                    <div class="bracket-title">
                        <span class="chip chip-type" id="bracket-type">${icon("trophy")} TORX</span>
                        <div>
                            <h2 id="bracket-name">Cargando cuadrante…</h2>
                            <small id="bracket-sub">Competición #${esc(id)}</small>
                        </div>
                    </div>
                    <div class="bracket-tools">
                        <div class="bracket-zoom" role="group" aria-label="Zoom del cuadrante">
                            <button class="bracket-tool" id="bracket-zoom-out" title="Alejar" aria-label="Alejar">${icon("zoomOut")}</button>
                            <button class="bracket-tool bracket-tool-text" id="bracket-fit" title="Ajustar" aria-label="Ajustar">Ajustar</button>
                            <button class="bracket-tool" id="bracket-zoom-in" title="Acercar" aria-label="Acercar">${icon("zoomIn")}</button>
                        </div>
                        <button class="bracket-tool bracket-tool-live" id="bracket-live" title="Centrar en la partida en directo" hidden>
                            ${icon("target")} <span>En vivo</span>
                        </button>
                        <button class="bracket-tool" id="bracket-refresh" title="Actualizar" aria-label="Actualizar">${icon("refresh")}</button>
                        <button class="bracket-tool" id="bracket-fullscreen" title="Pantalla completa" aria-label="Pantalla completa">${icon("expand")}</button>
                    </div>
                </div>

                <div class="bracket-stats" id="bracket-stats"></div>

                <div class="bracket-viewport" id="bracket-viewport">
                    <div class="bracket-canvas" id="bracket-canvas">
                        <div class="bracket-empty" id="bracket-loading">
                            <div>
                                <span class="bracket-loading-icon">${icon("refresh")}</span>
                                <p>Cargando cuadrante en directo…</p>
                                <small class="small muted">Consultando casillas, ganadores y actas.</small>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="bracket-legend">
                    <span><span class="legend-dot" style="background:var(--warning)"></span> Programada</span>
                    <span><span class="legend-dot" style="background:var(--live)"></span> En juego</span>
                    <span><span class="legend-dot" style="background:#6d7d73"></span> Finalizada</span>
                    <span><span class="legend-dot" style="background:rgba(255,255,255,.2)"></span> Pasa / vacía</span>
                    <span class="bracket-legend-hint">Clic en una partida para abrir el acta</span>
                </div>
            </div>
        </div>
    `;

    panel = container.querySelector("#bracket-panel");
    const viewport = container.querySelector("#bracket-viewport");
    bindControls();
    await load(true);
    timer = setInterval(() => load(false), 30000);

    function bindControls() {
        container.querySelector("#bracket-zoom-in")?.addEventListener("click", () => zoomBy(1.2));
        container.querySelector("#bracket-zoom-out")?.addEventListener("click", () => zoomBy(0.8));
        container.querySelector("#bracket-fit")?.addEventListener("click", () => fit());
        container.querySelector("#bracket-live")?.addEventListener("click", () => focusLive());
        container.querySelector("#bracket-refresh")?.addEventListener("click", () => load(false));
        container.querySelector("#bracket-fullscreen")?.addEventListener("click", async () => {
            panel?.classList.toggle("is-fullscreen");
            hasInteracted = false;
            setTimeout(() => fit(), 60);
        });

        viewport?.addEventListener("wheel", (event) => {
            event.preventDefault();
            const rect = viewport.getBoundingClientRect();
            const pointerX = event.clientX - rect.left;
            const pointerY = event.clientY - rect.top;
            const factor = event.deltaY < 0 ? 1.12 : 0.89;
            zoomAt(pointerX, pointerY, factor);
            hasInteracted = true;
        }, { passive: false });

        let dragging = false;
        let startX = 0;
        let startY = 0;
        let originX = 0;
        let originY = 0;

        viewport?.addEventListener("pointerdown", (event) => {
            if (event.target.closest(".bracket-cell")) return;
            dragging = true;
            startX = event.clientX;
            startY = event.clientY;
            originX = view.x;
            originY = view.y;
            viewport.classList.add("is-dragging");
            viewport.setPointerCapture?.(event.pointerId);
        });

        viewport?.addEventListener("pointermove", (event) => {
            if (!dragging) return;
            view.x = originX + (event.clientX - startX);
            view.y = originY + (event.clientY - startY);
            applyView();
            hasInteracted = true;
        });

        const endDrag = (event) => {
            if (!dragging) return;
            dragging = false;
            viewport.classList.remove("is-dragging");
            try { viewport.releasePointerCapture?.(event.pointerId); } catch { /* noop */ }
        };
        viewport?.addEventListener("pointerup", endDrag);
        viewport?.addEventListener("pointercancel", endDrag);
        viewport?.addEventListener("pointerleave", endDrag);
    }

    async function load(initial) {
        controller?.abort();
        controller = new AbortController();
        try {
            const data = await api.tournament(id, controller.signal);
            bracket = data;
            const name = container.querySelector("#bracket-name");
            const sub = container.querySelector("#bracket-sub");
            if (name) name.textContent = data.name || `Competición #${id}`;
            if (sub) sub.textContent = `Cuadrante oficial · ${data.cells.length} casillas · actualizado ${formatRelative(data.fetchedAt)}`;
            updateBracketMeta(data);
            draw(initial);
        } catch (error) {
            if (error.name === "AbortError") return;
            const canvas = container.querySelector("#bracket-canvas");
            if (canvas) {
                canvas.innerHTML = `
                    <div class="bracket-empty">
                        <div>
                            <p>No se pudo cargar el cuadrante.</p>
                            <p class="small muted">${esc(error.message)}</p>
                            <button class="btn btn-outline btn-sm" id="bracket-retry" style="margin-top:12px">Reintentar</button>
                        </div>
                    </div>
                `;
                canvas.querySelector("#bracket-retry")?.addEventListener("click", () => load(true));
            }
        }
    }

    function updateBracketMeta(data) {
        const cells = data.cells || [];
        const live = cells.filter((cell) => (cell.status || "").toUpperCase() === "PLAYING").length;
        const finished = cells.filter((cell) => ["F", "D"].includes((cell.status || "").toUpperCase())).length;
        const pending = cells.filter((cell) => (cell.team0 || cell.team1) && !["PLAYING", "F", "D"].includes((cell.status || "").toUpperCase())).length;

        const type = container.querySelector("#bracket-type");
        if (type) {
            const priority = String(data.levelPriority || "").toUpperCase();
            const label = ["TORX", "LIGA", "CAMP", "LVIRT"].includes(priority)
                ? priority
                : "Cuadrante";
            type.innerHTML = `${icon("trophy")} ${esc(label)}`;
        }

        const status = container.querySelector("#bracket-live-status");
        if (status) {
            if (live > 0) {
                status.className = "bracket-live-status is-live";
                status.innerHTML = `<span class="live-dot"></span>${live} ${live === 1 ? "partida" : "partidas"} en juego`;
            } else if (finished > 0) {
                status.className = "bracket-live-status is-finished";
                status.innerHTML = `${icon("check")} ${finished} ${finished === 1 ? "partida finalizada" : "partidas finalizadas"}`;
            } else {
                status.className = "bracket-live-status";
                status.innerHTML = `${icon("clock")} Programado`;
            }
        }

        const stats = container.querySelector("#bracket-stats");
        if (stats) {
            stats.innerHTML = `
                <div><span>Casillas</span><strong>${cells.length}</strong></div>
                <div class="is-live"><span>En juego</span><strong>${live}</strong></div>
                <div><span>Finalizadas</span><strong>${finished}</strong></div>
                <div><span>Pendientes</span><strong>${pending}</strong></div>
            `;
        }

        const liveButton = container.querySelector("#bracket-live");
        if (liveButton) liveButton.hidden = live === 0;
    }

    function focusLive() {
        if (!bracket) return;
        const viewport = container.querySelector("#bracket-viewport");
        if (!viewport) return;
        const cell = bracket.cells.find((item) => (item.status || "").toUpperCase() === "PLAYING");
        if (!cell) return;

        const rect = viewport.getBoundingClientRect();
        const cellWidth = bracket.config?.width || 180;
        const cellHeight = bracket.config?.height || 50;
        view.scale = 1.15;
        view.x = rect.width / 2 - (cell.left + cellWidth / 2) * view.scale;
        view.y = rect.height / 2 - (cell.top + cellHeight / 2) * view.scale;
        hasInteracted = true;
        applyView();

        const node = container.querySelector(`[data-cell-id="${cell.cellId}"]`);
        if (node) {
            node.classList.add("is-focused");
            setTimeout(() => node.classList.remove("is-focused"), 1600);
        }
    }

    function draw(initial) {
        const canvas = container.querySelector("#bracket-canvas");
        if (!canvas || !bracket) return;

        const cellWidth = bracket.config?.width || 180;
        const cellHeight = bracket.config?.height || 50;
        const maxLeft = bracket.cells.reduce((max, cell) => Math.max(max, cell.left || 0), 0);
        const maxTop = bracket.cells.reduce((max, cell) => Math.max(max, cell.top || 0), 0);
        const width = Math.max(bracket.width || 0, maxLeft + cellWidth + 60, 400);
        const height = Math.max(bracket.height || 0, maxTop + cellHeight + 60, 300);

        const lines = [
            ...(bracket.linesX || []).map((line) =>
                `<line class="bracket-line" x1="${line.x}" y1="${line.y}" x2="${line.x + line.xAdd}" y2="${line.y}" vector-effect="non-scaling-stroke"></line>`),
            ...(bracket.linesY || []).map((line) =>
                `<line class="bracket-line" x1="${line.x}" y1="${line.y1}" x2="${line.x}" y2="${line.y2}" vector-effect="non-scaling-stroke"></line>`)
        ].join("");

        const cells = bracket.cells.map((cell) => {
            const empty = !cell.team0 && !cell.team1;
            const status = (cell.status || "").toUpperCase();
            const classes = ["bracket-cell"];
            if (status === "OPEN") classes.push("is-open");
            else if (status === "PLAYING") classes.push("is-live");
            else if (status === "F" || status === "D") classes.push("is-finished");
            else if (status === "PASS") classes.push("is-pass");
            else if (status === "NULL" || empty) classes.push("is-empty");

            const winner0 = cell.winner === 0;
            const winner1 = cell.winner === 1;
            const showScores = status === "F" || status === "PLAYING" || status === "D" || cell.score0 > 0 || cell.score1 > 0;
            const meta = cell.dateTime
                ? formatCellDate(cell.dateTime)
                : (cell.machine0 || cell.machine1 || "");
            const title = [cell.team0, cell.team1].filter(Boolean).join(" vs ");
            const statusText = status === "PLAYING" ? "en juego" : status === "F" || status === "D" ? "finalizada" : "programada";

            return `
                <div class="${classes.join(" ")}" data-cell-id="${cell.cellId}" data-status="${esc(status)}"
                     style="left:${cell.left}px;top:${cell.top}px;width:${cellWidth}px;min-height:${cellHeight}px"
                     role="button" tabindex="0" aria-label="${esc(title || "Partida")}, ${statusText}"
                     title="${esc(title)}">
                    <span class="bc-status"></span>
                    <div class="bc-teams">
                        <div class="bc-row ${winner0 ? "is-winner" : ""}">
                            <span class="bc-team">${esc(cell.team0 || (empty ? "—" : "Por definir"))}</span>
                            ${showScores ? `<span class="bc-score">${cell.score0 ?? 0}</span>` : ""}
                        </div>
                        <div class="bc-row ${winner1 ? "is-winner" : ""}">
                            <span class="bc-team">${esc(cell.team1 || (empty ? "—" : "Por definir"))}</span>
                            ${showScores ? `<span class="bc-score">${cell.score1 ?? 0}</span>` : ""}
                        </div>
                    </div>
                    <div class="bc-footer">
                        ${meta ? `<span class="bc-meta">${icon("clock")} ${esc(meta)}</span>` : "<span></span>"}
                        ${status === "PLAYING" ? `<span class="bc-live">LIVE</span>` : ""}
                    </div>
                </div>
            `;
        }).join("");

        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        canvas.innerHTML = `
            <svg class="bracket-lines" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">${lines}</svg>
            ${cells}
        `;

        canvas.querySelectorAll(".bracket-cell:not(.is-empty)").forEach((node) => {
            const open = () => {
                const cell = bracket.cells.find((item) => String(item.cellId) === node.dataset.cellId);
                if (cell) openActa(cell);
            };
            node.addEventListener("click", open);
            node.addEventListener("keydown", (event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    open();
                }
            });
        });

        if (initial || !hasInteracted) {
            initialView();
        } else {
            applyView();
        }
    }

    function fit() {
        const viewport = container.querySelector("#bracket-viewport");
        const canvas = container.querySelector("#bracket-canvas");
        if (!viewport || !canvas || !bracket) return;

        const rect = viewport.getBoundingClientRect();
        const cellWidth = bracket.config?.width || 180;
        const maxLeft = bracket.cells.reduce((max, cell) => Math.max(max, cell.left || 0), 0);
        const maxTop = bracket.cells.reduce((max, cell) => Math.max(max, cell.top || 0), 0);
        const width = Math.max(bracket.width || 0, maxLeft + cellWidth + 80, 400);
        const height = Math.max(bracket.height || 0, maxTop + (bracket.config?.height || 50) + 80, 300);

        const scale = Math.min((rect.width - 40) / width, (rect.height - 40) / height, 1);
        view.scale = Math.max(0.12, scale);
        view.x = (rect.width - width * view.scale) / 2;
        view.y = (rect.height - height * view.scale) / 2;
        hasInteracted = false;
        applyView();
    }

    function initialView() {
        const viewport = container.querySelector("#bracket-viewport");
        if (!viewport || !bracket) return;

        const rect = viewport.getBoundingClientRect();
        const cellWidth = bracket.config?.width || 180;
        const maxLeft = bracket.cells.reduce((max, cell) => Math.max(max, cell.left || 0), 0);
        const maxTop = bracket.cells.reduce((max, cell) => Math.max(max, cell.top || 0), 0);
        const width = Math.max(bracket.width || 0, maxLeft + cellWidth + 80, 400);
        const height = Math.max(bracket.height || 0, maxTop + (bracket.config?.height || 50) + 80, 300);
        const fitScale = Math.min((rect.width - 40) / width, (rect.height - 40) / height, 1);

        if (fitScale >= 0.72) {
            fit();
            return;
        }

        const active = bracket.cells.filter((cell) => cell.team0 || cell.team1);
        if (!active.length) {
            fit();
            return;
        }

        const cellHeight = bracket.config?.height || 50;
        const right = Math.max(...active.map((cell) => (cell.left || 0) + cellWidth));
        const minTop = Math.min(...active.map((cell) => cell.top || 0));
        const activeMaxTop = Math.max(...active.map((cell) => (cell.top || 0) + cellHeight));
        const activeHeight = Math.max(cellHeight, activeMaxTop - minTop);

        view.scale = 0.85;
        view.x = rect.width - right * view.scale - 28;
        view.y = (rect.height - activeHeight * view.scale) / 2 - minTop * view.scale;
        hasInteracted = false;
        applyView();
    }

    function applyView() {
        const canvas = container.querySelector("#bracket-canvas");
        if (!canvas) return;
        canvas.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    }

    function zoomBy(factor) {
        const viewport = container.querySelector("#bracket-viewport");
        if (!viewport) return;
        const rect = viewport.getBoundingClientRect();
        zoomAt(rect.width / 2, rect.height / 2, factor);
        hasInteracted = true;
    }

    function zoomAt(pointerX, pointerY, factor) {
        const nextScale = Math.min(2.4, Math.max(0.1, view.scale * factor));
        const ratio = nextScale / view.scale;
        view.x = pointerX - (pointerX - view.x) * ratio;
        view.y = pointerY - (pointerY - view.y) * ratio;
        view.scale = nextScale;
        applyView();
    }

    async function openActa(cell) {
        const title = [cell.team0, cell.team1].filter(Boolean).join(" vs ") || `Partida #${cell.cellId}`;
        const modal = openModal({
            title,
            subtitle: "Acta oficial de la partida",
            content: `<div class="skeleton skeleton-line" style="height:20px;width:60%"></div><div class="skeleton skeleton-card" style="height:260px;margin-top:16px"></div>`
        });

        try {
            const [acta, recordingsResponse] = await Promise.all([
                api.acta(id, cell.cellId),
                api.liveRecordings().catch(() => null)
            ]);
            const recordings = recordingsResponse?.items || [];
            const matchRecordings = recordings
                .filter((recording) => recording.competitionId === id && recording.matchId === cell.cellId);
            modal.backdrop.querySelector(".modal-body").innerHTML = actaContent(acta, cell, matchRecordings);
            modal.backdrop.querySelectorAll("[data-advanced-link]").forEach((link) => {
                link.addEventListener("click", () => modal.close());
            });
        } catch (error) {
            modal.backdrop.querySelector(".modal-body").innerHTML = `
                <div class="error-box">
                    <strong>No se pudo cargar el acta.</strong>
                    <p style="margin:6px 0 14px">${esc(error.message)}</p>
                    <button class="btn btn-outline btn-sm" id="acta-retry">Reintentar</button>
                </div>
            `;
            modal.backdrop.querySelector("#acta-retry")?.addEventListener("click", () => {
                modal.close();
                openActa(cell);
            });
        }
    }

    function actaContent(acta, cell, recordings = []) {
        const advanced = advancedActa(recordings);

        if (!acta.rows?.length) {
            return `${emptyState("Sin acta disponible", "Esta partida todavía no tiene acta publicada.", "list")}${advanced}`;
        }

        const columns = acta.columns || 5;
        const headerRow = acta.rows[0];
        const players = acta.rows.slice(1);
        const team1 = players.slice(0, 6);
        const team2 = players.slice(6, 12);
        const hasScores = players.some((row) => row.cells?.some((cell) => cell && !/^T/.test(cell)));

        const renderRows = (rows, separator) => rows.map((row, index) => `
            <tr class="${separator && index === 0 ? "team-sep" : ""}">
                <td>
                    <strong>${esc(row.nick || "—")}</strong>
                    ${row.name ? `<small style="display:block;color:var(--muted)">${esc(row.name)}</small>` : ""}
                </td>
                ${Array.from({ length: columns }, (_, i) => `<td>${esc(row.cells?.[i] ?? "—")}</td>`).join("")}
            </tr>
        `).join("");

        return `
            <div class="acta-teams">
                <div class="acta-team">
                    <strong>${esc(acta.team1 || cell.team0 || "Equipo 1")}</strong>
                    <span>${team1.length} jugadores</span>
                </div>
                <div class="acta-score">${esc(acta.score1)} - ${esc(acta.score2)}</div>
                <div class="acta-team right">
                    <strong>${esc(acta.team2 || cell.team1 || "Equipo 2")}</strong>
                    <span>${team2.length} jugadores</span>
                </div>
            </div>
            <div class="table-scroll">
                <table class="data-table acta-table">
                    <thead>
                        <tr>
                            <th>Jugador</th>
                            ${Array.from({ length: columns }, (_, i) => `<th>J${i + 1}</th>`).join("")}
                        </tr>
                    </thead>
                    <tbody>
                        <tr class="game-row">
                            <td>${esc(headerRow.nick || "Juegos")}</td>
                            ${Array.from({ length: columns }, (_, i) => `<td>${esc(headerRow.cells?.[i] ?? "—")}</td>`).join("")}
                        </tr>
                        ${renderRows(team1, false)}
                        ${renderRows(team2, true)}
                    </tbody>
                </table>
            </div>
            <p class="small muted" style="margin:12px 0 0">${hasScores ? "Los valores de cada columna son los puntos anotados en cada juego." : "Acta oficial sin puntos registrados todavía."}</p>
            ${advanced}
        `;
    }

    function advancedActa(recordings) {
        if (!recordings.length) return "";
        return `
            <div class="acta-advanced">
                <div>
                    <strong>Partida finalizada</strong>
                    <p class="small muted">Diana completa con cada dardo y desglose por ronda${recordings.some((recording) => recording.isMock) ? " · simulación" : ""}.</p>
                </div>
                <div class="acta-advanced-actions">
                    ${recordings.map((recording) => `
                        <a class="btn btn-primary btn-sm" data-advanced-link href="#/directo/finalizadas/${recording.competitionId}/${recording.matchId}/${recording.game}">
                            ${icon("play")} Abrir partida · Juego ${recording.game} ${icon("arrow")}
                        </a>
                        <a class="btn btn-outline btn-sm" data-advanced-link href="#/directo/partidas/${recording.competitionId}/${recording.matchId}/${recording.game}/avanzado">
                            Avanzado ${icon("arrow")}
                        </a>
                    `).join("")}
                </div>
            </div>
        `;
    }

    return () => {
        if (timer) clearInterval(timer);
        controller?.abort();
        panel?.classList.remove("is-fullscreen");
    };
}

function formatCellDate(value) {
    if (!value) return "";
    const date = new Date(value.replace(" ", "T"));
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("es-ES", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
    }).format(date);
}

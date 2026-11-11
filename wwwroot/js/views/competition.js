import { api } from "../api.js?v=79";
import { esc, icon, formatDateRange, statusChip, typeIcon, emptyState, formatRelative } from "../ui.js?v=78";

export async function render(container, params, query) {
    const id = params[0];
    const type = (query.get("type") || "TORX").toUpperCase();
    let activeTab = "standings";

    container.innerHTML = loading();
    let data;
    try {
        data = await api.competition(id, type);
    } catch (error) {
        container.innerHTML = `
            <div class="page container">
                <a class="section-link" href="#/competiciones">${icon("arrowLeft")} Volver a competiciones</a>
                <div class="error-box" style="margin-top:20px">
                    <strong>No se pudo cargar la competición.</strong>
                    <p style="margin:6px 0 14px">${esc(error.message)}</p>
                    <button class="btn btn-outline btn-sm" id="cd-retry">Reintentar</button>
                </div>
            </div>
        `;
        container.querySelector("#cd-retry")?.addEventListener("click", () => render(container, params, query));
        return;
    }

    const summary = data.summary || {};
    const info = data.info || {};
    const standings = data.standings;

    container.innerHTML = `
        <div class="page container">
            <a class="section-link" href="#/competiciones">${icon("arrowLeft")} Volver a competiciones</a>

            <section class="detail-hero" style="margin-top:16px">
                <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                    <span class="comp-type">${typeIcon(summary.type || type)} ${esc(summary.typeLabel || summary.type || type)}</span>
                    ${statusChip(summary.status, summary.isLive)}
                    <span class="chip chip-soft">#${esc(summary.id || id)}</span>
                </div>
                <h1>${esc(summary.name || info.name || `Competición ${id}`)}</h1>
                <div class="detail-meta">
                    <span>${icon("calendar")} ${esc(formatDateRange(summary.startsAt || info.startsAt, summary.endsAt || info.endsAt))}</span>
                    <span>${icon("target")} ${esc(info.game || summary.game || "Multijuego")}</span>
                    <span>${icon("pin")} ${esc(info.scope || "Ámbito Radikal")}</span>
                    <span>${icon("clock")} Actualizado ${esc(formatRelative(data.fetchedAt))}</span>
                </div>
                <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:18px">
                    ${data.hasBracket ? `<a class="btn btn-primary btn-sm" href="#/directo/torneo/${esc(id)}">${icon("play")} Abrir cuadrante en directo</a>` : ""}
                    <a class="btn btn-outline btn-sm" href="https://esp.radikalplayers.com/competiciones2.php?compid=${esc(id)}&tipo=${encodeURIComponent(summary.type || type)}" target="_blank" rel="noopener">Abrir en Radikal Players ${icon("external")}</a>
                </div>
            </section>

            <div class="detail-grid">
                <section>
                    <div class="tabs" id="cd-tabs">
                        <button class="tab active" data-tab="standings">Clasificación</button>
                        <button class="tab" data-tab="info">Información</button>
                    </div>
                    <div id="cd-content"></div>
                </section>
                <aside class="detail-side">
                    <div class="info-card">
                        <h4>Ficha rápida</h4>
                        <dl>
                            <div><dt>Tipo</dt><dd>${esc(summary.typeLabel || summary.type || type)}</dd></div>
                            <div><dt>Juego</dt><dd>${esc(info.game || summary.game || "Multijuego")}</dd></div>
                            <div><dt>Ámbito</dt><dd>${esc(info.scope || "—")}</dd></div>
                            <div><dt>Inicio</dt><dd>${esc(formatDateRange(summary.startsAt || info.startsAt, null))}</dd></div>
                            <div><dt>Fin</dt><dd>${esc(formatDateRange(null, summary.endsAt || info.endsAt))}</dd></div>
                        </dl>
                    </div>
                    <div class="info-card">
                        <h4>¿Qué puedes hacer aquí?</h4>
                        <p class="small muted" style="margin:0 0 10px">Consulta la clasificación oficial, revisa las fechas y abre el cuadrante interactivo si es un torneo.</p>
                        ${data.hasBracket ? `<a class="btn btn-outline btn-sm btn-block" href="#/directo/torneo/${esc(id)}">${icon("play")} Ver cuadrante</a>` : ""}
                    </div>
                </aside>
            </div>
        </div>
    `;

    function drawTab() {
        container.querySelectorAll("#cd-tabs .tab").forEach((tab) => {
            tab.classList.toggle("active", tab.dataset.tab === activeTab);
        });
        const content = container.querySelector("#cd-content");
        if (!content) return;
        content.innerHTML = activeTab === "info" ? infoTab(data) : standingsTab(standings);
    }

    container.querySelectorAll("#cd-tabs .tab").forEach((tab) => {
        tab.addEventListener("click", () => {
            activeTab = tab.dataset.tab;
            drawTab();
        });
    });

    drawTab();
}

function loading() {
    return `
        <div class="page container">
            <div class="skeleton skeleton-line" style="width:180px;height:18px"></div>
            <div class="skeleton" style="height:240px;border-radius:26px;margin:20px 0"></div>
            <div class="skeleton skeleton-card" style="height:380px"></div>
        </div>
    `;
}

function standingsTab(standings) {
    if (!standings || !standings.rows?.length) {
        return emptyState("Todavía no hay clasificación", "Esta competición aún no tiene una tabla de clasificación publicada. Consulta la información o vuelve más tarde.", "list");
    }

    const columns = standings.columns || [];
    return `
        ${standings.caption ? `<p class="small muted" style="margin:0 0 10px">${esc(standings.caption)}</p>` : ""}
        <div class="table-scroll">
            <table class="data-table">
                <thead>
                    <tr>${columns.map((column) => `<th>${esc(column)}</th>`).join("")}</tr>
                </thead>
                <tbody>
                    ${standings.rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("")}
                </tbody>
            </table>
        </div>
        <p class="small muted" style="margin-top:12px">Clasificación publicada por Radikal Players. Los datos se actualizan al consultar la competición.</p>
    `;
}

function infoTab(data) {
    const info = data.info || {};
    const summary = data.summary || {};
    return `
        <div class="info-card" style="margin-bottom:12px">
            <h4>Descripción</h4>
            <p style="margin:0;color:var(--text-soft)">${esc(info.description || "Sin descripción adicional publicada.")}</p>
        </div>
        <div class="info-card" style="margin-bottom:12px">
            <h4>Detalles</h4>
            <dl>
                <div><dt>Competición</dt><dd>${esc(summary.name || info.name || "—")}</dd></div>
                <div><dt>Juego</dt><dd>${esc(info.game || summary.game || "Multijuego")}</dd></div>
                <div><dt>Ámbito</dt><dd>${esc(info.scope || "—")}</dd></div>
                <div><dt>Fecha de inicio</dt><dd>${esc(formatDateRange(info.startsAt || summary.startsAt, null))}</dd></div>
                <div><dt>Fecha de fin</dt><dd>${esc(formatDateRange(null, info.endsAt || summary.endsAt))}</dd></div>
            </dl>
        </div>
        <div class="info-card">
            <h4>Enlace oficial</h4>
            <p class="small muted" style="margin:0 0 10px">La fuente original de esta competición está en Radikal Players.</p>
            <a class="btn btn-outline btn-sm" href="https://esp.radikalplayers.com/competiciones2.php?compid=${esc(summary.id)}&tipo=${encodeURIComponent(summary.type || "TORX")}" target="_blank" rel="noopener">Ver ficha oficial ${icon("external")}</a>
        </div>
    `;
}

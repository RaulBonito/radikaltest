import { api } from "../api.js?v=79";
import { esc, icon, formatNumber, emptyState } from "../ui.js?v=78";
import { officialCard } from "../components.js?v=77";

const TYPES = [
    { code: "ALL", label: "Todos", logo: null },
    { code: "PLATINUM", label: "Platinum", logo: "/img/brand/platinum.png" },
    { code: "GOLDEN", label: "Golden", logo: "/img/brand/golden.png" },
    { code: "SILVER", label: "Silver", logo: "/img/brand/silver.png" }
];

export async function render(container) {
    let data = null;
    let currentType = "ALL";
    let controller = null;
    const PAGE_SIZE = 24;
    let visibleCount = PAGE_SIZE;

    container.innerHTML = shell();
    await load();
    bindTabs();

    function shell() {
        return `
            <div class="page container official-page">
                <div class="section-head" style="margin-bottom:16px">
                    <div class="section-head-left">
                        <span class="kicker">${icon("crown")}Official Players</span>
                        <h1 class="section-title">La élite <span class="accent">Radikal</span></h1>
                        <p class="section-sub">Platinum, Golden y Silver: los jugadores que representan a Radikal Darts en competición.</p>
                    </div>
                    <a class="btn btn-outline btn-sm" href="https://esp.radikalplayers.com/officialplayers/index.php" target="_blank" rel="noopener">${icon("external")} Ver en Radikal</a>
                </div>

                <div class="official-tier-logos" id="official-tabs" role="tablist" aria-label="Tipo de Official Player">
                    ${TYPES.map((type) => `
                        <button class="official-tier ${type.code === "ALL" ? "active" : ""}" type="button"
                                data-type="${type.code}" role="tab" aria-selected="${type.code === "ALL"}">
                            ${type.logo
                                ? `<img src="${type.logo}" alt="${esc(type.label)} Official Players" loading="lazy">`
                                : `<span class="official-tier-all">Todos</span>`}
                        </button>
                    `).join("")}
                </div>

                <div class="official-toolbar">
                    <span class="small muted" id="official-summary">Cargando Official Players…</span>
                </div>

                <div id="official-content">
                    <div class="official-grid">
                        ${Array.from({ length: 8 }, () => `<div class="skeleton skeleton-card" style="height:340px"></div>`).join("")}
                    </div>
                </div>
            </div>
        `;
    }

    function bindTabs() {
        container.querySelectorAll("#official-tabs button").forEach((button) => {
            button.addEventListener("click", () => {
                container.querySelectorAll("#official-tabs button").forEach((b) => {
                    b.classList.remove("active");
                    b.setAttribute("aria-selected", "false");
                });
                button.classList.add("active");
                button.setAttribute("aria-selected", "true");
                currentType = button.dataset.type;
                visibleCount = PAGE_SIZE;
                draw();
            });
        });
    }

    async function load() {
        controller?.abort();
        controller = new AbortController();
        try {
            data = await api.officialPlayers(controller.signal);
            draw();
        } catch (error) {
            if (error.name === "AbortError") return;
            container.querySelector("#official-content").innerHTML = `
                <div class="error-box">
                    <strong>No se pudieron cargar los Official Players.</strong>
                    <p style="margin:6px 0 14px">${esc(error.message)}</p>
                    <button class="btn btn-outline btn-sm" id="official-retry">Reintentar</button>
                </div>
            `;
            container.querySelector("#official-retry")?.addEventListener("click", load);
        }
    }

    function draw() {
        if (!data) return;
        const items = currentType === "ALL" ? data.items : data.items.filter((player) => player.type === currentType);
        const summary = container.querySelector("#official-summary");
        const content = container.querySelector("#official-content");

        if (summary) {
            const label = currentType === "ALL" ? "Official Players" : `${currentType.charAt(0)}${currentType.slice(1).toLowerCase()} Official Players`;
            summary.innerHTML = `<strong style="color:var(--text)">${formatNumber(items.length)}</strong> ${esc(label)} · ${formatNumber(data.total)} en total`;
        }

        if (!items.length) {
            content.innerHTML = emptyState("Sin jugadores", "No hay Official Players en esta categoría.", "users");
            return;
        }

        // Las fotos oficiales pesan ~1,5 MB: mostramos por tandas para no saturar la red.
        const visible = items.slice(0, visibleCount);
        content.innerHTML = `
            <div class="official-grid">${visible.map(officialCard).join("")}</div>
            ${items.length > visible.length
                ? `<div class="official-more">
                       <button class="btn btn-outline" type="button" id="official-more">
                           Ver más (${formatNumber(items.length - visible.length)} restantes)
                       </button>
                   </div>`
                : ""}
        `;

        content.querySelectorAll("[data-official-link]").forEach((card) => {
            const go = () => { window.location.hash = card.dataset.officialLink; };
            card.addEventListener("click", go);
            card.addEventListener("keydown", (event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    go();
                }
            });
        });

        content.querySelector("#official-more")?.addEventListener("click", () => {
            visibleCount += PAGE_SIZE;
            draw();
        });
    }

    return () => controller?.abort();
}

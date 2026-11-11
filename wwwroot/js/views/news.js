import { api } from "../api.js?v=79";
import { esc, icon, emptyState } from "../ui.js?v=78";

export async function render(container) {
    let controller = null;
    let page = 1;
    let totalPages = 1;

    container.innerHTML = shell();
    await load(1);

    function shell() {
        return `
            <div class="page container news-page">
                <div class="section-head news-head">
                    <div class="section-head-left">
                        <span class="kicker">${icon("newspaper")} Noticias</span>
                        <h1 class="section-title">Actualidad <span class="accent">Radikal</span></h1>
                        <p class="section-sub">Resultados, torneos y avisos oficiales de Radikal Darts.</p>
                    </div>
                    <a class="btn btn-outline btn-sm" href="https://esp.radikalplayers.com/noticias.php" target="_blank" rel="noopener">${icon("external")} Noticias oficiales</a>
                </div>

                <div class="news-toolbar">
                    <span class="news-toolbar-count" id="news-count">Cargando noticias…</span>
                    <span class="news-toolbar-actions">
                        <span class="news-source">${icon("shield")} Fuente oficial Radikal Players</span>
                        <a href="https://esp.radikalplayers.com/noticias.php" target="_blank" rel="noopener">Ver todas ${icon("external")}</a>
                    </span>
                </div>

                <div id="news-content">
                    <div class="news-loading">
                        <div class="skeleton skeleton-card" style="height:340px;border-radius:20px"></div>
                        <div class="news-loading-side">
                            <div class="skeleton skeleton-line"></div>
                            <div class="skeleton skeleton-line"></div>
                            <div class="skeleton skeleton-line"></div>
                        </div>
                    </div>
                </div>

                <div id="news-pagination" class="news-pagination"></div>
            </div>
        `;
    }

    async function load(nextPage) {
        controller?.abort();
        controller = new AbortController();
        page = nextPage;
        const content = container.querySelector("#news-content");
        const pagination = container.querySelector("#news-pagination");
        if (content) {
            content.innerHTML = `
                <div class="news-loading">
                    <div class="skeleton skeleton-card" style="height:340px;border-radius:20px"></div>
                    <div class="news-loading-side">
                        <div class="skeleton skeleton-line"></div>
                        <div class="skeleton skeleton-line"></div>
                        <div class="skeleton skeleton-line"></div>
                    </div>
                </div>
            `;
        }
        if (pagination) pagination.innerHTML = "";

        try {
            const response = await api.news({ page, pageSize: 12 }, controller.signal);
            totalPages = response.totalPages || 1;
            draw(response);
        } catch (error) {
            if (error.name === "AbortError") return;
            if (content) {
                content.innerHTML = `
                    <div class="error-box">
                        <strong>No se pudieron cargar las noticias.</strong>
                        <p style="margin:6px 0 14px">${esc(error.message)}</p>
                        <button class="btn btn-outline btn-sm" id="news-retry">Reintentar</button>
                    </div>
                `;
                content.querySelector("#news-retry")?.addEventListener("click", () => load(page));
            }
        }
    }

    function draw(response) {
        const content = container.querySelector("#news-content");
        const pagination = container.querySelector("#news-pagination");
        const count = container.querySelector("#news-count");
        const items = response.items || [];

        if (!items.length) {
            content.innerHTML = emptyState("Sin noticias", "No hay noticias publicadas en este momento.", "newspaper");
            if (count) count.textContent = "Sin noticias";
            return;
        }

        const featured = items[0];
        const side = items.slice(1, 4);
        const grid = items.slice(4);

        if (count) {
            count.innerHTML = `<strong>${items.length}</strong> noticias · página <strong>${page}</strong> de <strong>${totalPages}</strong>`;
        }

        content.innerHTML = `
            <section class="news-hero">
                <a class="news-hero-card" href="#/noticias/${featured.id}">
                    ${featured.imageUrl
                        ? `<img src="${esc(featured.imageUrl)}" alt="" loading="eager" data-hide-on-error>`
                        : `<span class="news-hero-empty">${icon("newspaper")}</span>`}
                    <span class="news-hero-body">
                        <span class="news-hero-eyebrow">${icon("spark")} Última noticia</span>
                        <span class="news-hero-date">${esc(featured.date || "Radikal Players")}</span>
                        <h2>${esc(featured.title)}</h2>
                        <p>${esc(featured.excerpt || "Noticia oficial de Radikal Darts.")}</p>
                        <span class="news-hero-cta">Leer noticia ${icon("arrow")}</span>
                    </span>
                </a>

                <aside class="news-latest">
                    <div class="news-latest-head">
                        <span class="kicker">${icon("clock")} Últimas</span>
                        <h3>También te puede interesar</h3>
                    </div>
                    <div class="news-latest-list">
                        ${side.map((item, index) => latestCard(item, index + 2)).join("")}
                    </div>
                </aside>
            </section>

            ${grid.length ? `
                <section class="news-more">
                    <div class="news-more-head">
                        <div>
                            <span class="kicker">${icon("list")} Más noticias</span>
                            <h2>Actualidad Radikal</h2>
                        </div>
                        <span class="news-page-chip">Página ${page} de ${totalPages}</span>
                    </div>
                    <div class="news-grid">
                        ${grid.map(newsCard).join("")}
                    </div>
                </section>
            ` : ""}
        `;

        drawPagination(pagination);
    }

    function latestCard(item, index) {
        return `
            <a class="news-latest-card" href="#/noticias/${item.id}">
                <span class="news-latest-img">
                    ${item.imageUrl
                        ? `<img src="${esc(item.imageUrl)}" alt="" loading="lazy" data-hide-on-error>`
                        : icon("newspaper")}
                </span>
                <span class="news-latest-copy">
                    <span class="news-latest-meta">
                        <b>${String(index).padStart(2, "0")}</b>
                        <small>${esc(item.date || "Noticia")}</small>
                    </span>
                    <strong>${esc(item.title)}</strong>
                </span>
            </a>
        `;
    }

    function newsCard(item) {
        return `
            <a class="news-card card-hover" href="#/noticias/${item.id}">
                <span class="news-card-img">
                    ${item.imageUrl
                        ? `<img src="${esc(item.imageUrl)}" alt="" loading="lazy" data-hide-on-error>`
                        : `<span class="news-card-empty">${icon("newspaper")}</span>`}
                </span>
                <span class="news-card-body">
                    <span class="date">${esc(item.date || "Noticia")}</span>
                    <h3>${esc(item.title)}</h3>
                    <p>${esc(item.excerpt || "Lee la noticia completa en Radikal Players.")}</p>
                    <span class="read">Leer noticia ${icon("arrow")}</span>
                </span>
            </a>
        `;
    }

    function drawPagination(pagination) {
        if (!pagination) return;

        if (totalPages <= 1) {
            pagination.innerHTML = "";
            return;
        }

        const pages = pageNumbers(page, totalPages);
        pagination.innerHTML = `
            <button class="news-page-btn" type="button" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""} aria-label="Página anterior">
                ${icon("chevronLeft")}
            </button>
            ${pages.map((value) => value === "…"
                ? `<span class="news-page-gap">…</span>`
                : `<button class="news-page-btn ${value === page ? "is-active" : ""}" type="button" data-page="${value}">${value}</button>`
            ).join("")}
            <button class="news-page-btn" type="button" data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""} aria-label="Página siguiente">
                ${icon("chevronRight")}
            </button>
            <span class="news-page-label">Página ${page} de ${totalPages}</span>
        `;

        pagination.querySelectorAll("[data-page]").forEach((button) => {
            button.addEventListener("click", () => {
                const target = Number(button.dataset.page);
                if (!Number.isFinite(target) || target < 1 || target > totalPages || target === page) return;
                load(target);
                container.querySelector(".news-head")?.scrollIntoView({ behavior: "smooth", block: "start" });
            });
        });
    }

    function pageNumbers(current, total) {
        const values = new Set([1, total, current, current - 1, current + 1]);
        const ordered = [...values].filter((value) => value >= 1 && value <= total).sort((a, b) => a - b);
        const result = [];
        ordered.forEach((value, index) => {
            if (index && value - ordered[index - 1] > 1) result.push("…");
            result.push(value);
        });
        return result;
    }

    return () => controller?.abort();
}

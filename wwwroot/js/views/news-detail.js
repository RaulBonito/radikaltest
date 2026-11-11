import { api } from "../api.js?v=77";
import { esc, icon, toast } from "../ui.js?v=77";

export async function render(container, params) {
    const id = params[0];
    container.innerHTML = `
        <div class="page container article-page">
            <a class="article-back" href="#/noticias">${icon("arrowLeft")} Volver a noticias</a>
            <div class="skeleton article-skeleton-hero"></div>
            <div class="article-skeleton-body">
                <div class="skeleton skeleton-line" style="height:18px;width:80%"></div>
                <div class="skeleton skeleton-line" style="height:18px;width:70%"></div>
                <div class="skeleton skeleton-line" style="height:18px;width:74%"></div>
            </div>
        </div>
    `;

    try {
        const item = await api.newsDetail(id);
        const paragraphs = item.paragraphs || [];
        const wordCount = [item.excerpt, ...paragraphs].filter(Boolean).join(" ").split(/\s+/).filter(Boolean).length;
        const readMinutes = Math.max(1, Math.round(wordCount / 200));

        container.innerHTML = `
            <div class="page container article-page">
                <a class="article-back" href="#/noticias">${icon("arrowLeft")} Volver a noticias</a>

                <article>
                    <div class="article-hero">
                        ${item.imageUrl ? `<img src="${esc(item.imageUrl)}" alt="" data-hide-on-error>` : `<span class="article-hero-empty">${icon("newspaper")}</span>`}
                        <div class="article-hero-body">
                            <div class="article-hero-meta">
                                <span class="chip chip-soft">${icon("newspaper")} Noticia oficial</span>
                                <span class="article-date">${esc(item.date || "Radikal Players")}</span>
                            </div>
                            <h1>${esc(item.title)}</h1>
                        </div>
                    </div>

                    <div class="article-layout">
                        <div class="article-body">
                            ${item.excerpt ? `<p class="lead">${esc(item.excerpt)}</p>` : ""}
                            ${paragraphs.map((paragraph) => `<p>${esc(paragraph)}</p>`).join("")}

                            <div class="article-actions">
                                <a class="btn btn-outline btn-sm" href="${esc(item.url)}" target="_blank" rel="noopener">Leer en Radikal Players ${icon("external")}</a>
                                <a class="btn btn-ghost btn-sm" href="#/noticias">${icon("arrowLeft")} Más noticias</a>
                            </div>
                        </div>

                        <aside class="article-side">
                            <div class="article-side-card">
                                <span class="kicker">${icon("info")} Ficha</span>
                                <h3>Sobre esta noticia</h3>
                                <dl class="article-side-dl">
                                    <div><dt>Fecha</dt><dd>${esc(item.date || "—")}</dd></div>
                                    <div><dt>Fuente</dt><dd>Radikal Players</dd></div>
                                    <div><dt>Lectura</dt><dd>${readMinutes} min</dd></div>
                                </dl>
                                <button class="btn btn-primary btn-sm article-share" id="article-share" type="button">
                                    ${icon("external")} Compartir noticia
                                </button>
                                <a class="btn btn-outline btn-sm article-official" href="${esc(item.url)}" target="_blank" rel="noopener">
                                    Ver en Radikal ${icon("external")}
                                </a>
                            </div>
                        </aside>
                    </div>
                </article>
            </div>
        `;

        container.querySelector("#article-share")?.addEventListener("click", async () => {
            const shareData = {
                title: item.title,
                text: item.excerpt || "Noticia de Radikal Players",
                url: window.location.href
            };
            if (navigator.share) {
                try {
                    await navigator.share(shareData);
                    return;
                } catch {
                    // El usuario canceló o el navegador no completó la acción.
                }
            }
            try {
                await navigator.clipboard.writeText(window.location.href);
                toast("Enlace copiado al portapapeles", "success");
            } catch {
                toast("No se pudo copiar el enlace", "error");
            }
        });
    } catch (error) {
        container.innerHTML = `
            <div class="page container article-page">
                <a class="article-back" href="#/noticias">${icon("arrowLeft")} Volver a noticias</a>
                <div class="error-box" style="margin-top:20px">
                    <strong>No se pudo cargar la noticia.</strong>
                    <p style="margin:6px 0 14px">${esc(error.message)}</p>
                    <button class="btn btn-outline btn-sm" id="news-detail-retry">Reintentar</button>
                </div>
            </div>
        `;
        container.querySelector("#news-detail-retry")?.addEventListener("click", () => render(container, params));
    }
}

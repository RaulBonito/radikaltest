import { api } from "../api.js?v=77";
import { esc, icon, formatNumber, toast } from "../ui.js?v=77";
import { addToCart, loadCart } from "../cart.js?v=77";

export async function render(container, params = []) {
    const productId = Number(params[0]);
    const controller = new AbortController();
    let product = null;
    let activeMedia = 0;

    container.innerHTML = `
        <div class="page container product-page">
            <div class="skeleton skeleton-line" style="width:200px;height:18px"></div>
            <div class="product-layout" style="margin-top:18px">
                <div class="skeleton" style="aspect-ratio:4/3;border-radius:18px"></div>
                <div>
                    <div class="skeleton skeleton-line" style="width:70%;height:36px"></div>
                    <div class="skeleton skeleton-line" style="width:90%;height:16px;margin:14px 0"></div>
                    <div class="skeleton skeleton-line" style="width:60%;height:16px"></div>
                </div>
            </div>
        </div>
    `;

    try {
        const [detail] = await Promise.all([
            api.shopProduct(productId),
            loadCart().catch(() => null)
        ]);
        product = detail;
        paint();
    } catch (error) {
        container.innerHTML = `
            <div class="page container">
                <div class="error-box">
                    <strong>No se pudo abrir este producto.</strong>
                    <p style="margin:6px 0 14px">${esc(error.message || "Radikal no ha respondido.")}</p>
                    <a class="btn btn-outline btn-sm" href="#/tienda">Volver a la tienda</a>
                </div>
            </div>
        `;
        return () => controller.abort();
    }

    container.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-add-cart]");
        if (!button || button.disabled) return;

        const id = Number(button.dataset.addCart);
        const original = button.innerHTML;
        button.disabled = true;
        button.innerHTML = `${icon("clock")} Añadiendo…`;
        try {
            await addToCart(id, 1);
            button.innerHTML = `${icon("check")} Añadido al carrito`;
            setTimeout(() => {
                if (button.isConnected) {
                    button.disabled = false;
                    button.innerHTML = original;
                }
            }, 1800);
        } catch (error) {
            toast(error.message || "No se pudo añadir el producto.", "error");
            button.disabled = false;
            button.innerHTML = original;
        }
    }, { signal: controller.signal });

    function media() {
        const list = (product.media || []).filter((item) => item && item.url);
        if (list.length) return list;
        return product.imageUrl ? [{ type: "image", url: product.imageUrl }] : [];
    }

    function paint() {
        const items = media();
        const current = items[Math.min(activeMedia, items.length - 1)];
        const price = product.price != null
            ? new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(product.price)
            : null;
        const canAdd = Boolean(product.priceGroup && !product.priceGroup.apiManaged);

        container.innerHTML = `
            <div class="page container product-page">
                <a class="product-back" href="#/tienda">${icon("arrowLeft")} Tienda</a>

                <div class="product-layout">
                    <div class="product-media">
                        <div class="product-stage">
                            ${current ? mediaStage(current) : `<div class="product-stage-empty">${icon("spark")}<span>Sin imagen disponible</span></div>`}
                        </div>
                        ${items.length > 1 ? `
                            <div class="product-thumbs">
                                ${items.map((item, index) => `
                                    <button class="product-thumb ${index === activeMedia ? "is-active" : ""}" type="button"
                                            data-media="${index}" aria-label="Ver medio ${index + 1}">
                                        ${item.type === "video" && item.previewUrl
                                            ? `<img src="${esc(item.previewUrl)}" alt="">`
                                            : item.type === "image"
                                                ? `<img src="${esc(item.url)}" alt="">`
                                                : icon("play")}
                                        ${item.type === "video" ? `<span class="product-thumb-play">${icon("play")}</span>` : ""}
                                    </button>
                                `).join("")}
                            </div>
                        ` : ""}
                    </div>

                    <div class="product-info">
                        ${product.category ? `<span class="product-category">${esc(product.category)}</span>` : ""}
                        <h1>${esc(product.title)}</h1>
                        <p class="product-desc">${esc(product.description || "Producto oficial de Radikal Darts.")}</p>

                        <div class="product-buy">
                            <div class="product-price">
                                ${product.points ? `<span class="shop-points">${formatNumber(product.points)} <small>pts</small></span>` : ""}
                                ${price ? `<span class="product-euro">${esc(price)}</span>` : ""}
                            </div>
                            ${canAdd
                                ? `<button class="btn btn-primary" type="button" data-add-cart="${product.id}">${icon("bag")} Añadir al carrito</button>`
                                : `<a class="btn btn-primary" href="${esc(product.url)}" target="_blank" rel="noopener">Elegir en Radikal ${icon("external")}</a>`}
                        </div>

                        <dl class="product-meta">
                            <div><dt>Referencia</dt><dd>#${esc(product.id)}</dd></div>
                            <div><dt>Medios</dt><dd>${items.length} ${items.length === 1 ? "archivo" : "archivos"}</dd></div>
                            <div><dt>Pago</dt><dd>Tienda oficial Radikal</dd></div>
                        </dl>

                        <a class="product-official" href="${esc(product.url)}" target="_blank" rel="noopener">
                            ${icon("external")} Ver en la tienda oficial
                        </a>
                    </div>
                </div>
            </div>
        `;

        container.querySelectorAll("[data-media]").forEach((button) => {
            button.addEventListener("click", () => {
                activeMedia = Number(button.dataset.media) || 0;
                paint();
            });
        });

        const videoWrap = container.querySelector("[data-video-src]");
        videoWrap?.querySelector("[data-play-video]")?.addEventListener("click", () => playVideo(videoWrap));

        // Autoplay silenciado: el vídeo de la personalización es la propia animación del producto.
        if (videoWrap) {
            const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
            if (!reduceMotion) playVideo(videoWrap);
        }
    }

    /**
     * Carga el vídeo oficial como Blob y lo reproduce. Algunos MP4 de Radikal llevan el índice
     * al final; servir todo el archivo con su MIME correcto es lo que reproduce de forma fiable
     * en todos los navegadores.
     */
    async function playVideo(wrap) {
        const src = wrap.dataset.videoSrc;
        const poster = wrap.dataset.videoPoster || "";
        wrap.classList.add("is-loading");

        try {
            const response = await fetch(src, { signal: controller.signal });
            if (!response.ok) throw new Error("Vídeo no disponible");
            const blob = await response.blob();
            const url = URL.createObjectURL(new Blob([blob], { type: "video/mp4" }));

            const video = document.createElement("video");
            video.className = "product-video";
            video.controls = true;
            video.autoplay = true;
            video.muted = true;
            video.loop = true;
            video.playsInline = true;
            video.src = url;
            if (poster) video.poster = poster;

            video.addEventListener("loadeddata", () => wrap.classList.remove("is-loading"), { once: true });
            video.addEventListener("error", () => {
                wrap.classList.remove("is-loading");
                wrap.classList.add("is-error");
                toast("No se pudo reproducir el vídeo oficial.", "error");
            }, { once: true });

            wrap.replaceChildren(video);
            video.play?.().catch(() => {});
            video.addEventListener("emptied", () => URL.revokeObjectURL(url), { once: true });
        } catch (error) {
            if (error.name === "AbortError") return;
            wrap.classList.remove("is-loading");
            wrap.classList.add("is-error");
            toast("No se pudo cargar el vídeo oficial.", "error");
        }
    }

    function mediaStage(item) {
        if (item.type === "video") {
            return `
                <div class="product-video-wrap" data-video-src="${esc(item.url)}"${item.previewUrl ? ` data-video-poster="${esc(item.previewUrl)}"` : ""}>
                    ${item.previewUrl
                        ? `<img class="product-video-poster" src="${esc(item.previewUrl)}" alt="">`
                        : ""}
                    <button class="product-video-play" type="button" data-play-video>
                        ${icon("play")} <span>Reproducir vídeo</span>
                    </button>
                </div>
            `;
        }

        return `<img class="product-image" src="${esc(item.url)}" alt="${esc(product.title)}" data-hide-on-error>`;
    }

    return () => {
        container.querySelector("[data-product-video]")?.pause();
        controller.abort();
    };
}


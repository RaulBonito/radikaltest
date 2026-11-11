import { api } from "../api.js?v=79";
import { esc, icon, formatNumber, emptyState, toast } from "../ui.js?v=78";
import { addToCart, cartCount, loadCart, subscribeCart } from "../cart.js?v=77";

const GROUP_LABELS = {
    BACKGROUND: "Fondos",
    DART: "Dardos",
    FEAT: "Feats",
    GOODSHOT: "Goodshots",
    MERCHANDISING: "Merchandising",
    CARD: "Tarjetas",
    PREMIUM: "Suscripciones",
    HOME: "Tarifas planas",
    TOURNAMENT: "Inscripciones"
};

const GROUP_ORDER = ["BACKGROUND", "DART", "FEAT", "GOODSHOT", "MERCHANDISING", "CARD", "PREMIUM", "HOME", "TOURNAMENT"];

export async function render(container) {
    let data = null;
    let activeCategory = null;
    let activeGroup = "ALL";
    let videoObserver = null;
    const controller = new AbortController();

    container.innerHTML = `
        <div class="page container shop-page">
            <div class="shop-head">
                <div class="skeleton skeleton-line" style="width:150px;height:22px"></div>
                <div class="skeleton skeleton-line" style="width:60%;height:40px;margin:14px 0"></div>
            </div>
            <div class="shop-grid">
                ${Array.from({ length: 6 }, () => `<div class="skeleton skeleton-card" style="height:340px"></div>`).join("")}
            </div>
        </div>
    `;

    try {
        [data] = await Promise.all([api.shop(), loadCart()]);
        activeCategory = data.categories.find((category) => category.products.length > 0)?.id ?? data.categories[0]?.id;
        draw();
    } catch (error) {
        container.innerHTML = `
            <div class="page container">
                <div class="error-box">
                    <strong>No se pudo cargar la tienda.</strong>
                    <p style="margin:6px 0 14px">${esc(error.message)}</p>
                    <button class="btn btn-outline btn-sm" id="shop-retry">Reintentar</button>
                </div>
            </div>
        `;
        container.querySelector("#shop-retry")?.addEventListener("click", () => render(container));
        controller.abort();
        return;
    }

    const unsubscribe = subscribeCart(() => updateCartIndicators(container));

    container.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-add-cart]");
        if (!button || button.disabled) return;

        // El botón de la tarjeta no debe abrir la ficha del producto.
        event.preventDefault();
        event.stopPropagation();

        const productId = Number(button.dataset.addCart);
        if (!productId) return;

        const original = button.innerHTML;
        button.disabled = true;
        button.innerHTML = `${icon("clock")} Añadiendo…`;
        try {
            await addToCart(productId, 1);
            button.innerHTML = `${icon("check")} Añadido`;
            setTimeout(() => {
                if (button.isConnected) {
                    button.disabled = false;
                    button.innerHTML = original;
                }
            }, 1500);
        } catch (error) {
            toast(error.message || "No se pudo añadir el producto.", "error");
            button.disabled = false;
            button.innerHTML = original;
        }
    }, { signal: controller.signal });

    function draw() {
        const categories = data.categories || [];
        const current = categories.find((category) => category.id === activeCategory) ?? categories[0];
        const products = current?.products || [];
        const groups = groupProducts(products);
        const total = categories.reduce((sum, category) => sum + category.products.length, 0);
        const visibleGroups = activeGroup === "ALL" ? groups : groups.filter((group) => group.key === activeGroup);

        container.innerHTML = `
            <div class="page container shop-page">
                <header class="shop-head">
                    <div>
                        <h1>Tienda</h1>
                        <p class="shop-lead">Personalizaciones, material e inscripciones oficiales de Radikal Darts.</p>
                    </div>
                    <div class="shop-head-actions">
                        <a class="btn btn-primary shop-cart-button" href="#/carrito">
                            ${icon("bag")} Carrito
                            <span class="shop-cart-count" data-shop-cart-count>${cartCount()}</span>
                        </a>
                    </div>
                </header>

                <div class="shop-toolbar">
                    <div class="shop-tabs" id="shop-tabs">
                        ${categories.map((category) => `
                            <button class="shop-tab ${category.id === activeCategory ? "active" : ""}" data-category="${category.id}" type="button">
                                ${esc(category.name)} <span>${category.products.length}</span>
                            </button>
                        `).join("")}
                    </div>
                    <span class="small muted">${formatNumber(total)} productos · precios oficiales</span>
                </div>

                ${groups.length > 1 ? `
                    <div class="shop-groups" id="shop-groups">
                        <button class="shop-group ${activeGroup === "ALL" ? "is-active" : ""}" type="button" data-group="ALL">
                            Todos <span>${products.length}</span>
                        </button>
                        ${groups.map((group) => `
                            <button class="shop-group ${activeGroup === group.key ? "is-active" : ""}" type="button" data-group="${esc(group.key)}">
                                ${esc(group.label)} <span>${group.products.length}</span>
                            </button>
                        `).join("")}
                    </div>
                ` : ""}

                ${visibleGroups.length ? visibleGroups.map((group) => `
                    <section class="shop-group-section">
                        ${activeGroup === "ALL" ? `
                            <header class="shop-group-head">
                                <h2>${esc(group.label)}</h2>
                                <span class="small muted">${group.products.length} ${group.products.length === 1 ? "producto" : "productos"}</span>
                            </header>
                        ` : ""}
                        <div class="shop-grid">
                            ${group.products.map(productCard).join("")}
                        </div>
                    </section>
                `).join("") : emptyState("Sin productos", "No hay productos en este grupo.", "spark")}

                <p class="shop-footnote">
                    ${icon("shield")}
                    El pago se completa en la tienda oficial de Radikal. Aquí preparamos tu carrito con los
                    precios y puntos oficiales.
                </p>
            </div>
        `;

        container.querySelectorAll("#shop-tabs .shop-tab").forEach((button) => {
            button.addEventListener("click", () => {
                activeCategory = Number(button.dataset.category);
                activeGroup = "ALL";
                draw();
            });
        });

        container.querySelectorAll(".shop-group").forEach((button) => {
            button.addEventListener("click", () => {
                activeGroup = button.dataset.group;
                draw();
            });
        });

        observeVideos();
    }

    /** Reproduce los vídeos de las tarjetas cuando entran en pantalla. */
    function observeVideos() {
        videoObserver?.disconnect();

        const videos = [...container.querySelectorAll("[data-card-video]")];
        if (!videos.length) return;

        const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
        if (reduceMotion) {
            videos.forEach((video) => video.pause?.());
            return;
        }

        videoObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                const video = entry.target;
                if (entry.isIntersecting) video.play?.().catch(() => {});
                else video.pause?.();
            });
        }, { threshold: 0.2 });

        videos.forEach((video) => videoObserver.observe(video));

        // Empuje inicial: el observer a veces no dispara hasta el primer scroll.
        const playVisible = () => {
            const height = window.innerHeight || 800;
            videos.forEach((video) => {
                const rect = video.getBoundingClientRect();
                if (rect.bottom > 0 && rect.top < height) video.play?.().catch(() => {});
            });
        };
        requestAnimationFrame(playVisible);
        setTimeout(playVisible, 300);
    }

    function updateCartIndicators(root) {
        const count = cartCount();
        root.querySelectorAll("[data-shop-cart-count]").forEach((node) => {
            node.textContent = String(count);
            node.classList.toggle("is-empty", count === 0);
        });
    }

    return () => {
        videoObserver?.disconnect();
        unsubscribe();
        controller.abort();
    };
}

function groupProducts(products) {
    const map = new Map();
    for (const product of products) {
        const key = (product.category || "OTROS").toUpperCase();
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(product);
    }

    return [...map.entries()]
        .map(([key, list]) => ({
            key,
            label: GROUP_LABELS[key] || key,
            products: list
        }))
        .sort((left, right) => {
            const leftIndex = GROUP_ORDER.indexOf(left.key);
            const rightIndex = GROUP_ORDER.indexOf(right.key);
            return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex);
        });
}

function productCard(product) {
    const price = product.price != null
        ? new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(product.price)
        : null;
    const canAdd = Boolean(product.priceGroup && !product.priceGroup.apiManaged);
    const video = (product.media || []).find((item) => item.type === "video");
    const href = `#/tienda/${product.id}`;
    const groupLabel = GROUP_LABELS[(product.category || "").toUpperCase()];

    return `
        <article class="shop-card">
            <a class="shop-media" href="${href}">
                ${video
                    ? `<video class="shop-media-video" src="${esc(video.url)}" ${video.previewUrl ? `poster="${esc(video.previewUrl)}"` : ""}
                              muted loop playsinline preload="metadata" data-card-video></video>`
                    : product.imageUrl
                        ? `<img src="${esc(product.imageUrl)}" alt="${esc(product.title)}" loading="lazy" data-hide-on-error>`
                        : `<span class="shop-media-empty">${icon("spark")}</span>`}
                ${groupLabel ? `<span class="shop-category">${esc(groupLabel)}</span>` : ""}
            </a>
            <div class="shop-card-body">
                <h3><a href="${href}">${esc(product.title)}</a></h3>
                <p>${esc(product.description || "Producto oficial de Radikal Darts.")}</p>
                <div class="shop-price-row">
                    <div class="shop-price">
                        ${product.points ? `<span class="shop-points">${formatNumber(product.points)} <small>pts</small></span>` : ""}
                        ${price ? `<span class="shop-euro">${esc(price)}</span>` : ""}
                    </div>
                    ${canAdd
                        ? `<button class="btn btn-primary btn-sm" type="button" data-add-cart="${product.id}">${icon("bag")} Añadir</button>`
                        : `<a class="btn btn-outline btn-sm" href="${href}">Ver ${icon("arrow")}</a>`}
                </div>
            </div>
        </article>
    `;
}

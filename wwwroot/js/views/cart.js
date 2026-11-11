import { esc, icon, toast, emptyState } from "../ui.js?v=78";
import {
    loadCart,
    subscribeCart,
    moneyLabel,
    setLineQuantity,
    removeLine,
    clearCart,
    officialAddUrl,
    officialCartUrl,
    cartCount
} from "../cart.js?v=77";

export async function render(container) {
    container.innerHTML = loadingView();

    const cart = await loadCart({ force: true });
    if (!cart) {
        container.innerHTML = errorView();
        container.querySelector("#cart-retry")?.addEventListener("click", () => render(container));
        return;
    }

    let pending = false;
    const unsubscribe = subscribeCart((next) => draw(container, next));

    draw(container, cart);

    async function draw(target, state) {
        const lines = state?.lines || [];
        target.innerHTML = cartView(state);

        target.querySelectorAll("[data-cart-qty]").forEach((button) => {
            button.addEventListener("click", async () => {
                if (pending) return;
                const lineId = Number(button.dataset.line);
                const delta = Number(button.dataset.cartQty);
                const line = lines.find((item) => item.lineId === lineId);
                if (!line) return;

                pending = true;
                target.querySelectorAll("[data-cart-qty], [data-cart-remove]").forEach((node) => { node.disabled = true; });
                try {
                    await setLineQuantity(lineId, line.quantity + delta);
                } catch (error) {
                    toast(error.message || "No se pudo actualizar la cantidad.", "error");
                } finally {
                    pending = false;
                }
            });
        });

        target.querySelectorAll("[data-cart-remove]").forEach((button) => {
            button.addEventListener("click", async () => {
                if (pending) return;
                pending = true;
                button.disabled = true;
                try {
                    await removeLine(Number(button.dataset.cartRemove));
                } catch (error) {
                    toast(error.message || "No se pudo quitar el producto.", "error");
                } finally {
                    pending = false;
                }
            });
        });

        target.querySelector("#cart-clear")?.addEventListener("click", async () => {
            if (pending) return;
            pending = true;
            try {
                await clearCart();
            } catch (error) {
                toast(error.message || "No se pudo vaciar el carrito.", "error");
            } finally {
                pending = false;
            }
        });

        target.querySelector("#cart-checkout")?.addEventListener("click", async (event) => {
            const button = event.currentTarget;
            if (pending || !lines.length) return;
            pending = true;
            button.disabled = true;
            button.textContent = "Abriendo tienda oficial...";
            try {
                await checkout(lines);
            } finally {
                pending = false;
                button.disabled = false;
                button.innerHTML = `Tramitar en Radikal ${icon("external")}`;
            }
        });
    }

    return () => unsubscribe();
}

function cartView(cart) {
    const lines = cart?.lines || [];
    const count = cartCount();

    return `
        <div class="page container cart-page">
            <div class="cart-page-head">
                <div>
                    <span class="kicker">${icon("bag")}Radikal Shop</span>
                    <h1 class="cart-title">Tu <span class="accent">carrito</span></h1>
                    <p class="section-sub">
                        ${count
                            ? `${count} ${count === 1 ? "artículo listo" : "artículos listos"} para tramitar en la tienda oficial de Radikal.`
                            : "Guarda aquí los productos que quieras comprar o canjear con tus Radikal Points."}
                    </p>
                </div>
                <a class="btn btn-outline btn-sm" href="#/tienda">${icon("arrowLeft")} Seguir comprando</a>
            </div>

            ${lines.length ? cartBody(cart, lines) : emptyView()}
        </div>
    `;
}

function cartBody(cart, lines) {
    return `
        <div class="cart-layout">
            <div class="cart-lines">
                ${lines.map(cartLine).join("")}
                <div class="cart-lines-note">
                    ${icon("shield")}
                    <span>Los precios, el stock y los puntos se validan con Radikal Players en cada cambio.</span>
                </div>
            </div>

            <aside class="cart-summary">
                <div class="cart-summary-head">
                    <span class="kicker">${icon("chart")}Resumen</span>
                    <h2>Total del carrito</h2>
                </div>
                <div class="cart-summary-row">
                    <span>Subtotal</span>
                    <strong>${esc(moneyLabel(cart.subtotal, "0 €"))}</strong>
                </div>
                <div class="cart-summary-row">
                    <span>Artículos</span>
                    <strong>${esc(String(cartCount()))}</strong>
                </div>
                <div class="cart-summary-row cart-summary-muted">
                    <span>Envío</span>
                    <span>Se calcula en Radikal</span>
                </div>
                <div class="cart-summary-total">
                    <span>Total</span>
                    <strong>${esc(moneyLabel(cart.total, "0 €"))}</strong>
                </div>
                <button class="btn btn-primary btn-block" id="cart-checkout" type="button">
                    Tramitar en Radikal ${icon("external")}
                </button>
                <button class="btn btn-ghost btn-block" id="cart-clear" type="button">Vaciar carrito</button>
                <p class="cart-summary-note">
                    Al tramitar, tus artículos se añaden al carrito oficial de Radikal en una nueva pestaña.
                    Allí podrás aplicar tus Radikal Points y completar el pago con tu cuenta.
                </p>
                <div class="cart-summary-trust">
                    ${icon("shield")} Compra protegida por Radikal Darts
                </div>
            </aside>
        </div>
    `;
}

function cartLine(line) {
    return `
        <article class="cart-line">
            <a class="cart-line-media" href="${esc(line.productUrl)}" target="_blank" rel="noopener">
                ${line.imageUrl
                    ? `<img src="${esc(line.imageUrl)}" alt="${esc(line.title)}" loading="lazy" data-hide-on-error>`
                    : `<span class="cart-line-placeholder">${icon("target")}</span>`}
            </a>
            <div class="cart-line-info">
                <span class="chip chip-soft">Producto oficial</span>
                <h3><a href="${esc(line.productUrl)}" target="_blank" rel="noopener">${esc(line.title)}</a></h3>
                <p>${esc(line.description || "Producto oficial de Radikal Darts.")}</p>
                <span class="cart-line-unit">${esc(moneyLabel(line.unitPrice, "Precio en Radikal"))} / ud.</span>
            </div>
            <div class="cart-line-controls">
                <div class="qty-stepper" aria-label="Cantidad de ${esc(line.title)}">
                    <button type="button" data-cart-qty="-1" data-line="${line.lineId}" aria-label="Quitar una unidad" ${line.quantity <= 1 ? "disabled" : ""}>−</button>
                    <span>${line.quantity}</span>
                    <button type="button" data-cart-qty="1" data-line="${line.lineId}" aria-label="Añadir una unidad" ${line.quantity >= 20 ? "disabled" : ""}>+</button>
                </div>
                <strong class="cart-line-total">${esc(moneyLabel(line.total, "—"))}</strong>
                <button class="cart-remove" type="button" data-cart-remove="${line.lineId}">
                    ${icon("trash")} Quitar
                </button>
            </div>
        </article>
    `;
}

function emptyView() {
    return `
        <div class="cart-empty">
            ${emptyState("Tu carrito está vacío", "Añade personalizaciones, material o inscripciones oficiales. El carrito se guarda en este dispositivo.", "bag")}
            <div class="cart-empty-actions">
                <a class="btn btn-primary" href="#/tienda">Explorar la tienda ${icon("arrow")}</a>
                <a class="btn btn-outline" href="${officialCartUrl()}" target="_blank" rel="noopener">Abrir tienda oficial ${icon("external")}</a>
            </div>
        </div>
    `;
}

function loadingView() {
    return `
        <div class="page container cart-page">
            <div class="skeleton skeleton-line" style="width:180px;height:18px"></div>
            <div class="skeleton skeleton-line" style="width:320px;height:56px;margin:18px 0"></div>
            <div class="cart-layout">
                <div>
                    ${Array.from({ length: 2 }, () => `<div class="skeleton" style="height:170px;border-radius:18px;margin-bottom:14px"></div>`).join("")}
                </div>
                <div class="skeleton" style="height:340px;border-radius:18px"></div>
            </div>
        </div>
    `;
}

function errorView() {
    return `
        <div class="page container cart-page">
            <div class="error-box">
                <h2 style="margin:0 0 8px;font-family:var(--font-display);text-transform:uppercase">No se pudo cargar el carrito</h2>
                <p style="margin:0 0 16px">Radikal Players no ha respondido. Vuelve a intentarlo en unos segundos.</p>
                <button class="btn btn-outline btn-sm" id="cart-retry" type="button">Reintentar</button>
            </div>
        </div>
    `;
}

async function checkout(lines) {
    const addUrls = lines.map(officialAddUrl).filter(Boolean);
    const popup = window.open("", "radikal-checkout", "width=1180,height=820");
    if (!popup) {
        toast("Permite las ventanas emergentes para tramitar el carrito en Radikal.", "error");
        return;
    }

    try {
        popup.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Radikal Shop</title></head>
            <body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#f3f6fa;font-family:Segoe UI,system-ui,sans-serif;color:#0b1f33">
                <div style="text-align:center">
                    <div style="width:46px;height:46px;border:4px solid #d5eaf2;border-top-color:#00a6d9;border-radius:50%;margin:0 auto 18px;animation:spin 1s linear infinite"></div>
                    <strong style="font-size:1.1rem">Abriendo tu carrito oficial de Radikal...</strong>
                    <p style="color:#6f8194;margin-top:6px">Estamos añadiendo tus productos a la tienda.</p>
                </div>
                <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
            </body></html>`);
        popup.document.close();

        for (let index = 0; index < addUrls.length; index++) {
            await delay(index === 0 ? 900 : 1600);
            try { popup.location.href = addUrls[index]; } catch { /* navegación cross-origin */ }
        }

        await delay(1700);
        try { popup.location.href = officialCartUrl(); } catch { /* navegación cross-origin */ }
        toast("Carrito enviado a la tienda oficial de Radikal", "success");
    } catch {
        try { popup.location.href = officialCartUrl(); } catch { /* noop */ }
    }
}

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

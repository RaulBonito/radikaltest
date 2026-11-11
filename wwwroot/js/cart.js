import { api } from "./api.js?v=79";
import { formatNumber, toast } from "./ui.js?v=78";

const OFFICIAL_CART = "https://esp.radikalplayers.com/shop/cart.php";
const listeners = new Set();

let cart = null;
let loading = null;
let queue = Promise.resolve();

function apply(next) {
    cart = next;
    updateCartBadge();
    listeners.forEach((listener) => {
        try { listener(cart); } catch { /* noop */ }
    });
    return cart;
}

export function getCart() {
    return cart;
}

export function subscribeCart(listener) {
    listeners.add(listener);
    if (cart) listener(cart);
    return () => listeners.delete(listener);
}

export function cartCount() {
    return (cart?.lines || []).reduce((total, line) => total + (Number(line.quantity) || 0), 0);
}

export function updateCartBadge() {
    const count = cartCount();
    document.querySelectorAll("[data-cart-count]").forEach((node) => {
        node.textContent = count > 99 ? "99+" : String(count);
        node.hidden = count === 0;
    });

    const link = document.getElementById("cart-link");
    if (link) link.setAttribute("aria-label", count ? `Carrito, ${count} artículos` : "Carrito");
}

export async function loadCart({ force = false } = {}) {
    if (loading) return loading;
    if (cart && !force) return cart;

    loading = api.shopCart(force)
        .then(apply)
        .catch(() => {
            cart = null;
            updateCartBadge();
            return null;
        })
        .finally(() => { loading = null; });

    return loading;
}

function enqueue(task) {
    const next = queue.then(task, task);
    queue = next.catch(() => {});
    return next;
}

export function addToCart(productId, quantity = 1) {
    return enqueue(async () => {
        const next = await api.shopCartAdd(productId, quantity);
        apply(next);
        toast("Producto añadido al carrito", "success");
        return next;
    });
}

export function setLineQuantity(lineId, quantity) {
    return enqueue(async () => {
        const next = quantity <= 0
            ? await api.shopCartRemove(lineId)
            : await api.shopCartQuantity(lineId, quantity);
        apply(next);
        return next;
    });
}

export function removeLine(lineId) {
    return enqueue(async () => {
        const next = await api.shopCartRemove(lineId);
        apply(next);
        toast("Producto quitado del carrito");
        return next;
    });
}

export function clearCart() {
    return enqueue(async () => {
        const next = await api.shopCartClear();
        apply(next);
        toast("Carrito vaciado");
        return next;
    });
}

export function moneyLabel(money, empty = "—") {
    if (!money) return empty;
    const parts = [];
    if (Number(money.points) > 0) parts.push(`${formatNumber(money.points)} pts`);
    if (Number(money.euros) > 0) {
        parts.push(new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(money.euros));
    }
    return parts.length ? parts.join(" + ") : empty;
}

export function officialAddUrl(line) {
    const group = line?.priceGroup;
    if (!group) return null;

    const params = new URLSearchParams({
        action: "ADD_PRODUCT",
        q: String(line.quantity || 1),
        pt: String(group.productTypeId),
        ps: String(group.productSubTypeId),
        pd: group.distributorId,
        p: String(group.productId),
        c: String(group.countryCode),
        v: String(group.vatTypeId),
        pg: String(group.priceGroupId)
    });

    return `${OFFICIAL_CART}?${params.toString()}`;
}

export function officialCartUrl() {
    return OFFICIAL_CART;
}

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ESC[char]);
}

export function icon(name, className = "") {
    const paths = {
        search: '<circle cx="10.5" cy="10.5" r="6.5"></circle><path d="m15.4 15.4 5.1 5.1"></path>',
        arrow: '<path d="M5 12h14"></path><path d="m13 6 6 6-6 6"></path>',
        arrowLeft: '<path d="M19 12H5"></path><path d="m11 18-6-6 6-6"></path>',
        external: '<path d="M14 3h7v7"></path><path d="M10 14 21 3"></path><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"></path>',
        copy: '<rect x="9" y="9" width="12" height="12" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>',
        calendar: '<rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M16 2v4M8 2v4M3 10h18"></path>',
        pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"></path><circle cx="12" cy="10" r="3"></circle>',
        camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"></path><circle cx="12" cy="13" r="3"></circle>',
        trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z"></path><path d="M7 6H4a2 2 0 0 0 2 4h1M17 6h3a2 2 0 0 1-2 4h-1"></path>',
        users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"></path>',
        target: '<circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="5"></circle><circle cx="12" cy="12" r="1"></circle>',
        clock: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
        refresh: '<path d="M20 11a8 8 0 0 0-14.9-4M4 4v5h5M4 13a8 8 0 0 0 14.9 4M20 20v-5h-5"></path>',
        zoomIn: '<circle cx="11" cy="11" r="7"></circle><path d="m21 21-4.3-4.3M11 8v6M8 11h6"></path>',
        zoomOut: '<circle cx="11" cy="11" r="7"></circle><path d="m21 21-4.3-4.3M8 11h6"></path>',
        expand: '<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"></path>',
        download: '<path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path>',
        close: '<path d="M6 6l12 12M18 6 6 18"></path>',
        list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"></path>',
        crown: '<path d="m3 7 4 4 5-7 5 7 4-4v11H3V7Z"></path><path d="M3 21h18"></path>',
        globe: '<circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"></path>',
        earth: '<circle cx="12" cy="12" r="10"></circle><path d="M21.54 15H17a2 2 0 0 0-2 2v4.54"></path><path d="M7 3.34V5a3 3 0 0 0 3 3 2 2 0 0 1 2 2 2 2 0 0 0 2 2 2 2 0 0 0 2-2 2 2 0 0 1 2-2h3.17"></path><path d="M11 21.95V18a2 2 0 0 0-2-2 2 2 0 0 1-2-2v-1a2 2 0 0 0-2-2H2.05"></path>',
        chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"></path><path d="M7 15v3"></path><path d="M12 9v9"></path><path d="M17 5v13"></path>',
        history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"></path><path d="M3 3v5h5"></path><path d="M12 7v5l3.5 2"></path>',
        newspaper: '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Z"></path><path d="M4 22a2 2 0 0 1-2-2v-9h4"></path><path d="M18 14h-8"></path><path d="M15 18h-5"></path><path d="M10 6h8v4h-8V6Z"></path>',
        sliders: '<path d="M4 21v-7"></path><path d="M4 10V3"></path><path d="M12 21v-9"></path><path d="M12 8V3"></path><path d="M20 21v-5"></path><path d="M20 12V3"></path><path d="M1 14h6"></path><path d="M9 8h6"></path><path d="M17 16h6"></path>',
        fire: '<path d="M12 22c4 0 7-2.7 7-6.5 0-2.7-1.5-5.1-3.7-7.2.2 1.6-.6 3-1.8 3.7.2-3.6-1.7-6.6-3.5-8-0.2 4-1.8 5.5-3.2 7.3A9.6 9.6 0 0 0 5 15.5C5 19.3 8 22 12 22Z"></path>',
        chevronLeft: '<path d="m15 18-6-6 6-6"></path>',
        chevronRight: '<path d="m9 18 6-6-6-6"></path>',
        phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z"></path>',
        facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3V2Z"></path>',
        map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"></path><path d="M9 3v15M15 6v15"></path>',
        spark: '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z"></path>',
        shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"></path>',
        play: '<path d="m8 5 11 7-11 7V5Z"></path>',
        pause: '<rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect>',
        skipBack: '<path d="M19 20 9 12l10-8v16Z"></path><path d="M5 19V5"></path>',
        skipForward: '<path d="m5 4 10 8-10 8V4Z"></path><path d="M19 5v14"></path>',
        volume: '<path d="M11 5 6 9H2v6h4l5 4V5Z"></path><path d="M15.5 8.5a5 5 0 0 1 0 7"></path><path d="M18.5 5.5a9 9 0 0 1 0 13"></path>',
        volumeOff: '<path d="M11 5 6 9H2v6h4l5 4V5Z"></path><path d="m22 9-6 6"></path><path d="m16 9 6 6"></path>',
        maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"></path><path d="M21 8V5a2 2 0 0 0-2-2h-3"></path><path d="M3 16v3a2 2 0 0 0 2 2h3"></path><path d="M16 21h3a2 2 0 0 0 2-2v-3"></path>',
        minimize: '<path d="M8 3v3a2 2 0 0 1-2 2H3"></path><path d="M21 8h-3a2 2 0 0 1-2-2V3"></path><path d="M3 16h3a2 2 0 0 1 2 2v3"></path><path d="M16 21v-3a2 2 0 0 1 2-2h3"></path>',
        message: '<path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2Z"></path>',
        send: '<path d="m22 2-7 20-4-9-9-4Z"></path><path d="M22 2 11 13"></path>',
        tv: '<rect x="2" y="6" width="20" height="13" rx="2"></rect><path d="m8 2 4 4 4-4"></path>',
        check: '<path d="m20 6-11 11-5-5"></path>',
        info: '<circle cx="12" cy="12" r="9"></circle><path d="M12 11v5M12 8h.01"></path>',
        bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4H6Z"></path><path d="M3 6h18M16 10a4 4 0 0 1-8 0"></path>',
        trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"></path>'
    };
    return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.info}</svg>`;
}

export function typeIcon(type) {
    const map = {
        TORX: "trophy",
        LIGA: "list",
        CAMP: "crown",
        LVIRT: "globe"
    };
    return `<span class="comp-type-icon">${icon(map[type] || "trophy")}</span>`;
}

export function statusChip(status, isLive = false) {
    switch (status) {
        case "live": return `<span class="chip chip-live">En curso</span>`;
        case "upcoming": return `<span class="chip chip-upcoming">Próxima</span>`;
        case "finished": return `<span class="chip chip-finished">Finalizada</span>`;
        default: return `<span class="chip chip-soft">Sin estado</span>`;
    }
}

export function officialBadge(type) {
    const normalized = String(type || "").toUpperCase();
    if (normalized === "PLATINUM") return `<span class="badge badge-platinum">Platinum</span>`;
    if (normalized === "GOLDEN") return `<span class="badge badge-golden">Golden</span>`;
    if (normalized === "SILVER") return `<span class="badge badge-silver">Silver</span>`;
    if (normalized === "BRONZE") return `<span class="badge badge-bronze">Bronze</span>`;
    return "";
}

export function initials(name) {
    return String(name || "?")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((word) => word[0] || "")
        .join("")
        .toUpperCase() || "?";
}

export function avatarHtml(name, url, extraClass = "") {
    const fallback = initials(name);
    if (!url) {
        return `<span class="player-photo-wrap ${esc(extraClass)}"><span class="avatar-fallback">${esc(fallback)}</span></span>`;
    }
    return `<span class="player-photo-wrap ${esc(extraClass)}">
        <img class="player-photo" src="${esc(url)}" alt="" loading="lazy" data-fallback="${esc(fallback)}">
        <span class="avatar-fallback" hidden>${esc(fallback)}</span>
    </span>`;
}

export function meaningfulDate(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    if (date.getFullYear() <= 2000) return null;
    return date;
}

const dateFormatter = new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric"
});

const dateTimeFormatter = new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
});

export function formatDate(value, withTime = false) {
    const date = meaningfulDate(value);
    if (!date) return "Fecha por confirmar";
    return (withTime ? dateTimeFormatter : dateFormatter).format(date);
}

export function formatDateRange(start, end) {
    const startDate = meaningfulDate(start);
    const endDate = meaningfulDate(end);
    if (startDate && endDate) return `${formatDate(start, true)} · ${dateFormatter.format(endDate)}`;
    if (startDate) return formatDate(start, true);
    if (endDate) return `Hasta ${dateFormatter.format(endDate)}`;
    return "Fechas por confirmar";
}

export function formatNumber(value) {
    const number = Number(value) || 0;
    if (Number.isInteger(number)) {
        return String(number).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    }
    return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(number);
}

export function formatRelative(timestamp) {
    if (!timestamp) return "ahora";
    const date = new Date(timestamp);
    const seconds = Math.round((Date.now() - date.getTime()) / 1000);
    if (seconds < 10) return "ahora mismo";
    if (seconds < 60) return `hace ${seconds} s`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `hace ${hours} h`;
    return formatDate(timestamp, true);
}

export function skeletonRows(count = 5) {
    return Array.from({ length: count }, () => `
        <div class="skeleton skeleton-line" style="height:56px;margin:10px 0;border-radius:12px"></div>
    `).join("");
}

export function skeletonCards(count = 6) {
    return Array.from({ length: count }, () => `<div class="skeleton skeleton-card"></div>`).join("");
}

export function emptyState(title, text, iconName = "info") {
    return `<div class="empty-state">${icon(iconName)}<h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;
}

export function errorState(message, retryId = "retry") {
    return `<div class="error-box" style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">
        <span>${esc(message || "No se pudieron cargar los datos.")}</span>
        <button class="btn btn-outline btn-sm" id="${esc(retryId)}">Reintentar</button>
    </div>`;
}

export function toast(message, type = "") {
    const root = document.getElementById("toast-root");
    if (!root) return;
    const node = document.createElement("div");
    node.className = `toast ${type}`;
    node.textContent = message;
    root.appendChild(node);
    setTimeout(() => {
        node.style.transition = "opacity .25s, transform .25s";
        node.style.opacity = "0";
        node.style.transform = "translateY(8px)";
        setTimeout(() => node.remove(), 300);
    }, 3400);
}

export function debounce(fn, wait = 300) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
}

let activeModal = null;

export function openModal({ title, subtitle = "", content, width = "" }) {
    closeModal();
    const root = document.getElementById("modal-root");
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
        <div class="modal-panel" role="dialog" aria-modal="true" style="${width ? `width:${esc(width)}` : ""}">
            <div class="modal-head">
                <div>
                    <h3>${esc(title)}</h3>
                    ${subtitle ? `<p>${esc(subtitle)}</p>` : ""}
                </div>
                <button class="icon-btn modal-close" aria-label="Cerrar">${icon("close")}</button>
            </div>
            <div class="modal-body">${content}</div>
        </div>
    `;
    root.appendChild(backdrop);
    document.body.style.overflow = "hidden";

    const close = () => {
        backdrop.remove();
        document.body.style.overflow = "";
        document.removeEventListener("keydown", onKey);
        activeModal = null;
    };
    const onKey = (event) => {
        if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    backdrop.querySelector(".modal-close")?.addEventListener("click", close);
    backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) close();
    });

    activeModal = { close, backdrop };
    return activeModal;
}

export function closeModal() {
    if (activeModal) {
        activeModal.close();
        activeModal = null;
    }
}

export function setupImageFallbacks() {
    document.addEventListener("error", (event) => {
        const image = event.target;
        if (!(image instanceof HTMLImageElement)) return;
        if (image.dataset.hideOnError !== undefined) {
            image.style.display = "none";
            return;
        }
        const fallback = image.dataset.fallback;
        if (fallback === undefined) return;
        image.hidden = true;
        const sibling = image.nextElementSibling;
        if (sibling && sibling.classList.contains("avatar-fallback")) {
            sibling.hidden = false;
        }
    }, true);
}

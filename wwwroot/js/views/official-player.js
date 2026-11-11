import { api } from "../api.js?v=79";
import { esc, icon, emptyState } from "../ui.js?v=78";
import { countryFlagHtml } from "../components.js?v=77";

const TYPE_LABEL = {
    PLATINUM: "Platinum Official Player",
    GOLDEN: "Golden Official Player",
    SILVER: "Silver Official Player"
};

const TYPE_LOGO = {
    PLATINUM: "/img/brand/platinum.png",
    GOLDEN: "/img/brand/golden.png",
    SILVER: "/img/brand/silver.png"
};

const SOCIAL_LABEL = {
    facebook: "Facebook",
    instagram: "Instagram",
    x: "X / Twitter",
    tiktok: "TikTok",
    youtube: "YouTube",
    twitch: "Twitch",
    web: "Web"
};

function socialIcon(network) {
    const paths = {
        facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3V2Z"></path>',
        instagram: '<rect x="3" y="3" width="18" height="18" rx="5"></rect><circle cx="12" cy="12" r="4"></circle><path d="M17.5 6.5h.01"></path>',
        x: '<path d="M4 4l16 16M20 4L4 20"></path>',
        tiktok: '<path d="M15 3v9.5a4.5 4.5 0 1 1-4.5-4.5"></path><path d="M15 3c0 2.5 2 4.5 4.5 4.5"></path>',
        youtube: '<rect x="2" y="5" width="20" height="14" rx="4"></rect><path d="m10 9 5 3-5 3V9Z"></path>',
        twitch: '<path d="M4 3h13l3 3v9l-4 4h-4l-3 3H7v-3H4V3Z"></path><path d="M11 8v4M16 8v4"></path>',
        web: '<circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"></path>'
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[network] || paths.web}</svg>`;
}

export async function render(container, params = []) {
    const id = Number(params[0]);
    let destroyed = false;
    let player = null;
    let lightboxIndex = -1;
    let cleanup = null;

    container.innerHTML = skeleton();

    try {
        player = await api.officialPlayer(id);
        if (destroyed) return;
        paint();
    } catch (error) {
        if (destroyed) return;
        container.innerHTML = `
            <div class="page container official-detail-page">
                <a class="official-back" href="#/official">${icon("arrowLeft")} Official Players</a>
                <div class="error-box" style="margin-top:18px">
                    <strong>No se pudo abrir la ficha.</strong>
                    <p style="margin:6px 0 14px">${esc(error.message || "Radikal no ha respondido.")}</p>
                    <a class="btn btn-outline btn-sm" href="#/official">Volver al listado</a>
                </div>
            </div>
        `;
    }

    function skeleton() {
        return `
            <div class="page container official-detail-page">
                <div class="skeleton skeleton-line" style="width:180px;height:18px"></div>
                <div class="official-hero-skeleton skeleton"></div>
            </div>
        `;
    }

    function paint() {
        const type = (player.type || "SILVER").toUpperCase();
        const tier = type.toLowerCase();
        const media = player.media || [];
        const stats = player.stats || [];
        const competitions = player.currentCompetitions || [];
        const socials = player.socials || [];
        const officialUrl = `https://esp.radikalplayers.com/officialplayers/officialplayer.php?officialplayer_id=${player.id}`;
        const shareUrl = `${location.origin}/#/official/${player.id}`;

        container.innerHTML = `
            <div class="page container official-detail-page official-tier-${tier}">
                <a class="official-back" href="#/official">${icon("arrowLeft")} Official Players</a>

                <section class="official-hero">
                    ${player.techCardUrl ? `
                        <div class="official-hero-bg" aria-hidden="true">
                            <img src="${esc(player.techCardUrl)}" alt="">
                        </div>
                    ` : ""}
                    <span class="official-hero-glow" aria-hidden="true"></span>
                    <div class="official-hero-media">
                        ${player.portraitUrl
                            ? `<img src="${esc(player.portraitUrl)}" alt="${esc(player.alias)}" class="official-hero-photo" data-hide-on-error>`
                            : `<span class="official-hero-initials">${esc(initialsOf(player.alias))}</span>`}
                        <span class="official-hero-badge">
                            <img src="${esc(TYPE_LOGO[type] || TYPE_LOGO.SILVER)}" alt="${esc(TYPE_LABEL[type] || type)}">
                        </span>
                    </div>

                    <div class="official-hero-info">
                        <span class="official-kicker">${esc(TYPE_LABEL[type] || type)}</span>
                        <h1 class="official-name">${esc(player.alias)}</h1>
                        ${player.name ? `<p class="official-realname">${esc(player.name)}</p>` : ""}

                        <div class="official-meta">
                            ${player.country ? `
                                <span class="official-meta-item">
                                    ${countryFlagHtml(player.countryCode) || `<span class="official-flag-fallback">${esc(player.country.slice(0, 2).toUpperCase())}</span>`}
                                    ${esc(player.country)}
                                </span>` : ""}
                            ${player.province ? `<span class="official-meta-item">${icon("pin")} ${esc(player.province)}</span>` : ""}
                            ${player.hand ? `<span class="official-meta-item">${icon("users")} Mano ${esc(player.hand.toLowerCase())}</span>` : ""}
                        </div>

                        <div class="official-actions">
                            <a class="btn btn-primary" href="${officialUrl}" target="_blank" rel="noopener">
                                ${icon("external")} Ficha oficial
                            </a>
                            <button class="btn btn-outline" type="button" data-share>${icon("external")} Compartir</button>
                        </div>
                    </div>
                </section>

                ${stats.length ? `
                    <section class="official-stats">
                        ${stats.map((stat) => `
                            <article class="official-stat">
                                <span>${esc(stat.label)}</span>
                                <strong>${esc(stat.value)}</strong>
                            </article>
                        `).join("")}
                    </section>
                ` : ""}

                ${media.length ? `
                    <section class="official-section">
                        <header class="official-section-head">
                            <h2>Galería</h2>
                            <span class="small muted">${media.length} ${media.length === 1 ? "imagen" : "imágenes"}</span>
                        </header>
                        <div class="official-gallery">
                            ${media.map((item, index) => `
                                <button class="official-shot" type="button" data-shot="${index}" aria-label="Ampliar imagen ${index + 1}">
                                    <img src="${esc(item.url)}&w=560" alt="" loading="lazy" decoding="async" data-hide-on-error>
                                </button>
                            `).join("")}
                        </div>
                    </section>
                ` : ""}

                <div class="official-columns">
                    <section class="official-section">
                        <header class="official-section-head">
                            <h2>Competiciones actuales</h2>
                        </header>
                        ${competitions.length
                            ? `<ul class="official-competitions">
                                ${competitions.map((competition) => `
                                    <li>
                                        <span class="official-competition-icon">${icon("trophy")}</span>
                                        <span>${esc(competition)}</span>
                                    </li>
                                `).join("")}
                            </ul>`
                            : emptyState("Sin competiciones activas", "Este jugador no tiene competiciones en curso ahora mismo.", "trophy")}
                    </section>

                    <aside class="official-section official-about">
                        <header class="official-section-head">
                            <h2>Compartir ficha</h2>
                        </header>
                        <div class="official-share">
                            <a class="official-share-btn" href="https://wa.me/?text=${encodeURIComponent(`${player.alias} · ${TYPE_LABEL[type]} ${shareUrl}`)}" target="_blank" rel="noopener">WhatsApp</a>
                            <a class="official-share-btn" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}" target="_blank" rel="noopener">Facebook</a>
                            <a class="official-share-btn" href="https://twitter.com/intent/tweet?text=${encodeURIComponent(`${player.alias} · ${TYPE_LABEL[type]}`)}&url=${encodeURIComponent(shareUrl)}" target="_blank" rel="noopener">X</a>
                            <a class="official-share-btn" href="mailto:?subject=${encodeURIComponent(player.alias)}&body=${encodeURIComponent(shareUrl)}">Email</a>
                        </div>

                        ${socials.length ? `
                            <header class="official-section-head" style="margin-top:20px">
                                <h2>Redes del jugador</h2>
                            </header>
                            <div class="official-socials">
                                ${socials.map((social) => `
                                    <a class="official-social official-social-${esc(social.network)}"
                                       href="${esc(social.url)}" target="_blank" rel="noopener"
                                       title="${esc(SOCIAL_LABEL[social.network] || social.network)}">
                                        ${socialIcon(social.network)}
                                        <span>${esc(SOCIAL_LABEL[social.network] || social.network)}</span>
                                    </a>
                                `).join("")}
                            </div>
                        ` : ""}

                        <p class="official-about-text">
                            ${esc(player.alias)} forma parte del programa <strong>Official Players</strong> de Radikal Darts:
                            jugadores que compiten con el respaldo oficial de la marca.
                        </p>
                    </aside>
                </div>
            </div>

            <div class="official-lightbox" id="official-lightbox" hidden>
                <button class="official-lightbox-close" type="button" data-lightbox-close aria-label="Cerrar">${icon("close")}</button>
                <button class="official-lightbox-nav prev" type="button" data-lightbox-prev aria-label="Anterior">${icon("chevronLeft")}</button>
                <img id="official-lightbox-img" alt="">
                <button class="official-lightbox-nav next" type="button" data-lightbox-next aria-label="Siguiente">${icon("chevronRight")}</button>
                <span class="official-lightbox-count" id="official-lightbox-count"></span>
            </div>
        `;

        bind();
    }

    function bind() {
        const media = player.media || [];
        const lightbox = container.querySelector("#official-lightbox");
        const image = container.querySelector("#official-lightbox-img");
        const counter = container.querySelector("#official-lightbox-count");

        const show = (index) => {
            if (!media.length) return;
            lightboxIndex = (index + media.length) % media.length;
            image.src = media[lightboxIndex].url;
            image.alt = `${player.alias} · imagen ${lightboxIndex + 1}`;
            counter.textContent = `${lightboxIndex + 1} / ${media.length}`;
            lightbox.hidden = false;
            document.body.style.overflow = "hidden";
        };

        const hide = () => {
            lightboxIndex = -1;
            lightbox.hidden = true;
            document.body.style.overflow = "";
        };

        container.querySelectorAll("[data-shot]").forEach((button) => {
            button.addEventListener("click", () => show(Number(button.dataset.shot)));
        });

        container.querySelector("[data-lightbox-close]")?.addEventListener("click", hide);
        container.querySelector("[data-lightbox-prev]")?.addEventListener("click", (event) => {
            event.stopPropagation();
            show(lightboxIndex - 1);
        });
        container.querySelector("[data-lightbox-next]")?.addEventListener("click", (event) => {
            event.stopPropagation();
            show(lightboxIndex + 1);
        });
        lightbox?.addEventListener("click", (event) => {
            if (event.target === lightbox || event.target === image) hide();
        });

        const onKey = (event) => {
            if (lightbox?.hidden) return;
            if (event.key === "Escape") hide();
            if (event.key === "ArrowLeft") show(lightboxIndex - 1);
            if (event.key === "ArrowRight") show(lightboxIndex + 1);
        };
        document.addEventListener("keydown", onKey);

        container.querySelector("[data-share]")?.addEventListener("click", async () => {
            const url = `${location.origin}/#/official/${player.id}`;
            try {
                if (navigator.share) {
                    await navigator.share({ title: player.alias, url });
                    return;
                }
                await navigator.clipboard.writeText(url);
                const button = container.querySelector("[data-share]");
                if (button) {
                    const original = button.innerHTML;
                    button.innerHTML = `${icon("check")} Enlace copiado`;
                    setTimeout(() => { if (button.isConnected) button.innerHTML = original; }, 1800);
                }
            } catch {
                // el usuario canceló o no hay permisos
            }
        });

        // limpieza del listener de teclado en desmontaje
        cleanup = () => document.removeEventListener("keydown", onKey);
    }

    return () => {
        destroyed = true;
        cleanup?.();
        document.body.style.overflow = "";
    };
}

function initialsOf(name) {
    return String(name || "?")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((word) => word[0] || "")
        .join("")
        .toUpperCase() || "?";
}

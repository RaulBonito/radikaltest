import {
    esc, icon, typeIcon, statusChip, officialBadge, avatarHtml,
    formatDateRange, formatNumber, initials
} from "./ui.js?v=77";
import { countryFlagUrl, countryFallback, countryName } from "./preferences.js?v=77";

const TYPE_THEME = {
    TORX: { icon: "trophy", className: "is-torx" },
    LIGA: { icon: "list", className: "is-liga" },
    CAMP: { icon: "crown", className: "is-camp" },
    LVIRT: { icon: "globe", className: "is-lvirt" }
};

export function competitionCard(competition) {
    const type = competition.type || "TORX";
    const theme = TYPE_THEME[type] || TYPE_THEME.TORX;
    const detailUrl = `#/competiciones/${competition.id}?type=${encodeURIComponent(type)}`;
    const status = competition.status || "upcoming";
    const dateRange = formatDateRange(competition.startsAt, competition.endsAt);

    return `
        <a class="comp-card comp-card-${status} card-hover" href="${detailUrl}">
            <span class="comp-rail ${theme.className}" aria-hidden="true"></span>

            <span class="comp-top">
                <span class="comp-type">${icon(theme.icon)} ${esc(competition.typeLabel || type)}</span>
                ${statusChip(status, competition.isLive)}
            </span>

            <h3 class="comp-name">${esc(competition.name)}</h3>

            <span class="comp-meta">
                <span class="comp-meta-item">${icon("calendar")} ${esc(dateRange)}</span>
                <span class="comp-meta-item">${icon("target")} ${esc(competition.game || "Multijuego")}</span>
            </span>

            <span class="comp-footer">
                <span class="comp-id">#${esc(competition.id)}</span>
                <span class="comp-open">Ver competición ${icon("arrow")}</span>
            </span>
        </a>
    `;
}

export function placeCard(place) {
    return `
        <article class="place-card">
            <div class="place-card-top">
                ${officialBadge(place.type)}
                <span class="chip chip-soft">${formatNumber(place.machines)} dianas</span>
            </div>
            <h4>${esc(place.name)}</h4>
            <div class="place-meta">${esc(place.type)} · ${place.lat.toFixed(3)}, ${place.lng.toFixed(3)}</div>
            <div class="place-actions">
                ${place.mapsUrl ? `<a href="${esc(place.mapsUrl)}" target="_blank" rel="noopener">${icon("map")} Maps</a>` : ""}
                ${place.phone ? `<a href="tel:${esc(place.phone)}">${icon("phone")} Llamar</a>` : ""}
                ${place.facebookUrl ? `<a href="${esc(place.facebookUrl)}" target="_blank" rel="noopener">${icon("facebook")} Facebook</a>` : ""}
                <a href="#/lugares?place=${place.id}">${icon("pin")} Ver en mapa</a>
            </div>
        </article>
    `;
}

export function newsCard(item) {
    return `
        <a class="news-card card-hover" href="#/noticias/${item.id}">
            <div class="news-card-img">
                ${item.imageUrl ? `<img src="${esc(item.imageUrl)}" alt="" loading="lazy" data-hide-on-error>` : ""}
            </div>
            <div class="news-card-body">
                <span class="date">${esc(item.date || "Noticia")}</span>
                <h3>${esc(item.title)}</h3>
                <p>${esc(item.excerpt || "Lee la noticia completa en Radikal Players.")}</p>
                <span class="read">Leer noticia ${icon("arrow")}</span>
            </div>
        </a>
    `;
}

export function newsMini(item) {
    return `
        <a class="news-mini" href="#/noticias/${item.id}">
            ${item.imageUrl ? `<img src="${esc(item.imageUrl)}" alt="" loading="lazy" data-hide-on-error>` : `<span style="width:88px;height:70px;border-radius:9px;background:rgba(255,255,255,.05);flex:0 0 auto"></span>`}
            <span>
                <h4>${esc(item.title)}</h4>
                <small>${esc(item.date || "")}</small>
            </span>
        </a>
    `;
}

export function podiumCard(player, place) {
    const badges = [];
    if (player.premium) badges.push(`<span class="badge badge-member">Member</span>`);
    if (player.officialPlayerType && player.officialPlayerType !== "NONE") {
        badges.push(officialBadge(player.officialPlayerType));
    }

    return `
        <button class="podium-card p${place}" type="button" data-rank-user="${esc(player.userId)}" data-place="${place}">
            <span class="podium-crown">${place === 1 ? icon("crown") : `#${player.rank}`}</span>
            <span class="podium-avatar">${avatarHtml(player.alias, player.photoUrl)}</span>
            <div class="podium-alias">
                ${esc(player.alias)}
                ${countryFlagHtml(player.countryCode)}
            </div>
            <div class="podium-real">${esc([player.firstName, player.lastName].filter(Boolean).join(" "))}</div>
            <div class="podium-score">${esc(player.value)}<small>${esc(player.game)}</small></div>
            <div class="podium-location">${icon("pin")} ${esc(player.location || "—")}</div>
            <div class="podium-badges">${badges.join("")}</div>
        </button>
    `;
}

export function rankingRow(player) {
    const badges = [];
    if (player.premium) badges.push(`<span class="badge badge-member">Member</span>`);
    if (player.officialPlayerType && player.officialPlayerType !== "NONE") {
        badges.push(officialBadge(player.officialPlayerType));
    }

    const movement = player.originalRank && player.originalRank !== player.rank
        ? `<span class="rank-move" title="Posición original en Radikal">${player.originalRank}</span>`
        : "";

    const rankClass = player.rank <= 3 ? "is-top" : player.rank <= 10 ? "is-elite" : "";

    return `
        <li class="rank-row ${rankClass}" tabindex="0" role="button" data-user-id="${esc(player.userId)}">
            <span class="rank-row-pos">${player.rank}${movement}</span>
            <span class="rank-row-avatar">${avatarHtml(player.alias, player.photoUrl)}</span>
            <span class="rank-row-main">
                <span class="rank-row-name">
                    <span>${esc(player.alias)}</span>
                    ${countryFlagHtml(player.countryCode)}
                </span>
                <span class="rank-row-sub">
                    <span class="rank-row-real">${esc([player.firstName, player.lastName].filter(Boolean).join(" ") || "—")}</span>
                    ${badges.length ? `<span class="player-tags">${badges.join("")}</span>` : ""}
                </span>
            </span>
            <span class="rank-row-loc">
                ${icon("pin")} ${esc(player.location || "—")}
            </span>
            <span class="rank-row-score">
                ${esc(player.value)}
                <small>${esc(player.game)}</small>
            </span>
        </li>
    `;
}

export function playerModalContent(player) {
    const rows = [
        ["Ranking", `#${player.rank}`],
        ["País", player.countryCode || "—"],
        ["Localidad", player.location || "—"],
        ["Juego", player.game || "—"],
        ["Valor", player.value || "—"],
        ["Miembro", player.premium ? "Sí" : "No"],
        ["Official Player", player.officialPlayerType && player.officialPlayerType !== "NONE" ? player.officialPlayerType : "No"],
        ["Válido hasta", player.validUntil || "—"]
    ];

    return `
        <div class="player-modal-head">
            ${avatarHtml(player.alias, player.photoUrl)}
            <div>
                <div class="kicker">${icon("users")}Radikal Player</div>
                <h2 style="margin:0;font-family:var(--font-display);font-size:1.7rem;text-transform:uppercase">${esc(player.alias)}</h2>
                <p class="muted small" style="margin:3px 0 8px">${esc([player.firstName, player.lastName].filter(Boolean).join(" "))}</p>
                <div class="player-tags">
                    ${countryTagHtml(player.countryCode)}
                    ${player.premium ? `<span class="badge badge-member">Member</span>` : ""}
                    ${player.officialPlayerType && player.officialPlayerType !== "NONE" ? officialBadge(player.officialPlayerType) : ""}
                </div>
            </div>
        </div>
        <div class="info-card" style="margin-top:20px">
            <dl>
                ${rows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("")}
            </dl>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px">
            <a class="btn btn-primary btn-sm" href="#/jugador/${encodeURIComponent(player.userId || "")}">Ver ficha completa ${icon("arrow")}</a>
            <a class="btn btn-outline btn-sm" href="https://www.radikalplayers.com/jugadores1.php?userID=${encodeURIComponent(player.userId || "")}" target="_blank" rel="noopener">Abrir perfil en Radikal ${icon("external")}</a>
            <a class="btn btn-ghost btn-sm" href="#/rankings">Volver al ranking</a>
        </div>
    `;
}

export function officialCard(player) {
    const type = (player.type || "SILVER").toUpperCase();
    const tier = type.toLowerCase();
    const logos = {
        PLATINUM: "/img/brand/platinum.png",
        GOLDEN: "/img/brand/golden.png",
        SILVER: "/img/brand/silver.png"
    };
    const href = `#/official/${player.id}`;

    return `
        <article class="official-player-card official-player-card-${tier}" data-official-link="${href}" tabindex="0" role="link"
                 aria-label="Ver ficha de ${esc(player.alias)}">
            <span class="official-player-media">
                ${player.photoUrl
                    ? `<img src="${esc(player.photoUrl)}${player.photoUrl.includes("?") ? "&" : "?"}w=460" alt="" loading="lazy" decoding="async" data-hide-on-error>`
                    : `<span class="official-player-initials">${esc(initials(player.alias))}</span>`}
                <span class="official-player-tier">
                    <img src="${esc(logos[type] || logos.SILVER)}" alt="${esc(type)}">
                </span>
            </span>
            <span class="official-player-body">
                <strong class="official-player-alias">${esc(player.alias)}</strong>
                <span class="official-player-type">${esc(type)} Official Player</span>
                <span class="official-player-cta">Ver ficha ${icon("arrow")}</span>
            </span>
        </article>
    `;
}

const TEST_ALIAS = /^(id\s*nulo|nulo|test|prueba|usuario\s*prueba)/i;

export function cleanRanking(players) {
    return (players || [])
        .filter((player) => player.alias && !TEST_ALIAS.test(player.alias.trim()))
        .map((player, index) => ({ ...player, rank: index + 1, originalRank: player.rank }));
}

export function emptyImage(label = "Sin imagen") {
    return `<span style="display:grid;place-items:center;width:100%;height:100%;background:rgba(255,255,255,.04);color:var(--muted);font-size:.7rem">${esc(label)}</span>`;
}

export function initialsAvatar(name) {
    return `<span class="avatar-fallback">${esc(initials(name))}</span>`;
}

/** Bandera del país como imagen (Windows no dibuja emoji de bandera). */
export function countryFlagHtml(code) {
    if (!code) return "";
    const url = countryFlagUrl(code);
    const name = esc(countryName(code));
    if (!url) {
        return `<span class="country-flag country-flag-text" title="${name}" aria-label="${name}">${esc(countryFallback(code))}</span>`;
    }
    return `<img class="country-flag" src="${esc(url)}" alt="${name}" title="${name}" width="20" height="14" decoding="async">`;
}

/** Chip con bandera + nombre del país. */
export function countryTagHtml(code) {
    if (!code) return "";
    return `<span class="country-tag">${countryFlagHtml(code)}${esc(countryName(code))}</span>`;
}

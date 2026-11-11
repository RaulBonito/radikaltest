import { api } from "../api.js?v=77";
import { esc, icon, avatarHtml, formatNumber, toast, emptyState, officialBadge } from "../ui.js?v=77";
import { countryTagHtml } from "../components.js?v=77";
import { countryName } from "../preferences.js?v=77";

const DIANA_LABEL = {
    aa: "Aro ancho",
    ae: "Aro estrecho",
    bb: "Bristle"
};

const OFFICIAL_LABEL = {
    PLATINUM: "Platinum Official Player",
    GOLDEN: "Golden Official Player",
    SILVER: "Silver Official Player"
};

const COMP_LABEL = {
    TORX: "Torneo",
    LIGA: "Liga",
    CAMP: "Campeonato",
    LVIRT: "Liga virtual"
};

export async function render(container, params = []) {
    const rawId = params[0] || "";
    let userId = rawId;
    try {
        userId = decodeURIComponent(rawId);
    } catch {
        // El segmento ya venía decodificado.
    }

    const controller = new AbortController();
    container.innerHTML = skeleton();

    try {
        const player = await api.player(userId, controller.signal);
        paint(player);
    } catch (error) {
        if (error?.name === "AbortError") return;
        paintError(error);
    }

    return () => controller.abort();

    function skeleton() {
        return `
            <div class="page container player-card-page">
                <div class="skeleton skeleton-line" style="width:160px;height:16px"></div>
                <div class="skeleton" style="height:210px;border-radius:20px;margin-top:18px"></div>
                <div class="skeleton" style="height:260px;border-radius:20px;margin-top:18px"></div>
            </div>
        `;
    }

    function paintError(error) {
        const notFound = error?.status === 404;
        container.innerHTML = `
            <div class="page container player-card-page">
                <a class="official-back" href="#/rankings">${icon("arrowLeft")} Volver a rankings</a>
                <div class="error-box" style="margin-top:18px">
                    <strong>${notFound ? "No encontramos a ese jugador" : "No se pudo abrir la ficha"}</strong>
                    <p style="margin:6px 0 16px">
                        ${notFound
                            ? "No encontramos ese Radikal ID o jugador. Revisa que esté bien escrito o prueba a buscar por alias o nombre completo."
                            : esc(error?.message || "Radikal no ha respondido.")}
                    </p>
                    <div style="display:flex;gap:10px;flex-wrap:wrap">
                        <button class="btn btn-primary btn-sm" type="button" data-open-search>
                            ${icon("search")} Buscar otro jugador
                        </button>
                        <a class="btn btn-outline btn-sm" href="#/rankings">${icon("trophy")} Ver rankings</a>
                    </div>
                </div>
            </div>
        `;
        container.querySelector("[data-open-search]")?.addEventListener("click", () => {
            document.getElementById("search-open")?.click();
        });
    }

    function paint(player) {
        const ranks = player.ranks || [];
        const groupedRanks = groupRanks(ranks);
        const stats = player.stats || [];
        const officialLabel = OFFICIAL_LABEL[(player.officialPlayerType || "").toUpperCase()] || null;
        const mprStats = stats.find((game) => game.game === "MPR");
        const ppdStats = stats.find((game) => game.game === "PPD");
        const ppdRating = splitRating(player.ratingPpd);
        const mprRating = splitRating(player.ratingMpr);
        const primaryStats = ppdStats || mprStats;
        const preferredDiana = player.preferredDiana || mostCommonDiana(ranks);
        const competitions = player.competitions || [];
        const summaryTiles = [
            { label: "Victorias", value: primaryStats?.wins, icon: "trophy" },
            { label: "Victorias por equipo", value: statValue(primaryStats, "Victorias por equipos"), icon: "users" },
            { label: "Win rate", value: primaryStats ? `${primaryStats.winPercent}%` : null, icon: "chart" },
            { label: "Low tons", value: statValue(ppdStats, "Low tons"), icon: "target" },
            { label: "Bulls", value: statValue(ppdStats, "Bulls") ?? statValue(mprStats, "Bulls"), icon: "target" },
            { label: "Doble bulls", value: statValue(ppdStats, "Doble bull") ?? statValue(mprStats, "Doble bull"), icon: "target" }
        ].filter((tile) => tile.value !== null && tile.value !== undefined && tile.value !== "");
        const isSelf = ranks.some((rank) => rank.scopeCode === "self");
        const shareId = player.radikalId || player.userId;
        const radikalUrl = `https://www.radikalplayers.com/jugadores1.php?userID=${encodeURIComponent(player.userId)}`;

        container.innerHTML = `
            <div class="page container player-card-page">
                <a class="official-back" href="#/rankings">${icon("arrowLeft")} Volver a rankings</a>

                <section class="player-hero player-card-hero">
                    <div class="player-avatar-xl">
                        ${avatarHtml(player.alias, player.photoUrl)}
                        ${officialLabel ? `<span class="avatar-badge">${esc(shortType(player.officialPlayerType))}</span>` : ""}
                    </div>

                    <div class="player-hero-info">
                        <div class="player-hero-top">
                            ${player.premium ? `<span class="badge badge-member">Member</span>` : ""}
                            ${officialLabel ? officialBadge(player.officialPlayerType) : ""}
                            ${player.ratingsShared ? `<span class="badge badge-outline">${icon("shield")} Medias compartidas</span>` : ""}
                            ${!player.premium && !officialLabel ? `<span class="chip">Radikal Player</span>` : ""}
                        </div>
                        <h1>${esc(player.alias)}</h1>

                        <div class="player-badges">
                            ${/^\d+$/.test(player.countryCode || "")
                                ? countryTagHtml(player.countryCode)
                                : player.countryName
                                    ? `<span class="badge badge-outline">${icon("globe")} ${esc(player.countryName)}</span>`
                                    : ""}
                            ${player.team ? `<span class="badge badge-outline">${icon("users")} ${esc(player.team)}</span>` : ""}
                            ${preferredDiana ? `<span class="badge badge-outline">${icon("target")} Diana ${esc(DIANA_LABEL[preferredDiana] || preferredDiana)}</span>` : ""}
                            ${player.location ? `<span class="badge badge-outline">${icon("pin")} ${esc(player.location)}</span>` : ""}
                        </div>

                        ${player.radikalId ? `
                            <div class="player-id-row">
                                <span class="player-id-label">Radikal ID</span>
                                <code class="player-id">${esc(player.radikalId)}</code>
                                <button class="btn btn-ghost btn-xs" type="button" data-copy-radikal>${icon("copy")} Copiar</button>
                            </div>
                        ` : ""}
                    </div>

                    ${ppdRating.value || mprRating.value ? `
                        <div class="player-hero-side">
                            ${mprRating.value ? `
                                <div class="hero-mini-stat">
                                    <span>MPR actual</span>
                                    <strong>${esc(mprRating.value)}</strong>
                                    <small>Rating Radikal${mprRating.suffix ? ` · ${esc(mprRating.suffix)}` : ""}</small>
                                </div>
                            ` : ""}
                            ${ppdRating.value ? `
                                <div class="hero-mini-stat">
                                    <span>PPD actual</span>
                                    <strong>${esc(ppdRating.value)}</strong>
                                    <small>Rating Radikal${ppdRating.suffix ? ` · ${esc(ppdRating.suffix)}` : ""}</small>
                                </div>
                            ` : ""}
                        </div>
                    ` : ""}
                </section>

                <div class="player-card-actions">
                    ${player.officialPlayerId ? `
                        <a class="btn btn-primary btn-sm" href="#/official/${player.officialPlayerId}">
                            ${icon("crown")} Ver ficha Official Player
                        </a>
                    ` : ""}
                    ${isSelf
                        ? `<a class="btn btn-outline btn-sm" href="#/mi-area">${icon("users")} Ir a mi área</a>`
                        : `<a class="btn btn-outline btn-sm" href="${esc(radikalUrl)}" target="_blank" rel="noopener">
                            ${icon("external")} Abrir perfil en Radikal
                        </a>`}
                    <button class="btn btn-ghost btn-sm" type="button" data-share>${icon("external")} Compartir ficha</button>
                </div>

                ${!ppdRating.value && !mprRating.value && player.radikalId ? `
                    <div class="player-login-banner">
                        <div>
                            <strong>Conecta tu cuenta para ver el rating oficial</strong>
                            <p>
                                Las medias PPD/MPR no están compartidas públicamente.
                                Conecta tu cuenta para verlas en privado.
                            </p>
                        </div>
                        <a class="btn btn-primary btn-sm" href="#/mi-area?next=${encodeURIComponent(`/jugador/${shareId}`)}">${icon("users")} Conectar mi cuenta</a>
                    </div>
                ` : ""}

                ${stats.length ? `
                    <section class="player-card-section player-stats-section">
                        <header class="player-card-section-head">
                            <h2>Resumen deportivo</h2>
                            <span class="small muted">
                                ${ppdRating.value || mprRating.value
                                    ? `Rating · PPD ${esc(ppdRating.value)} · MPR ${esc(mprRating.value)}`
                                    : "Medias privadas"}
                            </span>
                        </header>
                        ${!ppdRating.value && !mprRating.value ? `
                            <p class="player-rating-hint">
                                ${icon("info")}
                                El rating oficial y su historial se leen del área privada de Radikal.
                                <a href="#/mi-area?next=${encodeURIComponent(`/jugador/${shareId}`)}">Conectar mi cuenta</a>
                            </p>
                        ` : ""}
                        ${summaryTiles.length ? `
                            <div class="player-summary-grid">
                                ${summaryTiles.map((tile) => `
                                    <article class="player-summary-tile">
                                        <span class="player-summary-icon">${icon(tile.icon)}</span>
                                        <span class="player-summary-label">${esc(tile.label)}</span>
                                        <strong>${esc(tile.value)}</strong>
                                    </article>
                                `).join("")}
                            </div>
                        ` : ""}
                        ${primaryStats ? `
                            <p class="player-stats-line">
                                ${esc(primaryStats.games)} partidas · ${esc(primaryStats.wins)} victorias ·
                                ${esc(primaryStats.losses)} derrotas · ${esc(primaryStats.winPercent)}% win
                            </p>
                        ` : ""}
                    </section>
                ` : ""}

                ${player.radikalPoints != null || player.bonus != null || player.memberType || player.memberUntil ? `
                    <section class="player-card-section player-account-section">
                        <header class="player-card-section-head">
                            <h2>Cuenta Radikal</h2>
                            <span class="small muted">Datos del área privada</span>
                        </header>
                        <div class="player-account-grid">
                            ${player.radikalPoints != null ? `
                                <div><span>Radikal Points</span><strong>${formatNumber(player.radikalPoints)}</strong></div>
                            ` : ""}
                            ${player.bonus != null ? `
                                <div><span>Bonus</span><strong>${formatNumber(player.bonus)}</strong></div>
                            ` : ""}
                            ${player.memberType ? `
                                <div><span>Miembro</span><strong>${esc(player.memberType)}</strong></div>
                            ` : ""}
                            ${player.memberUntil ? `
                                <div><span>Válido hasta</span><strong>${esc(player.memberUntil)}</strong></div>
                            ` : ""}
                            ${preferredDiana ? `
                                <div><span>Diana preferida</span><strong>${esc(DIANA_LABEL[preferredDiana] || preferredDiana)}</strong></div>
                            ` : ""}
                        </div>
                    </section>
                ` : ""}

                ${competitions.length ? `
                    <section class="player-card-section player-competitions-section">
                        <header class="player-card-section-head">
                            <h2>Competiciones</h2>
                            <span class="small muted">
                                ${competitions.filter((competition) => !competition.finished).length} en curso ·
                                ${competitions.filter((competition) => competition.finished).length} finalizadas
                            </span>
                        </header>
                        <div class="player-competitions">
                            ${competitions.map((competition) => `
                                <a class="player-competition" href="#/competiciones/${competition.id}?type=${encodeURIComponent(competition.type || "TORX")}">
                                    <span class="player-competition-icon">${icon(competition.finished ? "history" : "trophy")}</span>
                                    <span class="player-competition-body">
                                        <strong>${esc(competition.name)}</strong>
                                        <small>${esc(COMP_LABEL[competition.type] || competition.type || "Competición")} · ${competition.finished ? "Finalizada" : "En curso"}</small>
                                    </span>
                                    <span class="player-competition-arrow">${icon("arrow")}</span>
                                </a>
                            `).join("")}
                        </div>
                    </section>
                ` : ""}

                ${(player.ratingHistory || []).length ? `
                    <section class="player-card-section player-history-section">
                        <header class="player-card-section-head">
                            <h2>Historial de rating</h2>
                            <span class="small muted">Fuente oficial de Radikal</span>
                        </header>
                        <div class="player-history-tables">
                            ${(player.ratingHistory || []).map((table) => `
                                <article class="player-history-table">
                                    ${table.title ? `<h3>${esc(table.title)}</h3>` : ""}
                                    <div class="table-scroll">
                                        <table class="data-table">
                                            ${table.headers?.length
                                                ? `<thead><tr>${table.headers.map((header) => `<th>${esc(header)}</th>`).join("")}</tr></thead>`
                                                : ""}
                                            <tbody>
                                                ${(table.rows || []).map((row) => `
                                                    <tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>
                                                `).join("")}
                                            </tbody>
                                        </table>
                                    </div>
                                </article>
                            `).join("")}
                        </div>
                    </section>
                ` : ""}

                <section class="player-card-section">
                    <header class="player-card-section-head">
                        <h2>Clasificaciones</h2>
                        <span class="small muted">${groupedRanks.length} ${groupedRanks.length === 1 ? "registro" : "registros"}</span>
                    </header>
                    ${groupedRanks.length ? `
                        <div class="table-scroll">
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>Juego</th>
                                        <th>Diana</th>
                                        <th>País</th>
                                        <th>Global</th>
                                        <th>Valor</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${groupedRanks.map((rank) => `
                                        <tr>
                                            <td>${esc(rank.game)}</td>
                                            <td>${esc(DIANA_LABEL[rank.diana] || rank.diana)}</td>
                                            <td>${rank.countryRank > 0
                                                ? `#${formatNumber(rank.countryRank)}`
                                                : rank.self ? "Actual" : "—"}</td>
                                            <td>${rank.globalRank > 0 ? `#${formatNumber(rank.globalRank)}` : "—"}</td>
                                            <td><strong>${esc(rank.value || "—")}</strong></td>
                                        </tr>
                                    `).join("")}
                                </tbody>
                            </table>
                        </div>
                    ` : emptyState(
                        "Sin clasificaciones públicas",
                        "Este jugador no aparece en el top público de Radikal. Su perfil completo está en la web oficial.",
                        "chart"
                    )}
                </section>

                <p class="player-card-note">
                    ${icon("info")}
                    ${isSelf
                        ? "Estos son los datos de tu sesión conectada. Puedes editarlos y ver todas tus estadísticas en Mi área."
                        : stats.length
                            ? "Estadísticas oficiales de Radikal (PPD/MPR) y ranking público. Para el historial completo de competiciones abre el perfil oficial."
                            : "La ficha se construye con los rankings públicos de Radikal Darts. Para estadísticas completas abre el perfil oficial."}
                </p>
            </div>
        `;

        const bindCopy = (selector, value, message) => {
            container.querySelector(selector)?.addEventListener("click", async () => {
                try {
                    await navigator.clipboard.writeText(value);
                    toast(message);
                } catch {
                    toast("No se pudo copiar el ID", "error");
                }
            });
        };
        if (player.radikalId) {
            bindCopy("[data-copy-radikal]", player.radikalId, "Radikal ID copiado al portapapeles");
        }

        container.querySelector("[data-share]")?.addEventListener("click", async () => {
            const url = `${location.origin}/#/jugador/${encodeURIComponent(shareId)}`;
            try {
                if (navigator.share) {
                    await navigator.share({ title: `${player.alias} · Radikal Players`, url });
                } else {
                    await navigator.clipboard.writeText(url);
                    toast("Enlace de la ficha copiado");
                }
            } catch {
                // El usuario canceló el diálogo de compartir.
            }
        });
    }

    function bestForGame(ranks, game) {
        return ranks
            .filter((rank) => rank.game === game && rank.value)
            .sort((left, right) => {
                const scopeLeft = left.scopeCode === "0" ? 0 : 1;
                const scopeRight = right.scopeCode === "0" ? 0 : 1;
                if (scopeLeft !== scopeRight) return scopeLeft - scopeRight;
                return left.rank - right.rank;
            })[0] || null;
    }
}

function heroStat(rank, gameStats, rating) {
    if (rating?.value) {
        return {
            value: rating.value,
            detail: `Rating actual${rating.suffix ? ` · ${rating.suffix}` : ""}`
        };
    }

    if (rank) {
        return {
            value: rank.value || "—",
            detail: `${rankText(rank)} · ${scopeLabel(rank.scopeCode)}`
        };
    }

    if (gameStats) {
        return {
            value: gameStats.average || "—",
            detail: `Media ${gameStats.game} · ${gameStats.games} partidas`
        };
    }

    return { value: "—", detail: "Sin datos" };
}

function splitRating(value) {
    if (!value) return { value: "", suffix: "" };
    const match = String(value).match(/^([0-9.,]+)\s*(.*)$/);
    return match
        ? { value: match[1], suffix: match[2].replace(/[()]/g, "").trim() }
        : { value: String(value), suffix: "" };
}

function statValue(game, label) {
    return game?.stats?.find((item) => item.label === label)?.value ?? null;
}

function mostCommonDiana(ranks) {
    const counts = new Map();
    for (const rank of ranks || []) {
        if (!rank.diana) continue;
        counts.set(rank.diana, (counts.get(rank.diana) || 0) + 1);
    }
    return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || null;
}

function groupRanks(ranks) {
    const map = new Map();
    for (const rank of ranks) {
        const key = `${rank.game}:${rank.diana}`;
        if (!map.has(key)) {
            map.set(key, {
                game: rank.game,
                diana: rank.diana,
                countryRank: 0,
                globalRank: 0,
                value: rank.value || "",
                self: false
            });
        }

        const row = map.get(key);
        if (rank.scopeCode === "0") row.globalRank = rank.rank;
        else if (rank.scopeCode === "self") row.self = true;
        else row.countryRank = rank.rank;

        if (rank.value) row.value = rank.value;
    }
    return [...map.values()];
}

function rankText(rank) {
    if (!rank || rank.rank <= 0) return rank?.value || "Sin puesto";
    return `#${rank.rank} ${rank.game}`;
}

function scopeLabel(scopeCode) {
    if (!scopeCode) return "—";
    if (scopeCode === "0") return "Global";
    if (scopeCode === "self") return "Actual";
    return countryName(scopeCode) || scopeCode;
}

function shortType(type) {
    switch ((type || "").toUpperCase()) {
        case "PLATINUM": return "PLATINUM";
        case "GOLDEN": return "GOLDEN";
        case "SILVER": return "SILVER";
        default: return "PLAYER";
    }
}

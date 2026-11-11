import { api } from "../api.js?v=77";
import {
    esc, icon, formatNumber, formatRelative, emptyState, downloadCsv, openModal, avatarHtml, officialBadge
} from "../ui.js?v=77";
import { playerModalContent, cleanRanking, countryFlagHtml } from "../components.js?v=77";
import { countryName, getCountry, setCountry, subscribeCountry } from "../preferences.js?v=77";
import { getCurrentPlayer } from "../auth.js?v=80";

const DIANAS = [
    { code: "aa", label: "Ancho" },
    { code: "ae", label: "Estrecho" },
    { code: "bb", label: "Bristle" }
];

const GENDERS = [
    { code: "0", label: "Todos" },
    { code: "M", label: "Hombres" },
    { code: "F", label: "Mujeres" }
];

export async function render(container) {
    const state = {
        country: getCountry(),
        province: "",
        game: "MPR",
        diana: "aa",
        gender: "0",
        query: "",
        view: "local"
    };

    let players = [];
    let global = null;
    let fetchedAt = null;
    let rawPlayerCount = 0;
    let controller = null;
    let unsubscribe = null;

    container.innerHTML = shell();
    bindShell();
    syncCountryLabel();

    if (state.view === "global") await loadGlobal();
    else await loadRanking();

    function shell() {
        return `
            <div class="page container rank-page">
                <div class="section-head rank-head">
                    <div class="section-head-left">
                        <span class="kicker">${icon("trophy")} Ranking oficial</span>
                        <h1 class="section-title">Ranking <span class="accent">Radikal</span></h1>
                        <p class="section-sub">PPD y MPR oficiales por país, tipo de diana y género.</p>
                    </div>
                    <button class="btn btn-outline btn-sm" id="export-ranking">${icon("download")} Exportar CSV</button>
                </div>

                <section class="rank-overview" id="rank-overview">
                    <div class="rank-overview-head">
                        <span class="rank-country-flag" id="rk-current-flag" aria-hidden="true"></span>
                        <div class="rank-country-copy">
                            <small id="rk-current-label">Ranking de</small>
                            <strong id="rk-current-name">España</strong>
                        </div>
                        <button class="rank-country-change" id="rk-change-country" type="button">
                            ${icon("earth")} Cambiar país
                        </button>
                    </div>
                    <div class="rank-kpis" id="rk-kpis">
                        <div><strong>—</strong><span>Jugadores</span></div>
                        <div><strong>—</strong><span>Líder</span></div>
                        <div><strong>—</strong><span>Media top 10</span></div>
                        <div><strong>—</strong><span>Actualizado</span></div>
                    </div>
                </section>

                <div class="rank-toolbar">
                    <div class="rank-views" role="tablist" aria-label="Tipo de ranking">
                        <button class="rank-view ${state.view === "local" ? "is-active" : ""}" data-view="local" role="tab" type="button">
                            ${icon("pin")} Mi país
                        </button>
                        <button class="rank-view ${state.view === "global" ? "is-active" : ""}" data-view="global" role="tab" type="button">
                            ${icon("earth")} Global
                        </button>
                    </div>

                    <div class="filter-bar rank-filter-bar" id="rank-filters">
                        <div class="filter-group">
                            <span class="filter-label">Juego</span>
                            <div class="segmented" id="rk-game">
                                <button data-value="MPR" class="active" type="button">MPR</button>
                                <button data-value="PPD" type="button">PPD</button>
                            </div>
                        </div>
                        <div class="filter-group">
                            <span class="filter-label">Diana</span>
                            <div class="segmented" id="rk-diana">
                                ${DIANAS.map((d) => `<button data-value="${d.code}" class="${d.code === "aa" ? "active" : ""}" type="button">${d.label}</button>`).join("")}
                            </div>
                        </div>
                        <div class="filter-group">
                            <span class="filter-label">Género</span>
                            <div class="segmented" id="rk-gender">
                                ${GENDERS.map((g) => `<button data-value="${g.code}" class="${g.code === "0" ? "active" : ""}" type="button">${g.label}</button>`).join("")}
                            </div>
                        </div>
                        <div class="search-field rank-search">
                            ${icon("search")}
                            <input class="form-control" id="rk-search" type="search" placeholder="Buscar alias, nombre o ID" autocomplete="off" />
                        </div>
                    </div>
                </div>

                <div id="ranking-results">
                    <div class="rank-skeleton-top">
                        <div class="skeleton skeleton-line"></div>
                        <div class="skeleton skeleton-line"></div>
                        <div class="skeleton skeleton-line"></div>
                    </div>
                    <div class="skeleton skeleton-card" style="height:360px"></div>
                </div>
            </div>
        `;
    }

    function bindShell() {
        container.querySelector("#export-ranking")?.addEventListener("click", exportCsv);
        container.querySelector("#rk-change-country")?.addEventListener("click", () => {
            document.querySelector("[data-country-toggle]")?.click();
        });

        bindSegmented("rk-game", "game");
        bindSegmented("rk-diana", "diana");
        bindSegmented("rk-gender", "gender");

        container.querySelector("#rk-search")?.addEventListener("input", (event) => {
            state.query = event.target.value.trim();
            if (state.view === "global") drawGlobal();
            else drawResults();
        });

        container.querySelectorAll("[data-view]").forEach((button) => {
            button.addEventListener("click", () => switchView(button.dataset.view));
        });
    }

    function switchView(view) {
        state.view = view;
        container.querySelectorAll("[data-view]").forEach((button) => {
            button.classList.toggle("is-active", button.dataset.view === view);
        });
        const change = container.querySelector("#rk-change-country");
        if (change) change.hidden = view !== "local";
        if (view === "global") {
            setOverviewGlobal();
            loadGlobal();
        } else {
            syncCountryLabel();
            loadRanking();
        }
    }

    function bindSegmented(id, key) {
        const group = container.querySelector(`#${id}`);
        group?.querySelectorAll("button").forEach((button) => {
            button.addEventListener("click", () => {
                group.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
                button.classList.add("active");
                state[key] = button.dataset.value;
                reload();
            });
        });
    }

    function reload() {
        if (state.view === "global") loadGlobal();
        else loadRanking();
    }

    /** Muestra el país activo en la cabecera del ranking. */
    function syncCountryLabel() {
        const label = container.querySelector("#rk-current-label");
        const name = container.querySelector("#rk-current-name");
        const flag = container.querySelector("#rk-current-flag");
        const change = container.querySelector("#rk-change-country");
        if (label) label.textContent = "Ranking de";
        if (name) name.textContent = countryName(state.country);
        if (flag) flag.innerHTML = countryFlagHtml(state.country);
        if (change) change.hidden = state.view !== "local";
    }

    function setOverviewGlobal() {
        const label = container.querySelector("#rk-current-label");
        const name = container.querySelector("#rk-current-name");
        const flag = container.querySelector("#rk-current-flag");
        const change = container.querySelector("#rk-change-country");
        if (label) label.textContent = "Ranking";
        if (name) name.textContent = "Global";
        if (flag) flag.innerHTML = `<span class="rank-global-icon">${icon("earth")}</span>`;
        if (change) change.hidden = true;
    }

    function setKpis(items) {
        const kpis = container.querySelector("#rk-kpis");
        if (!kpis) return;
        kpis.innerHTML = items.map((item) => `
            <div>
                <strong>${item.value}</strong>
                <span>${item.label}</span>
            </div>
        `).join("");
    }

    function resetKpis() {
        setKpis([
            { value: "—", label: "Jugadores" },
            { value: "—", label: "Líder" },
            { value: "—", label: "Media top 10" },
            { value: "—", label: "Actualizado" }
        ]);
    }

    function averageTop(list) {
        const values = list.slice(0, 10)
            .map((player) => Number.parseFloat(String(player.value).replace(",", ".")))
            .filter((value) => Number.isFinite(value));
        if (!values.length) return "—";
        return (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2);
    }

    function matchesQuery(player, query) {
        return `${player.alias} ${player.firstName} ${player.lastName} ${player.location} ${player.userId}`
            .toLowerCase()
            .includes(query);
    }

    /** Sigue el selector de país de la cabecera. */
    unsubscribe = subscribeCountry((code) => {
        if (code === state.country) return;
        state.country = code;
        if (state.view === "local") {
            syncCountryLabel();
            loadRanking();
        }
    });

    /* ---------- Ranking global y comparativa por países ---------- */

    async function loadGlobal() {
        controller?.abort();
        controller = new AbortController();
        const results = container.querySelector("#ranking-results");
        if (results) {
            results.innerHTML = `
                <div class="rank-skeleton-top">
                    <div class="skeleton skeleton-line"></div>
                    <div class="skeleton skeleton-line"></div>
                    <div class="skeleton skeleton-line"></div>
                </div>
                <div class="skeleton skeleton-card" style="height:340px"></div>
            `;
        }
        resetKpis();

        try {
            global = await api.globalRankings({
                game: state.game,
                diana: state.diana,
                gender: state.gender
            }, controller.signal);
            drawGlobal();
        } catch (error) {
            if (error.name === "AbortError") return;
            showError(error);
        }
    }

    function drawGlobal() {
        const results = container.querySelector("#ranking-results");
        if (!results || !global) return;

        const baseTop = cleanRanking(global.top || []);
        const countries = global.countries || [];
        const query = state.query.toLowerCase();
        const top = query ? baseTop.filter((player) => matchesQuery(player, query)) : baseTop;
        const filteredCountries = query
            ? countries.filter((country) => `${countryName(country.countryCode)} ${country.topAlias || ""}`.toLowerCase().includes(query))
            : countries;

        setOverviewGlobal();
        setKpis([
            { value: formatNumber(top.length), label: "Top global" },
            { value: formatNumber(countries.length), label: "Países" },
            { value: baseTop[0] ? esc(baseTop[0].alias) : "—", label: baseTop[0] ? `Líder · ${esc(baseTop[0].value)} ${esc(global.game)}` : "Líder" },
            { value: esc(formatRelative(global.fetchedAt)), label: "Actualizado" }
        ]);

        results.innerHTML = `
            ${top.length ? `
                <div class="rank-top">
                    ${top.slice(0, 3).map((player, index) => rankTopCard(player, index + 1)).join("")}
                </div>
                ${youCard(top)}
                ${top.length > 3 ? `
                    <div class="rank-list-head">
                        <span>Pos.</span>
                        <span></span>
                        <span>Jugador</span>
                        <span>Localidad</span>
                        <span>${esc(global.game)}</span>
                    </div>
                    <ul class="rank-list">
                        ${top.slice(3).map(rankRow).join("")}
                    </ul>
                ` : ""}
            ` : emptyState(
                state.query ? "Sin coincidencias" : "Sin jugadores",
                state.query
                    ? `Ningún jugador del top global coincide con “${state.query}”.`
                    : "Prueba con otro juego o tipo de diana.",
                "users"
            )}

            <section class="section rank-countries">
                <div class="section-head">
                    <div class="section-head-left">
                        <span class="kicker">${icon("earth")} Comparativa</span>
                        <h2 class="section-title">Por país</h2>
                        <p class="section-sub">Mejor marca y media de cada país con actividad en este filtro.</p>
                    </div>
                    <span class="rank-section-count">${filteredCountries.length} países</span>
                </div>
                <div class="country-compare">
                    ${filteredCountries.map((country, index) => countryRow(country, index, filteredCountries)).join("") || emptyState("Sin países", "No hay países que coincidan con la búsqueda.", "globe")}
                </div>
            </section>
        `;

        bindResults(results);
        results.querySelectorAll("[data-country-jump]").forEach((button) => {
            button.addEventListener("click", async () => {
                state.country = setCountry(button.dataset.countryJump);
                state.view = "local";
                container.querySelectorAll("[data-view]").forEach((tab) => {
                    tab.classList.toggle("is-active", tab.dataset.view === "local");
                });
                syncCountryLabel();
                await loadRanking();
            });
        });
    }

    function countryRow(country, index, all) {
        const max = Math.max(...all.map((item) => item.best || 0), 0.0001);
        const width = Math.max(4, Math.round(((country.best || 0) / max) * 100));
        return `
            <button class="country-compare-row" type="button" data-country-jump="${esc(country.countryCode)}">
                <span class="country-compare-pos">${index + 1}</span>
                <span class="country-compare-flag">${countryFlagHtml(country.countryCode)}</span>
                <span class="country-compare-name">
                    <strong>${esc(country.countryName)}</strong>
                    <small>${country.players} jugadores · top ${esc(country.topAlias || "—")}</small>
                </span>
                <span class="country-compare-bar"><i style="width:${width}%"></i></span>
                <span class="country-compare-values">
                    <strong>${country.best}</strong>
                    <small>media ${country.average}</small>
                </span>
            </button>
        `;
    }

    /* ---------- Ranking local ---------- */

    async function loadRanking() {
        controller?.abort();
        controller = new AbortController();
        const results = container.querySelector("#ranking-results");
        if (results) {
            results.innerHTML = `
                <div class="rank-skeleton-top">
                    <div class="skeleton skeleton-line"></div>
                    <div class="skeleton skeleton-line"></div>
                    <div class="skeleton skeleton-line"></div>
                </div>
                <div class="skeleton skeleton-card" style="height:360px"></div>
            `;
        }
        resetKpis();

        try {
            const response = await api.rankings({
                country: state.country,
                province: state.province,
                game: state.game,
                diana: state.diana,
                gender: state.gender
            }, controller.signal);

            rawPlayerCount = (response.players || []).length;
            players = cleanRanking(response.players || []);
            fetchedAt = response.fetchedAt;
            drawResults();
        } catch (error) {
            if (error.name === "AbortError") return;
            showError(error);
        }
    }

    function filteredPlayers() {
        if (!state.query) return players;
        const query = state.query.toLowerCase();
        return players.filter((player) => matchesQuery(player, query));
    }

    function drawResults() {
        const results = container.querySelector("#ranking-results");
        if (!results) return;

        const list = filteredPlayers();
        const top3 = list.slice(0, 3);
        const rest = list.slice(3);
        const game = state.game;
        const excluded = Math.max(0, rawPlayerCount - players.length);

        syncCountryLabel();
        setKpis([
            { value: formatNumber(list.length), label: "Jugadores" },
            { value: list[0] ? esc(list[0].alias) : "—", label: list[0] ? `Líder · ${esc(list[0].value)} ${esc(game)}` : "Líder" },
            { value: averageTop(list), label: "Media top 10" },
            { value: esc(formatRelative(fetchedAt)), label: "Actualizado" }
        ]);

        if (!list.length) {
            results.innerHTML = `
                ${emptyState(
                    "Sin jugadores",
                    state.query
                        ? `Ningún jugador de este top coincide con “${state.query}”. Puedes buscarlo en toda la comunidad.`
                        : "No hay resultados para estos filtros. Prueba con otro juego o tipo de diana.",
                    "users"
                )}
                ${state.query ? `
                    <div class="rank-empty-action">
                        <button class="btn btn-primary btn-sm" type="button" data-global-search="${esc(state.query)}">
                            ${icon("search")} Buscar “${esc(state.query)}” en toda la comunidad
                        </button>
                    </div>
                ` : ""}
            `;
            results.querySelector("[data-global-search]")?.addEventListener("click", (event) => {
                window.openSearchWithQuery?.(event.currentTarget.dataset.globalSearch);
            });
            return;
        }

        results.innerHTML = `
            <div class="rank-top">
                ${top3.map((player, index) => rankTopCard(player, index + 1)).join("")}
            </div>

            ${youCard(list)}

            ${rest.length ? `
                <div class="rank-list-head">
                    <span>Pos.</span>
                    <span></span>
                    <span>Jugador</span>
                    <span>Localidad</span>
                    <span>${esc(game)}</span>
                </div>
                <ul class="rank-list">
                    ${rest.map(rankRow).join("")}
                </ul>
            ` : ""}

            <p class="rank-footnote">
                ${icon("info")} Radikal devuelve el top 50 por país. Las cuentas de prueba y los perfiles sin alias se ocultan del listado.
                ${excluded ? ` ${excluded} ${excluded === 1 ? "perfil excluido" : "perfiles excluidos"} en este filtro.` : ""}
            </p>
        `;

        bindResults(results);
    }

    function rankTopCard(player, place) {
        return `
            <button class="rank-top-card rt-${place}" type="button" data-rank-user="${esc(player.userId)}">
                <span class="rt-medal">${place === 1 ? icon("crown") : `#${place}`}</span>
                <span class="rt-avatar">${avatarHtml(player.alias, player.photoUrl)}</span>
                <strong class="rt-alias">${esc(player.alias)}</strong>
                <span class="rt-value">${esc(player.value)}<small>${esc(player.game || state.game)}</small></span>
                <span class="rt-meta">
                    ${countryFlagHtml(player.countryCode)}
                    <span>${esc(player.location || countryName(player.countryCode))}</span>
                </span>
            </button>
        `;
    }

    function rankRow(player) {
        const badges = [];
        if (player.premium) badges.push(`<span class="badge badge-member">Member</span>`);
        if (player.officialPlayerType && player.officialPlayerType !== "NONE") {
            badges.push(officialBadge(player.officialPlayerType));
        }

        const movement = player.originalRank && player.originalRank !== player.rank
            ? `<span class="rank-move" title="Posición original en Radikal">${player.originalRank}</span>`
            : "";
        const rankClass = player.rank <= 3 ? "is-top" : player.rank <= 10 ? "is-elite" : "";
        const fullName = [player.firstName, player.lastName].filter(Boolean).join(" ") || "-";

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
                        <span class="rank-row-real">${esc(fullName)}</span>
                        <span class="rank-row-loc-inline">${icon("pin")} ${esc(player.location || "-")}</span>
                        ${badges.length ? `<span class="player-tags">${badges.join("")}</span>` : ""}
                    </span>
                </span>
                <span class="rank-row-loc">
                    ${icon("pin")} ${esc(player.location || "-")}
                </span>
                <span class="rank-row-score">
                    ${esc(player.value)}
                    <small>${esc(player.game || state.game)}</small>
                </span>
            </li>
        `;
    }

    function youCard(list) {
        const me = getCurrentPlayer();
        if (!me?.alias || state.query) return "";
        const found = list.find((player) => (player.alias || "").toLowerCase() === me.alias.toLowerCase());

        if (found) {
            return `
                <button class="rank-you is-found" type="button" data-rank-you="${esc(found.userId)}">
                    <span class="rank-you-icon">${icon("target")}</span>
                    <span class="rank-you-copy">
                        <small>Tu posición con estos filtros</small>
                        <strong>#${found.rank} · ${esc(found.alias)}</strong>
                    </span>
                    <span class="rank-you-value">${esc(found.value)}<small>${esc(found.game || state.game)}</small></span>
                </button>
            `;
        }

        return `
            <button class="rank-you" type="button" data-rank-you-search>
                <span class="rank-you-icon">${icon("search")}</span>
                <span class="rank-you-copy">
                    <small>¿Dónde estás?</small>
                    <strong>Busca “${esc(me.alias)}” en este ranking</strong>
                </span>
                ${icon("chevronRight")}
            </button>
        `;
    }

    function bindResults(results) {
        const openByUser = (userId) => {
            const all = [...players, ...(global?.top ? cleanRanking(global.top) : [])];
            const player = all.find((p) => p.userId === userId);
            if (player) openPlayer(player);
        };

        results.querySelectorAll("[data-user-id]").forEach((row) => {
            row.addEventListener("click", () => openByUser(row.dataset.userId));
            row.addEventListener("keydown", (event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openByUser(row.dataset.userId);
                }
            });
        });

        results.querySelectorAll("[data-rank-user]").forEach((card) => {
            card.addEventListener("click", () => openByUser(card.dataset.rankUser));
        });

        results.querySelector("[data-rank-you]")?.addEventListener("click", (event) => {
            openByUser(event.currentTarget.dataset.rankYou);
        });

        results.querySelector("[data-rank-you-search]")?.addEventListener("click", () => {
            const me = getCurrentPlayer();
            if (!me?.alias) return;
            const input = container.querySelector("#rk-search");
            if (input) input.value = me.alias;
            state.query = me.alias;
            if (state.view === "global") drawGlobal();
            else drawResults();
        });
    }

    function openPlayer(player) {
        openModal({
            title: player.alias,
            subtitle: "Ficha de jugador · Radikal Ranking",
            content: playerModalContent(player)
        });
    }

    function exportCsv() {
        const query = state.query.toLowerCase();
        const list = state.view === "global"
            ? (global?.top ? cleanRanking(global.top).filter((player) => !query || matchesQuery(player, query)) : [])
            : filteredPlayers();
        if (!list.length) return;
        const rows = [
            ["Rank", "Alias", "Nombre", "Apellidos", "Localidad", "Pais", "Juego", "Valor", "Member", "Official"],
            ...list.map((p) => [
                p.rank,
                p.alias,
                p.firstName,
                p.lastName,
                p.location,
                p.countryCode,
                p.game,
                p.value,
                p.premium ? "SI" : "NO",
                p.officialPlayerType
            ])
        ];
        downloadCsv(`radikal-ranking-${state.game}-${state.country}.csv`, rows);
    }

    function showError(error) {
        const results = container.querySelector("#ranking-results");
        resetKpis();
        if (results) {
            results.innerHTML = `
                <div class="error-box">
                    <strong>No se pudo cargar el ranking.</strong>
                    <p style="margin:6px 0 14px">${esc(error.message)}</p>
                    <button class="btn btn-outline btn-sm" id="rk-retry">Reintentar</button>
                </div>
            `;
            results.querySelector("#rk-retry")?.addEventListener("click", reload);
        }
    }

    return () => {
        controller?.abort();
        unsubscribe?.();
    };
}

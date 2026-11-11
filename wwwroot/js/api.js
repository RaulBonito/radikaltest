const BASE = "/api";

export class ApiError extends Error {
    constructor(message, status, details) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.details = details;
    }
}

async function request(path, { params, signal } = {}) {
    const url = new URL(`${BASE}${path}`, window.location.origin);
    if (params) {
        for (const [key, value] of Object.entries(params)) {
            if (value === undefined || value === null || value === "") continue;
            url.searchParams.set(key, String(value));
        }
    }

    const response = await fetch(url, {
        signal,
        cache: "no-store",
        headers: { Accept: "application/json" }
    });

    if (!response.ok) {
        let message = `Error ${response.status}`;
        let details = null;
        try {
            details = await response.json();
            message = details.title || details.detail || message;
        } catch {
            // respuesta no JSON
        }
        throw new ApiError(message, response.status, details);
    }

    return response.json();
}

async function sendJson(method, path, body, { signal } = {}) {
    const response = await fetch(`${BASE}${path}`, {
        method,
        signal,
        cache: "no-store",
        headers: {
            Accept: "application/json",
            ...(body === undefined ? {} : { "Content-Type": "application/json" })
        },
        body: body === undefined ? undefined : JSON.stringify(body)
    });

    if (!response.ok) {
        let message = `Error ${response.status}`;
        let details = null;
        try {
            details = await response.json();
            message = details.detail || details.title || message;
        } catch {
            // respuesta no JSON
        }
        throw new ApiError(message, response.status, details);
    }

    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
}

async function sendForm(path, formData, { signal } = {}) {
    const response = await fetch(`${BASE}${path}`, {
        method: "POST",
        signal,
        cache: "no-store",
        body: formData
    });

    if (!response.ok) {
        let message = `Error ${response.status}`;
        let details = null;
        try {
            details = await response.json();
            message = details.detail || details.title || message;
        } catch {
            // respuesta no JSON
        }
        throw new ApiError(message, response.status, details);
    }

    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
}

function postJson(path, body, options) {
    return sendJson("POST", path, body ?? {}, options);
}

function patchJson(path, body, options) {
    return sendJson("PATCH", path, body ?? {}, options);
}

function deleteJson(path, options) {
    return sendJson("DELETE", path, undefined, options);
}

export const api = {
    meta: (signal) => request("/meta", { signal }),

    authMe: (refresh, signal) => request("/auth/me", { params: { refresh }, signal }),

    authLogin: (dni, clave, signal) => postJson("/auth/login", { dni, clave }, { signal }),

    authDemo: (signal) => postJson("/auth/demo", {}, { signal }),

    authLogout: (signal) => postJson("/auth/logout", {}, { signal }),

    playerArea: (refresh, signal) => request("/player/area", { params: { refresh }, signal }),

    playerCities: (country, province, signal) =>
        request("/player/cities", { params: { country, province }, signal }),

    playerProfile: (data, signal) => postJson("/player/profile", data, { signal }),

    playerAlias: (alias, signal) => postJson("/player/alias", { alias }, { signal }),

    playerPhoto: (file, signal) => {
        const form = new FormData();
        form.append("file", file);
        return sendForm("/player/photo", form, { signal });
    },

    playerPassword: (data, signal) => postJson("/player/password", data, { signal }),

    playerStats: (competitionId, signal) =>
        request("/player/stats", { params: { competitionId }, signal }),

    playerItems: (signal) => request("/player/items", { signal }),

    playerShareRatings: (signal) => request("/player/share-ratings", { signal }),

    playerSetShareRatings: (share, signal) =>
        postJson("/player/share-ratings", { share }, { signal }),

    playerItemToggle: (itemId, signal) =>
        postJson(`/player/items/${encodeURIComponent(itemId)}/toggle`, {}, { signal }),

    home: (signal) => request("/home", { signal }),

    rankings: (params, signal) => request("/rankings", { params, signal }),

    globalRankings: (params, signal) => request("/rankings/global", { params, signal }),

    provinces: (country, signal) => request("/geo/provinces", { params: { country }, signal }),

    localities: (country, province, signal) =>
        request("/geo/localities", { params: { country, province }, signal }),

    locales: (locality, signal) =>
        request("/geo/locales", { params: { locality }, signal }),

    competitions: (params, signal) => request("/competitions", { params, signal }),

    competition: (id, type, signal) =>
        request(`/competitions/${id}`, { params: { type }, signal }),

    competitionSearch: (q, signal) =>
        request("/competitions/search", { params: { q }, signal }),

    live: (signal) => request("/live", { signal }),

    liveMatches: (signal) => request("/live/matches", { signal }),

    liveDarts: (compid, encid, ngame, signal) =>
        request("/live/darts", { params: { compid, encid, ngame }, signal }),

    liveRecordings: (signal) => request("/live/recordings", { signal }),

    liveRecording: (competitionId, matchId, game, signal) =>
        request(`/live/recordings/${competitionId}/${matchId}/${game}`, { signal }),

    recordingSync: (compid, encid, ngame, signal) =>
        postJson(`/live/recordings/${compid}/${encid}/${ngame}/sync`, {}, { signal }),

    recordingDelete: (compid, encid, ngame, signal) =>
        deleteJson(`/live/recordings/${compid}/${encid}/${ngame}`, { signal }),

    chatMessages: (room, after, signal) =>
        request(`/chat/${encodeURIComponent(room)}`, { params: { after }, signal }),

    chatSend: (room, text, signal) =>
        postJson(`/chat/${encodeURIComponent(room)}`, { text }, { signal }),

    tournamentSearch: (q, signal) =>
        request("/tournaments/search", { params: { q }, signal }),

    tournament: (id, signal) => request(`/tournaments/${id}`, { signal }),

    acta: (id, cellId, signal) =>
        request(`/tournaments/${id}/matches/${cellId}`, { signal }),

    dianas: (signal) => request("/dianas", { signal }),

    diana: (id, signal) => request(`/dianas/${id}`, { signal }),

    places: (signal) => request("/places", { signal }),

    news: (params, signal) => request("/news", { params, signal }),

    newsDetail: (id, signal) => request(`/news/${id}`, { signal }),

    shop: (signal) => request("/shop", { signal }),

    shopProduct: (id, category, signal) =>
        request(`/shop/products/${id}`, { params: { category }, signal }),

    shopCart: (refresh, signal) => request("/shop/cart", { params: { refresh }, signal }),

    shopCartAdd: (productId, quantity = 1, signal) =>
        postJson("/shop/cart/items", { productId, quantity }, { signal }),

    shopCartQuantity: (lineId, quantity, signal) =>
        patchJson(`/shop/cart/items/${lineId}`, { quantity }, { signal }),

    shopCartRemove: (lineId, signal) => deleteJson(`/shop/cart/items/${lineId}`, { signal }),

    shopCartClear: (signal) => postJson("/shop/cart/clear", {}, { signal }),

    officialPlayers: (signal) => request("/official-players", { signal }),

    officialPlayer: (id, signal) => request(`/official-players/${id}`, { signal }),

    playerSearch: (q, signal) => request("/players/search", { params: { q }, signal }),

    playerLookup: (radikalId, signal) => request("/players/lookup", { params: { radikalId }, signal }),

    player: (userId, signal) => request(`/players/${encodeURIComponent(userId)}`, { signal }),

    search: (q, signal) => request("/search", { params: { q }, signal })
};

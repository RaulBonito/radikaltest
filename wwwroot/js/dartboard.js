/**
 * Diana compartida: geometría real (proporciones oficiales de una diana de torneo),
 * pintado de impactos y utilidades para leer un dardo de Radikal.
 *
 * Radikal solo informa de la zona golpeada (sector + multiplicador), no de la coordenada
 * exacta. Para que el mapa muestre CADA dardo de forma legible lo colocamos dentro de su
 * zona real: los triples en el anillo triple, los dobles en el anillo doble y los simples
 * en el anillo que les corresponde. Si algún día Radikal expone coordenadas, basta con
 * rellenar `x`/`y` en el dardo y se usará el impacto tal cual.
 */

export const SECTORS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

// Radios normalizados (15.9 = radio del alambre exterior del bull doble).
export const BOARD = {
    outerBull: 15.9,
    innerTriple: 99,
    outerTriple: 107,
    innerDouble: 162,
    outerDouble: 170,
    numberRing: 198,
    view: 226
};

// Mitad del anillo doble (entre los dos alambres del doble).
BOARD.midDouble = (BOARD.innerDouble + BOARD.outerDouble) / 2;

export const PLAYER_COLORS = [
    "#e11d74", "#0a7ea4", "#f59e0b", "#7c3aed", "#0f9d58", "#2563eb",
    "#b45309", "#0891b2", "#be123c", "#4d7c0f"
];

export const KIND_LABELS = {
    triple: "Triple",
    double: "Doble",
    single: "Simple",
    dbull: "Bull doble",
    sbull: "Bull simple",
    miss: "Fuera"
};

export function playerColor(index) {
    const value = Number(index) || 0;
    return PLAYER_COLORS[((value % PLAYER_COLORS.length) + PLAYER_COLORS.length) % PLAYER_COLORS.length];
}

export function normalizeDart(dart) {
    return {
        ...dart,
        sector: Number(dart?.sector) || 0,
        multiplier: Number(dart?.multiplier) || 0,
        score: Number(dart?.score) || 0,
        round: Number(dart?.round) || 0,
        playerIndex: Number(dart?.playerIndex) || 0,
        dart: Number(dart?.dart) || 0,
        hitRegion: String(dart?.hitRegion || "")
    };
}

export function hitKind(dart) {
    const region = String(dart?.hitRegion || "").toUpperCase();
    const sector = Number(dart?.sector);
    const multiplier = Number(dart?.multiplier) || 0;

    if (region.includes("MISS") || region.includes("BUST") || sector >= 50 || sector < 0) return "miss";
    if (sector === 0 || sector === 25 || region.includes("BULL")) return multiplier >= 2 ? "dbull" : "sbull";
    if (multiplier === 3) return "triple";
    if (multiplier === 2) return "double";
    return "single";
}

export function hitLabel(dart) {
    const kind = hitKind(dart);
    if (kind === "miss") return "MISS";
    if (kind === "triple") return `T${dart.sector}`;
    if (kind === "double") return `D${dart.sector}`;
    if (kind === "single") return `S${dart.sector}`;
    return kind === "dbull" ? "DBULL" : "SBULL";
}

export function polar(radius, angleDegrees) {
    const radians = (angleDegrees * Math.PI) / 180;
    return { x: Math.cos(radians) * radius, y: Math.sin(radians) * radius };
}

function wedgePath(innerRadius, outerRadius, startAngle, endAngle) {
    const innerStart = polar(innerRadius, startAngle);
    const outerStart = polar(outerRadius, startAngle);
    const outerEnd = polar(outerRadius, endAngle);
    const innerEnd = polar(innerRadius, endAngle);

    if (innerRadius === 0) {
        return `M 0 0 L ${outerStart.x} ${outerStart.y} A ${outerRadius} ${outerRadius} 0 0 1 ${outerEnd.x} ${outerEnd.y} Z`;
    }

    return `M ${innerStart.x} ${innerStart.y} L ${outerStart.x} ${outerStart.y} A ${outerRadius} ${outerRadius} 0 0 1 ${outerEnd.x} ${outerEnd.y} L ${innerEnd.x} ${innerEnd.y} A ${innerRadius} ${innerRadius} 0 0 0 ${innerStart.x} ${innerStart.y} Z`;
}

/**
 * Posición de un dardo en la diana. `slot` desambigua coincidencias dentro de la misma
 * zona (0 = primera vez que cae ahí, 1 = segunda, ...) para que nunca se pisen.
 */
export function dartPlacement(dart, slot = 0) {
    const kind = hitKind(dart);

    if (kind === "miss") {
        return { miss: true, kind, x: 0, y: -BOARD.view + 12 };
    }

    if (kind === "dbull" || kind === "sbull") {
        const ring = kind === "dbull" ? BOARD.outerBull * 0.5 : (BOARD.outerBull * 0.5 + BOARD.outerBull) / 2;
        const angle = (-90 + slot * 60) * Math.PI / 180;
        return { miss: false, kind, x: Math.cos(angle) * ring, y: Math.sin(angle) * ring };
    }

    const sectorIndex = SECTORS.indexOf(Number(dart?.sector));
    const angle = -90 + (sectorIndex < 0 ? 0 : sectorIndex) * 18;
    const normal = polar(1, angle + 90);

    let radius;
    if (kind === "triple") {
        radius = (BOARD.innerTriple + BOARD.outerTriple) / 2;
    } else if (kind === "double") {
        radius = BOARD.midDouble;
    } else {
        // Simples: alterna entre el anillo interior y el exterior, y separa en tangencial.
        radius = slot < 3
            ? (BOARD.outerBull + BOARD.innerTriple) / 2
            : (BOARD.outerTriple + BOARD.innerDouble) / 2;
    }

    // Separa los dardos repetidos de una misma zona para poder contarlos y pulsarlos.
    const offsets = [0, -5, 5, -2.5, 2.5, -7.5, 7.5];
    const offset = (kind === "single" && slot < 3 ? 0 : offsets[slot % offsets.length]);

    const point = polar(radius, angle);
    return {
        miss: false,
        kind,
        x: point.x + normal.x * offset,
        y: point.y + normal.y * offset
    };
}

export function boardSvg(marks = [], options = {}) {
    const {
        showNumbers = true,
        showMissed = true,
        label = "Diana con los impactos registrados",
        trackable = false,
        pulse = false
    } = options;

    const wedges = SECTORS.map((sector, index) => {
        const start = -90 + index * 18 - 9;
        const color = index % 2 === 0 ? "#14283a" : "#f4ead8";
        return `<path d="${wedgePath(0, BOARD.outerDouble, start, start + 18)}" fill="${color}"/>`;
    }).join("");

    const ring = (innerRadius, outerRadius, field) => SECTORS.map((sector, index) => {
        const start = -90 + index * 18 - 9;
        const color = field === "triple" ? "#1e8a5b" : index % 2 === 0 ? "#c9333c" : "#a8272f";
        return `<path d="${wedgePath(innerRadius, outerRadius, start, start + 18)}" fill="${color}"/>`;
    }).join("");

    const wires = SECTORS.map((sector, index) => {
        const angle = -90 + index * 18 - 9;
        const outer = polar(BOARD.outerDouble, angle);
        const inner = polar(BOARD.outerBull, angle);
        return `<line x1="${inner.x.toFixed(2)}" y1="${inner.y.toFixed(2)}" x2="${outer.x.toFixed(2)}" y2="${outer.y.toFixed(2)}" stroke="#0a1b29" stroke-width="0.55" opacity="0.55"/>`;
    }).join("");

    const numbers = showNumbers
        ? SECTORS.map((sector, index) => {
            const point = polar(BOARD.numberRing, -90 + index * 18);
            return `<text x="${point.x.toFixed(2)}" y="${(point.y + 4.6).toFixed(2)}" text-anchor="middle" font-size="13" font-weight="800" fill="#8b9bad" font-family="inherit">${sector}</text>`;
        }).join("")
        : "";

    // Heatmap: cada dardo pinta su zona con el color del jugador. Los OUT no tienen zona y no se dibujan.
    // Varios dardos en la misma zona comparten un único parche (no se superponen) y, si son de
    // jugadores distintos, el parche se divide por colores para que se vea quién golpeó qué.
    const groups = new Map();
    for (const mark of marks) {
        const region = mark.region || dartRegion(mark.dart);
        if (!region) continue;

        const key = `${region.bull ? "bull" : region.sector}:${region.inner}:${region.outer}:${region.kind}`;
        if (!groups.has(key)) {
            groups.set(key, { region, mark, colors: new Map(), titles: [] });
        }

        const group = groups.get(key);
        const color = mark.color || "#e11d74";
        group.colors.set(color, (group.colors.get(color) || 0) + 1);
        group.titles.push(mark.title || mark.label || "Dardo");
        if (mark.highlight) group.mark = mark;
    }

    const patches = [...groups.values()].map((group) => {
        const mark = group.mark;
        const density = group.titles.length > 1
            ? `${group.titles.length} dardos · ${group.titles[group.titles.length - 1]}`
            : group.titles[0];
        const aria = group.titles.length > 1
            ? `Zona golpeada ${group.titles.length} veces (última: ${group.titles[0]})`
            : group.titles[0];
        const data = trackable
            ? ` data-dart-index="${mark.index}" tabindex="0" role="button" aria-label="${escapeXml(aria)}"`
            : "";
        const classes = ["dart-zone"];
        if (mark.highlight) classes.push("is-highlight");

        const colors = [...group.colors.entries()];
        const primary = colors.slice().sort((a, b) => b[1] - a[1])[0][0];
        const parts = colors.length > 1 ? colors.map(([color]) => color) : [primary];

        return `
            <g class="${classes.join(" ")}"${data} style="--zone-color:${primary}">
                <title>${escapeXml(density)}</title>
                ${paintShape(group.region, parts)}
            </g>`;
    }).join("");

    const style = pulse
        ? `<style>
            @keyframes dartZonePulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 0.95; } }
            .dart-zone > path, .dart-zone > circle { animation: dartZonePulse 1.25s ease-in-out infinite; }
            .dart-zone.is-highlight > path, .dart-zone.is-highlight > circle { animation-duration: 0.6s; }
            @media (prefers-reduced-motion: reduce) {
                .dart-zone > path, .dart-zone > circle { animation: none; opacity: 0.75; }
            }
        </style>`
        : "";

    return `
        <svg class="dartboard-svg${pulse ? " is-heatmap" : ""}" viewBox="${-BOARD.view} ${-BOARD.view} ${BOARD.view * 2} ${BOARD.view * 2}" role="img" aria-label="${escapeXml(label)}">
            ${style}
            <defs>
                <radialGradient id="dartboardSheen" cx="36%" cy="26%" r="82%">
                    <stop offset="0%" stop-color="#ffffff" stop-opacity="0.2"/>
                    <stop offset="55%" stop-color="#ffffff" stop-opacity="0.02"/>
                    <stop offset="100%" stop-color="#000000" stop-opacity="0.16"/>
                </radialGradient>
                <filter id="dartboardShadow" x="-30%" y="-30%" width="160%" height="160%">
                    <feDropShadow dx="0" dy="5" stdDeviation="7" flood-color="#0b1f33" flood-opacity="0.24"/>
                </filter>
            </defs>
            <g filter="url(#dartboardShadow)">
                <circle cx="0" cy="0" r="${BOARD.outerDouble + 4}" fill="#0b1f33"/>
                <circle cx="0" cy="0" r="${BOARD.outerDouble}" fill="#12283a"/>
                ${wedges}
                <circle cx="0" cy="0" r="${BOARD.outerBull}" fill="#f4ead8"/>
                ${ring(BOARD.innerTriple, BOARD.outerTriple, "triple")}
                ${ring(BOARD.innerDouble, BOARD.outerDouble, "double")}
                <circle cx="0" cy="0" r="${BOARD.outerBull * 0.5}" fill="#1e8a5b"/>
                ${wires}
                <circle cx="0" cy="0" r="${BOARD.outerDouble}" fill="none" stroke="#06121c" stroke-width="1.1"/>
                <circle cx="0" cy="0" r="${BOARD.innerDouble}" fill="none" stroke="#06121c" stroke-width="0.6"/>
                <circle cx="0" cy="0" r="${BOARD.outerTriple}" fill="none" stroke="#06121c" stroke-width="0.6"/>
                <circle cx="0" cy="0" r="${BOARD.innerTriple}" fill="none" stroke="#06121c" stroke-width="0.6"/>
                <circle cx="0" cy="0" r="${BOARD.outerBull}" fill="none" stroke="#06121c" stroke-width="0.6"/>
                <circle cx="0" cy="0" r="${BOARD.outerBull * 0.5}" fill="none" stroke="#f4ead8" stroke-width="0.5" opacity="0.8"/>
                <circle cx="0" cy="0" r="${BOARD.outerDouble}" fill="url(#dartboardSheen)"/>
            </g>
            ${patches}
            ${numbers}
        </svg>
    `;
}

/**
 * Agrupa los dardos por ronda (todas las tiradas de todos los jugadores en esa ronda),
 * conservando el índice global de cada dardo para poder resaltarlo en la diana.
 */
export function groupRounds(darts) {
    const rounds = new Map();

    (darts || []).forEach((rawDart, dartIndex) => {
        const dart = normalizeDart(rawDart);
        const roundNumber = dart.round;
        if (!rounds.has(roundNumber)) {
            rounds.set(roundNumber, {
                round: roundNumber,
                darts: [],
                turns: new Map(),
                score: 0
            });
        }

        const round = rounds.get(roundNumber);
        const indexed = { ...dart, index: dartIndex };
        round.darts.push(indexed);
        round.score += dart.score;

        if (!round.turns.has(dart.playerIndex)) {
            round.turns.set(dart.playerIndex, {
                playerIndex: dart.playerIndex,
                player: dart.playerName || `Jugador ${dart.playerIndex + 1}`,
                darts: []
            });
        }
        round.turns.get(dart.playerIndex).darts.push(indexed);
    });

    return [...rounds.values()]
        .sort((a, b) => a.round - b.round)
        .map((round) => ({
            ...round,
            turns: [...round.turns.values()].sort((a, b) => a.playerIndex - b.playerIndex)
        }));
}

/** Estadísticas rápidas de una lista de dardos. */
export function summarizeDarts(darts) {
    const list = (darts || []).map(normalizeDart);
    const scored = list.filter((dart) => dart.score > 0);
    const score = list.reduce((total, dart) => total + dart.score, 0);

    return {
        darts: list.length,
        score,
        average: scored.length ? Math.round((score / scored.length) * 100) / 100 : 0,
        triples: list.filter((dart) => hitKind(dart) === "triple").length,
        doubles: list.filter((dart) => hitKind(dart) === "double").length,
        bulls: list.filter((dart) => hitKind(dart) === "dbull" || hitKind(dart) === "sbull").length,
        misses: list.filter((dart) => hitKind(dart) === "miss").length
    };
}

/**
 * Zona de la diana que cubre un dardo: anillo + sector. Devuelve los radios del anillo y el
 * índice de sector, o `null` si el dardo no cae dentro de la diana (OUT / miss / bust).
 *
 * Los parches se dibujan por encima de los alambres, así que el anillo triple se extiende un
 * poco hacia el interior/exterior para que el parche no quede cortado por el aro.
 */
export function dartRegion(dart) {
    const kind = hitKind(dart);
    if (kind === "miss") return null;

    if (kind === "dbull" || kind === "sbull") {
        // Doble bull: círculo central. Simple bull: corona entre el centro y el alambre exterior.
        return kind === "dbull"
            ? { bull: true, kind, inner: 0, outer: BOARD.outerBull * 0.5 }
            : { bull: true, kind, inner: BOARD.outerBull * 0.5, outer: BOARD.outerBull };
    }

    const sectorIndex = SECTORS.indexOf(Number(dart?.sector));
    if (sectorIndex < 0) return null;

    if (kind === "triple") {
        return { sector: dart.sector, sectorIndex, inner: BOARD.innerTriple - 1.5, outer: BOARD.outerTriple + 1.5, kind };
    }

    if (kind === "double") {
        return { sector: dart.sector, sectorIndex, inner: BOARD.innerDouble - 0.5, outer: BOARD.outerDouble + 1, kind };
    }

    // Un "simple" cae en el anillo interior o en el exterior (entre triple y doble). Si el dardo
    // lo indica lo respetamos; si no, alternamos por hueco para repartir los parches.
    const outerSimple = Boolean(dart?.outerSimple);
    return {
        sector: dart.sector,
        sectorIndex,
        inner: outerSimple ? BOARD.outerTriple : BOARD.outerBull,
        outer: outerSimple ? BOARD.innerDouble : BOARD.innerTriple,
        kind
    };
}

/** Forma SVG (sin atributos de estilo) de una zona concreta de la diana. */
export function regionShape(region) {
    if (region.bull) {
        return region.inner <= 0
            ? `<circle cx="0" cy="0" r="${region.outer}"></circle>`
            : `<path d="${wedgePath(region.inner, region.outer, -90, 270)}"></path>`;
    }

    const start = -90 + region.sectorIndex * 18 - 9;
    return `<path d="${wedgePath(region.inner, region.outer, start, start + 18)}"></path>`;
}

/**
 * Pinta una zona con uno o varios colores. Si la zona la golpearon varios jugadores se divide
 * en franjas concéntricas (de dentro hacia fuera) para que se vean todos sus colores.
 */
function paintShape(region, colors) {
    if (colors.length === 1) {
        return regionShape(region).replace(/<(path|circle) /, `<$1 fill="${colors[0]}" `);
    }

    const parts = [];
    const step = (region.outer - region.inner) / colors.length;

    colors.forEach((color, index) => {
        const inner = region.inner + step * index;
        const outer = region.inner + step * (index + 1);

        if (region.bull) {
            parts.push(inner <= 0
                ? `<circle cx="0" cy="0" r="${outer}" fill="${color}"></circle>`
                : `<path d="${wedgePath(inner, outer, -90, 270)}" fill="${color}"></path>`);
            return;
        }

        const start = -90 + region.sectorIndex * 18 - 9;
        parts.push(`<path d="${wedgePath(inner, outer, start, start + 18)}" fill="${color}"></path>`);
    });

    return parts.join("");
}

function escapeXml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/* =====================================================================
   Compatibilidad con las vistas previas (live-report.js)
   ===================================================================== */

/** Normaliza una colección de dardos. */
export function normalizeDarts(darts) {
    return (darts || []).filter(Boolean).map(normalizeDart);
}

/** Agrupa dardos por (ronda, jugador) conservando el índice global de cada dardo. */
export function groupTurns(darts) {
    const turns = [];
    const index = new Map();

    (darts || []).forEach((dart, dartIndex) => {
        const normalized = normalizeDart(dart);
        const key = `${normalized.round}-${normalized.playerIndex}`;
        let turn = index.get(key);
        if (!turn) {
            turn = {
                key,
                round: normalized.round,
                playerIndex: normalized.playerIndex,
                player: normalized.playerName || `Jugador ${normalized.playerIndex + 1}`,
                darts: []
            };
            index.set(key, turn);
            turns.push(turn);
        }
        turn.darts.push({ ...normalized, index: dartIndex });
    });

    return turns;
}

/** Etiqueta corta de la zona golpeada (T20, D16, SBULL, MISS...). */
export function cleanHitLabel(dart) {
    return hitLabel(dart);
}

/** Chip compacto de un dardo para tablas y listados. */
export function dartChip(dart) {
    const kind = hitKind(dart);
    const score = Number(dart?.score) || 0;
    return `<span class="dart-chip is-${kind}"><strong>${escapeXml(hitLabel(dart))}</strong><small>${score} pts</small></span>`;
}

/**
 * Diana completa a partir de una lista de dardos, sin metadatos extra.
 * Heatmap: cada dardo colorea su zona con el color de su jugador; los OUT no se dibujan.
 */
export function dartboardSvg(darts, options = {}) {
    const list = normalizeDarts(darts);
    const marks = list.map((dart, index) => ({
        index,
        dart,
        color: playerColor(dart.playerIndex),
        title: `Ronda ${dart.round} · ${dart.playerName || `Jugador ${dart.playerIndex + 1}`} · ${hitLabel(dart)} (${dart.score} pts)`
    }));

    return boardSvg(marks, options);
}

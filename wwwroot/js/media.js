/**
 * Vídeo de marca en bucle, silenciado y sin controles: el mismo tratamiento que usa la web
 * oficial de Radikal en sus cabeceras. Si el navegador no puede reproducirlo se queda el póster.
 */
export function ambientVideo({ src, poster = "", className = "", label = "" }) {
    return `
        <div class="ambient-media ${className}">
            <video
                class="ambient-video"
                src="${src}"
                ${poster ? `poster="${poster}"` : ""}
                autoplay
                muted
                loop
                playsinline
                preload="metadata"
                disablepictureinpicture
                aria-label="${label}"
                data-ambient-video></video>
            <span class="ambient-scrim" aria-hidden="true"></span>
        </div>
    `;
}

/** Pausa los vídeos ambientales fuera de pantalla y los reanuda al volver a verse. */
export function observeAmbientVideos(root) {
    const videos = [...root.querySelectorAll("[data-ambient-video]")];
    const frames = [...root.querySelectorAll("[data-ambient-youtube]")];

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (reduceMotion) {
        videos.forEach((video) => {
            video.removeAttribute("autoplay");
            video.pause?.();
        });
        frames.forEach((frame) => frame.remove());
        return () => {};
    }

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            const node = entry.target;
            if (node.tagName === "IFRAME") return;
            if (entry.isIntersecting) {
                node.play?.().catch(() => {});
            } else {
                node.pause?.();
            }
        });
    }, { threshold: 0.15 });

    videos.forEach((video) => {
        observer.observe(video);
        video.addEventListener("error", () => video.classList.add("is-unavailable"), { once: true });
    });

    return () => observer.disconnect();
}

/** Playlist oficial de Radikal Darts en YouTube (campeonatos, jugadores y eventos). */
export const RADIKAL_YOUTUBE_PLAYLIST = "PLrsDaaVuHB4krvH2-DBrBDC40K0ezJtbd";

/**
 * Vídeo ambiental de YouTube (playlist oficial de Radikal) usado como animación de fondo:
 * silenciado, en bucle, sin controles y sin interacción. Se carga de forma diferida.
 */
export function ambientYoutube({ listId = RADIKAL_YOUTUBE_PLAYLIST, className = "", title = "Vídeos de Radikal Darts" } = {}) {
    const params = new URLSearchParams({
        listType: "playlist",
        list: listId,
        autoplay: "1",
        mute: "1",
        loop: "1",
        controls: "0",
        modestbranding: "1",
        rel: "0",
        playsinline: "1",
        iv_load_policy: "3",
        disablekb: "1",
        fs: "0"
    });

    return `
        <div class="ambient-media ambient-youtube ${className}" data-ambient-youtube>
            <iframe
                src="https://www.youtube-nocookie.com/embed?${params.toString()}"
                title="${title}"
                loading="lazy"
                allow="autoplay; encrypted-media; picture-in-picture"
                referrerpolicy="strict-origin-when-cross-origin"
                tabindex="-1"
                aria-hidden="true"></iframe>
            <span class="ambient-scrim" aria-hidden="true"></span>
        </div>
    `;
}


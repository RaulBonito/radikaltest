import { api } from "./api.js?v=79";
import { esc, icon, openModal, toast, avatarHtml, officialBadge } from "./ui.js?v=78";

let current = null;

export function getCurrentPlayer() {
    return current;
}

export function setCurrentPlayer(player) {
    current = player;
    updateHeaderAuth();
}

export async function refreshAuth() {
    try {
        current = await api.authMe();
    } catch {
        current = null;
    }
    updateHeaderAuth();
    return current;
}

function updateNavUser() {
    const navUser = document.getElementById("nav-user");
    if (!navUser) return;

    if (current) {
        navUser.classList.add("is-connected");
        navUser.innerHTML = `
            <div class="nav-user-main">
                <span class="nav-user-avatar">${avatarHtml(current.alias, current.photoUrl)}</span>
                <span class="nav-user-info">
                    <strong>${esc(current.alias || current.dni || "Mi área")}</strong>
                    <small>Sesión iniciada</small>
                </span>
                <a class="nav-user-action" href="#/mi-area">Mi área</a>
            </div>
            <button class="nav-user-logout" type="button" data-nav-logout>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><path d="m16 17 5-5-5-5"></path><path d="M21 12H9"></path></svg>
                Cerrar sesión
            </button>
        `;
        navUser.querySelector("[data-nav-logout]")?.addEventListener("click", () => logout());
        return;
    }

    navUser.classList.remove("is-connected");
    navUser.innerHTML = `
        <div class="nav-user-main">
            <span class="nav-user-avatar is-guest">${icon("users")}</span>
            <span class="nav-user-info">
                <strong>Invitado</strong>
                <small>Accede con tu Radikal ID</small>
            </span>
            <button class="nav-user-action" type="button" data-nav-login>Acceder</button>
        </div>
    `;
    navUser.querySelector("[data-nav-login]")?.addEventListener("click", () => openLoginModal());
}

export function updateHeaderAuth() {
    updateNavUser();
    document.dispatchEvent(new CustomEvent("radikal:auth", { detail: { player: current } }));

    const loginButton = document.getElementById("login-open");
    const chip = document.getElementById("user-chip");
    const photo = document.getElementById("user-chip-photo");
    const alias = document.getElementById("user-chip-alias");

    if (!loginButton || !chip) return;

    if (current) {
        loginButton.hidden = true;
        chip.hidden = false;
        if (alias) alias.textContent = current.alias || current.dni || "Mi área";
        if (photo) {
            if (current.photoUrl) {
                photo.onerror = () => { photo.hidden = true; };
                photo.src = current.photoUrl;
                photo.hidden = false;
            } else {
                photo.hidden = true;
            }
        }
        chip.title = `Área de ${current.alias}`;
    } else {
        loginButton.hidden = false;
        chip.hidden = true;
    }
}

export function openLoginModal({ onSuccess } = {}) {
    const modal = openModal({
        title: "Accede a tu área",
        subtitle: "Tu perfil Radikal, tus estadísticas y tus competiciones",
        width: "520px",
        content: `
            <div class="login-modal">
                <div class="login-brand">
                    <img src="/img/brand/radikalplayers-transparent.png" alt="Radikal Players" />
                </div>
                <p class="small muted" style="margin:0 0 18px">
                    Usa tu Radikal ID (números y letras) y tu contraseña de Radikal Players.
                </p>
                <form id="login-form" autocomplete="on">
                    <label class="login-label" for="login-dni">Radikal ID</label>
                    <input class="form-control" id="login-dni" name="dni" type="text" inputmode="text"
                           autocapitalize="characters" autocorrect="off" spellcheck="false"
                           autocomplete="username" placeholder="Tu Radikal ID" required />
                    <label class="login-label" for="login-password">Contraseña</label>
                    <input class="form-control" id="login-password" name="clave" type="password" autocomplete="current-password" placeholder="Tu contraseña" required />
                    <div class="login-error" id="login-error" hidden></div>
                    <button class="btn btn-primary btn-block" type="submit" id="login-submit" style="margin-top:18px">
                        Entrar en mi área ${icon("arrow")}
                    </button>
                </form>
                <p class="small muted" style="margin:14px 0 0">
                    Tu contraseña se envía directamente a Radikal Players y no se almacena en esta aplicación.
                </p>
                <p class="small muted" style="margin:10px 0 0">
                    ¿Olvidaste tu contraseña? <a class="login-link" href="https://esp.radikalplayers.com/usuario-registro.php" target="_blank" rel="noopener">Recupérala en Radikal</a>
                </p>
            </div>
        `
    });

    const form = modal.backdrop.querySelector("#login-form");
    const errorBox = modal.backdrop.querySelector("#login-error");
    const submit = modal.backdrop.querySelector("#login-submit");

    setTimeout(() => modal.backdrop.querySelector("#login-dni")?.focus(), 60);

    const showError = (message) => {
        errorBox.hidden = false;
        errorBox.textContent = message;
    };

    form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        errorBox.hidden = true;
        const dni = form.querySelector("#login-dni")?.value.trim();
        const clave = form.querySelector("#login-password")?.value;
        if (!dni || !clave) {
            showError("Introduce tu Radikal ID y tu contraseña.");
            return;
        }

        submit.disabled = true;
        submit.textContent = "Conectando con Radikal…";
        try {
            current = await api.authLogin(dni, clave);
            updateHeaderAuth();
            modal.close();
            toast(`Bienvenido, ${current.alias}`, "success");
            if (onSuccess) onSuccess(current);
            else window.location.hash = `#/mi-area?login=${Date.now()}`;
        } catch (error) {
            showError(error.message || "No se pudo iniciar sesión.");
            submit.disabled = false;
            submit.innerHTML = `Entrar en mi área ${icon("arrow")}`;
        }
    });
}

export async function logout() {
    try {
        await api.authLogout();
    } catch {
        // cerramos igualmente en local
    }
    current = null;
    updateHeaderAuth();
    toast("Sesión cerrada");
    window.location.hash = "#/";
}

export function playerHeader(player) {
    return `
        <div class="player-modal-head">
            ${avatarHtml(player.alias, player.photoUrl)}
            <div>
                <div class="kicker">${icon("users")}Mi área Radikal</div>
                <h2 style="margin:0;font-family:var(--font-display);font-size:1.8rem;text-transform:uppercase">${esc(player.alias)}</h2>
                <p class="muted small" style="margin:3px 0 8px">${esc(player.name || "")}</p>
                <div class="player-tags">
                    <span class="badge badge-platinum">CONECTADO</span>
                    ${player.officialPlayerType && player.officialPlayerType !== "NONE" ? officialBadge(player.officialPlayerType) : ""}
                </div>
            </div>
        </div>
    `;
}

const AUTH_CONFIG = {
    projectUrl: "https://sxwnyztslfyozxxlqxjd.supabase.co",
    apiKey: "sb_publishable_Vdbds2yta-ZMBEQ2ap6wsw_lebc8C52"
};
const AUTH_CONFIG_STORAGE_KEY = "pmprojects.web.supabase.config";
const AUTH_SESSION_KEY = "pmprojects.web.auth.session";
const AUTH_WORKSPACES_KEY = "pmprojects.web.auth.workspaces";
const SELECTED_WORKSPACE_KEY = "pmprojects.web.selectedWorkspaceId";
const DEFAULT_WORKSPACE = {
    workspace_id: "pmprojects-main",
    role: "viewer",
    can_read: true,
    can_write: false,
    can_manage_users: false,
    workspaces: {
        id: "pmprojects-main",
        name: "PMProjects Main"
    }
};

window.PMProjectsAuth = {
    requireAuth(onAuthenticated) {
        if (isLocalDevelopmentHost()) {
            continueLocally(onAuthenticated);
            return;
        }

        const inviteSession = sessionFromUrlHash();
        if (inviteSession?.access_token) {
            clearSession();
            showPasswordSetup(inviteSession, onAuthenticated);
            return;
        }

        const session = loadSession();
        if (session?.access_token && !isSessionExpired(session)) {
            continueWithSession(session, onAuthenticated);
            return;
        }

        clearSession();
        showLogin(onAuthenticated);
    },

    session() {
        return loadSession();
    },

    accessToken() {
        const session = loadSession();
        return session?.access_token && !isSessionExpired(session) ? session.access_token : "";
    },

    workspaces() {
        return loadWorkspaces();
    },

    selectedWorkspaceId() {
        return loadConfig().workspaceId || DEFAULT_WORKSPACE.workspace_id;
    },

    selectWorkspace(workspaceId) {
        const workspaces = loadWorkspaces();
        const selected = workspaces.find(item => item.workspace_id === workspaceId) || DEFAULT_WORKSPACE;
        applyWorkspaceConfig(selected);
        localStorage.setItem(SELECTED_WORKSPACE_KEY, selected.workspace_id);
        return selected;
    },

    logout() {
        clearSession();
        window.location.href = "index.html";
    }
};

function isLocalDevelopmentHost() {
    return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function continueLocally(onAuthenticated) {
    saveWorkspaces([DEFAULT_WORKSPACE]);
    applyWorkspaceConfig(DEFAULT_WORKSPACE);
    localStorage.setItem(SELECTED_WORKSPACE_KEY, DEFAULT_WORKSPACE.workspace_id);
    document.body.classList.remove("auth-required");
    onAuthenticated(null);
}

function sessionFromUrlHash() {
    const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
    if (!hash) {
        return null;
    }

    const params = new URLSearchParams(hash);
    const accessToken = params.get("access_token") || "";
    const tokenType = params.get("token_type") || "bearer";
    const type = params.get("type") || "";

    if (!accessToken || type !== "invite") {
        return null;
    }

    return {
        access_token: accessToken,
        refresh_token: params.get("refresh_token") || "",
        expires_at: Number(params.get("expires_at")) || Math.floor(Date.now() / 1000) + Number(params.get("expires_in") || 3600),
        token_type: tokenType,
        user: null
    };
}

function showLogin(onAuthenticated) {
    document.body.classList.add("auth-required");

    const overlay = document.createElement("section");
    overlay.className = "login-screen";
    overlay.innerHTML = `
        <form class="login-panel">
            <div class="brand-mark login-mark" aria-hidden="true">
                <span></span><span></span><span></span><span></span>
            </div>
            <h1>Project Workspace</h1>
            <p>Sign in with your Supabase user account.</p>
            <label>
                Email
                <input name="email" type="email" autocomplete="username" required>
            </label>
            <label>
                Password
                <input name="password" type="password" autocomplete="current-password" required>
            </label>
            <button type="submit">Login</button>
            <span class="login-error" role="alert"></span>
        </form>
    `;

    const form = overlay.querySelector("form");
    const error = overlay.querySelector(".login-error");
    form.addEventListener("submit", async event => {
        event.preventDefault();
        error.textContent = "";

        const emailInput = form.querySelector('input[name="email"]');
        const passwordInput = form.querySelector('input[name="password"]');
        const email = String(emailInput?.value || "").trim().toLowerCase();
        const password = String(passwordInput?.value || "");

        if (!email) {
            error.textContent = "Enter email address.";
            return;
        }

        if (!password) {
            error.textContent = "Enter password.";
            return;
        }

        setFormBusy(form, true);

        try {
            const session = await signInWithPassword(email, password);
            saveSession(session);
            overlay.remove();
            await continueWithSession(session, onAuthenticated);
        } catch (loginError) {
            error.textContent = loginError.message || "Login failed.";
        } finally {
            setFormBusy(form, false);
        }
    });

    document.body.appendChild(overlay);
    form.elements.email.focus();
}

function showPasswordSetup(inviteSession, onAuthenticated) {
    document.body.classList.add("auth-required");

    const overlay = document.createElement("section");
    overlay.className = "login-screen";
    overlay.innerHTML = `
        <form class="login-panel">
            <div class="brand-mark login-mark" aria-hidden="true">
                <span></span><span></span><span></span><span></span>
            </div>
            <h1>Create Password</h1>
            <p>Set a password to activate this workspace account.</p>
            <label>
                New password
                <input name="password" type="password" autocomplete="new-password" minlength="8" required>
            </label>
            <label>
                Confirm password
                <input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required>
            </label>
            <button type="submit">Save Password</button>
            <span class="login-error" role="alert"></span>
        </form>
    `;

    const form = overlay.querySelector("form");
    const error = overlay.querySelector(".login-error");
    form.addEventListener("submit", async event => {
        event.preventDefault();
        error.textContent = "";

        const password = String(form.querySelector('input[name="password"]')?.value || "");
        const confirmPassword = String(form.querySelector('input[name="confirmPassword"]')?.value || "");

        if (password.length < 8) {
            error.textContent = "Password must be at least 8 characters.";
            return;
        }

        if (password !== confirmPassword) {
            error.textContent = "Passwords do not match.";
            return;
        }

        setFormBusy(form, true);

        try {
            const user = await updatePassword(inviteSession.access_token, password);
            const session = {
                ...inviteSession,
                user
            };
            saveSession(session);
            history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
            overlay.remove();
            await continueWithSession(session, onAuthenticated);
        } catch (setupError) {
            error.textContent = setupError.message || "Password setup failed.";
        } finally {
            setFormBusy(form, false);
        }
    });

    document.body.appendChild(overlay);
    form.elements.password.focus();
}

async function continueWithSession(session, onAuthenticated) {
    const workspaces = await loadWorkspaceAccess(session);
    saveWorkspaces(workspaces);
    applyWorkspaceConfig(selectInitialWorkspace(workspaces));
    document.body.classList.remove("auth-required");
    onAuthenticated(session);
}

async function signInWithPassword(email, password) {
    const payloadBody = {
        email: String(email || "").trim().toLowerCase(),
        password: String(password || "")
    };

    if (!payloadBody.email || !payloadBody.password) {
        throw new Error("Enter email and password.");
    }

    const response = await fetch(`${AUTH_CONFIG.projectUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: {
            apikey: AUTH_CONFIG.apiKey,
            Authorization: `Bearer ${AUTH_CONFIG.apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payloadBody)
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload.error_description || payload.msg || payload.error || "Invalid email or password.");
    }

    return {
        access_token: payload.access_token,
        refresh_token: payload.refresh_token,
        expires_at: Math.floor(Date.now() / 1000) + Number(payload.expires_in || 3600),
        user: payload.user || null
    };
}

async function updatePassword(accessToken, password) {
    const response = await fetch(`${AUTH_CONFIG.projectUrl}/auth/v1/user`, {
        method: "PUT",
        headers: {
            apikey: AUTH_CONFIG.apiKey,
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ password })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload.error_description || payload.msg || payload.error || "Could not create password.");
    }

    return payload;
}

function loadSession() {
    try {
        return JSON.parse(localStorage.getItem(AUTH_SESSION_KEY)) || null;
    } catch {
        return null;
    }
}

function saveSession(session) {
    localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
    localStorage.removeItem(AUTH_SESSION_KEY);
    localStorage.removeItem(AUTH_WORKSPACES_KEY);
}

function isSessionExpired(session) {
    return Number(session.expires_at || 0) <= Math.floor(Date.now() / 1000) + 30;
}

function setFormBusy(form, isBusy) {
    [...form.elements].forEach(element => {
        element.disabled = isBusy;
    });
}

async function loadWorkspaceAccess(session) {
    try {
        const rows = await authGet("workspace_memberships", {
            user_id: `eq.${session.user?.id || ""}`,
            can_read: "eq.true",
            select: "workspace_id,role,can_read,can_write,can_manage_users,workspaces(id,name)",
            order: "workspace_id.asc"
        }, session.access_token);

        return rows.length ? rows : [DEFAULT_WORKSPACE];
    } catch (error) {
        console.warn("Workspace memberships unavailable; using default workspace.", error);
        return [DEFAULT_WORKSPACE];
    }
}

async function authGet(table, query, accessToken) {
    const url = new URL(`${AUTH_CONFIG.projectUrl}/rest/v1/${table}`);
    Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));

    const response = await fetch(url, {
        headers: {
            apikey: AUTH_CONFIG.apiKey,
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json"
        }
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`${table} failed (${response.status}) ${body}`.trim());
    }

    return response.json();
}

function selectInitialWorkspace(workspaces) {
    const selectedWorkspaceId = localStorage.getItem(SELECTED_WORKSPACE_KEY);
    return workspaces.find(item => item.workspace_id === selectedWorkspaceId)
        || workspaces.find(item => item.workspace_id === DEFAULT_WORKSPACE.workspace_id)
        || workspaces[0]
        || DEFAULT_WORKSPACE;
}

function saveWorkspaces(workspaces) {
    localStorage.setItem(AUTH_WORKSPACES_KEY, JSON.stringify(workspaces));
}

function loadWorkspaces() {
    try {
        const workspaces = JSON.parse(localStorage.getItem(AUTH_WORKSPACES_KEY)) || [];
        return workspaces.length ? workspaces : [DEFAULT_WORKSPACE];
    } catch {
        return [DEFAULT_WORKSPACE];
    }
}

function loadConfig() {
    try {
        return JSON.parse(localStorage.getItem(AUTH_CONFIG_STORAGE_KEY)) || {};
    } catch {
        return {};
    }
}

function applyWorkspaceConfig(workspace) {
    const current = loadConfig();
    localStorage.setItem(AUTH_CONFIG_STORAGE_KEY, JSON.stringify({
        ...current,
        projectUrl: AUTH_CONFIG.projectUrl,
        apiKey: AUTH_CONFIG.apiKey,
        workspaceId: workspace.workspace_id
    }));
}

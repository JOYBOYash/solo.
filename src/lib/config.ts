// Runtime configuration. Solo uses the public PKCE flow, so only the Client ID
// is needed — no secret. By default every singer connects their OWN Spotify app
// (paste the Client ID once, stored in this browser only), which keeps Solo
// usable by anyone on any host without Spotify quota approval. A deployment can
// also provide a shared Client ID through VITE_SPOTIFY_CLIENT_ID; a ?client_id=
// URL parameter still works for one-off shares.

const CLIENT_ID_KEY = 'solo.clientId';
const CLIENT_ID_PATTERN = /^[0-9a-f]{32}$/i;

const ENV_CLIENT_ID = (import.meta.env.VITE_SPOTIFY_CLIENT_ID ?? '').trim();
const ENV_REDIRECT_URI = (import.meta.env.VITE_SPOTIFY_REDIRECT_URI ?? '').trim();

/** True when a valid Client ID is compiled into this deployment. */
export function hasDeploymentClientId(): boolean {
  return CLIENT_ID_PATTERN.test(ENV_CLIENT_ID);
}

/** The Client ID configured for this deployment, if any. */
export function deploymentClientId(): string | null {
  return CLIENT_ID_PATTERN.test(ENV_CLIENT_ID) ? ENV_CLIENT_ID : null;
}

/** The Client ID used for sign-in: a browser override first, then the deployment default. */
export function getClientId(): string | null {
  const id = localStorage.getItem(CLIENT_ID_KEY)?.trim();
  if (id && CLIENT_ID_PATTERN.test(id)) return id;
  return deploymentClientId();
}

export function setClientId(id: string): void {
  localStorage.setItem(CLIENT_ID_KEY, id.trim());
}

export function clearClientId(): void {
  localStorage.removeItem(CLIENT_ID_KEY);
}

/** True when the browser is overriding a deployment-provided Client ID. */
export function hasLocalClientIdOverride(): boolean {
  return Boolean(localStorage.getItem(CLIENT_ID_KEY)?.trim());
}

/**
 * The exact redirect URI Solo answers on — must be registered in the Spotify
 * dashboard. VITE_SPOTIFY_REDIRECT_URI wins when set (custom domains, preview
 * proxies); otherwise it resolves from the current origin, which handles root
 * hosts (https://domain/callback) and sub-path deployments.
 */
export function redirectUri(): string {
  if (ENV_REDIRECT_URI) return ENV_REDIRECT_URI;
  return new URL(`${import.meta.env.BASE_URL}callback`, window.location.href).href;
}

export const SPOTIFY_SCOPES = [
  'user-read-private',
  'user-modify-playback-state',
  'streaming',
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ');

/** Accepts a ?client_id= URL parameter (for one-off shared-Client-ID links). */
export function consumeClientIdParam(): string | null {
  const url = new URL(window.location.href);
  const param = url.searchParams.get('client_id');
  if (!param) return null;
  url.searchParams.delete('client_id');
  window.history.replaceState({}, '', url.origin + url.pathname + (url.searchParams.size ? `?${url.searchParams}` : ''));
  if (CLIENT_ID_PATTERN.test(param)) {
    setClientId(param);
    return param;
  }
  return null;
}

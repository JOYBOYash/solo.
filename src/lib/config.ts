// Runtime configuration. Solo uses the public PKCE flow, so only the Client ID
// is needed — no secret. By default every singer connects their OWN Spotify app
// (paste the Client ID once, stored in this browser only), which keeps Solo
// usable by anyone on any host without Spotify quota approval. A shared Client
// ID can also be supplied for a deployment via the ?client_id= URL parameter.

const CLIENT_ID_KEY = 'solo.clientId';

export function getClientId(): string | null {
  const id = localStorage.getItem(CLIENT_ID_KEY);
  return id && id.trim() ? id.trim() : null;
}

export function setClientId(id: string): void {
  localStorage.setItem(CLIENT_ID_KEY, id.trim());
}

export function clearClientId(): void {
  localStorage.removeItem(CLIENT_ID_KEY);
}

/**
 * The exact redirect URI Solo answers on — must be registered in the Spotify
 * dashboard. Resolves correctly for root hosts (https://domain/callback) and
 * sub-path hosts like GitHub Pages (https://user.github.io/repo/callback).
 */
export function redirectUri(): string {
  return new URL(`${import.meta.env.BASE_URL}callback`, window.location.href).href;
}

export const SPOTIFY_SCOPES = [
  'user-read-private',
  'user-modify-playback-state',
  'streaming',
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ');

/** Accepts a ?client_id= URL parameter (for shared-Client-ID deployments). */
export function consumeClientIdParam(): string | null {
  const url = new URL(window.location.href);
  const param = url.searchParams.get('client_id');
  if (!param) return null;
  url.searchParams.delete('client_id');
  window.history.replaceState({}, '', url.origin + url.pathname + (url.searchParams.size ? `?${url.searchParams}` : ''));
  if (/^[0-9a-f]{32}$/i.test(param)) {
    setClientId(param);
    return param;
  }
  return null;
}

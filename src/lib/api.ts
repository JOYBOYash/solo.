// Thin wrapper over the Spotify Web API. Only endpoints that remain available
// to new apps are used (audio-features / audio-analysis / recommendations are
// deprecated for new apps and are deliberately avoided).

import { ensureToken, isLoggedIn } from './auth';

const API = 'https://api.spotify.com/v1';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Thrown when Spotify refuses to list a playlist's contents. Since the
 * February 2026 Web API changes, only playlists the user owns or collaborates
 * on expose their items.
 */
export class PlaylistLockedError extends Error {
  constructor() {
    super('Spotify only shares the songs of playlists you own or collaborate on.');
    this.name = 'PlaylistLockedError';
  }
}

async function request<T>(path: string, init?: RequestInit, retry = true): Promise<T> {
  if (!isLoggedIn()) throw new ApiError('Not connected to Spotify.', 401);
  const token = await ensureToken();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });

  if (res.status === 401 && retry) {
    // The token may have been revoked or expired early; force one refresh
    // instead of reusing the same stored token.
    try {
      await ensureToken(true);
    } catch {
      throw new ApiError('Your Spotify session has ended. Please connect again.', 401);
    }
    return request<T>(path, init, false);
  }

  if (res.status === 204) return undefined as T;

  if (!res.ok) {
    let message = `Spotify request failed (${res.status}).`;
    try {
      const data = (await res.json()) as { error?: { message?: string } };
      if (data.error?.message) message = data.error.message;
    } catch {
      /* keep generic message */
    }
    throw new ApiError(message, res.status);
  }

  return (await res.json()) as T;
}

export interface Me {
  id: string;
  display_name: string | null;
  /** Removed from GET /me in the February 2026 API changes; may be absent. */
  product?: string;
  images?: { url: string }[];
}

interface SongCounts {
  /** Current API shape — absent for playlists the user does not own. */
  items?: { total: number };
  /** Deprecated pre-February-2026 alias for `items`. */
  tracks?: { total: number };
}

export interface Playlist extends SongCounts {
  id: string;
  uri: string;
  name: string;
  images?: { url: string }[];
  owner?: { id?: string; display_name: string | null };
}

/** Song count when Spotify exposes it — null for merely-followed playlists. */
export function playlistSongCount(playlist: SongCounts): number | null {
  return playlist.items?.total ?? playlist.tracks?.total ?? null;
}

export interface Track {
  id: string | null;
  uri: string | null;
  name: string;
  duration_ms: number;
  artists: { name: string }[];
  album?: { name: string; images: { url: string }[] };
}

interface Paged<T> {
  items: T[];
  next: string | null;
  total: number;
}

export async function getMe(): Promise<Me> {
  return request<Me>('/me');
}

/** All playlists the user follows or owns, following pagination. */
export async function getPlaylists(): Promise<Playlist[]> {
  const out: Playlist[] = [];
  let path = '/me/playlists?limit=50';
  for (let page = 0; page < 20 && path; page++) {
    // This endpoint returns Playlist objects directly in `items`, each with an
    // `items.total` song count (and a deprecated `tracks.total` alias).
    const res = await request<Paged<Playlist | null>>(path);
    for (const item of res.items ?? []) {
      if (item?.id) out.push(item);
    }
    path = res.next ? `${res.next.replace(API, '')}` : '';
  }
  return out;
}

export interface PlaylistDetail extends SongCounts {
  id: string;
  uri: string;
  name: string;
  images?: { url: string }[];
  owner?: { id?: string; display_name: string | null };
}

export async function getPlaylistDetail(id: string): Promise<PlaylistDetail> {
  try {
    return await request<PlaylistDetail>(
      `/playlists/${id}?fields=id,uri,name,images,owner(id,display_name),items(total)`,
    );
  } catch (err) {
    // Older deployments / unexpected field changes: ask for the full object.
    if (err instanceof ApiError && err.status === 400) {
      return request<PlaylistDetail>(`/playlists/${id}`);
    }
    throw err;
  }
}

/**
 * All playable tracks of a playlist, following pagination. Uses the /items
 * endpoint introduced in February 2026; the old /tracks endpoint was removed.
 */
export async function getPlaylistTracks(id: string): Promise<Track[]> {
  const out: Track[] = [];
  let path = `/playlists/${id}/items?limit=50`;
  for (let page = 0; page < 40 && path; page++) {
    let res: Paged<unknown>;
    try {
      res = await request(path);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
        throw new PlaylistLockedError();
      }
      throw err;
    }
    for (const entry of res.items ?? []) {
      const t = unwrapPlaylistItem(entry);
      if (t && t.uri && t.uri.startsWith('spotify:track:')) out.push(t);
    }
    path = res.next ? `${res.next.replace(API, '')}` : '';
  }
  return out;
}

/**
 * Playlist items have changed shape across Spotify API versions: an item can be
 * the track itself, `{ item: track }` (February 2026), or `{ track }` (legacy).
 * Accept all three so a playlist never renders empty because of a wrapper name.
 */
function unwrapPlaylistItem(entry: unknown): Track | null {
  if (!entry || typeof entry !== 'object') return null;
  const wrapped = entry as { item?: Track | null; track?: Track | null };
  if (wrapped.item && typeof wrapped.item === 'object') return wrapped.item;
  if (wrapped.track && typeof wrapped.track === 'object') return wrapped.track;
  const direct = entry as Track;
  return typeof direct.uri === 'string' ? direct : null;
}

export interface SearchResults {
  tracks: Track[];
  total: number;
}

export async function searchTracks(query: string, offset = 0): Promise<SearchResults> {
  const q = query.trim();
  if (!q) return { tracks: [], total: 0 };
  // The search limit maximum dropped from 50 to 10 in February 2026, so a
  // page of results is 10 songs; offset paginates beyond that.
  const res = await request<{ tracks: Paged<Track> }>(
    `/search?type=track&limit=10&offset=${offset}&q=${encodeURIComponent(q)}`,
  );
  const trackPage = res.tracks;
  const items = trackPage?.items ?? [];
  const reported = Number(trackPage?.total);
  // Search offsets are capped at 1000; never offer paging past that point.
  const total = Math.min(
    Number.isFinite(reported) ? reported : offset + items.length,
    1000,
  );
  return {
    tracks: items.filter((t) => t?.uri),
    total,
  };
}

/** Start playback of a playlist (optionally at a given track) on the given device. */
export async function startPlaylist(
  deviceId: string,
  playlistUri: string,
  trackUri?: string,
): Promise<void> {
  const body: Record<string, unknown> = { context_uri: playlistUri, position_ms: 0 };
  if (trackUri) body.offset = { uri: trackUri };
  await request(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

/** Start playback of loose tracks (e.g. search results) on the given device. */
export async function startTracks(deviceId: string, uris: string[]): Promise<void> {
  await request(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    method: 'PUT',
    body: JSON.stringify({ uris, position_ms: 0 }),
  });
}

export async function transferPlayback(deviceId: string, play: boolean): Promise<void> {
  await request('/me/player', {
    method: 'PUT',
    body: JSON.stringify({ device_ids: [deviceId], play }),
  });
}

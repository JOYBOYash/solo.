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

  if (res.status === 401 && retry) return request<T>(path, init, false);

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
  product: string;
  images: { url: string }[];
}

export interface Playlist {
  id: string;
  uri: string;
  name: string;
  images: { url: string }[];
  tracks: { total: number };
  owner: { display_name: string | null };
}

export interface Track {
  id: string | null;
  uri: string | null;
  name: string;
  duration_ms: number;
  artists: { name: string }[];
  album: { name: string; images: { url: string }[] };
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
    // This endpoint returns Playlist objects directly in `items` — unlike
    // /playlists/{id}/tracks, which wraps each track in a `{ track }` item.
    const res = await request<Paged<Playlist | null>>(path);
    for (const item of res.items) {
      if (item?.id) out.push(item);
    }
    path = res.next ? `${res.next.replace(API, '')}` : '';
  }
  return out;
}

export interface PlaylistDetail {
  id: string;
  uri: string;
  name: string;
  images: { url: string }[];
  tracks: { total: number };
}

export async function getPlaylistDetail(id: string): Promise<PlaylistDetail> {
  return request<PlaylistDetail>(`/playlists/${id}?fields=id,uri,name,images,tracks(total)`);
}

/** All playable tracks of a playlist, following pagination. */
export async function getPlaylistTracks(id: string): Promise<Track[]> {
  const out: Track[] = [];
  let path = `/playlists/${id}/tracks?limit=50`;
  for (let page = 0; page < 40 && path; page++) {
    const res = await request<Paged<{ track: Track | null }>>(path);
    for (const item of res.items) {
      const t = item.track;
      if (t && t.uri && t.uri.startsWith('spotify:track:')) out.push(t);
    }
    path = res.next ? `${res.next.replace(API, '')}` : '';
  }
  return out;
}

export async function searchTracks(query: string): Promise<Track[]> {
  if (!query.trim()) return [];
  const res = await request<{ tracks: Paged<Track> }>(
    `/search?type=track&limit=24&q=${encodeURIComponent(query.trim())}`,
  );
  return res.tracks.items.filter((t) => t.uri);
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

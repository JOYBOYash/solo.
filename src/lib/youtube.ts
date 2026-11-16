// YouTube Data API v3 client for search and trending music.
//
// Solo is a static site, so the viewer brings their own Google API key. The key
// is stored in this browser only and is sent to googleapis.com — never to Solo.
// Playback uses the official YouTube IFrame Player (see youtube-player.ts).

import type { YouTubeTrack } from './playback';

const KEY_STORAGE = 'solo.youtubeKey';
const KEY_PREFIX = 'AIza';
const API = 'https://www.googleapis.com/youtube/v3';

export class YouTubeApiError extends Error {
  readonly status: number;
  readonly reason: string;

  constructor(message: string, status = 0, reason = '') {
    super(message);
    this.name = 'YouTubeApiError';
    this.status = status;
    this.reason = reason;
  }
}

export function getYouTubeKey(): string | null {
  try {
    const key = localStorage.getItem(KEY_STORAGE)?.trim() ?? '';
    return key ? key : null;
  } catch {
    return null;
  }
}

export function hasYouTubeKey(): boolean {
  return Boolean(getYouTubeKey());
}

export function setYouTubeKey(key: string): void {
  localStorage.setItem(KEY_STORAGE, key.trim());
}

export function clearYouTubeKey(): void {
  localStorage.removeItem(KEY_STORAGE);
}

/** Google API keys start with AIza and are 39 characters long. */
export function looksLikeYouTubeKey(key: string): boolean {
  return key.startsWith(KEY_PREFIX) && key.length >= 35 && key.length <= 60;
}

interface ApiErrorPayload {
  error?: {
    code?: number;
    message?: string;
    errors?: { reason?: string }[];
  };
}

interface SearchItem {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    thumbnails?: Record<string, { url?: string } | undefined>;
  };
}

interface VideoItem {
  id?: string;
  snippet?: SearchItem['snippet'];
  contentDetails?: { duration?: string };
  status?: { embeddable?: boolean; privacyStatus?: string };
}

function friendlyError(status: number, payload: ApiErrorPayload): YouTubeApiError {
  const reason = payload.error?.errors?.[0]?.reason ?? '';
  const raw = payload.error?.message ?? '';

  if (
    status === 400 &&
    (reason === 'keyInvalid' || reason === 'API_KEY_INVALID' || /api key not valid/i.test(raw))
  ) {
    return new YouTubeApiError(
      'Google rejected that API key. Copy the whole key from Google Cloud and try again.',
      400,
      reason,
    );
  }
  if (
    reason === 'accessNotConfigured' ||
    /has not been used|is disabled|not enabled/i.test(raw)
  ) {
    return new YouTubeApiError(
      'YouTube Data API v3 is not enabled for this key. Enable it in Google Cloud, then try again.',
      status,
      reason,
    );
  }
  if (
    reason === 'quotaExceeded' ||
    reason === 'dailyLimitExceeded' ||
    /quota/i.test(raw)
  ) {
    return new YouTubeApiError(
      'This key has used its free daily YouTube quota. Wait for the quota to reset, or use another key.',
      status,
      reason,
    );
  }
  if (
    reason === 'ipRefererBlocked' ||
    reason === 'forbidden' ||
    /referer|referrer|restricted/i.test(raw)
  ) {
    return new YouTubeApiError(
      'This key is restricted to another website. Add this site’s address to the key’s website restrictions in Google Cloud.',
      status,
      reason,
    );
  }
  if (status === 403) {
    return new YouTubeApiError(
      raw || 'YouTube refused the request. Check the key’s API and website restrictions.',
      status,
      reason,
    );
  }
  if (status === 429) {
    return new YouTubeApiError('YouTube is rate-limiting this key. Try again in a moment.', status, reason);
  }
  return new YouTubeApiError(raw || 'YouTube could not complete the request. Try again.', status, reason);
}

async function api<T>(path: string, params: Record<string, string>): Promise<T> {
  const key = getYouTubeKey();
  if (!key) {
    throw new YouTubeApiError('Add your YouTube API key to search for music.', 401, 'missingKey');
  }

  const url = new URL(`${API}/${path}`);
  url.searchParams.set('key', key);
  for (const [name, value] of Object.entries(params)) {
    if (value) url.searchParams.set(name, value);
  }

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new YouTubeApiError(
      'Could not reach YouTube. Check your connection or content blocker, then try again.',
    );
  }

  if (!response.ok) {
    let payload: ApiErrorPayload = {};
    try {
      payload = (await response.json()) as ApiErrorPayload;
    } catch {
      /* non-JSON error body */
    }
    throw friendlyError(response.status, payload);
  }

  return (await response.json()) as T;
}

function decodeEntities(value: string): string {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
}

function cleanChannel(name: string): string {
  return decodeEntities(name)
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .trim();
}

/** Parse an ISO-8601 duration such as PT1H2M3S. */
export function parseYouTubeDuration(value: string | undefined): number {
  if (!value) return 0;
  const match = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value);
  if (!match) return 0;
  const [, days, hours, minutes, seconds] = match;
  return Math.round(
    (Number(days ?? 0) * 86400 +
      Number(hours ?? 0) * 3600 +
      Number(minutes ?? 0) * 60 +
      Number(seconds ?? 0)) *
      1000,
  );
}

function toTrack(item: VideoItem | SearchItem, fallbackId?: string): YouTubeTrack | null {
  const id = ('id' in item && typeof item.id === 'string' ? item.id : undefined) ?? fallbackId ?? '';
  const snippet = item.snippet;
  if (!id || !snippet?.title) return null;
  const thumbs = snippet.thumbnails ?? {};
  const artworkUrl =
    thumbs.maxres?.url ??
    thumbs.high?.url ??
    thumbs.medium?.url ??
    thumbs.default?.url ??
    `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  return {
    id,
    name: decodeEntities(snippet.title),
    artist: cleanChannel(snippet.channelTitle ?? 'YouTube'),
    artworkUrl,
    durationMs: 'contentDetails' in item ? parseYouTubeDuration(item.contentDetails?.duration) : 0,
  };
}

/** A single extra videos.list call adds durations and confirms embeddability. */
async function withDetails(tracks: YouTubeTrack[]): Promise<YouTubeTrack[]> {
  if (!tracks.length) return tracks;
  const ids = tracks.slice(0, 50).map((track) => track.id);
  const details = await api<{ items?: VideoItem[] }>('videos', {
    part: 'contentDetails,status',
    id: ids.join(','),
    maxResults: '50',
  });
  const byId = new Map<string, VideoItem>();
  for (const item of details.items ?? []) {
    if (item.id) byId.set(item.id, item);
  }
  const usable: YouTubeTrack[] = [];
  for (const track of tracks) {
    const item = byId.get(track.id);
    if (item?.status?.embeddable === false) continue;
    if (item?.status?.privacyStatus && item.status.privacyStatus !== 'public') continue;
    usable.push({ ...track, durationMs: parseYouTubeDuration(item?.contentDetails?.duration) || track.durationMs });
  }
  return usable;
}

export async function searchYouTube(query: string, limit = 24): Promise<YouTubeTrack[]> {
  const result = await api<{ items?: SearchItem[] }>('search', {
    part: 'snippet',
    type: 'video',
    videoCategoryId: '10',
    videoEmbeddable: 'true',
    maxResults: String(Math.min(50, Math.max(1, limit))),
    q: query,
    relevanceLanguage: navigator.language?.split('-')[0] ?? 'en',
  });
  const tracks = (result.items ?? [])
    .map((item) => toTrack(item, item.id?.videoId))
    .filter((track): track is YouTubeTrack => Boolean(track));
  return withDetails(tracks);
}

export async function trendingYouTube(limit = 24): Promise<YouTubeTrack[]> {
  const result = await api<{ items?: VideoItem[] }>('videos', {
    part: 'snippet,contentDetails,status',
    chart: 'mostPopular',
    videoCategoryId: '10',
    maxResults: String(Math.min(50, Math.max(1, limit))),
  });
  return (result.items ?? [])
    .filter((item) => item.status?.embeddable !== false)
    .map((item) => toTrack(item))
    .filter((track): track is YouTubeTrack => Boolean(track));
}

// Shared session state across screens.

import type { Me, Playlist, PlaylistDetail, Track } from './lib/api';
import type { PlayerBridge } from './lib/sdk';
import type { MicMonitor } from './lib/mic';
import type { DuetEngine } from './lib/duet';

export interface RoomContext {
  kind: 'playlist' | 'loose';
  playlistUri?: string;
  playlistName?: string;
  startTrackUri?: string;
  looseUris?: string[];
  /** Absent when a followed playlist is played from the top (Spotify hides its items). */
  initialTrack?: Track;
}

export interface Prefs {
  baseVolume: number;
  backingFactor: number;
  sensitivity: number;
  mode: 'auto' | 'manual';
}

const PREFS_KEY = 'solo.prefs';

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Prefs;
      return {
        baseVolume: clamp01(p.baseVolume ?? 1),
        backingFactor: clamp01(p.backingFactor ?? 0.12),
        sensitivity: Math.min(2, Math.max(0.5, p.sensitivity ?? 1)),
        mode: p.mode === 'manual' ? 'manual' : 'auto',
      };
    }
  } catch {
    /* defaults below */
  }
  return { baseVolume: 1, backingFactor: 0.12, sensitivity: 1, mode: 'auto' };
}

export function savePrefs(prefs: Prefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
}

export const store: {
  me: Me | null;
  playlists: Playlist[];
  playlist: PlaylistDetail | null;
  playlistTracks: Track[];
  player: PlayerBridge | null;
  mic: MicMonitor | null;
  duet: DuetEngine | null;
  roomActive: boolean;
  prefs: Prefs;
} = {
  me: null,
  playlists: [],
  playlist: null,
  playlistTracks: [],
  player: null,
  mic: null,
  duet: null,
  roomActive: false,
  prefs: loadPrefs(),
};

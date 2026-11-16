// Shared session state across screens.

import type { Me, Playlist, PlaylistDetail, Track } from './lib/api';
import type { FreeTrack, MusicSource, SoloPlayer } from './lib/playback';
import type { MicMonitor } from './lib/mic';
import type { DuetEngine } from './lib/duet';

export interface RoomContext {
  source: MusicSource;
  kind: 'playlist' | 'loose';
  playlistUri?: string;
  playlistName?: string;
  startTrackUri?: string;
  looseUris?: string[];
  /** Absent when a followed playlist is played from the top (Spotify hides its items). */
  initialTrack?: Track;
  /** Audius local queue for free rooms. */
  freeTracks?: FreeTrack[];
  freeIndex?: number;
}

export type RoomView = 'lyrical' | 'theatre' | 'studio';
export type TheatreStyle = 'wave' | 'lava';

export interface Prefs {
  baseVolume: number;
  backingFactor: number;
  sensitivity: number;
  mode: 'auto' | 'manual';
  view: RoomView;
  theatreStyle: TheatreStyle;
}

const PREFS_KEY = 'solo.prefs';
/** The song drops to this fraction of the master volume while you sing. */
const DEFAULT_BACKING_FACTOR = 0.6;
/** The previous default was so low that the song felt muted under the voice. */
const LEGACY_BACKING_FACTOR = 0.12;

function readView(value: unknown): RoomView {
  return value === 'theatre' || value === 'studio' ? value : 'lyrical';
}

function readTheatreStyle(value: unknown): TheatreStyle {
  return value === 'lava' ? 'lava' : 'wave';
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Prefs>;
      const storedBacking = typeof p.backingFactor === 'number' ? p.backingFactor : null;
      return {
        baseVolume: clamp01(p.baseVolume ?? 1),
        // Migrate only the old default; a level the singer chose is kept.
        backingFactor:
          storedBacking === LEGACY_BACKING_FACTOR
            ? DEFAULT_BACKING_FACTOR
            : clamp01(storedBacking ?? DEFAULT_BACKING_FACTOR),
        sensitivity: Math.min(2, Math.max(0.5, p.sensitivity ?? 1)),
        mode: p.mode === 'manual' ? 'manual' : 'auto',
        view: readView(p.view),
        theatreStyle: readTheatreStyle(p.theatreStyle),
      };
    }
  } catch {
    /* defaults below */
  }
  return {
    baseVolume: 1,
    backingFactor: DEFAULT_BACKING_FACTOR,
    sensitivity: 1,
    mode: 'auto',
    view: 'lyrical',
    theatreStyle: 'wave',
  };
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* storage disabled or full — keep the in-memory prefs for this session */
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
}

export const store: {
  me: Me | null;
  playlists: Playlist[];
  playlist: PlaylistDetail | null;
  playlistTracks: Track[];
  player: SoloPlayer | null;
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

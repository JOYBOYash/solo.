// Shared playback types. Solo can drive two very different engines:
//
//   • PlayerBridge — the Spotify Web Playback SDK (tab capture only).
//   • InlinePlayer — Audius streams and local files through an <audio> element
//     wired into the Web Audio API, so pitch, visuals and recordings work
//     directly from the page.
//
// The room and the duet engine talk to both through SoloPlayer.

export type MusicSource = 'spotify' | 'audius' | 'local';
export type FreeSource = Exclude<MusicSource, 'spotify'>;

/** A song that Solo can stream itself, without a Spotify account. */
export interface FreeTrack {
  id: string;
  source: FreeSource;
  name: string;
  artist: string;
  artworkUrl?: string;
  durationMs: number;
  /** Audius stream URL. Local files use `file` instead. */
  streamUrl?: string;
  file?: File;
}

export interface PlaybackTrack {
  uri: string;
  id: string | null;
  name: string;
  artists: { name: string; uri?: string }[];
  album?: { name: string; images: { url: string }[] };
  duration_ms?: number;
}

export interface PlaybackState {
  position: number;
  duration: number;
  paused: boolean;
  /** performance.now() timestamp matching `position`. */
  updatedAt: number;
  track: PlaybackTrack;
  nextTracks: PlaybackTrack[];
}

export interface PlayerError {
  kind: 'init' | 'auth' | 'account' | 'playback';
  message: string;
}

/**
 * The surface the room, duet engine and store rely on. Inline-only methods are
 * optional so PlayerBridge stays a plain Spotify transport.
 */
export interface SoloPlayer {
  readonly inline: boolean;

  onState: ((state: PlaybackState) => void) | null;
  onError: ((error: PlayerError) => void) | null;
  onDeviceReady: (() => void) | null;
  onDeviceLost: (() => void) | null;

  connect(): Promise<unknown>;
  activate(): void;
  togglePlay(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(ms: number): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  setVolume(v: number): Promise<void>;
  disconnect(): void;

  /** Load a queue of Audius/local tracks. Room calls this before playing. */
  loadQueue?(tracks: FreeTrack[], startIndex: number): void;

  /** Live Web Audio tap for Studio recording and pitch. */
  getMusicStream?(): MediaStream | null;
  getMusicAnalyser?(): AnalyserNode | null;
  copyMusicWaveform?(out: Float32Array): boolean;
  musicRms?(): number;
  musicPitch?(): number | null;
}

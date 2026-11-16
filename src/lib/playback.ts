// Shared playback types. Solo has two sources, both played by their official
// web players:
//
//   • YouTube — the IFrame Player API, searched with a shared or personal Data
//     API key.
//   • Spotify — the Web Playback SDK, connected with a personal Client ID.
//
// Neither iframe exposes its audio to the Web Audio API, so the room controls
// volume through the player's official methods and records takes with tab
// audio capture.

export type MusicSource = 'youtube' | 'spotify';

/** A YouTube search/trending result, ready for the room queue. */
export interface YouTubeTrack {
  id: string;
  name: string;
  artist: string;
  artworkUrl: string;
  durationMs: number;
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

/** The transport surface shared by the room and the duet engine. */
export interface SoloPlayer {
  readonly kind: MusicSource;

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

  /** Replace the YouTube queue. Spotify keeps its queue in the Spotify app. */
  loadQueue?(tracks: YouTubeTrack[], startIndex: number): void;
}

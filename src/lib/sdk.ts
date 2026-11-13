// Wrapper around the Spotify Web Playback SDK.
// The SDK turns this browser into a Spotify Connect device. Playback audio
// lives inside the SDK's own cross-origin (DRM) iframe and cannot be tapped
// into the Web Audio API — so the duet engine controls playback through the
// SDK's official volume/transport methods only.

import { ensureToken } from './auth';

const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';

export interface SdkTrack {
  uri: string;
  id: string | null;
  name: string;
  artists: { name: string; uri: string }[];
  album: { name: string; images: { url: string }[] };
  duration_ms?: number;
}

export interface PlaybackState {
  position: number;
  duration: number;
  paused: boolean;
  /** performance.now() timestamp matching `position`. */
  updatedAt: number;
  track: SdkTrack;
  nextTracks: SdkTrack[];
}

interface SpotifyPlayerLike {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: string, cb: (payload: never) => void): boolean;
  activateElement(): Promise<void>;
  togglePlay(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(ms: number): Promise<void>;
  nextTrack(): Promise<void>;
  previousTrack(): Promise<void>;
  setVolume(v: number): Promise<void>;
  getVolume(): Promise<number>;
  getCurrentState(): Promise<unknown>;
}

interface SpotifyNamespace {
  Player: new (options: {
    name: string;
    volume?: number;
    getOAuthToken: (cb: (token: string) => void) => void;
  }) => SpotifyPlayerLike;
}

declare global {
  interface Window {
    Spotify?: SpotifyNamespace;
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

export class SdkError extends Error {
  kind: 'init' | 'auth' | 'account' | 'playback';
  constructor(kind: SdkError['kind'], message: string) {
    super(message);
    this.name = 'SdkError';
    this.kind = kind;
  }
}

let loadPromise: Promise<SpotifyNamespace> | null = null;

function loadSdk(): Promise<SpotifyNamespace> {
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    if (window.Spotify) {
      resolve(window.Spotify);
      return;
    }
    window.onSpotifyWebPlaybackSDKReady = () => {
      if (window.Spotify) resolve(window.Spotify);
      else reject(new SdkError('init', 'Spotify SDK loaded without an API.'));
    };
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onerror = () => reject(new SdkError('init', 'Could not load the Spotify SDK. Check your connection or extensions.'));
    document.head.appendChild(script);
  });
  return loadPromise;
}

export class PlayerBridge {
  private player: SpotifyPlayerLike | null = null;
  private deviceId: string | null = null;

  onState: ((state: PlaybackState) => void) | null = null;
  onError: ((error: SdkError) => void) | null = null;
  onDeviceReady: (() => void) | null = null;
  onDeviceLost: (() => void) | null = null;

  /** Load the SDK, create the player and connect. Resolves with the device id. */
  async connect(): Promise<string> {
    if (this.deviceId && this.player) return this.deviceId;
    const Spotify = await loadSdk();

    const player = new Spotify.Player({
      name: 'Solo — web player',
      getOAuthToken: (cb) => {
        ensureToken().then(cb).catch(() => {
          this.onError?.(new SdkError('auth', 'Spotify session ended. Please reconnect.'));
        });
      },
      volume: 1,
    });

    player.addListener('ready', ((payload: { device_id: string }) => {
      this.deviceId = payload.device_id;
      this.onDeviceReady?.();
    }) as never);

    player.addListener('not_ready', (() => {
      this.onDeviceLost?.();
    }) as never);

    player.addListener('player_state_changed', ((state: {
      position: number;
      duration: number;
      paused: boolean;
      track_window: { current_track: SdkTrack; next_tracks: SdkTrack[] };
    } | null) => {
      if (!state) return;
      const playback: PlaybackState = {
        position: state.position,
        duration: state.duration,
        paused: state.paused,
        updatedAt: performance.now(),
        track: state.track_window.current_track,
        nextTracks: state.track_window.next_tracks,
      };
      this.onState?.(playback);
    }) as never);

    player.addListener('autoplay_failed', (() => {
      this.onError?.(
        new SdkError('playback', 'The browser blocked automatic playback — press Play in the room to start the song.'),
      );
    }) as never);

    const errorMap: Record<string, SdkError['kind']> = {
      initialization_error: 'init',
      authentication_error: 'auth',
      account_error: 'account',
      playback_error: 'playback',
    };
    for (const [event, kind] of Object.entries(errorMap)) {
      player.addListener(event, ((e: { message: string }) => {
        const message =
          kind === 'account'
            ? 'Spotify Premium is required for in-browser playback.'
            : e.message || 'Spotify playback reported an error.';
        this.onError?.(new SdkError(kind, message));
      }) as never);
    }

    const success = await player.connect();
    if (!success) throw new SdkError('init', 'Could not connect to Spotify playback.');

    this.player = player;

    const deviceId = await new Promise<string>((resolve, reject) => {
      if (this.deviceId) {
        resolve(this.deviceId);
        return;
      }
      const timeout = window.setTimeout(() => {
        reject(new SdkError('init', 'Spotify playback took too long to become ready. Try again.'));
      }, 20000);
      this.onDeviceReady = () => {
        window.clearTimeout(timeout);
        this.onDeviceReady = null;
        if (this.deviceId) resolve(this.deviceId);
      };
    });

    return deviceId;
  }

  /** Must be called synchronously inside a user gesture on iOS Safari. */
  activate(): void {
    void this.player?.activateElement();
  }

  async togglePlay(): Promise<void> {
    await this.player?.togglePlay();
  }

  async pause(): Promise<void> {
    await this.player?.pause();
  }

  async resume(): Promise<void> {
    await this.player?.resume();
  }

  async seek(ms: number): Promise<void> {
    await this.player?.seek(Math.max(0, Math.round(ms)));
  }

  async next(): Promise<void> {
    await this.player?.nextTrack();
  }

  async previous(): Promise<void> {
    await this.player?.previousTrack();
  }

  async setVolume(v: number): Promise<void> {
    await this.player?.setVolume(Math.min(1, Math.max(0, v)));
  }

  disconnect(): void {
    try {
      this.player?.disconnect();
    } catch {
      /* already gone */
    }
    this.player = null;
    this.deviceId = null;
  }
}

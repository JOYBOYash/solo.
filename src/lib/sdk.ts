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
  album?: { name: string; images: { url: string }[] };
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
  const promise = new Promise<SpotifyNamespace>((resolve, reject) => {
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
  loadPromise = promise;
  // Allow a later attempt to retry after a network/ad-block failure.
  void promise.catch(() => {
    if (loadPromise === promise) loadPromise = null;
  });
  return promise;
}

export class PlayerBridge {
  private player: SpotifyPlayerLike | null = null;
  private deviceId: string | null = null;
  private connecting: Promise<string> | null = null;

  onState: ((state: PlaybackState) => void) | null = null;
  onError: ((error: SdkError) => void) | null = null;
  onDeviceReady: (() => void) | null = null;
  onDeviceLost: (() => void) | null = null;

  /**
   * Load the SDK, create the player and connect. Resolves with the device id.
   * Concurrent calls share one attempt, so pre-warming the player and entering
   * the room never creates two Spotify devices.
   */
  async connect(): Promise<string> {
    if (this.deviceId && this.player) return this.deviceId;
    if (this.connecting) return this.connecting;

    const attempt = this.connectInternal();
    this.connecting = attempt;
    try {
      return await attempt;
    } finally {
      if (this.connecting === attempt) this.connecting = null;
    }
  }

  private async connectInternal(): Promise<string> {
    // A previous device went away (not_ready) or a prior attempt failed.
    if (this.player && !this.deviceId) {
      try {
        this.player.disconnect();
      } catch {
        /* already gone */
      }
      this.player = null;
    }

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
    // Assign immediately so activate() can be called from the user gesture
    // even while connect() is still resolving.
    this.player = player;
    this.deviceId = null;

    player.addListener('ready', ((payload: { device_id: string }) => {
      this.deviceId = payload.device_id;
      this.onDeviceReady?.();
    }) as never);

    player.addListener('not_ready', (() => {
      this.deviceId = null;
      this.onDeviceLost?.();
    }) as never);

    player.addListener('player_state_changed', ((state: {
      position: number;
      duration: number;
      paused: boolean;
      track_window: { current_track: SdkTrack | null; next_tracks: SdkTrack[] };
    } | null) => {
      if (!state?.track_window?.current_track) return;
      const playback: PlaybackState = {
        position: state.position,
        duration: state.duration,
        paused: state.paused,
        updatedAt: performance.now(),
        track: state.track_window.current_track,
        nextTracks: state.track_window.next_tracks ?? [],
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

    let success = false;
    try {
      success = await player.connect();
    } catch {
      success = false;
    }
    if (!success) {
      if (this.player === player) this.player = null;
      throw new SdkError('init', 'Could not connect to Spotify playback.');
    }

    return await new Promise<string>((resolve, reject) => {
      if (this.deviceId) {
        resolve(this.deviceId);
        return;
      }
      const timeout = window.setTimeout(() => {
        this.onDeviceReady = null;
        this.deviceId = null;
        if (this.player === player) {
          try {
            player.disconnect();
          } catch {
            /* already gone */
          }
          this.player = null;
        }
        reject(new SdkError('init', 'Spotify playback took too long to become ready. Try again.'));
      }, 20000);
      this.onDeviceReady = () => {
        window.clearTimeout(timeout);
        this.onDeviceReady = null;
        if (this.deviceId) resolve(this.deviceId);
        else reject(new SdkError('init', 'Spotify playback disconnected before it became ready.'));
      };
    });
  }

  /** Must be called synchronously inside a user gesture on iOS Safari. */
  activate(): void {
    try {
      void this.player?.activateElement().catch(() => {
        /* the room's Play button remains as a fallback */
      });
    } catch {
      /* no player yet */
    }
  }

  async togglePlay(): Promise<void> {
    try {
      await this.player?.togglePlay();
    } catch {
      /* transient transport errors are surfaced by the SDK events */
    }
  }

  async pause(): Promise<void> {
    try {
      await this.player?.pause();
    } catch {
      /* non-fatal */
    }
  }

  async resume(): Promise<void> {
    try {
      await this.player?.resume();
    } catch {
      /* non-fatal */
    }
  }

  async seek(ms: number): Promise<void> {
    try {
      await this.player?.seek(Math.max(0, Math.round(ms)));
    } catch {
      /* non-fatal */
    }
  }

  async next(): Promise<void> {
    try {
      await this.player?.nextTrack();
    } catch {
      /* non-fatal */
    }
  }

  async previous(): Promise<void> {
    try {
      await this.player?.previousTrack();
    } catch {
      /* non-fatal */
    }
  }

  async setVolume(v: number): Promise<void> {
    try {
      await this.player?.setVolume(Math.min(1, Math.max(0, v)));
    } catch {
      /* non-fatal */
    }
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

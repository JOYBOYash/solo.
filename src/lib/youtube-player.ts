// Official YouTube IFrame Player bridge.
//
// YouTube audio lives inside a cross-origin iframe, exactly like Spotify's SDK.
// Solo therefore drives the duet with the player's official volume control and
// records Studio takes with tab audio. The player stays visible in the room, as
// YouTube's terms require.

import type {
  MusicSource,
  PlaybackState,
  PlaybackTrack,
  PlayerError,
  SoloPlayer,
  YouTubeTrack,
} from './playback';

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(percent: number): void;
  getVolume(): number;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  loadVideoById(videoId: string): void;
  destroy(): void;
}

interface YTStateChangeEvent {
  data: number;
}

interface YTErrorEvent {
  data: number;
}

interface YTNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      videoId?: string;
      width?: string | number;
      height?: string | number;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: () => void;
        onStateChange?: (event: YTStateChangeEvent) => void;
        onError?: (event: YTErrorEvent) => void;
      };
    },
  ) => YTPlayer;
  PlayerState: {
    UNSTARTED: number;
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
    BUFFERING: number;
    CUED: number;
  };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
};

let apiPromise: Promise<YTNamespace> | null = null;

function loadIframeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  const promise = new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error('YouTube loaded without a player API.'));
    };

    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      apiPromise = null;
      reject(new Error('Could not load the YouTube player. Check your connection or content blocker.'));
    };
    document.head.append(script);
  });

  apiPromise = promise;
  void promise.catch(() => {
    if (apiPromise === promise) apiPromise = null;
  });
  return promise;
}

function toPlaybackTrack(track: YouTubeTrack): PlaybackTrack {
  return {
    uri: `youtube:${track.id}`,
    id: track.id,
    name: track.name,
    artists: [{ name: track.artist }],
    album: {
      name: 'YouTube',
      images: track.artworkUrl ? [{ url: track.artworkUrl }] : [],
    },
    duration_ms: track.durationMs || undefined,
  };
}

function clampIndex(index: number, length: number): number {
  if (!length) return 0;
  return Math.min(length - 1, Math.max(0, index));
}

export class YouTubePlayer implements SoloPlayer {
  readonly kind: MusicSource = 'youtube';

  onState: ((state: PlaybackState) => void) | null = null;
  onError: ((error: PlayerError) => void) | null = null;
  onDeviceReady: (() => void) | null = null;
  onDeviceLost: (() => void) | null = null;

  private readonly host: HTMLElement;
  private player: YTPlayer | null = null;
  private queue: YouTubeTrack[] = [];
  private index = 0;
  private polling = 0;
  private ready = false;
  private connecting: Promise<void> | null = null;
  private disposed = false;
  private lastErrorAt = 0;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  loadQueue(tracks: YouTubeTrack[], startIndex: number): void {
    this.queue = [...tracks];
    this.index = clampIndex(startIndex, this.queue.length);
  }

  async connect(): Promise<void> {
    if (this.ready) return;
    if (this.connecting) return this.connecting;
    const attempt = this.connectInternal();
    this.connecting = attempt;
    try {
      await attempt;
    } finally {
      if (this.connecting === attempt) this.connecting = null;
    }
  }

  private async connectInternal(): Promise<void> {
    if (this.disposed) throw new Error('This room is closed.');
    const current = this.queue[this.index];
    if (!current) throw new Error('Nothing is queued to play.');

    const YT = await loadIframeApi();
    if (this.disposed) return;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        fn();
      };
      const timeout = window.setTimeout(() => {
        finish(() =>
          reject(new Error('YouTube took too long to start. Check your connection and try again.')),
        );
      }, 20000);

      try {
        this.player = new YT.Player(this.host, {
          videoId: current.id,
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            fs: 0,
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              if (this.disposed) {
                this.player?.destroy();
                this.player = null;
                finish(() => reject(new Error('This room is closed.')));
                return;
              }
              this.ready = true;
              this.player?.setVolume(100);
              this.startPolling();
              this.emit();
              this.onDeviceReady?.();
              this.player?.playVideo();
              finish(resolve);
            },
            onStateChange: (event) => this.handleState(event.data),
            onError: (event) => this.handleError(event.data),
          },
        });
      } catch (err) {
        finish(() =>
          reject(
            err instanceof Error
              ? err
              : new Error('The YouTube player could not be created.'),
          ),
        );
      }
    });
  }

  activate(): void {
    // YouTube starts from the click that opened the room. The room's Play
    // button remains the fallback when a browser blocks autoplay.
  }

  async togglePlay(): Promise<void> {
    if (!this.player) return;
    if (this.isPaused()) this.player.playVideo();
    else this.player.pauseVideo();
  }

  async pause(): Promise<void> {
    this.player?.pauseVideo();
    this.emit();
  }

  async resume(): Promise<void> {
    this.player?.playVideo();
  }

  async seek(ms: number): Promise<void> {
    this.player?.seekTo(Math.max(0, ms) / 1000, true);
    this.emit();
  }

  async next(): Promise<void> {
    if (this.index < this.queue.length - 1) {
      this.index += 1;
      this.loadCurrent();
      return;
    }
    this.player?.pauseVideo();
    this.emit();
  }

  async previous(): Promise<void> {
    if (!this.player) return;
    if (this.player.getCurrentTime() > 3 || this.index <= 0) {
      this.player.seekTo(0, true);
      return;
    }
    this.index -= 1;
    this.loadCurrent();
  }

  async setVolume(v: number): Promise<void> {
    this.player?.setVolume(Math.round(Math.min(1, Math.max(0, v)) * 100));
  }

  disconnect(): void {
    this.disposed = true;
    this.ready = false;
    if (this.polling) {
      window.clearInterval(this.polling);
      this.polling = 0;
    }
    try {
      this.player?.destroy();
    } catch {
      /* already gone */
    }
    this.player = null;
    this.onDeviceLost?.();
  }

  private isPaused(): boolean {
    if (!this.player) return true;
    const state = this.player.getPlayerState();
    return state !== STATE.PLAYING && state !== STATE.BUFFERING;
  }

  private loadCurrent(): void {
    const track = this.queue[this.index];
    if (!track || !this.player) return;
    this.player.loadVideoById(track.id);
    this.emit();
  }

  private startPolling(): void {
    if (this.polling) return;
    this.polling = window.setInterval(() => {
      if (!this.ready || !this.player || this.disposed) return;
      this.emit();
    }, 400);
  }

  private handleState(state: number): void {
    if (state === STATE.ENDED) {
      void this.next();
      return;
    }
    this.emit();
  }

  private handleError(code: number): void {
    const now = performance.now();
    if (now - this.lastErrorAt < 1200) return;
    this.lastErrorAt = now;

    if ((code === 100 || code === 101 || code === 150) && this.index < this.queue.length - 1) {
      this.onError?.({
        kind: 'playback',
        message: 'That video cannot be embedded. Skipping to the next song.',
      });
      this.index += 1;
      this.loadCurrent();
      return;
    }

    const message =
      code === 101 || code === 150
        ? 'The owner does not allow this video to be embedded. Pick another song.'
        : code === 100
          ? 'That video is private or unavailable. Pick another song.'
          : code === 2
            ? 'YouTube did not recognise that video. Pick another song.'
            : 'The YouTube player reported an error. Press Play or pick another song.';
    this.onError?.({ kind: 'playback', message });
  }

  private emit(): void {
    if (!this.player || !this.ready) return;
    const track = this.queue[this.index];
    if (!track) return;

    const duration = Math.max(
      0,
      this.player.getDuration() * 1000 || track.durationMs,
    );
    const state = this.player.getPlayerState();
    const paused = state !== STATE.PLAYING && state !== STATE.BUFFERING;
    const position = Math.max(0, this.player.getCurrentTime() * 1000);

    this.onState?.({
      position: Math.min(position, duration || position),
      duration,
      paused,
      updatedAt: performance.now(),
      track: toPlaybackTrack(track),
      nextTracks: this.queue
        .slice(this.index + 1, this.index + 4)
        .map(toPlaybackTrack),
    });
  }
}

// Plays Audius streams and local files through a single <audio> element that is
// wired into the Web Audio API. Unlike Spotify's DRM iframe, this audio can be
// analysed, ducked with a GainNode, and captured for Studio takes.
//
// The graph is:
//
//   <audio> -> MediaElementSource -> Gain (duet volume) -> Analyser -> speakers
//                                                         └─────────> MediaStream
//                                                                     (recorder)

import type {
  FreeTrack,
  PlaybackState,
  PlaybackTrack,
  SoloPlayer,
} from './playback';
import { detectPitch } from './mic';

const AUDIUS_STREAM = 'https://api.audius.co/v1/tracks';

function clampIndex(index: number, length: number): number {
  if (!length) return 0;
  return Math.min(length - 1, Math.max(0, index));
}

function trackUri(track: FreeTrack): string {
  return `solo:${track.source}:${track.id}`;
}

function toPlaybackTrack(track: FreeTrack): PlaybackTrack {
  return {
    uri: trackUri(track),
    id: track.id,
    name: track.name,
    artists: [{ name: track.artist }],
    album: {
      name: track.source === 'audius' ? 'Audius' : 'Local files',
      images: track.artworkUrl ? [{ url: track.artworkUrl }] : [],
    },
    duration_ms: track.durationMs || undefined,
  };
}

export class InlinePlayer implements SoloPlayer {
  readonly inline = true;

  onState: ((state: PlaybackState) => void) | null = null;
  onError: ((error: { kind: 'init' | 'auth' | 'account' | 'playback'; message: string }) => void) | null = null;
  onDeviceReady: (() => void) | null = null;
  onDeviceLost: (() => void) | null = null;

  private readonly audio = new Audio();
  private queue: FreeTrack[] = [];
  private index = 0;
  private objectUrl: string | null = null;
  private volume = 1;
  /** One retry with Audius's stable stream endpoint when a signed URL expires. */
  private streamFallback = false;

  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private streamDestination: MediaStreamAudioDestinationNode | null = null;
  private waveBuf: Float32Array<ArrayBuffer> = new Float32Array(0);
  private lastPitch: number | null = null;
  private lastPitchAt = 0;
  private disposed = false;

  constructor() {
    this.audio.preload = 'auto';
    this.audio.crossOrigin = 'anonymous';
    this.audio.addEventListener('loadedmetadata', () => this.emit());
    this.audio.addEventListener('durationchange', () => this.emit());
    this.audio.addEventListener('timeupdate', () => this.emit());
    this.audio.addEventListener('play', () => this.emit());
    this.audio.addEventListener('pause', () => this.emit());
    this.audio.addEventListener('seeked', () => this.emit());
    this.audio.addEventListener('ended', () => this.handleEnded());
    this.audio.addEventListener('error', () => this.handleAudioError());
  }

  connect(): Promise<unknown> {
    this.activate();
    return Promise.resolve();
  }

  loadQueue(tracks: FreeTrack[], startIndex: number): void {
    this.queue = tracks.filter((track) => track.source === 'audius' ? Boolean(track.streamUrl) : Boolean(track.file));
    this.index = clampIndex(startIndex, this.queue.length);
    this.loadCurrent(false);
  }

  get currentTrack(): FreeTrack | null {
    return this.queue[this.index] ?? null;
  }

  /** Call inside a user gesture so the AudioContext can start immediately. */
  activate(): void {
    const ctx = this.ensureGraph();
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  }

  async togglePlay(): Promise<void> {
    if (this.audio.paused) await this.resume();
    else await this.pause();
  }

  async pause(): Promise<void> {
    this.audio.pause();
  }

  async resume(): Promise<void> {
    const ctx = this.ensureGraph();
    if (ctx?.state === 'suspended') await ctx.resume().catch(() => undefined);
    try {
      await this.audio.play();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        this.onError?.({
          kind: 'playback',
          message: 'The browser blocked playback — press Play to start the song.',
        });
      } else {
        this.onError?.({ kind: 'playback', message: 'This song could not be played. Try another track.' });
      }
      this.emit();
    }
  }

  async seek(ms: number): Promise<void> {
    const duration = Number.isFinite(this.audio.duration) ? this.audio.duration : null;
    const seconds = Math.max(0, ms / 1000);
    this.audio.currentTime = duration ? Math.min(duration, seconds) : seconds;
  }

  async next(): Promise<void> {
    if (this.index >= this.queue.length - 1) {
      this.audio.pause();
      return;
    }
    this.index += 1;
    this.loadCurrent(true);
  }

  async previous(): Promise<void> {
    // Match familiar transport behaviour: restart the song first.
    if (this.audio.currentTime > 3 || this.index === 0) {
      this.audio.currentTime = 0;
      return;
    }
    this.index -= 1;
    this.loadCurrent(true);
  }

  async setVolume(v: number): Promise<void> {
    this.volume = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
    if (this.gain) this.gain.gain.value = this.volume;
  }

  getMusicAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  getMusicStream(): MediaStream | null {
    this.ensureGraph();
    return this.streamDestination?.stream ?? null;
  }

  copyMusicWaveform(out: Float32Array): boolean {
    if (!this.analyser) return false;
    if (this.waveBuf.length !== this.analyser.fftSize) {
      this.waveBuf = new Float32Array(this.analyser.fftSize);
    }
    this.analyser.getFloatTimeDomainData(this.waveBuf);
    const n = Math.min(out.length, this.waveBuf.length);
    out.set(this.waveBuf.subarray(0, n));
    for (let i = n; i < out.length; i++) out[i] = 0;
    return true;
  }

  musicRms(): number {
    if (!this.analyser) return 0;
    if (this.waveBuf.length !== this.analyser.fftSize) {
      this.waveBuf = new Float32Array(this.analyser.fftSize);
    }
    this.analyser.getFloatTimeDomainData(this.waveBuf);
    let sum = 0;
    for (const sample of this.waveBuf) sum += sample * sample;
    return Math.sqrt(sum / this.waveBuf.length);
  }

  /** Fundamental of the song, throttled for the Studio pitch guide. */
  musicPitch(): number | null {
    if (!this.analyser || !this.ctx) return null;
    const now = performance.now();
    if (now - this.lastPitchAt < 90) return this.lastPitch;
    this.lastPitchAt = now;

    if (this.waveBuf.length !== this.analyser.fftSize) {
      this.waveBuf = new Float32Array(this.analyser.fftSize);
    }
    this.analyser.getFloatTimeDomainData(this.waveBuf);
    let sum = 0;
    for (const sample of this.waveBuf) sum += sample * sample;
    const rms = Math.sqrt(sum / this.waveBuf.length);
    this.lastPitch =
      rms > 0.002
        ? detectPitch(this.waveBuf, this.ctx.sampleRate, 0.0015, 0.42)
        : null;
    return this.lastPitch;
  }

  disconnect(): void {
    this.disposed = true;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.revokeObjectUrl();
    this.queue = [];
    this.index = 0;
    this.gain = null;
    this.analyser = null;
    this.streamDestination = null;
    this.waveBuf = new Float32Array(0);
    this.lastPitch = null;
    this.lastPitchAt = 0;
    if (this.ctx) {
      const ctx = this.ctx;
      this.ctx = null;
      void ctx.close().catch(() => undefined);
    }
  }

  private ensureGraph(): AudioContext | null {
    if (this.disposed) return null;
    if (this.ctx) return this.ctx;

    const ctx = new AudioContext({ latencyHint: 'interactive' });
    const source = ctx.createMediaElementSource(this.audio);
    const gain = ctx.createGain();
    gain.gain.value = this.volume;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.6;
    const streamDestination = ctx.createMediaStreamDestination();

    source.connect(gain);
    gain.connect(analyser);
    analyser.connect(ctx.destination);
    analyser.connect(streamDestination);

    this.ctx = ctx;
    this.gain = gain;
    this.analyser = analyser;
    this.streamDestination = streamDestination;
    return ctx;
  }

  private loadCurrent(autoplay: boolean): void {
    const track = this.currentTrack;
    if (!track) {
      this.emit();
      return;
    }

    this.revokeObjectUrl();
    this.lastPitch = null;
    this.lastPitchAt = 0;
    this.streamFallback = false;

    if (track.source === 'local') {
      if (!track.file) {
        this.onError?.({ kind: 'playback', message: 'That local file is no longer available.' });
        return;
      }
      this.objectUrl = URL.createObjectURL(track.file);
      this.audio.src = this.objectUrl;
    } else {
      this.audio.src =
        track.streamUrl ||
        `${AUDIUS_STREAM}/${encodeURIComponent(track.id)}/stream?app_name=Solo`;
    }
    this.audio.load();
    this.emit();
    if (autoplay) void this.resume();
  }

  private handleEnded(): void {
    if (this.index < this.queue.length - 1) {
      this.index += 1;
      this.loadCurrent(true);
    } else {
      this.emit();
    }
  }

  private handleAudioError(): void {
    if (!this.audio.getAttribute('src')) return;
    const track = this.currentTrack;
    // Audius stream URLs can expire. The stable endpoint redirects to a fresh
    // signed URL, so retry once before giving up on the song.
    if (track?.source === 'audius' && !this.streamFallback) {
      this.streamFallback = true;
      this.audio.src = `${AUDIUS_STREAM}/${encodeURIComponent(track.id)}/stream?app_name=Solo`;
      this.audio.load();
      void this.resume();
      return;
    }
    this.emit();
    this.onError?.({
      kind: 'playback',
      message:
        'This song could not be streamed. Audius tracks occasionally expire — pick another track or try again.',
    });
  }

  private revokeObjectUrl(): void {
    if (!this.objectUrl) return;
    URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  private emit(): void {
    const track = this.currentTrack;
    if (!track) return;

    const duration = Number.isFinite(this.audio.duration)
      ? this.audio.duration * 1000
      : track.durationMs;
    const position = Number.isFinite(this.audio.currentTime)
      ? this.audio.currentTime * 1000
      : 0;

    this.onState?.({
      position,
      duration: Math.max(0, duration),
      paused: this.audio.paused,
      updatedAt: performance.now(),
      track: toPlaybackTrack(track),
      nextTracks: this.queue.slice(this.index + 1, this.index + 4).map(toPlaybackTrack),
    });
  }
}

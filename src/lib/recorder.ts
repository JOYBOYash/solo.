// Studio recorder: captures the singer's microphone and the song into a single
// mixed take, then saves it to the device.
//
// Both Spotify and YouTube render audio inside cross-origin iframes, so
// `getDisplayMedia` with tab audio is the only supported way to include the
// song. Chrome/Edge on desktop can capture "This tab".
//
// The mix is built with Web Audio (mic + song -> MediaStreamDestination) and
// encoded with MediaRecorder. No audio is ever uploaded anywhere.

import { detectPitch } from './mic';

export type RecorderPhase =
  | 'idle'
  | 'requesting'
  | 'recording'
  | 'finalizing'
  | 'saved'
  | 'error';

export interface RecordingResult {
  url: string;
  filename: string;
  durationMs: number;
  mimeType: string;
  size: number;
}

export interface RecorderStatus {
  phase: RecorderPhase;
  elapsedMs: number;
  result: RecordingResult | null;
  message?: string;
}

/** MediaRecorder plus desktop tab capture are both required. */
export function recorderSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    typeof AudioContext !== 'undefined' &&
    !!navigator.mediaDevices?.getDisplayMedia
  );
}

export function canRecordSource(): boolean {
  return recorderSupported();
}

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

function pickMime(): string {
  for (const mime of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    } catch {
      /* unsupported candidate */
    }
  }
  return '';
}

function extensionFor(mime: string): string {
  const lower = mime.toLowerCase();
  if (lower.includes('mp4') || lower.includes('m4a') || lower.includes('aac')) {
    return 'm4a';
  }
  if (lower.includes('ogg')) return 'ogg';
  return 'webm';
}

function safeFilename(raw: string): string {
  return (
    raw
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 90) || 'Solo take'
  );
}

function timestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

function autoDownload(result: RecordingResult): void {
  const link = document.createElement('a');
  link.href = result.url;
  link.download = result.filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
}

function describeDisplayError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
      return 'Recording was cancelled. Choose “This tab” and switch on “Share tab audio”.';
    }
    if (err.name === 'NotSupportedError') {
      return 'This browser cannot capture tab audio. Use Chrome or Edge on desktop.';
    }
  }
  return 'The tab-audio capture could not start. Choose “This tab” and enable “Share tab audio”.';
}

export class StudioRecorder {
  onStatus: ((status: RecorderStatus) => void) | null = null;

  private phaseValue: RecorderPhase = 'idle';
  private result: RecordingResult | null = null;
  private errorMessage = '';
  private label = 'Solo take';

  private displayStream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private recorder: MediaRecorder | null = null;
  private recorderMime = 'audio/webm';
  private chunks: BlobPart[] = [];
  private musicAnalyser: AnalyserNode | null = null;
  private musicBuf: Float32Array<ArrayBuffer> = new Float32Array(0);
  private lastMusicPitch: number | null = null;
  private lastMusicPitchAt = 0;

  private startedAt = 0;
  private timer = 0;
  private stopTimer = 0;
  private finalized = true;
  private disposed = false;
  private cancelAfterStart = false;
  private downloadOnFinish = true;
  private pendingResolve: ((result: RecordingResult | null) => void) | null = null;
  private finishPromise: Promise<RecordingResult | null> | null = null;

  get phase(): RecorderPhase {
    return this.phaseValue;
  }

  get currentResult(): RecordingResult | null {
    return this.result;
  }

  get isRecording(): boolean {
    return this.phaseValue === 'recording';
  }

  /** Used for the take's filename; safe characters only. */
  setLabel(title: string, artists: string[]): void {
    const artist = artists[0]?.trim();
    this.label = safeFilename(artist ? `${title} - ${artist}` : title);
  }

  async start(micStream: MediaStream): Promise<void> {
    if (this.disposed) throw new Error('This Studio session is closed.');
    if (
      this.phaseValue === 'requesting' ||
      this.phaseValue === 'recording' ||
      this.phaseValue === 'finalizing'
    ) {
      return;
    }
    if (
      !micStream ||
      !micStream.getAudioTracks().some((track) => track.readyState === 'live')
    ) {
      throw new Error('The microphone is not available. Allow mic access, then try again.');
    }

    this.errorMessage = '';
    this.cancelAfterStart = false;
    this.phaseValue = 'requesting';
    this.emit();

    let display: MediaStream | null = null;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        surfaceSwitching: 'exclude',
        systemAudio: 'include',
      } as DisplayMediaStreamOptions);
    } catch (err) {
      this.errorMessage = describeDisplayError(err);
      this.phaseValue = 'error';
      this.emit();
      throw new Error(this.errorMessage);
    }

    if (this.disposed || this.cancelAfterStart) {
      display?.getTracks().forEach((track) => track.stop());
      this.teardown();
      this.phaseValue = 'idle';
      this.emit();
      return;
    }

    if (!display?.getAudioTracks().length) {
      display?.getTracks().forEach((track) => track.stop());
      this.teardown();
      this.errorMessage =
        'No song audio was shared. Pick “This tab” and switch on “Share tab audio”.';
      this.phaseValue = 'error';
      this.emit();
      throw new Error(this.errorMessage);
    }

    this.displayStream = display;
    this.chunks = [];
    this.finalized = false;
    this.finishPromise = null;
    this.pendingResolve = null;
    this.stopTimer = 0;
    this.downloadOnFinish = true;

    try {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      this.ctx = ctx;
      const destination = ctx.createMediaStreamDestination();

      const micSource = ctx.createMediaStreamSource(micStream);
      const micGain = ctx.createGain();
      micGain.gain.value = 1;

      const songStream = new MediaStream(display.getAudioTracks());
      const songSource = ctx.createMediaStreamSource(songStream);
      const songGain = ctx.createGain();
      songGain.gain.value = 1;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.6;
      this.musicAnalyser = analyser;
      this.musicBuf = new Float32Array(analyser.fftSize);

      // A gentle limiter keeps a loud singer plus the song from clipping the
      // saved mix without changing how the duet sounds live.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.25;

      songSource.connect(songGain);
      songGain.connect(analyser);
      songGain.connect(limiter);
      micSource.connect(micGain);
      micGain.connect(limiter);
      limiter.connect(destination);

      await ctx.resume();
      if (this.disposed || this.cancelAfterStart) {
        this.teardown();
        this.phaseValue = 'idle';
        this.emit();
        return;
      }

      const mime = pickMime();
      const options: MediaRecorderOptions = {
        audioBitsPerSecond: 192000,
        ...(mime ? { mimeType: mime } : {}),
      };
      const recorder = new MediaRecorder(destination.stream, options);
      this.recorder = recorder;
      this.recorderMime = recorder.mimeType || mime || 'audio/webm';

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size) this.chunks.push(event.data);
      };
      recorder.onerror = (event: Event) => {
        const detail = (event as unknown as { error?: DOMException }).error;
        this.errorMessage =
          detail?.message || 'The browser stopped the recording unexpectedly.';
        void this.stop({ download: true });
      };
      recorder.onstop = () => this.finalize();

      this.startedAt = performance.now();
      recorder.start(1000);
      this.phaseValue = 'recording';
      this.emit();
      if (this.timer) window.clearInterval(this.timer);
      this.timer = window.setInterval(() => {
        if (this.phaseValue === 'recording') this.emit();
      }, 250);

      const video = display?.getVideoTracks()[0];
      const audio = display?.getAudioTracks()[0];
      video?.addEventListener('ended', () => this.shareEnded());
      audio?.addEventListener('ended', () => this.shareEnded());
    } catch (err) {
      this.errorMessage =
        err instanceof Error
          ? err.message
          : 'The recording mix could not be created.';
      this.teardown();
      this.phaseValue = 'error';
      this.emit();
      throw new Error(this.errorMessage);
    }
  }

  /**
   * Stop and finalise the current take. Resolves with the saved take (or null
   * when nothing usable was captured).
   */
  stop(opts?: { download?: boolean }): Promise<RecordingResult | null> {
    this.downloadOnFinish = opts?.download !== false;

    if (this.phaseValue === 'requesting') {
      // getDisplayMedia cannot be aborted; close the capture as soon as the
      // picker resolves.
      this.cancelAfterStart = true;
      return Promise.resolve(null);
    }
    if (this.phaseValue === 'finalizing') {
      return this.finishPromise ?? Promise.resolve(this.result);
    }
    if (this.phaseValue !== 'recording') {
      return Promise.resolve(this.result);
    }

    this.phaseValue = 'finalizing';
    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = 0;
    }
    this.emit();

    this.finishPromise = new Promise<RecordingResult | null>((resolve) => {
      this.pendingResolve = resolve;
    });

    try {
      if (this.recorder && this.recorder.state !== 'inactive') {
        this.recorder.stop();
      } else {
        this.finalize();
      }
    } catch {
      this.finalize();
    }

    // Some browsers can miss the stop event after a tab-capture interruption.
    this.stopTimer = window.setTimeout(() => this.finalize(), 4000);
    return this.finishPromise;
  }

  /** Re-download the most recent take without starting a new recording. */
  downloadLast(): void {
    if (this.result) autoDownload(this.result);
  }

  /** Copy the captured tab audio for the Studio waveform. */
  copyMusicWaveform(out: Float32Array): boolean {
    if (!this.musicAnalyser) return false;
    this.musicAnalyser.getFloatTimeDomainData(this.musicBuf);
    const n = Math.min(out.length, this.musicBuf.length);
    out.set(this.musicBuf.subarray(0, n));
    for (let i = n; i < out.length; i++) out[i] = 0;
    return true;
  }

  /** RMS of the captured song audio, used to detect a silent tab capture. */
  musicRms(): number {
    if (!this.musicAnalyser) return 0;
    this.musicAnalyser.getFloatTimeDomainData(this.musicBuf);
    let sum = 0;
    for (const sample of this.musicBuf) sum += sample * sample;
    return Math.sqrt(sum / this.musicBuf.length);
  }

  /**
   * Detected fundamental of the captured song audio, throttled to ~11 Hz. The
   * Studio pitch ribbon uses this to show how the singer's note sits against
   * the song. Only available while a take is running (tab audio is captured
   * by the recorder).
   */
  musicPitch(): number | null {
    if (!this.musicAnalyser) return null;
    const now = performance.now();
    if (now - this.lastMusicPitchAt < 90) return this.lastMusicPitch;
    this.lastMusicPitchAt = now;
    this.musicAnalyser.getFloatTimeDomainData(this.musicBuf);
    let sum = 0;
    for (const sample of this.musicBuf) sum += sample * sample;
    const rms = Math.sqrt(sum / this.musicBuf.length);
    this.lastMusicPitch =
      rms > 0.002
        ? detectPitch(this.musicBuf, this.musicAnalyser.context.sampleRate, 0.0015, 0.42)
        : null;
    return this.lastMusicPitch;
  }

  /** Called when the room closes; an in-flight take is still saved. */
  dispose(): void {
    this.disposed = true;
    if (this.phaseValue === 'requesting') {
      this.cancelAfterStart = true;
      return;
    }
    if (this.phaseValue === 'recording' || this.phaseValue === 'finalizing') {
      void this.stop();
      return;
    }
    this.teardown();
    if (this.result) {
      URL.revokeObjectURL(this.result.url);
      this.result = null;
    }
  }

  private shareEnded(): void {
    if (this.phaseValue === 'recording') {
      // The user stopped sharing from the browser bar: keep the audio captured
      // so far instead of throwing the take away.
      void this.stop();
    }
  }

  private finalize(): void {
    if (this.finalized) return;
    this.finalized = true;
    if (this.stopTimer) {
      window.clearTimeout(this.stopTimer);
      this.stopTimer = 0;
    }
    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = 0;
    }

    const durationMs = Math.max(0, performance.now() - this.startedAt);
    const chunks = this.chunks;
    this.chunks = [];
    const failed = this.errorMessage;
    this.teardown();

    let result: RecordingResult | null = null;
    if (!failed && chunks.length) {
      const blob = new Blob(chunks, { type: this.recorderMime });
      if (blob.size > 0) {
        if (this.result) URL.revokeObjectURL(this.result.url);
        const ext = extensionFor(this.recorderMime);
        result = {
          url: URL.createObjectURL(blob),
          filename: `Solo - ${this.label} - ${timestamp()}.${ext}`,
          durationMs,
          mimeType: this.recorderMime,
          size: blob.size,
        };
        this.result = result;
      }
    }

    if (result) {
      this.phaseValue = 'saved';
      this.emit();
      if (this.downloadOnFinish) autoDownload(result);
    } else {
      this.errorMessage =
        failed || 'No audio was captured. Try again.';
      this.phaseValue = 'error';
      this.emit();
    }

    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    this.finishPromise = null;
    resolve?.(result);

    if (this.disposed && this.result) {
      const url = this.result.url;
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
  }

  private teardown(): void {
    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = 0;
    }
    if (this.stopTimer) {
      window.clearTimeout(this.stopTimer);
      this.stopTimer = 0;
    }
    this.displayStream?.getTracks().forEach((track) => track.stop());
    this.displayStream = null;
    if (this.ctx) {
      const ctx = this.ctx;
      this.ctx = null;
      void ctx.close().catch(() => {
        /* already closed */
      });
    }
    this.recorder = null;
    this.musicAnalyser = null;
    this.musicBuf = new Float32Array(0);
    this.lastMusicPitch = null;
    this.lastMusicPitchAt = 0;
  }

  private emit(): void {
    const elapsedMs =
      this.phaseValue === 'recording' || this.phaseValue === 'finalizing'
        ? Math.max(0, performance.now() - this.startedAt)
        : this.result?.durationMs ?? 0;
    this.onStatus?.({
      phase: this.phaseValue,
      elapsedMs,
      result: this.result,
      message: this.errorMessage || undefined,
    });
  }
}

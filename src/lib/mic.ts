// Microphone monitor: listens through getUserMedia, measures loudness and
// spectral balance, and decides whether the user is singing right now.
//
// Chrome's echo cancellation (enabled here) uses the tab's own audio output as
// a far-end reference, which substantially suppresses the song playing through
// the Web Playback SDK — leaving mostly the user's voice. Headphones make this
// perfect; without them the sensitivity slider helps.

export interface MicState {
  /** Smoothed input level, 0..1, for the meter. */
  level: number;
  /** True while the detector considers the user to be singing (with hold-over). */
  voiced: boolean;
  /** Detected fundamental frequency when voiced, else null. */
  pitchHz: number | null;
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export function describePitch(hz: number): string {
  const midi = 69 + 12 * Math.log2(hz / 440);
  const rounded = Math.round(midi);
  const name = NOTE_NAMES[((rounded % 12) + 12) % 12];
  const octave = Math.floor(rounded / 12) - 1;
  return `${name}${octave} · ${Math.round(hz)} Hz`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MicMonitor {
  onState: ((state: MicState) => void) | null = null;

  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private raf = 0;
  private frame = 0;
  private timeBuf: Float32Array<ArrayBuffer> = new Float32Array(0);
  private freqBuf: Uint8Array<ArrayBuffer> = new Uint8Array(0);

  /** Room noise level captured during calibration. */
  noiseFloor = 0.008;
  /** 0.5 = stricter, 2 = picks up quiet singers more readily. */
  sensitivity = 1;

  private lastVoiceAt = 0;
  private voiced = false;
  private level = 0;
  private pitchHz: number | null = null;
  private calibrating = false;

  get running(): boolean {
    return this.ctx !== null;
  }

  async start(): Promise<void> {
    if (this.ctx) return;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.stream = stream;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      this.analyser = analyser;
      this.timeBuf = new Float32Array(analyser.fftSize);
      this.freqBuf = new Uint8Array(analyser.frequencyBinCount);
      await ctx.resume();
      this.loop();
    } catch (err) {
      // Never leave a microphone track recording after a failed start.
      stream?.getTracks().forEach((t) => t.stop());
      this.stop();
      throw err;
    }
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.stream = null;
    this.ctx = null;
    this.analyser = null;
    this.voiced = false;
    this.level = 0;
    this.pitchHz = null;
  }

  /** Sample the room for a moment to establish the noise floor. Call while quiet. */
  async calibrate(ms = 1600): Promise<void> {
    if (!this.ctx) throw new Error('Start the microphone before calibrating.');
    this.calibrating = true;
    const samples: number[] = [];
    const started = performance.now();
    while (performance.now() - started < ms) {
      samples.push(this.rawRms());
      await sleep(25);
    }
    this.calibrating = false;
    samples.sort((a, b) => a - b);
    if (samples.length) {
      // A quiet percentile is more robust than the mean against one-off bumps.
      this.noiseFloor = Math.max(0.002, samples[Math.floor(samples.length * 0.25)]);
    }
  }

  private rawRms(): number {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.timeBuf);
    let sum = 0;
    for (const x of this.timeBuf) sum += x * x;
    return Math.sqrt(sum / this.timeBuf.length);
  }

  private loop(): void {
    const ctx = this.ctx;
    const analyser = this.analyser;
    if (!ctx || !analyser) return;
    this.raf = requestAnimationFrame(() => this.loop());
    if (this.calibrating) return;

    this.frame++;
    const rms = this.rawRms();
    analyser.getByteFrequencyData(this.freqBuf);

    // Voice band ratio: singing lives mostly between ~250 Hz and ~3.4 kHz.
    const binHz = ctx.sampleRate / analyser.fftSize;
    const lowBin = Math.max(1, Math.floor(250 / binHz));
    const voiceTopBin = Math.min(this.freqBuf.length - 1, Math.ceil(3400 / binHz));
    const allTopBin = Math.min(this.freqBuf.length - 1, Math.ceil(12000 / binHz));
    let voiceEnergy = 0;
    for (let i = lowBin; i <= voiceTopBin; i++) voiceEnergy += this.freqBuf[i] ** 2;
    let allEnergy = 0;
    for (let i = lowBin; i <= allTopBin; i++) allEnergy += this.freqBuf[i] ** 2;
    const ratio = allEnergy > 0 ? voiceEnergy / allEnergy : 0;

    // Detector with hold-over: quick to engage, slower to release.
    const threshold = Math.max(this.noiseFloor * 3.2, 0.011) / this.sensitivity;
    const now = performance.now();
    if (rms > threshold && ratio > 0.4) {
      this.lastVoiceAt = now;
    }
    this.voiced = now - this.lastVoiceAt < 650 && rms > threshold * 0.4;

    // Meter: perceptual-ish mapping of rms to 0..1.
    const target = Math.min(1, Math.pow(rms / 0.22, 0.6));
    this.level += (target - this.level) * 0.35;

    if (this.voiced && this.frame % 4 === 0) {
      this.pitchHz = detectPitch(this.timeBuf, ctx.sampleRate);
    } else if (!this.voiced) {
      this.pitchHz = null;
    }

    this.onState?.({ level: this.level, voiced: this.voiced, pitchHz: this.pitchHz });
  }
}

/**
 * Bounded normalized autocorrelation pitch detector (70 Hz – 1 kHz).
 * Runs on a decimated copy of the frame to stay cheap.
 */
function detectPitch(buf: Float32Array, sampleRate: number): number | null {
  const decimation = 2;
  const sr = sampleRate / decimation;
  const n = Math.floor(buf.length / decimation);
  if (n < 256) return null;

  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = buf[i * decimation];

  let rms = 0;
  for (const v of x) rms += v * v;
  rms = Math.sqrt(rms / n);
  if (rms < 0.01) return null;

  const minLag = Math.max(2, Math.floor(sr / 1000));
  const maxLag = Math.min(n - 256, Math.ceil(sr / 70));
  let bestLag = -1;
  let bestVal = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    let energyA = 0;
    let energyB = 0;
    for (let i = 0; i + lag < n; i++) {
      sum += x[i] * x[i + lag];
      energyA += x[i] * x[i];
      energyB += x[i + lag] * x[i + lag];
    }
    const norm = Math.sqrt(energyA * energyB);
    const value = norm > 0 ? sum / norm : 0;
    if (value > bestVal) {
      bestVal = value;
      bestLag = lag;
    }
  }

  if (bestLag > 0 && bestVal > 0.55) return sr / bestLag;
  return null;
}

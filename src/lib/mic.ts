// Microphone monitor: listens through getUserMedia, measures loudness and
// spectral balance, and decides whether the user is singing right now.
//
// Browser echo cancellation uses the tab's own output as a far-end reference,
// which substantially suppresses the song playing through the Web Playback SDK
// — leaving mostly the user's voice. The detector is deliberately sensitive to
// quiet singers: it learns the room's noise floor, uses hysteresis, and accepts
// either voice-band energy or a plausible sung pitch as evidence.
//
// Headphones still give the cleanest separation; on speakers, Manual mode is
// the reliable fallback.

export interface MicState {
  /** Smoothed input level, 0..1, for the meter and visualiser. */
  level: number;
  /** True while the detector considers the user to be singing (with hold-over). */
  voiced: boolean;
  /** Detected fundamental frequency when voiced, else null. */
  pitchHz: number | null;
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const VOICE_HOLD_MS = 1100;
const WARMUP_MS = 1200;

export function midiFromHz(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

export function noteName(hz: number): string {
  const midi = Math.round(midiFromHz(hz));
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

export function describePitch(hz: number): string {
  return `${noteName(hz)} · ${Math.round(hz)} Hz`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
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
  noiseFloor = 0.004;
  /** 0.5 = stricter, 2 = picks up quiet singers more readily. */
  sensitivity = 1;

  private lastVoiceAt = 0;
  private voiced = false;
  private level = 0;
  private pitchHz: number | null = null;
  private lastPitchGuess: number | null = null;
  private calibrating = false;
  private warmupEndsAt = 0;
  private warmupSamples: number[] = [];
  private starting: Promise<void> | null = null;

  get running(): boolean {
    return this.ctx !== null;
  }

  /** The live microphone stream, shared with the Studio recorder. */
  get mediaStream(): MediaStream | null {
    return this.stream;
  }

  /** Latest detected fundamental, or null when the singer is silent. */
  get pitch(): number | null {
    return this.pitchHz;
  }

  async start(): Promise<void> {
    if (this.ctx) return;
    // A permission prompt can still be open when the room is reopened. Share
    // the in-flight acquisition instead of requesting a second mic stream.
    if (this.starting) return this.starting;
    const pending = this.doStart();
    this.starting = pending;
    try {
      await pending;
    } finally {
      if (this.starting === pending) this.starting = null;
    }
  }

  private async doStart(): Promise<void> {
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      this.ctx = ctx;
      this.stream = stream;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.55;
      source.connect(analyser);
      this.analyser = analyser;
      this.timeBuf = new Float32Array(analyser.fftSize);
      this.freqBuf = new Uint8Array(analyser.frequencyBinCount);
      await ctx.resume();
      this.warmupEndsAt = performance.now() + WARMUP_MS;
      this.warmupSamples = [];
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
    this.lastPitchGuess = null;
    this.calibrating = false;
    this.warmupEndsAt = 0;
    this.warmupSamples = [];
    this.noiseFloor = 0.004;
  }

  /**
   * Sample the room for a moment to establish the noise floor. Ask the singer
   * to stay quiet while this runs.
   */
  async calibrate(ms = 1600): Promise<void> {
    if (!this.ctx) throw new Error('Start the microphone before calibrating.');
    if (this.calibrating) return;
    this.calibrating = true;
    const samples: number[] = [];
    const started = performance.now();
    try {
      while (performance.now() - started < ms) {
        samples.push(this.rawRms());
        await sleep(25);
      }
    } finally {
      this.calibrating = false;
    }
    samples.sort((a, b) => a - b);
    if (samples.length) {
      // A low percentile is more robust than the mean against one-off bumps.
      const quiet = samples[Math.floor(samples.length * 0.25)];
      this.noiseFloor = clamp(quiet, 0.0009, 0.02);
      this.lastVoiceAt = 0;
      this.voiced = false;
    }
  }

  /**
   * Copy the latest time-domain microphone samples into `out`. The Theatre and
   * Studio waveforms use this real signal rather than a decorative animation.
   */
  copyWaveform(out: Float32Array): boolean {
    if (!this.analyser) return false;
    this.analyser.getFloatTimeDomainData(this.timeBuf);
    const n = Math.min(out.length, this.timeBuf.length);
    out.set(this.timeBuf.subarray(0, n));
    for (let i = n; i < out.length; i++) out[i] = 0;
    return true;
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
    const now = performance.now();
    const rms = this.rawRms();
    analyser.getByteFrequencyData(this.freqBuf);

    // The room's quiet percentile is sampled after start-up. The song has not
    // begun yet at this point, so the first second is usually a clean sample.
    if (this.warmupEndsAt > 0) {
      if (now < this.warmupEndsAt) {
        this.warmupSamples.push(rms);
      } else {
        this.warmupEndsAt = 0;
        if (this.warmupSamples.length > 12) {
          const sorted = this.warmupSamples.slice().sort((a, b) => a - b);
          const quiet = sorted[Math.floor(sorted.length * 0.2)];
          // Cap the learned floor: a singer who starts immediately must not
          // teach the detector that their quiet voice is "room noise".
          this.noiseFloor = clamp(quiet, 0.001, 0.012);
        }
        this.warmupSamples = [];
      }
    }

    // Voice band ratio: sung fundamentals and their harmonics live mostly
    // between ~90 Hz and ~3.8 kHz. Comparing that band with the full spectrum
    // rejects broadband hiss and most speaker bleed.
    const binHz = ctx.sampleRate / analyser.fftSize;
    const lowBin = Math.max(1, Math.floor(90 / binHz));
    const voiceTopBin = Math.min(this.freqBuf.length - 1, Math.ceil(3800 / binHz));
    const allTopBin = Math.min(this.freqBuf.length - 1, Math.ceil(10000 / binHz));
    let voiceEnergy = 0;
    for (let i = lowBin; i <= voiceTopBin; i++) voiceEnergy += this.freqBuf[i] ** 2;
    let allEnergy = 0;
    for (let i = lowBin; i <= allTopBin; i++) allEnergy += this.freqBuf[i] ** 2;
    const ratio = allEnergy > 0 ? voiceEnergy / allEnergy : 0;

    const sensitivity = clamp(this.sensitivity, 0.5, 2);
    const onset = Math.max(this.noiseFloor * 1.75, 0.0026) / sensitivity;
    const sustain = Math.max(this.noiseFloor * 1.18, 0.0016) / sensitivity;

    if (this.frame % 3 === 0 && rms > sustain * 0.9) {
      this.lastPitchGuess = detectPitch(
        this.timeBuf,
        ctx.sampleRate,
        Math.max(0.0015, rms * 0.45),
        0.48,
      );
    } else if (rms < sustain * 0.7) {
      this.lastPitchGuess = null;
    }

    const bandEvidence = ratio > 0.26;
    const pitchEvidence =
      this.lastPitchGuess !== null &&
      this.lastPitchGuess > 70 &&
      this.lastPitchGuess < 1100;
    const loudEvidence = rms > onset * 2 && ratio > 0.16;
    const evidence = rms > onset && (bandEvidence || pitchEvidence || loudEvidence);
    if (evidence) this.lastVoiceAt = now;

    // Hysteresis: easy to engage, slower to release, so breaths between
    // phrases do not flip the duet back to the artist mid-line.
    this.voiced = now - this.lastVoiceAt < VOICE_HOLD_MS && rms > sustain;

    // Track the room while it is quiet. Downward moves are quick (a fan
    // switching off); upward moves are very slow so quiet singing cannot
    // gradually be absorbed into the noise floor.
    if (!this.voiced) {
      if (rms < this.noiseFloor) {
        this.noiseFloor += (rms - this.noiseFloor) * 0.2;
      } else if (now - this.lastVoiceAt > VOICE_HOLD_MS) {
        const target = Math.min(rms, this.noiseFloor * 1.5);
        this.noiseFloor += (target - this.noiseFloor) * 0.0006;
      }
      this.noiseFloor = clamp(this.noiseFloor, 0.0009, 0.035);
    }

    // Meter: perceptual-ish mapping of rms to 0..1 with a fast attack and a
    // gentle release, so brief consonants remain visible.
    const target = Math.min(1, Math.pow(rms / 0.16, 0.55));
    this.level += (target - this.level) * (target > this.level ? 0.5 : 0.14);

    this.pitchHz = this.voiced ? this.lastPitchGuess : null;
    this.onState?.({ level: this.level, voiced: this.voiced, pitchHz: this.pitchHz });
  }
}

/**
 * Bounded normalized autocorrelation pitch detector (70 Hz – 1 kHz).
 * Runs on a decimated copy of the frame to stay cheap.
 */
export function detectPitch(
  buf: Float32Array,
  sampleRate: number,
  minRms = 0.01,
  minConfidence = 0.55,
): number | null {
  const decimation = 2;
  const sr = sampleRate / decimation;
  const n = Math.floor(buf.length / decimation);
  if (n < 256) return null;

  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = buf[i * decimation];

  let rms = 0;
  for (const v of x) rms += v * v;
  rms = Math.sqrt(rms / n);
  if (rms < minRms) return null;

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

  if (bestLag > 0 && bestVal > minConfidence) return sr / bestLag;
  return null;
}

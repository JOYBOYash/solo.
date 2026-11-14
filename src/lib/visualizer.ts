// Dual-lane waveform visualiser for Theatre and Studio.
//
// The singer's lane uses the real microphone signal. Spotify's audio lives in
// the SDK's DRM iframe, so its lane uses the real tab-capture signal whenever a
// Studio take is running; otherwise it falls back to a smooth, level-driven
// waveform that follows the duet's actual volume (including ducking).

export interface WaveformReader {
  copy(out: Float32Array): boolean;
}

export interface DuetVisualizerOptions {
  micCanvas: HTMLCanvasElement;
  musicCanvas: HTMLCanvasElement;
  mic: WaveformReader;
  music: WaveformReader;
  micLevel: () => number;
  musicLevel: () => number;
  playing: () => boolean;
  lead: () => 'artist' | 'you';
}

const POINTS = 112;
const MIC_RGB = '30, 215, 96';
const MUSIC_RGB = '255, 255, 255';

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
}

export class DuetVisualizer {
  private raf = 0;
  private active = false;
  private reduceMotion = false;
  private dpr = 1;
  private lastTime = 0;
  private phase = 0;

  private micRaw = new Float32Array(2048);
  private musicRaw = new Float32Array(2048);
  private micSmooth = new Float32Array(POINTS);
  private musicSmooth = new Float32Array(POINTS);

  private resizeObserver: ResizeObserver | null = null;

  constructor(private readonly opts: DuetVisualizerOptions) {}

  start(): void {
    if (this.raf) return;
    this.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.opts.micCanvas);
      this.resizeObserver.observe(this.opts.musicCanvas);
    }
    window.addEventListener('resize', this.onWindowResize);
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener('resize', this.onWindowResize);
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (active) this.resize();
  }

  private onWindowResize = (): void => {
    if (this.active) this.resize();
  };

  private resize(): void {
    this.dpr = Math.min(2.5, window.devicePixelRatio || 1);
    for (const canvas of [this.opts.micCanvas, this.opts.musicCanvas]) {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width * this.dpr));
      const height = Math.max(1, Math.round(rect.height * this.dpr));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    }
  }

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    if (!this.active) return;

    const micCanvas = this.opts.micCanvas;
    if (!micCanvas.isConnected || micCanvas.clientWidth < 2) return;

    const dt = this.lastTime ? Math.min(64, now - this.lastTime) : 16;
    this.lastTime = now;
    if (!this.reduceMotion) this.phase += dt / 1000;

    const playing = this.opts.playing();
    const lead = this.opts.lead();
    this.readMic();
    this.readMusic(playing);
    this.drawLane(this.opts.micCanvas, this.micSmooth, MIC_RGB, lead === 'you');
    this.drawLane(this.opts.musicCanvas, this.musicSmooth, MUSIC_RGB, lead === 'artist');
  };

  private readMic(): void {
    const filled = this.opts.mic.copy(this.micRaw);
    const level = clamp01(this.opts.micLevel());
    const bucket = Math.floor(this.micRaw.length / POINTS);
    for (let i = 0; i < POINTS; i++) {
      let peak = 0;
      if (filled) {
        const start = i * bucket;
        const end = start + bucket;
        for (let j = start; j < end; j++) {
          const value = Math.abs(this.micRaw[j]);
          if (value > peak) peak = value;
        }
      }
      // A perceptual curve keeps quiet singing visible without making loud
      // notes clip the lane.
      const target = clamp01(Math.pow(peak, 0.55) * 1.8 + level * 0.12);
      const coeff = target > this.micSmooth[i] ? 0.42 : 0.16;
      this.micSmooth[i] += (target - this.micSmooth[i]) * coeff;
    }
  }

  private readMusic(playing: boolean): void {
    const filled = this.opts.music.copy(this.musicRaw);
    const level = playing ? clamp01(this.opts.musicLevel()) : 0;

    if (filled) {
      const bucket = Math.floor(this.musicRaw.length / POINTS);
      for (let i = 0; i < POINTS; i++) {
        let peak = 0;
        const start = i * bucket;
        const end = start + bucket;
        for (let j = start; j < end; j++) {
          const value = Math.abs(this.musicRaw[j]);
          if (value > peak) peak = value;
        }
        const target = clamp01(Math.pow(peak, 0.55) * 1.75);
        const coeff = target > this.musicSmooth[i] ? 0.38 : 0.16;
        this.musicSmooth[i] += (target - this.musicSmooth[i]) * coeff;
      }
      return;
    }

    // No tab capture: a calm, deterministic waveform. Its amplitude follows the
    // actual song volume, so ducking and pausing remain visible.
    for (let i = 0; i < POINTS; i++) {
      const x = i / (POINTS - 1);
      const wobble =
        Math.sin(x * 7.3 + this.phase * 1.8) * 0.5 +
        Math.sin(x * 13.7 - this.phase * 1.15) * 0.24 +
        Math.sin(x * 23.1 + this.phase * 0.7) * 0.12;
      const envelope = 0.58 + 0.42 * Math.sin(Math.PI * x);
      const target = clamp01(level * envelope * (0.14 + 0.86 * Math.abs(wobble)));
      const coeff = target > this.musicSmooth[i] ? 0.2 : 0.12;
      this.musicSmooth[i] += (target - this.musicSmooth[i]) * coeff;
    }
  }

  private drawLane(
    canvas: HTMLCanvasElement,
    values: Float32Array,
    rgb: string,
    isLead: boolean,
  ): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width / this.dpr;
    const height = canvas.height / this.dpr;
    if (width < 2 || height < 2) return;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const mid = height / 2;
    const amplitude = height * 0.4;
    const alpha = isLead ? 1 : 0.55;
    const step = width / (POINTS - 1);

    // Quiet centre line.
    ctx.save();
    ctx.strokeStyle = `rgba(${rgb}, 0.1)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(width, mid);
    ctx.stroke();

    // Mirrored filled wave.
    ctx.beginPath();
    ctx.moveTo(0, mid);
    for (let i = 0; i < POINTS; i++) {
      ctx.lineTo(i * step, mid - values[i] * amplitude);
    }
    for (let i = POINTS - 1; i >= 0; i--) {
      ctx.lineTo(i * step, mid + values[i] * amplitude);
    }
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, 0, 0, height);
    fill.addColorStop(0, `rgba(${rgb}, 0)`);
    fill.addColorStop(0.5, `rgba(${rgb}, ${0.3 * alpha})`);
    fill.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = fill;
    ctx.fill();

    // Glowing upper edge gives the lane its "live" character.
    ctx.beginPath();
    for (let i = 0; i < POINTS; i++) {
      const x = i * step;
      const y = mid - values[i] * amplitude;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(${rgb}, ${0.92 * alpha})`;
    ctx.lineWidth = 1.6;
    ctx.shadowColor = `rgba(${rgb}, ${0.55 * alpha})`;
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.restore();
  }
}

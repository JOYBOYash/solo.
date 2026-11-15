// Full-bleed, audio-reactive Theatre canvas.
//
// Two calm visual languages share one surface:
//   • wave — layered, mirrored ribbons that drift like slow water.
//   • lava — soft additive blobs that swell with the voice and the song.
//
// The singer is always green; Solo is warm white. The microphone is real. The
// song is the real tab-capture signal while a Studio take is running; otherwise
// a gentle synthetic ribbon follows the duet's actual level (including ducking).

export interface WaveformReader {
  copy(out: Float32Array): boolean;
}

export type TheatreStyle = 'wave' | 'lava';

export interface TheatreVisualizerOptions {
  canvas: HTMLCanvasElement;
  mic: WaveformReader;
  music: WaveformReader;
  micLevel: () => number;
  musicLevel: () => number;
  playing: () => boolean;
  lead: () => 'artist' | 'you';
  style: () => TheatreStyle;
}

const POINTS = 96;
const VOICE = '30, 215, 96';
const SONG = '255, 205, 148';
const SONG_BRIGHT = '255, 238, 214';

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
}

function smooth01(v: number): number {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

export class TheatreVisualizer {
  private raf = 0;
  private active = false;
  private reduceMotion = false;
  private dpr = 1;
  private lastTime = 0;
  private phase = 0;
  private micSmoothLevel = 0;
  private musicSmoothLevel = 0;

  private micRaw = new Float32Array(2048);
  private musicRaw = new Float32Array(2048);
  private micSmooth = new Float32Array(POINTS);
  private musicSmooth = new Float32Array(POINTS);
  private micDraw = new Float32Array(POINTS);
  private musicDraw = new Float32Array(POINTS);

  private resizeObserver: ResizeObserver | null = null;
  private lavaCanvas = document.createElement('canvas');
  private lavaCtx = this.lavaCanvas.getContext('2d');
  private lavaImage: ImageData | null = null;
  private lavaLastAt = 0;

  constructor(private readonly opts: TheatreVisualizerOptions) {}

  start(): void {
    if (this.raf) return;
    this.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.opts.canvas);
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
    const canvas = this.opts.canvas;
    const rect = canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * this.dpr));
    const height = Math.max(1, Math.round(rect.height * this.dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  }

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    if (!this.active) return;

    const canvas = this.opts.canvas;
    if (!canvas.isConnected || canvas.clientWidth < 2 || canvas.clientHeight < 2) return;

    const dt = this.lastTime ? Math.min(64, now - this.lastTime) : 16;
    this.lastTime = now;
    if (!this.reduceMotion) this.phase += dt / 1000;

    const playing = this.opts.playing();
    this.readMic();
    this.readMusic(playing);

    const micLevel = clamp01(this.opts.micLevel());
    const musicLevel = playing ? clamp01(this.opts.musicLevel()) : 0;
    const ease = this.reduceMotion ? 0.25 : 0.09;
    this.micSmoothLevel += (micLevel - this.micSmoothLevel) * ease;
    this.musicSmoothLevel += (musicLevel - this.musicSmoothLevel) * ease;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const width = canvas.width / this.dpr;
    const height = canvas.height / this.dpr;
    ctx.clearRect(0, 0, width, height);

    if (this.opts.style() === 'lava') this.drawLava(ctx, width, height);
    else this.drawWave(ctx, width, height);
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
      const target = clamp01(Math.pow(peak, 0.55) * 1.9 + level * 0.1);
      const coeff = target > this.micSmooth[i] ? 0.4 : 0.12;
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
        const coeff = target > this.musicSmooth[i] ? 0.34 : 0.13;
        this.musicSmooth[i] += (target - this.musicSmooth[i]) * coeff;
      }
      return;
    }

    // No tab capture: a calm travelling ribbon whose amplitude follows the
    // real song level, so pausing and ducking stay legible.
    for (let i = 0; i < POINTS; i++) {
      const x = i / (POINTS - 1);
      const wobble =
        Math.sin(x * 6.4 + this.phase * 0.75) * 0.5 +
        Math.sin(x * 11.3 - this.phase * 0.52 + 1.7) * 0.30 +
        Math.sin(x * 19.7 + this.phase * 0.36) * 0.20;
      const envelope = 0.62 + 0.38 * Math.sin(Math.PI * x);
      const target = clamp01(level * envelope * (0.22 + 0.78 * Math.abs(wobble)));
      const coeff = target > this.musicSmooth[i] ? 0.16 : 0.10;
      this.musicSmooth[i] += (target - this.musicSmooth[i]) * coeff;
    }
  }

  /* ----------------------------------------------------------
     Wave — layered ribbons
     ---------------------------------------------------------- */

  private drawWave(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const lead = this.opts.lead();
    const mid = height * 0.52;
    const xStep = width / (POINTS - 1);
    const voiceAlpha = lead === 'you' ? 1 : 0.5;
    const songAlpha = lead === 'artist' ? 0.9 : 0.5;
    this.blurInto(this.micSmooth, this.micDraw);
    this.blurInto(this.musicSmooth, this.musicDraw);

    // A soft bed of light under each voice.
    const glow = ctx.createRadialGradient(
      width * 0.5,
      mid,
      0,
      width * 0.5,
      mid,
      Math.max(width, height) * 0.55,
    );
    glow.addColorStop(0, `rgba(${lead === 'you' ? VOICE : SONG}, ${0.10 + 0.06 * (lead === 'you' ? this.micSmoothLevel : this.musicSmoothLevel)})`);
    glow.addColorStop(0.55, `rgba(${lead === 'you' ? VOICE : SONG}, 0.025)`);
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    // Restrained centre line.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.055)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(width, mid);
    ctx.stroke();

    // Song: three wide ribbons, gently out of phase.
    for (let layer = 0; layer < 3; layer++) {
      const amp = height * (0.22 + layer * 0.03) * (0.55 + this.musicSmoothLevel * 0.6);
      const drift = Math.sin(this.phase * (0.22 + layer * 0.05) + layer * 1.9) * height * 0.014;
      const alpha = (layer === 0 ? 0.22 : 0.10) * songAlpha;
      this.ribbon(
        ctx,
        this.musicDraw,
        mid + drift,
        amp,
        xStep,
        `rgba(${SONG}, ${alpha})`,
        `rgba(${SONG_BRIGHT}, ${alpha * 1.25})`,
        1.15,
        18,
      );
    }

    // Voice: closer, brighter, with a real glow.
    const voiceAmp = height * 0.26 * (0.55 + this.micSmoothLevel * 0.75);
    this.ribbon(
      ctx,
      this.micDraw,
      mid,
      voiceAmp,
      xStep,
      `rgba(${VOICE}, ${0.20 * voiceAlpha})`,
      `rgba(${VOICE}, ${0.92 * voiceAlpha})`,
      1.8,
      22,
    );

    // A fine highlight on each peak keeps the ribbon from feeling flat.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    for (let i = 0; i < POINTS; i++) {
      const x = i * xStep;
      const y = mid - this.micDraw[i] * voiceAmp;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(190, 255, 215, ${0.35 * voiceAlpha})`;
    ctx.lineWidth = 0.8;
    ctx.shadowColor = `rgba(${VOICE}, 0.7)`;
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.restore();
  }

  private ribbon(
    ctx: CanvasRenderingContext2D,
    values: Float32Array,
    mid: number,
    amplitude: number,
    xStep: number,
    fillColor: string,
    strokeColor: string,
    lineWidth: number,
    shadowBlur: number,
  ): void {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, mid - values[0] * amplitude);
    for (let i = 1; i < POINTS; i++) ctx.lineTo(i * xStep, mid - values[i] * amplitude);
    for (let i = POINTS - 1; i >= 0; i--) ctx.lineTo(i * xStep, mid + values[i] * amplitude);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < POINTS; i++) {
      const x = i * xStep;
      const y = mid - values[i] * amplitude;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.shadowColor = strokeColor;
    ctx.shadowBlur = shadowBlur;
    ctx.stroke();
    ctx.restore();
  }

  /* ----------------------------------------------------------
     Lava — a low-resolution plasma field
     ---------------------------------------------------------- */

  private drawLava(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const lead = this.opts.lead();
    const voiceBoost = lead === 'you' ? 1.12 : 0.78;
    const songBoost = lead === 'artist' ? 1.12 : 0.78;
    this.blurInto(this.micSmooth, this.micDraw);

    if (!this.lavaCtx) return;
    const scale = 0.075;
    const lw = Math.max(24, Math.round(width * scale));
    const lh = Math.max(16, Math.round(height * scale));
    if (this.lavaCanvas.width !== lw || this.lavaCanvas.height !== lh) {
      this.lavaCanvas.width = lw;
      this.lavaCanvas.height = lh;
      this.lavaImage = null;
    }
    const lctx = this.lavaCtx;
    if (!this.lavaImage) this.lavaImage = lctx.createImageData(lw, lh);

    // The field is readable at ~22 fps and the browser interpolates the
    // upscale, so there is no need to recompute thousands of sines per frame.
    const now = performance.now();
    if (now - this.lavaLastAt > 45) {
      this.lavaLastAt = now;
      this.renderLavaField(lw, lh, voiceBoost, songBoost);
      lctx.putImageData(this.lavaImage, 0, 0);
    }

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.lavaCanvas, 0, 0, width, height);

    // Fine contour drift over the lava so it still reads as sound.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    for (let i = 0; i < POINTS; i++) {
      const x = (i / (POINTS - 1)) * width;
      const value = this.micDraw[i];
      const y =
        height * 0.62 +
        Math.sin(i * 0.16 + this.phase * 0.5) * height * 0.035 -
        value * height * 0.12;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(${VOICE}, ${0.12 + this.micSmoothLevel * 0.3})`;
    ctx.lineWidth = 1;
    ctx.shadowColor = `rgba(${VOICE}, 0.55)`;
    ctx.shadowBlur = 16;
    ctx.stroke();
    ctx.restore();
  }

  private renderLavaField(
    width: number,
    height: number,
    voiceBoost: number,
    songBoost: number,
  ): void {
    const image = this.lavaImage;
    if (!image) return;
    const data = image.data;
    const phase = this.phase;
    const voice = 0.32 + this.micSmoothLevel * 1.05;
    const song = 0.26 + this.musicSmoothLevel * 0.95;

    for (let y = 0; y < height; y++) {
      const ny = y / height;
      for (let x = 0; x < width; x++) {
        const nx = x / width;
        const fieldA =
          Math.sin(nx * 6.6 + phase * 0.42 + Math.sin(ny * 4.6 - phase * 0.31) * 1.5) +
          Math.sin(ny * 8.4 - phase * 0.37 + 1.3) +
          Math.sin((nx + ny) * 4.8 + phase * 0.22);
        const fieldB =
          Math.sin(nx * 8.1 - phase * 0.35 + 2.1) +
          Math.sin(ny * 7.2 + phase * 0.45 + Math.sin(nx * 3.8 + phase * 0.18) * 1.4) +
          Math.sin((nx - ny) * 5.6 + phase * 0.27 + 0.7);
        const green = smooth01((fieldA - 0.55) / 1.8) * voice * voiceBoost;
        const gold = smooth01((fieldB - 0.55) / 1.8) * song * songBoost;

        const dx = nx - 0.5;
        const dy = ny - 0.5;
        const vignette = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 1.28);
        const base = 5 + 10 * vignette;
        const index = (y * width + x) * 4;
        data[index] = Math.min(255, base + green * 16 + gold * 196);
        data[index + 1] = Math.min(255, base + 8 + green * 158 + gold * 126);
        data[index + 2] = Math.min(255, base + 6 + green * 74 + gold * 58);
        data[index + 3] = 255;
      }
    }
  }

  /** Soften neighbouring peaks so the ribbon reads as a flowing spectrum. */
  private blurInto(src: Float32Array, out: Float32Array): void {
    const weights = [1, 2, 3, 4, 5, 4, 3, 2, 1];
    const radius = 4;
    const total = 25;
    for (let i = 0; i < POINTS; i++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const idx = Math.min(POINTS - 1, Math.max(0, i + k));
        sum += src[idx] * weights[k + radius];
      }
      out[i] = sum / total;
    }
  }
}

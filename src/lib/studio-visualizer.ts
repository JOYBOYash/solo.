// Studio pitch ribbon: a scrolling, non-judgemental guide for staying with the
// song. Your live pitch is the green contour; the warm centre is the song's
// detected note, folded into the octave nearest your voice. The band around it
// is the comfortable "in tune" zone. A mirrored loudness strip underneath keeps
// both voices visible at a glance.
//
// The song pitch exists only while a Studio take is running, because that is
// the only time the tab's audio is available to the browser.

export interface PitchReader {
  (): number | null;
}

export interface StudioVisualizerOptions {
  canvas: HTMLCanvasElement;
  micPitch: PitchReader;
  musicPitch: PitchReader;
  micLevel: () => number;
  musicLevel: () => number;
  recording: () => boolean;
}

const HISTORY = 180;
const SAMPLE_MS = 75;
const VOICE = '30, 215, 96';
const SONG = '255, 205, 148';
const TOLERANCE = 0.8; // semitones
const RANGE = 7; // semitones shown above and below the guide

function midi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export class StudioVisualizer {
  private raf = 0;
  private active = false;
  private dpr = 1;
  private lastSample = 0;

  private micDev = new Float32Array(HISTORY).fill(Number.NaN);
  private micLevels = new Float32Array(HISTORY);
  private songLevels = new Float32Array(HISTORY);
  private head = 0;

  private resizeObserver: ResizeObserver | null = null;

  constructor(private readonly opts: StudioVisualizerOptions) {}

  start(): void {
    if (this.raf) return;
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

  /** Clear the ribbon when a new take starts. */
  reset(): void {
    this.micDev.fill(Number.NaN);
    this.micLevels.fill(0);
    this.songLevels.fill(0);
    this.head = 0;
    this.lastSample = 0;
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

    if (now - this.lastSample >= SAMPLE_MS) {
      this.sample(now);
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const width = canvas.width / this.dpr;
    const height = canvas.height / this.dpr;
    ctx.clearRect(0, 0, width, height);
    this.draw(ctx, width, height);
  };

  private sample(now: number): void {
    this.lastSample = now;
    const musicHz = this.opts.musicPitch();
    const micHz = this.opts.micPitch();
    const guide = musicHz !== null && musicHz > 60 && musicHz < 1400;
    const voice = micHz !== null && micHz > 60 && micHz < 1400;

    let deviation = Number.NaN;
    if (guide && voice) {
      const songMidi = midi(musicHz);
      let folded = songMidi;
      const voiceMidi = midi(micHz);
      // Put the guide in the octave nearest the singer so octave choices do
      // not look like mistakes.
      while (folded - voiceMidi > 6) folded -= 12;
      while (voiceMidi - folded > 6) folded += 12;
      deviation = clamp(voiceMidi - folded, -RANGE, RANGE);
    } else if (voice && !guide) {
      // No song reference yet (intro or idle): show the voice on a fixed
      // C2–C6-ish window instead of pretending it is perfectly in tune.
      deviation = clamp((midi(micHz) - 60) / 3, -RANGE, RANGE);
    }

    this.head = (this.head + 1) % HISTORY;
    this.micDev[this.head] = deviation;
    this.micLevels[this.head] = clamp(this.opts.micLevel(), 0, 1);
    this.songLevels[this.head] = clamp(this.opts.musicLevel(), 0, 1);
  }

  private draw(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const guide = this.opts.recording();
    const padX = 0;
    const pitchTop = height * 0.08;
    const pitchBottom = height * 0.68;
    const center = (pitchTop + pitchBottom) / 2;
    const half = (pitchBottom - pitchTop) / 2;
    const semitone = half / RANGE;

    // Ambience.
    const bed = ctx.createLinearGradient(0, 0, 0, height);
    bed.addColorStop(0, 'rgba(30, 215, 96, 0.035)');
    bed.addColorStop(0.7, 'rgba(0, 0, 0, 0)');
    bed.addColorStop(1, 'rgba(255, 255, 255, 0.02)');
    ctx.fillStyle = bed;
    ctx.fillRect(0, 0, width, height);

    // Time grid.
    for (let i = 0; i <= 6; i++) {
      const x = padX + (i / 6) * width;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.045)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, pitchTop);
      ctx.lineTo(x, pitchBottom);
      ctx.stroke();
    }

    if (guide) {
      // Tolerance band + song guide. The guide is always centred because the
      // contour below is drawn as a deviation from it.
      const bandTop = center - TOLERANCE * semitone;
      const bandBottom = center + TOLERANCE * semitone;
      const band = ctx.createLinearGradient(0, bandTop, 0, bandBottom);
      band.addColorStop(0, 'rgba(30, 215, 96, 0.02)');
      band.addColorStop(0.5, 'rgba(30, 215, 96, 0.09)');
      band.addColorStop(1, 'rgba(30, 215, 96, 0.02)');
      ctx.fillStyle = band;
      ctx.fillRect(0, bandTop, width, bandBottom - bandTop);

      ctx.save();
      ctx.strokeStyle = `rgba(${SONG}, 0.6)`;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 7]);
      ctx.beginPath();
      ctx.moveTo(0, center);
      ctx.lineTo(width, center);
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, center);
      ctx.lineTo(width, center);
      ctx.stroke();
    }

    // Pitch contour, oldest to newest, with gaps when the note drops out.
    const step = width / (HISTORY - 1);
    let open = false;
    ctx.save();
    ctx.beginPath();
    let lastValidX = -1;
    for (let k = 0; k < HISTORY; k++) {
      const idx = (this.head + 1 + k) % HISTORY;
      const value = this.micDev[idx];
      if (!Number.isFinite(value)) {
        open = false;
        continue;
      }
      const x = k * step;
      const y = center + value * semitone;
      if (!open || x - lastValidX > step * 4) {
        ctx.moveTo(x, y);
        open = true;
      } else {
        ctx.lineTo(x, y);
      }
      lastValidX = x;
    }
    ctx.strokeStyle = `rgba(${VOICE}, 0.95)`;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = `rgba(${VOICE}, 0.7)`;
    ctx.shadowBlur = 12;
    ctx.stroke();

    // A faded mirror makes the contour feel like a waveform, not a graph.
    ctx.globalAlpha = 0.16;
    ctx.translate(0, center * 2);
    ctx.scale(1, -1);
    ctx.stroke();
    ctx.restore();

    // Current note — a soft glowing head at the right edge.
    const latest = this.lastValidDeviation();
    if (latest !== null) {
      const y = center + clamp(latest, -RANGE, RANGE) * semitone;
      const glow = ctx.createRadialGradient(width - 2, y, 0, width - 2, y, 26);
      glow.addColorStop(0, `rgba(${VOICE}, 0.75)`);
      glow.addColorStop(1, 'rgba(30, 215, 96, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(width - 2, y, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgb(${VOICE})`;
      ctx.beginPath();
      ctx.arc(width - 5, y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    this.drawLevels(ctx, width, height);
  }

  private lastValidDeviation(): number | null {
    // Only show the glowing head while the note is fresh (about half a second).
    for (let k = 0; k < 7; k++) {
      const idx = (this.head - k + HISTORY) % HISTORY;
      if (Number.isFinite(this.micDev[idx])) return this.micDev[idx];
    }
    return null;
  }

  private drawLevels(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const base = height * 0.85;
    const amp = height * 0.13;
    const step = width / (HISTORY - 1);

    // You above the line, Solo below it: two mirrored, scrolling envelopes.
    const paths: { values: Float32Array; color: string; dir: -1 | 1; alpha: number }[] = [
      { values: this.micLevels, color: VOICE, dir: -1, alpha: 0.5 },
      { values: this.songLevels, color: SONG, dir: 1, alpha: 0.34 },
    ];

    ctx.save();
    for (const lane of paths) {
      ctx.beginPath();
      ctx.moveTo(0, base);
      for (let k = 0; k < HISTORY; k++) {
        const idx = (this.head + 1 + k) % HISTORY;
        const value = Math.pow(lane.values[idx], 0.75);
        ctx.lineTo(k * step, base + lane.dir * value * amp);
      }
      ctx.lineTo(width, base);
      ctx.closePath();
      ctx.fillStyle = `rgba(${lane.color}, ${lane.alpha * 0.22})`;
      ctx.fill();

      ctx.beginPath();
      for (let k = 0; k < HISTORY; k++) {
        const idx = (this.head + 1 + k) % HISTORY;
        const value = Math.pow(lane.values[idx], 0.75);
        const x = k * step;
        const y = base + lane.dir * value * amp;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(${lane.color}, ${lane.alpha})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.beginPath();
    ctx.moveTo(0, base);
    ctx.lineTo(width, base);
    ctx.stroke();
    ctx.restore();
  }
}

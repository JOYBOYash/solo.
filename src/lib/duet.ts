// The duet engine — the heart of Solo.
//
// Spotify's playback stream cannot be DSP-processed (it runs inside the SDK's
// cross-origin DRM iframe, and Spotify requires content "in its original
// form"). So the duet is driven by the SDK's official volume control:
//
//   - while the mic hears you singing  ->  the artist ducks to a backing level
//   - when you stop                    ->  the artist comes back and sings
//
// Manual mode lets you hold the Lead button (or the H key) to take the lead,
// which is reliable even on speakers instead of headphones.

import type { PlayerBridge } from './sdk';

export type DuetMode = 'auto' | 'manual';
export type Lead = 'artist' | 'you';

const TICK_MS = 80;
const APPROACH = 0.28; // per-tick approach factor; ~250 ms to converge

export class DuetEngine {
  private player: PlayerBridge | null = null;
  private timer = 0;
  private current = 1;
  private lastSent = 1;
  private manualHeld = false;

  mode: DuetMode = 'auto';
  lead: Lead = 'artist';
  /** Master volume 0..1 (what the artist plays at when you are not singing). */
  baseVolume = 1;
  /**
   * Fraction of the master volume while you sing (0..1). The default keeps the
   * song clearly audible under the voice instead of making it feel muted.
   */
  backingFactor = 0.6;

  onLead: ((lead: Lead) => void) | null = null;

  start(player: PlayerBridge): void {
    this.player = player;
    this.current = this.baseVolume;
    this.lastSent = -1;
    // A new room always starts with Solo leading, never held over from the
    // previous session's Manual hold.
    this.manualHeld = false;
    this.micSinging = false;
    this.lead = 'artist';
    if (this.timer) window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
    void this.player?.setVolume(this.baseVolume);
  }

  setMode(mode: DuetMode): void {
    this.mode = mode;
    if (mode === 'auto') this.manualHeld = false;
  }

  setManualHeld(held: boolean): void {
    if (this.mode !== 'manual') return;
    this.manualHeld = held;
  }

  setBaseVolume(v: number): void {
    this.baseVolume = Math.min(1, Math.max(0, v));
  }

  setBackingFactor(f: number): void {
    this.backingFactor = Math.min(1, Math.max(0, f));
  }

  isSinging(): boolean {
    return this.mode === 'manual' ? this.manualHeld : this.micSinging;
  }

  /** Current artist volume relative to the master volume (0..1). */
  get relativeVolume(): number {
    if (this.baseVolume <= 0) return 0;
    return Math.min(1, Math.max(0, this.current / this.baseVolume));
  }

  private micSinging = false;

  /** Mic monitor feeds us its state; the tick loop samples it. */
  setMicVoiced(voiced: boolean): void {
    this.micSinging = voiced;
  }

  private tick(): void {
    if (!this.player) return;
    const singing = this.mode === 'manual' ? this.manualHeld : this.micSinging;
    const nextLead: Lead = singing ? 'you' : 'artist';
    if (nextLead !== this.lead) {
      this.lead = nextLead;
      this.onLead?.(nextLead);
    }
    const target = singing ? this.baseVolume * this.backingFactor : this.baseVolume;
    this.current += (target - this.current) * APPROACH;
    if (Math.abs(target - this.current) < 0.004) this.current = target;
    if (Math.abs(this.current - this.lastSent) > 0.004) {
      this.lastSent = this.current;
      void this.player.setVolume(Math.min(1, Math.max(0, this.current)));
    }
  }
}

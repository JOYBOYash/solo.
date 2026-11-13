// Small DOM helpers shared by every screen.

export type Attrs = Record<string, string | number | boolean | ((e: Event) => void)>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: (Node | string | number | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === false || value == null) continue;
      if (typeof value === 'function') {
        node.addEventListener(key.startsWith('on') ? key.slice(2) : key, value as EventListener);
      } else if (value === true) {
        node.setAttribute(key, '');
      } else {
        node.setAttribute(key, String(value));
      }
    }
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Real artwork from Spotify, or a labelled placeholder block when there is none. */
export function artwork(
  images: { url: string }[] | undefined,
  cls: string,
  alt: string,
  label = 'No artwork',
): HTMLElement {
  const url = images?.[0]?.url;
  if (url) {
    const img = el('img', { class: cls, src: url, alt, loading: 'lazy' });
    img.addEventListener('error', () => {
      const fallback = el('div', { class: `${cls} art-fallback` }, label);
      img.replaceWith(fallback);
    });
    return img;
  }
  return el('div', { class: `${cls} art-fallback` }, label);
}

/** Real avatar image, or a placeholder circle with the user's initial. */
export function avatar(images: { url: string }[] | undefined, name: string): HTMLElement {
  const url = images?.[0]?.url;
  if (url) return el('img', { class: 'avatar', src: url, alt: '' });
  const initial = (name || 'S').trim().charAt(0).toUpperCase() || 'S';
  return el('span', { class: 'avatar-fallback', 'aria-hidden': 'true' }, initial);
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Average colour of an album image, used for Spotify-style gradient headers.
 * Reads the image through a canvas with CORS; resolves null when the CDN
 * refuses cross-origin pixel access (the UI then keeps its neutral fallback).
 */
export function dominantTint(url: string | undefined): Promise<Rgb | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 16;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, 16, 16);
        const data = ctx.getImageData(0, 0, 16, 16).data;
        let r = 0;
        let g = 0;
        let b = 0;
        const n = data.length / 4;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
        }
        r = Math.round(r / n);
        g = Math.round(g / n);
        b = Math.round(b / n);
        // Give muted averages a little more presence, like Spotify's headers.
        const max = Math.max(r, g, b);
        const lift = max > 24 ? Math.min(1.5, 96 / max) : 1;
        resolve({ r: Math.min(255, Math.round(r * lift)), g: Math.min(255, Math.round(g * lift)), b: Math.min(255, Math.round(b * lift)) });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const node = el('div', { class: `toast${kind === 'error' ? ' error' : ''}`, role: 'status' }, message);
  root.append(node);
  window.setTimeout(() => node.remove(), 6000);
}

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

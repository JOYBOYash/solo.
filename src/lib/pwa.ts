// PWA plumbing: service worker registration and the install prompt.
// The app itself never requires installation; this only adds the browser's
// native "Install" flow and an offline shell.

import { toast } from '../dom';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;

export function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone;
  return window.matchMedia('(display-mode: standalone)').matches || iosStandalone === true;
}

export function initPwa(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    toast('Solo is installed. Open it from your home screen or app list.');
  });

  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch(() => {
        // Offline support is optional; never block the app on it.
      });
  });
}

/** Trigger the native install prompt, or explain the browser-specific route. */
export async function installApp(): Promise<void> {
  if (isStandalone()) {
    toast('Solo is already installed.');
    return;
  }

  if (!deferredPrompt) {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    toast(
      ios
        ? 'On iPhone or iPad: tap Share, then “Add to Home Screen”.'
        : 'Open your browser menu and choose “Install Solo” (or “Install app”).',
    );
    return;
  }

  const prompt = deferredPrompt;
  deferredPrompt = null;
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === 'accepted') {
      toast('Installing Solo…');
    } else {
      toast('Install cancelled. You can try again from the browser menu.');
    }
  } catch {
    toast('The install prompt could not open. Use your browser menu instead.');
  }
}

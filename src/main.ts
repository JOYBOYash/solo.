import './style.css';
import './minimal.css';
import { getClientId, consumeClientIdParam, hasDeploymentClientId } from './lib/config';
import { handleCallbackIfPresent, isLoggedIn, logout } from './lib/auth';
import { getMe } from './lib/api';
import { hasDeploymentYouTubeKey } from './lib/youtube';
import { isPublicDeployment } from './lib/deployment';
import { renderConnectScreen, goLibrary, goHome, handleGuideRoute } from './ui';
import { store } from './store';
import { toast } from './dom';
import { initPwa } from './lib/pwa';

function reportConfiguration(): void {
  if (!isPublicDeployment()) return;
  if (!hasDeploymentYouTubeKey()) {
    console.warn(
      '[Solo] YouTube is unavailable: this build has no shared API key. ' +
        'Set VITE_YOUTUBE_API_KEY (or YOUTUBE_API_KEY) and redeploy.',
    );
  }
  if (!hasDeploymentClientId()) {
    console.warn(
      '[Solo] Spotify is unavailable: this build has no shared Client ID. ' +
        'Set VITE_SPOTIFY_CLIENT_ID and redeploy.',
    );
  }
}

function routeFromHash(): void {
  if (handleGuideRoute()) return;
  if (!location.hash) {
    if (isLoggedIn() && getClientId()) void goLibrary();
    else goHome();
  }
}

async function boot(): Promise<void> {
  reportConfiguration();
  initPwa();
  // Shared-Client-ID deployments can pass ?client_id=… once; it is stored and
  // stripped from the URL so the OAuth round-trip stays clean.
  consumeClientIdParam();

  let authError: string | undefined;

  try {
    await handleCallbackIfPresent();
  } catch (err) {
    authError = err instanceof Error ? err.message : 'Sign-in failed.';
    logout();
    renderConnectScreen(authError);
    return;
  }

  if (handleGuideRoute()) return;

  window.addEventListener('hashchange', routeFromHash);
  window.addEventListener('popstate', routeFromHash);

  if (!isLoggedIn() || !getClientId()) {
    goHome();
    return;
  }

  try {
    store.me = await getMe();
    void goLibrary();
  } catch (err) {
    // A dead session (e.g. revoked access) drops back to the Spotify connect
    // screen — with the free YouTube mode always one tap away.
    logout();
    renderConnectScreen(err instanceof Error ? err.message : undefined);
    toast(err instanceof Error ? err.message : 'Could not reach Spotify.', 'error');
  }
}

void boot();

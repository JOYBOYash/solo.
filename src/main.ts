import './style.css';
import { getClientId, consumeClientIdParam } from './lib/config';
import { handleCallbackIfPresent, isLoggedIn, logout } from './lib/auth';
import { getMe } from './lib/api';
import { renderConnectScreen, goLibrary } from './ui';
import { store } from './store';
import { toast } from './dom';

async function boot(): Promise<void> {
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

  if (!isLoggedIn() || !getClientId()) {
    renderConnectScreen();
    return;
  }

  try {
    store.me = await getMe();
    void goLibrary();
  } catch (err) {
    // A dead session (e.g. revoked access) drops back to the connect screen.
    logout();
    renderConnectScreen(err instanceof Error ? err.message : undefined);
    toast(err instanceof Error ? err.message : 'Could not reach Spotify.', 'error');
  }
}

void boot();

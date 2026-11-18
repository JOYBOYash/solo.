// Deployment policy for source credentials.
//
// A public deployment supplies shared YouTube and Spotify credentials, so
// visitors never see an API-key form. Development builds and self-hosted copies
// can opt into the bring-your-own-key flow with VITE_ALLOW_PERSONAL_KEYS=1.

export function allowPersonalSources(): boolean {
  return typeof __SOLO_ALLOW_PERSONAL_KEYS__ === 'boolean' ? __SOLO_ALLOW_PERSONAL_KEYS__ : true;
}

export function isPublicDeployment(): boolean {
  return !allowPersonalSources();
}

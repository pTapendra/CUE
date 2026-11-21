import type { TokenStore } from './api/client';

/**
 * Whether the student is past Welcome: they skipped Canvas or connected it once. Welcome shows on
 * launch only until then, so disconnecting Canvas later doesn't bring it back. (The key keeps its
 * first name, from when only Skip set it.)
 */
const ONBOARDED_KEY = 'cue.skippedCanvas';

export async function getOnboarded(store: TokenStore): Promise<boolean> {
  return (await store.getItem(ONBOARDED_KEY)) === '1';
}

export async function setOnboarded(store: TokenStore, value: boolean): Promise<void> {
  if (value) {
    await store.setItem(ONBOARDED_KEY, '1');
  } else {
    await store.removeItem(ONBOARDED_KEY);
  }
}

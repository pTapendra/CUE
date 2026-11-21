import type { TokenStore } from './api/client';

const SKIPPED_KEY = 'cue.skippedCanvas';

export async function getSkippedCanvas(store: TokenStore): Promise<boolean> {
  return (await store.getItem(SKIPPED_KEY)) === '1';
}

export async function setSkippedCanvas(
  store: TokenStore,
  value: boolean,
): Promise<void> {
  if (value) {
    await store.setItem(SKIPPED_KEY, '1');
  } else {
    await store.removeItem(SKIPPED_KEY);
  }
}

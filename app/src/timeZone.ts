import type { ApiClient } from './api/client';
import type { PlannerSettings } from './api/types';

export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** The settings with the given zone, or null when they already have it. */
export function withDeviceTimeZone(s: PlannerSettings, tz: string): (PlannerSettings & { timeZone: string }) | null {
  if (s.timeZone === tz) return null;
  return { ...s, timeZone: tz };
}

const savedListeners = new Set<() => void>();

/**
 * Calls `listener` each time `syncTimeZone` saves a new zone. The server has re-planned by then,
 * so a screen showing study blocks loads again. Returns a function that stops the calls.
 */
export function onTimeZoneSaved(listener: () => void): () => void {
  savedListeners.add(listener);
  return () => {
    savedListeners.delete(listener);
  };
}

/**
 * Tells the server which zone the phone is in, only when it differs from what the server has.
 * Returns true when it saved a new zone (and tells the `onTimeZoneSaved` listeners). It never fails:
 * when the server cannot be reached, the next try sends the zone.
 */
export async function syncTimeZone(api: ApiClient, tz: string = deviceTimeZone()): Promise<boolean> {
  try {
    const next = withDeviceTimeZone(await api.getPlannerSettings(), tz);
    if (!next) return false;
    await api.savePlannerSettings(next);
  } catch {
    return false;
  }
  savedListeners.forEach((listener) => listener());
  return true;
}

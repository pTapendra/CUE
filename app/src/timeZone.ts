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

/**
 * Tells the server which zone the phone is in, only when it differs from what the server has.
 * Returns true when it saved a new zone. It never fails: when the server cannot be reached,
 * the next try sends the zone.
 */
export async function syncTimeZone(api: ApiClient, tz: string = deviceTimeZone()): Promise<boolean> {
  try {
    const next = withDeviceTimeZone(await api.getPlannerSettings(), tz);
    if (!next) return false;
    await api.savePlannerSettings(next);
    return true;
  } catch {
    return false;
  }
}

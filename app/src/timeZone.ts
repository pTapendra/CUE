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

/** Tells the server which zone the phone is in, only when it differs from what the server has. */
export async function syncTimeZone(api: ApiClient, tz: string = deviceTimeZone()): Promise<void> {
  const next = withDeviceTimeZone(await api.getPlannerSettings(), tz);
  if (next) await api.savePlannerSettings(next);
}

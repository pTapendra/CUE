import Constants from 'expo-constants';

/**
 * Address of the Cue server (port 3000 on the computer running `npm run dev`).
 *
 * 1. EXPO_PUBLIC_SERVER_URL, if set (e.g. in app/.env), always wins.
 * 2. Otherwise, in Expo Go, the app uses the same computer that serves the app
 *    (its address comes from Metro's host URI), so a phone on the same Wi-Fi works.
 * 3. Otherwise, localhost.
 */
export function serverUrl(
  env: string | undefined = process.env.EXPO_PUBLIC_SERVER_URL,
  hostUri: string | undefined = Constants.expoConfig?.hostUri,
): string {
  if (env) return env.replace(/\/+$/, '');
  const host = hostUri?.split(':')[0];
  return `http://${host || 'localhost'}:3000`;
}

export const SERVER_URL = serverUrl();

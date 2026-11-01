import { Platform } from 'react-native';

/**
 * Address of the Cue server.
 * - Android emulator: 10.0.2.2 is the computer running the emulator.
 * - iOS simulator: localhost.
 * - A real phone: replace with your computer's LAN address, e.g. http://192.168.1.20:3000.
 */
export const SERVER_URL = Platform.select({
  android: 'http://10.0.2.2:3000',
  default: 'http://localhost:3000',
});

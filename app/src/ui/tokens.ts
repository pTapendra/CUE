import { useColorScheme } from 'react-native';

export type Colors = {
  text: string;
  text2: string;
  text3: string;
  line: string;
  bg: string;
  bg2: string;
  accent: string;
  /** A filled accent control while pressed. */
  accentPressed: string;
  onAccent: string;
  accentTint: string;
  exam: string;
  examTint: string;
  ok: string;
  okTint: string;
  warn: string;
  danger: string;
  dangerTint: string;
  /** A danger button (on `dangerTint`) while pressed. */
  dangerPressed: string;
  now: string;
};

export const lightColors: Colors = {
  text: '#1D1D1F',
  text2: '#5B5B63',
  text3: '#6E6E77',
  line: '#E6E6EA',
  bg: '#FFFFFF',
  bg2: '#F5F5F7',
  accent: '#4338CA',
  accentPressed: '#3730A3',
  onAccent: '#FFFFFF',
  accentTint: '#EEF0FF',
  exam: '#B42340',
  examTint: '#FDECEF',
  ok: '#1E7A43',
  okTint: '#E6F4EC',
  warn: '#A15C00',
  danger: '#C0262D',
  dangerTint: '#FDECEA',
  dangerPressed: '#FBE0DD',
  now: '#E5484D',
};

export const darkColors: Colors = {
  text: '#F2F2F5',
  text2: '#B4B4BE',
  text3: '#9A9AA5',
  line: '#2E2E36',
  bg: '#121216',
  bg2: '#1C1C22',
  accent: '#A5A0FF',
  accentPressed: '#8F89F5',
  onAccent: '#121216',
  accentTint: '#262552',
  exam: '#FF8FA3',
  examTint: '#3A1D26',
  ok: '#5FD08A',
  okTint: '#16301F',
  warn: '#F2A93B',
  danger: '#FF8A8F',
  dangerTint: '#3A1D1F',
  dangerPressed: '#4A2427',
  now: '#FF6B70',
};

export type CourseColor = { mark: string; tint: string; text: string };

export const lightCourses: CourseColor[] = [
  { mark: '#6D5BD0', tint: '#EFEDFC', text: '#4B3DB8' }, // violet
  { mark: '#0F9F84', tint: '#E2F4EF', text: '#0A6B59' }, // teal
  { mark: '#C47A0A', tint: '#FCF0DC', text: '#8A5300' }, // amber
  { mark: '#2F7BDB', tint: '#E6F0FC', text: '#1A5BAE' }, // blue
  { mark: '#D14B7A', tint: '#FCE9F0', text: '#A12D57' }, // rose
  { mark: '#6B7A90', tint: '#EAEEF3', text: '#4A5667' }, // slate
];

export const darkCourses: CourseColor[] = [
  { mark: '#9585F0', tint: '#2A2650', text: '#C4BBFF' }, // violet
  { mark: '#2CC4A5', tint: '#12332D', text: '#6FE3C8' }, // teal
  { mark: '#E09A2B', tint: '#382A10', text: '#F5BF68' }, // amber
  { mark: '#5B9DF0', tint: '#15294A', text: '#9CC4FA' }, // blue
  { mark: '#EE6D98', tint: '#3C1B29', text: '#F8A2BE' }, // rose
  { mark: '#8D9BB0', tint: '#262B33', text: '#B9C3D2' }, // slate
];

export const lightUnknown: CourseColor = {
  mark: '#8E8E96',
  tint: '#F0F0F3',
  text: '#5B5B63',
};

export const darkUnknown: CourseColor = {
  mark: '#8A8A94',
  tint: '#26262C',
  text: '#B4B4BE',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const radius = { sm: 8, md: 10, lg: 14, pill: 999 } as const;

/** Text styles; no heights, so text grows with the phone's text size. */
export const type = {
  largeTitle: { fontSize: 26, fontWeight: '700' },
  title: { fontSize: 20, fontWeight: '700' },
  section: { fontSize: 12, fontWeight: '700' },
  body: { fontSize: 14, fontWeight: '500' },
  bodyStrong: { fontSize: 14, fontWeight: '600' },
  meta: { fontSize: 11.5, fontWeight: '400' },
} as const;

export function useTokens(): {
  colors: Colors;
  courses: CourseColor[];
  unknown: CourseColor;
  dark: boolean;
} {
  const dark = useColorScheme() === 'dark';
  return dark
    ? { colors: darkColors, courses: darkCourses, unknown: darkUnknown, dark }
    : { colors: lightColors, courses: lightCourses, unknown: lightUnknown, dark };
}

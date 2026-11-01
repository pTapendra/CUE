import { useColorScheme } from 'react-native';

const light = {
  background: '#F7F7FB',
  surface: '#FFFFFF',
  text: '#1E1E2A',
  muted: '#6B6B7B',
  border: '#E2E2EA',
  primary: '#5B4BC4',
  primaryText: '#FFFFFF',
  exam: '#B4235A',
  examTint: '#FBE8EF',
  danger: '#B42318',
  dangerTint: '#FDECEA',
  done: '#2E7D32',
};

const dark: typeof light = {
  background: '#121218',
  surface: '#1C1C25',
  text: '#ECECF4',
  muted: '#A0A0B2',
  border: '#2E2E3A',
  primary: '#9D8FFF',
  primaryText: '#121218',
  exam: '#FF8FB4',
  examTint: '#3A1F2A',
  danger: '#FF8A80',
  dangerTint: '#3A1E1C',
  done: '#81C784',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

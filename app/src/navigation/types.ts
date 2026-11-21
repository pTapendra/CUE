import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type TabParamList = {
  Today: undefined;
  Schedule: { date?: string; view?: 'day' | '3days' | 'week' } | undefined;
  Courses: undefined;
};

export type RootStackParamList = {
  Welcome: undefined;
  Tabs: NavigatorScreenParams<TabParamList>;
  Course: { courseId: string };
  /** A modal. */
  Settings: undefined;
  StudyTimes: undefined;
  WhatCueKeeps: undefined;
  /** A modal. */
  Review: undefined;
  /** A modal: the token form, for a server without Canvas login. */
  TokenConnect: undefined;
};

export type RootScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, T>;

export type TabScreenProps<T extends keyof TabParamList> = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, T>,
  NativeStackScreenProps<RootStackParamList>
>;

// Types `useNavigation()` for every screen.
declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}

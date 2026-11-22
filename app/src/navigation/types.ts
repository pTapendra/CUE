import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { SyncPreview } from '../api/types';

export type TabParamList = {
  Today: undefined;
  Schedule:
    | {
        /** The day to show: "YYYY-MM-DD" (a local date) or an ISO time (its local day). Default: today. */
        date?: string;
        /** Default: the view on screen (3 days at first). */
        view?: 'day' | '3days' | 'week';
      }
    | undefined;
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
  /** `preview`: what a sync just read, shown as it is (no second read of Canvas). */
  Review: { preview?: SyncPreview } | undefined;
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

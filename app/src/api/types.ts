export type ItemKind = 'assignment' | 'exam' | 'event';
export type ItemStatus = 'not_started' | 'in_progress' | 'done' | 'postponed';

export interface Item {
  id: string;
  courseId: string | null;
  courseName: string | null;
  source: 'canvas' | 'manual';
  kind: ItemKind;
  title: string;
  dueAt: string | null;
  endsAt: string | null;
  allDay: boolean;
  studyMinutes: number | null;
  status: ItemStatus;
}

export interface Course {
  id: string;
  source: 'canvas' | 'manual';
  name: string;
  code: string | null;
}

export interface Week {
  from: string;
  to: string;
  items: Item[];
  undated: Item[];
  blocks: StudyBlock[];
  shortfalls: Shortfall[];
}

export interface StudyBlock {
  id: string;
  itemId: string;
  itemTitle: string;
  itemKind: ItemKind;
  courseName: string | null;
  itemDueAt: string | null;
  /** The item's study time in minutes: its own amount, else the default for its kind. */
  itemStudyMinutes: number;
  startsAt: string;
  endsAt: string;
  state: 'proposed' | 'accepted';
  index: number;
  total: number;
  clash: { title: string; startsAt: string; endsAt: string } | null;
}

export interface Shortfall {
  itemId: string;
  itemTitle: string;
  dueAt: string;
  neededMinutes: number;
  plannedMinutes: number;
}

export interface StudyWindow {
  weekday: number;
  enabled: boolean;
  start: string;
  end: string;
}

export interface PlannerSettings {
  timeZone: string | null;
  dailyLimitMinutes: number;
  windows: StudyWindow[];
}

export interface ConnectionStatus {
  connected: boolean;
  baseUrl: string | null;
  lastSyncedAt: string | null;
}

export interface ProposedItem {
  key: string;
  courseName: string;
  kind: ItemKind;
  title: string;
  dueAt: string | null;
  needsDate: boolean;
  alreadyImported: boolean;
}

export interface SyncPreview {
  syncId: string;
  items: ProposedItem[];
}

export interface ItemInput {
  title: string;
  kind: ItemKind;
  dueAt: string | null;
  courseId?: string | null;
  endsAt?: string | null;
  studyMinutes?: number;
}

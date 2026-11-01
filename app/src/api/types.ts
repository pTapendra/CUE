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
}

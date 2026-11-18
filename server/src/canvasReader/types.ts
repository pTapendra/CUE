export type ItemKind = "assignment" | "exam" | "event";

/** One Canvas item waiting for the student to confirm it. */
export interface ProposedItem {
  /** Stable key within a preview, e.g. "assignment:123". */
  key: string;
  externalId: string;
  courseExternalId: string;
  courseName: string;
  kind: ItemKind;
  title: string;
  dueAt: string | null;
  /** When an event ends; null for assignments and events without an end. */
  endsAt: string | null;
  /** True for all-day events (assignments are never all-day). */
  allDay: boolean;
  /** True when this is an exam and Canvas gave no date: the student should add one. */
  needsDate: boolean;
  /** True when this item was confirmed in an earlier sync. */
  alreadyImported: boolean;
}

export interface ProposedCourse {
  externalId: string;
  name: string;
  code: string | null;
}

export interface SyncPreview {
  syncId: string;
  courses: ProposedCourse[];
  items: ProposedItem[];
}

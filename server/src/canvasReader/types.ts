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
  alreadyImported?: boolean;
}

export interface ProposedCourse {
  externalId: string;
  name: string;
  code: string | null;
}

/** The fields a sync compares; Canvas's value wins on Save. */
export type ChangedField = "title" | "dueAt" | "endsAt" | "allDay";

export interface FieldChange {
  field: ChangedField;
  /** The value saved in Cue. */
  from: string | boolean | null;
  /** Canvas's value. */
  to: string | boolean | null;
}

/** A saved item whose Canvas title, dates or all-day flag differ from Cue's. */
export interface ChangedItem {
  key: string;
  /** The saved item, updated by this ID on Save. */
  itemId: string;
  externalId: string;
  courseExternalId: string;
  courseName: string;
  /** The saved kind: sync never changes it. */
  kind: ItemKind;
  /** Canvas's values, normalised as Save stores them. */
  title: string;
  dueAt: string | null;
  endsAt: string | null;
  allDay: boolean;
  changes: FieldChange[];
}

/** A saved item Canvas no longer has. The values are the saved ones. */
export interface RemovedItem {
  key: string;
  itemId: string;
  courseName: string;
  kind: ItemKind;
  title: string;
  dueAt: string | null;
}

/** What a sync found, against what the student has saved and skipped. */
export interface SyncGroups {
  /** Not saved, not skipped. */
  newItems: ProposedItem[];
  /** Not saved, skipped in an earlier sync. */
  skipped: ProposedItem[];
  changed: ChangedItem[];
  removed: RemovedItem[];
}

export interface SyncPreview {
  syncId: string;
  courses: ProposedCourse[];
  items: ProposedItem[];
}

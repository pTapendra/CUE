import type { Db } from "../db.js";
import type { PlannerSettings, Shortfall, StudyWindow } from "./types.js";

interface Row {
  time_zone: string;
  daily_limit_minutes: number;
  windows: string;
  last_planned_on: string | null;
  shortfalls: string;
}

export type SavedPlannerSettings = PlannerSettings & { lastPlannedOn: string | null; shortfalls: Shortfall[] };

/** The Planner's own table: each student's time zone, study times and the outcome of the last plan. */
export class PlannerRepository {
  constructor(private readonly db: Db) {}

  get(studentId: string): SavedPlannerSettings | null {
    const row = this.db
      .prepare("SELECT time_zone, daily_limit_minutes, windows, last_planned_on, shortfalls FROM planner_settings WHERE student_id = ?")
      .get(studentId) as Row | undefined;
    if (!row) return null;
    return {
      timeZone: row.time_zone,
      dailyLimitMinutes: row.daily_limit_minutes,
      windows: JSON.parse(row.windows) as StudyWindow[],
      lastPlannedOn: row.last_planned_on,
      shortfalls: JSON.parse(row.shortfalls) as Shortfall[],
    };
  }

  /** Saves the settings; the record of the last plan is kept. */
  save(studentId: string, s: PlannerSettings): void {
    this.db
      .prepare(
        `INSERT INTO planner_settings (student_id, time_zone, daily_limit_minutes, windows) VALUES (?, ?, ?, ?)
         ON CONFLICT(student_id) DO UPDATE SET
           time_zone = excluded.time_zone, daily_limit_minutes = excluded.daily_limit_minutes, windows = excluded.windows`,
      )
      .run(studentId, s.timeZone, s.dailyLimitMinutes, JSON.stringify(s.windows));
  }

  /** Records the local day of the latest plan and what it could not fit. No-op without saved settings. */
  recordPlan(studentId: string, plannedOn: string, shortfalls: Shortfall[]): void {
    this.db
      .prepare("UPDATE planner_settings SET last_planned_on = ?, shortfalls = ? WHERE student_id = ?")
      .run(plannedOn, JSON.stringify(shortfalls), studentId);
  }
}

import type { StudyWindow } from "./types.js";

export interface PlannerConfig {
  studyMinutes: { exam: number; assignment: number };
  blockMinutes: number;
  dailyLimitMinutes: number;
  leadDays: { exam: number; assignment: number };
  /** Indexed by weekday, 0 = Sunday … 6 = Saturday. */
  windows: StudyWindow[];
}

const weekday = (weekday: number): StudyWindow => ({ weekday, enabled: true, start: "18:00", end: "22:00" });
const weekend = (weekday: number): StudyWindow => ({ weekday, enabled: true, start: "10:00", end: "16:00" });

export const PLANNER_DEFAULTS: PlannerConfig = {
  studyMinutes: { exam: 360, assignment: 120 },
  blockMinutes: 60,
  dailyLimitMinutes: 180,
  leadDays: { exam: 10, assignment: 5 },
  windows: [weekend(0), weekday(1), weekday(2), weekday(3), weekday(4), weekday(5), weekend(6)],
};

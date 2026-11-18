import type { ScheduleService } from "../schedule/ScheduleService.js";
import { PLANNER_DEFAULTS, type PlannerConfig } from "./config.js";
import { DefaultStrategy } from "./DefaultStrategy.js";
import type { PlannerRepository } from "./PlannerRepository.js";
import { localDateOf } from "./time.js";
import { blocksToRemove } from "./trim.js";
import type { PlannerSettings, PlanningStrategy, Shortfall, StudyWindow } from "./types.js";

export interface PlannerOptions {
  strategy?: PlanningStrategy;
  now?: () => Date;
  config?: PlannerConfig;
}

/**
 * Planner (UC2): keeps each student's study-block suggestions up to date.
 * Wiring is the caller's job: `schedule.onChange((id) => planner.replan(id))`.
 */
export class PlannerService {
  private readonly strategy: PlanningStrategy;
  private readonly now: () => Date;
  private readonly config: PlannerConfig;

  constructor(
    private readonly repo: PlannerRepository,
    private readonly schedule: ScheduleService,
    opts: PlannerOptions = {},
  ) {
    this.config = opts.config ?? PLANNER_DEFAULTS;
    this.strategy = opts.strategy ?? new DefaultStrategy(this.config);
    this.now = opts.now ?? (() => new Date());
  }

  getSettings(studentId: string): { timeZone: string | null; dailyLimitMinutes: number; windows: StudyWindow[] } {
    const saved = this.repo.get(studentId);
    if (!saved) {
      return { timeZone: null, dailyLimitMinutes: this.config.dailyLimitMinutes, windows: this.config.windows };
    }
    return { timeZone: saved.timeZone, dailyLimitMinutes: saved.dailyLimitMinutes, windows: saved.windows };
  }

  saveSettings(studentId: string, s: PlannerSettings): void {
    this.repo.save(studentId, s);
    this.replan(studentId);
  }

  /** Replaces the student's suggestions and drops accepted blocks that no longer fit. Needs a saved time zone. */
  replan(studentId: string): void {
    const saved = this.repo.get(studentId);
    if (!saved) return;
    const settings: PlannerSettings = {
      timeZone: saved.timeZone,
      dailyLimitMinutes: saved.dailyLimitMinutes,
      windows: saved.windows,
    };
    const now = this.now();
    const { items, busy, accepted, rejected } = this.schedule.planningSnapshot(studentId);
    const removeAccepted = blocksToRemove(now, items, accepted);
    const removed = new Set(removeAccepted);
    const { proposed, shortfalls } = this.strategy.plan({
      now,
      settings,
      items,
      busy,
      accepted: accepted.filter((block) => !removed.has(block.id)),
      rejected,
    });
    this.schedule.applyPlan(studentId, { proposed, removeAccepted });
    this.repo.recordPlan(studentId, localDateOf(now, settings.timeZone), shortfalls);
  }

  /** Re-plans when the last plan was made on an earlier local day. */
  replanIfNewDay(studentId: string): void {
    const saved = this.repo.get(studentId);
    if (!saved) return;
    if (saved.lastPlannedOn !== localDateOf(this.now(), saved.timeZone)) this.replan(studentId);
  }

  /** What the last plan could not fit, for items whose deadline is still ahead. */
  shortfalls(studentId: string): Shortfall[] {
    const now = this.now().getTime();
    return (this.repo.get(studentId)?.shortfalls ?? []).filter((s) => Date.parse(s.dueAt) > now);
  }
}

import { PLANNER_DEFAULTS, type PlannerConfig } from "./config.js";
import type { BlockRef, PlanInput, PlanItem, PlanResult, PlanningStrategy, PlannerSettings, Shortfall } from "./types.js";
import { addDays, localDateOf, minutesOf, weekdayOf, zonedTimeToUtc } from "./time.js";

interface Slot { start: number; end: number; day: string }
interface Placed { itemId: string; start: number; end: number; day: string }

const MINUTE = 60_000;
const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;

export class DefaultStrategy implements PlanningStrategy {
  constructor(private readonly config: PlannerConfig = PLANNER_DEFAULTS) {}

  plan(input: PlanInput): PlanResult {
    const { now, settings } = input;
    const { blockMinutes } = this.config;
    const nowMs = now.getTime();

    const plannable = input.items
      .filter((i): i is PlanItem & { dueAt: string } => !i.done && i.dueAt !== null && Date.parse(i.dueAt) > nowMs)
      .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt) || (a.kind === b.kind ? 0 : a.kind === "exam" ? -1 : 1));

    const slots = this.buildSlots(settings, now, plannable);
    const busy = input.busy.map(toRange);
    const accepted: Placed[] = input.accepted.map((b) => {
      const start = Date.parse(b.startsAt);
      return { itemId: b.itemId, start, end: Date.parse(b.endsAt), day: this.studyDayOf(settings, start) };
    });
    const proposed: Placed[] = [];
    const dayUsed = new Map<string, number>();
    for (const a of accepted) dayUsed.set(a.day, (dayUsed.get(a.day) ?? 0) + (a.end - a.start) / MINUTE);

    const shortfalls: Shortfall[] = [];
    for (const item of plannable) {
      const dueMs = Date.parse(item.dueAt);
      const acceptedMinutes = accepted.filter((a) => a.itemId === item.id).reduce((sum, a) => sum + (a.end - a.start) / MINUTE, 0);
      const needed = Math.ceil((item.studyMinutes - acceptedMinutes) / blockMinutes);
      if (needed <= 0) continue;

      const rejected = input.rejected.filter((r) => r.itemId === item.id).map(toRange);
      const itemDays = new Set([...accepted, ...proposed].filter((p) => p.itemId === item.id).map((p) => p.day));
      const usable = (s: Slot) =>
        s.start >= nowMs && s.end <= dueMs &&
        !busy.some((b) => overlaps(s.start, s.end, b.start, b.end)) &&
        !accepted.some((a) => overlaps(s.start, s.end, a.start, a.end)) &&
        !proposed.some((p) => overlaps(s.start, s.end, p.start, p.end)) &&
        !rejected.some((r) => overlaps(s.start, s.end, r.start, r.end)) &&
        (dayUsed.get(s.day) ?? 0) + blockMinutes <= settings.dailyLimitMinutes &&
        !itemDays.has(s.day);

      const earliestByDay = new Map<string, Slot>();
      for (const s of slots) {
        if (!usable(s)) continue;
        const current = earliestByDay.get(s.day);
        if (!current || s.start < current.start) earliestByDay.set(s.day, s);
      }
      const allDays = [...earliestByDay.keys()].sort();
      const earliestLead = addDays(localDateOf(new Date(dueMs), settings.timeZone), -this.config.leadDays[item.kind]);
      let days = allDays.filter((d) => d >= earliestLead);
      if (days.length < needed) days = allDays;

      const n = Math.min(needed, days.length);
      const last = days.length - 1;
      let placed = 0;
      for (let k = 0; k < n; k++) {
        const index = n === 1 ? last : last - Math.round((k * last) / (n - 1));
        const slot = slots.find((s) => s.day === days[index] && usable(s));
        if (!slot) continue;
        proposed.push({ itemId: item.id, start: slot.start, end: slot.end, day: slot.day });
        itemDays.add(slot.day);
        dayUsed.set(slot.day, (dayUsed.get(slot.day) ?? 0) + blockMinutes);
        placed++;
      }
      if (placed < needed) {
        shortfalls.push({
          itemId: item.id, itemTitle: item.title, dueAt: item.dueAt,
          neededMinutes: item.studyMinutes, plannedMinutes: acceptedMinutes + placed * blockMinutes,
        });
      }
    }

    const result: BlockRef[] = proposed
      .map((p) => ({ itemId: p.itemId, startsAt: new Date(p.start).toISOString(), endsAt: new Date(p.end).toISOString() }))
      .sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
    return { proposed: result, shortfalls };
  }

  /** The study-window range for a local date, or null when that day is off. */
  private windowRange(settings: PlannerSettings, day: string): { start: number; end: number } | null {
    const w = settings.windows.find((x) => x.weekday === weekdayOf(day));
    if (!w || !w.enabled) return null;
    const endDay = minutesOf(w.end) <= minutesOf(w.start) ? addDays(day, 1) : day;
    return {
      start: zonedTimeToUtc(day, w.start, settings.timeZone).getTime(),
      end: zonedTimeToUtc(endDay, w.end, settings.timeZone).getTime(),
    };
  }

  private buildSlots(settings: PlannerSettings, now: Date, items: { dueAt: string }[]): Slot[] {
    if (items.length === 0) return [];
    const blockMs = this.config.blockMinutes * MINUTE;
    const lastDue = items.reduce((m, i) => Math.max(m, Date.parse(i.dueAt)), 0);
    const lastDay = localDateOf(new Date(lastDue), settings.timeZone);
    const slots: Slot[] = [];
    for (let day = addDays(localDateOf(now, settings.timeZone), -1); day <= lastDay; day = addDays(day, 1)) {
      const range = this.windowRange(settings, day);
      if (!range) continue;
      const previous = this.windowRange(settings, addDays(day, -1));
      for (let s = range.start; s + blockMs <= range.end; s += blockMs) {
        // An instant belongs to one study day: the previous day's range wins an overlap.
        if (previous && s >= previous.start && s < previous.end) continue;
        slots.push({ start: s, end: s + blockMs, day });
      }
    }
    return slots;
  }

  /** The window day whose range contains the instant, else its local date. */
  private studyDayOf(settings: PlannerSettings, start: number): string {
    const local = localDateOf(new Date(start), settings.timeZone);
    for (const day of [addDays(local, -1), local]) {
      const range = this.windowRange(settings, day);
      if (range && start >= range.start && start < range.end) return day;
    }
    return local;
  }
}

function toRange(i: { startsAt: string; endsAt: string }) {
  return { start: Date.parse(i.startsAt), end: Date.parse(i.endsAt) };
}

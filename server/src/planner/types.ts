export interface StudyWindow { weekday: number; enabled: boolean; start: string; end: string }
export interface PlannerSettings { timeZone: string; dailyLimitMinutes: number; windows: StudyWindow[] }
export interface Interval { startsAt: string; endsAt: string }
export interface BlockRef extends Interval { itemId: string }
export interface AcceptedBlock extends BlockRef { id: string }
export interface PlanItem {
  id: string; title: string; kind: "exam" | "assignment";
  dueAt: string | null; studyMinutes: number; done: boolean;
}
export interface PlanInput {
  now: Date; settings: PlannerSettings; items: PlanItem[];
  busy: Interval[]; accepted: AcceptedBlock[]; rejected: BlockRef[];
}
export interface Shortfall { itemId: string; itemTitle: string; dueAt: string; neededMinutes: number; plannedMinutes: number }
export interface PlanResult { proposed: BlockRef[]; shortfalls: Shortfall[] }
export interface PlanningStrategy { plan(input: PlanInput): PlanResult }

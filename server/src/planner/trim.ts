import type { AcceptedBlock, PlanItem } from "./types.js";

const MS_PER_MINUTE = 60_000;

/** Ids of accepted blocks that are no longer valid, in ascending start order. */
export function blocksToRemove(now: Date, items: PlanItem[], accepted: AcceptedBlock[]): string[] {
  const nowMs = now.getTime();
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const byStart = [...accepted].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const isFuture = (block: AcceptedBlock) => Date.parse(block.startsAt) >= nowMs;
  const minutesOf = (block: AcceptedBlock) =>
    (Date.parse(block.endsAt) - Date.parse(block.startsAt)) / MS_PER_MINUTE;

  const removed = new Set<string>();
  const kept = new Map<string, AcceptedBlock[]>();

  for (const block of byStart) {
    const item = itemsById.get(block.itemId);
    const inactive = !item || item.done || item.dueAt === null;
    if (inactive) {
      if (isFuture(block)) removed.add(block.id);
      continue;
    }
    if (Date.parse(block.endsAt) > Date.parse(item.dueAt!)) {
      removed.add(block.id);
      continue;
    }
    const list = kept.get(item.id) ?? [];
    list.push(block);
    kept.set(item.id, list);
  }

  for (const [itemId, blocks] of kept) {
    let total = blocks.reduce((sum, block) => sum + minutesOf(block), 0);
    const limit = itemsById.get(itemId)!.studyMinutes;
    for (const block of blocks) {
      if (total <= limit) break;
      if (!isFuture(block)) continue;
      removed.add(block.id);
      total -= minutesOf(block);
    }
  }

  return byStart.filter((block) => removed.has(block.id)).map((block) => block.id);
}

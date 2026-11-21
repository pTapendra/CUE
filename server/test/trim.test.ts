import { describe, expect, it } from "vitest";
import { blocksToRemove } from "../src/planner/trim.js";
import type { AcceptedBlock, PlanItem } from "../src/planner/types.js";

const NOW = new Date("2026-11-02T15:00:00Z");

function item(over: Partial<PlanItem> = {}): PlanItem {
  return {
    id: "a", title: "Essay", kind: "assignment",
    dueAt: "2026-11-20T00:00:00Z", studyMinutes: 120, done: false, ...over,
  };
}
function block(id: string, start: string, end: string, itemId = "a"): AcceptedBlock {
  return { id, itemId, startsAt: start, endsAt: end };
}

describe("blocksToRemove", () => {
  it("removes future blocks of done, undated and missing items", () => {
    const items = [
      item({ id: "done", done: true }),
      item({ id: "undated", dueAt: null }),
    ];
    const accepted = [
      block("d-future", "2026-11-03T18:00:00Z", "2026-11-03T19:00:00Z", "done"),
      block("d-past", "2026-11-01T18:00:00Z", "2026-11-01T19:00:00Z", "done"),
      block("u-future", "2026-11-04T18:00:00Z", "2026-11-04T19:00:00Z", "undated"),
      block("m-future", "2026-11-05T18:00:00Z", "2026-11-05T19:00:00Z", "gone"),
    ];
    expect(blocksToRemove(NOW, items, accepted)).toEqual(["d-future", "u-future", "m-future"]);
  });

  it("removes blocks that end after a moved deadline", () => {
    const items = [item({ dueAt: "2026-11-10T00:00:00Z", studyMinutes: 240 })];
    const accepted = [
      block("ok", "2026-11-09T18:00:00Z", "2026-11-09T19:00:00Z"),
      block("late", "2026-11-09T23:30:00Z", "2026-11-10T00:30:00Z"),
      block("after", "2026-11-12T18:00:00Z", "2026-11-12T19:00:00Z"),
    ];
    expect(blocksToRemove(NOW, items, accepted)).toEqual(["late", "after"]);
  });

  it("lowering study time removes extra future blocks, earliest first", () => {
    const accepted = [
      block("past", "2026-11-01T18:00:00Z", "2026-11-01T19:00:00Z"),
      block("f1", "2026-11-03T18:00:00Z", "2026-11-03T19:00:00Z"),
      block("f2", "2026-11-04T18:00:00Z", "2026-11-04T19:00:00Z"),
    ];
    expect(blocksToRemove(NOW, [item({ studyMinutes: 120 })], accepted)).toEqual(["f1"]);
  });

  it("zero hours removes every future block and keeps past ones", () => {
    const accepted = [
      block("past", "2026-11-01T18:00:00Z", "2026-11-01T19:00:00Z"),
      block("f1", "2026-11-03T18:00:00Z", "2026-11-03T19:00:00Z"),
      block("f2", "2026-11-04T18:00:00Z", "2026-11-04T19:00:00Z"),
    ];
    expect(blocksToRemove(NOW, [item({ studyMinutes: 0 })], accepted)).toEqual(["f1", "f2"]);
  });
});

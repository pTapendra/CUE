import { describe, expect, it } from "vitest";
import { addDays, isValidTimeZone, localDateOf, minutesOf, weekdayOf, zonedTimeToUtc } from "../src/planner/time.js";

describe("time-zone helpers", () => {
  it("converts study times across daylight saving in Chicago", () => {
    expect(zonedTimeToUtc("2026-10-31", "18:00", "America/Chicago").toISOString()).toBe("2026-10-31T23:00:00.000Z");
    expect(zonedTimeToUtc("2026-11-02", "18:00", "America/Chicago").toISOString()).toBe("2026-11-03T00:00:00.000Z");
    expect(zonedTimeToUtc("2026-11-01", "01:30", "America/Chicago").toISOString()).toBe("2026-11-01T06:30:00.000Z");
    expect(zonedTimeToUtc("2027-03-14", "02:30", "America/Chicago").toISOString()).toBe("2027-03-14T08:30:00.000Z");
    expect(zonedTimeToUtc("2027-03-14", "18:00", "America/Chicago").toISOString()).toBe("2027-03-14T23:00:00.000Z");
    expect(localDateOf(new Date("2026-11-03T03:00:00Z"), "America/Chicago")).toBe("2026-11-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekdayOf("2026-11-02")).toBe(1);
    expect(minutesOf("18:30")).toBe(1110);
    expect(isValidTimeZone("America/Chicago")).toBe(true);
    expect(isValidTimeZone("Mars/Base")).toBe(false);
  });

  it("converts study times across daylight saving east of UTC", () => {
    expect(zonedTimeToUtc("2026-10-25", "02:30", "Europe/Berlin").toISOString()).toBe("2026-10-25T00:30:00.000Z");
    expect(zonedTimeToUtc("2027-03-28", "02:30", "Europe/Berlin").toISOString()).toBe("2027-03-28T01:30:00.000Z");
    expect(zonedTimeToUtc("2026-10-25", "01:30", "Europe/London").toISOString()).toBe("2026-10-25T00:30:00.000Z");
    expect(zonedTimeToUtc("2026-11-02", "18:00", "Asia/Kolkata").toISOString()).toBe("2026-11-02T12:30:00.000Z");
  });
});

import { describe, expect, it } from "vitest";
import { windowsAt } from "../lib/policy/windows";
import { dayKey, dayStartOf } from "../lib/timezone";

const ist = (s: string) => Date.parse(`${s}+05:30`);

describe("windowsAt (Asia/Kolkata)", () => {
  it("starts the day at 00:00 IST, not UTC", () => {
    const w = windowsAt(ist("2026-09-22T00:10:00"));
    expect(w.dayStart).toBe(ist("2026-09-22T00:00:00"));
    expect(w.nextDay).toBe(ist("2026-09-23T00:00:00"));
  });

  it("rolls the day over exactly at midnight IST", () => {
    expect(windowsAt(ist("2026-09-22T23:59:59.999")).dayStart).toBe(ist("2026-09-22T00:00:00"));
    expect(windowsAt(ist("2026-09-23T00:00:00")).dayStart).toBe(ist("2026-09-23T00:00:00"));
  });

  it("starts the week on Monday 00:00 IST", () => {
    // 2026-09-21 is a Monday.
    expect(windowsAt(ist("2026-09-27T23:59:59")).weekStart).toBe(ist("2026-09-21T00:00:00"));
    const monday = windowsAt(ist("2026-09-28T00:00:00"));
    expect(monday.weekStart).toBe(ist("2026-09-28T00:00:00"));
    expect(monday.nextWeek).toBe(ist("2026-10-05T00:00:00"));
  });
});

describe("windowsAt across DST", () => {
  const ny = "America/New_York";

  it("makes the spring-forward day 23 hours long, still midnight to midnight", () => {
    // 2026-03-08: clocks jump from 02:00 EST to 03:00 EDT.
    const w = windowsAt(Date.parse("2026-03-08T12:00:00-04:00"), ny);
    expect(w.dayStart).toBe(Date.parse("2026-03-08T00:00:00-05:00"));
    expect(w.nextDay).toBe(Date.parse("2026-03-09T00:00:00-04:00"));
    expect(w.nextDay - w.dayStart).toBe(23 * 3600_000);
  });

  it("keeps the week on Monday local midnight when it spans the change", () => {
    const w = windowsAt(Date.parse("2026-03-10T09:00:00-04:00"), ny);
    expect(w.weekStart).toBe(Date.parse("2026-03-09T00:00:00-04:00"));
    const before = windowsAt(Date.parse("2026-03-07T09:00:00-05:00"), ny);
    expect(before.weekStart).toBe(Date.parse("2026-03-02T00:00:00-05:00"));
    expect(before.nextWeek).toBe(Date.parse("2026-03-09T00:00:00-04:00"));
  });

  it("finds local midnight when UTC midnight falls after a DST change", () => {
    // Auckland leaves NZDT (+13) for NZST (+12) at 14:00Z on 2026-04-04, between local midnight
    // on the 5th (11:00Z) and UTC midnight, so the first offset guess is wrong.
    const start = dayStartOf("2026-04-05", "Pacific/Auckland");
    expect(start).toBe(Date.parse("2026-04-05T00:00:00+13:00"));
    expect(dayKey(start, "Pacific/Auckland")).toBe("2026-04-05");
    expect(dayKey(start - 1, "Pacific/Auckland")).toBe("2026-04-04");
  });
});

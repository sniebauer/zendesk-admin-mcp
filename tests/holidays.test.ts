import { describe, it, expect } from "vitest";
import { holidayMatches, planHolidays } from "../src/holidays.js";

const nye = { name: "New Year's Day", start_date: "2027-01-01", end_date: "2027-01-01" };

describe("holidayMatches", () => {
  it("matches on the full name + start + end triple", () => {
    expect(holidayMatches(nye, { id: 1, ...nye })).toBe(true);
  });

  it("does not match when only the name differs", () => {
    expect(holidayMatches(nye, { id: 1, ...nye, name: "NYE" })).toBe(false);
  });

  it("does not match when only a date differs", () => {
    expect(holidayMatches(nye, { id: 1, ...nye, end_date: "2027-01-02" })).toBe(false);
    expect(holidayMatches(nye, { id: 1, ...nye, start_date: "2026-01-01" })).toBe(false);
  });

  it("ignores surrounding whitespace and case in the name", () => {
    expect(holidayMatches(nye, { id: 1, ...nye, name: "  new year's day " })).toBe(true);
  });
});

describe("planHolidays", () => {
  const thanksgiving = {
    name: "Thanksgiving",
    start_date: "2027-11-25",
    end_date: "2027-11-26",
  };

  it("creates everything when the schedule has no holidays", () => {
    const plan = planHolidays([nye, thanksgiving], []);
    expect(plan.toCreate).toEqual([nye, thanksgiving]);
    expect(plan.skipped).toEqual([]);
  });

  it("skips exact matches and creates the rest", () => {
    const plan = planHolidays([nye, thanksgiving], [{ id: 5, ...nye }]);
    expect(plan.toCreate).toEqual([thanksgiving]);
    expect(plan.skipped).toEqual([nye]);
  });

  it("skips everything on a full re-run", () => {
    const plan = planHolidays(
      [nye, thanksgiving],
      [
        { id: 5, ...nye },
        { id: 6, ...thanksgiving },
      ]
    );
    expect(plan.toCreate).toEqual([]);
    expect(plan.skipped).toEqual([nye, thanksgiving]);
  });

  it("deduplicates repeats within the desired list", () => {
    const plan = planHolidays([nye, nye], []);
    expect(plan.toCreate).toEqual([nye]);
    expect(plan.skipped).toEqual([nye]);
  });
});

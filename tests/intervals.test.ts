import { describe, it, expect } from "vitest";
import {
  parseHHMM,
  formatHHMM,
  toIntervals,
  fromIntervals,
  DAY_BASE,
} from "../src/intervals.js";

describe("parseHHMM", () => {
  it("converts HH:MM to minutes past midnight", () => {
    expect(parseHHMM("00:00")).toBe(0);
    expect(parseHHMM("09:00")).toBe(540);
    expect(parseHHMM("17:30")).toBe(1050);
    expect(parseHHMM("23:59")).toBe(1439);
  });

  it("accepts 24:00 as end-of-day", () => {
    expect(parseHHMM("24:00")).toBe(1440);
  });

  it("rejects malformed input", () => {
    expect(() => parseHHMM("9:00")).toThrow(/HH:MM/);
    expect(() => parseHHMM("24:01")).toThrow(/HH:MM/);
    expect(() => parseHHMM("25:00")).toThrow(/HH:MM/);
    expect(() => parseHHMM("09:60")).toThrow(/HH:MM/);
    expect(() => parseHHMM("")).toThrow(/HH:MM/);
  });
});

describe("formatHHMM", () => {
  it("is the inverse of parseHHMM", () => {
    for (const t of ["00:00", "09:00", "17:30", "23:59", "24:00"]) {
      expect(formatHHMM(parseHHMM(t))).toBe(t);
    }
  });
});

describe("toIntervals", () => {
  it("converts the documented Tuesday 09:00 case to 3420", () => {
    expect(toIntervals({ tuesday: [{ start: "09:00", end: "17:00" }] })).toEqual([
      { start_time: 3420, end_time: 3900 },
    ]);
  });

  it("offsets each day by its base and emits in day order", () => {
    const result = toIntervals({
      tuesday: [{ start: "09:00", end: "17:00" }],
      monday: [{ start: "09:00", end: "17:00" }],
    });
    expect(result).toEqual([
      { start_time: 1980, end_time: 2460 },
      { start_time: 3420, end_time: 3900 },
    ]);
  });

  it("supports multiple ranges in one day, sorted by start", () => {
    expect(
      toIntervals({
        monday: [
          { start: "13:00", end: "17:00" },
          { start: "09:00", end: "12:00" },
        ],
      })
    ).toEqual([
      { start_time: 1980, end_time: 2160 },
      { start_time: 2220, end_time: 2460 },
    ]);
  });

  it("handles the Sunday base (0) and a Saturday shift ending at 24:00", () => {
    expect(toIntervals({ sunday: [{ start: "00:00", end: "01:00" }] })).toEqual([
      { start_time: 0, end_time: 60 },
    ]);
    // saturday base 8640 + 23:00 (1380) = 10020; end 8640 + 24:00 (1440) = 10080.
    expect(toIntervals({ saturday: [{ start: "23:00", end: "24:00" }] })).toEqual([
      { start_time: 10020, end_time: 10080 },
    ]);
  });

  it("rejects an interval that would span calendar days", () => {
    expect(() => toIntervals({ friday: [{ start: "22:00", end: "02:00" }] })).toThrow(
      /can't span calendar days/
    );
  });

  it("rejects a zero-length interval", () => {
    expect(() => toIntervals({ monday: [{ start: "09:00", end: "09:00" }] })).toThrow(
      /can't span calendar days/
    );
  });

  it("rejects an unknown day name", () => {
    expect(() => toIntervals({ funday: [{ start: "09:00", end: "10:00" }] } as any)).toThrow(
      /unknown day/i
    );
  });
});

describe("fromIntervals", () => {
  it("round-trips a full week", () => {
    const hours = {
      monday: [{ start: "09:00", end: "17:00" }],
      tuesday: [{ start: "09:00", end: "17:00" }],
      saturday: [{ start: "10:00", end: "14:00" }],
    };
    expect(fromIntervals(toIntervals(hours))).toEqual(hours);
  });

  it("decodes the documented 3420 value back to Tuesday 09:00", () => {
    expect(fromIntervals([{ start_time: 3420, end_time: 3900 }])).toEqual({
      tuesday: [{ start: "09:00", end: "17:00" }],
    });
  });

  it("groups multiple ranges under the same day", () => {
    expect(
      fromIntervals([
        { start_time: 1980, end_time: 2160 },
        { start_time: 2220, end_time: 2460 },
      ])
    ).toEqual({
      monday: [
        { start: "09:00", end: "12:00" },
        { start: "13:00", end: "17:00" },
      ],
    });
  });
});

describe("DAY_BASE", () => {
  it("spaces days 1440 minutes apart starting at Sunday 0", () => {
    expect(DAY_BASE).toEqual({
      sunday: 0,
      monday: 1440,
      tuesday: 2880,
      wednesday: 4320,
      thursday: 5760,
      friday: 7200,
      saturday: 8640,
    });
  });
});

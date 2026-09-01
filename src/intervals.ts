/**
 * Zendesk encodes schedule intervals as minutes elapsed since Sunday midnight
 * (Tuesday 09:00 = 3420). That is an opaque encoding rather than a
 * self-describing structure, so — unlike the conditions DSL — it gets a real
 * converter instead of passthrough. A wrong number here silently shifts SLA math.
 */

export type DayName =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

export interface TimeRange {
  start: string;
  end: string;
}

export type Hours = Partial<Record<DayName, TimeRange[]>>;

export interface Interval {
  start_time: number;
  end_time: number;
}

export const DAY_ORDER = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const satisfies readonly DayName[];

export const DAY_BASE: Record<DayName, number> = {
  sunday: 0,
  monday: 1440,
  tuesday: 2880,
  wednesday: 4320,
  thursday: 5760,
  friday: 7200,
  saturday: 8640,
};

const MINUTES_PER_DAY = 1440;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "09:00" -> 540. Accepts the special end-of-day value "24:00" -> 1440. */
export function parseHHMM(value: string): number {
  if (value === "24:00") return MINUTES_PER_DAY;
  const m = HHMM.exec(value);
  if (!m) {
    throw new Error(`Invalid time '${value}': expected HH:MM in 00:00-23:59 (or 24:00).`);
  }
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 540 -> "09:00". 1440 -> "24:00". */
export function formatHHMM(minutes: number): string {
  if (minutes === MINUTES_PER_DAY) return "24:00";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Human-readable weekly hours -> Zendesk intervals, ordered Sunday->Saturday. */
export function toIntervals(hours: Hours): Interval[] {
  for (const day of Object.keys(hours)) {
    if (!(day in DAY_BASE)) {
      throw new Error(
        `Unknown day '${day}'. Use lowercase day names: ${DAY_ORDER.join(", ")}.`
      );
    }
  }

  const out: Interval[] = [];
  for (const day of DAY_ORDER) {
    const ranges = hours[day];
    if (!ranges) continue;
    const base = DAY_BASE[day];
    const dayIntervals = ranges.map((r) => {
      const start = parseHHMM(r.start);
      const end = parseHHMM(r.end);
      if (end <= start) {
        throw new Error(
          `Invalid ${day} interval ${r.start}-${r.end}: intervals can't span calendar days. ` +
            `Split an overnight shift into two, e.g. friday 22:00-24:00 and saturday 00:00-02:00.`
        );
      }
      return { start_time: base + start, end_time: base + end };
    });
    dayIntervals.sort((a, b) => a.start_time - b.start_time);
    out.push(...dayIntervals);
  }
  return out;
}

/** Zendesk intervals -> human-readable weekly hours. Inverse of toIntervals. */
export function fromIntervals(intervals: Interval[]): Hours {
  const out: Hours = {};
  for (const { start_time, end_time } of intervals) {
    const dayIndex = Math.floor(start_time / MINUTES_PER_DAY);
    const day = DAY_ORDER[dayIndex];
    if (!day) {
      throw new Error(`Interval start_time ${start_time} is outside the 0-10079 week range.`);
    }
    const base = DAY_BASE[day];
    (out[day] ??= []).push({
      start: formatHHMM(start_time - base),
      end: formatHHMM(end_time - base),
    });
  }
  for (const day of Object.keys(out) as DayName[]) {
    out[day]!.sort((a, b) => parseHHMM(a.start) - parseHHMM(b.start));
  }
  return out;
}

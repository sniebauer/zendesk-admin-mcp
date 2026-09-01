import { describe, it, expect } from "vitest";
import {
  schedulesUrl,
  intervalsUrl,
  holidaysUrl,
  ZendeskHttpError,
} from "../src/schedules.js";
import { parseZendeskError } from "../src/zendesk.js";

describe("schedulesUrl", () => {
  it("builds the collection URL", () => {
    expect(schedulesUrl("acme")).toBe(
      "https://acme.zendesk.com/api/v2/business_hours/schedules.json"
    );
  });
  it("builds the member URL", () => {
    expect(schedulesUrl("acme", 7)).toBe(
      "https://acme.zendesk.com/api/v2/business_hours/schedules/7.json"
    );
  });
});

describe("intervalsUrl", () => {
  it("targets the dedicated intervals endpoint", () => {
    expect(intervalsUrl("acme", 7)).toBe(
      "https://acme.zendesk.com/api/v2/business_hours/schedules/7/intervals.json"
    );
  });
});

describe("holidaysUrl", () => {
  it("builds the collection URL under its parent schedule", () => {
    expect(holidaysUrl("acme", 7)).toBe(
      "https://acme.zendesk.com/api/v2/business_hours/schedules/7/holidays.json"
    );
  });
  it("builds the member URL", () => {
    expect(holidaysUrl("acme", 7, 12)).toBe(
      "https://acme.zendesk.com/api/v2/business_hours/schedules/7/holidays/12.json"
    );
  });
  it("appends server-side date filters", () => {
    const url = holidaysUrl("acme", 7, undefined, {
      start_date: "2027-01-01",
      end_date: "2027-12-31",
    });
    expect(url).toContain("start_date=2027-01-01");
    expect(url).toContain("end_date=2027-12-31");
  });
  it("omits the query string entirely when no filters are given", () => {
    expect(holidaysUrl("acme", 7)).not.toContain("?");
  });
});

describe("ZendeskHttpError", () => {
  it("is shaped so parseZendeskError can read it like a node-zendesk error", () => {
    const err = new ZendeskHttpError(404, { error: "RecordNotFound", description: "Not found" }, {});
    const parsed = parseZendeskError(err);
    expect(parsed.status).toBe(404);
    expect(parsed.message).toBe("404 RecordNotFound: Not found");
  });

  it("surfaces Retry-After so the 429 retry can honor it", () => {
    const err = new ZendeskHttpError(429, { error: "TooManyRequests" }, { "retry-after": "3" });
    expect(parseZendeskError(err).retryAfterSec).toBe(3);
  });

  it("gets the credential hint on 401/403", () => {
    const err = new ZendeskHttpError(403, { error: "Forbidden" }, {});
    expect(parseZendeskError(err).message).toMatch(/check ZENDESK_API_TOKEN/);
  });
});

import { setScheduleHoursInput, setHolidaysInput } from "../src/tools/schedules.js";

describe("setScheduleHoursInput", () => {
  it("requires schedule_id and hours, defaulting require_confirm to false", () => {
    expect(() => setScheduleHoursInput.parse({ hours: {} })).toThrow();
    expect(
      setScheduleHoursInput.parse({
        schedule_id: 1,
        hours: { monday: [{ start: "09:00", end: "17:00" }] },
      })
    ).toEqual({
      schedule_id: 1,
      hours: { monday: [{ start: "09:00", end: "17:00" }] },
      require_confirm: false,
    });
  });

  it("rejects an unknown day key", () => {
    expect(() =>
      setScheduleHoursInput.parse({
        schedule_id: 1,
        hours: { funday: [{ start: "09:00", end: "17:00" }] },
      })
    ).toThrow();
  });
});

describe("setHolidaysInput", () => {
  const holiday = { name: "New Year's Day", start_date: "2027-01-01", end_date: "2027-01-01" };

  it("requires a non-empty schedule_ids and holidays list", () => {
    expect(() => setHolidaysInput.parse({ schedule_ids: [], holidays: [holiday] })).toThrow();
    expect(() => setHolidaysInput.parse({ schedule_ids: [1], holidays: [] })).toThrow();
  });

  it("enforces ISO YYYY-MM-DD dates", () => {
    expect(() =>
      setHolidaysInput.parse({
        schedule_ids: [1],
        holidays: [{ ...holiday, start_date: "01/01/2027" }],
      })
    ).toThrow();
  });

  it("accepts a valid batch and defaults require_confirm to false", () => {
    expect(setHolidaysInput.parse({ schedule_ids: [1, 2], holidays: [holiday] })).toEqual({
      schedule_ids: [1, 2],
      holidays: [holiday],
      require_confirm: false,
    });
  });
});

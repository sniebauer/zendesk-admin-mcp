import type { ZendeskConfig } from "./zendesk.js";
import { zendeskRequest } from "./http.js";
import type { CrudClient } from "./crud.js";
import type { Interval } from "./intervals.js";

// Re-exported so existing importers keep working after the move to src/http.ts.
export { ZendeskHttpError } from "./http.js";

const API_BASE = "/api/v2/business_hours/schedules";

export function schedulesUrl(subdomain: string, id?: number): string {
  const tail = id === undefined ? "" : `/${id}`;
  return `https://${subdomain}.zendesk.com${API_BASE}${tail}.json`;
}

export function intervalsUrl(subdomain: string, scheduleId: number): string {
  return `https://${subdomain}.zendesk.com${API_BASE}/${scheduleId}/intervals.json`;
}

export function holidaysUrl(
  subdomain: string,
  scheduleId: number,
  holidayId?: number,
  query?: { start_date?: string; end_date?: string }
): string {
  const tail = holidayId === undefined ? "" : `/${holidayId}`;
  const url = new URL(
    `https://${subdomain}.zendesk.com${API_BASE}/${scheduleId}/holidays${tail}.json`
  );
  if (query?.start_date) url.searchParams.set("start_date", query.start_date);
  if (query?.end_date) url.searchParams.set("end_date", query.end_date);
  return url.toString();
}

/** Business hours are plan-gated; make that legible instead of a bare 403/404. */
const PLAN_HINT =
  "If this persists, confirm that Business Hours (schedules) is included in your Zendesk plan.";

export function scheduleRequest<T>(
  cfg: ZendeskConfig,
  method: string,
  url: string,
  body?: unknown
): Promise<T> {
  return zendeskRequest<T>(cfg, method, url, body, { planHint: PLAN_HINT });
}

/** CrudClient adapter for schedules, so registerCrud can drive them unchanged. */
export function schedulesClient(cfg: ZendeskConfig): CrudClient {
  return {
    list: async () => {
      const body = await scheduleRequest<{ schedules: unknown[] }>(
        cfg,
        "GET",
        schedulesUrl(cfg.subdomain)
      );
      return body.schedules ?? [];
    },
    show: async (id: number) => {
      const body = await scheduleRequest<{ schedule: unknown }>(
        cfg,
        "GET",
        schedulesUrl(cfg.subdomain, id)
      );
      return { response: {}, result: body.schedule };
    },
    create: async (data: unknown) => {
      const body = await scheduleRequest<{ schedule: unknown }>(
        cfg,
        "POST",
        schedulesUrl(cfg.subdomain),
        data
      );
      return { response: {}, result: body.schedule };
    },
    update: async (id: number, data: unknown) => {
      const body = await scheduleRequest<{ schedule: unknown }>(
        cfg,
        "PUT",
        schedulesUrl(cfg.subdomain, id),
        data
      );
      return { response: {}, result: body.schedule };
    },
    delete: async (id: number) =>
      scheduleRequest<void>(cfg, "DELETE", schedulesUrl(cfg.subdomain, id)),
  };
}

/** CrudClient adapter for one schedule's holidays. */
export function holidaysClient(cfg: ZendeskConfig, scheduleId: number): CrudClient {
  return {
    list: async (query?: { start_date?: string; end_date?: string }) =>
      listHolidays(cfg, scheduleId, query),
    show: async (id: number) => {
      const body = await scheduleRequest<{ holiday: unknown }>(
        cfg,
        "GET",
        holidaysUrl(cfg.subdomain, scheduleId, id)
      );
      return { response: {}, result: body.holiday };
    },
    create: async (data: unknown) => {
      const body = await scheduleRequest<{ holiday: unknown }>(
        cfg,
        "POST",
        holidaysUrl(cfg.subdomain, scheduleId),
        data
      );
      return { response: {}, result: body.holiday };
    },
    update: async (id: number, data: unknown) => {
      const body = await scheduleRequest<{ holiday: unknown }>(
        cfg,
        "PUT",
        holidaysUrl(cfg.subdomain, scheduleId, id),
        data
      );
      return { response: {}, result: body.holiday };
    },
    delete: async (id: number) =>
      scheduleRequest<void>(cfg, "DELETE", holidaysUrl(cfg.subdomain, scheduleId, id)),
  };
}

export async function listHolidays(
  cfg: ZendeskConfig,
  scheduleId: number,
  query?: { start_date?: string; end_date?: string }
): Promise<any[]> {
  const body = await scheduleRequest<{ holidays: any[] }>(
    cfg,
    "GET",
    holidaysUrl(cfg.subdomain, scheduleId, undefined, query)
  );
  return body.holidays ?? [];
}

/** Intervals are writable ONLY here — not on create, not on update. */
export async function setIntervals(
  cfg: ZendeskConfig,
  scheduleId: number,
  intervals: Interval[]
): Promise<unknown> {
  const body = await scheduleRequest<{ intervals: unknown }>(
    cfg,
    "PUT",
    intervalsUrl(cfg.subdomain, scheduleId),
    { intervals }
  );
  return body.intervals;
}

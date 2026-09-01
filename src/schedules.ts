import type { ZendeskConfig } from "./zendesk.js";
import { assertZendeskHost, basicAuthHeader } from "./audit.js";
import type { CrudClient } from "./crud.js";
import type { Interval } from "./intervals.js";

const API_BASE = "/api/v2/business_hours/schedules";

/**
 * Shaped to match what node-zendesk throws, so parseZendeskError/withZendeskError
 * can consume it unchanged — which is how this path inherits the single 429 retry.
 * src/audit.ts predates this and calls fetch directly; it is intentionally left alone.
 */
export class ZendeskHttpError extends Error {
  override name = "ZendeskHttpError";
  statusCode: number;
  result: { error: string; description?: string };
  headers: Record<string, string>;

  constructor(
    statusCode: number,
    result: { error: string; description?: string },
    headers: Record<string, string>
  ) {
    super(`${statusCode} ${result.error}`);
    this.statusCode = statusCode;
    this.result = result;
    this.headers = headers;
  }
}

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
function planHint(status: number): string | undefined {
  return status === 403 || status === 404
    ? "If this persists, confirm that Business Hours (schedules) is included in your Zendesk plan."
    : undefined;
}

export async function scheduleRequest<T>(
  cfg: ZendeskConfig,
  method: string,
  url: string,
  body?: unknown
): Promise<T> {
  assertZendeskHost(new URL(url), cfg.subdomain);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: basicAuthHeader(cfg.email, cfg.token),
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (!res.ok) {
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });
    const text = await res.text().catch(() => "");
    let error = res.statusText || "Error";
    let description = text.slice(0, 300) || undefined;
    try {
      const parsed = JSON.parse(text) as { error?: unknown; description?: string };
      if (typeof parsed.error === "string") error = parsed.error;
      else if (parsed.error && typeof parsed.error === "object") {
        error = (parsed.error as { title?: string }).title ?? error;
      }
      if (parsed.description) description = parsed.description;
    } catch {
      // Non-JSON body; keep the truncated text as the description.
    }
    const hint = planHint(res.status);
    if (hint) description = description ? `${description} — ${hint}` : hint;
    throw new ZendeskHttpError(res.status, { error, description }, headers);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
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
    list: async () => listHolidays(cfg, scheduleId),
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

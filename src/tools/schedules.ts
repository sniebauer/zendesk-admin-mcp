import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCrud, registerNestedCrud } from "../crud.js";
import { loadConfig, withZendeskError } from "../zendesk.js";
import { runGuarded } from "../confirm.js";
import { schedulesClient, holidaysClient, listHolidays, setIntervals } from "../schedules.js";
import { toIntervals, fromIntervals, DAY_ORDER, type Hours } from "../intervals.js";
import { planHolidays, type ExistingHoliday, type HolidayInput } from "../holidays.js";

const adminBase = (sub: string) => `https://${sub}.zendesk.com/admin`;
// Deep-link only; every other adminUrl builder in this repo hardcodes its path
// the same way.
const schedulesAdminUrl = (sub: string) => `${adminBase(sub)}/objects-rules/rules/schedules`;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const timeRange = z.object({
  start: z.string().describe("HH:MM, 24-hour, e.g. '09:00'"),
  end: z.string().describe("HH:MM, 24-hour. '24:00' means end of day."),
});

const hoursSchema = z
  .object(Object.fromEntries(DAY_ORDER.map((d) => [d, z.array(timeRange).optional()])))
  .strict()
  .describe(
    "Weekly hours keyed by lowercase day name. An interval can't cross midnight — split an overnight shift across two days."
  );

export const setScheduleHoursInput = z.object({
  schedule_id: z.number().int().positive(),
  hours: hoursSchema,
  require_confirm: z.boolean().default(false),
});

const holidaySchema = z.object({
  name: z.string().min(1),
  start_date: z.string().regex(ISO_DATE, "Use ISO YYYY-MM-DD"),
  end_date: z.string().regex(ISO_DATE, "Use ISO YYYY-MM-DD"),
});

export const setHolidaysInput = z.object({
  schedule_ids: z
    .array(z.number().int().positive())
    .min(1)
    .describe("Every schedule the holidays should be applied to."),
  holidays: z.array(holidaySchema).min(1),
  require_confirm: z.boolean().default(false),
});

export function registerScheduleTools(server: McpServer) {
  registerCrud(server, {
    singular: "schedule",
    plural: "schedules",
    idType: "number",
    guardUpdate: true, // live-routing: schedule hours drive SLA math
    getClient: () => schedulesClient(loadConfig()),
    adminUrl: (sub) => schedulesAdminUrl(sub),
    dataHint:
      "Fields: name, time_zone. Intervals are NOT accepted here — Zendesk only allows hours to be set via zda_set_schedule_hours.",
    // The default summary keys drop time_zone, which is the field you most need.
    summaryKeys: ["id", "name", "time_zone", "updated_at"],
  });

  registerNestedCrud(server, {
    singular: "holiday",
    plural: "holidays",
    parent: { name: "schedule", idField: "schedule_id" },
    idType: "number",
    guardUpdate: false,
    getClient: (scheduleId) => holidaysClient(loadConfig(), scheduleId),
    adminUrl: (sub) => schedulesAdminUrl(sub),
    dataHint: "Fields: name, start_date, end_date (ISO YYYY-MM-DD).",
    summaryKeys: ["id", "name", "start_date", "end_date"],
    // Zendesk filters holidays server-side, so "everything for 2027" is one call.
    listFilters: {
      start_date: z
        .string()
        .regex(ISO_DATE, "Use ISO YYYY-MM-DD")
        .optional()
        .describe("Only holidays beginning on or after this date. Pair with end_date."),
      end_date: z
        .string()
        .regex(ISO_DATE, "Use ISO YYYY-MM-DD")
        .optional()
        .describe("Only holidays beginning on or before this date. Pair with start_date."),
    },
  });

  server.tool(
    "zda_set_schedule_hours",
    "Set a schedule's weekly business hours. Takes lowercase day names and HH:MM times and converts them to Zendesk's minute offsets. GUARDED: schedule hours drive SLA breach math on live tickets — call without require_confirm to preview, then re-call with require_confirm: true.",
    setScheduleHoursInput.shape,
    async (raw) => {
      const { schedule_id, hours, require_confirm } = setScheduleHoursInput.parse(raw);
      const cfg = loadConfig();
      const intervals = toIntervals(hours as Hours);
      const client = schedulesClient(cfg);
      return runGuarded({
        requireConfirm: require_confirm,
        action: `set business hours on schedule ${schedule_id}`,
        fetchCurrent: async () => {
          const { result } = await withZendeskError(() => client.show(schedule_id));
          const current = result as { intervals?: { start_time: number; end_time: number }[] };
          return {
            schedule: result,
            current_hours: current?.intervals ? fromIntervals(current.intervals) : undefined,
          };
        },
        proposed: { hours, intervals },
        execute: () =>
          withZendeskError(() => setIntervals(cfg, schedule_id, intervals)).then((applied) => ({
            schedule_id,
            hours,
            intervals: applied,
            _admin_url: schedulesAdminUrl(cfg.subdomain),
          })),
      });
    }
  );

  server.tool(
    "zda_set_holidays",
    "Apply a list of holidays to one or more schedules in a single operation — the annual holiday-calendar refresh. Idempotent: holidays already present (same name + start_date + end_date) are skipped, so a re-run after a partial failure is safe. GUARDED: call without require_confirm to preview exactly what would be created on each schedule, then re-call with require_confirm: true.",
    setHolidaysInput.shape,
    async (raw) => {
      const { schedule_ids, holidays, require_confirm } = setHolidaysInput.parse(raw);
      const cfg = loadConfig();

      const plans = async () =>
        Promise.all(
          schedule_ids.map(async (scheduleId) => {
            const existing = (await withZendeskError(() =>
              listHolidays(cfg, scheduleId)
            )) as ExistingHoliday[];
            return { scheduleId, ...planHolidays(holidays as HolidayInput[], existing) };
          })
        );

      return runGuarded({
        requireConfirm: require_confirm,
        action: `set ${holidays.length} holiday(s) on ${schedule_ids.length} schedule(s)`,
        fetchCurrent: async () => {
          const planned = await plans();
          return {
            schedules: planned.map((p) => ({
              schedule_id: p.scheduleId,
              would_create: p.toCreate,
              already_present: p.skipped.map((h) => h.name),
            })),
          };
        },
        proposed: { schedule_ids, holidays },
        execute: async () => {
          const planned = await plans();
          const results: unknown[] = [];
          for (const { scheduleId, toCreate, skipped } of planned) {
            const client = holidaysClient(cfg, scheduleId);
            const created: string[] = [];
            try {
              for (const holiday of toCreate) {
                await withZendeskError(() => client.create({ holiday }));
                created.push(holiday.name);
              }
            } catch (err) {
              // Report what actually landed. Zendesk has no transaction here, and the
              // idempotent match means a re-run finishes the job safely.
              results.push({
                schedule_id: scheduleId,
                created,
                skipped: skipped.map((h) => h.name),
                failed_after: created.length,
                error: (err as Error).message,
              });
              return {
                partial_failure: true,
                message:
                  "Some holidays were not created. Re-run this tool with the same input to finish — existing holidays are skipped automatically.",
                results,
              };
            }
            results.push({
              schedule_id: scheduleId,
              created,
              skipped: skipped.map((h) => h.name),
            });
          }
          return { results, _admin_url: schedulesAdminUrl(cfg.subdomain) };
        },
      });
    }
  );
}

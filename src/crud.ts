import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createZendeskClient, withZendeskError, loadConfig } from "./zendesk.js";
import { runGuarded, asTextResult } from "./confirm.js";

export type IdType = "number" | "string";

function idSchema(idType: IdType) {
  return idType === "number"
    ? z.number().int().positive().describe("Numeric object ID")
    : z.string().min(1).describe("String object ID");
}

export function makeCrudSchemas(idType: IdType) {
  const id = idSchema(idType);
  const data = z
    .record(z.any())
    .describe(
      "The resource's fields (passthrough) — e.g. title/name, conditions ({all,any} of {field,operator,value}), actions, etc. Pass the fields directly; do NOT wrap them in a {<resource>: ...} envelope — the server adds that automatically."
    );
  return {
    listInput: z.object({}),
    getInput: z.object({ id }),
    createInput: z.object({ data }),
    updateInput: z.object({ id, data, require_confirm: z.boolean().default(false) }),
    deleteInput: z.object({ id, require_confirm: z.boolean().default(false) }),
  };
}

/** Minimal shape of a node-zendesk CRUD sub-client. */
export interface CrudClient {
  list: (...args: any[]) => Promise<any>;
  show: (id: any) => Promise<{ response: unknown; result: unknown }>;
  create: (data: any) => Promise<{ response: unknown; result: unknown }>;
  update: (id: any, data: any) => Promise<{ response: unknown; result: unknown }>;
  delete: (id: any) => Promise<unknown>;
}

export interface CrudConfig {
  /** e.g. "trigger" */
  singular: string;
  /** e.g. "triggers" */
  plural: string;
  idType: IdType;
  /** true for live-routing objects (triggers, automations, SLA policies): updates are guarded. */
  guardUpdate: boolean;
  /** (client) => client.triggers */
  getClient: (client: ReturnType<typeof createZendeskClient>) => CrudClient;
  /** Builds the GUI admin URL for this object type. */
  adminUrl: (subdomain: string, id: string | number) => string;
  /** Extra guidance appended to the create/update data description. */
  dataHint?: string;
  /**
   * Fields to keep in the `list` response. Listing every object with its full
   * definition (conditions/actions bodies) blows past the MCP result-size cap
   * on real accounts, so `list` returns only these identifying fields; callers
   * use `get` for the full definition. Only keys actually present on an item
   * are emitted. Defaults to {@link DEFAULT_SUMMARY_KEYS}.
   */
  summaryKeys?: string[];
}

/** Identifying fields kept in `list` responses across every CRUD object type. */
export const DEFAULT_SUMMARY_KEYS = [
  "id",
  "title",
  "name",
  "active",
  "category_id",
  "position",
  "default",
  "updated_at",
];

/** Project one list item down to its identifying fields (present keys only). */
function summarize(item: unknown, keys: string[]): unknown {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;
  const src = item as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in src) out[key] = src[key];
  }
  // If none of the summary keys matched, fall back to the raw item so we never
  // silently drop an object we didn't recognize.
  return Object.keys(out).length ? out : item;
}

function withAdminUrl(subdomain: string, cfg: CrudConfig, id: string | number, result: unknown) {
  const adminUrl = cfg.adminUrl(subdomain, id);
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return { ...(result as Record<string, unknown>), _admin_url: adminUrl };
  }
  return { value: result, _admin_url: adminUrl };
}

export function registerCrud(server: McpServer, cfg: CrudConfig) {
  const s = makeCrudSchemas(cfg.idType);
  const hint = cfg.dataHint ? ` ${cfg.dataHint}` : "";

  const summaryKeys = cfg.summaryKeys ?? DEFAULT_SUMMARY_KEYS;
  server.tool(
    `zda_list_${cfg.plural}`,
    `List all Zendesk ${cfg.plural}. Returns a compact summary of each (${summaryKeys.join(
      ", "
    )}) to stay within response-size limits — call zda_get_${cfg.singular} for an item's full definition.`,
    s.listInput.shape,
    async () => {
      const client = cfg.getClient(createZendeskClient());
      const result = await withZendeskError(() => client.list());
      if (!Array.isArray(result)) return asTextResult(result);
      return asTextResult({
        count: result.length,
        fields: summaryKeys,
        note: `Compact summary — call zda_get_${cfg.singular} for an item's full definition.`,
        [cfg.plural]: result.map((item) => summarize(item, summaryKeys)),
      });
    }
  );

  server.tool(
    `zda_get_${cfg.singular}`,
    `Fetch a single Zendesk ${cfg.singular} by ID, including its full definition.`,
    s.getInput.shape,
    async (raw) => {
      const { id } = s.getInput.parse(raw);
      const { subdomain } = loadConfig();
      const client = cfg.getClient(createZendeskClient());
      const { result } = await withZendeskError(() => client.show(id));
      return asTextResult(withAdminUrl(subdomain, cfg, id, result));
    }
  );

  server.tool(
    `zda_create_${cfg.singular}`,
    `Create a new Zendesk ${cfg.singular}.${hint}`,
    s.createInput.shape,
    async (raw) => {
      const { data } = s.createInput.parse(raw);
      const { subdomain } = loadConfig();
      const client = cfg.getClient(createZendeskClient());
      const { result } = await withZendeskError(() => client.create({ [cfg.singular]: data }));
      const id = (result as any)?.id ?? "new";
      return asTextResult(withAdminUrl(subdomain, cfg, id, result));
    }
  );

  const updateDesc = cfg.guardUpdate
    ? `Update an existing Zendesk ${cfg.singular}. GUARDED: this object affects live ticket flow. Call without require_confirm to preview the current state; re-call with require_confirm: true to apply.${hint}`
    : `Update an existing Zendesk ${cfg.singular}.${hint}`;

  server.tool(`zda_update_${cfg.singular}`, updateDesc, s.updateInput.shape, async (raw) => {
    const { id, data, require_confirm } = s.updateInput.parse(raw);
    const { subdomain } = loadConfig();
    const client = cfg.getClient(createZendeskClient());
    if (cfg.guardUpdate) {
      return runGuarded({
        requireConfirm: require_confirm,
        action: `update ${cfg.singular} ${id}`,
        fetchCurrent: () => withZendeskError(() => client.show(id)).then((r) => r.result),
        proposed: data,
        execute: () =>
          withZendeskError(() => client.update(id, { [cfg.singular]: data })).then((r) =>
            withAdminUrl(subdomain, cfg, id, r.result)
          ),
      });
    }
    const { result } = await withZendeskError(() => client.update(id, { [cfg.singular]: data }));
    return asTextResult(withAdminUrl(subdomain, cfg, id, result));
  });

  server.tool(
    `zda_delete_${cfg.singular}`,
    `Delete a Zendesk ${cfg.singular}. GUARDED: call without require_confirm to preview the object that would be deleted; re-call with require_confirm: true to apply.`,
    s.deleteInput.shape,
    async (raw) => {
      const { id, require_confirm } = s.deleteInput.parse(raw);
      const client = cfg.getClient(createZendeskClient());
      return runGuarded({
        requireConfirm: require_confirm,
        action: `delete ${cfg.singular} ${id}`,
        fetchCurrent: () => withZendeskError(() => client.show(id)).then((r) => r.result),
        execute: () =>
          withZendeskError(() => client.delete(id)).then(() => ({ deleted: true, id })),
      });
    }
  );
}

/** Input schemas for a parent-scoped resource (e.g. a schedule's holidays). */
export function makeNestedCrudSchemas(parentIdField: string, idType: IdType) {
  const id = idSchema(idType);
  const parentId = z.number().int().positive().describe("Parent object's numeric ID");
  const data = z
    .record(z.any())
    .describe(
      "The resource's fields (passthrough). Pass the fields directly; do NOT wrap them in a {<resource>: ...} envelope — the server adds that automatically."
    );
  return {
    listInput: z.object({ [parentIdField]: parentId }),
    getInput: z.object({ [parentIdField]: parentId, id }),
    createInput: z.object({ [parentIdField]: parentId, data }),
    updateInput: z.object({
      [parentIdField]: parentId,
      id,
      data,
      require_confirm: z.boolean().default(false),
    }),
    deleteInput: z.object({
      [parentIdField]: parentId,
      id,
      require_confirm: z.boolean().default(false),
    }),
  };
}

export interface NestedCrudConfig {
  /** e.g. "holiday" */
  singular: string;
  /** e.g. "holidays" */
  plural: string;
  /** The owning resource, e.g. { name: "schedule", idField: "schedule_id" }. */
  parent: { name: string; idField: string };
  idType: IdType;
  guardUpdate: boolean;
  /** Builds a CrudClient bound to one parent. */
  getClient: (parentId: number) => CrudClient;
  adminUrl: (subdomain: string, parentId: number, id: string | number) => string;
  dataHint?: string;
  summaryKeys?: string[];
}

function withNestedAdminUrl(
  subdomain: string,
  cfg: NestedCrudConfig,
  parentId: number,
  id: string | number,
  result: unknown
) {
  const adminUrl = cfg.adminUrl(subdomain, parentId, id);
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return { ...(result as Record<string, unknown>), _admin_url: adminUrl };
  }
  return { value: result, _admin_url: adminUrl };
}

/**
 * Sibling of registerCrud for resources nested under a parent
 * (/schedules/{schedule_id}/holidays/{id}). Kept separate rather than folding a
 * `parent?` branch into registerCrud so the nine existing flat resources are
 * provably unaffected; the shared helpers above keep it DRY.
 */
export function registerNestedCrud(server: McpServer, cfg: NestedCrudConfig) {
  const s = makeNestedCrudSchemas(cfg.parent.idField, cfg.idType);
  const hint = cfg.dataHint ? ` ${cfg.dataHint}` : "";
  const pid = cfg.parent.idField;
  const summaryKeys = cfg.summaryKeys ?? DEFAULT_SUMMARY_KEYS;

  server.tool(
    `zda_list_${cfg.plural}`,
    `List all Zendesk ${cfg.plural} for one ${cfg.parent.name}. Returns a compact summary of each (${summaryKeys.join(
      ", "
    )}) — call zda_get_${cfg.singular} for an item's full definition.`,
    s.listInput.shape,
    async (raw) => {
      const parsed = s.listInput.parse(raw) as Record<string, number>;
      const client = cfg.getClient(parsed[pid]!);
      const result = await withZendeskError(() => client.list());
      if (!Array.isArray(result)) return asTextResult(result);
      return asTextResult({
        count: result.length,
        fields: summaryKeys,
        [cfg.plural]: result.map((item) => summarize(item, summaryKeys)),
      });
    }
  );

  server.tool(
    `zda_get_${cfg.singular}`,
    `Fetch a single Zendesk ${cfg.singular} by ID from its ${cfg.parent.name}.`,
    s.getInput.shape,
    async (raw) => {
      const parsed = s.getInput.parse(raw) as Record<string, any>;
      const { subdomain } = loadConfig();
      const client = cfg.getClient(parsed[pid]);
      const { result } = await withZendeskError(() => client.show(parsed.id));
      return asTextResult(withNestedAdminUrl(subdomain, cfg, parsed[pid], parsed.id, result));
    }
  );

  server.tool(
    `zda_create_${cfg.singular}`,
    `Create a new Zendesk ${cfg.singular} on a ${cfg.parent.name}.${hint}`,
    s.createInput.shape,
    async (raw) => {
      const parsed = s.createInput.parse(raw) as Record<string, any>;
      const { subdomain } = loadConfig();
      const client = cfg.getClient(parsed[pid]);
      const { result } = await withZendeskError(() =>
        client.create({ [cfg.singular]: parsed.data })
      );
      const id = (result as any)?.id ?? "new";
      return asTextResult(withNestedAdminUrl(subdomain, cfg, parsed[pid], id, result));
    }
  );

  const updateDesc = cfg.guardUpdate
    ? `Update an existing Zendesk ${cfg.singular}. GUARDED: call without require_confirm to preview the current state; re-call with require_confirm: true to apply.${hint}`
    : `Update an existing Zendesk ${cfg.singular}.${hint}`;

  server.tool(`zda_update_${cfg.singular}`, updateDesc, s.updateInput.shape, async (raw) => {
    const parsed = s.updateInput.parse(raw) as Record<string, any>;
    const { subdomain } = loadConfig();
    const client = cfg.getClient(parsed[pid]);
    const apply = () =>
      withZendeskError(() => client.update(parsed.id, { [cfg.singular]: parsed.data })).then((r) =>
        withNestedAdminUrl(subdomain, cfg, parsed[pid], parsed.id, r.result)
      );
    if (cfg.guardUpdate) {
      return runGuarded({
        requireConfirm: parsed.require_confirm,
        action: `update ${cfg.singular} ${parsed.id} on ${cfg.parent.name} ${parsed[pid]}`,
        fetchCurrent: () => withZendeskError(() => client.show(parsed.id)).then((r) => r.result),
        proposed: parsed.data,
        execute: apply,
      });
    }
    return asTextResult(await apply());
  });

  server.tool(
    `zda_delete_${cfg.singular}`,
    `Delete a Zendesk ${cfg.singular} from its ${cfg.parent.name}. GUARDED: call without require_confirm to preview the object that would be deleted; re-call with require_confirm: true to apply.`,
    s.deleteInput.shape,
    async (raw) => {
      const parsed = s.deleteInput.parse(raw) as Record<string, any>;
      const client = cfg.getClient(parsed[pid]);
      return runGuarded({
        requireConfirm: parsed.require_confirm,
        action: `delete ${cfg.singular} ${parsed.id} from ${cfg.parent.name} ${parsed[pid]}`,
        fetchCurrent: () => withZendeskError(() => client.show(parsed.id)).then((r) => r.result),
        execute: () =>
          withZendeskError(() => client.delete(parsed.id)).then(() => ({
            deleted: true,
            id: parsed.id,
            [pid]: parsed[pid],
          })),
      });
    }
  );
}

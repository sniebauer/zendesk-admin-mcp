import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createZendeskClient, withZendeskError, loadConfig } from "./zendesk.js";
import { runGuarded, asTextResult, type ToolTextResult } from "./confirm.js";

// `confirm.ts` (Task 4) types its results as the strict `ToolTextResult` interface,
// which is runtime-identical to but not structurally assignable to the SDK's
// `CallToolResult` (the latter carries an index signature). Coerce at the tool
// boundary so handlers satisfy the SDK's `ToolCallback` return type.
const toolResult = (r: ToolTextResult): CallToolResult => r as CallToolResult;

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
      "The resource object (passthrough). Include the fields Zendesk expects for this object — e.g. title/name, conditions ({all,any} of {field,operator,value}), actions, etc."
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
}

function withAdminUrl(subdomain: string, cfg: CrudConfig, id: string | number, result: unknown) {
  return { ...(result as object), _admin_url: cfg.adminUrl(subdomain, id) };
}

export function registerCrud(server: McpServer, cfg: CrudConfig) {
  const s = makeCrudSchemas(cfg.idType);
  const hint = cfg.dataHint ? ` ${cfg.dataHint}` : "";

  server.tool(
    `zda_list_${cfg.plural}`,
    `List all Zendesk ${cfg.plural}.`,
    s.listInput.shape,
    async () => {
      const client = cfg.getClient(createZendeskClient());
      const result = await withZendeskError(() => client.list());
      return toolResult(asTextResult(result));
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
      return toolResult(asTextResult(withAdminUrl(subdomain, cfg, id, result)));
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
      const { result } = await withZendeskError(() => client.create(data));
      const id = (result as any)?.id ?? "new";
      return toolResult(asTextResult(withAdminUrl(subdomain, cfg, id, result)));
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
      return toolResult(
        await runGuarded({
          requireConfirm: require_confirm,
          action: `update ${cfg.singular} ${id}`,
          fetchCurrent: () => withZendeskError(() => client.show(id)).then((r) => r.result),
          proposed: data,
          execute: () =>
            withZendeskError(() => client.update(id, data)).then((r) =>
              withAdminUrl(subdomain, cfg, id, r.result)
            ),
        })
      );
    }
    const { result } = await withZendeskError(() => client.update(id, data));
    return toolResult(asTextResult(withAdminUrl(subdomain, cfg, id, result)));
  });

  server.tool(
    `zda_delete_${cfg.singular}`,
    `Delete a Zendesk ${cfg.singular}. GUARDED: call without require_confirm to preview the object that would be deleted; re-call with require_confirm: true to apply.`,
    s.deleteInput.shape,
    async (raw) => {
      const { id, require_confirm } = s.deleteInput.parse(raw);
      const client = cfg.getClient(createZendeskClient());
      return toolResult(
        await runGuarded({
          requireConfirm: require_confirm,
          action: `delete ${cfg.singular} ${id}`,
          fetchCurrent: () => withZendeskError(() => client.show(id)).then((r) => r.result),
          execute: () =>
            withZendeskError(() => client.delete(id)).then(() => ({ deleted: true, id })),
        })
      );
    }
  );
}

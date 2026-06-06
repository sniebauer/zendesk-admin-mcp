import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerCrud } from "../crud.js";
import { createZendeskClient, withZendeskError, loadConfig } from "../zendesk.js";
import { runGuarded } from "../confirm.js";

const adminBase = (sub: string) => `https://${sub}.zendesk.com/admin`;

export const reorderTriggersInput = z.object({
  trigger_ids: z
    .array(z.number().int().positive())
    .min(1)
    .describe("Trigger IDs in the desired new order (full list, first to last)."),
  require_confirm: z.boolean().default(false),
});

export function registerBusinessRuleTools(server: McpServer) {
  registerCrud(server, {
    singular: "trigger",
    plural: "triggers",
    idType: "number",
    guardUpdate: true,
    getClient: (c) => (c as any).triggers,
    adminUrl: (sub) => `${adminBase(sub)}/objects-rules/rules/triggers`,
    dataHint: "Common fields: title, conditions {all,any}, actions, active, category_id.",
  });

  registerCrud(server, {
    singular: "automation",
    plural: "automations",
    idType: "number",
    guardUpdate: true,
    getClient: (c) => (c as any).automations,
    adminUrl: (sub) => `${adminBase(sub)}/objects-rules/rules/automations`,
    dataHint: "Common fields: title, conditions {all,any}, actions, active. Automations are time-based.",
  });

  registerCrud(server, {
    singular: "macro",
    plural: "macros",
    idType: "number",
    guardUpdate: false,
    getClient: (c) => (c as any).macros,
    adminUrl: (sub) => `${adminBase(sub)}/workspaces/agent-workspace/macros`,
    dataHint: "Common fields: title, actions, active, restriction.",
  });

  registerCrud(server, {
    singular: "view",
    plural: "views",
    idType: "number",
    guardUpdate: false,
    getClient: (c) => (c as any).views,
    adminUrl: (sub) => `${adminBase(sub)}/workspaces/agent-workspace/views`,
    dataHint: "Common fields: title, conditions {all,any}, execution (columns/sorting), active, restriction.",
  });

  registerCrud(server, {
    singular: "sla_policy",
    plural: "sla_policies",
    idType: "number",
    guardUpdate: true,
    getClient: (c) => (c as any).policies,
    adminUrl: (sub) => `${adminBase(sub)}/objects-rules/rules/slas`,
    dataHint: "Common fields: title, description, filter {all,any}, policy_metrics (priority/metric/target/business_hours).",
  });

  server.tool(
    "zda_reorder_triggers",
    "Reorder triggers. Trigger order determines evaluation precedence and is a common source of silent routing bugs. GUARDED: call without require_confirm to preview the current order; re-call with require_confirm: true to apply. Provide the COMPLETE ordered list of trigger IDs.",
    reorderTriggersInput.shape,
    async (raw) => {
      const { trigger_ids, require_confirm } = reorderTriggersInput.parse(raw);
      loadConfig(); // validate creds early
      const client = (createZendeskClient() as any).triggers;
      return runGuarded({
        requireConfirm: require_confirm,
        action: "reorder triggers",
        fetchCurrent: () => withZendeskError(() => client.list()),
        proposed: { trigger_ids },
        execute: () =>
          withZendeskError(() => client.reorder(trigger_ids)).then(() => ({
            reordered: true,
            trigger_ids,
          })),
      });
    }
  );
}

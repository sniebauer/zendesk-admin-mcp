import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCrud } from "../crud.js";

const adminBase = (sub: string) => `https://${sub}.zendesk.com/admin`;

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
}

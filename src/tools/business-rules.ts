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
}

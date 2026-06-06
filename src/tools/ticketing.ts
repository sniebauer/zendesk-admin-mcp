import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCrud } from "../crud.js";

const adminBase = (sub: string) => `https://${sub}.zendesk.com/admin`;

export function registerTicketingTools(server: McpServer) {
  registerCrud(server, {
    singular: "group",
    plural: "groups",
    idType: "number",
    guardUpdate: false,
    getClient: (c) => (c as any).groups,
    adminUrl: (sub) => `${adminBase(sub)}/people/team/groups`,
    dataHint: "Common fields: name, description, default, is_public.",
  });

  registerCrud(server, {
    singular: "ticket_field",
    plural: "ticket_fields",
    idType: "number",
    guardUpdate: false,
    getClient: (c) => (c as any).ticketfields,
    adminUrl: (sub) => `${adminBase(sub)}/objects-rules/tickets/ticket-fields`,
    dataHint: "Common fields: type, title, description, required, active, custom_field_options (for dropdowns).",
  });

  registerCrud(server, {
    singular: "ticket_form",
    plural: "ticket_forms",
    idType: "number",
    guardUpdate: false,
    getClient: (c) => (c as any).ticketforms,
    adminUrl: (sub) => `${adminBase(sub)}/objects-rules/tickets/ticket-forms`,
    dataHint: "Common fields: name, display_name, ticket_field_ids (ordered), active, end_user_visible.",
  });

  registerCrud(server, {
    singular: "webhook",
    plural: "webhooks",
    idType: "string",
    guardUpdate: false,
    getClient: (c) => (c as any).webhooks,
    adminUrl: (sub) => `${adminBase(sub)}/apps-integrations/webhooks/webhooks`,
    dataHint: "Common fields: name, endpoint, http_method, request_format, status, subscriptions, authentication.",
  });
}

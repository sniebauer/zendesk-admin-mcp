import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerBusinessRuleTools } from "./tools/business-rules.js";
import { registerTicketingTools } from "./tools/ticketing.js";
import { registerAuditTools } from "./tools/audit.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "zendesk-admin-mcp",
    version: "0.1.0",
  });

  registerBusinessRuleTools(server);
  registerTicketingTools(server);
  registerAuditTools(server);

  return server;
}

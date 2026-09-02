import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerBusinessRuleTools } from "./tools/business-rules.js";
import { registerTicketingTools } from "./tools/ticketing.js";
import { registerAuditTools } from "./tools/audit.js";
import { registerInventoryTools } from "./tools/inventory.js";
import { registerScheduleTools } from "./tools/schedules.js";

// Read the real version at runtime rather than hardcoding it — a stale
// serverInfo.version is worse than none, since it's the field you inspect to
// work out which build a client is actually running. package.json can't be
// imported directly: rootDir is "src", so pulling in a file above it would
// break the dist layout.
const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

export function createServer(): McpServer {
  const server = new McpServer({
    name: "zendesk-admin-mcp",
    version,
  });

  registerBusinessRuleTools(server);
  registerTicketingTools(server);
  registerAuditTools(server);
  registerInventoryTools(server);
  registerScheduleTools(server);

  return server;
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function createServer(): McpServer {
  return new McpServer({
    name: "zendesk-admin-mcp",
    version: "0.1.0",
  });
}

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "../zendesk.js";
import { fetchAuditLogs } from "../audit.js";
import { asTextResult } from "../confirm.js";

export const auditLogsInput = z.object({
  source_type: z
    .string()
    .optional()
    .describe("Filter by object type, e.g. 'trigger', 'automation', 'macro', 'view', 'user', 'group'."),
  actor_id: z.string().optional().describe("Filter by the acting user's ID."),
  created_after: z.string().optional().describe("ISO 8601 timestamp; only events at/after this time."),
  created_before: z.string().optional().describe("ISO 8601 timestamp; only events at/before this time."),
});

export const auditLogsForObjectInput = z.object({
  source_type: z
    .string()
    .min(1)
    .describe("Object type, e.g. 'trigger', 'automation', 'macro', 'view'."),
  source_id: z.string().min(1).describe("The object's ID."),
});

export function registerAuditTools(server: McpServer) {
  server.tool(
    "zda_audit_logs",
    "Read the Zendesk audit log (who changed what, when). Filter by source_type, actor_id, and time window. Read-only. Requires Zendesk Enterprise. Use this to verify a change landed or to detect config drift.",
    auditLogsInput.shape,
    async (raw) => {
      const { source_type, actor_id, created_after, created_before } = auditLogsInput.parse(raw);
      const cfg = loadConfig();
      const data = await fetchAuditLogs(cfg.subdomain, cfg.email, cfg.token, {
        source_type,
        actor_id,
        created_after,
        created_before,
      });
      return asTextResult(data);
    }
  );

  server.tool(
    "zda_audit_logs_for_object",
    "Read all audit-log events for a specific object (by source_type + source_id). Read-only. Requires Zendesk Enterprise. The natural 'did my change land / what happened to this trigger' lookup.",
    auditLogsForObjectInput.shape,
    async (raw) => {
      const { source_type, source_id } = auditLogsForObjectInput.parse(raw);
      const cfg = loadConfig();
      const data = await fetchAuditLogs(cfg.subdomain, cfg.email, cfg.token, {
        source_type,
        source_id,
      });
      return asTextResult(data);
    }
  );
}

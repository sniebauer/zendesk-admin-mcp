import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createZendeskClient, withZendeskError } from "../zendesk.js";
import { asTextResult } from "../confirm.js";

const noArgs = z.object({});

export function registerInventoryTools(server: McpServer) {
  server.tool(
    "zda_account_settings",
    "Read the Zendesk account settings (branding, tickets, agents, etc.). Read-only.",
    noArgs.shape,
    async () => {
      const client = createZendeskClient() as any;
      const { result } = await withZendeskError(
        () => client.accountsettings.show() as Promise<{ result: unknown }>
      );
      return asTextResult(result);
    }
  );

  server.tool(
    "zda_list_apps",
    "List installed Zendesk Marketplace apps (installations) and their settings. Read-only.",
    noArgs.shape,
    async () => {
      const client = createZendeskClient() as any;
      const result = await withZendeskError(() => client.installations.list());
      return asTextResult(result);
    }
  );

  server.tool(
    "zda_list_brands",
    "List the brands configured on this Zendesk account. Read-only.",
    noArgs.shape,
    async () => {
      const client = createZendeskClient() as any;
      const result = await withZendeskError(() => client.brand.list());
      return asTextResult(result);
    }
  );

  server.tool(
    "zda_list_agent_roles",
    "List the custom agent roles defined on this account (Enterprise). Read-only.",
    noArgs.shape,
    async () => {
      const client = createZendeskClient() as any;
      const result = await withZendeskError(() => client.customagentroles.list());
      return asTextResult(result);
    }
  );

  server.tool(
    "zda_list_tags",
    "List the most-used tags across the account. Read-only.",
    noArgs.shape,
    async () => {
      const client = createZendeskClient() as any;
      const result = await withZendeskError(() => client.tags.list());
      return asTextResult(result);
    }
  );

  server.tool(
    "zda_list_locales",
    "List the locales available/enabled on this account. Read-only.",
    noArgs.shape,
    async () => {
      const client = createZendeskClient() as any;
      const result = await withZendeskError(() => client.locales.list());
      return asTextResult(result);
    }
  );
}

# @sniebauer/zendesk-admin-mcp

Local [MCP](https://modelcontextprotocol.io/) server for **Zendesk admin/config** work — the companion to [`@sniebauer/zendesk-mcp`](https://github.com/sniebauer/zendesk-mcp) (day-to-day support).

66 tools: full CRUD on triggers, automations, macros, views, SLA policies, groups, ticket fields, ticket forms, webhooks, and schedules (business hours) with their holidays; a read-only audit log; and a read-only inventory of account settings, installed apps, brands, agent roles, tags, and locales.

Destructive and live-routing writes (deletes, and updates to triggers/automations/SLAs/trigger-order) are **guarded** with a preview-then-confirm step.

## Install

### Claude Desktop

1. Open your Claude Desktop config:
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

2. Add a `zendesk-admin` entry under `mcpServers`:

   ```json
   {
     "mcpServers": {
       "zendesk-admin": {
         "command": "npx",
         "args": ["-y", "@sniebauer/zendesk-admin-mcp"]
       }
     }
   }
   ```

3. Capture credentials (skip if you already ran setup for `@sniebauer/zendesk-mcp` — they share the same config file):

   ```bash
   npx -y @sniebauer/zendesk-admin-mcp setup
   ```

   You'll be prompted for your Zendesk subdomain, email, and an API token (generate at `https://<your-subdomain>.zendesk.com/admin/apps-integrations/apis/api-tokens`). Stored at `~/.config/zendesk-mcp/config.json` (mode 0600).

4. Restart Claude Desktop.

### Claude Code

Same, but the config file is `~/.claude.json`.

## Shared credentials

This package reads the **same** `~/.config/zendesk-mcp/config.json` as `@sniebauer/zendesk-mcp`. Run `setup` once (from either package) and both servers are authenticated. Env vars (`ZENDESK_SUBDOMAIN` / `ZENDESK_EMAIL` / `ZENDESK_API_TOKEN`) override the file.

> **Heads up:** a Zendesk API token carries your full account permissions. This server can modify live business rules. The `require_confirm` guard (below) is the safety net — there is no read-only token scope in Zendesk.

## The `require_confirm` guard

Guarded operations — every `delete`, every `update` to **triggers / automations / SLA policies / schedules**, plus `zda_reorder_triggers`, `zda_set_schedule_hours`, and `zda_set_holidays` — do not execute on the first call. Instead they return the object's **current state** (and, for updates, the proposed change) and ask you to re-invoke with `require_confirm: true`. This forces a deliberate two-step on anything that can break live ticket flow.

Creates and updates to lower-risk objects (macros, views, groups, fields, forms, webhooks) execute directly.

## Tools (66)

**Business rules — full CRUD** (`list` / `get` / `create` / `update` / `delete` each)
- `zda_*_trigger(s)` · `zda_*_automation(s)` · `zda_*_macro(s)` · `zda_*_view(s)` · `zda_*_sla_policy/policies`
- `zda_reorder_triggers` — reorder trigger evaluation precedence (guarded)

**Ticketing config — full CRUD**
- `zda_*_group(s)` · `zda_*_ticket_field(s)` · `zda_*_ticket_form(s)` · `zda_*_webhook(s)`

**Schedules & holidays — full CRUD**
- `zda_*_schedule(s)` · `zda_*_holiday(s)` — holiday tools take a `schedule_id`; `zda_list_holidays` also accepts `start_date`/`end_date` for a server-side filter
- `zda_set_schedule_hours` — set weekly business hours with day names and `HH:MM` instead of Zendesk's minute offsets (guarded)
- `zda_set_holidays` — apply a holiday calendar to several schedules at once; idempotent, skips holidays already present (guarded)

**Audit (read-only, Enterprise)**
- `zda_audit_logs` — who changed what, filterable by type/actor/time
- `zda_audit_logs_for_object` — all events for one object

**Inventory (read-only)**
- `zda_account_settings` · `zda_list_apps` · `zda_list_brands` · `zda_list_agent_roles` · `zda_list_tags` · `zda_list_locales`

## Verify

```bash
npm test          # unit tests (schemas, error wrapper, guard, audit URL builder)
npm run smoke     # reads-only end-to-end (requires credentials)
```

## Caveats

- **Guarded writes need two calls.** First call previews; second call with `require_confirm: true` applies.
- **Audit logs need Zendesk Enterprise.** Non-Enterprise accounts get a 403 with a clear message.
- **Conditions DSL is passthrough.** Create/update accept the object's full structure (e.g. `conditions: {all,any}`); Zendesk validates semantics.
- **Credentials precedence.** Env vars override the shared config file.
- **Smoke test is reads-only.** It never creates or deletes config.
- **Business hours are plan-gated.** Schedules need a Zendesk plan that includes business hours; accounts without one get a clear message rather than a bare 403.
- **Schedule hours can't be set at create time.** Zendesk accepts only `name` and `time_zone` on create — use `zda_set_schedule_hours` afterward.

## License

MIT — see `LICENSE`.

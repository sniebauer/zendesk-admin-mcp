# Zendesk Admin MCP — Design

**Date:** 2026-06-05
**Owner:** Steve Niebauer
**Package:** `@sniebauer/zendesk-admin-mcp`
**Location:** `~/src/zendesk-admin-mcp/` (its own public git repo + npm package)

## Purpose

A second, admin-focused MCP server, sibling to the existing `@sniebauer/zendesk-mcp`
(day-to-day support). It exposes the **configuration/admin layer** of a Zendesk Support
instance: full CRUD on business-logic objects (triggers, automations, macros, views,
SLA policies, groups, ticket fields, ticket forms, webhooks), read-only inventory of
GUI-canonical surfaces (account settings, installed apps, brands, agent roles, tags,
locales), and the audit log as a verification/drift-detection lens.

Splitting admin into its own package keeps admin "loaded guns" out of the support
agent's tool list — different persona, different surface.

## Stack

- **Language:** TypeScript (Node 20+)
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **Zendesk client:** `node-zendesk` v5 (Promise-based)
- **Validation:** `zod` → JSON Schema for tool inputs
- **Config loader:** `dotenv` + shared config file
- **Tests:** `vitest`

## Auth — shared with the support package

Reads the **same** `~/.config/zendesk-mcp/config.json` that `@sniebauer/zendesk-mcp`
already writes. A teammate who ran the support `setup` is instantly authenticated here;
they only add a second `mcpServers` entry. The admin package also ships its own identical
`setup` subcommand for admins who install only this one.

Credential precedence (copied from the support package): env vars
(`ZENDESK_SUBDOMAIN` / `ZENDESK_EMAIL` / `ZENDESK_API_TOKEN`) override the config file.

> Note: Zendesk API tokens carry the caller's full permissions. There is no token scope
> that restricts to "admin read-only" — the `require_confirm` guard (below) is the
> mitigation, not the auth layer.

## Reused building blocks

Separate package, no shared library — these are **copied** from `@sniebauer/zendesk-mcp`:

- `loadConfig` / `createZendeskClient` / `withZendeskError` / `ZendeskMcpError` from
  `src/zendesk.ts` (error parsing, single 429 retry honoring `Retry-After`, 401/403
  credential hint).
- The raw-`fetch()` + exact-host-validation pattern from `src/tools/attachments.ts`,
  needed for the audit log (node-zendesk does not wrap `/api/v2/audit_logs`).

## Tool surface (54 tools)

Prefix `zda_` (admin) so the surface never visually collides with the support package's
`zd_` tools when both are loaded.

### CRUD objects — 9 objects × {list, get, create, update, delete} = 45

Identical 5-verb naming per object so the model learns the pattern once.

| Object | Tool stems | node-zendesk client |
|---|---|---|
| Triggers | `zda_list_triggers`, `zda_get_trigger`, `zda_create_trigger`, `zda_update_trigger`, `zda_delete_trigger` | `triggers` |
| Automations | `zda_{list,get,create,update,delete}_automation(s)` | `automations` |
| Macros | `zda_{...}_macro(s)` | `macros` |
| Views | `zda_{...}_view(s)` | `views` |
| SLA policies | `zda_{list,get,create,update,delete}_sla_policy/policies` | `policies` |
| Groups | `zda_{...}_group(s)` | `groups` |
| Ticket fields | `zda_{...}_ticket_field(s)` | `ticketfields` |
| Ticket forms | `zda_{...}_ticket_form(s)` | `ticketforms` |
| Webhooks | `zda_{...}_webhook(s)` | `webhooks` |

### Bonus write helper — 1

- `zda_reorder_triggers` — wraps the dedicated reorder API. Trigger ordering is the #1
  silent-routing-bug source, so it gets a first-class tool. **Guarded** (see below).

### Audit — 2 (raw `fetch` against `/api/v2/audit_logs.json`)

- `zda_audit_logs` — filter by actor, source type, and time window.
- `zda_audit_logs_for_object` — every audit event touching a given object id/type.

Natural "did that land?" follow-up to any write, and a standalone drift-detection feature
("what changed in our triggers last week?").

### Read-only inventory — 6

- `zda_account_settings` (`accountsettings`)
- `zda_list_apps` — installed Marketplace apps (`installations`)
- `zda_list_brands` (`brand`)
- `zda_list_agent_roles` — custom agent roles (`customagentroles`)
- `zda_list_tags` (`tags`)
- `zda_list_locales` (`locales`)

### Conditions DSL

`get`/`list` on triggers, automations, views, and SLA policies return Zendesk's nested
conditions structure (`all` / `any` arrays of `{ field, operator, value }`). Create/update
inputs accept this structure as a **passthrough `zod` object**, not a fully-typed operator
union. Full typing would balloon the schemas and still wouldn't catch semantic errors;
passthrough keeps schemas legible and lets Zendesk be the validator. (A future `validate`
read tool could add a dry-run check if needed — out of scope for v1.)

### GUI deep-links

Every CRUD tool response includes a deep-link to the object's admin page
(e.g. `https://<sub>.zendesk.com/admin/objects-rules/rules/triggers/{id}`) so the model
can point the user to the GUI for anything the API can't do.

## Safety — the `require_confirm` mechanism

**Guarded operations** (can silently break live ticket flow or destroy config):

- Every `delete` (all 9 objects).
- Every `update` to **live-routing** objects: triggers, automations, SLA policies.
- `zda_reorder_triggers`.

**Not guarded** — execute directly: all `create`s (can't clobber existing config) and
`update`s to macros / views / groups / ticket fields / ticket forms / webhooks
(lower blast radius, friction not worth it).

**Mechanism.** Each guarded tool takes `require_confirm: boolean` (default `false`):

- **`require_confirm` absent/false:** the tool does **not** execute. It fetches the
  object's current state and returns a preview — current state, plus (for updates) the
  proposed change — and instructs the caller to re-invoke with `require_confirm: true`.
  For `delete`, it returns the full object slated for deletion.
- **`require_confirm: true`:** it executes.

This forces a deliberate two-step on dangerous ops and hands the model the "before" state
to surface to the human before committing. Same preview-then-commit shape as
`zd_apply_macro_to_ticket` in the support package.

## Layout

```
zendesk-admin-mcp/
  package.json            # @sniebauer/zendesk-admin-mcp, bin: zendesk-admin-mcp
  tsconfig.json
  .gitignore              # node_modules, dist, .env
  .env.example
  LICENSE                 # MIT
  README.md               # Claude Desktop + Claude Code install, shared-auth note
  src/
    index.ts              # entry: dotenv, dispatch (setup vs MCP)
    setup.ts              # interactive credential CLI (writes shared config file)
    server.ts             # registers all tool groups
    zendesk.ts            # copied client + error wrapper + config loader
    audit.ts              # raw-fetch audit-log client + host validation
    confirm.ts            # require_confirm preview/guard helper (shared by guarded tools)
    tools/
      triggers.ts
      automations.ts
      macros.ts
      views.ts
      sla.ts
      groups.ts
      ticket-fields.ts
      ticket-forms.ts
      webhooks.ts
      audit.ts
      inventory.ts        # account settings, apps, brands, roles, tags, locales
  tests/
    schemas.test.ts       # input-schema validation for every tool
    zendesk.test.ts       # copied error wrapper / 429 retry
    audit.test.ts         # audit URL/query builder + host validation
  scripts/
    smoke.ts              # reads-only end-to-end (list triggers/automations, settings, audit)
```

## Error handling

All node-zendesk calls go through the copied `withZendeskError`: clean
`{ status, message }`, single retry on 429 (honoring `Retry-After`), 401/403 →
"check credentials" hint, no raw stack traces. The audit raw-`fetch` path validates the
host exactly against `<subdomain>.zendesk.com` before sending the Basic auth header
(copied from `attachments.ts`), and surfaces non-OK responses as legible errors.

## Testing

Test what we own, not the network:

- `tests/schemas.test.ts` — every tool's input schema: id constraints, required create
  fields, `require_confirm` default `false`, conditions-DSL passthrough accepts a
  representative nested `all`/`any` payload. Bulk of coverage.
- `tests/zendesk.test.ts` — copied error-wrapper core (shapes, single 429 retry,
  401/403 hint).
- `tests/audit.test.ts` — audit URL/query builder + exact-host validation guard.
- `scripts/smoke.ts` — manual, **reads-only** end-to-end: list triggers, list automations,
  pull account settings, fetch recent audit logs. Never exercises writes.

No mocked-HTTP tests for CRUD handlers (would verify the mock, not Zendesk). The
`require_confirm` preview branching is simple and covered by schema tests + smoke-time
hand-check.

## Distribution

Same as the support package: public GitHub repo `sniebauer/zendesk-admin-mcp`, published
to npm as `@sniebauer/zendesk-admin-mcp` with `publishConfig.access: public`,
`prepublishOnly` running build + tests. End users add a `zendesk-admin` entry to their
Claude Desktop / Claude Code config pointing at `npx -y @sniebauer/zendesk-admin-mcp`.

## Out of scope (v1)

- Writes to GUI-canonical surfaces (themes, apps install/config, SSO, most account
  settings, channel config) — read-only or not exposed.
- CRUD on user/org custom fields, dynamic content, group memberships, custom roles,
  brands, suspended tickets, satisfaction ratings — deferred to keep v1 under the
  tool-count threshold. (All available in node-zendesk for a v2.)
- A typed conditions-DSL validator / dry-run semantic check.
- Talk, Chat, Sell, Explore, Sunshine admin surfaces.

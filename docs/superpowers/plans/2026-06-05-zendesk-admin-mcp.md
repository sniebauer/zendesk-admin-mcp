# Zendesk Admin MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@sniebauer/zendesk-admin-mcp`, a standalone npm-published MCP server exposing full CRUD on 9 Zendesk business-logic objects, a read-only audit log + inventory surface, and a `require_confirm` guard on destructive/live-routing writes.

**Architecture:** TypeScript stdio MCP server. A single CRUD factory generates the 5 verbs (`list`/`get`/`create`/`update`/`delete`) for each of 9 objects from a small config; a shared `require_confirm` guard helper wraps destructive ops in a preview-then-commit flow. Audit logs use a raw `fetch()` client (node-zendesk doesn't wrap them). Reuses the support package's `loadConfig`/`withZendeskError` core (copied, not imported) and reads the same `~/.config/zendesk-mcp/config.json`.

**Tech Stack:** TypeScript (Node 20+), `@modelcontextprotocol/sdk`, `node-zendesk` v5 (Promise-based), `zod`, `dotenv`, `vitest`.

**Spec:** `~/src/zendesk-admin-mcp/docs/superpowers/specs/2026-06-05-zendesk-admin-mcp-design.md`

**Reference source:** the support package at `~/src/zendesk-mcp/` — copy `src/zendesk.ts`, `src/setup.ts`, `src/index.ts`, `tests/zendesk.test.ts` as starting points and adapt.

**Working directory:** `/Users/steveniebauer/src/zendesk-admin-mcp/` for all commands unless noted. The repo already exists with one commit (the design doc) on `main`.

---

## File map

| Path (relative to repo root) | Responsibility |
|---|---|
| `package.json` | `@sniebauer/zendesk-admin-mcp`, deps, scripts, publish config |
| `tsconfig.json` | TS config (ES2022, NodeNext, strict, outDir dist) |
| `.gitignore` | `node_modules/`, `dist/`, `.env` |
| `.env.example` | documents the 3 env vars (optional; config file is primary) |
| `LICENSE` | MIT, Steve Niebauer, 2026 |
| `README.md` | Claude Desktop + Claude Code install, shared-auth note, tool list |
| `src/index.ts` | entry: dotenv, dispatch `setup` vs MCP server |
| `src/setup.ts` | interactive credential CLI (writes shared config file) |
| `src/server.ts` | constructs `McpServer`, registers all tool groups |
| `src/zendesk.ts` | copied client factory + `withZendeskError` + config loader |
| `src/confirm.ts` | `runGuarded` preview/commit helper for guarded ops |
| `src/crud.ts` | `registerCrud(server, cfg)` factory — generates 5 CRUD tools |
| `src/audit.ts` | raw-`fetch` audit-log client + exact-host validation |
| `src/tools/business-rules.ts` | CRUD configs for triggers, automations, macros, views, SLA policies + `zda_reorder_triggers` |
| `src/tools/ticketing.ts` | CRUD configs for groups, ticket fields, ticket forms, webhooks |
| `src/tools/audit.ts` | `zda_audit_logs`, `zda_audit_logs_for_object` |
| `src/tools/inventory.ts` | account settings, apps, brands, agent roles, tags, locales (read-only) |
| `tests/zendesk.test.ts` | copied error-wrapper / 429 retry tests |
| `tests/confirm.test.ts` | guard preview-vs-execute behavior |
| `tests/crud.test.ts` | factory id-schema + data-schema validation |
| `tests/audit.test.ts` | audit URL/query builder + host validation |
| `scripts/smoke.ts` | reads-only end-to-end smoke test |

---

## Task 1: Scaffold the project

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `src/index.ts` (stub), `README.md` (stub)

- [ ] **Step 1: Create directories**

```bash
cd /Users/steveniebauer/src/zendesk-admin-mcp
mkdir -p src/tools tests scripts
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "@sniebauer/zendesk-admin-mcp",
  "version": "0.1.0",
  "description": "Admin/config MCP server for Zendesk Support — triggers, automations, macros, views, SLAs, groups, fields, forms, webhooks, audit logs. For Claude Desktop and Claude Code.",
  "type": "module",
  "bin": {
    "zendesk-admin-mcp": "dist/index.js"
  },
  "files": ["dist", "README.md", "LICENSE", ".env.example"],
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "start": "node dist/index.js",
    "setup": "node dist/index.js setup",
    "test": "vitest run",
    "test:watch": "vitest",
    "smoke": "tsx scripts/smoke.ts",
    "prepublishOnly": "npm run build && npm test"
  },
  "keywords": ["mcp", "model-context-protocol", "zendesk", "zendesk-admin", "claude", "claude-desktop", "claude-code"],
  "author": "Steve Niebauer",
  "license": "MIT",
  "repository": { "type": "git", "url": "git+https://github.com/sniebauer/zendesk-admin-mcp.git" },
  "homepage": "https://github.com/sniebauer/zendesk-admin-mcp#readme",
  "bugs": { "url": "https://github.com/sniebauer/zendesk-admin-mcp/issues" },
  "publishConfig": { "access": "public" },
  "engines": { "node": ">=20" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "dotenv": "^16.4.5",
    "node-zendesk": "^5.0.13",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

(Note: no `turndown` — admin MCP has no HTML→Markdown path.)

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests", "scripts"]
}
```

- [ ] **Step 4: Write `.gitignore`**

```
node_modules/
dist/
.env
*.log
.DS_Store
```

- [ ] **Step 5: Write `.env.example`**

```
# Optional — credentials can also come from the config file written by
# `npx -y @sniebauer/zendesk-admin-mcp setup` (~/.config/zendesk-mcp/config.json,
# shared with @sniebauer/zendesk-mcp). Env vars take precedence when set.
ZENDESK_SUBDOMAIN=
ZENDESK_EMAIL=
ZENDESK_API_TOKEN=
```

- [ ] **Step 6: Write stub `src/index.ts`**

```ts
console.error("zendesk-admin-mcp: not implemented yet");
process.exit(0);
```

- [ ] **Step 7: Write stub `README.md`**

```markdown
# @sniebauer/zendesk-admin-mcp

Admin/config MCP server for Zendesk Support. See `docs/superpowers/specs/2026-06-05-zendesk-admin-mcp-design.md`. Full docs added in the final task.
```

- [ ] **Step 8: Install dependencies**

Run: `cd /Users/steveniebauer/src/zendesk-admin-mcp && npm install`
Expected: `node_modules/` populated, no fatal errors.

- [ ] **Step 9: Verify stub builds and runs**

Run: `npm run build && node dist/index.js`
Expected: prints `zendesk-admin-mcp: not implemented yet`, exits 0.

- [ ] **Step 10: Commit**

```bash
cd /Users/steveniebauer/src/zendesk-admin-mcp
git add -A
git commit -m "zendesk-admin-mcp: scaffold project"
```

---

## Task 2: Copy the Zendesk client core + error wrapper

**Files:**
- Create: `src/zendesk.ts`, `tests/zendesk.test.ts`, `vitest.config.ts`

- [ ] **Step 1: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 2: Write `tests/zendesk.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { withZendeskError, parseZendeskError, ZendeskMcpError } from "../src/zendesk.js";

describe("parseZendeskError", () => {
  it("extracts status and message from a node-zendesk error", () => {
    const err = { statusCode: 404, result: { error: "RecordNotFound", description: "Not found" } };
    expect(parseZendeskError(err)).toEqual({
      status: 404,
      message: "404 RecordNotFound: Not found",
      retryAfterSec: undefined,
    });
  });

  it("flags 401 with a token hint", () => {
    const err = { statusCode: 401, result: { error: "Couldn't authenticate you" } };
    const parsed = parseZendeskError(err);
    expect(parsed.status).toBe(401);
    expect(parsed.message).toMatch(/ZENDESK_API_TOKEN/);
  });

  it("reads Retry-After on 429", () => {
    const err = { statusCode: 429, result: {}, headers: { "retry-after": "3" } };
    expect(parseZendeskError(err).retryAfterSec).toBe(3);
  });

  it("falls back to message on unknown shapes", () => {
    const err = new Error("boom");
    expect(parseZendeskError(err).message).toBe("boom");
  });
});

describe("withZendeskError", () => {
  it("returns the underlying result on success", async () => {
    const result = await withZendeskError(async () => ({ id: 1 }));
    expect(result).toEqual({ id: 1 });
  });

  it("retries once on 429 then succeeds", async () => {
    let calls = 0;
    const result = await withZendeskError(async () => {
      calls += 1;
      if (calls === 1) throw { statusCode: 429, result: {}, headers: { "retry-after": "0" } };
      return { ok: true };
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it("throws a ZendeskMcpError on a second 429", async () => {
    await expect(
      withZendeskError(async () => {
        throw { statusCode: 429, result: {}, headers: { "retry-after": "0" } };
      })
    ).rejects.toMatchObject({ name: "ZendeskMcpError", status: 429 });
  });
});
```

- [ ] **Step 3: Run tests, confirm they fail**

Run: `npm test`
Expected: failure — `src/zendesk.ts` does not exist.

- [ ] **Step 4: Write `src/zendesk.ts`**

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import zendesk from "node-zendesk";

export interface ZendeskConfig {
  subdomain: string;
  email: string;
  token: string;
}

// Shared with @sniebauer/zendesk-mcp — a user who ran either package's setup is
// authenticated for both.
const CONFIG_PATH = path.join(os.homedir(), ".config", "zendesk-mcp", "config.json");

interface FileConfig {
  subdomain?: string;
  email?: string;
  api_token?: string;
}

function loadFileConfig(): FileConfig {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as FileConfig;
  } catch {
    return {};
  }
}

export function loadConfig(): ZendeskConfig {
  const file = loadFileConfig();
  const subdomain = process.env.ZENDESK_SUBDOMAIN || file.subdomain;
  const email = process.env.ZENDESK_EMAIL || file.email;
  const token = process.env.ZENDESK_API_TOKEN || file.api_token;
  if (!subdomain || !email || !token) {
    throw new Error(
      `Missing Zendesk credentials. Run 'npx -y @sniebauer/zendesk-admin-mcp setup' to configure interactively, or set ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, and ZENDESK_API_TOKEN in your environment.`
    );
  }
  return { subdomain, email, token };
}

export function createZendeskClient(cfg = loadConfig()) {
  return zendesk.createClient({
    username: cfg.email,
    token: cfg.token,
    subdomain: cfg.subdomain,
    endpointUri: `https://${cfg.subdomain}.zendesk.com/api/v2`,
  });
}

export interface ParsedZendeskError {
  status: number | undefined;
  message: string;
  retryAfterSec: number | undefined;
}

export class ZendeskMcpError extends Error {
  override name = "ZendeskMcpError";
  status: number | undefined;
  constructor(parsed: ParsedZendeskError) {
    super(parsed.message);
    this.status = parsed.status;
  }
}

export function parseZendeskError(err: unknown): ParsedZendeskError {
  const e = err as any;
  const status: number | undefined = e?.statusCode ?? e?.status;
  const retryAfterRaw = e?.headers?.["retry-after"];
  const retryAfterSec =
    retryAfterRaw === undefined ? undefined : Number.parseInt(String(retryAfterRaw), 10);

  if (status === 401 || status === 403) {
    return {
      status,
      message: `${status} ${e?.result?.error ?? "Unauthorized"}: check ZENDESK_API_TOKEN and ZENDESK_EMAIL`,
      retryAfterSec: Number.isFinite(retryAfterSec) ? retryAfterSec : undefined,
    };
  }

  const errorName = e?.result?.error;
  const description = e?.result?.description;
  if (status && errorName) {
    const tail = description ? `: ${description}` : "";
    return {
      status,
      message: `${status} ${errorName}${tail}`,
      retryAfterSec: Number.isFinite(retryAfterSec) ? retryAfterSec : undefined,
    };
  }

  return {
    status,
    message: e?.message ?? String(err),
    retryAfterSec: Number.isFinite(retryAfterSec) ? retryAfterSec : undefined,
  };
}

export async function withZendeskError<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const parsed = parseZendeskError(err);
    if (parsed.status === 429) {
      const waitMs = (parsed.retryAfterSec ?? 1) * 1000;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      try {
        return await fn();
      } catch (err2) {
        throw new ZendeskMcpError(parseZendeskError(err2));
      }
    }
    throw new ZendeskMcpError(parsed);
  }
}
```

- [ ] **Step 5: Run tests, confirm pass**

Run: `npm test`
Expected: 7 tests pass.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: no TS errors.

- [ ] **Step 7: Commit**

```bash
git add src/zendesk.ts tests/zendesk.test.ts vitest.config.ts
git commit -m "zendesk-admin-mcp: client factory, error wrapper, shared config loader"
```

---

## Task 3: MCP server skeleton + index dispatch + setup CLI

**Files:**
- Create: `src/server.ts`, `src/setup.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write `src/server.ts`**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function createServer(): McpServer {
  return new McpServer({
    name: "zendesk-admin-mcp",
    version: "0.1.0",
  });
}
```

- [ ] **Step 2: Write `src/setup.ts`**

```ts
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const CONFIG_DIR = path.join(os.homedir(), ".config", "zendesk-mcp");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

interface StoredConfig {
  subdomain: string;
  email: string;
  api_token: string;
}

async function loadExisting(): Promise<Partial<StoredConfig>> {
  try {
    return JSON.parse(await fs.readFile(CONFIG_PATH, "utf8")) as StoredConfig;
  } catch {
    return {};
  }
}

async function prompt(
  rl: ReturnType<typeof createInterface>,
  question: string,
  defaultValue?: string
): Promise<string> {
  const suffix = defaultValue ? ` (${defaultValue})` : "";
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer || defaultValue || "";
}

export async function runSetup(): Promise<void> {
  console.log("Zendesk Admin MCP — setup\n");
  console.log("This will write credentials to " + CONFIG_PATH + " (mode 0600).");
  console.log("These credentials are shared with @sniebauer/zendesk-mcp.");
  console.log("Get a Zendesk API token at:");
  console.log("  https://<your-subdomain>.zendesk.com/admin/apps-integrations/apis/api-tokens\n");

  const existing = await loadExisting();
  const rl = createInterface({ input, output });

  try {
    const subdomain = await prompt(rl, "Zendesk subdomain", existing.subdomain);
    const email = await prompt(rl, "Your Zendesk email", existing.email);
    const api_token = await prompt(rl, "API token", existing.api_token ? "(unchanged)" : undefined);

    if (!subdomain || !email) {
      console.error("\nsubdomain and email are required. Aborting.");
      process.exit(1);
    }

    const finalToken = api_token === "(unchanged)" ? existing.api_token : api_token;
    if (!finalToken) {
      console.error("\nAPI token is required. Aborting.");
      process.exit(1);
    }

    await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
    const config: StoredConfig = { subdomain, email, api_token: finalToken };
    await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
    await fs.chmod(CONFIG_PATH, 0o600);

    console.log(`\nWrote ${CONFIG_PATH}`);
    console.log("\nNow add this to your Claude Desktop config (or ~/.claude.json for Claude Code):\n");
    console.log(
      JSON.stringify(
        { mcpServers: { "zendesk-admin": { command: "npx", args: ["-y", "@sniebauer/zendesk-admin-mcp"] } } },
        null,
        2
      )
    );
    console.log("\nClaude Desktop config lives at:");
    console.log("  macOS:   ~/Library/Application Support/Claude/claude_desktop_config.json");
    console.log("  Windows: %APPDATA%\\\\Claude\\\\claude_desktop_config.json");
    console.log("\nThen restart Claude Desktop. The admin tools appear under the 'zendesk-admin' MCP.");
  } finally {
    rl.close();
  }
}
```

- [ ] **Step 3: Rewrite `src/index.ts`**

```ts
#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env"),
});

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { runSetup } from "./setup.js";

async function main() {
  if (process.argv[2] === "setup") {
    await runSetup();
    return;
  }
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("zendesk-admin-mcp failed to start:", err);
  process.exit(1);
});
```

- [ ] **Step 4: Build and verify both code paths**

Run: `npm run build && node dist/index.js < /dev/null`
Expected: starts, reads EOF, no error stack.

Run: `echo '' | node dist/index.js setup`
Expected: prints the "Zendesk Admin MCP — setup" banner and the subdomain prompt, then aborts on empty subdomain. Confirms dispatch works.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts src/setup.ts src/index.ts
git commit -m "zendesk-admin-mcp: server skeleton, stdio transport, setup CLI"
```

---

## Task 4: The `require_confirm` guard helper

**Files:**
- Create: `src/confirm.ts`, `tests/confirm.test.ts`

- [ ] **Step 1: Write `tests/confirm.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { runGuarded } from "../src/confirm.js";

describe("runGuarded", () => {
  it("returns a preview and does NOT execute when require_confirm is false", async () => {
    let executed = false;
    const out = await runGuarded({
      requireConfirm: false,
      action: "delete trigger 5",
      fetchCurrent: async () => ({ id: 5, title: "Old" }),
      execute: async () => {
        executed = true;
        return { deleted: true };
      },
    });
    expect(executed).toBe(false);
    const payload = JSON.parse(out.content[0].text);
    expect(payload.requires_confirmation).toBe(true);
    expect(payload.action).toBe("delete trigger 5");
    expect(payload.current_state).toEqual({ id: 5, title: "Old" });
  });

  it("includes proposed_change in the preview when provided", async () => {
    const out = await runGuarded({
      requireConfirm: false,
      action: "update trigger 5",
      fetchCurrent: async () => ({ id: 5, title: "Old" }),
      proposed: { title: "New" },
      execute: async () => ({ id: 5, title: "New" }),
    });
    const payload = JSON.parse(out.content[0].text);
    expect(payload.proposed_change).toEqual({ title: "New" });
  });

  it("executes and returns the result when require_confirm is true", async () => {
    let fetched = false;
    const out = await runGuarded({
      requireConfirm: true,
      action: "delete trigger 5",
      fetchCurrent: async () => {
        fetched = true;
        return { id: 5 };
      },
      execute: async () => ({ deleted: true, id: 5 }),
    });
    expect(fetched).toBe(false); // no preview fetch when confirming
    const payload = JSON.parse(out.content[0].text);
    expect(payload).toEqual({ deleted: true, id: 5 });
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `npm test`
Expected: failure — `src/confirm.ts` does not exist.

- [ ] **Step 3: Write `src/confirm.ts`**

```ts
export interface ToolTextResult {
  content: { type: "text"; text: string }[];
}

export interface GuardOptions {
  /** When false, return a preview and do NOT execute. When true, execute. */
  requireConfirm: boolean;
  /** Human-readable label, e.g. "delete trigger 5". */
  action: string;
  /** Fetches the object's current state for the preview. Only called when previewing. */
  fetchCurrent: () => Promise<unknown>;
  /** For updates: the proposed change to show alongside current state. */
  proposed?: unknown;
  /** Performs the actual mutation. Only called when confirming. */
  execute: () => Promise<unknown>;
}

export function asTextResult(value: unknown): ToolTextResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export async function runGuarded(opts: GuardOptions): Promise<ToolTextResult> {
  if (!opts.requireConfirm) {
    const current = await opts.fetchCurrent();
    return asTextResult({
      requires_confirmation: true,
      action: opts.action,
      message:
        "This is a guarded operation. Review the current state below, then re-invoke this tool with require_confirm: true to apply.",
      current_state: current,
      ...(opts.proposed !== undefined ? { proposed_change: opts.proposed } : {}),
    });
  }
  const result = await opts.execute();
  return asTextResult(result);
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npm test`
Expected: 7 (zendesk) + 3 (confirm) = 10 tests pass.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: no TS errors.

- [ ] **Step 6: Commit**

```bash
git add src/confirm.ts tests/confirm.test.ts
git commit -m "zendesk-admin-mcp: require_confirm guard helper + tests"
```

---

## Task 5: The CRUD factory (wired to triggers as the first object)

**Files:**
- Create: `src/crud.ts`, `tests/crud.test.ts`, `src/tools/business-rules.ts`
- Modify: `src/server.ts`

**Background — node-zendesk v5 return shapes (verified against the installed `.d.ts`):**
- `show(id)` / `create(data)` / `update(id, data)` → `Promise<{ response, result }>` → use `result`.
- `list(...)` → returns the raw payload (array for some objects, `{ <plural>: [...], ... }` for others). Just return it as-is.
- `delete(id)` → `Promise<void | object>`. Return a synthetic `{ deleted: true, id }`.
- `create`/`update` take the resource object **directly** (node-zendesk wraps the envelope internally). Pass `data` straight through.
- Webhooks use **string** IDs; every other object uses **numeric** IDs.

- [ ] **Step 1: Write `tests/crud.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { makeCrudSchemas } from "../src/crud.js";

describe("makeCrudSchemas (numeric id)", () => {
  const s = makeCrudSchemas("number");

  it("getInput requires a positive integer id", () => {
    expect(() => s.getInput.parse({ id: 0 })).toThrow();
    expect(() => s.getInput.parse({ id: -1 })).toThrow();
    expect(() => s.getInput.parse({ id: "abc" })).toThrow();
    expect(s.getInput.parse({ id: 7 })).toEqual({ id: 7 });
  });

  it("createInput requires a data object", () => {
    expect(() => s.createInput.parse({})).toThrow();
    expect(s.createInput.parse({ data: { title: "X" } })).toEqual({ data: { title: "X" } });
  });

  it("updateInput requires id + data and defaults require_confirm to false", () => {
    expect(() => s.updateInput.parse({ id: 1 })).toThrow();
    expect(s.updateInput.parse({ id: 1, data: { title: "X" } })).toEqual({
      id: 1,
      data: { title: "X" },
      require_confirm: false,
    });
  });

  it("deleteInput defaults require_confirm to false", () => {
    expect(s.deleteInput.parse({ id: 1 })).toEqual({ id: 1, require_confirm: false });
  });

  it("accepts a nested conditions DSL as passthrough data", () => {
    const data = {
      title: "T",
      conditions: { all: [{ field: "status", operator: "is", value: "open" }], any: [] },
      actions: [{ field: "priority", value: "high" }],
    };
    expect(s.createInput.parse({ data }).data).toEqual(data);
  });
});

describe("makeCrudSchemas (string id)", () => {
  const s = makeCrudSchemas("string");
  it("getInput requires a non-empty string id", () => {
    expect(() => s.getInput.parse({ id: "" })).toThrow();
    expect(s.getInput.parse({ id: "abc123" })).toEqual({ id: "abc123" });
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `npm test`
Expected: failure — `src/crud.ts` does not exist.

- [ ] **Step 3: Write `src/crud.ts`**

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createZendeskClient, withZendeskError, loadConfig } from "./zendesk.js";
import { runGuarded, asTextResult } from "./confirm.js";

export type IdType = "number" | "string";

function idSchema(idType: IdType) {
  return idType === "number"
    ? z.number().int().positive().describe("Numeric object ID")
    : z.string().min(1).describe("String object ID");
}

export function makeCrudSchemas(idType: IdType) {
  const id = idSchema(idType);
  const data = z
    .record(z.any())
    .describe(
      "The resource object (passthrough). Include the fields Zendesk expects for this object — e.g. title/name, conditions ({all,any} of {field,operator,value}), actions, etc."
    );
  return {
    listInput: z.object({}),
    getInput: z.object({ id }),
    createInput: z.object({ data }),
    updateInput: z.object({ id, data, require_confirm: z.boolean().default(false) }),
    deleteInput: z.object({ id, require_confirm: z.boolean().default(false) }),
  };
}

/** Minimal shape of a node-zendesk CRUD sub-client. */
export interface CrudClient {
  list: (...args: any[]) => Promise<any>;
  show: (id: any) => Promise<{ response: unknown; result: unknown }>;
  create: (data: any) => Promise<{ response: unknown; result: unknown }>;
  update: (id: any, data: any) => Promise<{ response: unknown; result: unknown }>;
  delete: (id: any) => Promise<unknown>;
}

export interface CrudConfig {
  /** e.g. "trigger" */
  singular: string;
  /** e.g. "triggers" */
  plural: string;
  idType: IdType;
  /** true for live-routing objects (triggers, automations, SLA policies): updates are guarded. */
  guardUpdate: boolean;
  /** (client) => client.triggers */
  getClient: (client: ReturnType<typeof createZendeskClient>) => CrudClient;
  /** Builds the GUI admin URL for this object type. */
  adminUrl: (subdomain: string, id: string | number) => string;
  /** Extra guidance appended to the create/update data description. */
  dataHint?: string;
}

function withAdminUrl(subdomain: string, cfg: CrudConfig, id: string | number, result: unknown) {
  return { ...(result as object), _admin_url: cfg.adminUrl(subdomain, id) };
}

export function registerCrud(server: McpServer, cfg: CrudConfig) {
  const s = makeCrudSchemas(cfg.idType);
  const hint = cfg.dataHint ? ` ${cfg.dataHint}` : "";

  server.tool(
    `zda_list_${cfg.plural}`,
    `List all Zendesk ${cfg.plural}.`,
    s.listInput.shape,
    async () => {
      const client = cfg.getClient(createZendeskClient());
      const result = await withZendeskError(() => client.list());
      return asTextResult(result);
    }
  );

  server.tool(
    `zda_get_${cfg.singular}`,
    `Fetch a single Zendesk ${cfg.singular} by ID, including its full definition.`,
    s.getInput.shape,
    async (raw) => {
      const { id } = s.getInput.parse(raw);
      const { subdomain } = loadConfig();
      const client = cfg.getClient(createZendeskClient());
      const { result } = await withZendeskError(() => client.show(id));
      return asTextResult(withAdminUrl(subdomain, cfg, id, result));
    }
  );

  server.tool(
    `zda_create_${cfg.singular}`,
    `Create a new Zendesk ${cfg.singular}.${hint}`,
    s.createInput.shape,
    async (raw) => {
      const { data } = s.createInput.parse(raw);
      const { subdomain } = loadConfig();
      const client = cfg.getClient(createZendeskClient());
      const { result } = await withZendeskError(() => client.create(data));
      const id = (result as any)?.id ?? "new";
      return asTextResult(withAdminUrl(subdomain, cfg, id, result));
    }
  );

  const updateDesc = cfg.guardUpdate
    ? `Update an existing Zendesk ${cfg.singular}. GUARDED: this object affects live ticket flow. Call without require_confirm to preview the current state; re-call with require_confirm: true to apply.${hint}`
    : `Update an existing Zendesk ${cfg.singular}.${hint}`;

  server.tool(`zda_update_${cfg.singular}`, updateDesc, s.updateInput.shape, async (raw) => {
    const { id, data, require_confirm } = s.updateInput.parse(raw);
    const { subdomain } = loadConfig();
    const client = cfg.getClient(createZendeskClient());
    if (cfg.guardUpdate) {
      return runGuarded({
        requireConfirm: require_confirm,
        action: `update ${cfg.singular} ${id}`,
        fetchCurrent: () => withZendeskError(() => client.show(id)).then((r) => r.result),
        proposed: data,
        execute: () =>
          withZendeskError(() => client.update(id, data)).then((r) =>
            withAdminUrl(subdomain, cfg, id, r.result)
          ),
      });
    }
    const { result } = await withZendeskError(() => client.update(id, data));
    return asTextResult(withAdminUrl(subdomain, cfg, id, result));
  });

  server.tool(
    `zda_delete_${cfg.singular}`,
    `Delete a Zendesk ${cfg.singular}. GUARDED: call without require_confirm to preview the object that would be deleted; re-call with require_confirm: true to apply.`,
    s.deleteInput.shape,
    async (raw) => {
      const { id, require_confirm } = s.deleteInput.parse(raw);
      const client = cfg.getClient(createZendeskClient());
      return runGuarded({
        requireConfirm: require_confirm,
        action: `delete ${cfg.singular} ${id}`,
        fetchCurrent: () => withZendeskError(() => client.show(id)).then((r) => r.result),
        execute: () => withZendeskError(() => client.delete(id)).then(() => ({ deleted: true, id })),
      });
    }
  );
}
```

- [ ] **Step 4: Write `src/tools/business-rules.ts` (triggers only for now)**

```ts
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
```

- [ ] **Step 5: Register in `src/server.ts`**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerBusinessRuleTools } from "./tools/business-rules.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "zendesk-admin-mcp",
    version: "0.1.0",
  });

  registerBusinessRuleTools(server);

  return server;
}
```

- [ ] **Step 6: Run tests, confirm pass**

Run: `npm test`
Expected: 10 (prior) + 6 (crud) = 16 tests pass.

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: no TS errors. If `(c as any).triggers` is flagged, the cast is intentional — node-zendesk's client type is loose for sub-clients.

- [ ] **Step 8: Commit**

```bash
git add src/crud.ts tests/crud.test.ts src/tools/business-rules.ts src/server.ts
git commit -m "zendesk-admin-mcp: CRUD factory + require_confirm wiring (triggers)"
```

---

## Task 6: Wire the remaining 8 CRUD objects

**Files:**
- Modify: `src/tools/business-rules.ts` (add automations, macros, views, SLA policies)
- Create: `src/tools/ticketing.ts` (groups, ticket fields, ticket forms, webhooks)
- Modify: `src/server.ts`

- [ ] **Step 1: Extend `src/tools/business-rules.ts`**

Replace the file with:

```ts
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
```

- [ ] **Step 2: Create `src/tools/ticketing.ts`**

```ts
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
```

- [ ] **Step 3: Register both groups in `src/server.ts`**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerBusinessRuleTools } from "./tools/business-rules.js";
import { registerTicketingTools } from "./tools/ticketing.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "zendesk-admin-mcp",
    version: "0.1.0",
  });

  registerBusinessRuleTools(server);
  registerTicketingTools(server);

  return server;
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npm test`
Expected: 16 tests still pass (no new tests — the factory is already covered; these are config-only additions).

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: no TS errors.

- [ ] **Step 6: Sanity-check the registered tool count**

Run:
```bash
node -e "import('./dist/server.js').then(async m => { const s = m.createServer(); console.log('server constructed OK'); })"
```
Expected: prints `server constructed OK` with no throw (confirms all 9 objects × 5 = 45 `server.tool` calls registered without name collisions).

- [ ] **Step 7: Commit**

```bash
git add src/tools/business-rules.ts src/tools/ticketing.ts src/server.ts
git commit -m "zendesk-admin-mcp: wire all 9 CRUD objects via the factory"
```

---

## Task 7: `zda_reorder_triggers` (guarded write helper)

**Files:**
- Modify: `src/tools/business-rules.ts`, `tests/crud.test.ts`

- [ ] **Step 1: Add a failing schema test to `tests/crud.test.ts`**

Append:

```ts
import { reorderTriggersInput } from "../src/tools/business-rules.js";

describe("reorderTriggersInput", () => {
  it("requires a non-empty array of positive integer ids and defaults require_confirm false", () => {
    expect(() => reorderTriggersInput.parse({ trigger_ids: [] })).toThrow();
    expect(() => reorderTriggersInput.parse({ trigger_ids: [0] })).toThrow();
    expect(reorderTriggersInput.parse({ trigger_ids: [3, 1, 2] })).toEqual({
      trigger_ids: [3, 1, 2],
      require_confirm: false,
    });
  });
});
```

- [ ] **Step 2: Run tests, confirm new one fails**

Run: `npm test`
Expected: failure — `reorderTriggersInput` not exported.

- [ ] **Step 3: Add the tool to `src/tools/business-rules.ts`**

At the top, add imports and the schema; then register the tool inside `registerBusinessRuleTools`. Add these imports:

```ts
import { z } from "zod";
import { createZendeskClient, withZendeskError, loadConfig } from "../zendesk.js";
import { runGuarded } from "../confirm.js";
```

Add the exported schema (above `registerBusinessRuleTools`):

```ts
export const reorderTriggersInput = z.object({
  trigger_ids: z
    .array(z.number().int().positive())
    .min(1)
    .describe("Trigger IDs in the desired new order (full list, first to last)."),
  require_confirm: z.boolean().default(false),
});
```

At the END of `registerBusinessRuleTools` (after the 5 `registerCrud` calls), add:

```ts
  server.tool(
    "zda_reorder_triggers",
    "Reorder triggers. Trigger order determines evaluation precedence and is a common source of silent routing bugs. GUARDED: call without require_confirm to preview the current order; re-call with require_confirm: true to apply. Provide the COMPLETE ordered list of trigger IDs.",
    reorderTriggersInput.shape,
    async (raw) => {
      const { trigger_ids, require_confirm } = reorderTriggersInput.parse(raw);
      loadConfig(); // validate creds early
      const client = (createZendeskClient() as any).triggers;
      return runGuarded({
        requireConfirm: require_confirm,
        action: "reorder triggers",
        fetchCurrent: () => withZendeskError(() => client.list()),
        proposed: { trigger_ids },
        execute: () =>
          withZendeskError(() => client.reorder(trigger_ids)).then(() => ({
            reordered: true,
            trigger_ids,
          })),
      });
    }
  );
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npm test`
Expected: 16 + 1 = 17 tests pass.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: no TS errors.

- [ ] **Step 6: Commit**

```bash
git add src/tools/business-rules.ts tests/crud.test.ts
git commit -m "zendesk-admin-mcp: zda_reorder_triggers (guarded)"
```

---

## Task 8: Audit log client + tools

**Files:**
- Create: `src/audit.ts`, `tests/audit.test.ts`, `src/tools/audit.ts`
- Modify: `src/server.ts`

**Background:** node-zendesk does not wrap `/api/v2/audit_logs`. Use raw `fetch()` with Basic auth (`${email}/token:${api_token}`), validating the host exactly against `<subdomain>.zendesk.com` (pattern copied from the support package's attachments tool). The Audit Logs API is Zendesk Enterprise-only; a non-Enterprise account returns 403, which `withZendeskError`-style handling surfaces cleanly.

- [ ] **Step 1: Write `tests/audit.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildAuditLogsUrl, basicAuthHeader, assertZendeskHost } from "../src/audit.js";

describe("buildAuditLogsUrl", () => {
  it("builds the base URL with no filters", () => {
    expect(buildAuditLogsUrl("acme", {})).toBe(
      "https://acme.zendesk.com/api/v2/audit_logs.json"
    );
  });

  it("adds filter query params", () => {
    const url = buildAuditLogsUrl("acme", {
      source_type: "trigger",
      source_id: "123",
      actor_id: "456",
      created_after: "2026-01-01T00:00:00Z",
    });
    expect(url).toContain("filter%5Bsource_type%5D=trigger");
    expect(url).toContain("filter%5Bsource_id%5D=123");
    expect(url).toContain("filter%5Bactor_id%5D=456");
    expect(url).toContain("filter%5Bcreated_at%5D%5B%5D=2026-01-01");
  });
});

describe("basicAuthHeader", () => {
  it("uses the email/token:token scheme", () => {
    const header = basicAuthHeader("me@x.com", "TOK");
    const decoded = Buffer.from(header.replace("Basic ", ""), "base64").toString("utf8");
    expect(decoded).toBe("me@x.com/token:TOK");
  });
});

describe("assertZendeskHost", () => {
  it("accepts the exact subdomain host", () => {
    expect(() => assertZendeskHost(new URL("https://acme.zendesk.com/x"), "acme")).not.toThrow();
  });
  it("rejects any other host", () => {
    expect(() => assertZendeskHost(new URL("https://evil.acme.zendesk.com/x"), "acme")).toThrow();
    expect(() => assertZendeskHost(new URL("https://example.com/x"), "acme")).toThrow();
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `npm test`
Expected: failure — `src/audit.ts` does not exist.

- [ ] **Step 3: Write `src/audit.ts`**

```ts
export interface AuditLogFilters {
  source_type?: string;
  source_id?: string;
  actor_id?: string;
  created_after?: string; // ISO timestamp
  created_before?: string; // ISO timestamp
}

export function basicAuthHeader(email: string, token: string): string {
  return "Basic " + Buffer.from(`${email}/token:${token}`).toString("base64");
}

export function assertZendeskHost(url: URL, subdomain: string): void {
  const expected = `${subdomain}.zendesk.com`;
  if (url.hostname !== expected) {
    throw new Error(
      `Refusing to send credentials: host '${url.hostname}' is not the configured Zendesk host '${expected}'.`
    );
  }
}

export function buildAuditLogsUrl(subdomain: string, filters: AuditLogFilters): string {
  const url = new URL(`https://${subdomain}.zendesk.com/api/v2/audit_logs.json`);
  const p = url.searchParams;
  if (filters.source_type) p.set("filter[source_type]", filters.source_type);
  if (filters.source_id) p.set("filter[source_id]", filters.source_id);
  if (filters.actor_id) p.set("filter[actor_id]", filters.actor_id);
  // Zendesk accepts a created_at range as filter[created_at][]=start&filter[created_at][]=end
  if (filters.created_after) p.append("filter[created_at][]", filters.created_after);
  if (filters.created_before) p.append("filter[created_at][]", filters.created_before);
  return url.toString();
}

export async function fetchAuditLogs(
  subdomain: string,
  email: string,
  token: string,
  filters: AuditLogFilters
): Promise<unknown> {
  const urlStr = buildAuditLogsUrl(subdomain, filters);
  const url = new URL(urlStr);
  assertZendeskHost(url, subdomain);
  const res = await fetch(urlStr, {
    headers: { Authorization: basicAuthHeader(email, token), Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const tail = body ? `: ${body.slice(0, 200)}` : "";
    throw new Error(
      `${res.status} ${res.statusText} fetching audit logs${tail}` +
        (res.status === 403 ? " (the Audit Logs API requires Zendesk Enterprise)" : "")
    );
  }
  return res.json();
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npm test`
Expected: 17 + 5 (audit) = 22 tests pass.

- [ ] **Step 5: Write `src/tools/audit.ts`**

```ts
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
```

- [ ] **Step 6: Register in `src/server.ts`**

Add the import and call:

```ts
import { registerAuditTools } from "./tools/audit.js";
// ...
  registerAuditTools(server);
```

- [ ] **Step 7: Run tests + build**

Run: `npm test && npm run build`
Expected: 22 tests pass, no TS errors.

- [ ] **Step 8: Commit**

```bash
git add src/audit.ts tests/audit.test.ts src/tools/audit.ts src/server.ts
git commit -m "zendesk-admin-mcp: audit-log client + tools (fetch-based, host-validated)"
```

---

## Task 9: Read-only inventory tools

**Files:**
- Create: `src/tools/inventory.ts`
- Modify: `src/server.ts`

**Background — node-zendesk inventory clients (verified):** `accountsettings.show()`, `installations.list()`, `brand.list()`, `customagentroles.list()`, `tags.list()`, `locales.list()`. `show`-style returns `{response, result}`; `list`-style returns the raw payload.

- [ ] **Step 1: Write `src/tools/inventory.ts`**

```ts
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
      const { result } = await withZendeskError(() => client.accountsettings.show());
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
```

- [ ] **Step 2: Register in `src/server.ts`**

Add the import and call:

```ts
import { registerInventoryTools } from "./tools/inventory.js";
// ...
  registerInventoryTools(server);
```

- [ ] **Step 3: Build + run tests + sanity-construct**

Run: `npm run build && npm test`
Expected: 22 tests pass, no TS errors.

Run:
```bash
node -e "import('./dist/server.js').then(m => { m.createServer(); console.log('server constructed OK'); })"
```
Expected: `server constructed OK` (all 54 tools register without collision).

- [ ] **Step 4: Commit**

```bash
git add src/tools/inventory.ts src/server.ts
git commit -m "zendesk-admin-mcp: read-only inventory tools"
```

---

## Task 10: Smoke test script

**Files:**
- Create: `scripts/smoke.ts`

- [ ] **Step 1: Write `scripts/smoke.ts`**

```ts
import "dotenv/config";
import { createZendeskClient, withZendeskError, loadConfig } from "../src/zendesk.js";
import { fetchAuditLogs } from "../src/audit.js";

async function main() {
  const cfg = loadConfig();
  const client = createZendeskClient(cfg) as any;

  console.log("=== Admin reads smoke ===");

  console.log("1. list triggers ...");
  const triggers = await withZendeskError(() => client.triggers.list());
  const tCount = Array.isArray(triggers) ? triggers.length : (triggers?.triggers?.length ?? "?");
  console.log(`  -> triggers: ${tCount}`);

  console.log("2. list automations ...");
  const autos = await withZendeskError(() => client.automations.list());
  const aCount = Array.isArray(autos) ? autos.length : (autos?.automations?.length ?? "?");
  console.log(`  -> automations: ${aCount}`);

  console.log("3. account settings ...");
  const { result: settings } = await withZendeskError(() => client.accountsettings.show());
  console.log(`  -> settings keys: ${Object.keys(settings as object).slice(0, 5).join(", ")}...`);

  console.log("4. audit logs (last events) ...");
  try {
    const audit = await fetchAuditLogs(cfg.subdomain, cfg.email, cfg.token, {});
    const n = (audit as any)?.audit_logs?.length ?? "?";
    console.log(`  -> audit_logs returned: ${n}`);
  } catch (err) {
    console.log(`  -> audit logs unavailable (expected on non-Enterprise): ${(err as Error).message}`);
  }

  console.log("\nSmoke test passed (reads only — no writes performed).");
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Type-check the script in isolation**

Run:
```bash
npx tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --strict --skipLibCheck scripts/smoke.ts src/zendesk.ts src/audit.ts
```
Expected: no errors. Then confirm the main build is still clean: `npm run build`.

- [ ] **Step 3: Do NOT run the live smoke test**

The smoke test requires real credentials and is reads-only by design. Note in the commit that `npm run smoke` is run manually after `setup`.

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke.ts
git commit -m "zendesk-admin-mcp: reads-only smoke test script"
```

---

## Task 11: README + LICENSE

**Files:**
- Create: `LICENSE`
- Modify: `README.md`

- [ ] **Step 1: Write `LICENSE`**

Standard MIT license text, copyright holder "Steve Niebauer", year 2026.

```
MIT License

Copyright (c) 2026 Steve Niebauer

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Replace `README.md`**

```markdown
# @sniebauer/zendesk-admin-mcp

Local [MCP](https://modelcontextprotocol.io/) server for **Zendesk admin/config** work — the companion to [`@sniebauer/zendesk-mcp`](https://github.com/sniebauer/zendesk-mcp) (day-to-day support).

54 tools: full CRUD on triggers, automations, macros, views, SLA policies, groups, ticket fields, ticket forms, and webhooks; a read-only audit log; and a read-only inventory of account settings, installed apps, brands, agent roles, tags, and locales.

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

Guarded operations — every `delete`, every `update` to **triggers / automations / SLA policies**, and `zda_reorder_triggers` — do not execute on the first call. Instead they return the object's **current state** (and, for updates, the proposed change) and ask you to re-invoke with `require_confirm: true`. This forces a deliberate two-step on anything that can break live ticket flow.

Creates and updates to lower-risk objects (macros, views, groups, fields, forms, webhooks) execute directly.

## Tools (54)

**Business rules — full CRUD** (`list` / `get` / `create` / `update` / `delete` each)
- `zda_*_trigger(s)` · `zda_*_automation(s)` · `zda_*_macro(s)` · `zda_*_view(s)` · `zda_*_sla_policy/policies`
- `zda_reorder_triggers` — reorder trigger evaluation precedence (guarded)

**Ticketing config — full CRUD**
- `zda_*_group(s)` · `zda_*_ticket_field(s)` · `zda_*_ticket_form(s)` · `zda_*_webhook(s)`

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

## License

MIT — see `LICENSE`.
```

- [ ] **Step 3: Build + test (final green check)**

Run: `npm run build && npm test`
Expected: 22 tests pass, no TS errors.

- [ ] **Step 4: Commit**

```bash
git add README.md LICENSE
git commit -m "zendesk-admin-mcp: README + LICENSE"
```

---

## Task 12: Publish prep (manual steps documented, not executed)

**Files:** none (this task creates the GitHub repo and leaves npm publish to the user).

- [ ] **Step 1: Confirm the package contents**

Run: `npm pack --dry-run`
Expected: tarball includes `dist/`, `README.md`, `LICENSE`, `.env.example`, `package.json` — and does NOT include `src/`, `tests/`, `node_modules/`, or `.env`.

- [ ] **Step 2: Confirm no Fullstory branding leaked**

Run: `grep -rn "[Ff]ullstory" src tests scripts README.md package.json .env.example` (from repo root)
Expected: no matches.

- [ ] **Step 3: Create the GitHub repo and push**

```bash
cd /Users/steveniebauer/src/zendesk-admin-mcp
gh repo create sniebauer/zendesk-admin-mcp --public --source=. --remote=origin --push \
  --description="Admin/config MCP server for Zendesk Support — CRUD on triggers, automations, macros, views, SLAs, groups, fields, forms, webhooks + audit logs"
```

Verify: `gh repo view sniebauer/zendesk-admin-mcp --json url,visibility`.

- [ ] **Step 4: Hand off npm publish to the user**

Report that the remaining steps are the user's (require their npm 2FA / passkey):
1. `cd /Users/steveniebauer/src/zendesk-admin-mcp`
2. `npm publish` (the `prepublishOnly` script re-runs build + tests; approve the 2FA/passkey prompt)
3. Verify from a fresh shell: `npx -y @sniebauer/zendesk-admin-mcp setup`

---

## Definition of done

- [ ] All 54 tools register (server constructs without collision).
- [ ] `npm test` passes (schemas + error wrapper + guard + audit URL/host).
- [ ] `npm run build` clean.
- [ ] Guarded ops (deletes, trigger/automation/SLA updates, reorder) preview without `require_confirm` and execute with it.
- [ ] Reads the shared `~/.config/zendesk-mcp/config.json`; env vars override.
- [ ] Audit tools fetch via host-validated raw `fetch`; 403 on non-Enterprise is legible.
- [ ] Public GitHub repo `sniebauer/zendesk-admin-mcp` created and pushed.
- [ ] npm publish documented as the user's manual step.
```

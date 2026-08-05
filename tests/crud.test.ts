import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { makeCrudSchemas, registerCrud } from "../src/crud.js";

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

describe("registerCrud envelopes the body with the singular key", () => {
  // The handlers build a real node-zendesk client (no network) and read
  // loadConfig() for the admin URL, both of which require credentials to be
  // present. Provide dummy ones; the fake sub-client intercepts every call so
  // nothing actually hits Zendesk.
  const prev = { ...process.env };
  beforeAll(() => {
    process.env.ZENDESK_SUBDOMAIN = "x";
    process.env.ZENDESK_EMAIL = "test@example.com";
    process.env.ZENDESK_API_TOKEN = "token";
  });
  afterAll(() => {
    for (const key of ["ZENDESK_SUBDOMAIN", "ZENDESK_EMAIL", "ZENDESK_API_TOKEN"] as const) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  });

  it("wraps create and update payloads as { [singular]: data }", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const fakeSub = {
      list: async () => [],
      show: async (id: any) => ({ response: {}, result: { id } }),
      create: async (body: any) => {
        calls.push({ method: "create", args: [body] });
        return { response: {}, result: { id: 1, ...body } };
      },
      update: async (id: any, body: any) => {
        calls.push({ method: "update", args: [id, body] });
        return { response: {}, result: { id, ...body } };
      },
      delete: async () => ({}),
    };

    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerCrud(server, {
      singular: "trigger",
      plural: "triggers",
      idType: "number",
      guardUpdate: false, // use a non-guarded object so update executes directly
      getClient: () => fakeSub as any,
      adminUrl: () => "https://x.zendesk.com/admin",
    });

    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: "t", version: "0.0.0" });
    await client.connect(clientT);

    await client.callTool({ name: "zda_create_trigger", arguments: { data: { title: "X" } } });
    await client.callTool({
      name: "zda_update_trigger",
      arguments: { id: 5, data: { title: "Y" } },
    });

    const create = calls.find((c) => c.method === "create");
    const update = calls.find((c) => c.method === "update");
    expect(create?.args[0]).toEqual({ trigger: { title: "X" } });
    expect(update?.args).toEqual([5, { trigger: { title: "Y" } }]);

    await client.close();
    await server.close();
  });

  it("list returns a compact summary (identifying fields only) instead of full definitions", async () => {
    const heavy = {
      id: 1,
      title: "Big trigger",
      active: true,
      category_id: 42,
      // A large body that must NOT appear in the list response:
      conditions: { all: Array.from({ length: 200 }, (_, i) => ({ field: `f${i}`, operator: "is", value: "x" })) },
      actions: Array.from({ length: 200 }, (_, i) => ({ field: `a${i}`, value: "y" })),
    };
    const fakeSub = {
      list: async () => [heavy],
      show: async (id: any) => ({ response: {}, result: { id } }),
      create: async () => ({ response: {}, result: {} }),
      update: async () => ({ response: {}, result: {} }),
      delete: async () => ({}),
    };

    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerCrud(server, {
      singular: "trigger",
      plural: "triggers",
      idType: "number",
      guardUpdate: false,
      getClient: () => fakeSub as any,
      adminUrl: () => "https://x.zendesk.com/admin",
    });

    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: "t", version: "0.0.0" });
    await client.connect(clientT);

    const res: any = await client.callTool({ name: "zda_list_triggers", arguments: {} });
    const text = res.content[0].text as string;
    const payload = JSON.parse(text);

    expect(payload.count).toBe(1);
    expect(payload.triggers).toEqual([
      { id: 1, title: "Big trigger", active: true, category_id: 42 },
    ]);
    // The heavy bodies must be stripped out of the list response.
    expect(text).not.toContain("conditions");
    expect(text).not.toContain("actions");

    await client.close();
    await server.close();
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
  name: string;
};

describe("createServer", () => {
  it("reports the package version, not a hardcoded string", async () => {
    const server = createServer();
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: "t", version: "0.0.0" });
    await client.connect(clientT);

    const info = client.getServerVersion();
    expect(info?.name).toBe("zendesk-admin-mcp");
    expect(info?.version).toBe(pkg.version);

    await client.close();
    await server.close();
  });

  it("registers the full tool surface", async () => {
    const server = createServer();
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: "t", version: "0.0.0" });
    await client.connect(clientT);

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toHaveLength(66);
    expect(names.filter((n) => /schedule|holiday/.test(n))).toHaveLength(12);
    // Every tool carries the admin prefix, so it can't collide with the
    // support package's zd_ tools when both are loaded.
    expect(names.every((n) => n.startsWith("zda_"))).toBe(true);

    await client.close();
    await server.close();
  });
});

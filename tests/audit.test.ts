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

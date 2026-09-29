import { describe, it, expect, vi, afterEach } from "vitest";
import { zendeskRequest, ZendeskHttpError } from "../src/http.js";

const cfg = { subdomain: "acme", email: "a@b.c", token: "t" };

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("zendeskRequest", () => {
  it("refuses to send credentials to a host other than the configured subdomain", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      zendeskRequest(cfg, "GET", "https://evil.example.com/api/v2/x.json")
    ).rejects.toThrow(/Refusing to send credentials/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends basic auth and a JSON body, and returns the parsed response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await zendeskRequest(cfg, "POST", "https://acme.zendesk.com/api/v2/x.json", {
      a: 1,
    });
    expect(out).toEqual({ ok: 1 });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toMatch(/^Basic /);
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe('{"a":1}');
  });

  it("returns undefined on 204", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(
      zendeskRequest(cfg, "DELETE", "https://acme.zendesk.com/api/v2/x.json")
    ).resolves.toBeUndefined();
  });

  it("appends the caller's plan hint to 403/404 errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(403, { error: "Forbidden", description: "Nope" }))
    );
    const err = await zendeskRequest(cfg, "GET", "https://acme.zendesk.com/api/v2/x.json", undefined, {
      planHint: "Check your plan.",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ZendeskHttpError);
    expect(err.statusCode).toBe(403);
    expect(err.result.description).toBe("Nope — Check your plan.");
  });

  it("does not add the plan hint to other statuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(422, { error: "Invalid", description: "Bad" }))
    );
    const err = await zendeskRequest(cfg, "GET", "https://acme.zendesk.com/api/v2/x.json", undefined, {
      planHint: "Check your plan.",
    }).catch((e) => e);
    expect(err.result.description).toBe("Bad");
  });

  it("reads the title from a JSON:API-style error object", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(400, { error: { title: "Invalid attribute" } }))
    );
    const err = await zendeskRequest(cfg, "GET", "https://acme.zendesk.com/api/v2/x.json").catch(
      (e) => e
    );
    expect(err.result.error).toBe("Invalid attribute");
  });
});

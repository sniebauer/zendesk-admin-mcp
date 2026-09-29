import type { ZendeskConfig } from "./zendesk.js";
import { assertZendeskHost, basicAuthHeader } from "./audit.js";

/**
 * Shaped to match what node-zendesk throws, so parseZendeskError/withZendeskError
 * can consume it unchanged — which is how raw-fetch paths inherit the single 429 retry.
 */
export class ZendeskHttpError extends Error {
  override name = "ZendeskHttpError";
  statusCode: number;
  result: { error: string; description?: string };
  headers: Record<string, string>;

  constructor(
    statusCode: number,
    result: { error: string; description?: string },
    headers: Record<string, string>
  ) {
    super(`${statusCode} ${result.error}`);
    this.statusCode = statusCode;
    this.result = result;
    this.headers = headers;
  }
}

export interface RequestOptions {
  /**
   * Appended to 403/404 descriptions. For plan-gated APIs, where a bare
   * "Forbidden" otherwise reads like a credentials problem.
   */
  planHint?: string;
}

/**
 * Raw-fetch request for Zendesk endpoints node-zendesk doesn't cover.
 * src/audit.ts predates this and calls fetch directly; it is intentionally left alone.
 */
export async function zendeskRequest<T>(
  cfg: ZendeskConfig,
  method: string,
  url: string,
  body?: unknown,
  opts: RequestOptions = {}
): Promise<T> {
  assertZendeskHost(new URL(url), cfg.subdomain);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: basicAuthHeader(cfg.email, cfg.token),
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (!res.ok) {
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });
    const text = await res.text().catch(() => "");
    let error = res.statusText || "Error";
    let description = text.slice(0, 300) || undefined;
    try {
      const parsed = JSON.parse(text) as { error?: unknown; description?: string };
      if (typeof parsed.error === "string") error = parsed.error;
      else if (parsed.error && typeof parsed.error === "object") {
        error = (parsed.error as { title?: string }).title ?? error;
      }
      if (parsed.description) description = parsed.description;
    } catch {
      // Non-JSON body; keep the truncated text as the description.
    }
    if (opts.planHint && (res.status === 403 || res.status === 404)) {
      description = description ? `${description} — ${opts.planHint}` : opts.planHint;
    }
    throw new ZendeskHttpError(res.status, { error, description }, headers);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

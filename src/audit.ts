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

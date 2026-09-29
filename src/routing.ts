import type { ZendeskConfig } from "./zendesk.js";
import { zendeskRequest } from "./http.js";
import { assertZendeskHost } from "./audit.js";

// Skills-based routing. In this API skill types are "attributes", skills are
// "attribute values", and an agent holding a skill is an "instance value".
// Paths omit the .json suffix, matching the API reference — the undocumented
// /agents endpoint is only known to answer on the bare path.

const base = (subdomain: string) => `https://${subdomain}.zendesk.com/api/v2`;
const seg = encodeURIComponent;

export function attributesUrl(subdomain: string, opts: { includeValues?: boolean } = {}): string {
  const url = `${base(subdomain)}/routing/attributes`;
  return opts.includeValues ? `${url}?include=attribute_values` : url;
}

export function attributeUrl(subdomain: string, attributeId: string): string {
  return `${base(subdomain)}/routing/attributes/${seg(attributeId)}`;
}

export function attributeValuesUrl(subdomain: string, attributeId: string): string {
  return `${attributeUrl(subdomain, attributeId)}/values`;
}

export function agentSkillsUrl(subdomain: string, agentId: number): string {
  return `${base(subdomain)}/routing/agents/${agentId}/instance_values`;
}

/** Undocumented, but live: it backs the "Agents with skill" panel in admin. */
export function skillAgentsUrl(subdomain: string, attributeId: string, valueId: string): string {
  return `${attributeValuesUrl(subdomain, attributeId)}/${seg(valueId)}/agents`;
}

export function agentSkillsJobUrl(subdomain: string): string {
  return `${base(subdomain)}/routing/agents/instance_values/jobs`;
}

export function jobStatusUrl(subdomain: string, jobId: string): string {
  return `${base(subdomain)}/job_statuses/${seg(jobId)}`;
}

/** Skills-based routing is plan- and permission-gated; say so instead of a bare 403. */
const PLAN_HINT =
  "Skills-based routing requires the Zendesk Enterprise plan, and the caller must be an admin or hold a custom role with permission to manage skills.";

export function routingRequest<T>(
  cfg: ZendeskConfig,
  method: string,
  url: string,
  body?: unknown
): Promise<T> {
  return zendeskRequest<T>(cfg, method, url, body, { planHint: PLAN_HINT });
}

export interface PageResult<T> {
  items: T[];
  /** True when maxPages was hit with a next_page still pending. */
  truncated: boolean;
}

/**
 * Follows offset-style `next_page` URLs. Capped, because an unbounded follow
 * loop is how an MCP server hangs; and each next_page is host-checked before
 * credentials go anywhere, because it's server-supplied.
 */
export async function collectPages<T>(opts: {
  firstUrl: string;
  key: string;
  subdomain: string;
  getPage: (url: string) => Promise<Record<string, unknown>>;
  maxPages?: number;
}): Promise<PageResult<T>> {
  const maxPages = opts.maxPages ?? 10;
  const items: T[] = [];
  let url: string | null = opts.firstUrl;
  for (let i = 0; i < maxPages && url; i++) {
    const page = await opts.getPage(url);
    items.push(...((page[opts.key] as T[] | undefined) ?? []));
    const next = page.next_page;
    url = typeof next === "string" && next ? next : null;
    if (url) assertZendeskHost(new URL(url), opts.subdomain);
  }
  return { items, truncated: url !== null };
}

export interface SkillRef {
  attribute_id: string;
  attribute: string;
  skill: string;
}

/**
 * `?include=attribute_values` sideloads every skill in one top-level array,
 * tagged with attribute_id, rather than inlining them per skill type. Nest
 * them so callers see types with their skills. The listing is paginated but
 * not followed here — accounts have a handful of skill types — so a pending
 * next_page is surfaced as `truncated` instead of silently dropped.
 */
export function groupSkillTypes(body: {
  attributes?: any[];
  attribute_values?: any[];
  next_page?: string | null;
}): { attributes: any[]; truncated: boolean } {
  const byType = new Map<string, any[]>();
  for (const v of body.attribute_values ?? []) {
    byType.set(v.attribute_id, [...(byType.get(v.attribute_id) ?? []), v]);
  }
  return {
    attributes: (body.attributes ?? []).map((a) => ({
      ...a,
      attribute_values: byType.get(a.id) ?? [],
    })),
    truncated: Boolean(body.next_page),
  };
}

/** skill id -> its skill type, from groupSkillTypes' output. */
export function buildSkillCatalog(attributes: any[]): Map<string, SkillRef> {
  const catalog = new Map<string, SkillRef>();
  for (const attr of attributes) {
    for (const value of attr.attribute_values ?? []) {
      catalog.set(value.id, { attribute_id: attr.id, attribute: attr.name, skill: value.name });
    }
  }
  return catalog;
}

export type HolderLookup = PageResult<{ id: number }> | { error: string };

export interface CoverageRow {
  attribute: string | null;
  skill: string;
  attribute_value_id: string;
  agent_skill_priority?: string;
  holders: unknown[] | null;
  holder_count?: number;
  holder_count_excluding_agent?: number;
  holders_truncated?: boolean;
  error?: string;
}

/**
 * One row per skill the agent holds, with everyone else who holds it.
 * Thinnest cover first, since "what's thin if this agent is out?" is the question.
 */
export function buildCoverage(opts: {
  agentId: number;
  agentSkills: { id: string; name: string; agent_skill_priority?: string }[];
  catalog: Map<string, SkillRef>;
  holders: Map<string, HolderLookup>;
}): CoverageRow[] {
  const rows = opts.agentSkills.map((s): CoverageRow => {
    const row: CoverageRow = {
      attribute: opts.catalog.get(s.id)?.attribute ?? null,
      skill: s.name,
      attribute_value_id: s.id,
      ...(s.agent_skill_priority ? { agent_skill_priority: s.agent_skill_priority } : {}),
      holders: null,
    };
    const lookup = opts.holders.get(s.id);
    if (!lookup) return { ...row, error: "No holder lookup was made for this skill." };
    if ("error" in lookup) return { ...row, error: lookup.error };
    const others = lookup.items.filter((h) => h.id !== opts.agentId);
    return {
      ...row,
      holders: others,
      holder_count: lookup.items.length,
      holder_count_excluding_agent: others.length,
      ...(lookup.truncated ? { holders_truncated: true } : {}),
    };
  });
  // Errored rows sort last: their cover is unknown, not zero.
  const rank = (r: CoverageRow) => r.holder_count_excluding_agent ?? Number.POSITIVE_INFINITY;
  return rows.sort((a, b) => rank(a) - rank(b));
}

export interface SkillAddition {
  attribute_value_id: string;
  agent_skill_priority?: "NORMAL" | "HIGH";
}

export interface SkillJobBody {
  job: {
    action: "upsert" | "delete";
    attributes: { attribute_values: { id: string; agent_skill_priority?: string }[] };
    items: number[];
  };
}

/**
 * Bodies for the bulk jobs endpoint. Only upsert and delete: both leave the
 * agent's other skills (and their priorities) alone. The endpoint's "update"
 * action — like the single-agent POST — replaces every skill the agent holds,
 * which is the easy way to wipe someone's routing by accident.
 */
export function buildSkillJobs(opts: {
  agentIds: number[];
  add: SkillAddition[];
  remove: string[];
}): SkillJobBody[] {
  const jobs: SkillJobBody[] = [];
  if (opts.add.length) {
    jobs.push({
      job: {
        action: "upsert",
        attributes: {
          attribute_values: opts.add.map((a) => ({
            id: a.attribute_value_id,
            ...(a.agent_skill_priority ? { agent_skill_priority: a.agent_skill_priority } : {}),
          })),
        },
        items: opts.agentIds,
      },
    });
  }
  if (opts.remove.length) {
    jobs.push({
      job: {
        action: "delete",
        attributes: { attribute_values: opts.remove.map((id) => ({ id })) },
        items: opts.agentIds,
      },
    });
  }
  return jobs;
}

export interface JobStatus {
  id: string;
  status: string;
  [k: string]: unknown;
}

const TERMINAL = new Set(["completed", "failed", "killed"]);

/**
 * Polls a background job briefly. Returns the last status seen either way —
 * a job still "working" when attempts run out isn't an error, just unfinished.
 */
export async function waitForJob(
  getStatus: () => Promise<JobStatus>,
  opts: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<JobStatus> {
  const attempts = opts.attempts ?? 10;
  const delayMs = opts.delayMs ?? 1000;
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  let status = await getStatus();
  for (let i = 1; i < attempts && !TERMINAL.has(status.status); i++) {
    await sleep(delayMs);
    status = await getStatus();
  }
  return status;
}

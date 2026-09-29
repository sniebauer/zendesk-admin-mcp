import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig, withZendeskError, type ZendeskConfig } from "../zendesk.js";
import { asTextResult, runGuarded } from "../confirm.js";
import { summarize } from "../crud.js";
import {
  attributesUrl,
  attributeUrl,
  attributeValuesUrl,
  agentSkillsUrl,
  skillAgentsUrl,
  agentSkillsJobUrl,
  jobStatusUrl,
  routingRequest,
  collectPages,
  buildSkillCatalog,
  groupSkillTypes,
  buildCoverage,
  buildSkillJobs,
  waitForJob,
  type HolderLookup,
  type JobStatus,
} from "../routing.js";

// Keep list results under the MCP result-size cap. The /agents payload is
// mostly a nested `photo` attachment object, which this drops.
const CATALOG_KEYS = ["id", "name", "updated_at"];
const HOLDER_KEYS = ["id", "name", "agent_skill_priority"];

const attributeId = z.string().min(1).describe("Skill type (routing attribute) ID — a UUID string.");
const attributeValueId = z.string().min(1).describe("Skill (routing attribute value) ID — a UUID string.");
const agentId = z.number().int().positive().describe("The agent's numeric Zendesk user ID.");

export const skillCoverageInput = z.object({
  agent_id: agentId,
  attribute_value_ids: z
    .array(attributeValueId)
    .optional()
    .describe("Only report on these of the agent's skills. Omit for all of them."),
});

const updateAgentSkillsShape = z.object({
  agent_ids: z
    .array(agentId)
    .min(1)
    .max(100)
    .describe("Agents to change — the same change is applied to each. Max 100 (a Zendesk limit)."),
  add: z
    .array(
      z.object({
        attribute_value_id: attributeValueId,
        agent_skill_priority: z
          .enum(["NORMAL", "HIGH"])
          .optional()
          .describe("Omit to keep an existing priority, or default a new skill to NORMAL."),
      })
    )
    .default([])
    .describe("Skills to give the agents. For a skill they already hold, this changes its priority."),
  remove: z.array(attributeValueId).default([]).describe("Skills to take away from the agents."),
  require_confirm: z.boolean().default(false),
});

export const updateAgentSkillsInput = updateAgentSkillsShape
  .refine((v) => v.add.length + v.remove.length > 0, {
    message: "Nothing to change: provide at least one skill in add or remove.",
  })
  .refine(
    (v) => !v.add.some((a) => v.remove.includes(a.attribute_value_id)),
    { message: "A skill can't be in both add and remove." }
  );

async function fetchAgentSkills(cfg: ZendeskConfig, id: number): Promise<any[]> {
  const body = await withZendeskError(() =>
    routingRequest<{ attribute_values?: any[] }>(cfg, "GET", agentSkillsUrl(cfg.subdomain, id))
  );
  return body.attribute_values ?? [];
}

async function fetchSkillHolders(cfg: ZendeskConfig, attrId: string, valueId: string) {
  const page = await collectPages<any>({
    firstUrl: skillAgentsUrl(cfg.subdomain, attrId, valueId),
    key: "users",
    subdomain: cfg.subdomain,
    getPage: (url) => withZendeskError(() => routingRequest<Record<string, unknown>>(cfg, "GET", url)),
  });
  return { ...page, items: page.items.map((u) => summarize(u, HOLDER_KEYS) as { id: number }) };
}

export function registerRoutingTools(server: McpServer) {
  server.tool(
    "zda_list_routing_attributes",
    "List skill types (routing attributes) for skills-based routing, with the skills in each by default. Read-only.",
    {
      include_values: z
        .boolean()
        .default(true)
        .describe("Include each skill type's skills (attribute values)."),
    },
    async ({ include_values }) => {
      const cfg = loadConfig();
      const body = await withZendeskError(() =>
        routingRequest<Parameters<typeof groupSkillTypes>[0]>(
          cfg,
          "GET",
          attributesUrl(cfg.subdomain, { includeValues: include_values })
        )
      );
      const grouped = groupSkillTypes(body);
      const attributes = grouped.attributes.map((a) => ({
        ...(summarize(a, CATALOG_KEYS) as object),
        ...(include_values
          ? { attribute_values: a.attribute_values.map((v: unknown) => summarize(v, CATALOG_KEYS)) }
          : {}),
      }));
      return asTextResult({ attributes, ...(grouped.truncated ? { truncated: true } : {}) });
    }
  );

  server.tool(
    "zda_get_routing_attribute",
    "Get one skill type (routing attribute) by ID. Read-only.",
    { attribute_id: attributeId },
    async ({ attribute_id }) => {
      const cfg = loadConfig();
      const body = await withZendeskError(() =>
        routingRequest<{ attribute: unknown }>(cfg, "GET", attributeUrl(cfg.subdomain, attribute_id))
      );
      return asTextResult(body.attribute);
    }
  );

  server.tool(
    "zda_list_attribute_values",
    "List the skills (attribute values) within one skill type. Read-only.",
    { attribute_id: attributeId },
    async ({ attribute_id }) => {
      const cfg = loadConfig();
      const body = await withZendeskError(() =>
        routingRequest<{ attribute_values?: unknown[] }>(
          cfg,
          "GET",
          attributeValuesUrl(cfg.subdomain, attribute_id)
        )
      );
      return asTextResult({
        attribute_values: (body.attribute_values ?? []).map((v) => summarize(v, CATALOG_KEYS)),
      });
    }
  );

  server.tool(
    "zda_list_agent_skills",
    "List the skills one agent holds, with each skill's priority (NORMAL/HIGH). Skill IDs match zda_list_routing_attributes, which gives their skill types. Read-only.",
    { agent_id: agentId },
    async ({ agent_id }) => {
      const cfg = loadConfig();
      const skills = await fetchAgentSkills(cfg, agent_id);
      return asTextResult({
        agent_id,
        attribute_values: skills.map((s) => summarize(s, HOLDER_KEYS)),
      });
    }
  );

  server.tool(
    "zda_list_skill_agents",
    "List every agent who holds one skill, with their priority for it. Uses an undocumented Zendesk endpoint (the one behind the admin 'Agents with skill' panel). Read-only.",
    { attribute_id: attributeId, attribute_value_id: attributeValueId },
    async ({ attribute_id, attribute_value_id }) => {
      const cfg = loadConfig();
      const { items, truncated } = await fetchSkillHolders(cfg, attribute_id, attribute_value_id);
      return asTextResult({ users: items, count: items.length, ...(truncated ? { truncated } : {}) });
    }
  );

  server.tool(
    "zda_skill_coverage",
    "Answer 'if this agent is out, which of their skills are thin?' in one call: for each skill the agent holds, who else holds it, thinnest cover first. Holder data carries no region, timezone, or group — join those yourself. Read-only.",
    skillCoverageInput.shape,
    async ({ agent_id, attribute_value_ids }) => {
      const cfg = loadConfig();
      let skills = await fetchAgentSkills(cfg, agent_id);
      if (attribute_value_ids) skills = skills.filter((s) => attribute_value_ids.includes(s.id));

      const attrs = await withZendeskError(() =>
        routingRequest<Parameters<typeof groupSkillTypes>[0]>(
          cfg,
          "GET",
          attributesUrl(cfg.subdomain, { includeValues: true })
        )
      );
      const catalog = buildSkillCatalog(groupSkillTypes(attrs).attributes);

      // One lookup per skill, failing soft: the /agents endpoint is undocumented,
      // so one bad lookup shouldn't sink the whole report.
      const holders = new Map<string, HolderLookup>();
      for (const s of skills) {
        const ref = catalog.get(s.id);
        if (!ref) {
          holders.set(s.id, { error: "Skill not found in the account's skill types." });
          continue;
        }
        try {
          holders.set(s.id, await fetchSkillHolders(cfg, ref.attribute_id, s.id));
        } catch (err) {
          holders.set(s.id, {
            error: `Holder lookup failed (undocumented endpoint): ${(err as Error).message}`,
          });
        }
      }

      return asTextResult({
        agent_id,
        skills: buildCoverage({ agentId: agent_id, agentSkills: skills, catalog, holders }),
      });
    }
  );

  server.tool(
    "zda_update_agent_skills",
    "Add skills to and/or remove skills from one or more agents. Skills not listed are left alone, and so are existing priorities unless you set one. Runs as a Zendesk background job; this waits briefly for it to finish. GUARDED: skills change live ticket routing — call without require_confirm to preview each agent's current skills and the change, then re-call with require_confirm: true.",
    updateAgentSkillsShape.shape,
    async (args) => {
      const parsed = updateAgentSkillsInput.safeParse(args);
      if (!parsed.success) {
        throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
      }
      const { agent_ids, add, remove, require_confirm } = parsed.data;
      const cfg = loadConfig();
      const jobs = buildSkillJobs({ agentIds: agent_ids, add, remove });

      return runGuarded({
        requireConfirm: require_confirm,
        action: `update skills for agent(s) ${agent_ids.join(", ")}`,
        fetchCurrent: async () => {
          const current: Record<number, unknown> = {};
          for (const id of agent_ids) {
            current[id] = (await fetchAgentSkills(cfg, id)).map((s) => summarize(s, HOLDER_KEYS));
          }
          return current;
        },
        proposed: { add, remove },
        execute: async () => {
          const results = [];
          for (const body of jobs) {
            const { job_status } = await withZendeskError(() =>
              routingRequest<{ job_status: JobStatus }>(
                cfg,
                "POST",
                agentSkillsJobUrl(cfg.subdomain),
                body
              )
            );
            const final = await waitForJob(async () => {
              const res = await withZendeskError(() =>
                routingRequest<{ job_status: JobStatus }>(
                  cfg,
                  "GET",
                  jobStatusUrl(cfg.subdomain, job_status.id)
                )
              );
              return res.job_status;
            });
            results.push({ action: body.job.action, job_status: final });
          }
          return { agent_ids, results };
        },
      });
    }
  );
}

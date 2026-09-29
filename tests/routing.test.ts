import { describe, it, expect, vi } from "vitest";
import {
  attributesUrl,
  attributeUrl,
  attributeValuesUrl,
  agentSkillsUrl,
  skillAgentsUrl,
  agentSkillsJobUrl,
  jobStatusUrl,
  collectPages,
  buildSkillCatalog,
  groupSkillTypes,
  buildCoverage,
  buildSkillJobs,
  waitForJob,
} from "../src/routing.js";
import { updateAgentSkillsInput, skillCoverageInput } from "../src/tools/routing.js";

const BASE = "https://acme.zendesk.com/api/v2";

describe("routing URL builders", () => {
  it("builds the attributes collection URL, optionally sideloading values", () => {
    expect(attributesUrl("acme")).toBe(`${BASE}/routing/attributes`);
    expect(attributesUrl("acme", { includeValues: true })).toBe(
      `${BASE}/routing/attributes?include=attribute_values`
    );
  });
  it("builds attribute and attribute-value URLs", () => {
    expect(attributeUrl("acme", "a1")).toBe(`${BASE}/routing/attributes/a1`);
    expect(attributeValuesUrl("acme", "a1")).toBe(`${BASE}/routing/attributes/a1/values`);
  });
  it("builds the per-agent skills URL", () => {
    expect(agentSkillsUrl("acme", 224)).toBe(`${BASE}/routing/agents/224/instance_values`);
  });
  it("builds the (undocumented) holders-of-a-skill URL", () => {
    expect(skillAgentsUrl("acme", "a1", "v1")).toBe(
      `${BASE}/routing/attributes/a1/values/v1/agents`
    );
  });
  it("builds the bulk job and job-status URLs", () => {
    expect(agentSkillsJobUrl("acme")).toBe(`${BASE}/routing/agents/instance_values/jobs`);
    expect(jobStatusUrl("acme", "V3-abc")).toBe(`${BASE}/job_statuses/V3-abc`);
  });
  it("encodes caller-supplied path segments", () => {
    expect(attributeUrl("acme", "a/../b")).toBe(`${BASE}/routing/attributes/a%2F..%2Fb`);
  });
});

describe("collectPages", () => {
  const page = (items: number[], next: string | null) => ({ users: items, next_page: next });

  it("follows next_page until null, concatenating items", async () => {
    const getPage = vi
      .fn()
      .mockResolvedValueOnce(page([1, 2], `${BASE}/x?page=2`))
      .mockResolvedValueOnce(page([3], null));
    const out = await collectPages({ firstUrl: `${BASE}/x`, key: "users", subdomain: "acme", getPage });
    expect(out).toEqual({ items: [1, 2, 3], truncated: false });
    expect(getPage).toHaveBeenLastCalledWith(`${BASE}/x?page=2`);
  });

  it("stops at maxPages and flags the result as truncated", async () => {
    const getPage = vi.fn().mockResolvedValue(page([1], `${BASE}/x?page=n`));
    const out = await collectPages({
      firstUrl: `${BASE}/x`,
      key: "users",
      subdomain: "acme",
      getPage,
      maxPages: 3,
    });
    expect(getPage).toHaveBeenCalledTimes(3);
    expect(out).toEqual({ items: [1, 1, 1], truncated: true });
  });

  it("refuses to follow a server-supplied next_page on a foreign host", async () => {
    const getPage = vi.fn().mockResolvedValueOnce(page([1], "https://evil.example.com/x?page=2"));
    await expect(
      collectPages({ firstUrl: `${BASE}/x`, key: "users", subdomain: "acme", getPage })
    ).rejects.toThrow(/Refusing to send credentials/);
    expect(getPage).toHaveBeenCalledTimes(1);
  });
});

const attributes = [
  {
    id: "q",
    name: "Queues",
    attribute_values: [
      { id: "mobile", name: "Native Mobile" },
      { id: "web", name: "Web" },
    ],
  },
  { id: "lang", name: "Language", attribute_values: [{ id: "fr", name: "French" }] },
];

describe("groupSkillTypes", () => {
  // Real shape: ?include=attribute_values sideloads skills at the top level,
  // tagged with attribute_id — they are NOT inlined per attribute.
  const body = {
    attributes: [
      { id: "q", name: "Queues" },
      { id: "empty", name: "Unused" },
    ],
    attribute_values: [
      { id: "mobile", name: "Native Mobile", attribute_id: "q" },
      { id: "web", name: "Web", attribute_id: "q" },
    ],
    next_page: null,
  };

  it("nests sideloaded skills under their skill type", () => {
    const { attributes } = groupSkillTypes(body);
    expect(attributes[0].attribute_values.map((v: any) => v.id)).toEqual(["mobile", "web"]);
    expect(attributes[1].attribute_values).toEqual([]);
  });
  it("flags a listing that has more pages", () => {
    expect(groupSkillTypes(body).truncated).toBe(false);
    expect(groupSkillTypes({ ...body, next_page: "https://acme.zendesk.com/x?page=2" }).truncated).toBe(true);
  });
});

describe("buildSkillCatalog", () => {
  it("maps each skill id to its skill type", () => {
    const catalog = buildSkillCatalog(attributes);
    expect(catalog.get("fr")).toEqual({ attribute_id: "lang", attribute: "Language", skill: "French" });
    expect(catalog.size).toBe(3);
  });
  it("tolerates an attribute with no sideloaded values", () => {
    expect(buildSkillCatalog([{ id: "x", name: "Empty" }]).size).toBe(0);
  });
});

describe("buildCoverage", () => {
  const catalog = buildSkillCatalog(attributes);
  const agent = (id: number, priority = "NORMAL") => ({ id, name: `A${id}`, agent_skill_priority: priority });

  it("subtracts the agent from each holder list and sorts thinnest first", () => {
    const rows = buildCoverage({
      agentId: 1,
      agentSkills: [
        { id: "mobile", name: "Native Mobile", agent_skill_priority: "HIGH" },
        { id: "fr", name: "French", agent_skill_priority: "NORMAL" },
      ],
      catalog,
      holders: new Map([
        ["mobile", { items: [agent(1), agent(2), agent(3)], truncated: false }],
        ["fr", { items: [agent(1)], truncated: false }],
      ]),
    });
    expect(rows.map((r) => r.skill)).toEqual(["French", "Native Mobile"]);
    expect(rows[0]).toMatchObject({
      attribute: "Language",
      attribute_value_id: "fr",
      holders: [],
      holder_count: 1,
      holder_count_excluding_agent: 0,
    });
    expect(rows[1]).toMatchObject({
      agent_skill_priority: "HIGH",
      holders: [agent(2), agent(3)],
      holder_count: 3,
      holder_count_excluding_agent: 2,
    });
  });

  it("fails soft per skill when its holder lookup errored", () => {
    const rows = buildCoverage({
      agentId: 1,
      agentSkills: [{ id: "web", name: "Web" }],
      catalog,
      holders: new Map([["web", { error: "404 Not Found" }]]),
    });
    expect(rows[0]).toMatchObject({ skill: "Web", holders: null, error: "404 Not Found" });
  });

  it("flags truncated holder lists", () => {
    const rows = buildCoverage({
      agentId: 1,
      agentSkills: [{ id: "web", name: "Web" }],
      catalog,
      holders: new Map([["web", { items: [agent(2)], truncated: true }]]),
    });
    expect(rows[0].holders_truncated).toBe(true);
  });
});

describe("buildSkillJobs", () => {
  it("emits an upsert job for additions and a delete job for removals", () => {
    const jobs = buildSkillJobs({
      agentIds: [224, 225],
      add: [{ attribute_value_id: "fr", agent_skill_priority: "HIGH" }, { attribute_value_id: "web" }],
      remove: ["mobile"],
    });
    expect(jobs).toEqual([
      {
        job: {
          action: "upsert",
          attributes: {
            attribute_values: [{ id: "fr", agent_skill_priority: "HIGH" }, { id: "web" }],
          },
          items: [224, 225],
        },
      },
      {
        job: {
          action: "delete",
          attributes: { attribute_values: [{ id: "mobile" }] },
          items: [224, 225],
        },
      },
    ]);
  });
  it("never emits the replace-everything 'update' action", () => {
    const jobs = buildSkillJobs({ agentIds: [1], add: [{ attribute_value_id: "x" }], remove: [] });
    expect(jobs.map((j) => j.job.action)).toEqual(["upsert"]);
  });
});

describe("waitForJob", () => {
  const noSleep = async () => {};

  it("polls until the job reaches a terminal status", async () => {
    const getStatus = vi
      .fn()
      .mockResolvedValueOnce({ id: "j", status: "queued" })
      .mockResolvedValueOnce({ id: "j", status: "working" })
      .mockResolvedValueOnce({ id: "j", status: "completed", results: [] });
    const out = await waitForJob(getStatus, { sleep: noSleep });
    expect(out).toEqual({ id: "j", status: "completed", results: [] });
    expect(getStatus).toHaveBeenCalledTimes(3);
  });

  it("returns the last status once attempts run out, without throwing", async () => {
    const getStatus = vi.fn().mockResolvedValue({ id: "j", status: "working" });
    const out = await waitForJob(getStatus, { attempts: 2, sleep: noSleep });
    expect(out.status).toBe("working");
    expect(getStatus).toHaveBeenCalledTimes(2);
  });
});

describe("updateAgentSkillsInput", () => {
  it("defaults require_confirm to false and add/remove to empty", () => {
    const parsed = updateAgentSkillsInput.parse({ agent_ids: [1], remove: ["x"] });
    expect(parsed).toEqual({ agent_ids: [1], add: [], remove: ["x"], require_confirm: false });
  });
  it("requires at least one change", () => {
    expect(updateAgentSkillsInput.safeParse({ agent_ids: [1] }).success).toBe(false);
  });
  it("rejects a skill that is both added and removed", () => {
    const r = updateAgentSkillsInput.safeParse({
      agent_ids: [1],
      add: [{ attribute_value_id: "x" }],
      remove: ["x"],
    });
    expect(r.success).toBe(false);
  });
  it("caps agent_ids at the bulk endpoint's limit of 100", () => {
    const ids = Array.from({ length: 101 }, (_, i) => i + 1);
    expect(updateAgentSkillsInput.safeParse({ agent_ids: ids, remove: ["x"] }).success).toBe(false);
  });
  it("only accepts NORMAL or HIGH priority", () => {
    const r = updateAgentSkillsInput.safeParse({
      agent_ids: [1],
      add: [{ attribute_value_id: "x", agent_skill_priority: "LOW" }],
    });
    expect(r.success).toBe(false);
  });
});

describe("skillCoverageInput", () => {
  it("takes an agent id and an optional list of skills to narrow to", () => {
    expect(skillCoverageInput.parse({ agent_id: 5 })).toEqual({ agent_id: 5 });
    expect(skillCoverageInput.safeParse({ agent_id: 5, attribute_value_ids: ["a"] }).success).toBe(true);
  });
});

import "dotenv/config";
import { createZendeskClient, withZendeskError, loadConfig } from "../src/zendesk.js";
import { fetchAuditLogs } from "../src/audit.js";
import { schedulesClient, listHolidays } from "../src/schedules.js";
import {
  routingRequest,
  attributesUrl,
  agentSkillsUrl,
  skillAgentsUrl,
  collectPages,
  groupSkillTypes,
} from "../src/routing.js";

async function main() {
  const cfg = loadConfig();
  const client = createZendeskClient(cfg) as any;

  console.log("=== Admin reads smoke ===");

  console.log("1. list triggers ...");
  const triggers: any = await withZendeskError(() => client.triggers.list());
  const tCount = Array.isArray(triggers) ? triggers.length : (triggers?.triggers?.length ?? "?");
  console.log(`  -> triggers: ${tCount}`);

  console.log("2. list automations ...");
  const autos: any = await withZendeskError(() => client.automations.list());
  const aCount = Array.isArray(autos) ? autos.length : (autos?.automations?.length ?? "?");
  console.log(`  -> automations: ${aCount}`);

  console.log("3. account settings ...");
  const { result: settings } = await withZendeskError(
    () => client.accountsettings.show() as Promise<{ result: unknown }>
  );
  console.log(`  -> settings keys: ${Object.keys(settings as object).slice(0, 5).join(", ")}...`);

  console.log("4. audit logs (last events) ...");
  try {
    const audit = await fetchAuditLogs(cfg.subdomain, cfg.email, cfg.token, {});
    const n = (audit as any)?.audit_logs?.length ?? "?";
    console.log(`  -> audit_logs returned: ${n}`);
  } catch (err) {
    console.log(`  -> audit logs unavailable (expected on non-Enterprise): ${(err as Error).message}`);
  }

  console.log("5. list schedules ...");
  try {
    const schedules = await withZendeskError(() => schedulesClient(cfg).list());
    console.log(`  -> schedules: ${schedules.length}`);
    const first = schedules[0] as { id: number; name: string } | undefined;
    if (first) {
      const holidays = await withZendeskError(() => listHolidays(cfg, first.id));
      console.log(`  -> holidays on '${first.name}': ${holidays.length}`);
    }
  } catch (err) {
    console.log(`  -> schedules unavailable: ${(err as Error).message}`);
  }

  console.log("6. skills-based routing ...");
  try {
    const body: any = await withZendeskError(() =>
      routingRequest(cfg, "GET", attributesUrl(cfg.subdomain, { includeValues: true }))
    );
    const { attributes: attrs, truncated } = groupSkillTypes(body);
    const nSkills = attrs.reduce((n, a) => n + a.attribute_values.length, 0);
    console.log(`  -> skill types: ${attrs.length}, skills: ${nSkills}${truncated ? " (more pages not followed)" : ""}`);
    const attr = attrs.find((a) => a.attribute_values?.length);
    const value = attr?.attribute_values[0];
    if (value) {
      const holders = await collectPages<any>({
        firstUrl: skillAgentsUrl(cfg.subdomain, attr.id, value.id),
        key: "users",
        subdomain: cfg.subdomain,
        getPage: (url) => withZendeskError(() => routingRequest(cfg, "GET", url)),
      });
      console.log(`  -> holders of '${attr.name} / ${value.name}' (undocumented /agents): ${holders.items.length}${holders.truncated ? "+" : ""}`);
      const holder = holders.items[0];
      if (holder) {
        const skills: any = await withZendeskError(() =>
          routingRequest(cfg, "GET", agentSkillsUrl(cfg.subdomain, holder.id))
        );
        const first = skills.attribute_values?.[0];
        console.log(`  -> skills held by one holder: ${skills.attribute_values?.length ?? "?"} (fields: ${first ? Object.keys(first).join(", ") : "-"})`);
      }
    }
  } catch (err) {
    console.log(`  -> skills-based routing unavailable: ${(err as Error).message}`);
  }

  console.log("\nSmoke test passed (reads only — no writes performed).");
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});

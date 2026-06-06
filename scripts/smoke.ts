import "dotenv/config";
import { createZendeskClient, withZendeskError, loadConfig } from "../src/zendesk.js";
import { fetchAuditLogs } from "../src/audit.js";

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

  console.log("\nSmoke test passed (reads only — no writes performed).");
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});

import { describe, it, expect } from "vitest";
import { runGuarded } from "../src/confirm.js";

describe("runGuarded", () => {
  it("returns a preview and does NOT execute when require_confirm is false", async () => {
    let executed = false;
    const out = await runGuarded({
      requireConfirm: false,
      action: "delete trigger 5",
      fetchCurrent: async () => ({ id: 5, title: "Old" }),
      execute: async () => {
        executed = true;
        return { deleted: true };
      },
    });
    expect(executed).toBe(false);
    const payload = JSON.parse(out.content[0].text);
    expect(payload.requires_confirmation).toBe(true);
    expect(payload.action).toBe("delete trigger 5");
    expect(payload.current_state).toEqual({ id: 5, title: "Old" });
  });

  it("includes proposed_change in the preview when provided", async () => {
    const out = await runGuarded({
      requireConfirm: false,
      action: "update trigger 5",
      fetchCurrent: async () => ({ id: 5, title: "Old" }),
      proposed: { title: "New" },
      execute: async () => ({ id: 5, title: "New" }),
    });
    const payload = JSON.parse(out.content[0].text);
    expect(payload.proposed_change).toEqual({ title: "New" });
  });

  it("executes and returns the result when require_confirm is true", async () => {
    let fetched = false;
    const out = await runGuarded({
      requireConfirm: true,
      action: "delete trigger 5",
      fetchCurrent: async () => {
        fetched = true;
        return { id: 5 };
      },
      execute: async () => ({ deleted: true, id: 5 }),
    });
    expect(fetched).toBe(false); // no preview fetch when confirming
    const payload = JSON.parse(out.content[0].text);
    expect(payload).toEqual({ deleted: true, id: 5 });
  });
});

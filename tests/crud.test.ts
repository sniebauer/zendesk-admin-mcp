import { describe, it, expect } from "vitest";
import { makeCrudSchemas } from "../src/crud.js";

describe("makeCrudSchemas (numeric id)", () => {
  const s = makeCrudSchemas("number");

  it("getInput requires a positive integer id", () => {
    expect(() => s.getInput.parse({ id: 0 })).toThrow();
    expect(() => s.getInput.parse({ id: -1 })).toThrow();
    expect(() => s.getInput.parse({ id: "abc" })).toThrow();
    expect(s.getInput.parse({ id: 7 })).toEqual({ id: 7 });
  });

  it("createInput requires a data object", () => {
    expect(() => s.createInput.parse({})).toThrow();
    expect(s.createInput.parse({ data: { title: "X" } })).toEqual({ data: { title: "X" } });
  });

  it("updateInput requires id + data and defaults require_confirm to false", () => {
    expect(() => s.updateInput.parse({ id: 1 })).toThrow();
    expect(s.updateInput.parse({ id: 1, data: { title: "X" } })).toEqual({
      id: 1,
      data: { title: "X" },
      require_confirm: false,
    });
  });

  it("deleteInput defaults require_confirm to false", () => {
    expect(s.deleteInput.parse({ id: 1 })).toEqual({ id: 1, require_confirm: false });
  });

  it("accepts a nested conditions DSL as passthrough data", () => {
    const data = {
      title: "T",
      conditions: { all: [{ field: "status", operator: "is", value: "open" }], any: [] },
      actions: [{ field: "priority", value: "high" }],
    };
    expect(s.createInput.parse({ data }).data).toEqual(data);
  });
});

describe("makeCrudSchemas (string id)", () => {
  const s = makeCrudSchemas("string");
  it("getInput requires a non-empty string id", () => {
    expect(() => s.getInput.parse({ id: "" })).toThrow();
    expect(s.getInput.parse({ id: "abc123" })).toEqual({ id: "abc123" });
  });
});

import { reorderTriggersInput } from "../src/tools/business-rules.js";

describe("reorderTriggersInput", () => {
  it("requires a non-empty array of positive integer ids and defaults require_confirm false", () => {
    expect(() => reorderTriggersInput.parse({ trigger_ids: [] })).toThrow();
    expect(() => reorderTriggersInput.parse({ trigger_ids: [0] })).toThrow();
    expect(reorderTriggersInput.parse({ trigger_ids: [3, 1, 2] })).toEqual({
      trigger_ids: [3, 1, 2],
      require_confirm: false,
    });
  });
});

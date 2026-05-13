import { describe, expect, it } from "vitest";
import { computeCost, loadPricing, normalizeModel } from "../src/pricing/loader.js";

describe("pricing loader", () => {
  it("loads the bundled snapshot with numeric prices", () => {
    const pricing = loadPricing();
    expect(Object.keys(pricing.models).length).toBeGreaterThanOrEqual(3);
    const first = Object.values(pricing.models)[0];
    expect(first).toBeDefined();
    expect(typeof first?.input).toBe("number");
    expect(typeof first?.cached_input).toBe("number");
    expect(typeof first?.output).toBe("number");
  });

  it("normalizes internal and fast suffixes", () => {
    expect(normalizeModel("claude-opus-4.7-1m-internal")).toBe("claude-opus-4.7");
    expect(normalizeModel("gpt-5-mini-fast")).toBe("gpt-5-mini");
  });

  it("computes cost using fresh, cache read, cache write, and output tokens", () => {
    const price = { vendor: "anthropic", input: 5, cached_input: 0.5, cache_write: 6.25, output: 25 };
    const cost = computeCost({ input: 38_200, cache_read: 12_000, cache_write: 3_100, output: 6_100 }, price);
    expect(cost).toBeCloseTo(0.293375, 9);
  });
});

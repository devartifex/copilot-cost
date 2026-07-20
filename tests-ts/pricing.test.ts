import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { clearPricingCache, computeCost, loadPricing, normalizeModel } from "../src/pricing/loader.js";

const root = path.resolve(".test-work", "pricing-loader");
const pricingFile = path.join(root, "pricing.yaml");

function pricingYaml(input: number, extra = ""): string {
  return `schema_version: 1
fetched_at: "2025-01-01T00:00:00.000Z"
models:
  gpt-5-mini:
    vendor: openai
    input: ${input}
    cached_input: 0.1
    output: 2
${extra}`;
}

beforeEach(() => {
  clearPricingCache();
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
});

afterEach(() => {
  clearPricingCache();
  rmSync(root, { recursive: true, force: true });
});

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

  it("memoizes pricing by path until the file changes", () => {
    writeFileSync(pricingFile, pricingYaml(1), "utf-8");

    const first = loadPricing(pricingFile);
    const second = loadPricing(pricingFile);

    expect(second).toBe(first);
  });

  it("invalidates memoized pricing when mtime or size changes", () => {
    writeFileSync(pricingFile, pricingYaml(1), "utf-8");
    const first = loadPricing(pricingFile);

    writeFileSync(pricingFile, pricingYaml(3, "    cache_write: 4\n"), "utf-8");
    const second = loadPricing(pricingFile);

    expect(second).not.toBe(first);
    expect(second.models["gpt-5-mini"]?.input).toBe(3);
    expect(second.models["gpt-5-mini"]?.cache_write).toBe(4);
  });

  it("clearPricingCache forces pricing to be read again", () => {
    writeFileSync(pricingFile, pricingYaml(1), "utf-8");
    const first = loadPricing(pricingFile);

    clearPricingCache();
    const second = loadPricing(pricingFile);

    expect(second).not.toBe(first);
    expect(second.models["gpt-5-mini"]?.input).toBe(1);
  });

  it("normalizes internal suffixes while preserving fast model pricing", () => {
    expect(normalizeModel("claude-opus-4.7-1m-internal")).toBe("claude-opus-4.7");
    expect(normalizeModel("gemini-3.1-pro-preview")).toBe("gemini-3.1-pro");
    expect(normalizeModel("gpt-5-mini-fast")).toBe("gpt-5-mini-fast");
    expect(normalizeModel("Claude Opus 4.8 (fast mode) (preview)")).toBe("claude-opus-4.8-fast");
  });

  it("normalizes display names and auto labels", () => {
    expect(normalizeModel("Claude Opus 4.7")).toBe("claude-opus-4.7");
    expect(normalizeModel("GPT-5 mini")).toBe("gpt-5-mini");
    expect(normalizeModel("Auto (Claude Sonnet 4.6)")).toBe("claude-sonnet-4.6");
  });

  it("computes cost using fresh, cache read, cache write, and output tokens", () => {
    const price = { vendor: "anthropic", input: 5, cached_input: 0.5, cache_write: 6.25, output: 25 };
    const cost = computeCost({ input: 38_200, cache_read: 12_000, cache_write: 3_100, output: 6_100 }, price);
    expect(cost).toBeCloseTo(0.293375, 9);
  });

  it("uses long-context rates only above the published threshold", () => {
    const price = {
      vendor: "openai",
      input: 2.5,
      cached_input: 0.25,
      output: 15,
      long_context_threshold: 272_000,
      long_context_input: 5,
      long_context_cached_input: 0.5,
      long_context_output: 22.5,
    };
    expect(computeCost({ input: 272_000, cache_read: 0, cache_write: 0, output: 1_000 }, price)).toBeCloseTo(0.695);
    expect(computeCost({ input: 273_000, cache_read: 0, cache_write: 0, output: 1_000 }, price)).toBeCloseTo(1.3875);
  });
});

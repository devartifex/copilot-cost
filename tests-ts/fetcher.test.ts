import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parsePricingYaml, refreshPricing } from "../src/pricing/fetcher.js";

const root = path.resolve(".test-work", "pricing-fetcher");

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});

describe("pricing fetcher", () => {
  it("parses upstream YAML rows and maps vendors", () => {
    const yaml = `
- model: 'GPT-4.1[^1]'
  provider: openai
  release_status: GA
  category: Versatile
  input: $2.00
  cached_input: $0.50
  output: $8.00

- model: GPT-4.1
  provider: openai
  category: Versatile
  threshold: '> 272K'
  tier: Long context
  input: $4.00
  cached_input: $1.00
  output: $12.00

- model: Claude Opus 4.7
  provider: anthropic
  release_status: GA
  category: Powerful
  input: $5.00
  cached_input: $0.50
  output: $25.00
  cache_write: $6.25

- model: 'Gemini 2.5 Pro[^5]'
  provider: google
  release_status: GA
  category: Powerful
  input: $1.25
  cached_input: $0.125
  output: $10.00
  notes: "Prompts \\u2264200K tokens"

- model: MAI-Code-1-Flash
  provider: microsoft
  input: $0.75
  cached_input: $0.075
  output: $4.50

- model: Kimi K2.7 Code
  provider: moonshot_ai
  input: $0.95
  cached_input: $0.19
  output: $4.00

- model: Claude Opus 4.8 (fast mode) (preview)
  provider: anthropic
  input: $10.00
  cached_input: $1.00
  output: $50.00
  cache_write: $12.50
`;
    const data = parsePricingYaml(yaml);
    expect(data.models["gpt-4.1"]?.vendor).toBe("openai");
    expect(data.models["gpt-4.1"]?.input).toBe(2);
    expect(data.models["gpt-4.1"]?.long_context_threshold).toBe(272_000);
    expect(data.models["gpt-4.1"]?.long_context_input).toBe(4);
    expect(data.models["claude-opus-4.7"]?.vendor).toBe("anthropic");
    expect(data.models["claude-opus-4.7"]?.cache_write).toBe(6.25);
    expect(data.models["gemini-2.5-pro"]?.vendor).toBe("google");
    expect(data.models["gemini-2.5-pro"]?.cached_input).toBe(0.125);
    expect(data.models["mai-code-1-flash"]?.vendor).toBe("microsoft");
    expect(data.models["kimi-k2.7-code"]?.vendor).toBe("moonshot_ai");
    expect(data.models["claude-opus-4.8-fast"]?.input).toBe(10);
  });

  it("preserves a stale last-known-good cache when refresh fails", async () => {
    mkdirSync(root, { recursive: true });
    const dest = path.join(root, "pricing.yaml");
    writeFileSync(dest, "last known good", "utf-8");
    const stale = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    utimesSync(dest, stale, stale);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await refreshPricing({ dest })).toBe(dest);
    expect(readFileSync(dest, "utf-8")).toBe("last known good");
  });

  it("writes refreshed pricing from GitHub atomically", async () => {
    mkdirSync(root, { recursive: true });
    const dest = path.join(root, "pricing.yaml");
    const upstream = `
- model: GPT-5 mini
  provider: openai
  input: $0.25
  cached_input: $0.025
  output: $2.00
- model: Claude Sonnet 5
  provider: anthropic
  input: $2.00
  cached_input: $0.20
  output: $10.00
- model: Gemini 3.5 Flash
  provider: google
  input: $1.50
  cached_input: $0.15
  output: $9.00
`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(upstream, { status: 200 })));

    expect(await refreshPricing({ force: true, dest })).toBe(dest);
    expect(readFileSync(dest, "utf-8")).toContain("claude-sonnet-5:");
    expect(readFileSync(dest, "utf-8")).toContain("fetched_at:");
  });
});

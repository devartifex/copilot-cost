import { describe, expect, it } from "vitest";
import { parsePricingYaml } from "../src/pricing/fetcher.js";

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
`;
    const data = parsePricingYaml(yaml);
    expect(data.models["gpt-4.1"]?.vendor).toBe("openai");
    expect(data.models["gpt-4.1"]?.input).toBe(2);
    expect(data.models["claude-opus-4.7"]?.vendor).toBe("anthropic");
    expect(data.models["claude-opus-4.7"]?.cache_write).toBe(6.25);
    expect(data.models["gemini-2.5-pro"]?.vendor).toBe("google");
    expect(data.models["gemini-2.5-pro"]?.cached_input).toBe(0.125);
  });
});

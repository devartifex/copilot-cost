import { describe, expect, it } from "vitest";
import { parsePricingPage } from "../src/pricing/fetcher.js";

describe("pricing fetcher", () => {
  it("parses model rows and maps vendors", () => {
    const html = `
      <table>
        <tr><th>Model</th><th>Input tokens</th><th>Cached input tokens</th><th>Output tokens</th></tr>
        <tr><td>claude-opus</td><td>$5.00 / 1M tokens</td><td>$0.50 / 1M tokens</td><td>$25.00 / 1M tokens</td></tr>
        <tr><td>gpt-five</td><td>$2.50 / 1M tokens</td><td>$0.25 / 1M tokens</td><td>$15.00 / 1M tokens</td></tr>
        <tr><td>gemini-pro</td><td>$1.25 / 1M tokens</td><td>$0.31 / 1M tokens</td><td>$10.00 / 1M tokens</td></tr>
      </table>`;
    const data = parsePricingPage(html);
    expect(data.models["claude-opus"]?.vendor).toBe("anthropic");
    expect(data.models["claude-opus"]?.cache_write).toBe(6.25);
    expect(data.models["gpt-five"]?.vendor).toBe("openai");
    expect(data.models["gemini-pro"]?.vendor).toBe("google");
  });
});

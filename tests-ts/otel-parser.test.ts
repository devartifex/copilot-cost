import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isChatSpan, normalizeSpan } from "../src/otel/parser.js";

const fixture = JSON.parse(readFileSync("tests/fixtures/sample-otel-span.jsonl", "utf-8").trim()) as unknown;

describe("OTel parser", () => {
  it("identifies chat spans and skips metric records", () => {
    expect(isChatSpan({ scopeMetrics: [] })).toBe(false);
    expect(isChatSpan({ type: "span", name: "chat claude", attributes: { "gen_ai.request.model": "claude-opus-4.7" } })).toBe(true);
    expect(isChatSpan({ hrTime: [1, 2], attributes: { "gen_ai.operation.name": "chat", "gen_ai.request.model": "gpt-5-mini" } })).toBe(true);
  });

  it("normalizes a Format-A-ish span fixture with fresh input", () => {
    const call = normalizeSpan(fixture);
    expect(call).toMatchObject({ session_id: "sess-test-123", model: "claude-opus-4.7", input_tokens: 700, output_tokens: 100, cache_read: 200, cache_creation: 100, reasoning: 20, duration_ms: 321, source: "cli-span" });
    expect(call?.dedup_key).toBe("span-1");
    expect(call?.ts).toBe("2026-05-13T12:00:00.000Z");
  });

  it("normalizes Format A tuple times", () => {
    const call = normalizeSpan({ traceId: "t1", spanId: "s1", startTime: [1_700_000_000, 500_000_000], endTime: [1_700_000_001, 0], attributes: { "gen_ai.operation.name": "chat", "gen_ai.request.model": "gpt-5-mini", "gen_ai.usage.input_tokens": 10, "gen_ai.usage.output_tokens": 2 } });
    expect(call?.dedup_key).toBe("t1:s1");
    expect(call?.duration_ms).toBe(500);
    expect(call?.ts).toBe("2023-11-14T22:13:20.500Z");
  });

  it("normalizes a Format-B LogRecord", () => {
    const call = normalizeSpan({ hrTime: [1_700_000_100, 0], attributes: { "gen_ai.operation.name": "chat", "gen_ai.response.id": "resp-1", "gen_ai.response.model": "gpt-5-mini-fast", "gen_ai.usage.input_tokens": 50, "gen_ai.usage.cache_read.input_tokens": 20, "gen_ai.usage.output_tokens": 7, "copilot.session_id": "sess-b" } });
    expect(call).toMatchObject({ dedup_key: "resp-1", session_id: "sess-b", model: "gpt-5-mini", input_tokens: 30, output_tokens: 7, cache_read: 20, duration_ms: 0, source: "chat-logrecord" });
  });

  it("normalizes alternate cache token attribute names", () => {
    const call = normalizeSpan({
      traceId: "t2",
      spanId: "s2",
      attributes: {
        "gen_ai.operation.name": "chat",
        "gen_ai.request.model": "claude-sonnet-4.6",
        "gen_ai.usage.input_tokens": 1_000,
        "gen_ai.usage.cache_read_input_tokens": 250,
        "gen_ai.usage.cache_write_input_tokens": 150,
        "gen_ai.usage.output_tokens": 50,
      },
    });
    expect(call).toMatchObject({ input_tokens: 600, cache_read: 250, cache_creation: 150, output_tokens: 50 });
  });

  it("returns null for metric records", () => {
    expect(normalizeSpan({ scopeMetrics: [], attributes: { "gen_ai.operation.name": "chat" } })).toBeNull();
  });
});

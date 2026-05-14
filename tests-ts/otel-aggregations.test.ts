import { describe, expect, it } from "vitest";
import { exportCsv, models, sessions, sessionDetail, summary, timeseries } from "../src/otel/aggregations.js";
import { type NormalizedCall } from "../src/otel/parser.js";

function call(partial: Partial<NormalizedCall>): NormalizedCall {
  return { dedup_key: partial.dedup_key ?? crypto.randomUUID(), session_id: Object.hasOwn(partial, "session_id") ? partial.session_id! : "s1", ts: partial.ts ?? "2026-05-13T12:00:00.000Z", model: partial.model ?? "m1", input_tokens: partial.input_tokens ?? 0, output_tokens: partial.output_tokens ?? 0, cache_read: partial.cache_read ?? 0, cache_creation: partial.cache_creation ?? 0, reasoning: partial.reasoning ?? 0, usd_cost: partial.usd_cost ?? 0, duration_ms: partial.duration_ms ?? 0, source: partial.source ?? "cli-span" };
}

describe("OTel aggregations", () => {
  it("handles empty input", () => {
    expect(summary([], new Date("2026-05-13T12:00:00Z")).lifetime.usd_cost).toBe(0);
    expect(sessions([])).toEqual([]);
    expect(timeseries([], "all")).toEqual([]);
    expect(models([])).toEqual([]);
    expect(exportCsv([])).toContain("dedup_key,session_id,ts,model");
  });

  it("summarizes periods, sessions, timeseries, models, and CSV", () => {
    const calls = [
      call({ dedup_key: "a", session_id: "s1", ts: "2026-05-13T10:00:00.000Z", model: "m1", input_tokens: 10, output_tokens: 5, cache_read: 5, cache_creation: 1, usd_cost: 1, duration_ms: 100 }),
      call({ dedup_key: "b", session_id: "s1", ts: "2026-05-12T10:00:00.000Z", model: "m2", input_tokens: 20, output_tokens: 7, cache_read: 0, cache_creation: 3, usd_cost: 2, duration_ms: 200 }),
      call({ dedup_key: "c", session_id: "s2", ts: "2026-05-05T10:00:00.000Z", model: "m1", input_tokens: 30, output_tokens: 9, cache_read: 10, cache_creation: 0, usd_cost: 3, duration_ms: 300 }),
    ];

    const sum = summary(calls, new Date("2026-05-13T12:00:00Z"));
    expect(sum.lifetime).toEqual({ usd_cost: 6, input_tokens: 60, output_tokens: 21, cache_tokens: 19, premium_requests: 3 });
    expect(sum.today.usd_cost).toBe(1);
    expect(sum.week.usd_cost).toBe(3);
    expect(sum.month.usd_cost).toBe(6);
    expect(sum.session_count).toBe(2);

    const sessionRows = sessions(calls);
    expect(sessionRows).toHaveLength(2);
    expect(sessionRows.find((row) => row.id === "s1")).toMatchObject({ usd_cost: 3, total_input_tokens: 30, total_output_tokens: 12, total_cache_read_tokens: 5, total_cache_write_tokens: 4, premium_requests: 2, api_duration_ms: 300 });

    expect(sessionDetail(calls, "s1").llm_calls).toHaveLength(2);
    expect(timeseries(calls, "all")).toEqual([
      { day: "2026-05-05", model: "m1", usd_cost: 3, input_tokens: 30, output_tokens: 9 },
      { day: "2026-05-12", model: "m2", usd_cost: 2, input_tokens: 20, output_tokens: 7 },
      { day: "2026-05-13", model: "m1", usd_cost: 1, input_tokens: 10, output_tokens: 5 },
    ]);

    const modelRows = models(calls);
    expect(modelRows.find((row) => row.model === "m1")).toMatchObject({ sessions: 2, usd_cost: 4, token_volume: 70 });
    expect(modelRows.find((row) => row.model === "m1")?.cache_hit_ratio).toBeCloseTo(15 / 56, 6);
    expect(exportCsv(calls)).toContain("a,s1,2026-05-13T10:00:00.000Z,m1");
  });

  it("handles a single unknown-session call", () => {
    const rows = sessions([call({ session_id: null, usd_cost: 0.5 })]);
    expect(rows[0]?.id).toBe("unknown");
  });
});

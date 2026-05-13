import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { clearCache, readAllCalls } from "../src/otel/reader.js";

const root = path.resolve(".test-work", "otel-reader");
const savedEnv = { ...process.env };
const { COPILOT_OTEL_ENABLED, COPILOT_OTEL_FILE_EXPORTER_PATH, COPILOT_OTEL_EXPORTER_TYPE, COPILOT_OTEL_DIR, ...envWithoutOtel } = savedEnv;

function line(id: string, input = 10): string {
  return JSON.stringify({ traceId: "trace", spanId: id, startTime: [1_700_000_000, 0], endTime: [1_700_000_000, 1_000_000], attributes: { "gen_ai.operation.name": "chat", "gen_ai.request.model": "gpt-5-mini", "gen_ai.usage.input_tokens": input, "gen_ai.usage.output_tokens": 1 } });
}

beforeEach(() => {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  process.env = { ...envWithoutOtel, COPILOT_OTEL_DIR: root };
  clearCache();
});

afterEach(() => {
  process.env = { ...savedEnv };
  clearCache();
  rmSync(root, { recursive: true, force: true });
});

describe("OTel reader", () => {
  it("reads JSONL files, deduplicates, filters, and invalidates cache by mtime/size", () => {
    writeFileSync(path.join(root, "a.jsonl"), `${line("a")}\n${line("dup")}\n`, "utf-8");
    writeFileSync(path.join(root, "b.jsonl"), `${line("dup")}\n${line("b")}\n`, "utf-8");

    expect(readAllCalls()).toHaveLength(3);
    expect(readAllCalls({ since: new Date("2023-11-14T22:13:21Z") })).toHaveLength(0);

    writeFileSync(path.join(root, "a.jsonl"), `${line("a", 20)}\n${line("c")}\n${line("dup")}\n`, "utf-8");
    const calls = readAllCalls();
    expect(calls.map((call) => call.dedup_key).sort()).toEqual(["trace:a", "trace:b", "trace:c", "trace:dup"]);
    expect(calls.find((call) => call.dedup_key === "trace:a")?.input_tokens).toBe(20);
  });
});

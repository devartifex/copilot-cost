import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { clearCache, readAllCalls } from "../src/otel/reader.js";
import { clearSessionMetaCache } from "../src/util/session-meta.js";

const root = path.resolve(".test-work", "otel-reader");
const savedEnv = { ...process.env };
const { COPILOT_OTEL_ENABLED, COPILOT_OTEL_FILE_EXPORTER_PATH, COPILOT_OTEL_EXPORTER_TYPE, COPILOT_OTEL_DIR, ...envWithoutOtel } = savedEnv;

function line(id: string, input = 10, startSec = 1_700_000_000): string {
  return JSON.stringify({ traceId: "trace", spanId: id, startTime: [startSec, 0], endTime: [startSec, 1_000_000], attributes: { "gen_ai.operation.name": "chat", "gen_ai.request.model": "gpt-5-mini", "gen_ai.usage.input_tokens": input, "gen_ai.usage.output_tokens": 1, "gen_ai.conversation.id": "conv-x" } });
}

beforeEach(() => {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  process.env = { ...envWithoutOtel, COPILOT_OTEL_DIR: root };
  clearCache();
  clearSessionMetaCache();
});

afterEach(() => {
  process.env = { ...savedEnv };
  clearCache();
  clearSessionMetaCache();
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

  it("falls back to gen_ai.conversation.id for session_id and enriches from sidecar meta", () => {
    writeFileSync(path.join(root, "a.jsonl"), `${line("a", 10, 1_700_000_000)}\n`, "utf-8");
    const callIso = new Date(1_700_000_000_000).toISOString();
    writeFileSync(
      path.join(root, "copilot-cost-meta.jsonl"),
      `${JSON.stringify({ ts: callIso, session_id: "sess-CLI-1", session_name: "My chat", cwd: "/Users/me/proj", model: "gpt-5-mini" })}\n`,
      "utf-8",
    );

    const [call] = readAllCalls();
    expect(call.session_id).toBe("sess-CLI-1");
    expect(call.session_name).toBe("My chat");
    expect(call.cwd).toBe("/Users/me/proj");
  });

  it("uses gen_ai.conversation.id when no sidecar metadata is available", () => {
    writeFileSync(path.join(root, "a.jsonl"), `${line("a")}\n`, "utf-8");
    const [call] = readAllCalls();
    expect(call.session_id).toBe("conv-x");
  });
});

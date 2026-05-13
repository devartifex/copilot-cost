import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { migrateFromSqliteIfPresent } from "../src/otel/migrate.js";

const root = path.resolve(".test-work", "migrate");

async function hasNodeSqlite(): Promise<boolean> {
  try {
    await import("node:sqlite");
    return true;
  } catch {
    return false;
  }
}

describe("SQLite migration", () => {
  it("exports legacy rows or skips cleanly when SQLite support is unavailable", async () => {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
    const dbPath = path.join(root, "usage.db");
    const jsonlOut = path.join(root, "legacy.jsonl");

    if (await hasNodeSqlite()) {
      const mod = await import("node:sqlite");
      const db = new mod.DatabaseSync(dbPath);
      db.exec(`
        CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, first_model TEXT, started_at TEXT, last_seen_at TEXT, session_name TEXT);
        CREATE TABLE snapshots (session_id TEXT, ts TEXT, model TEXT, total_input_tokens INTEGER, total_output_tokens INTEGER, total_cache_read_tokens INTEGER, total_cache_write_tokens INTEGER, total_reasoning_tokens INTEGER, context_window_size INTEGER, premium_requests INTEGER, api_duration_ms INTEGER, usd_cost REAL, PRIMARY KEY (session_id, ts));
        CREATE TABLE llm_calls (span_id TEXT PRIMARY KEY, session_id TEXT, ts TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER, cache_read INTEGER, cache_creation INTEGER, reasoning INTEGER, usd_cost REAL, duration_ms INTEGER);
        INSERT INTO sessions VALUES ('s1', '/repo', 'm1', '2026-05-01T00:00:00Z', '2026-05-01T00:01:00Z', 'session one');
        INSERT INTO llm_calls VALUES ('span1', 's1', '2026-05-01T00:00:01Z', 'm1', 100, 10, 25, 5, 1, 0.25, 123);
        INSERT INTO snapshots VALUES ('s1', '2026-05-01T00:00:02Z', 'm1', 200, 20, 40, 10, 2, 1000, 1, 456, 0.5);
      `);
      db.close();

      const result = await migrateFromSqliteIfPresent({ dbPath, jsonlOut });
      expect(result.exported).toBe(2);
      expect(result.archivedTo && existsSync(result.archivedTo)).toBe(true);
      expect(existsSync(dbPath)).toBe(false);
      const lines = readFileSync(jsonlOut, "utf-8").trim().split("\n").map((line) => JSON.parse(line) as any);
      expect(lines.find((line) => line.dedup_key === "span1")).toMatchObject({ session_id: "s1", input_tokens: 75, cache_read: 25, source: "legacy-snapshot", cwd: "/repo" });
      expect(lines.find((line) => line.legacy_table === "snapshots")).toMatchObject({ input_tokens: 160, output_tokens: 20 });
    } else {
      writeFileSync(dbPath, "not sqlite", "utf-8");
      const result = await migrateFromSqliteIfPresent({ dbPath, jsonlOut });
      expect(result.exported).toBe(0);
      expect(existsSync(path.join(root, ".migration-skipped"))).toBe(true);
    }

    rmSync(root, { recursive: true, force: true });
  });
});

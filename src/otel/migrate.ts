import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { LEGACY_JSONL } from "./paths.js";
import { type NormalizedCall } from "./parser.js";

export interface MigrationResult { dbPath: string | null; exported: number; jsonlPath: string | null; archivedTo: string | null; ranAt: string }

type Row = Record<string, unknown>;
type SqliteReader = { all(sql: string): Row[]; close(): void };

const COST_CACHE_DIR = path.join(homedir(), ".copilot", "cost-cache");
const DEFAULT_DB = path.join(COST_CACHE_DIR, "usage.db");
const MIGRATED = path.join(COST_CACHE_DIR, ".migrated");
const SKIPPED = path.join(COST_CACHE_DIR, ".migration-skipped");

async function dynamicImport(specifier: string): Promise<any> {
  return import(specifier);
}

function int(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.max(Math.trunc(n), 0) : 0;
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function str(value: unknown): string | null {
  return value === undefined || value === null || value === "" ? null : String(value);
}

function timestamp(): string {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function openSqlite(dbPath: string): Promise<SqliteReader | null> {
  try {
    const mod = await dynamicImport("node:sqlite");
    const DatabaseSync = mod.DatabaseSync;
    if (DatabaseSync) {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      return { all: (sql: string) => db.prepare(sql).all() as Row[], close: () => db.close() };
    }
  } catch {
    // Node 18/20 do not ship node:sqlite; fall back to an optional peer below.
  }

  try {
    const mod = await dynamicImport("better-sqlite3");
    const BetterSqlite = mod.default ?? mod;
    const db = new BetterSqlite(dbPath, { readonly: true, fileMustExist: true });
    return { all: (sql: string) => db.prepare(sql).all() as Row[], close: () => db.close() };
  } catch {
    return null;
  }
}

function tableExists(db: SqliteReader, table: string): boolean {
  return db.all(`SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`).length > 0;
}

function normalizeLegacyCall(row: Row): NormalizedCall & Row {
  const cacheRead = int(row.cache_read ?? row.total_cache_read_tokens);
  const cacheCreation = int(row.cache_creation ?? row.total_cache_write_tokens);
  return {
    dedup_key: str(row.span_id) ?? `legacy:${str(row.session_id) ?? "unknown"}:${str(row.ts) ?? ""}:${str(row.model) ?? "unknown"}`,
    session_id: str(row.session_id),
    ts: str(row.ts) ?? new Date(0).toISOString(),
    model: str(row.model) ?? "unknown",
    input_tokens: Math.max(int(row.input_tokens ?? row.total_input_tokens) - cacheRead, 0),
    output_tokens: int(row.output_tokens ?? row.total_output_tokens),
    cache_read: cacheRead,
    cache_creation: cacheCreation,
    reasoning: int(row.reasoning ?? row.total_reasoning_tokens),
    usd_cost: num(row.usd_cost),
    duration_ms: int(row.duration_ms ?? row.api_duration_ms),
    source: "legacy-snapshot",
    cwd: str(row.cwd),
    session_name: str(row.session_name),
    first_model: str(row.first_model),
    started_at: str(row.started_at),
    last_seen_at: str(row.last_seen_at),
    legacy_table: row.legacy_table,
    ...(row.legacy_table === "snapshots" ? { snapshot: row } : {}),
  };
}

function readLegacyRows(db: SqliteReader): Row[] {
  const rows: Row[] = [];
  const hasSessions = tableExists(db, "sessions");
  if (tableExists(db, "llm_calls")) {
    const sessionColumns = hasSessions ? ", s.cwd, s.first_model, s.started_at, s.last_seen_at, s.session_name" : "";
    const join = hasSessions ? " LEFT JOIN sessions s ON s.id = c.session_id" : "";
    rows.push(...db.all(`SELECT c.*, 'llm_calls' AS legacy_table${sessionColumns} FROM llm_calls c${join}`));
  }
  if (tableExists(db, "snapshots")) {
    const sessionColumns = hasSessions ? ", s.cwd, s.first_model, s.started_at, s.last_seen_at, s.session_name" : "";
    const join = hasSessions ? " LEFT JOIN sessions s ON s.id = x.session_id" : "";
    rows.push(...db.all(`SELECT x.*, 'snapshots' AS legacy_table${sessionColumns} FROM snapshots x${join}`));
  }
  return rows;
}

/**
 * One-shot legacy SQLite exporter. Runtime has no SQLite dependency: it uses
 * Node 22+'s node:sqlite when present, otherwise an optional better-sqlite3
 * peer if the user installed it temporarily. On Node 18/20 without that peer,
 * migration is skipped with a .migration-skipped sentinel and the DB untouched.
 */
export async function migrateFromSqliteIfPresent(opts: { dbPath?: string; jsonlOut?: string } = {}): Promise<MigrationResult> {
  const dbPath = opts.dbPath ?? DEFAULT_DB;
  const jsonlPath = opts.jsonlOut ?? LEGACY_JSONL;
  const ranAt = new Date().toISOString();
  const sentinel = opts.dbPath ? path.join(path.dirname(dbPath), ".migrated") : MIGRATED;
  const skipped = opts.dbPath ? path.join(path.dirname(dbPath), ".migration-skipped") : SKIPPED;

  if (existsSync(sentinel)) return { dbPath, exported: 0, jsonlPath, archivedTo: null, ranAt };
  if (!existsSync(dbPath)) return { dbPath: null, exported: 0, jsonlPath: null, archivedTo: null, ranAt };

  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = await openSqlite(dbPath);
  if (!db) {
    const reason = "SQLite migration skipped: node:sqlite is unavailable and optional peer better-sqlite3 is not installed. Run migrate on Node 22+ or install better-sqlite3 temporarily.";
    writeFileSync(skipped, `${reason}\n`, "utf-8");
    console.warn(reason);
    return { dbPath, exported: 0, jsonlPath: null, archivedTo: null, ranAt };
  }

  try {
    const calls = readLegacyRows(db).map(normalizeLegacyCall);
    mkdirSync(path.dirname(jsonlPath), { recursive: true });
    if (calls.length) await appendFile(jsonlPath, calls.map((call) => JSON.stringify(call)).join("\n") + "\n", "utf-8");
    const archivedTo = `${dbPath}.bak.${timestamp()}`;
    db.close();
    renameSync(dbPath, archivedTo);
    writeFileSync(sentinel, JSON.stringify({ ranAt, exported: calls.length, jsonlPath, archivedTo }) + "\n", "utf-8");
    return { dbPath, exported: calls.length, jsonlPath, archivedTo, ranAt };
  } catch (error) {
    db.close();
    throw error;
  }
}

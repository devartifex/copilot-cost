import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { CACHE_PRICING, SNAPSHOT, clearPricingCache, type ModelPrice, type Pricing } from "./loader.js";
import { parseDollar, splitLines, stripComment, unquote } from "./yaml-utils.js";

export type PricingData = Pricing;

export const URL =
  "https://raw.githubusercontent.com/github/docs/main/data/tables/copilot/models-and-pricing.yml";

export const DOCS_URL =
  "https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing";

const VENDOR_ALIASES: Record<string, ModelPrice["vendor"]> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  xai: "xai",
  github: "github",
  microsoft: "microsoft",
  moonshot_ai: "moonshot_ai",
};

function normalizeModelName(raw: string): string {
  return unquote(raw)
    .replace(/\s*\(fast mode\)\s*\(preview\)\s*$/i, " fast")
    .replace(/\[\^[^\]]+\]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

interface RawEntry {
  model?: string;
  provider?: string;
  category?: string;
  threshold?: string;
  tier?: string;
  input?: string;
  cached_input?: string;
  output?: string;
  cache_write?: string;
}

function parseTokenThreshold(raw: string | undefined): number | null {
  if (!raw) return null;
  const match = /(\d+(?:\.\d+)?)\s*([km])?/i.exec(unquote(raw).replace(/,/g, ""));
  if (!match?.[1]) return null;
  const value = Number.parseFloat(match[1]);
  const multiplier = match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2]?.toLowerCase() === "k" ? 1_000 : 1;
  return Number.isFinite(value) ? Math.trunc(value * multiplier) : null;
}

export function parsePricingYaml(text: string): PricingData {
  const lines = splitLines(text);
  const entries: RawEntry[] = [];
  let current: RawEntry | null = null;

  for (const raw of lines) {
    const noComment = stripComment(raw);
    if (!noComment.trim()) continue;
    const dashMatch = /^(\s*)-\s+(.*)$/.exec(noComment);
    if (dashMatch) {
      current = {};
      entries.push(current);
      const rest = dashMatch[2] ?? "";
      const kv = /^([\w-]+)\s*:\s*(.*)$/.exec(rest);
      if (kv?.[1]) {
        (current as Record<string, string>)[kv[1]] = (kv[2] ?? "").trim();
      }
      continue;
    }
    if (!current) continue;
    const kv = /^\s+([\w-]+)\s*:\s*(.*)$/.exec(noComment);
    if (kv?.[1]) {
      (current as Record<string, string>)[kv[1]] = (kv[2] ?? "").trim();
    }
  }

  const models: Record<string, ModelPrice> = {};
  const longContextRows = new Map<string, RawEntry>();
  for (const entry of entries) {
    if (!entry.model || !entry.provider) continue;
    const vendor = VENDOR_ALIASES[entry.provider.trim().toLowerCase()];
    if (!vendor) continue;
    const id = normalizeModelName(entry.model);
    if (!id) continue;
    if (unquote(entry.tier ?? "").trim().toLowerCase() === "long context") {
      longContextRows.set(id, entry);
      continue;
    }
    const row: ModelPrice = {
      vendor,
      input: parseDollar(entry.input),
      cached_input: parseDollar(entry.cached_input),
      output: parseDollar(entry.output),
    };
    if (entry.cache_write != null) {
      row.cache_write = parseDollar(entry.cache_write);
    }
    if (entry.category) {
      row.category = unquote(entry.category).toLowerCase();
    }
    models[id] = row;
  }

  for (const [id, entry] of longContextRows) {
    const row = models[id];
    const threshold = parseTokenThreshold(entry.threshold);
    if (!row || threshold == null) continue;
    row.long_context_threshold = threshold;
    row.long_context_input = parseDollar(entry.input);
    row.long_context_cached_input = parseDollar(entry.cached_input);
    row.long_context_output = parseDollar(entry.output);
    if (entry.cache_write != null) {
      row.long_context_cache_write = parseDollar(entry.cache_write);
    }
  }

  if (Object.keys(models).length < 3) {
    throw new Error("could not parse enough model pricing rows");
  }
  return { schema_version: 1, fetched_at: new Date().toISOString().slice(0, 10), models };
}

export const parsePricingPage = parsePricingYaml;

export function dumpYaml(data: PricingData): string {
  const lines = ["schema_version: 1", `fetched_at: ${data.fetched_at}`, "", "models:"];
  for (const model of Object.keys(data.models).sort()) {
    lines.push(`  ${model}:`);
    const row = data.models[model];
    if (!row) continue;
    for (const [key, value] of Object.entries(row)) {
      lines.push(`    ${key}: ${value}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function cacheIsFresh(pricingPath = CACHE_PRICING): boolean {
  const configuredDays = Number.parseFloat(process.env.COPILOT_COST_REFRESH_DAYS ?? "7");
  const days = Number.isFinite(configuredDays) && configuredDays >= 0 ? configuredDays : 7;
  if (!existsSync(pricingPath)) return false;
  const ageMs = Date.now() - statSync(pricingPath).mtimeMs;
  return ageMs < days * 24 * 60 * 60 * 1000;
}

function retryMarker(dest: string): string {
  return `${dest}.last-attempt`;
}

function refreshAttemptIsRecent(dest: string): boolean {
  const marker = retryMarker(dest);
  if (!existsSync(marker)) return false;
  const configuredMinutes = Number.parseFloat(process.env.COPILOT_COST_REFRESH_RETRY_MINUTES ?? "60");
  const minutes = Number.isFinite(configuredMinutes) && configuredMinutes >= 0 ? configuredMinutes : 60;
  return Date.now() - statSync(marker).mtimeMs < minutes * 60 * 1000;
}

function writeAtomically(dest: string, contents: string): void {
  const temporary = `${dest}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, contents, "utf-8");
    renameSync(temporary, dest);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export async function refreshPricing(opts: { force?: boolean; dest?: string } = {}): Promise<string> {
  const dest = opts.dest ?? CACHE_PRICING;
  try {
    mkdirSync(path.dirname(dest), { recursive: true });
    if (!opts.force && cacheIsFresh(dest)) return dest;
    if (!opts.force && refreshAttemptIsRecent(dest)) return existsSync(dest) ? dest : SNAPSHOT;

    writeFileSync(retryMarker(dest), new Date().toISOString(), "utf-8");
    const response = await fetch(URL, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const source = await response.text();
    const data = parsePricingPage(source);
    writeAtomically(dest, dumpYaml(data));
    clearPricingCache();
    return dest;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fallback = existsSync(dest) ? dest : SNAPSHOT;
    console.error(`warning: pricing refresh failed (${message}); using ${fallback === dest ? "existing cache" : "bundled snapshot"}`);
    return fallback;
  }
}

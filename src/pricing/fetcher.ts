import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { CACHE_PRICING, SNAPSHOT, type ModelPrice, type Pricing } from "./loader.js";

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
};

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function normalizeModelName(raw: string): string {
  return unquote(raw)
    .replace(/\[\^[^\]]+\]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

function parseDollar(raw: string | undefined): number {
  if (raw == null) return 0;
  const cleaned = unquote(raw).replace(/[$,]/g, "").trim();
  const num = Number.parseFloat(cleaned);
  return Number.isFinite(num) ? num : 0;
}

interface RawEntry {
  model?: string;
  provider?: string;
  category?: string;
  input?: string;
  cached_input?: string;
  output?: string;
  cache_write?: string;
}

export function parsePricingYaml(text: string): PricingData {
  const lines = text.split(/\r?\n/);
  const entries: RawEntry[] = [];
  let current: RawEntry | null = null;

  for (const raw of lines) {
    const noComment = raw.split("#", 1)[0] ?? "";
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
  for (const entry of entries) {
    if (!entry.model || !entry.provider) continue;
    const vendor = VENDOR_ALIASES[entry.provider.trim().toLowerCase()];
    if (!vendor) continue;
    const id = normalizeModelName(entry.model);
    if (!id) continue;
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
      (row as unknown as Record<string, unknown>).category = unquote(entry.category).toLowerCase();
    }
    models[id] = row;
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
  const days = Number.parseInt(process.env.COPILOT_COST_REFRESH_DAYS ?? "7", 10);
  if (!existsSync(pricingPath)) return false;
  const ageMs = Date.now() - statSync(pricingPath).mtimeMs;
  return ageMs < days * 24 * 60 * 60 * 1000;
}

export async function refreshPricing(opts: { force?: boolean; dest?: string } = {}): Promise<string> {
  const dest = opts.dest ?? CACHE_PRICING;
  mkdirSync(path.dirname(dest), { recursive: true });
  if (!opts.force && cacheIsFresh(dest)) return dest;

  try {
    const response = await fetch(URL, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const data = parsePricingPage(html);
    writeFileSync(dest, dumpYaml(data), "utf-8");
    return dest;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`warning: pricing refresh failed (${message}); using bundled snapshot`);
    copyFileSync(SNAPSHOT, dest);
    return dest;
  }
}

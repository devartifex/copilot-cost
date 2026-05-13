import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { CACHE_PRICING, SNAPSHOT, type ModelPrice, type Pricing } from "./loader.js";

export type PricingData = Pricing;

export const URL = "https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing";

function unescapeHtml(value: string): string {
  return value
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
      if (entity.startsWith("#x") || entity.startsWith("#X")) {
        return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      }
      if (entity.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
      }
      const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
      return named[entity.toLowerCase()] ?? match;
    });
}

function stripTags(value: string): string {
  return unescapeHtml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export function parsePricingPage(html: string): PricingData {
  const rows = html.matchAll(/<tr[^>]*>(.*?)<\/tr>/gis);
  const models: Record<string, ModelPrice> = {};

  for (const rowMatch of rows) {
    const row = rowMatch[1] ?? "";
    const cells = Array.from(row.matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/gis), (cell) => stripTags(cell[1] ?? ""));
    if (cells.length < 4) continue;
    const joined = cells.join(" ").toLowerCase();
    const model = cells.find((cell) => /^(gpt|claude|gemini|grok|raptor|goldeneye)[\w.-]+$/.test(cell.toLowerCase()));
    const nums: number[] = [];
    for (const cell of cells) {
      const match = /\$?([0-9]+(?:\.[0-9]+)?)/.exec(cell.replace(/,/g, ""));
      if (match?.[1]) nums.push(Number.parseFloat(match[1]));
    }
    if (model && nums.length >= 3 && joined.includes("token")) {
      const vendor = model.startsWith("claude")
        ? "anthropic"
        : model.startsWith("gpt")
          ? "openai"
          : model.startsWith("gemini")
            ? "google"
            : model.startsWith("grok")
              ? "xai"
              : "github";
      const first = nums[0] ?? 0;
      const second = nums[1] ?? 0;
      const last = nums.at(-1) ?? 0;
      models[model] = { vendor, input: first, cached_input: second, output: last };
      if (vendor === "anthropic") {
        models[model].cache_write = Math.round(first * 1.25 * 1_000_000) / 1_000_000;
      }
    }
  }

  if (Object.keys(models).length < 3) {
    throw new Error("could not parse enough model pricing rows");
  }
  return { schema_version: 1, fetched_at: new Date().toISOString().slice(0, 10), models };
}

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

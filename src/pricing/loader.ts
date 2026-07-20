import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { parseScalar, splitLines, stripComment } from "./yaml-utils.js";

export interface ModelPrice {
  vendor: string;
  input: number;
  cached_input: number;
  output: number;
  cache_write?: number;
  category?: string;
  long_context_threshold?: number;
  long_context_input?: number;
  long_context_cached_input?: number;
  long_context_output?: number;
  long_context_cache_write?: number;
}

export interface Pricing {
  schema_version: number;
  fetched_at: string;
  models: Record<string, ModelPrice>;
}

type RawPricing = Record<string, unknown> & { models?: Record<string, Record<string, unknown>> };

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

function resolveSnapshot(): string {
  const candidates = [
    path.resolve(moduleDir, "..", "..", "pricing.snapshot.yaml"),
    path.resolve(moduleDir, "..", "pricing.snapshot.yaml"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[1] ?? path.resolve("pricing.snapshot.yaml");
}

export const CACHE_DIR = path.join(homedir(), ".copilot", "cost-cache");
export const CACHE_PRICING = path.join(CACHE_DIR, "pricing.yaml");
export const SNAPSHOT = resolveSnapshot();

type PricingCacheEntry = { mtimeMs: number; size: number; pricing: Pricing };

const pricingCache = new Map<string, PricingCacheEntry>();

export function normalizeModel(modelId: string | undefined | null): string | null {
  if (!modelId) return null;
  let model = String(modelId).trim();
  const parentheticalModel = /^auto\b.*\(([^)]+)\)/i.exec(model);
  if (parentheticalModel?.[1]) {
    model = parentheticalModel[1];
  }
  model = model
    .replace(/\s*\(fast mode\)\s*\(preview\)\s*$/i, " fast")
    .replace(/\[\^[^\]]+\]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9.+-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  for (const suffix of ["-1m-internal", "-preview"]) {
    if (model.endsWith(suffix)) {
      model = model.slice(0, -suffix.length);
    }
  }
  return model || null;
}

function parseYaml(text: string): RawPricing {
  const data: RawPricing = {};
  const models: Record<string, Record<string, unknown>> = {};
  let currentModel: string | null = null;
  let inModels = false;

  for (const raw of splitLines(text)) {
    const line = stripComment(raw).trimEnd();
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const stripped = line.trim();

    if (indent === 0 && stripped.endsWith(":")) {
      const key = stripped.slice(0, -1);
      if (key === "models") {
        data.models = models;
        inModels = true;
        currentModel = null;
      } else {
        inModels = false;
        data[key] = {};
      }
      continue;
    }

    if (indent === 0 && stripped.includes(":")) {
      const [rawKey, ...rest] = stripped.split(":");
      const key = rawKey?.trim();
      if (key) data[key] = parseScalar(rest.join(":"));
      inModels = false;
      continue;
    }

    if (inModels && indent === 2 && stripped.endsWith(":")) {
      currentModel = stripped.slice(0, -1);
      models[currentModel] = {};
      continue;
    }

    if (inModels && indent >= 4 && currentModel && stripped.includes(":")) {
      const [rawKey, ...rest] = stripped.split(":");
      const key = rawKey?.trim();
      if (key) models[currentModel]![key] = parseScalar(rest.join(":"));
    }
  }

  data.models ??= models;
  return data;
}

function coercePricing(raw: RawPricing): Pricing {
  const models: Record<string, ModelPrice> = {};
  for (const [model, row] of Object.entries(raw.models ?? {})) {
    models[model] = {
      vendor: String(row.vendor ?? ""),
      input: Number(row.input ?? 0),
      cached_input: Number(row.cached_input ?? 0),
      output: Number(row.output ?? 0),
      ...(row.cache_write == null ? {} : { cache_write: Number(row.cache_write) }),
      ...(row.category == null ? {} : { category: String(row.category) }),
      ...(row.long_context_threshold == null ? {} : { long_context_threshold: Number(row.long_context_threshold) }),
      ...(row.long_context_input == null ? {} : { long_context_input: Number(row.long_context_input) }),
      ...(row.long_context_cached_input == null ? {} : { long_context_cached_input: Number(row.long_context_cached_input) }),
      ...(row.long_context_output == null ? {} : { long_context_output: Number(row.long_context_output) }),
      ...(row.long_context_cache_write == null ? {} : { long_context_cache_write: Number(row.long_context_cache_write) }),
    };
  }
  return {
    schema_version: Number(raw.schema_version ?? 0),
    fetched_at: String(raw.fetched_at ?? ""),
    models,
  };
}

export function clearPricingCache(): void {
  pricingCache.clear();
}

export function loadPricing(pricingPath?: string): Pricing {
  const requested = pricingPath ?? process.env.COPILOT_COST_PRICING ?? CACHE_PRICING;
  const chosen = existsSync(requested) ? requested : SNAPSHOT;
  const resolved = path.resolve(chosen);
  const { mtimeMs, size } = statSync(resolved);
  const cached = pricingCache.get(resolved);
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) {
    return cached.pricing;
  }

  const text = readFileSync(resolved, "utf-8");
  const pricing = path.extname(resolved).toLowerCase() === ".json"
    ? coercePricing(JSON.parse(text) as RawPricing)
    : coercePricing(parseYaml(text));
  pricingCache.set(resolved, { mtimeMs, size, pricing });
  return pricing;
}

export function getModelPrice(
  modelId: string | undefined | null,
  pricingPath?: string,
): { model: string | null; price: ModelPrice | null } {
  const model = normalizeModel(modelId);
  if (!model) return { model: null, price: null };
  const pricing = loadPricing(pricingPath);
  const exact = pricing.models[model];
  if (exact) return { model, price: exact };
  const fallbackModel = model.endsWith("-fast") ? model.slice(0, -"-fast".length) : model;
  return { model: fallbackModel, price: pricing.models[fallbackModel] ?? null };
}

export function computeCost(
  tokens: { input: number; cache_read: number; cache_write: number; output: number },
  price: ModelPrice,
): number {
  const totalInput = Math.trunc(tokens.input || 0);
  const cacheRead = Math.trunc(tokens.cache_read || 0);
  const cacheWrite = Math.trunc(tokens.cache_write || 0);
  const output = Math.trunc(tokens.output || 0);
  const fresh = Math.max(totalInput - cacheRead - cacheWrite, 0);
  const longContext = price.long_context_threshold != null && totalInput > price.long_context_threshold;
  const inputPrice = longContext ? price.long_context_input ?? price.input : price.input;
  const cachedInputPrice = longContext ? price.long_context_cached_input ?? price.cached_input : price.cached_input;
  const cacheWritePrice = longContext
    ? price.long_context_cache_write ?? price.cache_write ?? inputPrice
    : price.cache_write ?? inputPrice;
  const outputPrice = longContext ? price.long_context_output ?? price.output : price.output;
  return (
    (fresh / 1_000_000) * Number(inputPrice || 0) +
    (cacheRead / 1_000_000) * Number(cachedInputPrice || 0) +
    (cacheWrite / 1_000_000) * Number(cacheWritePrice || 0) +
    (output / 1_000_000) * Number(outputPrice || 0)
  );
}

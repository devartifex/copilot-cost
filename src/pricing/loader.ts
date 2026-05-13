import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

export interface ModelPrice {
  vendor: string;
  input: number;
  cached_input: number;
  output: number;
  cache_write?: number;
}

export interface Pricing {
  schema_version: number;
  fetched_at: string;
  models: Record<string, ModelPrice>;
}

type YamlScalar = string | number | boolean | null;
type RawPricing = Record<string, unknown> & { models?: Record<string, Record<string, unknown>> };

const numRe = /^-?\d+(?:\.\d+)?$/;
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

export function normalizeModel(modelId: string | undefined | null): string | null {
  if (!modelId) return null;
  let model = String(modelId).trim();
  for (const suffix of ["-1m-internal", "-fast"]) {
    if (model.endsWith(suffix)) {
      model = model.slice(0, -suffix.length);
    }
  }
  return model;
}

function scalar(value: string): YamlScalar {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (["null", "Null", "NULL", "~"].includes(trimmed)) return null;
  if (["true", "True"].includes(trimmed)) return true;
  if (["false", "False"].includes(trimmed)) return false;
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (numRe.test(trimmed)) {
    return trimmed.includes(".") ? Number.parseFloat(trimmed) : Number.parseInt(trimmed, 10);
  }
  return trimmed;
}

function parseYaml(text: string): RawPricing {
  const data: RawPricing = {};
  const models: Record<string, Record<string, unknown>> = {};
  let currentModel: string | null = null;
  let inModels = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split("#", 1)[0]?.trimEnd() ?? "";
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
      if (key) data[key] = scalar(rest.join(":"));
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
      if (key) models[currentModel]![key] = scalar(rest.join(":"));
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
    };
  }
  return {
    schema_version: Number(raw.schema_version ?? 0),
    fetched_at: String(raw.fetched_at ?? ""),
    models,
  };
}

export function loadPricing(pricingPath?: string): Pricing {
  let chosen = pricingPath ?? process.env.COPILOT_COST_PRICING ?? CACHE_PRICING;
  if (!existsSync(chosen)) chosen = SNAPSHOT;
  const text = readFileSync(chosen, "utf-8");
  if (path.extname(chosen).toLowerCase() === ".json") {
    return coercePricing(JSON.parse(text) as RawPricing);
  }
  return coercePricing(parseYaml(text));
}

export function getModelPrice(
  modelId: string | undefined | null,
  pricingPath?: string,
): { model: string | null; price: ModelPrice | null } {
  const model = normalizeModel(modelId);
  if (!model) return { model: null, price: null };
  const row = loadPricing(pricingPath).models[model] ?? null;
  return { model, price: row };
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
  return (
    (fresh / 1_000_000) * Number(price.input || 0) +
    (cacheRead / 1_000_000) * Number(price.cached_input || 0) +
    (cacheWrite / 1_000_000) * Number(price.cache_write ?? price.input ?? 0) +
    (output / 1_000_000) * Number(price.output || 0)
  );
}

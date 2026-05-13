import process from "node:process";
import { computeCost, getModelPrice, normalizeModel } from "./pricing/loader.js";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function intValue(source: JsonObject, key: string): number {
  const value = source[key];
  return Math.trunc(Number(value || 0));
}

function short(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function renderPayload(payload: unknown, opts: { persist?: boolean } = {}): string {
  void opts.persist;
  const root = asObject(payload);
  const modelInfo = asObject(root.model);
  const rawModel = typeof modelInfo.id === "string" ? modelInfo.id : modelInfo.id == null ? undefined : String(modelInfo.id);
  const cw = asObject(root.context_window);
  const totalInput = intValue(cw, "total_input_tokens");
  const output = intValue(cw, "total_output_tokens");
  const cacheRead = intValue(cw, "total_cache_read_tokens");
  const cacheWrite = intValue(cw, "total_cache_write_tokens");

  if (!rawModel && totalInput === 0 && output === 0) {
    return "$0.00";
  }

  const { model, price } = getModelPrice(rawModel);
  if (!price) {
    const shown = normalizeModel(rawModel) ?? "unknown";
    return `$? (${shown})`;
  }

  const usd = computeCost({ input: totalInput, cache_read: cacheRead, cache_write: cacheWrite, output }, price);
  const fmt = process.env.COPILOT_COST_FORMAT ?? "standard";
  const reasoning = intValue(cw, "total_reasoning_tokens");
  const fresh = Math.max(totalInput - cacheRead - cacheWrite, 0);

  let body: string;
  if (fmt === "compact" || fmt === "minimal") {
    body = `$${usd.toFixed(4)}`;
  } else if (fmt === "full" || fmt === "verbose") {
    const credits = usd * 100;
    const parts = [
      `$${usd.toFixed(4)} (${credits.toFixed(2)} cr)`,
      `${short(fresh)} fresh / ${short(cacheRead)} cache↻ / ${short(cacheWrite)} cache✎ / ${short(output)} out`,
      `Σ ${short(totalInput + output)}`,
    ];
    if (reasoning) parts.push(`${short(reasoning)} reason`);
    body = parts.join(" · ");
  } else {
    const parts = [`$${usd.toFixed(4)}`, `${short(fresh)} in / ${short(output)} out`];
    if (cacheRead || cacheWrite) parts.push(`${short(cacheRead + cacheWrite)} cache`);
    body = parts.join(" · ");
  }

  if (process.env.COPILOT_COST_NO_EMOJI) {
    // Python currently emits no emoji in successful renders; this env remains a no-op for parity.
  }

  if (process.env.COPILOT_COST_NO_COLOR || process.env.NO_COLOR) {
    return body;
  }
  const color = process.env.COPILOT_COST_COLOR ?? "90";
  return `\u001b[${color}m${body}\u001b[0m`;
}

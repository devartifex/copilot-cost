import { createHash } from "node:crypto";
import { computeCost, getModelPrice, normalizeModel } from "../pricing/loader.js";

export interface NormalizedCall {
  dedup_key: string;
  session_id: string | null;
  conversation_id?: string | null;
  session_name?: string | null;
  cwd?: string | null;
  ts: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read: number;
  cache_creation: number;
  reasoning: number;
  usd_cost: number;
  duration_ms: number;
  source: "cli-span" | "chat-logrecord" | "unknown";
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function attrValue(value: unknown): unknown {
  if (!isObject(value)) return value;
  if ("stringValue" in value) return value.stringValue;
  if ("intValue" in value) return value.intValue;
  if ("doubleValue" in value) return value.doubleValue;
  if ("boolValue" in value) return value.boolValue;
  if ("value" in value) return attrValue(value.value);
  const first = Object.values(value)[0];
  return first === undefined ? value : attrValue(first);
}

function attrs(record: JsonObject): JsonObject {
  const direct = record.attributes;
  if (Array.isArray(direct)) {
    const out: JsonObject = {};
    for (const item of direct) {
      if (isObject(item) && typeof item.key === "string") out[item.key] = attrValue(item.value);
    }
    return out;
  }
  if (isObject(direct)) return direct;

  const resource = isObject(record.resource) ? record.resource : undefined;
  const resourceAttrs = resource?.attributes;
  return isObject(resourceAttrs) ? resourceAttrs : {};
}

function num(...values: unknown[]): number {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      const n = Number(attrValue(value));
      if (Number.isFinite(n)) return Math.max(Math.trunc(n), 0);
    }
  }
  return 0;
}

function str(value: unknown): string | null {
  const unwrapped = attrValue(value);
  if (unwrapped === undefined || unwrapped === null || unwrapped === "") return null;
  return String(unwrapped);
}

function timeFromTuple(value: unknown): { iso: string; ms: number } | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const sec = Number(value[0]);
  const ns = Number(value[1]);
  if (!Number.isFinite(sec) || !Number.isFinite(ns)) return null;
  const ms = sec * 1000 + Math.floor(ns / 1_000_000);
  return { iso: new Date(ms).toISOString(), ms };
}

function timeFromNano(value: unknown): { iso: string; ms: number } | null {
  if (value === undefined || value === null || value === "") return null;
  const ns = Number(value);
  if (!Number.isFinite(ns)) return null;
  const ms = Math.floor(ns / 1_000_000);
  return { iso: new Date(ms).toISOString(), ms };
}

function isoTime(value: unknown): { iso: string; ms: number } | null {
  const tuple = timeFromTuple(value);
  if (tuple) return tuple;
  const asString = str(value);
  if (!asString) return null;
  const parsed = Date.parse(asString);
  if (Number.isFinite(parsed)) return { iso: new Date(parsed).toISOString(), ms: parsed };
  return null;
}

function hashRecord(record: unknown): string {
  return createHash("sha256").update(JSON.stringify(record)).digest("hex").slice(0, 32);
}

export function isChatSpan(record: unknown): boolean {
  if (!isObject(record) || record.scopeMetrics) return false;
  const a = attrs(record);
  if (a["gen_ai.operation.name"] === "chat") return true;
  if (record.type === "span" && typeof record.name === "string" && record.name.startsWith("chat ")) return true;
  return Boolean((a["gen_ai.request.model"] ?? a["gen_ai.response.model"] ?? a.model ?? record.model) && (a["gen_ai.usage.input_tokens"] ?? a.input_tokens ?? record.input_tokens) !== undefined);
}

export function normalizeSpan(record: unknown): NormalizedCall | null {
  if (!isObject(record) || !isChatSpan(record)) return null;
  const a = attrs(record);
  const rawModel = str(a["gen_ai.request.model"] ?? a["gen_ai.response.model"] ?? a["model"] ?? record.model);
  const model = normalizeModel(rawModel) ?? rawModel;
  if (!model) return null;

  const rawInput = num(a["gen_ai.usage.input_tokens"], a.input_tokens, record.input_tokens);
  const cacheRead = num(a["gen_ai.usage.cache_read.input_tokens"], a.cache_read, record.cache_read);
  const cacheCreation = num(a["gen_ai.usage.cache_creation.input_tokens"], a["gen_ai.usage.cache_write.input_tokens"], a.cache_creation, a.cache_write, record.cache_creation, record.cache_write);
  const output = num(a["gen_ai.usage.output_tokens"], a.output_tokens, record.output_tokens);
  const reasoning = num(a["gen_ai.usage.reasoning.output_tokens"], a["gen_ai.usage.reasoning_tokens"], a.reasoning, record.reasoning);
  // OTel gen_ai.usage.input_tokens includes cache reads; keep only fresh input for downstream aggregations.
  const freshInput = Math.max(rawInput - cacheRead, 0);

  const start = timeFromTuple(record.startTime) ?? timeFromNano(record.startTimeUnixNano) ?? isoTime(record.ts) ?? isoTime(a.ts) ?? timeFromTuple(record.hrTime);
  const end = timeFromTuple(record.endTime) ?? timeFromNano(record.endTimeUnixNano);
  const ts = start?.iso ?? new Date(0).toISOString();
  const isLogRecord = Array.isArray(record.hrTime) && !record.startTime;
  const source: NormalizedCall["source"] = isLogRecord ? "chat-logrecord" : record.traceId || record.spanId || record.span_id ? "cli-span" : "unknown";
  const durationMs = isLogRecord ? 0 : end && start ? Math.max(Math.round(end.ms - start.ms), 0) : num(a["gen_ai.response.duration_ms"], a.duration_ms, record.duration_ms);

  const traceId = str(record.traceId ?? record.trace_id);
  const spanId = str(record.spanId ?? record.span_id ?? (isObject(record.context) ? record.context.span_id : undefined));
  const responseId = str(a["gen_ai.response.id"] ?? record["gen_ai.response.id"]);
  const existingDedup = str(record.dedup_key);
  const dedupKey = existingDedup ?? (traceId && spanId ? `${traceId}:${spanId}` : responseId ?? (isLogRecord ? `${model}:${JSON.stringify(record.hrTime)}` : spanId ?? hashRecord(record)));
  const { price } = getModelPrice(model);
  const usdCost = price ? computeCost({ input: freshInput + cacheRead + cacheCreation, cache_read: cacheRead, cache_write: cacheCreation, output }, price) : 0;

  return {
    dedup_key: dedupKey,
    session_id: str(a["copilot.session_id"] ?? a.session_id ?? record.session_id),
    conversation_id: str(a["gen_ai.conversation.id"]),
    session_name: str(a["copilot.session_name"] ?? a.session_name ?? record.session_name),
    cwd: str(a["copilot.cwd"] ?? a["process.cwd"] ?? a.cwd ?? record.cwd),
    ts,
    model,
    input_tokens: freshInput,
    output_tokens: output,
    cache_read: cacheRead,
    cache_creation: cacheCreation,
    reasoning,
    usd_cost: usdCost,
    duration_ms: durationMs,
    source,
  };
}

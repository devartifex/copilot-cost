import { type NormalizedCall } from "./parser.js";

export interface PeriodTotals { usd_cost: number; input_tokens: number; output_tokens: number; cache_tokens: number; premium_requests: number }
export interface Summary { lifetime: PeriodTotals; today: PeriodTotals; week: PeriodTotals; month: PeriodTotals; session_count: number; range: { from: string; to: string } }
export interface SessionRow { id: string; cwd: string | null; first_model: string | null; started_at: string; last_seen_at: string; session_name: string | null; model: string | null; usd_cost: number; total_input_tokens: number; total_output_tokens: number; total_cache_read_tokens: number; total_cache_write_tokens: number; premium_requests: number; api_duration_ms: number }
export interface SessionDetail { session_id: string; llm_calls: NormalizedCall[] }
export interface TimeseriesPoint { day: string; model: string; usd_cost: number; input_tokens: number; output_tokens: number }
export interface ModelLeaderboardRow { model: string; sessions: number; usd_cost: number; token_volume: number; cache_hit_ratio: number }

type Totals = PeriodTotals;

function zero(): Totals {
  return { usd_cost: 0, input_tokens: 0, output_tokens: 0, cache_tokens: 0, premium_requests: 0 };
}

function add(total: Totals, call: NormalizedCall): void {
  total.usd_cost += call.usd_cost;
  total.input_tokens += call.input_tokens;
  total.output_tokens += call.output_tokens;
  total.cache_tokens += call.cache_read + call.cache_creation;
  // OTel has no premium-request counter; use one distinct normalized call as the proxy.
  total.premium_requests += 1;
}

function utcStart(date: Date, kind: "day" | "week" | "month"): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (kind === "month") return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  if (kind === "week") {
    const day = d.getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    d.setUTCDate(d.getUTCDate() - diff);
  }
  return d;
}

function day(ts: string): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function summary(calls: NormalizedCall[], now = new Date()): Summary {
  const lifetime = zero();
  const today = zero();
  const week = zero();
  const month = zero();
  const todayStart = utcStart(now, "day").getTime();
  const weekStart = utcStart(now, "week").getTime();
  const monthStart = utcStart(now, "month").getTime();
  const sessionsSeen = new Set<string>();
  let from: string | null = null;
  let to: string | null = null;

  for (const call of calls) {
    add(lifetime, call);
    if (call.session_id) sessionsSeen.add(call.session_id);
    if (!from || call.ts < from) from = call.ts;
    if (!to || call.ts > to) to = call.ts;
    const t = Date.parse(call.ts);
    if (t >= todayStart) add(today, call);
    if (t >= weekStart) add(week, call);
    if (t >= monthStart) add(month, call);
  }

  return { lifetime, today, week, month, session_count: sessionsSeen.size, range: { from: from ?? "", to: to ?? "" } };
}

export function sessions(calls: NormalizedCall[]): SessionRow[] {
  const bySession = new Map<string, SessionRow>();
  for (const call of calls) {
    const id = call.session_id ?? "unknown";
    let row = bySession.get(id);
    if (!row) {
      row = { id, cwd: call.cwd ?? null, first_model: call.model, started_at: call.ts, last_seen_at: call.ts, session_name: call.session_name ?? null, model: call.model, usd_cost: 0, total_input_tokens: 0, total_output_tokens: 0, total_cache_read_tokens: 0, total_cache_write_tokens: 0, premium_requests: 0, api_duration_ms: 0 };
      bySession.set(id, row);
    }
    if (call.ts < row.started_at) {
      row.started_at = call.ts;
      row.first_model = call.model;
    }
    if (call.ts >= row.last_seen_at) {
      row.last_seen_at = call.ts;
      row.model = call.model;
    }
    row.usd_cost += call.usd_cost;
    row.total_input_tokens += call.input_tokens;
    row.total_output_tokens += call.output_tokens;
    row.total_cache_read_tokens += call.cache_read;
    row.total_cache_write_tokens += call.cache_creation;
    row.premium_requests += 1;
    row.api_duration_ms += call.duration_ms;
  }
  return [...bySession.values()].sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at));
}

export function sessionDetail(calls: NormalizedCall[], sessionId: string): SessionDetail {
  const scoped = calls.filter((call) => (call.session_id ?? "unknown") === sessionId);
  return {
    session_id: sessionId,
    llm_calls: scoped,
  };
}

export function timeseries(calls: NormalizedCall[], rangeName: string): TimeseriesPoint[] {
  const now = new Date();
  const days = rangeName === "7d" ? 7 : rangeName === "30d" ? 30 : rangeName === "90d" ? 90 : null;
  const cutoff = days === null ? null : Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1));
  const rows = new Map<string, TimeseriesPoint>();
  for (const call of calls) {
    if (cutoff !== null && Date.parse(call.ts) < cutoff) continue;
    const key = `${day(call.ts)}\u0000${call.model}`;
    const row = rows.get(key) ?? { day: day(call.ts), model: call.model, usd_cost: 0, input_tokens: 0, output_tokens: 0 };
    row.usd_cost += call.usd_cost;
    row.input_tokens += call.input_tokens;
    row.output_tokens += call.output_tokens;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.day.localeCompare(b.day) || a.model.localeCompare(b.model));
}

export function models(calls: NormalizedCall[]): ModelLeaderboardRow[] {
  const stats = new Map<string, { sessions: Set<string>; usd_cost: number; token_volume: number; fresh: number; read: number; write: number }>();
  for (const call of calls) {
    const row = stats.get(call.model) ?? { sessions: new Set<string>(), usd_cost: 0, token_volume: 0, fresh: 0, read: 0, write: 0 };
    if (call.session_id) row.sessions.add(call.session_id);
    row.usd_cost += call.usd_cost;
    row.token_volume += call.input_tokens + call.output_tokens + call.cache_read + call.cache_creation;
    row.fresh += call.input_tokens;
    row.read += call.cache_read;
    row.write += call.cache_creation;
    stats.set(call.model, row);
  }
  return [...stats.entries()].map(([model, row]) => ({ model, sessions: row.sessions.size, usd_cost: row.usd_cost, token_volume: row.token_volume, cache_hit_ratio: clamp01(row.read / (row.fresh + row.read + row.write || 1)) })).sort((a, b) => b.usd_cost - a.usd_cost || a.model.localeCompare(b.model));
}

function csvValue(value: unknown): string {
  const s = String(value ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function exportCsv(calls: NormalizedCall[]): string {
  const headers = ["dedup_key", "session_id", "ts", "model", "input_tokens", "output_tokens", "cache_read", "cache_creation", "reasoning", "usd_cost", "duration_ms", "source"];
  const lines = [headers.join(",")];
  for (const call of calls) lines.push(headers.map((h) => csvValue((call as any)[h])).join(","));
  return `${lines.join("\n")}\n`;
}

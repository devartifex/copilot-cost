import { readFileSync, statSync } from "node:fs";
import { resolveOtelFiles } from "./paths.js";
import { type NormalizedCall, normalizeSpan } from "./parser.js";
import { readSessionMeta, type SessionMetaEntry } from "../util/session-meta.js";

export interface ReadOptions { since?: Date; until?: Date }

interface CacheEntry {
  mtimeMs: number;
  size: number;
  calls: NormalizedCall[];
}

const cache = new Map<string, CacheEntry>();

export function clearCache(): void {
  cache.clear();
}

function parseFile(file: string): NormalizedCall[] {
  const st = statSync(file);
  const cached = cache.get(file);
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) return cached.calls;

  const seen = new Set<string>();
  const calls: NormalizedCall[] = [];
  for (const line of readFileSync(file, "utf-8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const call = normalizeSpan(JSON.parse(line) as unknown);
      if (call && !seen.has(call.dedup_key)) {
        seen.add(call.dedup_key);
        calls.push(call);
      }
    } catch {
      // Ignore malformed exporter lines; future reads will retry if file metadata changes.
    }
  }
  cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, calls });
  return calls;
}

// Render is invoked by the statusline both at chat open and after each turn,
// so a sidecar entry may sit just before or after a chat span. Use a generous
// symmetric window to tolerate either ordering and clock skew.
const META_WINDOW_MS = 30 * 60 * 1000;

function findMeta(meta: SessionMetaEntry[], call: NormalizedCall): SessionMetaEntry | null {
  if (!meta.length) return null;
  const callTime = Date.parse(call.ts);
  if (!Number.isFinite(callTime)) return null;
  let best: SessionMetaEntry | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const entry of meta) {
    const t = Date.parse(entry.ts);
    if (!Number.isFinite(t)) continue;
    const delta = Math.abs(t - callTime);
    if (delta > META_WINDOW_MS) continue;
    if (entry.model && entry.model !== call.model) continue;
    if (delta < bestDelta) { bestDelta = delta; best = entry; }
  }
  if (best) return best;
  for (const entry of meta) {
    const t = Date.parse(entry.ts);
    if (!Number.isFinite(t)) continue;
    const delta = Math.abs(t - callTime);
    if (delta > META_WINDOW_MS) continue;
    if (delta < bestDelta) { bestDelta = delta; best = entry; }
  }
  return best;
}

function enrich(calls: NormalizedCall[]): NormalizedCall[] {
  const meta = readSessionMeta();
  return calls.map((call) => {
    const match = meta.length ? findMeta(meta, call) : null;
    const sessionId = call.session_id ?? match?.session_id ?? call.conversation_id ?? null;
    const sessionName = call.session_name ?? match?.session_name ?? null;
    const cwd = call.cwd ?? match?.cwd ?? null;
    if (sessionId === call.session_id && sessionName === (call.session_name ?? null) && cwd === (call.cwd ?? null)) return call;
    return { ...call, session_id: sessionId, session_name: sessionName, cwd };
  });
}

export function readAllCalls(opts: ReadOptions = {}): NormalizedCall[] {
  const seen = new Set<string>();
  const out: NormalizedCall[] = [];
  const since = opts.since?.getTime();
  const until = opts.until?.getTime();

  for (const file of resolveOtelFiles()) {
    for (const call of parseFile(file)) {
      if (seen.has(call.dedup_key)) continue;
      const t = Date.parse(call.ts);
      if (since !== undefined && t < since) continue;
      if (until !== undefined && t > until) continue;
      seen.add(call.dedup_key);
      out.push(call);
    }
  }
  const enriched = enrich(out);
  return enriched.sort((a, b) => a.ts.localeCompare(b.ts));
}

import { readFileSync, statSync } from "node:fs";
import { resolveOtelFiles } from "./paths.js";
import { type NormalizedCall, normalizeSpan } from "./parser.js";

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
  return out.sort((a, b) => a.ts.localeCompare(b.ts));
}

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

export interface SessionMetaEntry {
  ts: string;
  session_id: string;
  session_name: string | null;
  cwd: string | null;
  model: string | null;
}

const META_FILENAME = "copilot-cost-meta.jsonl";

function metaDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.COPILOT_OTEL_DIR) return path.resolve(env.COPILOT_OTEL_DIR);
  if (env.COPILOT_OTEL_FILE_EXPORTER_PATH) return path.dirname(path.resolve(env.COPILOT_OTEL_FILE_EXPORTER_PATH));
  return path.join(env.HOME || homedir(), ".copilot", "otel");
}

export function metaFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(metaDir(env), META_FILENAME);
}

export function appendSessionMeta(entry: SessionMetaEntry, env: NodeJS.ProcessEnv = process.env): void {
  if (!entry.session_id) return;
  try {
    const target = metaFilePath(env);
    mkdirSync(path.dirname(target), { recursive: true });
    appendFileSync(target, `${JSON.stringify(entry)}\n`, "utf-8");
  } catch {
    // Best-effort sidecar; statusline must never fail.
  }
}

interface MetaCache {
  mtimeMs: number;
  size: number;
  entries: SessionMetaEntry[];
}

const cache = new Map<string, MetaCache>();

export function clearSessionMetaCache(): void {
  cache.clear();
}

export function readSessionMeta(env: NodeJS.ProcessEnv = process.env): SessionMetaEntry[] {
  const target = metaFilePath(env);
  if (!existsSync(target)) return [];
  const st = statSync(target);
  const cached = cache.get(target);
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) return cached.entries;

  const entries: SessionMetaEntry[] = [];
  for (const line of readFileSync(target, "utf-8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Partial<SessionMetaEntry>;
      if (typeof parsed.ts !== "string" || typeof parsed.session_id !== "string") continue;
      entries.push({
        ts: parsed.ts,
        session_id: parsed.session_id,
        session_name: typeof parsed.session_name === "string" ? parsed.session_name : null,
        cwd: typeof parsed.cwd === "string" ? parsed.cwd : null,
        model: typeof parsed.model === "string" ? parsed.model : null,
      });
    } catch {
      // Skip malformed sidecar lines.
    }
  }
  entries.sort((a, b) => a.ts.localeCompare(b.ts));
  cache.set(target, { mtimeMs: st.mtimeMs, size: st.size, entries });
  return entries;
}

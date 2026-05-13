import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const OTEL_DIR = path.join(homedir(), ".copilot", "otel");
export const LEGACY_JSONL = path.join(OTEL_DIR, "legacy-snapshots.jsonl");

function configuredOtelDir(env: NodeJS.ProcessEnv): string {
  return env.COPILOT_OTEL_DIR ? path.resolve(env.COPILOT_OTEL_DIR) : OTEL_DIR;
}

export function resolveOtelFiles(env: NodeJS.ProcessEnv = process.env): string[] {
  const found = new Set<string>();
  const otelDir = configuredOtelDir(env);

  if (existsSync(otelDir) && statSync(otelDir).isDirectory()) {
    for (const entry of readdirSync(otelDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        found.add(path.join(otelDir, entry.name));
      }
    }
  }

  const exporterPath = env.COPILOT_OTEL_FILE_EXPORTER_PATH;
  if (exporterPath) {
    const resolved = path.resolve(exporterPath);
    if (existsSync(resolved)) found.add(resolved);
  }

  return [...found].sort();
}

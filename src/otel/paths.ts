import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const OTEL_DIR = path.join(homedir(), ".copilot", "otel");

export function resolveOtelDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.COPILOT_OTEL_DIR) return path.resolve(env.COPILOT_OTEL_DIR);
  if (env.COPILOT_OTEL_FILE_EXPORTER_PATH) return path.dirname(path.resolve(env.COPILOT_OTEL_FILE_EXPORTER_PATH));
  return path.join(env.HOME || homedir(), ".copilot", "otel");
}

export function resolveOtelFiles(env: NodeJS.ProcessEnv = process.env): string[] {
  const found = new Set<string>();
  const otelDir = resolveOtelDir(env);

  if (existsSync(otelDir) && statSync(otelDir).isDirectory()) {
    for (const entry of readdirSync(otelDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".jsonl") && entry.name !== "copilot-cost-meta.jsonl") {
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

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

/**
 * Resolve the package root directory by walking up from the calling module
 * until a `package.json` is found. Robust to both the unbundled
 * (src/foo/bar.ts via tsx) and bundled (dist/cli.js) layouts.
 */
export function packageRoot(metaUrl: string): string {
  let dir = path.dirname(fileURLToPath(metaUrl));
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tailwind = require.resolve("tailwindcss/lib/cli.js");

const result = spawnSync(process.execPath, [
  tailwind,
  "-i",
  "dashboard-ui/styles.src.css",
  "-o",
  "dashboard-ui/dist/styles.css",
  "--minify",
], {
  cwd: root,
  env: { ...process.env, BROWSERSLIST_IGNORE_OLD_DATA: "1" },
  stdio: "inherit",
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

await import("./copy-ui.mjs");

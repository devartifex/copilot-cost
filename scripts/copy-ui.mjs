#!/usr/bin/env node
import { copyFileSync, cpSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const src = resolve(root, "dashboard-ui");
const out = resolve(root, "dashboard-ui", "dist");

mkdirSync(out, { recursive: true });
for (const f of ["index.html", "app.js"]) {
  cpSync(resolve(src, f), resolve(out, f));
}
copyFileSync(resolve(root, "node_modules", "chart.js", "dist", "chart.umd.js"), resolve(out, "chart.umd.js"));
console.log("dashboard-ui assets copied to", out);

#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = path.join(root, "docs");
const demoDir = path.join(docsDir, "demo-otel");
const fixturePath = path.join(demoDir, "synthetic-usage.jsonl");
const statuslinePath = path.join(docsDir, "statusline-preview.txt");
const statuslineSvgPath = path.join(docsDir, "statusline-styles.svg");
const port = Number(process.env.DEMO_DASHBOARD_PORT || 4765);
const host = "127.0.0.1";
const urlBase = `http://${host}:${port}/`;

function isoDaysAgo(days, hour, minute) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(hour, minute, 0, 0);
  return date.toISOString();
}

function syntheticSpans() {
  const sessions = [
    { id: "demo-session-planning", name: "Plan release tasks", cwd: "/demo/workspace/app-one" },
    { id: "demo-session-dashboard", name: "Build analytics dashboard", cwd: "/demo/workspace/app-two" },
    { id: "demo-session-tests", name: "Investigate test failures", cwd: "/demo/workspace/app-three" },
    { id: "demo-session-pricing", name: "Refresh pricing snapshot", cwd: "/demo/workspace/tooling" },
  ];
  const models = ["claude-sonnet-4.5", "gpt-5.2-codex", "claude-haiku-4.5", "gpt-5.4-mini"];
  const rows = [];
  for (let day = 20; day >= 0; day -= 1) {
    for (let index = 0; index < sessions.length; index += 1) {
      const session = sessions[index];
      const model = models[(day + index) % models.length];
      const fresh = 5200 + day * 180 + index * 900;
      const cacheRead = 1600 + ((day + index) % 5) * 420;
      const cacheCreate = 520 + ((day * 2 + index) % 4) * 180;
      const output = 1100 + index * 380 + (day % 3) * 160;
      rows.push({
        span_id: `demo-span-${day}-${index}`,
        trace_id: `demo-trace-${day}-${index}`,
        ts: isoDaysAgo(day, 14 + index, 5 + index * 7),
        attributes: {
          "gen_ai.operation.name": "chat",
          "gen_ai.request.model": model,
          "gen_ai.usage.input_tokens": fresh + cacheRead,
          "gen_ai.usage.output_tokens": output,
          "gen_ai.usage.cache_read.input_tokens": cacheRead,
          "gen_ai.usage.cache_creation.input_tokens": cacheCreate,
          "gen_ai.usage.reasoning.output_tokens": index % 2 === 0 ? 240 + day * 5 : 0,
          "gen_ai.response.duration_ms": 2600 + day * 90 + index * 430,
          "copilot.session_id": session.id,
          "copilot.session_name": session.name,
          "copilot.cwd": session.cwd,
        },
      });
    }
  }
  return rows;
}

function writeFixture() {
  mkdirSync(demoDir, { recursive: true });
  const lines = syntheticSpans().map((span) => JSON.stringify(span));
  writeFileSync(fixturePath, `${lines.join("\n")}\n`);
  writeFileSync(statuslinePath, [
    "standard: $0.2934 · 23.1k in / 6.1k out · 15.1k cache",
    "compact:  $0.2934",
    "full:     $0.2934 (29.34 cr) · 23.1k fresh / 12.0k cache↻ / 3.1k cache✎ / 6.1k out · Σ 44.3k · 900 reason",
    "",
  ].join("\n"));
  writeFileSync(statuslineSvgPath, `<svg xmlns="http://www.w3.org/2000/svg" width="1480" height="300" viewBox="0 0 1480 300" role="img" aria-labelledby="title desc">
  <title id="title">copilot-cost statusline style previews</title>
  <desc id="desc">Terminal-style preview showing standard, compact, and full copilot-cost statusline formats.</desc>
  <rect width="1120" height="300" rx="18" fill="#0d1117"/>
  <rect x="0" y="0" width="1120" height="42" rx="18" fill="#161b22"/>
  <circle cx="26" cy="21" r="6" fill="#ff5f56"/>
  <circle cx="48" cy="21" r="6" fill="#ffbd2e"/>
  <circle cx="70" cy="21" r="6" fill="#27c93f"/>
  <text x="96" y="27" fill="#8b949e" font-family="SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace" font-size="14">GitHub Copilot CLI statusline</text>
  <g font-family="SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace" font-size="22">
    <text x="38" y="92" fill="#7d8590">standard</text>
    <text x="180" y="92" fill="#e6edf3">$0.2934 · 23.1k in / 6.1k out · 15.1k cache</text>
    <text x="38" y="158" fill="#7d8590">compact</text>
    <text x="180" y="158" fill="#e6edf3">$0.2934</text>
    <text x="38" y="224" fill="#7d8590">full</text>
    <text x="180" y="224" fill="#e6edf3">$0.2934 (29.34 cr) · 23.1k fresh / 12.0k cache↻ / 3.1k cache✎ / 6.1k out · Σ 44.3k · 900 reason</text>
  </g>
</svg>
`);
}

function request(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${urlBase}${pathname}`, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode || 0, body }));
    });
    req.on("error", reject);
    req.setTimeout(1000, () => {
      req.destroy(new Error("request timed out"));
    });
  });
}

async function waitForServer() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const res = await request("api/summary");
      if (res.status === 200) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("dashboard server did not become ready");
}

async function captureWithPlaywright(theme) {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return false;
  }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: theme });
  await page.goto(`${urlBase}?theme=${theme}&screenshot=1`, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(docsDir, `dashboard-${theme}.png`), fullPage: true });
  await browser.close();
  return true;
}

function captureWithSwift(theme) {
  if (process.platform !== "darwin") return false;
  const out = path.join(docsDir, `dashboard-${theme}.png`);
  execFileSync("swift", ["scripts/capture-webview.swift", `${urlBase}?theme=${theme}&screenshot=1`, out, "1440", "1000"], { cwd: root, stdio: "inherit" });
  return existsSync(out);
}

function captureWithSafari(theme) {
  if (process.platform !== "darwin") return false;
  const out = path.join(docsDir, `dashboard-${theme}.png`);
  const script = [
    `tell application "Safari"`,
    `activate`,
    `open location "${urlBase}?theme=${theme}&screenshot=1"`,
    `delay 2`,
    `set bounds of front window to {0, 0, 1440, 1000}`,
    `delay 1`,
    `end tell`,
  ].join("\n");
  execFileSync("osascript", ["-e", script], { stdio: "ignore" });
  execFileSync("screencapture", ["-x", "-R0,0,1440,1000", out], { stdio: "ignore" });
  return existsSync(out);
}

async function capture(theme) {
  if (await captureWithPlaywright(theme)) return;
  try {
    if (captureWithSwift(theme)) return;
  } catch (error) {
    console.warn(`Swift WebKit capture failed for ${theme}: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    if (captureWithSafari(theme)) return;
  } catch (error) {
    console.warn(`Safari screen capture failed for ${theme}: ${error instanceof Error ? error.message : String(error)}`);
  }
  throw new Error(`could not capture ${theme} screenshot: install Playwright, or run on macOS with Swift WebKit/Safari available`);
}

function verifySyntheticOnly() {
  const fixture = readFileSync(fixturePath, "utf8");
  const forbidden = ["devartifex", "/Users/", "Developer/", "github.com/", "private", "repo"];
  const found = forbidden.filter((value) => fixture.includes(value));
  if (found.length) throw new Error(`demo fixture contains non-synthetic marker(s): ${found.join(", ")}`);
}

writeFixture();
verifySyntheticOnly();
execFileSync("npm", ["run", "build", "--silent"], { cwd: root, stdio: "inherit" });

const server = spawn(process.execPath, ["dist/cli.js", "dashboard", "--no-open", "--host", host, "--port", String(port)], {
  cwd: root,
  env: {
    ...process.env,
    COPILOT_OTEL_ENABLED: "true",
    COPILOT_OTEL_DIR: demoDir,
    COPILOT_OTEL_FILE_EXPORTER_PATH: "",
  },
  stdio: ["ignore", "inherit", "inherit"],
});

try {
  await waitForServer();
  await capture("light");
  await capture("dark");
  console.log(`wrote ${path.relative(root, fixturePath)}, docs/statusline-preview.txt, docs/statusline-styles.svg, docs/dashboard-light.png, docs/dashboard-dark.png`);
} finally {
  server.kill("SIGTERM");
}

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
const port = Number(process.env.DEMO_DASHBOARD_PORT || 4765);
const host = "127.0.0.1";
const urlBase = `http://${host}:${port}/`;

function isoDaysAgo(days, hour, minute, second = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(hour, minute, second, 0);
  return date.toISOString();
}

// Deterministic pseudo-random helper so the fixture is stable across runs.
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function syntheticSpans() {
  const sessions = [
    { id: "demo-session-planning", name: "Plan release tasks", cwd: "/demo/workspace/app-one", intensity: 1.1 },
    { id: "demo-session-dashboard", name: "Build analytics dashboard", cwd: "/demo/workspace/app-two", intensity: 1.5 },
    { id: "demo-session-tests", name: "Investigate test failures", cwd: "/demo/workspace/app-three", intensity: 0.8 },
    { id: "demo-session-pricing", name: "Refresh pricing snapshot", cwd: "/demo/workspace/tooling", intensity: 0.6 },
    { id: "demo-session-refactor", name: "Refactor billing module", cwd: "/demo/workspace/app-two", intensity: 1.3 },
    { id: "demo-session-docs", name: "Polish public docs", cwd: "/demo/workspace/docs-site", intensity: 0.5 },
  ];
  const models = ["claude-sonnet-4.5", "gpt-5.2-codex", "claude-haiku-4.5", "gpt-5.4", "gpt-5.4-mini", "claude-sonnet-4.5"];
  const rows = [];
  const rand = rng(0xc0c0517e);

  for (let day = 29; day >= 0; day -= 1) {
    // Weekday vs weekend rhythm: lighter usage on weekends.
    const weekday = new Date(Date.now() - day * 86_400_000).getUTCDay();
    const dayWeight = weekday === 0 || weekday === 6 ? 0.35 : 1;

    for (let index = 0; index < sessions.length; index += 1) {
      const session = sessions[index];
      // Some sessions don't run every day; skip a few stochastically.
      if (rand() < 0.18) continue;

      // Each (session, day) yields several turns to mimic real chat usage.
      const turns = 3 + Math.floor(rand() * 6);
      for (let turn = 0; turn < turns; turn += 1) {
        const model = models[(day + index + turn) % models.length];
        const baseHour = 9 + ((index * 2 + turn * 3) % 11);
        const minute = Math.floor(rand() * 60);
        const second = Math.floor(rand() * 60);

        // Big context-heavy turns happen periodically; smaller ones in between.
        const heavy = turn === 0 || rand() < 0.2;
        const scale = (heavy ? 1.0 : 0.35) * session.intensity * dayWeight;

        // Numbers chosen so daily totals approximate real heavy Copilot CLI usage
        // (hundreds of thousands to a few million tokens, a few dollars per day).
        const fresh = Math.round((20_000 + rand() * 60_000) * scale);
        const cacheRead = Math.round((180_000 + rand() * 900_000) * scale);
        const cacheCreate = Math.round((8_000 + rand() * 35_000) * scale);
        const output = Math.round((2_500 + rand() * 9_500) * scale);
        const reasoning = model.startsWith("gpt-") ? Math.round(output * (0.15 + rand() * 0.25)) : 0;

        rows.push({
          span_id: `demo-span-${day}-${index}-${turn}`,
          trace_id: `demo-trace-${day}-${index}-${turn}`,
          ts: isoDaysAgo(day, baseHour, minute, second),
          attributes: {
            "gen_ai.operation.name": "chat",
            "gen_ai.request.model": model,
            "gen_ai.usage.input_tokens": fresh + cacheRead,
            "gen_ai.usage.output_tokens": output,
            "gen_ai.usage.cache_read.input_tokens": cacheRead,
            "gen_ai.usage.cache_creation.input_tokens": cacheCreate,
            "gen_ai.usage.reasoning.output_tokens": reasoning,
            "gen_ai.response.duration_ms": Math.round(1800 + rand() * 9000),
            "copilot.session_id": session.id,
            "copilot.session_name": session.name,
            "copilot.cwd": session.cwd,
          },
        });
      }
    }
  }
  return rows;
}

function writeFixture() {
  mkdirSync(demoDir, { recursive: true });
  const lines = syntheticSpans().map((span) => JSON.stringify(span));
  writeFileSync(fixturePath, `${lines.join("\n")}\n`);
  writeFileSync(statuslinePath, [
    "standard: $1.2522 · 1.5M in / 7.9k out · 1.5M cache",
    "compact:  $1.2522",
    "full:     $1.2522 (125.22 aic) · 38.4k fresh / 1.4M cache rd / 62.1k cache wr / 7.9k out · Σ 1.5M · 1.6k reason",
    "",
  ].join("\n"));
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
    ({ chromium } = await import("@playwright/test"));
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
    if (captureWithSafari(theme)) return;
  } catch (error) {
    console.warn(`Safari screen capture failed for ${theme}: ${error instanceof Error ? error.message : String(error)}`);
  }
  throw new Error(`could not capture ${theme} screenshot: install Playwright, or run on macOS with Safari available`);
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
  console.log(`wrote ${path.relative(root, fixturePath)}, docs/statusline-preview.txt, docs/dashboard-light.png, docs/dashboard-dark.png`);
} finally {
  server.kill("SIGTERM");
}

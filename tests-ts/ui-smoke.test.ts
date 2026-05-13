import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import type http from "node:http";
import path from "node:path";

const savedEnv = { ...process.env };
const { COPILOT_OTEL_ENABLED, COPILOT_OTEL_FILE_EXPORTER_PATH, COPILOT_OTEL_EXPORTER_TYPE, COPILOT_OTEL_DIR, ...envWithoutOtel } = savedEnv;
const projectRoot = path.resolve(".");
const smokeRoot = path.join(projectRoot, ".test-home", "ui-smoke");
const uiDist = path.join(projectRoot, "dashboard-ui", "dist");

let server: http.Server | null = null;
let baseUrl = "";

function tupleFrom(date: Date): [number, number] {
  return [Math.floor(date.getTime() / 1000), (date.getTime() % 1000) * 1_000_000];
}

function expectJson(res: Response): void {
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("application/json");
}

beforeAll(async () => {
  // Keep the smoke test dependency-free: build static dashboard assets once if dist is absent.
  if (!existsSync(path.join(uiDist, "index.html")) || !existsSync(path.join(uiDist, "styles.css")) || !existsSync(path.join(uiDist, "app.js"))) {
    execFileSync("npm", ["run", "build:ui"], { cwd: projectRoot, stdio: "inherit" });
  }

  rmSync(smokeRoot, { recursive: true, force: true });
  const otelDir = path.join(smokeRoot, ".copilot", "otel");
  mkdirSync(otelDir, { recursive: true });
  const jsonl = path.join(otelDir, "copilot-otel.jsonl");
  const now = new Date();
  const later = new Date(now.getTime() + 1500);
  const lines = [
    {
      type: "span",
      name: "chat claude-opus-4.7",
      traceId: "trace-ui-a",
      spanId: "span-ui-a",
      startTime: tupleFrom(now),
      endTime: tupleFrom(later),
      attributes: {
        "gen_ai.operation.name": "chat",
        "gen_ai.request.model": "claude-opus-4.7",
        "gen_ai.usage.input_tokens": 1200,
        "gen_ai.usage.cache_read.input_tokens": 200,
        "gen_ai.usage.cache_creation.input_tokens": 50,
        "gen_ai.usage.output_tokens": 150,
        "gen_ai.usage.reasoning.output_tokens": 10,
        "copilot.session_id": "ui-smoke-a",
      },
    },
    {
      hrTime: tupleFrom(new Date(now.getTime() + 2500)),
      attributes: {
        "gen_ai.operation.name": "chat",
        "gen_ai.response.id": "resp-ui-b",
        "gen_ai.response.model": "gpt-5-mini-fast",
        "gen_ai.usage.input_tokens": 500,
        "gen_ai.usage.cache_read.input_tokens": 100,
        "gen_ai.usage.output_tokens": 80,
        "copilot.session_id": "ui-smoke-b",
      },
    },
  ];
  writeFileSync(jsonl, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf-8");

  process.env = {
    ...envWithoutOtel,
    HOME: smokeRoot,
    COPILOT_OTEL_DIR: otelDir,
    COPILOT_OTEL_ENABLED: "true",
    COPILOT_OTEL_EXPORTER_TYPE: "file",
    COPILOT_OTEL_FILE_EXPORTER_PATH: jsonl,
  };
  vi.resetModules();
  const { makeServer } = await import("../src/dashboard/server.js");
  server = makeServer("127.0.0.1", 0);
  await new Promise<void>((resolve, reject) => {
    server?.once("error", reject);
    server?.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not expose an ephemeral port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;
  }
  rmSync(smokeRoot, { recursive: true, force: true });
});

describe("dashboard UI smoke", () => {
  it("serves the redesigned dashboard shell and static assets", async () => {
    const html = await fetch(`${baseUrl}/`);
    expect(html.status).toBe(200);
    expect(html.headers.get("content-type")).toContain("text/html");
    const htmlBody = await html.text();
    expect(htmlBody).toContain('<main id="page"');
    expect(htmlBody).toContain("Overview");

    const css = await fetch(`${baseUrl}/styles.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toContain("text/css");
    const cssBody = await css.text();
    expect(cssBody).toContain("--background");
    expect(cssBody).toContain("--accent");

    const js = await fetch(`${baseUrl}/app.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toMatch(/(?:application|text)\/javascript/);
    const jsBody = await js.text();
    expect(jsBody).toContain("./chart.umd.js");
    expect(jsBody).not.toContain("cdn.jsdelivr.net");

    const chart = await fetch(`${baseUrl}/chart.umd.js`);
    expect(chart.status).toBe(200);
    expect(chart.headers.get("content-type")).toMatch(/(?:application|text)\/javascript/);
    expect(await chart.text()).toContain("Chart");
  });

  it("serves non-empty dashboard API responses", async () => {
    const health = await fetch(`${baseUrl}/api/health`);
    expectJson(health);
    expect(await health.json()).toMatchObject({ ok: true, otel_enabled: true, jsonl_files: 1 });

    const summary = await fetch(`${baseUrl}/api/summary`);
    expectJson(summary);
    const summaryBody = (await summary.json()) as { lifetime?: { premium_requests?: number }; session_count?: number };
    expect(summaryBody.lifetime?.premium_requests).toBe(2);
    expect(summaryBody.session_count).toBe(2);

    const sessions = await fetch(`${baseUrl}/api/sessions`);
    expectJson(sessions);
    const sessionsBody = (await sessions.json()) as unknown[];
    expect(sessionsBody).toHaveLength(2);

    const models = await fetch(`${baseUrl}/api/models`);
    expectJson(models);
    const modelsBody = (await models.json()) as unknown[];
    expect(modelsBody.length).toBeGreaterThan(0);

    const timeseries = await fetch(`${baseUrl}/api/timeseries?range=7d`);
    expectJson(timeseries);
    const timeseriesBody = (await timeseries.json()) as unknown[];
    expect(timeseriesBody.length).toBeGreaterThan(0);

    const pricing = await fetch(`${baseUrl}/api/pricing`);
    expectJson(pricing);
    const pricingBody = (await pricing.json()) as { models?: Record<string, unknown> };
    expect(Object.keys(pricingBody.models ?? {}).length).toBeGreaterThan(0);

    const csv = await fetch(`${baseUrl}/api/export.csv`);
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    const csvBody = await csv.text();
    expect(csvBody).toContain("dedup_key,session_id,ts,model");
    expect(csvBody).toContain("ui-smoke-a");
    expect(csvBody).toContain("ui-smoke-b");
  });
});

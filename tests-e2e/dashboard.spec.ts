import { expect, test } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const testHome = path.resolve(".test-home/e2e");
const otelDir = path.join(testHome, ".copilot", "otel");
const jsonlPath = path.join(otelDir, "copilot-otel.jsonl");

function tupleFrom(date: Date): [number, number] {
  return [Math.floor(date.getTime() / 1000), (date.getTime() % 1000) * 1_000_000];
}

function writeOtelFixture(): void {
  rmSync(testHome, { recursive: true, force: true });
  mkdirSync(otelDir, { recursive: true });
  const now = new Date();
  const lines = [
    {
      type: "span",
      name: "chat claude-opus-4.7",
      traceId: "trace-e2e-a",
      spanId: "span-e2e-a",
      startTime: tupleFrom(now),
      endTime: tupleFrom(new Date(now.getTime() + 1200)),
      attributes: {
        "gen_ai.operation.name": "chat",
        "gen_ai.request.model": "claude-opus-4.7",
        "gen_ai.usage.input_tokens": 1200,
        "gen_ai.usage.cache_read.input_tokens": 200,
        "gen_ai.usage.cache_creation.input_tokens": 50,
        "gen_ai.usage.output_tokens": 150,
        "copilot.session_id": "e2e-session-build",
        "copilot.session_name": "Build dashboard e2e",
        "copilot.cwd": "/tmp/copilot-cost-e2e",
      },
    },
    {
      type: "span",
      name: "chat gpt-5-mini",
      traceId: "trace-e2e-b",
      spanId: "span-e2e-b",
      startTime: tupleFrom(new Date(now.getTime() - 86_400_000)),
      endTime: tupleFrom(new Date(now.getTime() - 86_398_500)),
      attributes: {
        "gen_ai.operation.name": "chat",
        "gen_ai.request.model": "gpt-5-mini",
        "gen_ai.usage.input_tokens": 700,
        "gen_ai.usage.cache_read.input_tokens": 100,
        "gen_ai.usage.output_tokens": 90,
        "copilot.session_id": "e2e-session-test",
        "copilot.session_name": "Verify E2E test",
        "copilot.cwd": "/tmp/copilot-cost-e2e",
      },
    },
  ];
  writeFileSync(jsonlPath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf-8");
}

test.beforeEach(() => {
  writeOtelFixture();
});

test.afterAll(() => {
  rmSync(testHome, { recursive: true, force: true });
});

test("renders live dashboard data and supports session drilldown", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent sessions" })).toBeVisible();
  await expect(page.getByText("Build dashboard e2e")).toBeVisible();
  await expect(page.getByText("Verify E2E test")).toBeVisible();
  await expect(page.getByText("Claude opus 4.7").first()).toBeVisible();
  await expect(page.locator("canvas#spend-chart, svg[aria-label='Stacked bar chart of spend by model']")).toBeVisible();

  await page.getByRole("link", { name: "Sessions" }).click();
  await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();
  await page.getByPlaceholder("Name, path, or model").fill("verify");
  await expect(page.getByText("Verify E2E test")).toBeVisible();
  await expect(page.getByText("Build dashboard e2e")).toHaveCount(0);

  await page.getByText("Verify E2E test").click();
  await expect(page.getByRole("dialog")).toContainText("e2e-session-test");
});

import { defineConfig } from "@playwright/test";

const port = 4773;
const testHome = ".test-home/e2e";
const otelDir = `${testHome}/.copilot/otel`;
const exporterPath = `${otelDir}/copilot-otel.jsonl`;

export default defineConfig({
  testDir: "tests-e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run build --silent && node dist/cli.js dashboard --no-open --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/api/health`,
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      HOME: testHome,
      COPILOT_OTEL_ENABLED: "true",
      COPILOT_OTEL_EXPORTER_TYPE: "file",
      COPILOT_OTEL_DIR: otelDir,
      COPILOT_OTEL_FILE_EXPORTER_PATH: exporterPath,
    },
  },
});

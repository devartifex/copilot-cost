import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderPayload } from "../src/render.js";

const payload = JSON.parse(readFileSync(path.resolve("tests/fixtures/sample-payload.json"), "utf-8")) as unknown;
const savedEnv = { ...process.env };

afterEach(() => {
  process.env = { ...savedEnv };
});

describe("renderPayload", () => {
  it("renders default standard format", () => {
    process.env.COPILOT_COST_NO_COLOR = "1";
    const output = renderPayload(payload, { persist: false });
    expect(output).toContain("$");
    expect(output).toContain("23.1k in / 6.1k out");
  });

  it("renders compact format", () => {
    process.env.COPILOT_COST_NO_COLOR = "1";
    process.env.COPILOT_COST_FORMAT = "compact";
    expect(renderPayload(payload, { persist: false })).toMatch(/^\$\d+\.\d{4}$/);
  });

  it("renders verbose format", () => {
    process.env.COPILOT_COST_NO_COLOR = "1";
    process.env.COPILOT_COST_FORMAT = "verbose";
    const output = renderPayload(payload, { persist: false });
    expect(output).toContain("fresh / 12.0k cache↻ / 3.1k cache✎ / 6.1k out");
    expect(output).toContain("900 reason");
  });

  it("strips ANSI color when color is disabled", () => {
    process.env.COPILOT_COST_NO_COLOR = "1";
    const output = renderPayload(payload, { persist: false });
    expect(output).not.toMatch(/\u001b\[/);
  });
});

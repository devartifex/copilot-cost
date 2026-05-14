import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(".test-home", "doctor-tests");
const savedEnv = { ...process.env };

function withoutOtelEnv(): NodeJS.ProcessEnv {
  const env = { ...savedEnv };
  delete env.COPILOT_OTEL_ENABLED;
  delete env.COPILOT_OTEL_FILE_EXPORTER_PATH;
  delete env.COPILOT_OTEL_EXPORTER_TYPE;
  delete env.COPILOT_OTEL_DIR;
  return env;
}

async function loadInstall(homeName: string) {
  vi.resetModules();
  const home = path.join(root, homeName);
  rmSync(home, { recursive: true, force: true });
  mkdirSync(path.join(home, ".copilot", "otel"), { recursive: true });
  writeFileSync(path.join(home, ".copilot", "otel", "sample.jsonl"), "{}\n", "utf-8");
  process.env = { ...withoutOtelEnv(), HOME: home, SHELL: "/bin/zsh", COPILOT_COST_REFRESH_DAYS: "999999", COPILOT_COST_NO_COLOR: "1" };
  return import("../src/install.js");
}

afterEach(() => {
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

describe("doctor", () => {
  it("passes after install and prints checks", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg?: unknown) => { logs.push(String(msg)); });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { cmdInstall, cmdDoctor } = await loadInstall("installed");
    await cmdInstall({ yes: true });
    await expect(cmdDoctor()).resolves.toBe(0);
    expect(logs.join("\n")).toContain("OK: settings statusLine");
    expect(logs.join("\n")).toContain("OK: settings experimental");
    expect(logs.join("\n")).toContain("OK: pricing");
    expect(logs.join("\n")).toContain("OK: pricing cache");
    expect(logs.join("\n")).toContain("WARN: shell restart");
    expect(logs.join("\n")).toContain("OK: sample render");
    expect(logs.join("\n")).toContain("OK: shim executable");
    expect(logs.join("\n")).toContain("dashboard readiness");
  });

  it("fails without install", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg?: unknown) => { logs.push(String(msg)); });
    const { cmdDoctor } = await loadInstall("missing");
    await expect(cmdDoctor()).resolves.toBe(1);
    expect(logs.join("\n")).toContain("FAIL: settings statusLine");
    expect(logs.join("\n")).toContain("FAIL: settings experimental");
    expect(logs.join("\n")).toContain("FAIL: shim executable");
    expect(logs.join("\n")).toContain("missing copilot-cost block");
  });

  it("explains missing OTel output after install", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg?: unknown) => { logs.push(String(msg)); });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { cmdInstall, cmdDoctor } = await loadInstall("no-otel-files");
    await cmdInstall({ yes: true });
    rmSync(path.join(root, "no-otel-files", ".copilot", "otel"), { recursive: true, force: true });
    await expect(cmdDoctor()).resolves.toBe(0);
    expect(logs.join("\n")).toContain("WARN: otel jsonl files");
    expect(logs.join("\n")).toContain("send a Copilot CLI prompt after shell restart");
  });

  it("warns when Copilot CLI feature flag STATUS_LINE is false", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg?: unknown) => { logs.push(String(msg)); });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { cmdInstall, cmdDoctor } = await loadInstall("statusline-flag-off");
    await cmdInstall({ yes: true });
    const logsDir = path.join(root, "statusline-flag-off", ".copilot", "logs");
    mkdirSync(logsDir, { recursive: true });
    writeFileSync(path.join(logsDir, "process-1.log"), '{\n  "feature_flags": {\n    "STATUS_LINE": "false"\n  }\n}\n', "utf-8");
    await expect(cmdDoctor()).resolves.toBe(0);
    expect(logs.join("\n")).toContain("WARN: copilot statusline feature");
    expect(logs.join("\n")).toContain("STATUS_LINE=false");
  });

  it("reports OK when Copilot CLI feature flag STATUS_LINE is true", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg?: unknown) => { logs.push(String(msg)); });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { cmdInstall, cmdDoctor } = await loadInstall("statusline-flag-on");
    await cmdInstall({ yes: true });
    const logsDir = path.join(root, "statusline-flag-on", ".copilot", "logs");
    mkdirSync(logsDir, { recursive: true });
    writeFileSync(path.join(logsDir, "process-1.log"), '{\n  "feature_flags": {\n    "STATUS_LINE": "true"\n  }\n}\n', "utf-8");
    await expect(cmdDoctor()).resolves.toBe(0);
    expect(logs.join("\n")).toContain("OK: copilot statusline feature");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(".test-home", "install-tests");
const savedEnv = { ...process.env };
const shimName = process.platform === "win32" ? "copilot-cost.cmd" : "copilot-cost";

function resetHome(name: string, overrides: NodeJS.ProcessEnv = { SHELL: "/bin/zsh" }): string {
  vi.resetModules();
  const home = path.join(root, name);
  rmSync(home, { recursive: true, force: true });
  process.env = { ...savedEnv, HOME: home, COPILOT_COST_REFRESH_DAYS: "999999", ...overrides };
  return home;
}

afterEach(() => {
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

describe("install commands", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("installs idempotently", async () => {
    const home = resetHome("install");
    const { cmdInstall } = await import("../src/install.js");
    await expect(cmdInstall({ yes: true })).resolves.toBe(0);

    const shim = path.join(home, ".copilot", "bin", shimName);
    const otelDir = path.join(home, ".copilot", "otel");
    const otelExporterPath = path.join(otelDir, "copilot-otel.jsonl");
    const settingsPath = path.join(home, ".copilot", "settings.json");
    const profilePath = path.join(home, ".zshrc");
    expect(existsSync(shim)).toBe(true);
    expect(existsSync(otelDir)).toBe(true);
    expect(existsSync(otelExporterPath)).toBe(true);
    if (process.platform !== "win32") expect(statSync(shim).mode & 0o111).not.toBe(0);
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as { statusLine: { command: string }; experimental: boolean };
    expect(settings.statusLine.command).toBe(shim);
    expect(settings.experimental).toBe(true);
    expect(readFileSync(profilePath, "utf-8")).toContain("copilot-cost OTel exporter");

    await expect(cmdInstall({ yes: true })).resolves.toBe(0);
    const profile = readFileSync(profilePath, "utf-8");
    expect(profile.match(/copilot-cost OTel exporter >>>/g)).toHaveLength(1);
    const backups = readdirSync(path.dirname(settingsPath)).filter((name) => name.startsWith("settings.json.bak."));
    expect(backups).toHaveLength(0);
    expect(path.dirname(settingsPath)).toBe(path.join(home, ".copilot"));
  });

  it("default install configures OTel without prompting and keeps dashboard explicit", async () => {
    const home = resetHome("default-otel");
    const logs: string[] = [];
    vi.mocked(console.log).mockImplementation((msg?: unknown) => { logs.push(String(msg)); });
    const { cmdInstall } = await import("../src/install.js");
    await expect(cmdInstall()).resolves.toBe(0);

    expect(readFileSync(path.join(home, ".zshrc"), "utf-8")).toContain("COPILOT_OTEL_FILE_EXPORTER_PATH");
    const output = logs.join("\n");
    expect(output).toContain("otel env: appended");
    expect(output).toContain("dashboard: run copilot-cost dashboard");
    expect(output).not.toContain("Append OTel exporter settings");
  });

  it("uses a PowerShell profile block on Windows when no POSIX shell is active", async () => {
    if (process.platform !== "win32") return;
    const home = resetHome("powershell-profile", {
      SHELL: "",
      PSModulePath: path.join(root, "powershell-profile", "Documents", "PowerShell", "Modules"),
    });
    const { cmdInstall } = await import("../src/install.js");
    await expect(cmdInstall({ yes: true })).resolves.toBe(0);

    const profilePath = path.join(home, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1");
    expect(readFileSync(profilePath, "utf-8")).toContain("$env:COPILOT_OTEL_ENABLED = 'true'");
  });

  it("uninstall reverses install", async () => {
    const home = resetHome("uninstall");
    const { cmdInstall, cmdUninstall } = await import("../src/install.js");
    await cmdInstall({ yes: true });
    await expect(cmdUninstall({ yes: true })).resolves.toBe(0);

    const shim = path.join(home, ".copilot", "bin", shimName);
    const settings = JSON.parse(readFileSync(path.join(home, ".copilot", "settings.json"), "utf-8")) as Record<string, unknown>;
    expect(existsSync(shim)).toBe(false);
    expect(settings.statusLine).toBeUndefined();
    expect(readFileSync(path.join(home, ".zshrc"), "utf-8")).not.toContain("copilot-cost OTel exporter >>>");
  });

  it("can skip shell profile edits and print manual OTel setup", async () => {
    const home = resetHome("manual-otel");
    const logs: string[] = [];
    vi.mocked(console.log).mockImplementation((msg?: unknown) => { logs.push(String(msg)); });
    const { cmdInstall } = await import("../src/install.js");
    await expect(cmdInstall({ yes: true, otelProfile: false })).resolves.toBe(0);

    const profilePath = path.join(home, ".zshrc");
    expect(existsSync(profilePath)).toBe(false);
    expect(logs.join("\n")).toContain("OTel profile edit skipped");
    expect(logs.join("\n")).toContain("# >>> copilot-cost OTel exporter >>>");
  });
});

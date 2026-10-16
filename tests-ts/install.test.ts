import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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

function profileBackups(profilePath: string): string[] {
  const dir = path.dirname(profilePath);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.startsWith(`${path.basename(profilePath)}.bak.`)).sort();
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
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as { statusLine: { command: string }; experimental?: boolean };
    expect(settings.statusLine.command).toBe(shim);
    expect(settings).not.toHaveProperty("experimental");
    expect(readFileSync(profilePath, "utf-8")).toContain("copilot-cost OTel exporter");

    await expect(cmdInstall({ yes: true })).resolves.toBe(0);
    const profile = readFileSync(profilePath, "utf-8");
    expect(profile.match(/copilot-cost OTel exporter >>>/g)).toHaveLength(1);
    const backups = readdirSync(path.dirname(settingsPath)).filter((name) => name.startsWith("settings.json.bak."));
    expect(backups).toHaveLength(0);
    expect(path.dirname(settingsPath)).toBe(path.join(home, ".copilot"));
  });

  it.each([true, false])("preserves experimental: %s through install, reinstall, and uninstall", async (experimental) => {
    const home = resetHome(`experimental-${experimental}`);
    const settingsPath = path.join(home, ".copilot", "settings.json");
    const original = { experimental, theme: "auto" };
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, `${JSON.stringify(original)}\n`, "utf-8");
    const { cmdInstall, cmdUninstall } = await import("../src/install.js");

    await expect(cmdInstall({ yes: true })).resolves.toBe(0);
    const installed = readFileSync(settingsPath, "utf-8");
    expect(JSON.parse(installed)).toMatchObject(original);
    const backups = profileBackups(settingsPath);
    expect(backups).toHaveLength(1);
    expect(JSON.parse(readFileSync(path.join(path.dirname(settingsPath), backups[0]!), "utf-8"))).toEqual(original);

    await expect(cmdInstall({ yes: true })).resolves.toBe(0);
    expect(readFileSync(settingsPath, "utf-8")).toBe(installed);
    expect(profileBackups(settingsPath)).toEqual(backups);
    expect(vi.mocked(console.log).mock.calls.flat().join("\n")).toContain("already-configured; statusLine");

    await expect(cmdUninstall({ yes: true })).resolves.toBe(0);
    expect(JSON.parse(readFileSync(settingsPath, "utf-8"))).toEqual(original);
  });

  it("backs up an existing shell profile before appending the OTel block", async () => {
    const home = resetHome("append-profile-backup");
    const profilePath = path.join(home, ".zshrc");
    const original = "# existing profile\nexport FOO=bar\n";
    mkdirSync(path.dirname(profilePath), { recursive: true });
    writeFileSync(profilePath, original, "utf-8");
    const { appendOtelExporterBlock } = await import("../src/install.js");

    expect(appendOtelExporterBlock(profilePath, "posix")).toBe("appended");
    const backups = profileBackups(profilePath);
    expect(backups).toHaveLength(1);
    expect(readFileSync(path.join(path.dirname(profilePath), backups[0]!), "utf-8")).toBe(original);

    expect(appendOtelExporterBlock(profilePath, "posix")).toBe("already-present");
    expect(profileBackups(profilePath)).toHaveLength(1);
  });

  it("backs up a shell profile before removing the OTel block", async () => {
    const home = resetHome("remove-profile-backup");
    const profilePath = path.join(home, ".zshrc");
    const { otelBlock, removeOtelExporterBlock } = await import("../src/install.js");
    const original = `before\n${otelBlock("posix")}\nafter\n`;
    mkdirSync(path.dirname(profilePath), { recursive: true });
    writeFileSync(profilePath, original, "utf-8");

    expect(removeOtelExporterBlock(profilePath)).toBe(true);
    const backups = profileBackups(profilePath);
    expect(backups).toHaveLength(1);
    expect(readFileSync(path.join(path.dirname(profilePath), backups[0]!), "utf-8")).toBe(original);

    expect(removeOtelExporterBlock(profilePath)).toBe(false);
    expect(profileBackups(profilePath)).toHaveLength(1);
  });

  it("does not create a profile backup when appending to a new profile", async () => {
    const home = resetHome("append-new-profile-no-backup");
    const profilePath = path.join(home, ".zshrc");
    const { appendOtelExporterBlock } = await import("../src/install.js");

    expect(appendOtelExporterBlock(profilePath, "posix")).toBe("appended");
    expect(existsSync(profilePath)).toBe(true);
    expect(profileBackups(profilePath)).toHaveLength(0);
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

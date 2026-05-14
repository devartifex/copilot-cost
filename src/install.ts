import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, chmodSync, copyFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { cacheIsFresh, refreshPricing } from "./pricing/fetcher.js";
import { loadPricing } from "./pricing/loader.js";
import { renderPayload } from "./render.js";
import { packageRoot } from "./util/package-root.js";

export const OTEL_BEGIN = "# >>> copilot-cost OTel exporter >>>";
export const OTEL_END = "# <<< copilot-cost OTel exporter <<<";

export interface InstallPaths {
  home: string;
  copilotDir: string;
  binDir: string;
  shimPath: string;
  settingsPath: string;
  profilePath: string;
  profileKind: "posix" | "powershell";
}

type JsonObject = Record<string, unknown>;

function currentHome(): string {
  return process.env.HOME || homedir();
}

function isWindows(): boolean {
  return process.platform === "win32";
}

function pricingCachePath(home = currentHome()): string {
  return path.join(home, ".copilot", "cost-cache", "pricing.yaml");
}

function pricingCacheDir(home = currentHome()): string {
  return path.dirname(pricingCachePath(home));
}

function otelDir(home = currentHome()): string {
  return path.join(home, ".copilot", "otel");
}

function otelExporterPath(home = currentHome()): string {
  return path.join(otelDir(home), "copilot-otel.jsonl");
}

export function ensureOtelExporterFile(home = currentHome()): string {
  const target = otelExporterPath(home);
  mkdirSync(path.dirname(target), { recursive: true });
  if (!existsSync(target)) writeFileSync(target, "", "utf-8");
  return target;
}

export function resolveInstallPaths(env: NodeJS.ProcessEnv = process.env): InstallPaths {
  const home = env.HOME || homedir();
  const copilotDir = path.join(home, ".copilot");
  const shell = path.basename(env.SHELL || "");
  const profileKind = !shell && isWindows() ? "powershell" : "posix";
  const powerShellProfileDir =
    env.PSModulePath?.split(path.delimiter)
      .map((entry) => path.normalize(entry))
      .find((entry) => path.basename(entry).toLowerCase() === "modules" && path.basename(path.dirname(entry)).toLowerCase() === "powershell");
  const profileName = shell.includes("zsh") ? ".zshrc" : shell.includes("bash") ? ".bashrc" : ".profile";
  return {
    home,
    copilotDir,
    binDir: path.join(copilotDir, "bin"),
    shimPath: path.join(copilotDir, "bin", isWindows() ? "copilot-cost.cmd" : "copilot-cost"),
    settingsPath: path.join(copilotDir, "settings.json"),
    profilePath:
      profileKind === "powershell"
        ? path.join(powerShellProfileDir ? path.dirname(powerShellProfileDir) : path.join(home, "Documents", "PowerShell"), "Microsoft.PowerShell_profile.ps1")
        : path.join(home, profileName),
    profileKind,
  };
}

function cliPathFromInstallModule(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "cli.js");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function otelBlock(profileKind: "posix" | "powershell" = resolveInstallPaths().profileKind): string {
  const lines =
    profileKind === "powershell"
      ? [
          OTEL_BEGIN,
          "$env:COPILOT_OTEL_ENABLED = 'true'",
          "$env:COPILOT_OTEL_EXPORTER_TYPE = 'file'",
          "$env:COPILOT_OTEL_FILE_EXPORTER_PATH = Join-Path $HOME '.copilot/otel/copilot-otel.jsonl'",
          OTEL_END,
        ]
      : [
          OTEL_BEGIN,
          "export COPILOT_OTEL_ENABLED=true",
          "export COPILOT_OTEL_EXPORTER_TYPE=file",
          'export COPILOT_OTEL_FILE_EXPORTER_PATH="$HOME/.copilot/otel/copilot-otel.jsonl"',
          OTEL_END,
        ];
  return lines.join("\n");
}

function readJsonObject(filePath: string): JsonObject {
  if (!existsSync(filePath)) return {};
  const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as JsonObject) : {};
}

function timestamp(): string {
  return new Date().toISOString().replace(/\D/g, "");
}

async function confirm(question: string, yes?: boolean): Promise<boolean> {
  if (yes) return true;
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

export function hasOtelBlock(profilePath: string): boolean {
  return existsSync(profilePath) && readFileSync(profilePath, "utf-8").includes(OTEL_BEGIN);
}

export function appendOtelExporterBlock(profilePath = resolveInstallPaths().profilePath, profileKind = resolveInstallPaths().profileKind): "appended" | "already-present" {
  mkdirSync(path.dirname(profilePath), { recursive: true });
  const existing = existsSync(profilePath) ? readFileSync(profilePath, "utf-8") : "";
  if (existing.includes(OTEL_BEGIN)) return "already-present";
  const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  writeFileSync(profilePath, `${existing}${prefix}${otelBlock(profileKind)}\n`, "utf-8");
  return "appended";
}

export function removeOtelExporterBlock(profilePath = resolveInstallPaths().profilePath): boolean {
  if (!existsSync(profilePath)) return false;
  const existing = readFileSync(profilePath, "utf-8");
  const pattern = new RegExp(`\\n?${OTEL_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^]*?${OTEL_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n?`, "m");
  if (!pattern.test(existing)) return false;
  writeFileSync(profilePath, existing.replace(pattern, "\n").replace(/\n{3,}/g, "\n\n"), "utf-8");
  return true;
}

function writeShim(shimPath: string): void {
  mkdirSync(path.dirname(shimPath), { recursive: true });
  const target = cliPathFromInstallModule();
  const body = isWindows() ? `@echo off\r\nnode "${target}" render %*\r\n` : `#!/bin/sh\nexec node ${shellQuote(target)} render "$@"\n`;
  writeFileSync(shimPath, body, "utf-8");
  if (!isWindows()) chmodSync(shimPath, 0o755);
}

function installSettings(settingsPath: string, shimPath: string): "updated" | "already-configured" {
  mkdirSync(path.dirname(settingsPath), { recursive: true });
  const settings = readJsonObject(settingsPath);
  const next = { type: "command", command: shimPath, padding: 1 };
  if (JSON.stringify(settings.statusLine ?? null) === JSON.stringify(next)) return "already-configured";
  if (existsSync(settingsPath)) {
    copyFileSync(settingsPath, `${settingsPath}.bak.${timestamp()}`);
  }
  settings.statusLine = next;
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
  return "updated";
}

export async function cmdInstall(opts: { yes?: boolean; otelProfile?: boolean } = {}): Promise<number> {
  const paths = resolveInstallPaths();
  mkdirSync(paths.copilotDir, { recursive: true });
  ensureOtelExporterFile(paths.home);
  writeShim(paths.shimPath);
  const settingsAction = installSettings(paths.settingsPath, paths.shimPath);

  let otelAction: "appended" | "already-present" | "skipped" = "skipped";
  const shouldOfferProfileEdit = opts.otelProfile !== false;
  if (!shouldOfferProfileEdit) {
    console.log(`OTel profile edit skipped. Add this block to your shell profile to enable capture:\n${otelBlock(paths.profileKind)}`);
  } else {
    otelAction = appendOtelExporterBlock(paths.profilePath, paths.profileKind);
  }

  await refreshPricing({ force: false, dest: pricingCachePath(paths.home) });

  console.log([
    "copilot-cost installed:",
    `  shim: ${paths.shimPath}`,
    `  settings: ${paths.settingsPath} (${settingsAction})`,
    `  shell profile: ${paths.profilePath}`,
    "  restart: restart Copilot CLI or open a new shell for OTel env vars",
    `  otel env: ${otelAction}`,
    "  dashboard: run copilot-cost dashboard when you want the local dashboard",
    "  verify: run copilot-cost doctor after restarting",
  ].join("\n"));
  return 0;
}

export async function cmdUninstall(opts: { yes?: boolean } = {}): Promise<number> {
  const paths = resolveInstallPaths();
  if (existsSync(paths.settingsPath)) {
    const settings = readJsonObject(paths.settingsPath);
    const statusLine = settings.statusLine as { command?: unknown } | undefined;
    if (statusLine && statusLine.command === paths.shimPath) {
      delete settings.statusLine;
      writeFileSync(paths.settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
    }
  }
  removeOtelExporterBlock(paths.profilePath);
  if (existsSync(paths.shimPath)) rmSync(paths.shimPath, { force: true });

  const cacheDir = pricingCacheDir(paths.home);
  if (existsSync(cacheDir) && (opts.yes || (process.stdin.isTTY && (await confirm(`Remove cache directory ${cacheDir}?`, opts.yes))))) {
    rmSync(cacheDir, { recursive: true, force: true });
  }
  console.log("copilot-cost uninstalled");
  return 0;
}

function okLine(label: string, ok: boolean, detail: string, fail = true): boolean {
  const status = ok ? "OK" : fail ? "FAIL" : "WARN";
  console.log(`${status}: ${label}${detail ? ` - ${detail}` : ""}`);
  return ok || !fail;
}

function samplePayload(): unknown {
  return {
    session_id: "synthetic-doctor-session",
    session_name: "Doctor smoke test",
    cwd: "/demo/workspace",
    model: { id: "claude-sonnet-4.5", display_name: "Claude Sonnet 4.5" },
    context_window: {
      total_input_tokens: 12000,
      total_output_tokens: 2400,
      total_cache_read_tokens: 3200,
      total_cache_write_tokens: 800,
      total_reasoning_tokens: 0,
      context_window_size: 200000,
      used_percentage: 9.2,
    },
    cost: { total_premium_requests: 3, total_api_duration_ms: 4200 },
  };
}

export async function cmdDoctor(): Promise<number> {
  const paths = resolveInstallPaths();
  let failed = false;
  const settings = existsSync(paths.settingsPath) ? readJsonObject(paths.settingsPath) : null;
  const statusLine = settings?.statusLine as { command?: unknown } | undefined;
  if (!okLine("settings statusLine", Boolean(settings && statusLine?.command === paths.shimPath), `${paths.settingsPath}; expected command ${paths.shimPath}`)) failed = true;

  try {
    const pricing = loadPricing(pricingCachePath(paths.home));
    if (!okLine("pricing", Object.keys(pricing.models).length > 0, "pricing cache or bundled snapshot loadable")) failed = true;
    const cachePath = pricingCachePath(paths.home);
    const cacheDetail = existsSync(cachePath)
      ? `${cachePath} (${cacheIsFresh(cachePath) ? "fresh" : "stale; run copilot-cost refresh-pricing --force"})`
      : `${cachePath} missing; using bundled snapshot until copilot-cost refresh-pricing succeeds`;
    okLine("pricing cache", existsSync(cachePath), cacheDetail, false);
  } catch (error) {
    failed = true;
    okLine("pricing", false, error instanceof Error ? error.message : String(error));
  }

  const profileConfigured = hasOtelBlock(paths.profilePath);
  okLine("otel profile block", profileConfigured, profileConfigured ? paths.profilePath : `${paths.profilePath} missing copilot-cost block; run copilot-cost install`, false);
  const envEnabled = process.env.COPILOT_OTEL_ENABLED === "true" && process.env.COPILOT_OTEL_EXPORTER_TYPE === "file" && Boolean(process.env.COPILOT_OTEL_FILE_EXPORTER_PATH);
  okLine("shell restart", envEnabled, envEnabled ? "current shell has COPILOT_OTEL_* file exporter variables" : "restart your shell and Copilot CLI so COPILOT_OTEL_* variables take effect", false);
  const otelPath = otelDir(paths.home);
  const jsonlCount = existsSync(otelPath) ? readdirSync(otelPath).filter((name) => name.endsWith(".jsonl") && name !== "copilot-cost-meta.jsonl").length : 0;
  okLine("otel jsonl files", jsonlCount > 0, `${otelPath} (${jsonlCount}); if zero, send a Copilot CLI prompt after shell restart`, false);

  try {
    const rendered = renderPayload(samplePayload(), { persist: false });
    if (!okLine("sample render", rendered.length > 0, rendered)) failed = true;
  } catch (error) {
    failed = true;
    okLine("sample render", false, error instanceof Error ? error.message : String(error));
  }

  const executable = existsSync(paths.shimPath) && (isWindows() || (statSync(paths.shimPath).mode & 0o111) !== 0);
  if (!okLine("shim executable", executable, paths.shimPath)) failed = true;
  const dashboardDir = path.resolve(packageRoot(import.meta.url), "dashboard-ui", "dist");
  const missingDashboardFiles = ["index.html", "app.js", "styles.css"].filter((file) => !existsSync(path.join(dashboardDir, file)));
  okLine(
    "dashboard readiness",
    missingDashboardFiles.length === 0,
    missingDashboardFiles.length === 0
      ? "run copilot-cost dashboard to start the local-only dashboard"
      : `${dashboardDir} missing ${missingDashboardFiles.join(", ")}; run npm run build before local development dashboard`,
    false,
  );
  return failed ? 1 : 0;
}

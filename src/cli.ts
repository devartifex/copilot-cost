import { Command } from "commander";
import process from "node:process";
import { refreshPricing } from "./pricing/fetcher.js";
import { renderPayload } from "./render.js";
import { cmdInstall, cmdUninstall, cmdDoctor } from "./install.js";
import { cmdDashboard } from "./dashboard/server.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function renderCommand(): Promise<void> {
  try {
    const payload = JSON.parse(await readStdin()) as unknown;
    console.log(renderPayload(payload));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`💰 ⚠ bad payload: ${message}`);
  }
}

function exitWith(code: number): void {
  if (code !== 0) process.exitCode = code;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const program = new Command();
  program.name("copilot-cost").exitOverride();
  program.command("render", { isDefault: true }).action(renderCommand);
  program
    .command("refresh-pricing")
    .option("--force", "refresh even if cache is fresh")
    .action(async (opts: { force?: boolean }) => {
      const pricingPath = await refreshPricing({ force: Boolean(opts.force) });
      console.log(`pricing ready: ${pricingPath}`);
    });
  program
    .command("install")
    .option("--yes", "accepted for compatibility; install does not prompt")
    .option("--no-otel-profile", "skip editing your shell profile and print manual OTel setup")
    .action(async (opts: { yes?: boolean; otelProfile?: boolean }) => exitWith(await cmdInstall({ yes: Boolean(opts.yes), otelProfile: opts.otelProfile })));
  program
    .command("uninstall")
    .option("--yes", "accept prompts")
    .action(async (opts: { yes?: boolean }) => exitWith(await cmdUninstall({ yes: Boolean(opts.yes) })));
  program.command("doctor").action(async () => exitWith(await cmdDoctor()));
  program
    .command("dashboard")
    .option("--port <number>", "port to listen on", (value) => Number.parseInt(String(value), 10))
    .option("--host <host>", "host to listen on")
    .option("--no-open", "do not open the dashboard in a browser")
    .action(async (opts: { port?: number; host?: string; open?: boolean }) => {
      await cmdDashboard({ port: opts.port, host: opts.host, noOpen: opts.open === false });
    });
  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && (error as { code?: string }).code === "commander.helpDisplayed") {
      return;
    }
    throw error;
  }
}

void main();

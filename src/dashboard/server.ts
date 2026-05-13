import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import process from "node:process";
import { loadPricing } from "../pricing/loader.js";
import { refreshPricing } from "../pricing/fetcher.js";
import { appendOtelExporterBlock, hasOtelBlock, resolveInstallPaths } from "../install.js";
import { OTEL_DIR, resolveOtelFiles } from "../otel/paths.js";
import { readAllCalls } from "../otel/reader.js";
import { summary, sessions, sessionDetail, timeseries, models, exportCsv } from "../otel/aggregations.js";
import type { NormalizedCall } from "../otel/parser.js";
import { packageRoot } from "../util/package-root.js";

type Range = "7d" | "30d" | "90d" | "all";
type JsonValue = unknown;

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = packageRoot(import.meta.url);
const uiDir = path.join(pkgRoot, "dashboard-ui", "dist");
const packageJson = JSON.parse(readFileSync(path.join(pkgRoot, "package.json"), "utf-8")) as { version?: string };

function send(res: ServerResponse, status: number, body: string | Buffer, contentType: string): void {
  res.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store" });
  res.end(body);
}

function json(res: ServerResponse, status: number, value: JsonValue): void {
  send(res, status, JSON.stringify(value), "application/json; no-store");
}

function serveFile(res: ServerResponse, fileName: string, contentType: string): void {
  const filePath = path.join(uiDir, fileName);
  if (!existsSync(filePath)) {
    json(res, 404, { error: "not found" });
    return;
  }
  send(res, 200, readFileSync(filePath), contentType);
}

function rangeParam(url: URL): Range {
  const value = url.searchParams.get("range");
  return value === "7d" || value === "30d" || value === "90d" || value === "all" ? value : "7d";
}

function readCalls(): NormalizedCall[] {
  return readAllCalls();
}

function health(): Record<string, unknown> {
  const files = resolveOtelFiles(process.env).filter((file) => file.endsWith(".jsonl"));
  const envEnabled = process.env.COPILOT_OTEL_ENABLED === "true" || Boolean(process.env.COPILOT_OTEL_FILE_EXPORTER_PATH);
  const paths = resolveInstallPaths();
  const profileConfigured = hasOtelBlock(paths.profilePath);
  return {
    ok: true,
    otel_enabled: envEnabled || profileConfigured || files.length > 0,
    otel_env_enabled: envEnabled,
    otel_profile_configured: profileConfigured,
    otel_profile_path: paths.profilePath,
    otel_dir: OTEL_DIR,
    jsonl_files: files.length,
    version: packageJson.version ?? "0.0.0",
  };
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const method = req.method ?? "GET";
  try {
    if (method === "GET" && url.pathname === "/") return serveFile(res, "index.html", "text/html; charset=utf-8");
    if (method === "GET" && url.pathname === "/styles.css") return serveFile(res, "styles.css", "text/css; charset=utf-8");
    if (method === "GET" && url.pathname === "/app.js") return serveFile(res, "app.js", "text/javascript; charset=utf-8");
    if (method === "GET" && url.pathname === "/chart.umd.js") return serveFile(res, "chart.umd.js", "text/javascript; charset=utf-8");
    if (method === "GET" && url.pathname === "/api/health") return json(res, 200, health());
    if (method === "GET" && url.pathname === "/api/pricing") return json(res, 200, loadPricing());
    if (method === "POST" && url.pathname === "/api/refresh-pricing") {
      await refreshPricing({ force: true });
      return json(res, 200, loadPricing());
    }
    if (method === "POST" && url.pathname === "/api/install-otel") {
      const paths = resolveInstallPaths();
      const action = appendOtelExporterBlock(paths.profilePath);
      return json(res, 200, { ok: true, profile_path: paths.profilePath, action });
    }

    if (url.pathname.startsWith("/api/")) {
      const calls = readCalls();
      if (method === "GET" && url.pathname === "/api/summary") return json(res, 200, summary(calls));
      if (method === "GET" && url.pathname === "/api/sessions") return json(res, 200, sessions(calls));
      const sessionMatch = /^\/api\/sessions\/([^/]+)$/.exec(url.pathname);
      if (method === "GET" && sessionMatch?.[1]) return json(res, 200, sessionDetail(calls, decodeURIComponent(sessionMatch[1])));
      if (method === "GET" && url.pathname === "/api/timeseries") return json(res, 200, timeseries(calls, rangeParam(url)));
      if (method === "GET" && url.pathname === "/api/models") return json(res, 200, models(calls));
      if (method === "GET" && url.pathname === "/api/export.csv") {
        return send(res, 200, exportCsv(calls), "text/csv; charset=utf-8");
      }
    }
    return json(res, 404, { error: "not found" });
  } catch (error) {
    return json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

export function makeServer(host = "127.0.0.1", _port = 4567): http.Server {
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("dashboard only supports local binds (127.0.0.1)");
  }
  return http.createServer((req, res) => {
    void handle(req, res);
  });
}

function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

export async function run(host = "127.0.0.1", port = 4567): Promise<void> {
  const server = makeServer(host, port);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
  console.log(`dashboard: http://${host}:${port}/`);
}

export async function cmdDashboard(opts: { port?: number; host?: string; noOpen?: boolean } = {}): Promise<void> {
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 4567;
  const server = makeServer(host, port);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const url = `http://${host}:${actualPort}/`;
  console.log(`dashboard: ${url}`);
  if (!opts.noOpen) openBrowser(url);
}

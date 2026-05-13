"""Local-only dashboard API server."""
from __future__ import annotations

import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from pricing_loader import load_pricing
from pricing_fetcher import refresh_pricing
from usage_db import export_csv, models, session_detail, sessions, summary, timeseries

ROOT = Path(__file__).resolve().parent

class DashboardHandler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

    def _send(self, code: int, body: bytes, content_type: str = "application/json"):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def json(self, obj, code: int = 200):
        self._send(code, json.dumps(obj, default=str).encode("utf-8"))

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/":
            self._send(200, (ROOT / "index.html").read_bytes(), "text/html; charset=utf-8")
        elif path == "/api/summary":
            self.json(summary())
        elif path == "/api/sessions":
            self.json(sessions())
        elif path.startswith("/api/sessions/"):
            self.json(session_detail(path.rsplit("/", 1)[-1]))
        elif path == "/api/timeseries":
            rng = parse_qs(parsed.query).get("range", ["7d"])[0]
            self.json(timeseries(rng))
        elif path == "/api/models":
            self.json(models())
        elif path == "/api/pricing":
            self.json(load_pricing())
        elif path == "/api/export.csv":
            self._send(200, export_csv().encode("utf-8"), "text/csv; charset=utf-8")
        else:
            self.json({"error": "not found"}, 404)

    def do_POST(self):
        if urlparse(self.path).path == "/api/refresh-pricing":
            refresh_pricing(force=True)
            self.json({"ok": True, "pricing": load_pricing()})
        else:
            self.json({"error": "not found"}, 404)


def make_server(host: str = "127.0.0.1", port: int = 7777):
    if host != "127.0.0.1":
        raise ValueError("dashboard refuses to bind outside 127.0.0.1")
    return ThreadingHTTPServer((host, port), DashboardHandler)


def run(host: str = "127.0.0.1", port: int = 7777):
    httpd = make_server(host, port)
    actual = httpd.server_address[1]
    print(f"Dashboard listening on http://127.0.0.1:{actual}/")
    try:
        httpd.serve_forever()
    finally:
        httpd.server_close()

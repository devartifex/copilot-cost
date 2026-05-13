#!/usr/bin/env python3
"""GitHub Copilot CLI statusline cost renderer and dashboard launcher."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import webbrowser
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from pricing_loader import CACHE_PRICING, SNAPSHOT, compute_cost, get_model_price, load_pricing, normalize_model
from pricing_fetcher import refresh_pricing
from usage_db import DB_DIR, DB_PATH, connect, upsert_snapshot

ROOT = Path(__file__).resolve().parent
SCRIPT = ROOT / "cost_statusline.py"


def _int(d: Dict[str, Any], key: str) -> int:
    return int(d.get(key) or 0)


def _short(n: int) -> str:
    if n >= 1_000_000:
        return f"{n/1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n/1_000:.1f}k"
    return str(n)


def render_payload(payload: Dict[str, Any], persist: bool = True) -> str:
    model_info = payload.get("model") or {}
    raw_model = model_info.get("id")
    cw = payload.get("context_window") or {}
    cost_info = payload.get("cost") or {}
    total_input = _int(cw, "total_input_tokens")
    output = _int(cw, "total_output_tokens")
    cache_read = _int(cw, "total_cache_read_tokens")
    cache_write = _int(cw, "total_cache_write_tokens")
    if not raw_model and total_input == 0 and output == 0:
        return "$0.00"
    model, price = get_model_price(raw_model)
    if not price:
        shown = normalize_model(raw_model) or "unknown"
        return f"$? ({shown})"
    usd = compute_cost({"input": total_input, "cache_read": cache_read, "cache_write": cache_write, "output": output}, price)
    if persist:
        try:
            upsert_snapshot(payload, model or str(raw_model), usd)
        except Exception:
            pass
    fmt = os.environ.get("COPILOT_COST_FORMAT", "standard")
    reasoning = _int(cw, "total_reasoning_tokens")
    fresh = max(total_input - cache_read - cache_write, 0)
    if fmt in ("compact", "minimal"):
        body = f"${usd:.4f}"
    elif fmt in ("full", "verbose"):
        credits = usd * 100
        parts = [
            f"${usd:.4f} ({credits:.2f} cr)",
            f"{_short(fresh)} fresh / {_short(cache_read)} cache↻ / {_short(cache_write)} cache✎ / {_short(output)} out",
            f"Σ {_short(total_input + output)}",
        ]
        if reasoning:
            parts.append(f"{_short(reasoning)} reason")
        body = " · ".join(parts)
    else:
        parts = [f"${usd:.4f}", f"{_short(fresh)} in / {_short(output)} out"]
        if cache_read or cache_write:
            parts.append(f"{_short(cache_read + cache_write)} cache")
        body = " · ".join(parts)
    if os.environ.get("COPILOT_COST_NO_COLOR") or os.environ.get("NO_COLOR"):
        return body
    color = os.environ.get("COPILOT_COST_COLOR", "90")
    return f"\x1b[{color}m{body}\x1b[0m"



def cmd_render(_: argparse.Namespace) -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception as exc:
        print(f"💰 ⚠ bad payload: {exc}")
        return 0
    print(render_payload(payload))
    return 0


def _settings_path() -> Path:
    return Path.home() / ".copilot" / "settings.json"


def cmd_install(_: argparse.Namespace) -> int:
    settings = _settings_path()
    settings.parent.mkdir(parents=True, exist_ok=True)
    data: Dict[str, Any] = {}
    if settings.exists():
        ts = datetime.now().strftime("%Y%m%d%H%M%S")
        backup = settings.with_name(f"settings.json.bak.{ts}")
        shutil.copyfile(settings, backup)
        print(f"Backed up {settings} to {backup}")
        try:
            data = json.loads(settings.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            print(f"error: {settings} is not valid JSON", file=sys.stderr)
            return 1
    data["statusLine"] = {"type": "command", "command": str(SCRIPT), "padding": 1}
    settings.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    refresh_pricing(force=False)
    print(f"Installed statusline command in {settings}")
    print("Restart `copilot` for the statusline to take effect.")
    return 0


def cmd_uninstall(_: argparse.Namespace) -> int:
    settings = _settings_path()
    if not settings.exists():
        print("settings.json not found")
        return 0
    data = json.loads(settings.read_text(encoding="utf-8"))
    block = data.get("statusLine") or {}
    command = block.get("command", "") if isinstance(block, dict) else ""
    if str(SCRIPT) in command:
        data.pop("statusLine", None)
        settings.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        print("Removed copilot-cost statusLine block")
    else:
        print("statusLine does not point at this script; leaving settings unchanged")
    if sys.stdin.isatty():
        ans = input(f"Drop {DB_DIR}? [y/N] ").strip().lower()
        if ans == "y" and DB_DIR.exists():
            shutil.rmtree(DB_DIR)
            print("Removed cache directory")
    return 0


def cmd_doctor(_: argparse.Namespace) -> int:
    issues = []
    settings = _settings_path()
    if not settings.exists():
        issues.append("settings.json missing; run `python3 cost_statusline.py install`")
    else:
        try:
            command = (json.loads(settings.read_text()).get("statusLine") or {}).get("command", "")
            if str(SCRIPT) not in command:
                issues.append("settings.json statusLine does not point at this script")
        except Exception as exc:
            issues.append(f"settings.json unreadable: {exc}")
    try:
        pricing = load_pricing()
        if not pricing.get("models"):
            issues.append("pricing cache has no models; run refresh-pricing")
    except Exception as exc:
        issues.append(f"pricing unreadable: {exc}")
    try:
        conn = connect(DB_PATH); conn.execute("SELECT 1"); conn.close()
    except Exception as exc:
        issues.append(f"usage.db unreadable: {exc}")
    fixture = ROOT / "tests" / "fixtures" / "sample-payload.json"
    try:
        line = render_payload(json.loads(fixture.read_text()), persist=False)
        if not line or "pricing N/A" in line:
            issues.append("sample render did not produce a priced statusline")
    except Exception as exc:
        issues.append(f"sample render failed: {exc}")
    if issues:
        for issue in issues:
            print(f"FAIL: {issue}")
        return 1
    print("OK: settings, pricing, usage.db, and sample render look healthy")
    return 0


def cmd_refresh(args: argparse.Namespace) -> int:
    path = refresh_pricing(force=args.force)
    print(f"pricing ready: {path}")
    return 0


def cmd_dashboard(args: argparse.Namespace) -> int:
    if args.host != "127.0.0.1":
        raise ValueError("dashboard refuses to bind outside 127.0.0.1")
    from dashboard.server import run
    url = f"http://127.0.0.1:{args.port}/"
    if not args.no_open:
        webbrowser.open(url)
    run(host=args.host, port=args.port)
    return 0


def cmd_backfill(_: argparse.Namespace) -> int:
    from otel_reader import backfill
    backfill()
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="copilot-cost")
    sub = p.add_subparsers(dest="cmd")
    sub.add_parser("render").set_defaults(func=cmd_render)
    sub.add_parser("install").set_defaults(func=cmd_install)
    sub.add_parser("uninstall").set_defaults(func=cmd_uninstall)
    sub.add_parser("doctor").set_defaults(func=cmd_doctor)
    rp = sub.add_parser("refresh-pricing"); rp.add_argument("--force", action="store_true"); rp.set_defaults(func=cmd_refresh)
    dash = sub.add_parser("dashboard"); dash.add_argument("--port", type=int, default=7777); dash.add_argument("--host", default="127.0.0.1"); dash.add_argument("--no-open", action="store_true"); dash.set_defaults(func=cmd_dashboard)
    sub.add_parser("dashboard-backfill").set_defaults(func=cmd_backfill)
    return p


def main(argv: Optional[list[str]] = None) -> int:
    argv = list(argv if argv is not None else sys.argv[1:])
    if not argv:
        argv = ["render"]
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)

if __name__ == "__main__":
    raise SystemExit(main())

"""Fetch and cache Copilot model pricing, with snapshot fallback."""
from __future__ import annotations

import os
import re
import shutil
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from html import unescape
from pathlib import Path
from typing import Optional

from pricing_loader import CACHE_DIR, CACHE_PRICING, SNAPSHOT, load_pricing

URL = "https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing"


def _strip_tags(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", unescape(s))).strip()


def parse_pricing_page(html: str) -> dict:
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", html, flags=re.I | re.S)
    models = {}
    for row in rows:
        cells = [_strip_tags(c) for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, flags=re.I | re.S)]
        if len(cells) < 4:
            continue
        joined = " ".join(cells).lower()
        model = next((c for c in cells if re.match(r"^(gpt|claude|gemini|grok|raptor|goldeneye)[\w.\-]+$", c.lower())), None)
        nums = []
        for cell in cells:
            m = re.search(r"\$?([0-9]+(?:\.[0-9]+)?)", cell.replace(",", ""))
            if m:
                nums.append(float(m.group(1)))
        if model and len(nums) >= 3 and "token" in joined:
            vendor = "anthropic" if model.startswith("claude") else "openai" if model.startswith("gpt") else "google" if model.startswith("gemini") else "xai" if model.startswith("grok") else "github"
            models[model] = {"vendor": vendor, "input": nums[0], "cached_input": nums[1], "output": nums[-1]}
            if vendor == "anthropic":
                models[model]["cache_write"] = round(nums[0] * 1.25, 6)
    if len(models) < 3:
        raise ValueError("could not parse enough model pricing rows")
    return {"schema_version": 1, "fetched_at": datetime.now(timezone.utc).date().isoformat(), "models": models}


def dump_yaml(data: dict) -> str:
    lines = ["schema_version: 1", f"fetched_at: {data.get('fetched_at')}", "", "models:"]
    for model in sorted(data.get("models", {})):
        lines.append(f"  {model}:")
        for key, value in data["models"][model].items():
            lines.append(f"    {key}: {value}")
        lines.append("")
    return "\n".join(lines)


def cache_is_fresh(path: Path = CACHE_PRICING) -> bool:
    days = int(os.environ.get("COPILOT_COST_REFRESH_DAYS", "7"))
    if not path.exists():
        return False
    age = datetime.now(timezone.utc) - datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
    return age < timedelta(days=days)


def refresh_pricing(force: bool = False, dest: Path = CACHE_PRICING) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not force and cache_is_fresh(dest):
        return dest
    try:
        with urllib.request.urlopen(URL, timeout=10) as resp:
            html = resp.read().decode("utf-8", errors="replace")
        data = parse_pricing_page(html)
        dest.write_text(dump_yaml(data), encoding="utf-8")
        return dest
    except Exception as exc:
        print(f"warning: pricing refresh failed ({exc}); using bundled snapshot", file=sys.stderr)
        shutil.copyfile(SNAPSHOT, dest)
        return dest


def main(argv: Optional[list[str]] = None) -> int:
    force = bool(argv and "--force" in argv)
    path = refresh_pricing(force=force)
    pricing = load_pricing(path)
    print(f"pricing ready: {path} ({len(pricing.get('models', {}))} models)")
    return 0

if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

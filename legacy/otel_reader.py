"""Best-effort OTel JSONL ingestion for per-call dashboard drilldowns."""
from __future__ import annotations

import glob
import json
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

from pricing_loader import compute_cost, get_model_price
from usage_db import upsert_llm_call

OTEL_DIR = Path.home() / ".copilot" / "otel"


def _attrs(span: Dict[str, Any]) -> Dict[str, Any]:
    attrs = span.get("attributes") or span.get("resource", {}).get("attributes") or {}
    if isinstance(attrs, list):
        out = {}
        for item in attrs:
            key = item.get("key")
            val = item.get("value")
            if isinstance(val, dict):
                val = next(iter(val.values())) if val else None
            if key:
                out[key] = val
        return out
    return attrs if isinstance(attrs, dict) else {}


def span_to_call(span: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    attrs = _attrs(span)
    span_id = span.get("span_id") or span.get("spanId") or span.get("context", {}).get("span_id")
    model = attrs.get("gen_ai.request.model") or attrs.get("gen_ai.response.model") or attrs.get("model")
    session_id = attrs.get("copilot.session_id") or attrs.get("session_id") or span.get("session_id")
    if not span_id or not model:
        return None
    input_tokens = int(attrs.get("gen_ai.usage.input_tokens") or attrs.get("input_tokens") or 0)
    output_tokens = int(attrs.get("gen_ai.usage.output_tokens") or attrs.get("output_tokens") or 0)
    cache_read = int(attrs.get("gen_ai.usage.cache_read.input_tokens") or attrs.get("cache_read") or 0)
    cache_creation = int(attrs.get("gen_ai.usage.cache_creation.input_tokens") or attrs.get("cache_creation") or 0)
    reasoning = int(attrs.get("gen_ai.usage.reasoning.output_tokens") or attrs.get("reasoning") or 0)
    normalized, price = get_model_price(model)
    usd = compute_cost({"input": input_tokens, "cache_read": cache_read, "cache_write": cache_creation, "output": output_tokens}, price) if price else 0.0
    start = span.get("start_time") or span.get("startTimeUnixNano") or span.get("ts")
    duration_ms = int(attrs.get("gen_ai.response.duration_ms") or attrs.get("duration_ms") or 0)
    if span.get("startTimeUnixNano") and span.get("endTimeUnixNano"):
        duration_ms = int((int(span["endTimeUnixNano"]) - int(span["startTimeUnixNano"])) / 1_000_000)
    return {"span_id": span_id, "session_id": session_id, "ts": str(start), "model": normalized or model, "input_tokens": input_tokens, "output_tokens": output_tokens, "cache_read": cache_read, "cache_creation": cache_creation, "reasoning": reasoning, "usd_cost": usd, "duration_ms": duration_ms}


def ingest_file(path: Path) -> int:
    count = 0
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            call = span_to_call(json.loads(line))
            if call:
                upsert_llm_call(call)
                count += 1
        except Exception:
            continue
    return count


def backfill(otel_dir: Path = OTEL_DIR) -> int:
    if not otel_dir.exists():
        print("OTel directory not found, skipping per-call ingest — statusline-only data still available")
        return 0
    total = 0
    for name in sorted(glob.glob(str(otel_dir / "*.jsonl"))):
        total += ingest_file(Path(name))
    print(f"Ingested {total} OTel spans")
    return total

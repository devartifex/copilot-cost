"""Pure-stdlib pricing YAML loader for copilot-cost."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Dict, Optional

ROOT = Path(__file__).resolve().parent
CACHE_DIR = Path.home() / ".copilot" / "cost-cache"
CACHE_PRICING = CACHE_DIR / "pricing.yaml"
SNAPSHOT = ROOT / "pricing.snapshot.yaml"
_NUM_RE = re.compile(r"^-?\d+(?:\.\d+)?$")


def normalize_model(model_id: Optional[str]) -> Optional[str]:
    if not model_id:
        return None
    model = str(model_id).strip()
    for suffix in ("-1m-internal", "-fast"):
        if model.endswith(suffix):
            model = model[: -len(suffix)]
    return model


def _scalar(value: str) -> Any:
    value = value.strip()
    if not value:
        return ""
    if value in {"null", "Null", "NULL", "~"}:
        return None
    if value in {"true", "True"}:
        return True
    if value in {"false", "False"}:
        return False
    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        return value[1:-1]
    if _NUM_RE.match(value):
        return float(value) if "." in value else int(value)
    return value


def load_pricing(path: Optional[os.PathLike[str] | str] = None) -> Dict[str, Any]:
    """Load the small pricing YAML subset used by GitHub Copilot model pricing."""
    chosen = Path(path or os.environ.get("COPILOT_COST_PRICING") or CACHE_PRICING)
    if not chosen.exists():
        chosen = SNAPSHOT
    text = chosen.read_text(encoding="utf-8")
    if chosen.suffix.lower() == ".json":
        return json.loads(text)

    data: Dict[str, Any] = {}
    models: Dict[str, Dict[str, Any]] = {}
    current_model: Optional[str] = None
    in_models = False
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        indent = len(line) - len(line.lstrip(" "))
        stripped = line.strip()
        if indent == 0 and stripped.endswith(":"):
            key = stripped[:-1]
            if key == "models":
                data["models"] = models
                in_models = True
                current_model = None
            else:
                in_models = False
                data[key] = {}
            continue
        if indent == 0 and ":" in stripped:
            key, value = stripped.split(":", 1)
            data[key.strip()] = _scalar(value)
            in_models = False
            continue
        if in_models and indent == 2 and stripped.endswith(":"):
            current_model = stripped[:-1]
            models[current_model] = {}
            continue
        if in_models and indent >= 4 and current_model and ":" in stripped:
            key, value = stripped.split(":", 1)
            models[current_model][key.strip()] = _scalar(value)
    data.setdefault("models", models)
    return data


def get_model_price(model_id: Optional[str], path: Optional[os.PathLike[str] | str] = None) -> tuple[Optional[str], Optional[Dict[str, float]]]:
    model = normalize_model(model_id)
    if not model:
        return None, None
    pricing = load_pricing(path)
    row = pricing.get("models", {}).get(model)
    return model, row


def compute_cost(tokens: Dict[str, int], price: Dict[str, float]) -> float:
    total_input = int(tokens.get("input", 0) or 0)
    cache_read = int(tokens.get("cache_read", 0) or 0)
    cache_write = int(tokens.get("cache_write", 0) or 0)
    output = int(tokens.get("output", 0) or 0)
    fresh = max(total_input - cache_read - cache_write, 0)
    return (
        fresh / 1_000_000 * float(price.get("input", 0))
        + cache_read / 1_000_000 * float(price.get("cached_input", 0))
        + cache_write / 1_000_000 * float(price.get("cache_write", price.get("input", 0)))
        + output / 1_000_000 * float(price.get("output", 0))
    )

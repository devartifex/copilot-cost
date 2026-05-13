"""SQLite persistence for statusline snapshots and dashboard queries."""
from __future__ import annotations

import csv
import io
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

DB_DIR = Path.home() / ".copilot" / "cost-cache"
DB_PATH = DB_DIR / "usage.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  cwd TEXT,
  first_model TEXT,
  started_at TEXT,
  last_seen_at TEXT,
  session_name TEXT
);
CREATE TABLE IF NOT EXISTS snapshots (
  session_id TEXT,
  ts TEXT,
  model TEXT,
  total_input_tokens INTEGER,
  total_output_tokens INTEGER,
  total_cache_read_tokens INTEGER,
  total_cache_write_tokens INTEGER,
  total_reasoning_tokens INTEGER,
  context_window_size INTEGER,
  premium_requests INTEGER,
  api_duration_ms INTEGER,
  usd_cost REAL,
  PRIMARY KEY (session_id, ts)
);
CREATE TABLE IF NOT EXISTS llm_calls (
  span_id TEXT PRIMARY KEY,
  session_id TEXT,
  ts TEXT,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read INTEGER,
  cache_creation INTEGER,
  reasoning INTEGER,
  usd_cost REAL,
  duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_snapshots_session ON snapshots(session_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_ts ON snapshots(ts);
CREATE INDEX IF NOT EXISTS idx_llm_calls_session ON llm_calls(session_id);
"""


def utcnow() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def connect(path: Optional[Path] = None) -> sqlite3.Connection:
    db_path = Path(path or DB_PATH)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def upsert_snapshot(payload: Dict[str, Any], model: str, usd_cost: float, path: Optional[Path] = None, ts: Optional[str] = None) -> bool:
    sid = payload.get("session_id") or "unknown"
    cw = payload.get("context_window") or {}
    cost = payload.get("cost") or {}
    now = ts or utcnow()
    conn = connect(path)
    try:
        prev = conn.execute(
            "SELECT total_input_tokens,total_output_tokens,total_cache_read_tokens,total_cache_write_tokens,total_reasoning_tokens,premium_requests,api_duration_ms,usd_cost FROM snapshots WHERE session_id=? ORDER BY ts DESC LIMIT 1",
            (sid,),
        ).fetchone()
        vals = (
            int(cw.get("total_input_tokens") or 0),
            int(cw.get("total_output_tokens") or 0),
            int(cw.get("total_cache_read_tokens") or 0),
            int(cw.get("total_cache_write_tokens") or 0),
            int(cw.get("total_reasoning_tokens") or 0),
            int(cost.get("total_premium_requests") or 0),
            int(cost.get("total_api_duration_ms") or 0),
            round(float(usd_cost), 10),
        )
        if prev and tuple(prev) == vals:
            return False
        existing = conn.execute("SELECT first_model,started_at FROM sessions WHERE id=?", (sid,)).fetchone()
        if existing:
            conn.execute("UPDATE sessions SET cwd=?, last_seen_at=?, session_name=? WHERE id=?", (payload.get("cwd"), now, payload.get("session_name"), sid))
        else:
            conn.execute(
                "INSERT INTO sessions(id,cwd,first_model,started_at,last_seen_at,session_name) VALUES (?,?,?,?,?,?)",
                (sid, payload.get("cwd"), model, now, now, payload.get("session_name")),
            )
        conn.execute(
            """INSERT OR REPLACE INTO snapshots(session_id,ts,model,total_input_tokens,total_output_tokens,total_cache_read_tokens,total_cache_write_tokens,total_reasoning_tokens,context_window_size,premium_requests,api_duration_ms,usd_cost)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (sid, now, model, *vals[:5], int(cw.get("context_window_size") or 0), vals[5], vals[6], usd_cost),
        )
        conn.commit()
        return True
    finally:
        conn.close()


def upsert_llm_call(call: Dict[str, Any], path: Optional[Path] = None) -> None:
    conn = connect(path)
    try:
        conn.execute(
            """INSERT OR REPLACE INTO llm_calls(span_id,session_id,ts,model,input_tokens,output_tokens,cache_read,cache_creation,reasoning,usd_cost,duration_ms)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (call.get("span_id"), call.get("session_id"), call.get("ts"), call.get("model"), int(call.get("input_tokens") or 0), int(call.get("output_tokens") or 0), int(call.get("cache_read") or 0), int(call.get("cache_creation") or 0), int(call.get("reasoning") or 0), float(call.get("usd_cost") or 0), int(call.get("duration_ms") or 0)),
        )
        conn.commit()
    finally:
        conn.close()


def _rowdicts(rows: Iterable[sqlite3.Row]) -> List[Dict[str, Any]]:
    return [dict(r) for r in rows]


def summary(path: Optional[Path] = None) -> Dict[str, Any]:
    conn = connect(path)
    try:
        now = datetime.now(timezone.utc)
        today = now.date().isoformat()
        week = (now - timedelta(days=7)).isoformat().replace("+00:00", "Z")
        def one(where="", args=()):
            sql = f"""
            SELECT COALESCE(SUM(s.usd_cost),0) usd_cost,
                   COALESCE(SUM(s.total_input_tokens),0) input_tokens,
                   COALESCE(SUM(s.total_output_tokens),0) output_tokens,
                   COALESCE(SUM(s.total_cache_read_tokens+s.total_cache_write_tokens),0) cache_tokens,
                   COALESCE(SUM(s.premium_requests),0) premium_requests
            FROM snapshots s
            JOIN (SELECT session_id, MAX(ts) ts FROM snapshots {where} GROUP BY session_id) latest
              ON latest.session_id=s.session_id AND latest.ts=s.ts
            """
            return dict(conn.execute(sql, args).fetchone())
        return {
            "lifetime": one(),
            "today": one("WHERE substr(ts,1,10)=?", (today,)),
            "week": one("WHERE ts>=?", (week,)),
            "session_count": conn.execute("SELECT COUNT(*) c FROM sessions").fetchone()["c"],
        }
    finally:
        conn.close()


def sessions(path: Optional[Path] = None) -> List[Dict[str, Any]]:
    conn = connect(path)
    try:
        return _rowdicts(conn.execute("""SELECT s.id,s.cwd,s.first_model,s.started_at,s.last_seen_at,s.session_name, x.model, x.usd_cost, x.total_input_tokens, x.total_output_tokens, x.total_cache_read_tokens, x.total_cache_write_tokens, x.premium_requests, x.api_duration_ms
          FROM sessions s LEFT JOIN snapshots x ON x.session_id=s.id AND x.ts=(SELECT MAX(ts) FROM snapshots WHERE session_id=s.id)
          ORDER BY s.last_seen_at DESC"""))
    finally:
        conn.close()


def session_detail(session_id: str, path: Optional[Path] = None) -> Dict[str, Any]:
    conn = connect(path)
    try:
        snaps = _rowdicts(conn.execute("SELECT * FROM snapshots WHERE session_id=? ORDER BY ts", (session_id,)))
        calls = _rowdicts(conn.execute("SELECT * FROM llm_calls WHERE session_id=? ORDER BY ts", (session_id,)))
        return {"session_id": session_id, "snapshots": snaps, "llm_calls": calls}
    finally:
        conn.close()


def timeseries(range_name: str = "7d", path: Optional[Path] = None) -> List[Dict[str, Any]]:
    days = 7
    if range_name.endswith("d") and range_name[:-1].isdigit():
        days = int(range_name[:-1])
    since = (datetime.now(timezone.utc) - timedelta(days=days)).date().isoformat()
    conn = connect(path)
    try:
        return _rowdicts(conn.execute("""
          SELECT substr(s.ts,1,10) day, s.model,
                 SUM(s.usd_cost) usd_cost,
                 SUM(s.total_input_tokens) input_tokens,
                 SUM(s.total_output_tokens) output_tokens
          FROM snapshots s
          JOIN (SELECT session_id, substr(ts,1,10) day, MAX(ts) ts FROM snapshots WHERE substr(ts,1,10)>=? GROUP BY session_id, day) latest
            ON latest.session_id=s.session_id AND latest.ts=s.ts
          GROUP BY day, s.model ORDER BY day
        """, (since,)))
    finally:
        conn.close()


def models(path: Optional[Path] = None) -> List[Dict[str, Any]]:
    conn = connect(path)
    try:
        return _rowdicts(conn.execute("""
          SELECT s.model, COUNT(DISTINCT s.session_id) sessions,
                 SUM(s.usd_cost) usd_cost,
                 SUM(s.total_input_tokens+s.total_output_tokens) token_volume,
                 CASE WHEN SUM(s.total_input_tokens)>0 THEN 1.0*SUM(s.total_cache_read_tokens+s.total_cache_write_tokens)/SUM(s.total_input_tokens) ELSE 0 END cache_hit_ratio
          FROM snapshots s
          JOIN (SELECT session_id, MAX(ts) ts FROM snapshots GROUP BY session_id) latest
            ON latest.session_id=s.session_id AND latest.ts=s.ts
          GROUP BY s.model ORDER BY usd_cost DESC
        """))
    finally:
        conn.close()


def export_csv(path: Optional[Path] = None) -> str:
    conn = connect(path)
    out = io.StringIO()
    try:
        rows = conn.execute("SELECT * FROM snapshots ORDER BY ts").fetchall()
        writer = csv.writer(out)
        if rows:
            writer.writerow(rows[0].keys())
            for row in rows:
                writer.writerow([row[k] for k in row.keys()])
        else:
            writer.writerow(["session_id","ts","model","total_input_tokens","total_output_tokens","total_cache_read_tokens","total_cache_write_tokens","total_reasoning_tokens","context_window_size","premium_requests","api_duration_ms","usd_cost"])
        return out.getvalue()
    finally:
        conn.close()

#!/usr/bin/env python3
"""
Hermes REST Proxy — FastAPI bridge between the web-ui and the Hermes AIAgent.

Endpoints:
  GET  /api/sessions              - List sessions
  POST /api/sessions              - Create new session
  GET  /api/sessions/{id}         - Get session details (messages)
  DELETE /api/sessions/{id}       - Delete session
  GET  /api/sessions/{id}/usage   - Token usage for session
  GET  /api/sessions/{id}/changes - File changes in session
  POST /api/chat/send             - Send message, stream SSE response
  GET  /api/models/current        - Current model info
  POST /api/interrupt             - Interrupt running agent
  GET  /api/files/browse          - Browse filesystem
  GET  /api/files/content         - Get file content
  POST /api/upload                - Upload file
  POST /api/upload/image          - Upload image

Usage:
  cd /path/to/hermes-agent
  source venv/bin/activate
  python hermes_rest_proxy.py [--port 3001] [--host 127.0.0.1]
"""

import asyncio
import json
import logging
import os
import queue
import sqlite3
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

# ---------------------------------------------------------------------------
# Portable import/path bootstrap
# ---------------------------------------------------------------------------
# This proxy may live inside the Web UI directory, while Hermes Agent source
# lives elsewhere. Honor HERMES_HOME and allow HERMES_AGENT_DIR for custom installs.
PROJECT_ROOT = Path(__file__).parent.resolve()


def _discover_hermes_home() -> Path:
    env_home = os.environ.get("HERMES_HOME")
    if env_home:
        return Path(env_home).expanduser()

    for directory in (PROJECT_ROOT, *PROJECT_ROOT.parents):
        if directory.name == ".hermes" and (directory / "config.yaml").is_file():
            return directory
        nested = directory / ".hermes"
        if (nested / "config.yaml").is_file():
            return nested

    username = os.environ.get("USER") or Path.home().name
    candidates = [
        Path.home() / ".hermes",
        Path("/work") / username / ".hermes",
        Path("/workspace") / username / ".hermes",
        Path("/mnt/data/.hermes"),
    ]
    for candidate in candidates:
        if (candidate / "config.yaml").is_file():
            return candidate

    roots = [
        Path.home(),
        Path("/work") / username,
        Path("/workspace") / username,
        Path("/work"),
        Path("/workspace"),
        Path("/mnt/data"),
    ]
    for root in roots:
        if not root.is_dir():
            continue
        try:
            for current, dirs, files in os.walk(root):
                rel_depth = len(Path(current).relative_to(root).parts)
                if rel_depth >= 3:
                    dirs[:] = []
                if Path(current).name == ".hermes" and "config.yaml" in files:
                    return Path(current)
        except OSError:
            continue

    return Path.home() / ".hermes"


def _discover_hermes_agent_dir(hermes_home: Path) -> Path:
    env_agent_dir = os.environ.get("HERMES_AGENT_DIR")
    if env_agent_dir:
        return Path(env_agent_dir).expanduser()

    candidates = [
        hermes_home / "hermes-agent",
        hermes_home.parent / "hermes-agent",
    ]
    for candidate in candidates:
        if candidate.is_dir():
            return candidate

    return hermes_home / "hermes-agent"


_DEFAULT_HERMES_HOME = _discover_hermes_home()
_HERMES_AGENT_DIR = _discover_hermes_agent_dir(_DEFAULT_HERMES_HOME)
os.environ.setdefault("HERMES_HOME", str(_DEFAULT_HERMES_HOME))

for candidate in (PROJECT_ROOT, _HERMES_AGENT_DIR):
    if candidate.exists() and str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
_log = logging.getLogger("hermes_rest_proxy")

try:
    from fastapi import FastAPI, HTTPException, UploadFile, File
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import StreamingResponse
    from pydantic import BaseModel
    import uvicorn
except ImportError:
    raise SystemExit(
        "REST proxy requires fastapi, uvicorn, and python-multipart.\n"
        f"Install with: {sys.executable} -m pip install fastapi 'uvicorn[standard]' python-multipart"
    )

# ---------------------------------------------------------------------------
# Load Hermes config
# ---------------------------------------------------------------------------
try:
    from hermes_cli.config import get_hermes_home, load_config
except ImportError as exc:
    raise SystemExit(
        "Could not import Hermes Agent modules.\n"
        f"Looked for Hermes source at: {_HERMES_AGENT_DIR}\n"
        "Set HERMES_AGENT_DIR=/path/to/hermes-agent or install Hermes Agent first.\n"
        f"Original error: {exc}"
    )

HERMES_HOME = Path(get_hermes_home()).expanduser()
HERMES_PROFILE = os.environ.get("HERMES_PROFILE", "default")
CONFIG_PATH = HERMES_HOME / "config.yaml"
ENV_PATH = HERMES_HOME / ".env"
SETUP_OK = CONFIG_PATH.exists()
if not SETUP_OK:
    _log.warning(
        "Hermes config not found at %s. Run `hermes setup` before using the Web UI.",
        CONFIG_PATH,
    )

_config = load_config()
_model_cfg = _config.get("model", {})

MODEL = _model_cfg.get("default", "unknown")
PROVIDER = _model_cfg.get("provider") or None
BASE_URL = _model_cfg.get("base_url") or None
API_KEY = _model_cfg.get("api_key") or None

_CORE_DB = None
_CORE_DB_LOCK = threading.Lock()


def _get_core_db():
    """Return the main Hermes SessionDB used by the CLI/gateway."""
    global _CORE_DB
    with _CORE_DB_LOCK:
        if _CORE_DB is None:
            from hermes_state import SessionDB
            _CORE_DB = SessionDB()
        return _CORE_DB


# Resolve context length: check model catalog in custom_providers first
def _resolve_context_length() -> int:
    for cp in _config.get("custom_providers", []):
        models = cp.get("models", {})
        if MODEL in models:
            cl = models[MODEL].get("context_length")
            if cl:
                return int(cl)
    return 200_000

MAX_CONTEXT_LENGTH = _resolve_context_length()

# ---------------------------------------------------------------------------
# SQLite session store
# ---------------------------------------------------------------------------
DB_PATH = HERMES_HOME / "web_proxy_sessions.db"


def _get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row
    # WAL mode: readers don't block writers and the journal survives crashes/interrupts
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


from contextlib import contextmanager

@contextmanager
def _db():
    """Context manager that commits on success, rolls back on error, and always closes."""
    conn = _get_db()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _init_db() -> None:
    with _db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id        TEXT PRIMARY KEY,
                title     TEXT,
                created_at REAL,
                updated_at REAL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id           TEXT PRIMARY KEY,
                session_id   TEXT NOT NULL,
                role         TEXT NOT NULL,
                content      TEXT,
                timestamp    REAL,
                input_tokens  INTEGER DEFAULT 0,
                output_tokens INTEGER DEFAULT 0,
                FOREIGN KEY (session_id) REFERENCES sessions(id)
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_msg_session ON messages(session_id)")


_init_db()

# ---------------------------------------------------------------------------
# File change tracking
# ---------------------------------------------------------------------------
# Directories to ALWAYS skip (too large or irrelevant).
_WATCH_SKIP_DIRS = {
    ".git", "__pycache__", "node_modules", ".venv", "venv",
    ".nvm", ".npm", ".cache", ".local", ".docker",
    ".vscode-server", ".vscode-remote-containers", ".dotnet",
}
_WATCH_MAX_DEPTH = 3

# session_id → list of change dicts {path, type, timestamp}
_session_changes: Dict[str, List[dict]] = {}
_changes_lock = threading.Lock()


def _snapshot_files(base: str, skip_hidden_dirs: bool = True) -> Dict[str, float]:
    """Return {filepath: mtime} for files under *base*, up to _WATCH_MAX_DEPTH.

    skip_hidden_dirs=True  → skips dirs whose name starts with '.' (used for
                             the home directory root to avoid .nvm, .npm …).
    skip_hidden_dirs=False → includes hidden dirs (used when we explicitly want
                             to watch a hidden dir such as ~/.hermes).
    """
    result: Dict[str, float] = {}
    base_path = Path(base)
    if not base_path.exists():
        return result

    def _scan(path: Path, depth: int) -> None:
        try:
            for entry in path.iterdir():
                if entry.name in _WATCH_SKIP_DIRS:
                    continue
                if skip_hidden_dirs and entry.name.startswith("."):
                    continue
                if entry.is_symlink():
                    continue
                if entry.is_file():
                    try:
                        result[str(entry)] = entry.stat().st_mtime
                    except OSError:
                        pass
                elif entry.is_dir() and depth < _WATCH_MAX_DEPTH:
                    _scan(entry, depth + 1)
        except PermissionError:
            pass

    _scan(base_path, 0)
    return result


def _take_snapshot() -> Dict[str, float]:
    """Snapshot home dir (skip hidden) + explicitly watch ~/.hermes (include hidden)."""
    merged: Dict[str, float] = {}
    home = Path.home()
    # Non-hidden files under home
    merged.update(_snapshot_files(str(home), skip_hidden_dirs=True))
    # Always include the active Hermes home explicitly (agent stores files there).
    # This honors HERMES_HOME/profile locations instead of assuming ~/.hermes.
    if HERMES_HOME.exists():
        merged.update(_snapshot_files(str(HERMES_HOME), skip_hidden_dirs=False))
    return merged


def _diff_snapshots(
    before: Dict[str, float], after: Dict[str, float], ts: float
) -> List[dict]:
    changes = []
    all_paths = set(before) | set(after)
    for path in sorted(all_paths):
        if path not in before:
            changes.append({"path": path, "type": "added", "timestamp": ts})
        elif path not in after:
            changes.append({"path": path, "type": "deleted", "timestamp": ts})
        elif after[path] != before[path]:
            changes.append({"path": path, "type": "modified", "timestamp": ts})
    return changes


# ---------------------------------------------------------------------------
# In-memory agent registry
# ---------------------------------------------------------------------------
_agents: Dict[str, Any] = {}          # session_id → AIAgent
_agent_queues: Dict[str, queue.Queue] = {}  # session_id → active SSE queue
_active_session: Optional[str] = None
_registry_lock = threading.Lock()


def _get_or_create_agent(session_id: str) -> Any:
    """Return cached AIAgent or create a fresh one for this session."""
    with _registry_lock:
        if session_id not in _agents:
            from run_agent import AIAgent  # deferred import — heavy
            agent = AIAgent(
                base_url=BASE_URL,
                api_key=API_KEY,
                provider=PROVIDER,
                model=MODEL,
                session_id=session_id,
                platform="web",
                quiet_mode=True,
                verbose_logging=False,
            )
            _agents[session_id] = agent
            _log.info("Created new AIAgent for session %s (model=%s)", session_id, MODEL)
        return _agents[session_id]

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(title="Hermes REST Proxy", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Session endpoints
# ---------------------------------------------------------------------------

class RenameSessionRequest(BaseModel):
    title: str


def _fmt_ts(ts: Optional[float]) -> str:
    return time.strftime("%Y-%m-%d %H:%M", time.localtime(ts or time.time()))


def _web_session_row(session_id: str):
    with _db() as conn:
        return conn.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()


def _core_session(session_id: str) -> Optional[dict]:
    try:
        return _get_core_db().get_session(session_id)
    except Exception as exc:
        _log.warning("Failed to read core session %s: %s", session_id, exc)
        return None


def _web_messages(session_id: str) -> List[dict]:
    with _db() as conn:
        rows = conn.execute(
            "SELECT * FROM messages WHERE session_id=? ORDER BY timestamp ASC",
            (session_id,),
        ).fetchall()
    return [
        {
            "id": m["id"],
            "role": m["role"],
            "content": m["content"],
            "timestamp": m["timestamp"],
            "source": "web",
        }
        for m in rows
    ]


def _core_messages(session_id: str) -> List[dict]:
    try:
        rows = _get_core_db().get_messages(session_id)
    except Exception as exc:
        _log.warning("Failed to read core messages for %s: %s", session_id, exc)
        return []
    return [
        {
            "id": f"core_{m.get('id')}",
            "role": m.get("role"),
            "content": m.get("content"),
            "timestamp": m.get("timestamp"),
            "source": "cli",
        }
        for m in rows
    ]


@app.get("/api/sessions")
def list_sessions():
    """List Web UI sessions plus recent CLI sessions from Hermes state.db."""
    merged: Dict[str, dict] = {}

    # CLI history lives in the canonical Hermes SessionDB (~/.hermes/state.db).
    # Only source='cli' is included to avoid duplicating gateway/web sessions.
    try:
        for s in _get_core_db().list_sessions_rich(source="cli", limit=100):
            last_active = s.get("last_active") or s.get("started_at")
            title = s.get("title") or s.get("preview") or "CLI Session"
            merged[s["id"]] = {
                "id": s["id"],
                "title": title,
                "date": _fmt_ts(last_active),
                "source": "cli",
                "sort_ts": last_active or 0,
            }
    except Exception as exc:
        _log.warning("Failed to list CLI sessions: %s", exc)

    with _db() as conn:
        rows = conn.execute(
            "SELECT id, title, created_at, updated_at FROM sessions ORDER BY updated_at DESC"
        ).fetchall()

    for r in rows:
        sort_ts = r["updated_at"] or r["created_at"] or 0
        existing = merged.get(r["id"])
        # If a CLI session was continued from the Web UI, keep the CLI badge but
        # surface the web overlay title/date when it is newer.
        source = existing.get("source", "web") if existing else "web"
        title = r["title"] or (existing.get("title") if existing else "New Chat")
        merged[r["id"]] = {
            "id": r["id"],
            "title": title,
            "date": _fmt_ts(sort_ts),
            "source": source,
            "sort_ts": max(sort_ts, existing.get("sort_ts", 0) if existing else 0),
        }

    # Auto-create a default web session only when neither Web UI nor CLI history exists.
    if not merged:
        session_id = f"sess_{uuid.uuid4().hex[:12]}"
        now = time.time()
        with _db() as conn:
            conn.execute(
                "INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (session_id, "New Chat", now, now),
            )
        _log.info("Auto-created default session %s", session_id)
        return [{"id": session_id, "title": "New Chat", "date": _fmt_ts(now), "source": "web"}]

    return [
        {k: v for k, v in item.items() if k != "sort_ts"}
        for item in sorted(merged.values(), key=lambda x: x.get("sort_ts", 0), reverse=True)
    ]


@app.post("/api/sessions")
def create_session():
    session_id = f"sess_{uuid.uuid4().hex[:12]}"
    now = time.time()
    with _db() as conn:
        conn.execute(
            "INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (session_id, "New Chat", now, now),
        )
    _log.info("Created session %s", session_id)
    return {"id": session_id, "source": "web"}


@app.get("/api/sessions/{session_id}")
def get_session(session_id: str):
    web_sess = _web_session_row(session_id)
    core_sess = _core_session(session_id)
    if not web_sess and not core_sess:
        raise HTTPException(status_code=404, detail="Session not found")

    messages = []
    if core_sess and core_sess.get("source") == "cli":
        messages.extend(_core_messages(session_id))
    messages.extend(_web_messages(session_id))
    messages.sort(key=lambda m: (m.get("timestamp") or 0, str(m.get("id") or "")))

    title = None
    source = "web"
    if core_sess and core_sess.get("source") == "cli":
        title = core_sess.get("title")
        source = "cli"
    if web_sess and (not title or web_sess["title"] != "New Chat"):
        title = web_sess["title"] or title

    return {
        "id": session_id,
        "title": title or "New Chat",
        "source": source,
        "messages": messages,
    }


@app.patch("/api/sessions/{session_id}")
def rename_session(session_id: str, body: RenameSessionRequest):
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title cannot be empty")
    web_sess = _web_session_row(session_id)
    core_sess = _core_session(session_id)
    if web_sess:
        with _db() as conn:
            conn.execute(
                "UPDATE sessions SET title=?, updated_at=? WHERE id=?",
                (title, time.time(), session_id),
            )
        return {"ok": True}
    if core_sess and core_sess.get("source") == "cli":
        try:
            ok = _get_core_db().set_session_title(session_id, title)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        if ok:
            return {"ok": True}
    raise HTTPException(status_code=404, detail="Session not found")


@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: str):
    with _registry_lock:
        _agents.pop(session_id, None)
    deleted = False
    if _web_session_row(session_id):
        with _db() as conn:
            conn.execute("DELETE FROM messages WHERE session_id=?", (session_id,))
            conn.execute("DELETE FROM sessions WHERE id=?", (session_id,))
        deleted = True
    core_sess = _core_session(session_id)
    if core_sess and core_sess.get("source") == "cli":
        try:
            deleted = _get_core_db().delete_session(session_id) or deleted
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")
    _log.info("Deleted session %s", session_id)
    return {"ok": True}


@app.get("/api/sessions/{session_id}/usage")
def get_session_usage(session_id: str):
    with _db() as conn:
        row = conn.execute(
            "SELECT SUM(input_tokens) as inp, SUM(output_tokens) as out "
            "FROM messages WHERE session_id=?",
            (session_id,),
        ).fetchone()
    inp = int(row["inp"] or 0)
    out = int(row["out"] or 0)
    reasoning = 0
    core_sess = _core_session(session_id)
    if core_sess and core_sess.get("source") == "cli":
        inp += int(core_sess.get("input_tokens") or 0)
        out += int(core_sess.get("output_tokens") or 0)
        reasoning += int(core_sess.get("reasoning_tokens") or 0)
    return {
        "input_tokens": inp,
        "output_tokens": out,
        "reasoning_tokens": reasoning,
    }


@app.get("/api/cron/jobs")
def list_cron_jobs():
    """List existing Hermes cron jobs for the Web UI sidebar."""
    try:
        from tools.cronjob_tools import cronjob as cronjob_tool
        payload = json.loads(cronjob_tool(action="list", include_disabled=True))
    except Exception as exc:
        _log.warning("Failed to list cron jobs: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))

    if not payload.get("success"):
        raise HTTPException(status_code=500, detail=payload.get("error") or "Failed to list cron jobs")

    jobs = []
    for job in payload.get("jobs", []):
        jobs.append({
            "id": job.get("job_id"),
            "name": job.get("name") or "Cron Job",
            "summary": job.get("prompt_preview") or "",
            "schedule": job.get("schedule") or "",
            "repeat": job.get("repeat") or "",
            "nextRunAt": job.get("next_run_at"),
            "lastRunAt": job.get("last_run_at"),
            "lastStatus": job.get("last_status"),
            "enabled": job.get("enabled", True),
            "state": job.get("state") or ("scheduled" if job.get("enabled", True) else "paused"),
            "skills": job.get("skills") or [],
            "deliver": job.get("deliver") or "local",
        })
    return {"jobs": jobs, "count": len(jobs)}


@app.get("/api/sessions/{session_id}/changes")
def get_session_changes(session_id: str):
    with _changes_lock:
        changes = list(_session_changes.get(session_id, []))
    return {"changes": changes}


# ---------------------------------------------------------------------------
# Chat send — SSE streaming
# ---------------------------------------------------------------------------

class ChatRequest(BaseModel):
    message: str
    sessionId: str
    images: Optional[List[Dict[str, Any]]] = None


class InterruptRequest(BaseModel):
    sessionId: Optional[str] = None


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


def _ensure_session_exists(session_id: str) -> None:
    with _db() as conn:
        existing = conn.execute(
            "SELECT id FROM sessions WHERE id=?", (session_id,)
        ).fetchone()
        if not existing:
            now = time.time()
            core_sess = _core_session(session_id)
            title = "New Chat"
            if core_sess and core_sess.get("source") == "cli":
                title = core_sess.get("title") or "CLI Session"
            conn.execute(
                "INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (session_id, title, now, now),
            )


def _run_chat(session_id: str, message: str, images: list, q: queue.Queue) -> None:
    """Run the AIAgent in a background thread; push SSE events into *q*."""
    global _active_session

    with _registry_lock:
        _agent_queues[session_id] = q
    _active_session = session_id

    try:
        agent = _get_or_create_agent(session_id)
        text_chunks: List[str] = []

        # Callbacks push events into the queue
        def stream_cb(delta: str) -> None:
            q.put({"type": "message", "content": delta})
            text_chunks.append(delta)

        def thinking_cb(text: str) -> None:
            q.put({"type": "thinking", "content": text})

        def tool_start_cb(tool_call_id: str, name: str, args: dict) -> None:
            q.put({"type": "tool", "name": name, "status": "running"})

        def tool_complete_cb(tool_call_id: str, name: str, args: dict, result_text: str) -> None:
            q.put({"type": "tool", "name": name, "status": "success"})

        # Attach per-request callbacks. Agent instances are cached per session,
        # so update callbacks every turn to point at this turn's SSE queue.
        agent.thinking_callback = thinking_cb
        agent.reasoning_callback = thinking_cb
        agent.tool_start_callback = tool_start_cb
        agent.tool_complete_callback = tool_complete_cb

        # Build user_message — attach images as text description if present
        user_message = message
        if images:
            img_names = ", ".join(img.get("name", "image") for img in images)
            user_message = f"{message}\n\n[Attached images: {img_names}]"

        # Load previous turns from DB so the agent has full conversation context.
        # For CLI sessions, history lives in the canonical Hermes state.db; any
        # follow-up turns sent from this Web UI are then appended from the web
        # overlay DB so continuing a CLI session keeps the full context.
        conversation_history: Optional[List[dict]] = None
        core_sess = _core_session(session_id)
        if core_sess and core_sess.get("source") == "cli":
            try:
                conversation_history = _get_core_db().get_messages_as_conversation(
                    session_id, include_ancestors=True
                )
            except Exception as exc:
                _log.warning("Failed to load core conversation for %s: %s", session_id, exc)
                conversation_history = []
        with _db() as conn:
            prev_rows = conn.execute(
                "SELECT role, content FROM messages "
                "WHERE session_id=? ORDER BY timestamp ASC",
                (session_id,),
            ).fetchall()
        overlay_history = [
            {"role": r["role"], "content": r["content"]}
            for r in prev_rows
            if r["role"] in ("user", "assistant") and r["content"]
        ]
        if conversation_history is not None:
            conversation_history.extend(overlay_history)
        else:
            conversation_history = overlay_history or None

        _log.info(
            "Session %s: running conversation (%d chars, history=%d msgs)",
            session_id, len(user_message), len(conversation_history or []),
        )

        # Snapshot filesystem before the conversation so we can diff after
        snapshot_before = _take_snapshot()

        result = agent.run_conversation(
            user_message=user_message,
            conversation_history=conversation_history,
            stream_callback=stream_cb,
        )

        # Diff filesystem after conversation to find changed files
        snapshot_after = _take_snapshot()
        new_changes = _diff_snapshots(snapshot_before, snapshot_after, time.time())
        if new_changes:
            with _changes_lock:
                existing = _session_changes.setdefault(session_id, [])
                # Merge: update existing entries for the same path, append new ones
                existing_paths = {c["path"]: i for i, c in enumerate(existing)}
                for ch in new_changes:
                    if ch["path"] in existing_paths:
                        existing[existing_paths[ch["path"]]] = ch
                    else:
                        existing.append(ch)
            _log.info("Session %s: detected %d file change(s)", session_id, len(new_changes))

        full_response = "".join(text_chunks)
        if not full_response and isinstance(result, dict):
            full_response = result.get("final_response", "")

        # Persist messages and update session metadata
        now = time.time()
        with _db() as conn:
            # Auto-title: first 60 chars of first user message
            title_row = conn.execute(
                "SELECT title FROM sessions WHERE id=?", (session_id,)
            ).fetchone()
            current_title = title_row["title"] if title_row else "New Chat"
            if current_title == "New Chat" and message.strip():
                new_title = message.strip()[:60]
                conn.execute(
                    "UPDATE sessions SET updated_at=?, title=? WHERE id=?",
                    (now, new_title, session_id),
                )
            else:
                conn.execute(
                    "UPDATE sessions SET updated_at=? WHERE id=?",
                    (now, session_id),
                )

            # Save user message (idempotent via unique id)
            conn.execute(
                "INSERT INTO messages (id, session_id, role, content, timestamp) "
                "VALUES (?, ?, ?, ?, ?)",
                (f"msg_{uuid.uuid4().hex}", session_id, "user", message, now - 0.01),
            )

            # Save assistant response
            if full_response:
                res = result if isinstance(result, dict) else {}
                input_tok = res.get("input_tokens") or res.get("prompt_tokens") or 0
                output_tok = res.get("output_tokens") or res.get("completion_tokens") or 0
                conn.execute(
                    "INSERT INTO messages "
                    "(id, session_id, role, content, timestamp, input_tokens, output_tokens) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (
                        f"msg_{uuid.uuid4().hex}",
                        session_id,
                        "assistant",
                        full_response,
                        now,
                        input_tok,
                        output_tok,
                    ),
                )

        q.put({"type": "done"})
        res_log = result if isinstance(result, dict) else {}
        _log.info(
            "Session %s: conversation done (%d chars, in=%d out=%d tokens)",
            session_id, len(full_response),
            res_log.get("input_tokens", 0), res_log.get("output_tokens", 0),
        )

    except Exception as exc:
        _log.exception("Session %s: chat error", session_id)
        q.put({"type": "error", "content": str(exc)})
        q.put({"type": "done"})
    finally:
        _active_session = None
        with _registry_lock:
            _agent_queues.pop(session_id, None)


@app.post("/api/chat/send")
async def chat_send(body: ChatRequest):
    session_id = body.sessionId
    _ensure_session_exists(session_id)

    q: queue.Queue = queue.Queue()
    thread = threading.Thread(
        target=_run_chat,
        args=(session_id, body.message, body.images or [], q),
        daemon=True,
        name=f"chat-{session_id[:8]}",
    )
    thread.start()

    async def event_stream():
        loop = asyncio.get_event_loop()
        while True:
            try:
                # Long-running tools can be quiet for several minutes. Send
                # heartbeat events instead of closing the stream on inactivity.
                event = await loop.run_in_executor(
                    None, lambda: q.get(timeout=15)
                )
                yield _sse(event)
                if event.get("type") == "done":
                    break
            except queue.Empty:
                yield _sse({"type": "heartbeat"})
                continue
            except asyncio.CancelledError:
                break
            except Exception as exc:
                _log.warning("SSE stream failed for session %s: %s", session_id, exc)
                yield _sse({"type": "error", "content": str(exc)})
                yield _sse({"type": "done"})
                break

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )

# ---------------------------------------------------------------------------
# User / environment info  (used by the frontend to avoid hardcoded paths)
# ---------------------------------------------------------------------------

_BOOKMARK_SKIP = {
    "node_modules", "__pycache__", "venv", ".venv",
    ".nvm", ".npm", ".cache", ".local", ".docker",
    ".vscode-server", ".vscode-remote-containers", ".dotnet",
}


@app.get("/api/user/info")
def user_info():
    """Return environment details so the frontend needs zero hardcoded paths."""
    home = Path.home()

    # Always include home as first bookmark
    bookmarks = [{"label": "~", "path": str(home)}]

    # Add the active Hermes home as a quick shortcut.
    if HERMES_HOME.exists():
        bookmarks.append({"label": ".hermes", "path": str(HERMES_HOME)})

    # Auto-discover non-hidden project directories directly under home
    try:
        candidates = sorted(
            e for e in home.iterdir()
            if e.is_dir()
            and not e.name.startswith(".")
            and e.name not in _BOOKMARK_SKIP
        )
        for entry in candidates[:6]:          # cap at 6 extra bookmarks
            bookmarks.append({"label": entry.name, "path": str(entry)})
    except PermissionError:
        pass

    return {
        "home": str(home),
        "username": home.name,
        "hermes_home": str(HERMES_HOME),
        "model": MODEL,
        "bookmarks": bookmarks,
    }


# ---------------------------------------------------------------------------
# Model info
# ---------------------------------------------------------------------------

@app.get("/api/models/current")
def get_current_model():
    return {
        "model": MODEL,
        "max_context_length": MAX_CONTEXT_LENGTH,
    }

# ---------------------------------------------------------------------------
# Interrupt
# ---------------------------------------------------------------------------

@app.post("/api/interrupt")
def interrupt_agent(body: Optional[InterruptRequest] = None):
    sess = body.sessionId if body and body.sessionId else _active_session
    if sess:
        with _registry_lock:
            agent = _agents.get(sess)
        if agent and hasattr(agent, "interrupt"):
            try:
                agent.interrupt()
                _log.info("Interrupted session %s", sess)
            except Exception as exc:
                _log.warning("Interrupt failed: %s", exc)
    return {"ok": True}

# ---------------------------------------------------------------------------
# File browser
# ---------------------------------------------------------------------------

@app.get("/api/files/browse")
def files_browse(path: str = "~"):
    try:
        real = Path(path).expanduser().resolve()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid path")

    if not real.exists():
        raise HTTPException(status_code=404, detail="Path not found")

    if not real.is_dir():
        raise HTTPException(status_code=400, detail="Not a directory")

    entries = []
    try:
        for entry in sorted(real.iterdir(), key=lambda e: (e.is_file(), e.name.lower())):
            try:
                stat = entry.stat()
                entries.append({
                    "name": entry.name,
                    "path": str(entry),
                    # UI expects "dir" (not "directory") for the folder icon to render
                    "type": "dir" if entry.is_dir() else "file",
                    "size": stat.st_size if entry.is_file() else None,
                    "modified": time.strftime(
                        "%Y-%m-%d %H:%M", time.localtime(stat.st_mtime)
                    ),
                })
            except PermissionError:
                pass
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")

    return {"path": str(real), "entries": entries}


@app.get("/api/files/content")
def files_content(path: str):
    try:
        real = Path(path).expanduser().resolve()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid path")

    if not real.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if not real.is_file():
        raise HTTPException(status_code=400, detail="Not a file")

    try:
        content = real.read_text(errors="replace")
        return {"path": str(real), "content": content}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

# ---------------------------------------------------------------------------
# File upload
# ---------------------------------------------------------------------------

UPLOAD_DIR = Path(tempfile.gettempdir()) / "hermes_web_uploads"
UPLOAD_DIR.mkdir(exist_ok=True)


@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    content = await file.read()
    dest = UPLOAD_DIR / (file.filename or f"upload_{uuid.uuid4().hex}")
    dest.write_bytes(content)
    _log.info("Uploaded file: %s (%d bytes)", dest.name, len(content))
    return {"name": dest.name, "path": str(dest), "size": len(content)}


@app.post("/api/upload/image")
async def upload_image(file: UploadFile = File(...)):
    content = await file.read()
    dest = UPLOAD_DIR / (file.filename or f"image_{uuid.uuid4().hex}")
    dest.write_bytes(content)
    _log.info("Uploaded image: %s (%d bytes)", dest.name, len(content))
    return {"name": dest.name, "path": str(dest), "size": len(content)}

# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health():
    try:
        from hermes_cli import __version__ as _ver
    except Exception:
        _ver = "unknown"
    return {
        "status": "ok" if SETUP_OK else "setup_required",
        "model": MODEL,
        "provider": PROVIDER,
        "version": _ver,
        "hermes_home": str(HERMES_HOME),
        "hermes_agent_dir": str(_HERMES_AGENT_DIR),
        "profile": HERMES_PROFILE,
        "setup_ok": SETUP_OK,
        "config_exists": CONFIG_PATH.exists(),
        "env_exists": ENV_PATH.exists(),
        "features": {
            "sessions": True,
            "cron": True,
            "files": True,
            "uploads": True,
        },
    }

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Hermes REST Proxy")
    parser.add_argument("--host", default=os.environ.get("HERMES_WEB_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("HERMES_WEB_PORT", "3001")))
    args = parser.parse_args()

    _log.info("Starting Hermes REST Proxy on %s:%d (model=%s)", args.host, args.port, MODEL)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")

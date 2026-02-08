#!/usr/bin/env python3
import glob
import json
import os
import subprocess
import time
import datetime
import atexit
import traceback
from collections import deque
from typing import Deque, Dict, List, Optional, Set, Tuple


def session_files(codex_home: str) -> List[str]:
    # Codex stores sessions nested by date, e.g. ~/.codex/sessions/YYYY/MM/DD/<id>.jsonl.
    # Use a recursive glob so we don't depend on the exact depth.
    pattern = os.path.join(codex_home, "sessions", "**", "*.jsonl")
    files = glob.glob(pattern, recursive=True)

    # Only a small number of session files are actively being appended to.
    # Sorting by mtime and trimming keeps the watcher lightweight.
    try:
        max_files = int(os.environ.get("CODEX_TTS_MAX_FILES", "0"))
    except Exception:
        max_files = 0
    if max_files > 0 and len(files) > max_files:
        files_with_mtime = []
        for p in files:
            try:
                files_with_mtime.append((os.path.getmtime(p), p))
            except Exception:
                continue
        files_with_mtime.sort(reverse=True)
        files = [p for _, p in files_with_mtime[:max_files]]

    return files


def _normalize_text(text: str) -> Optional[str]:
    msg = " ".join(text.split())
    return msg or None


def _parse_timestamp_to_epoch(ts: object) -> Optional[float]:
    if not isinstance(ts, str) or not ts.strip():
        return None
    s = ts.strip()
    # Common format in Codex session logs: 2026-02-06T12:42:31.042Z
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.datetime.fromisoformat(s)
    except Exception:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt.timestamp()


def extract_assistant_event(line: str) -> Tuple[Optional[str], Optional[float]]:
    try:
        obj = json.loads(line)
    except Exception:
        return None, None

    ts_epoch = _parse_timestamp_to_epoch(obj.get("timestamp"))

    obj_type = obj.get("type")
    payload = obj.get("payload") or {}

    if obj_type == "event_msg":
        if payload.get("type") in ("agent_message", "assistant_message"):
            message = payload.get("message")
            if isinstance(message, str) and message.strip():
                return _normalize_text(message), ts_epoch
        return None, ts_epoch

    if obj_type != "response_item":
        return None, ts_epoch

    if payload.get("type") != "message" or payload.get("role") != "assistant":
        return None, ts_epoch

    content = payload.get("content") or []
    texts: List[str] = []
    if isinstance(content, list):
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "output_text" and item.get("text"):
                texts.append(str(item.get("text")))
            elif item.get("text"):
                texts.append(str(item.get("text")))
    if isinstance(content, str):
        texts.append(content)

    msg = " ".join(t.strip() for t in texts if t and str(t).strip())
    return (_normalize_text(msg) if msg else None), ts_epoch


def _parse_start_epoch() -> float:
    start_epoch_env = os.environ.get("CODEX_TTS_START_EPOCH")
    if start_epoch_env:
        try:
            return float(start_epoch_env)
        except Exception:
            pass

    start_iso = os.environ.get("CODEX_TTS_START_ISO")
    if start_iso:
        ts = _parse_timestamp_to_epoch(start_iso)
        if ts is not None:
            return ts

    return time.time()


def _read_rate_state(path: str, now: float, window_seconds: int) -> List[float]:
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            raw = [ln.strip() for ln in f.readlines() if ln.strip()]
    except FileNotFoundError:
        return []
    except Exception:
        return []

    stamps: List[float] = []
    for ln in raw[-2000:]:
        try:
            stamps.append(float(ln))
        except Exception:
            continue
    cutoff = now - float(window_seconds)
    return [t for t in stamps if t >= cutoff]


def _write_rate_state(path: str, stamps: List[float]) -> None:
    tmp = f"{path}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            for t in stamps[-2000:]:
                f.write(f"{t}\n")
        os.replace(tmp, path)
    except Exception:
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except Exception:
            pass


def main() -> int:
    codex_home = os.environ.get("CODEX_HOME", os.path.expanduser("~/.codex"))
    tts_script = os.path.join(os.path.dirname(__file__), "codex-notify-tts.sh")
    if not os.path.isfile(tts_script):
        return 1

    log_file = os.environ.get("CODEX_TTS_LOG_FILE", "/tmp/codex-session-watch-tts.log")
    debug_enabled = os.environ.get("CODEX_TTS_DEBUG") == "1"
    dry_run = os.environ.get("CODEX_TTS_DRY_RUN") == "1"
    start_epoch = _parse_start_epoch()

    # Ensure only one watcher runs at a time; multiple instances will double-speak and confuse logs.
    lock_path = os.environ.get("CODEX_TTS_LOCK_FILE", "/tmp/codex-session-watch-tts.lock")
    lock_fd: Optional[int] = None
    try:
        lock_fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        os.write(lock_fd, str(os.getpid()).encode("utf-8"))
        os.close(lock_fd)
        lock_fd = None
    except FileExistsError:
        try:
            with open(lock_path, "r", encoding="utf-8", errors="ignore") as f:
                pid_raw = f.read().strip()
            pid = int(pid_raw)
            # If process is alive, exit.
            os.kill(pid, 0)
            return 0
        except Exception:
            # Stale lock; clear it and continue.
            try:
                os.remove(lock_path)
            except Exception:
                return 1
            return main()

    def _cleanup_lock() -> None:
        try:
            os.remove(lock_path)
        except Exception:
            pass

    atexit.register(_cleanup_lock)

    # Rate limiting: hard cap on messages generated per rolling hour.
    try:
        max_per_hour = int(os.environ.get("CODEX_TTS_MAX_PER_HOUR", "60"))
    except Exception:
        max_per_hour = 60
    try:
        min_seconds_between = int(os.environ.get("CODEX_TTS_MIN_SECONDS_BETWEEN", "5"))
    except Exception:
        min_seconds_between = 5
    rate_state_file = os.environ.get("CODEX_TTS_RATE_STATE_FILE", "/tmp/codex-tts-rate-state.txt")
    last_speak_ts = 0.0

    def debug(msg: str) -> None:
        if not debug_enabled:
            return
        ts = time.strftime("%Y-%m-%d %H:%M:%S")
        with open(log_file, "a", encoding="utf-8") as lf:
            lf.write(f"[{ts}] {msg}\n")

    debug(
        f"pid={os.getpid()} start_epoch={start_epoch} dry_run={int(dry_run)} "
        f"max_per_hour={max_per_hour} min_seconds_between={min_seconds_between} "
        f"max_files={os.environ.get('CODEX_TTS_MAX_FILES','0')}"
    )

    def allow_speak() -> bool:
        nonlocal last_speak_ts
        if max_per_hour <= 0:
            return False
        now = time.time()
        if min_seconds_between > 0 and (now - last_speak_ts) < float(min_seconds_between):
            return False

        stamps = _read_rate_state(rate_state_file, now=now, window_seconds=3600)
        if len(stamps) >= max_per_hour:
            debug(f"rate-limited: {len(stamps)}/{max_per_hour} in last hour")
            return False

        # Enforce the cap even in dry-run so tests can't spam.
        stamps.append(now)
        _write_rate_state(rate_state_file, stamps)
        last_speak_ts = now
        return True

    offsets: Dict[str, int] = {}
    buffers: Dict[str, bytes] = {}
    files: List[str] = []
    last_scan = 0.0

    recent: Deque[str] = deque()
    recent_set: Set[str] = set()
    max_recent = 50

    def remember(msg: str) -> bool:
        if msg in recent_set:
            return False
        recent.append(msg)
        recent_set.add(msg)
        if len(recent) > max_recent:
            old = recent.popleft()
            if old in recent_set:
                recent_set.remove(old)
        return True

    while True:
        now = time.time()
        if now - last_scan > 2:
            files = session_files(codex_home)
            last_scan = now
            debug(f"scanned {len(files)} session files")

        if not files:
            time.sleep(0.5)
            continue

        for path in files:
            if path not in offsets:
                try:
                    with open(path, "rb") as f:
                        f.seek(0, os.SEEK_END)
                        size = f.tell()
                        # Default behavior: do not replay history on discovery.
                        # Set offset to EOF; we'll only process new lines appended after startup.
                        data = b""
                        offsets[path] = size
                    buffers[path] = b""
                    debug(f"tracking {path}")
                except Exception as exc:
                    debug(f"error tracking {path}: {exc!r}")
                    if debug_enabled:
                        debug(traceback.format_exc().rstrip())
                    continue
                continue

            try:
                with open(path, "rb") as f:
                    f.seek(offsets[path])
                    data = f.read()
                    if not data:
                        continue
                    offsets[path] += len(data)
            except Exception as exc:
                debug(f"error reading {path}: {exc!r}")
                if debug_enabled:
                    debug(traceback.format_exc().rstrip())
                continue

            buf = buffers.get(path, b"")
            data = buf + data
            lines = data.split(b"\n")
            if data and not data.endswith(b"\n"):
                buffers[path] = lines.pop()
            else:
                buffers[path] = b""

            for raw in lines:
                if not raw:
                    continue
                try:
                    line = raw.decode("utf-8", errors="ignore")
                except Exception:
                    continue
                msg, msg_ts = extract_assistant_event(line)
                if not msg:
                    continue
                # Prevent backlog replays: only speak messages at/after watcher start.
                if msg_ts is not None and msg_ts < start_epoch:
                    debug(f"skipping pre-start msg: {msg[:80]}")
                    continue
                if not remember(msg):
                    debug(f"skipping duplicate msg: {msg[:80]}")
                    continue
                if not allow_speak():
                    continue

                debug(f"assistant msg from {os.path.basename(path)}: {msg[:80]}")
                # Include cwd so the TTS script can resolve .env and output paths even when the watcher is run
                # from some other directory. Allow an explicit override.
                base_dir = os.environ.get("CODEX_TTS_BASE_DIR") or os.getcwd()
                payload = json.dumps({"type": "agent-turn-complete", "last_assistant_message": msg, "cwd": base_dir})
                try:
                    with open(log_file, "a", encoding="utf-8") as lf:
                        proc = subprocess.Popen([tts_script, payload], stdout=lf, stderr=lf)
                        _ = proc
                except Exception as exc:
                    debug(f"error spawning notifier for {path}: {exc!r}")
                    if debug_enabled:
                        debug(traceback.format_exc().rstrip())
                    continue

        time.sleep(0.2)


if __name__ == "__main__":
    raise SystemExit(main())

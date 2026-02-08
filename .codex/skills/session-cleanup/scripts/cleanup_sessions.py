#!/usr/bin/env python3
import argparse
import datetime
import json
import subprocess
from typing import Iterable, List, Dict, Any, Tuple

BOILERPLATE_MARKERS = [
    "<environment_context>",
    "</environment_context>",
    "# AGENTS.md instructions",
    "<INSTRUCTIONS>",
    "Global Agent Instructions",
    "project-doc",
    "Skills",
    "How to use skills",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Archive old, low-signal Session Harbor sessions.")
    parser.add_argument("--source", default="codex", help="Session source (default: codex)")
    parser.add_argument("--min-age-days", type=int, default=1, help="Minimum age in days (default: 1)")
    parser.add_argument("--cutoff-date", help="Explicit cutoff date (UTC) in YYYY-MM-DD format")
    parser.add_argument("--max-user-messages", type=int, default=1, help="Max non-boilerplate user messages")
    parser.add_argument("--max-total-messages", type=int, default=None, help="Max total messages (uses session messageCount)")
    parser.add_argument("--include-archived", action="store_true", help="Include already archived sessions")
    parser.add_argument("--apply", action="store_true", help="Actually archive sessions (default: dry-run)")
    parser.add_argument("--limit", type=int, default=200, help="Page size for session-list")
    parser.add_argument("--sample", type=int, default=10, help="How many IDs to print in dry-run")
    return parser.parse_args()


def to_utc(dt: datetime.datetime) -> datetime.datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=datetime.timezone.utc)
    return dt.astimezone(datetime.timezone.utc)


def parse_iso(ts: str) -> datetime.datetime:
    return datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))


def is_boilerplate(text: str) -> bool:
    if text is None:
        return True
    t = text.strip()
    if t == "" or t == ".":
        return True
    for marker in BOILERPLATE_MARKERS:
        if marker in t:
            return True
    return False


def parse_messages(content: Any) -> List[Dict[str, Any]]:
    if content is None:
        return []
    if isinstance(content, list):
        return [m for m in content if isinstance(m, dict)]
    if isinstance(content, str):
        msgs = []
        for line in content.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(obj, dict):
                msgs.append(obj)
        return msgs
    return []


def count_user_messages(messages: Iterable[Dict[str, Any]]) -> int:
    count = 0
    for msg in messages:
        if msg.get("role") != "user":
            continue
        text = msg.get("text")
        if text is None:
            text = msg.get("content")
        if text is None:
            continue
        if not is_boilerplate(text):
            count += 1
    return count


def has_meaningful_text(messages: Iterable[Dict[str, Any]]) -> bool:
    for msg in messages:
        role = msg.get("role")
        if role not in ("user", "assistant"):
            continue
        text = msg.get("text")
        if text is None:
            text = msg.get("content")
        if text is None:
            continue
        if not is_boilerplate(text) and len(text.strip()) >= 5:
            return True
    return False


def list_sessions(limit: int, include_archived: bool, source: str) -> List[Dict[str, Any]]:
    offset = 0
    sessions: List[Dict[str, Any]] = []
    total = None
    while total is None or len(sessions) < total:
        cmd = [
            "session-harbor",
            "session-list",
            f"limit={limit}",
            f"offset={offset}",
            f"includeArchived={'true' if include_archived else 'false'}",
            f"source={source}",
        ]
        raw = subprocess.check_output(cmd)
        data = json.loads(raw)
        total = data.get("total", len(data.get("sessions", [])))
        sessions.extend(data.get("sessions", []))
        offset += limit
    return sessions


def show_session(session_id: str) -> Dict[str, Any]:
    raw = subprocess.check_output([
        "session-harbor",
        "session-show",
        f"sessionId={session_id}",
        "includeMessages=true",
    ])
    return json.loads(raw)


def archive_session(session_id: str) -> None:
    subprocess.check_output([
        "session-harbor",
        "session-status",
        f"sessionId={session_id}",
        "status=archived",
    ])


def main() -> None:
    args = parse_args()
    now = datetime.datetime.now(datetime.timezone.utc)

    if args.cutoff_date:
        cutoff = datetime.datetime.strptime(args.cutoff_date, "%Y-%m-%d").replace(tzinfo=datetime.timezone.utc)
    else:
        cutoff = now - datetime.timedelta(days=args.min_age_days)

    sessions = list_sessions(args.limit, args.include_archived, args.source)

    candidates: List[Tuple[Dict[str, Any], int, bool]] = []

    for s in sessions:
        ts = parse_iso(s["timestamp"])
        if ts >= cutoff:
            continue
        if args.max_total_messages is not None:
            if s.get("messageCount", 0) > args.max_total_messages:
                continue
        data = show_session(s["id"])
        messages = parse_messages(data.get("content"))
        user_count = count_user_messages(messages)
        meaningful = has_meaningful_text(messages)
        has_meta = bool(s.get("name")) or bool(s.get("tags")) or bool(s.get("notes"))

        if user_count <= args.max_user_messages and not meaningful and not has_meta:
            candidates.append((s, user_count, meaningful))

    archived = 0
    if args.apply:
        for s, _, _ in candidates:
            archive_session(s["id"])
            archived += 1

    kept = len(candidates) - archived if args.apply else 0

    result = {
        "cutoff": cutoff.isoformat(),
        "candidates": len(candidates),
        "archived": archived,
        "kept": kept,
        "dry_run": not args.apply,
    }
    print(json.dumps(result, indent=2))

    if not args.apply and candidates:
        sample_ids = [s["id"] for s, _, _ in candidates[: args.sample]]
        print("SAMPLE_IDS=" + ",".join(sample_ids))


if __name__ == "__main__":
    main()

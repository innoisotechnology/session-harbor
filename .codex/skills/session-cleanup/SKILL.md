---
name: session-cleanup
description: Clean up Session Harbor sessions by age and low user-message count. Use when you need to review/auto-archive short or low-signal sessions (e.g., 0–2 user messages) from days ago, using the local session-harbor CLI and the bundled cleanup script.
---

# Session Cleanup

## Overview

Use this skill to identify and archive old, low-signal sessions based on user-message count and age, while keeping any session with meaningful content or metadata.

## Workflow

1. Decide the cutoff (days ago or explicit date) and user-message threshold.
2. Run the cleanup script in dry-run mode to review candidates.
3. Re-run with `--apply` to archive sessions that are still low-signal.

## Heuristics

Treat a session as low-signal if ALL are true:
- `user_message_count <= max_user_messages` (after removing boilerplate)
- Session is older than the cutoff date
- No `name`, `tags`, or `notes`
- No meaningful user/assistant text (beyond boilerplate)

Boilerplate includes: AGENTS.md instructions, environment context blocks, empty strings, and single "." messages.

## Quick Start

Dry-run for sessions older than 1 day with at most 1 user message:

```bash
python3 /Users/innoiso/.codex/skills/session-cleanup/scripts/cleanup_sessions.py --min-age-days 1 --max-user-messages 1
```

Apply archiving with the same filters:

```bash
python3 /Users/innoiso/.codex/skills/session-cleanup/scripts/cleanup_sessions.py --min-age-days 1 --max-user-messages 1 --apply
```

Target an explicit cutoff date (UTC):

```bash
python3 /Users/innoiso/.codex/skills/session-cleanup/scripts/cleanup_sessions.py --cutoff-date 2026-01-24 --max-user-messages 2
```

## Output

The script prints:
- total candidates
- kept vs archived
- sample IDs for review (in dry-run)

## Resources

### scripts/
- `cleanup_sessions.py`: paginate sessions, count user messages, detect boilerplate, and archive eligible sessions.

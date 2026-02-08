---
name: session-harbor-cli
description: "Operate Session Harbor from the command line using the session-harbor CLI. Use when the user asks to list/search sessions, show session details, rename sessions, update tags/notes, or change status (archive/complete/reopen) across Codex/Claude/Copilot sources."
---

# Session Harbor CLI

## Overview
Use the `session-harbor` CLI to query and manage Session Harbor sessions locally. Commands accept `key=value` pairs or JSON via `--json` / stdin and return JSON output.

## Quick Start

```bash
session-harbor session-list limit=20
session-harbor session-search query="mcp" mode=messages
session-harbor session-show source=codex sessionId=... includeMessages=true
session-harbor session-rename source=codex sessionId=... name="Fix CLI packaging"
session-harbor session-status source=codex sessionId=... status=archived
session-harbor session-update source=codex sessionId=... tags="cli,packaging" notes="Bundled CLI"
```

## Command Map

- `session-list` — list sessions with optional filters (`source`, `status`, `project`, `limit`, `offset`, `search`, `includeArchived`)
- `session-search` — search metadata or messages (`query`, `mode=meta|messages`, `project`, `includeArchived`)
- `session-show` — show a session record and optionally messages (`sessionId` or `relPath`, `includeMessages`, `limit`)
- `session-rename` — set/clear session name (`name`, `sessionId` or `relPath`)
- `session-update` — update tags/notes (`tags`, `notes`, `sessionId` or `relPath`)
- `session-status` — set status (`status=active|complete|archived`, `sessionId` or `relPath`)
- `session-archive` / `session-unarchive` — convenience wrappers
- `session-complete` / `session-reopen` — convenience wrappers

## Inputs & Conventions

- **source**: `codex` (default), `claude`, `copilot`
- **session targeting**: use `sessionId` or `relPath` (omitting both targets the most recent session)
- **JSON input**: `--json '{"source":"codex","sessionId":"..."}'`
- **Debug**: add `debug=true` to print resolved input to stderr

## Examples

Search messages in Claude sessions for “token”:

```bash
session-harbor session-search source=claude query="token" mode=messages
```

Archive by relPath:

```bash
session-harbor session-archive source=codex relPath="2026/01/24/rollout-...jsonl"
```

Batchable JSON usage:

```bash
session-harbor session-update --json '{"source":"codex","sessionId":"...","tags":["cli","release"],"notes":"Shipped"}'
```

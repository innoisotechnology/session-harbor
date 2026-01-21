# Claude Usage Check Spec

## Goal
Add Claude usage/limits to Session Harbor status UI. The UI should show:
- Model
- Account (email + tier)
- Limits (5h limit + weekly limit) with remaining % and reset time

## What We Know
- Claude CLI supports a `/usage` slash command in interactive sessions.
- `claude -p "/usage" --output-format json` returns:
  - `Unknown skill: usage` (non-interactive); see sample output below.
- Local Claude state file `~/.claude.json` includes account info and service tier:
  - `oauthAccount.email`, `oauthAccount.organization`, `user.email`, `developerRole`, etc.
- Debug logs exist under `~/.claude/debug/` and include entries like:
  - `UserCommandMessage rendering: "usage" (args: "none")`
- No obvious limits cache exists in `~/.claude` files searched so far.

Sample CLI output (non-interactive):
```
claude -p "/usage" --output-format json
{"type":"result","subtype":"success","is_error":false,"duration_ms":29,"duration_api_ms":0,"num_turns":1,"result":"Unknown skill: usage","session_id":"7e5a3c69-06c6-4fc7-a15a-1f8436498e2a","total_cost_usd":0,"usage":{"input_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":0,"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":"standard","cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":0}},"modelUsage":{},"permission_denials":[],"uuid":"dae51d0d-ce23-4c11-84ce-881cd8515115"}
```

## What We Tried
- Searched `~/dev/random/claude-code` (docs-only repo) for `/usage` implementation; no CLI logic exists there.
- Searched `~/.claude` for limits cache or usage data; none found.
- Attempted `claude -p "/usage" --output-format json` to scrape usage; returns `Unknown skill: usage`.
- Scanned `~/.claude/debug` logs; found the `UserCommandMessage` line but no limits data yet.

## Current Status (Implementation)
- `/api/claude/status` returns:
  - `model` and `cliVersion` from Claude session JSONL
  - `account.tier` from `usage.service_tier`
  - `rateLimits` set to `null` (UI shows “Limits not available”)

## Open Questions
- Where does interactive `/usage` pull its data from?
  - Is it an internal API call logged in `~/.claude/debug/*`?
  - Is it embedded in a local cache or telemetry file?

## Next Steps
1. Identify the log file for the latest session where `/usage` was run.
2. Search that log for:
   - HTTP request/response payloads
   - JSON keys like `rate_limits`, `limits`, `usage`, `resets`, `credits`
3. If found, implement a parser to extract limits and expose them via `/api/claude/status`.
4. Update UI status card to render Claude limits using the same structure as Codex.

## Notes
- Desired output should mirror Codex UI (5h limit + weekly limit with percent remaining and reset time).
- We should not rely on interactive-only features; prefer a log or local cache that can be read from disk.

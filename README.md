# Session Harbor

Session Harbor is a local dashboard for docking, scanning, and relaunching Codex and Claude sessions. It turns raw `.jsonl` logs into a searchable archive, lets you label sessions, and gives you quick jump controls for active work.

## Run

```sh
cd /Users/innoiso/dev/random/session-harbor
npm start
```

Then open `http://localhost:3434`.

## What it does

- Browse Codex sessions from `~/.codex/sessions`.
- Browse Claude sessions from `~/.claude/projects`.
- View Codex `/status`-style account and rate-limit info (uses the same backend usage API).
- Filter by project, search by path/id/name, and rename sessions.
- Open Terminal tabs to rejoin or focus a running Codex session.
- Start new Codex or Claude sessions from a project.
- Optionally name a session before launching; the next matching session log will inherit it.
- Archive sessions to move logs into an `Archive/` folder instead of deleting them.

## Notes

- The server reads session metadata from the first line of each `.jsonl` file.
- Use the search box to filter by project (cwd), filename, session id, or path.
- Use the toggle to switch between Codex (`~/.codex/sessions`) and Claude (`~/.claude/projects`) sessions.
- Session names are stored locally in `session-harbor/data/session-names.json`.
- Use the Projects list to filter sessions and start new Codex/Claude sessions in a project.

## Session review CLI

Generate a heuristic report from your session history (success/fail labels, tags, and critical turns).

```sh
npm run review:sessions -- --source both --limit 100
```

Reports are written to `reports/session-review-<timestamp>/summary.md` and `sessions.json`.

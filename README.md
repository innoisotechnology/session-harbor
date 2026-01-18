# Codex Session Browser

A tiny local web app to browse Codex CLI sessions stored in `~/.codex/sessions`.

## Run

```sh
cd /Users/innoiso/dev/random/session-harbor
npm start
```

Then open `http://localhost:3434`.

## Notes

- The server reads session metadata from the first line of each `.jsonl` file.
- Use the search box to filter by project (cwd), filename, session id, or path.
- Use the toggle to switch between Codex (`~/.codex/sessions`) and Claude (`~/.claude/projects`) sessions.
- Session names are stored locally in `session-harbor/data/session-names.json`.
- Use the Projects list to filter sessions and start new Codex/Claude sessions in a project.

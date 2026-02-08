# Session Harbor CLI

Local CLI for managing Session Harbor sessions.

## Usage

```bash
session-harbor <command> [key=value] [--json "{...}"] [--input "{...}"]
```

Examples:

```bash
session-harbor session-list source=codex limit=20
session-harbor session-search source=codex query="tooling" mode=messages
session-harbor session-rename source=codex sessionId=abc123 name="CLI investigation"
session-harbor session-status source=codex sessionId=abc123 status=archived
session-harbor session-update source=codex sessionId=abc123 tags="cli,research" notes="Reviewed Wagon Wheel"
session-harbor session-complete source=codex
```

## Notes
- `source` defaults to `codex` when omitted.
- If `sessionId` and `relPath` are omitted, single-session commands target the most recent session for that source.
- Use `debug=true` to print resolved input.
- Set `SESSION_HARBOR_DATA_DIR` to override where metadata files are stored.

## Shell Completion

Generate a completion script and source it in your shell (also works with `--completion`).

```bash
# Zsh (macOS default)
session-harbor completion zsh > ~/.zsh/completions/_session-harbor

# Bash
session-harbor completion bash > ~/.session-harbor-completion.bash
```

Then source the file in your shell startup:

```bash
# Zsh
fpath=(~/.zsh/completions $fpath)
autoload -Uz compinit && compinit

# Bash
source ~/.session-harbor-completion.bash
```
```

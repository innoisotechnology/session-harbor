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
```

## Notes
- `source` defaults to `codex` when omitted.
- Use `debug=true` to print resolved input.
- Set `SESSION_HARBOR_DATA_DIR` to override where metadata files are stored.
```

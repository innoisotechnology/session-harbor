#!/usr/bin/env bash
set -euo pipefail

payload="${1:-}"
log_file="${CODEX_NOTIFY_LOG_FILE:-$HOME/.codex/notify.log}"
log_dir=$(dirname "$log_file")
mkdir -p "$log_dir"

message=$(python3 - <<'PY' "$payload"
import json, sys
raw = sys.argv[1] if len(sys.argv) > 1 else ""
if not raw:
    print("Codex task complete")
    raise SystemExit
try:
    data = json.loads(raw)
    kind = data.get("type") or "Codex"
    last = data.get("last_assistant_message") or data.get("last-assistant-message")
    if last:
        summary = " ".join(str(last).split())
        if len(summary) > 140:
            summary = summary[:137] + "..."
        print(f"{kind}: {summary}")
    else:
        print(f"{kind} task complete")
except Exception:
    print(raw)
PY
)

python3 - <<'PY' "$payload" "$message" "$log_file"
import json, sys, datetime
raw = sys.argv[1] if len(sys.argv) > 1 else ""
message = sys.argv[2] if len(sys.argv) > 2 else ""
log_file = sys.argv[3]

ts = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
try:
    payload = json.loads(raw) if raw else None
except Exception:
    payload = raw

entry = {
    "ts": ts,
    "message": message,
    "payload": payload,
}

with open(log_file, "a", encoding="utf-8") as f:
    f.write(json.dumps(entry, ensure_ascii=True) + "\n")
PY

/opt/homebrew/bin/terminal-notifier -title "Codex CLI" -message "$message"

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
tts_script="$script_dir/codex-notify-tts.sh"
if [[ -x "$tts_script" ]]; then
  "$tts_script" "$payload" >/tmp/codex-notify-tts.log 2>&1 || true
fi

#!/usr/bin/env bash
set -euo pipefail

payload="${1:-}"
if [[ -z "$payload" ]]; then
  exit 0
fi

# Base dir selection:
# - Prefer explicit override via CODEX_TTS_BASE_DIR
# - Else, prefer "cwd" embedded in the notification payload (Codex provides this)
# - Else, fall back to current working directory
base_dir=$(python3 - <<'PY' "$payload"
import json, os, sys
raw = sys.argv[1] if len(sys.argv) > 1 else ""
override = os.environ.get("CODEX_TTS_BASE_DIR")
if override:
    print(override)
    raise SystemExit
try:
    data = json.loads(raw) if raw else {}
except Exception:
    data = {}
cwd = data.get("cwd")
if isinstance(cwd, str) and cwd.strip():
    print(cwd.strip())
else:
    print(os.getcwd())
PY
)

env_file="${CODEX_TTS_ENV_PATH:-$base_dir/.env}"

CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
TTS_GEN="$CODEX_HOME/skills/speech/scripts/text_to_speech.py"
if [[ ! -f "$TTS_GEN" ]]; then
  exit 0
fi

text=$(python3 - <<'PY' "$payload"
import json, re, sys
raw = sys.argv[1] if len(sys.argv) > 1 else ""
if not raw:
    sys.exit(0)
try:
    data = json.loads(raw)
except Exception:
    sys.exit(0)
msg = data.get("last_assistant_message") or data.get("last-assistant-message") or ""
if not msg:
    sys.exit(0)
msg = str(msg)
msg = re.sub(r"```.*?```", "", msg, flags=re.S)
msg = " ".join(msg.split())
if len(msg) > 4000:
    msg = msg[:3997] + "..."
print(msg)
PY
)

if [[ -z "$text" ]]; then
  exit 0
fi

notify_log="${CODEX_TTS_NOTIFY_LOG_FILE:-/tmp/codex-notify-tts.log}"

if [[ "${CODEX_TTS_DRY_RUN:-}" == "1" ]]; then
  echo "DRY RUN: $text" >> "$notify_log"
  exit 0
fi

if [[ -f "$env_file" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
fi

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "ERROR: OPENAI_API_KEY is not set. Looked for env file: $env_file. Set OPENAI_API_KEY or set CODEX_TTS_ENV_PATH." >> "$notify_log"
  echo "ERROR: OPENAI_API_KEY is not set. Looked for env file: $env_file. Set OPENAI_API_KEY or set CODEX_TTS_ENV_PATH." >&2
  exit 1
fi

out_dir="${CODEX_TTS_OUT_DIR:-$base_dir/output/speech}"
mkdir -p "$out_dir"
timestamp=$(python3 - <<'PY'
import datetime
dt = datetime.datetime.now().astimezone()
ms = dt.microsecond // 1000
print(dt.strftime("%Y%m%d_%H%M%S_") + f"{ms:03d}")
PY
)
out_file="$out_dir/codex_notify_${timestamp}_$$.mp3"

python3 "$TTS_GEN" speak \
  --input "$text" \
  --voice cedar \
  --instructions "Voice Affect: Warm and composed. Tone: Neutral and clear. Pacing: Steady." \
  --response-format mp3 \
  --out "$out_file"

# Leave a breadcrumb even when using afplay, so it's obvious what player mode is active.
echo "INFO: generated $out_file (player=${CODEX_TTS_PLAYER:-afplay})" >> "$notify_log"

# Playback:
# - default: afplay (quick, no library import)
# - optional: Music app (may import into library depending on user settings)
player="${CODEX_TTS_PLAYER:-afplay}"
if [[ "$player" == "music" ]]; then
  echo "INFO: attempting Music playback: $out_file" >> "$notify_log"
  # Note: This requires Terminal (or whatever is running the watcher) to be allowed
  # under System Settings -> Privacy & Security -> Automation (control Music).
  # Keep the user's focus: launch/play in Music, then re-activate the previously frontmost app.
  music_err="$(/usr/bin/osascript <<APPLESCRIPT 2>&1
tell application "System Events"
  set frontApp to name of first application process whose frontmost is true
end tell

tell application "Music"
  if it is not running then
    launch
  end if
  set t to add (POSIX file "$out_file")
  play t
end tell

if frontApp is not "Music" then
  tell application frontApp to activate
end if
APPLESCRIPT
)" || true
  if [[ -n "${music_err:-}" ]]; then
    echo "ERROR: Music playback failed: $music_err" >> "$notify_log"
    exit 1
  fi
elif [[ "$player" == "afplay" ]]; then
  if command -v afplay >/dev/null 2>&1; then
    afplay "$out_file" >/dev/null 2>&1 &
  fi
fi

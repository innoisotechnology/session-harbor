#!/usr/bin/env python3
import json
import os
import subprocess
import time

def latest_session_file(codex_home: str) -> str:
    candidates = []
    for root, _, files in os.walk(os.path.join(codex_home, "sessions")):
        for name in files:
            if name.endswith(".jsonl"):
                path = os.path.join(root, name)
                candidates.append(path)
    if not candidates:
        raise SystemExit("No session files found")
    return max(candidates, key=os.path.getmtime)


def main() -> int:
    codex_home = os.environ.get("CODEX_HOME", os.path.expanduser("~/.codex"))
    session_file = latest_session_file(codex_home)
    watcher = os.path.join(os.path.dirname(__file__), "codex-session-watch-tts.py")
    if not os.path.isfile(watcher):
        raise SystemExit("Watcher script not found")

    env = os.environ.copy()
    env["CODEX_TTS_DRY_RUN"] = "1"
    env["CODEX_TTS_DEBUG"] = "1"

    proc = subprocess.Popen(["python3", watcher], env=env)
    time.sleep(0.5)

    msg = f"Watcher test at {time.strftime('%H:%M:%S')}"
    line = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "type": "response_item",
        "payload": {
            "type": "message",
            "role": "assistant",
            "content": [{"type": "output_text", "text": msg}],
        },
    }
    with open(session_file, "a", encoding="utf-8") as f:
        f.write(json.dumps(line, ensure_ascii=True) + "\n")

    time.sleep(1.0)
    proc.terminate()
    try:
        proc.wait(timeout=2)
    except Exception:
        proc.kill()

    log_file = "/tmp/codex-notify-tts.log"
    if not os.path.isfile(log_file):
        print("FAIL: /tmp/codex-notify-tts.log not found")
        return 1

    with open(log_file, "r", encoding="utf-8") as f:
        data = f.read()

    if msg in data:
        print("PASS: watcher detected assistant message")
        return 0

    print("FAIL: watcher did not detect assistant message")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

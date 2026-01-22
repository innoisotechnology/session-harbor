# Session Harbor

A local dashboard for managing AI coding session logs. Dock, scan, and relaunch sessions from **Codex**, **Claude**, and **Copilot**.

```
┌─────────────────────────────────────────────────────────────────┐
│  Session Harbor                           Codex │ Claude │ Copilot  │
├────────────────────┬────────────────────────────────────────────┤
│  PROJECTS          │  DETAILS                                   │
│  ───────────────── │  ────────────────────────────────────────  │
│  > session-harbor  │  FILE        PROJECT      TIME     MSGS    │
│    my-api          │  abc123.json .../harbor   Jan 21   142     │
│    web-app         │                                            │
│                    │  ┌─ Messages ─────────────────────────┐   │
│  SESSIONS (12)     │  │ USER   08:42                       │   │
│  ───────────────── │  │ Add dark mode toggle               │   │
│  ■ implement-auth  │  │                                    │   │
│    fix-routing     │  │ ASSISTANT   08:42                  │   │
│    add-tests       │  │ I'll add a dark mode toggle...     │   │
│                    │  └────────────────────────────────────┘   │
└────────────────────┴────────────────────────────────────────────┘
```

## Quick Start

```sh
npm start
```

Open [localhost:3434](http://localhost:3434)

## Features

| Feature | Description |
|---------|-------------|
| **Multi-source** | Browse sessions from Codex, Claude, and Copilot |
| **Search** | Filter by project, path, ID, or filename |
| **Labels** | Name and organize sessions with custom labels |
| **Archive** | Move old sessions to `Archive/` folder |
| **Rejoin/Focus** | Jump back into active Codex sessions |
| **Reports** | Generate analysis reports from session history |
| **Feedback** | Track what went well and needs improvement |

## Session Sources

| Source | Path | Status API |
|--------|------|------------|
| Codex | `~/.codex/sessions` | `/api/status` |
| Claude | `~/.claude/projects` | `/api/claude/status` |
| Copilot | `~/.copilot/session-state` | `/api/copilot/status` |

## CLI Commands

```sh
# Start the server
npm start

# Generate session analysis report
npm run review:sessions -- --source both --limit 100

# Log feedback for a session
npm run feedback:log
```

## API Endpoints

### Sessions
```
GET  /api/sessions              # List Codex sessions
GET  /api/claude/sessions       # List Claude sessions
GET  /api/copilot/sessions      # List Copilot sessions
GET  /api/session?file=<path>   # Get session detail
GET  /api/projects?source=<src> # List projects
GET  /api/search?query=<q>      # Search sessions
```

### Actions
```
POST /api/name                  # Save session label
POST /api/name-by-id            # Save session label by sessionId
POST /api/archive-session       # Archive session
POST /api/archive-by-id         # Archive session by sessionId
POST /api/new-session           # Start new session
POST /api/complete-session      # Mark session complete
POST /api/complete-by-id        # Mark session complete by sessionId
GET  /api/resume?sessionId=<id> # Rejoin session
GET  /api/focus?sessionId=<id>  # Focus session
```

### Reports & Feedback
```
GET  /api/reports               # List reports
GET  /api/report?name=<name>    # Get report detail
GET  /api/feedback-log          # Get feedback entries
```

## Data Storage

```
session-harbor/
├── data/
│   ├── session-names.json    # Custom session labels
│   ├── pending-names.json    # Pending name assignments
│   └── feedback.jsonl        # Feedback log
└── reports/
    └── session-review-*/     # Generated reports
        ├── summary.md
        ├── sessions.json
        └── recommendations.json
```

## Tech Stack

- **Frontend**: Vue 3, TypeScript, Tailwind CSS, Vite
- **Backend**: Node.js HTTP server
- **Data**: File-based (JSONL logs, JSON storage)

## Development

```sh
# Install dependencies
npm install
cd frontend && npm install

# Run in dev mode (hot reload)
npm run dev

# Build for production
cd frontend && npm run build
```

## Desktop App (Electron)

```sh
# Build the frontend + backend and package a macOS app
npm run build:desktop
```

The packaged app is written to `dist-electron/` (DMG + ZIP). On launch, the app runs the backend in-process and serves the bundled frontend.

---

<sub>Session Harbor reads `.jsonl` session logs and provides a unified interface for managing your AI coding sessions.</sub>

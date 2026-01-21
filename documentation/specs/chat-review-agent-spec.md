# Automated Chat Review + Codebase Verification Agent

## Meta
- Owner:
- Date: 2026-01-21
- Tier: 2
- Status: Draft

## Problem
We need an automated agent that reviews AI chat sessions, identifies the original goal(s), evaluates whether each goal was achieved in the conversation, and then validates in the codebase whether the corresponding feature/bugfix was actually implemented. A single chat may contain multiple tasks that must be individually assessed and verified.

## Goals / Non-Goals
Goals
- Parse chat sessions and segment them into discrete tasks with an explicit “original goal” per task.
- Determine outcome per task from conversation signals (achieved/partial/failed/unknown).
- Verify codebase changes for each task using repo diffs, file presence, tests, and build status.
- Produce a structured report with evidence snippets and verification findings.

Non-Goals
- Automatically merge or deploy changes.
- Human-in-the-loop approvals (optional later).
- Deep semantic reasoning about correctness beyond static checks and test results.

## Hard Requirements
- [ ] Must support multiple tasks per chat session with separate outcomes.
- [ ] Must store evidence snippets for goal extraction and outcome determination.
- [ ] Must verify implementation against the repo state (files, diffs, tests).
- [ ] Must be able to run in a read-only mode (analysis without mutating code).
- [ ] Must output machine-readable JSON + human-readable markdown summaries.
- [ ] Must be source-agnostic across Codex/Claude/Copilot session formats.

## Proposed Solution
Build a “Chat Review Agent” pipeline with three stages:

1) Task extraction
- Normalize session logs into a common schema (turns, tools, files touched, commands run).
- Segment into tasks using rule-based cues (user asks, assistant confirmations, goal changes).
- For each task: capture “original goal” (first user instruction), constraints, and intent.

2) Outcome classification
- Classify each task as achieved/partial/failed/unknown.
- Use heuristic signals (user confirmations, errors, retries, unresolved questions).
- Optional LLM-judge pass to resolve ambiguous outcomes.

3) Codebase verification
- Map task to repo(s) and files (from tool usage, git diff, session cwd).
- Check:
  - Git diff present for expected files.
  - Relevant files exist/modified.
  - Tests/build results (if run in session or can be re-run).
  - For new features, presence of UI/API endpoints or config changes.
- Emit a verification verdict: implemented / partial / not implemented / unknown.

Outputs:
- `reports/<run-id>/tasks.json` (structured task-level data)
- `reports/<run-id>/summary.md` (human summary with evidence)
- Optional `reports/<run-id>/verification.json` (code verification details)

## Alternatives Considered
- Pure LLM-judge without repo checks (rejected: too many false positives).
- Only repo diffs without chat analysis (rejected: cannot map intent/outcome).

## Data & Interfaces
- Data model changes:
  - New `task` entity with fields: `session_id`, `task_id`, `goal`, `constraints`, `outcome`, `outcome_evidence[]`, `repo_verdict`, `repo_evidence[]`.
- API/contracts:
  - CLI entry: `review:chats --source <codex|claude|copilot|all> --limit N --verify`
  - Output schema for `tasks.json` and `verification.json`.
- Migrations:
  - None required unless stored in DB later.

## UX / Behavior
- Primary flow:
  1) Run CLI review over sessions.
  2) Receive report summary and task-level JSON.
  3) Optional flags to re-run verification or only analyze chat.
- Edge cases:
  - Multi-repo sessions: map by cwd changes, tool paths.
  - Missing tool logs: infer from file diffs or session cwd.
  - Long sessions with repeated/overlapping tasks.
- Errors:
  - Repo missing or inaccessible -> mark verification as `unknown` with reason.
  - Tests fail -> mark `partial` or `failed` depending on scope.

## Rollout & Risks
- Flags:
  - `--verify` to enable repo verification.
  - `--llm-judge` optional LLM-based classification.
- Backwards compatibility:
  - No changes to existing session storage formats.
- Risks:
  - Misclassification of goals or outcomes due to ambiguous user messages.
  - False positives if repo changes are unrelated to the task.
  - Performance on large session sets.

## Testing & Verification
- Unit tests for:
  - Task segmentation from sample sessions.
  - Outcome classification rules.
  - Repo mapping heuristics.
- Integration tests with sample repos + synthetic sessions.
- Manual spot checks on 5-10 real sessions.

## Open Questions
- Which signals should determine “goal achieved” vs “partial”?
- Should verification require tests to pass, or only detect code changes?
- How do we handle tasks that are non-code (planning, research)?
- Should we store results in Session Harbor UI or only as reports?

## Sign-off
- Approved by:
- Date:
- Notes:

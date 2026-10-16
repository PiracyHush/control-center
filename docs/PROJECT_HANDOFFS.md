# Project handoffs and tasks

## Automatic session export and local pickup

Proof of Work and MetaMarket now have root AGENTS.md instructions (also referenced by CLAUDE.md). Agents should write `.agent-handoff/session.json` with summary, status, completed/evidence/decisions arrays, and stable proposed action IDs, then automatically run `node scripts/export-handoff.mjs --input=.agent-handoff/session.json` before finishing a work session. Node 24.19+ is required; no Python package or paid AI API is involved. The per-repo wrapper reads `.agent-handoff/config.json`, whose projectId and absolute shared exporter path are local and ignored by Git. The shared exporter lives at `control-center/scripts/export-handoff.mjs`; keep that checkout available or update the configured exporter path if you move it.

Outputs are `.agent-handoff/latest.json` and `.agent-handoff/latest.md`, plus per-session JSON/Markdown files under `.agent-handoff/reports/`. Report IDs, timestamps, repo root and current commit are attached by the exporter; explanations and actual test results come from the agent. Export does not commit anything or collect private logs. The JSON is published via a temporary file and rename, so pickup doesn't read half-written reports.

Control Center reads `handoff-sources.json` from its active data directory:

```json
{"sources":[{"projectId":"copy-existing-dashboard-project-id","repository":"C:/absolute/path/to/repository"}]}
```

Only configured local folders are read; report-supplied repository paths are never followed. Updates checks them on load and every 15 seconds while the page is open and visible; **Check for new reports** refreshes immediately. This is not an always-running background service. It imports reports only, never tasks. Click **Review actions** on an imported report to accept tasks. The Tasks and Updates project filters remain separate.

The pickup checks up to 100 recent JSON files per repository, catches sessions exported while the dashboard was closed, and retains imported history in SQLite. It reports malformed/conflicting files, rejects project mismatches and linked report folders, and shows missing or stale (over seven days old) reports explicitly. If a folder exceeds the limits, move older already-imported files outside the watched folder; do not silently assume every file was read.

Repo instructions are not guaranteed crash hooks. A stopped or crashed agent may not export. An old report is evidence of the last export, not proof of the current checkout's state. Start a new agent session to load the new instructions, or point an already-running agent to AGENTS.md once. No existing agent chats are messaged automatically.

## Manual import (still available)

Configure projects in Settings → Projects. Open Updates and download a template for the project you want its agent to report on. Give the agent the JSON template and this instruction:

> Fill the project handoff JSON using work you actually completed. Keep the supplied projectId. Use a new report ID for each session and stable action IDs for continuing work. Record the repository and commit, completed work, actual verification results, unresolved decisions, and proposed next actions. Do not invent deadlines or claim unrun tests passed. Write a readable Markdown handoff beside the JSON. Leave secrets, OAuth tokens, private emails, and credentials out of both files.

Import the JSON in Updates. Review the summary and evidence. Select the actions you want to accept and edit their title, priority, or deadline. Saving with zero selected actions records progress without adding tasks. Markdown is for the human reader; the app imports JSON only, without an AI call.

Updates and Tasks each have their own project selector. Tasks also offers Unassigned. Existing tasks retain their current state and can be assigned to a project from Tasks. Imported tasks link to the original report.

Report identity is the pair (projectId, id). An existing report ID with different content is rejected: use a new ID for new progress. Task identity is the pair (projectId, action.id). Repeated imports preserve accepted tasks, including completed tasks and your edits. Deleted accepted tasks are not recreated. Skipped actions can be accepted by importing the original file again. An action omitted from a later report stays in the task list.

The app saves reports and acceptance records in local SQLite, alongside the existing workspace, in one transaction. Reports do not expire with the Daily Brief. Removing a configured project leaves its old reports and tasks visible under its ID. The file is text data; the app does not execute instructions, open local repository paths, or fetch repository URLs from it.

Schema example:

```json
{
  "schemaVersion": 1,
  "id": "session-2026-10-13-01",
  "projectId": "copy-the-id-from-the-downloaded-template",
  "generatedAt": "2026-10-13T06:00:00Z",
  "repository": "https://example.com/your-repository",
  "commit": "actual-commit-sha",
  "summary": "Implemented transactional writes; deployment is pending.",
  "status": "awaiting-review",
  "completed": ["Implemented transactional writes"],
  "evidence": ["Ran the regression suite: report actual results here"],
  "decisions": ["Choose the deployment target"],
  "actions": [
    {
      "id": "interrupted-write-regression",
      "title": "Test interrupted writes",
      "description": "Confirm a failed write preserves the previous state.",
      "priority": "High"
    }
  ]
}
```

Status accepts working, blocked, or awaiting-review. Priority accepts Low, Normal, or High. Optional due dates use YYYY-MM-DD. Each report accepts at most 100 actions and each text list accepts at most 100 entries. The import file must be smaller than 500 KB.

# Control Center: project handoff automation

Prepared 2026-10-13. Recheck live state before relying on this snapshot.

## Repository attached to this handoff

- [GitHub repository](https://github.com/PiracyHush/control-center)
- [Local repository README](C:/Users/PiracyH/Downloads/control-center/README.md)
- Checkout: `C:/Users/PiracyH/Downloads/control-center`
- Observed branch: `codex/project-routing`
- Observed HEAD: `28415fad0e7a961728ff01bba3c3e7ef2452970d`
- The implementation described here is in the local working tree, not necessarily on GitHub. This file is context, not permission to commit, publish, or implement every proposed follow-up.

## What the user wants

Track progress from project agents in one dashboard. Keep the project filters for Updates and Tasks separate. Collect reports automatically, but let the user decide which proposed actions become tasks.

Proof of Work and MetaMarket are separate repos. MetaMarket maps to the existing **Market Scout** dashboard project; do not rename it or merge it with Proof of Work.

## What was implemented

1. Updates supports structured JSON handoffs, preview, report history, project filtering, editable proposed actions, and explicit task acceptance. Manual import remains available.
2. Reports and accepted-action identities live in SQLite. The report identity is `(projectId, report.id)`; an action identity is `(projectId, action.id)`. Repeated imports preserve accepted task edits, completions, and deletions. Changed content with an existing report ID is rejected.
3. Agents in the two project repos have AGENTS.md instructions, referenced by CLAUDE.md, to export before ending a work session. They supply the factual narrative; the shared exporter validates it and attaches a unique report ID, current time, repository root, and HEAD.
4. Per-repo wrappers write ignored `.agent-handoff/latest.json`, `latest.md`, and per-session reports. JSON publication uses a temporary file and rename.
5. Updates loads reports from explicitly configured local folders on load and every 15 seconds while open and visible. Automatic pickup imports reports with zero accepted actions. Review actions opens the approval flow without uploading the file again.
6. Pickup validates project IDs, bounds file sizes and scanning, rejects linked report directories, and exposes missing/stale/error states. Stale means over seven days old, not proof of the current checkout state.

There is no always-running background watcher, guaranteed crash hook, automatic agent messaging, or automatic task approval. Instructions can be missed when an agent crashes; an already-running chat must read the new instructions once. Worktrees and relocated checkouts need their own local configuration.

## Where things live

| Responsibility | File |
|---|---|
| JSON schema and task filtering | `lib/project-handoffs.ts` |
| Transactional reports and acceptance ledger | `lib/project-handoff-store.ts` |
| Bounded local file reads and automatic pickup | `lib/handoff-files.ts` |
| Local handoff endpoint | `app/api/project-handoffs/route.ts` |
| Updates UI, polling and action review | `components/project-updates.tsx` |
| Navigation, task project selector, workspace save coordination | `components/control-center.tsx` |
| Shared exporter | `scripts/export-handoff.mjs` |
| Database initialization | `lib/server/database.ts` |
| Contract tests | `tests/project-handoffs.test.ts`, `tests/handoff-files.test.ts` |
| Setup and schema documentation | `docs/PROJECT_HANDOFFS.md` |

Active local data directory: `C:/Users/PiracyH/.control-center-data`. Source mappings are in its `handoff-sources.json`; preserve settings, SQLite and credentials. Do not read or print credential-bearing files just to inspect project mappings.

- Proof of Work checkout: `C:/Users/PiracyH/Downloads/personal-proof-of-work`
  - Project ID: `3257bee8-ee95-4bcf-b287-36faa61dca85`
- MetaMarket checkout: `C:/Users/PiracyH/Downloads/MetaMarket`
  - Market Scout project ID: `871e53df-f355-4321-96e9-61173336621b`

## Verification: distinguish completed checks from gaps

- Two full `npm run check` runs passed before the final retained-connection fix: lint, 233 passing tests, one existing skip, and production build.
- After that fix, all seven focused handoff-file tests passed.
- The full post-fix suite passed with 234 passing tests, one existing skip, zero failures. It ran with `NODE_OPTIONS=--max-old-space-size=256` and `node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 tests/*.test.ts` to reduce simultaneous memory use.
- Post-fix full lint passed with `node --max-old-space-size=256 node_modules/eslint/bin/eslint.js`.
- Smoke passed before the final connection fix.
- Isolated browser QA proved automatic pickup, a second export appearing without a refresh click, manual acceptance, no automatic task creation, and no duplicate accepted task. Console error list was empty.
- Both actual repo wrappers exported successfully. The real dashboard confirmed both new reports and two current sources. A task/reminder before-and-after hash check passed during real pickup.
- The dashboard was relaunched in development mode on `http://127.0.0.1:3000`. Health and automatic pickup passed after relaunch. It was deliberately left running; verify current health rather than assuming this process still exists.
- **Remaining gap:** the final post-fix production build compiled successfully, then failed during TypeScript checking with `memory allocation of 16777216 bytes failed`. The machine was low on RAM. Do not call the current code a fully verified production release; rerun the complete check and smoke with sufficient resources.

Detailed local evidence: `.gstack/auto-handoff-qa/VERIFICATION.md`. Screenshot: `.gstack/auto-handoff-qa/automatic-pickup.png`. These are ignored local evidence, not guaranteed to be present in another clone.

## One non-obvious defect already fixed

Development hot reload retained a database connection opened before handoff tables existed. Initialization inside only the first-connection branch left the new route returning 500. `getDatabase()` now also performs idempotent handoff initialization for a retained connection. Do not move it back inside the first-open-only branch without equivalent upgrade behavior.

## Preserve the working tree

Run `git status --short` and inspect diffs before edits. Do not bulk-stage or reset.

Existing unrelated/private files include `AGENT_HANDOFF.md`, `CLAUDE_CODE_HANDOFF.md`, `.claude/`, and generated `next-env.d.ts`. This document does not replace either earlier handoff. Existing handoff-feature files include both tracked modifications and new untracked files. Separate ownership by inspecting actual diffs, not merely by filename. Never commit runtime data, `.env*`, `.agent-handoff/`, `.gstack/`, `graphify-out/`, or private connector content.

Read root AGENTS.md and the relevant local Next documentation before changing framework code. Follow the repository's test and graph-update rules. Do not stop unrelated processes or close user applications to free RAM without permission.

## Recommended next assignment

First, establish current repository and runtime state and report the remaining release-verification gap. If the user authorizes continued implementation, prioritize:

1. Finish post-fix production build and smoke verification with adequate memory, avoiding a competing build in the same checkout.
2. Validate an actual project agent work session: it should export without a reminder, and its claims should match changes and real tests.
3. Label proposed actions as awaiting approval, already accepted, completed, or deleted. Use the acceptance ledger and real task state; do not infer acceptance from titles.
4. Add a separate "repository changed since last handoff" signal if requested. A seven-day age label is not that signal.

Acceptance remains manual. Do not auto-implement these backlog items just because they appear in a handoff.

## Suggested starting prompt

> Work in `C:/Users/PiracyH/Downloads/control-center`. Read AGENTS.md and docs/AGENT_HANDOFF_AUTOMATION.md. Inspect the current Git state and live health without exposing credentials. Summarize what is verified, what changed since this snapshot, and the smallest safe next step. Preserve unrelated edits; do not commit, publish, or change project data without explicit authorization.

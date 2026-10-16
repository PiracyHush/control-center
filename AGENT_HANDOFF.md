# Control Center Agent Handoff

Use this file to resume work without relying on the previous chat. The code repository and this handoff live in the same checkout.

If `CLAUDE_CODE_HANDOFF.md` exists locally, read it after this file. It records the current dashboard configuration, machine-specific tool locations, a separate knowledge base, pending user decisions, and observed defects. It contains private operational details and should remain local unless the user reviews and approves a sanitized version for the public repository.

## Repository attachment

- Local checkout: `C:\Users\PiracyH\Downloads\control-center`
- Fork: `https://github.com/PiracyHush/control-center.git`
- Upstream: `https://github.com/mreflow/control-center.git`
- Active branch: `codex/project-routing`
- Base branch: `main`
- Draft pull request: `https://github.com/PiracyHush/control-center/pull/1`

On 2026-10-16 the branch was pushed with the gstack routing rules, the project-handoff Updates tab, the focus panel, and this refresh of the handoff. Run `git log --oneline origin/codex/project-routing..HEAD` to confirm nothing is unpushed. Draft pull request #1 remains in draft; its description predates the last four commits, so verify it before relying on it.

Do not push, merge, publish, or change the draft status without a direct user request. `git push` works through the Windows credential manager. The GitHub CLI's saved token was reported invalid on 2026-10-16, so `gh` commands such as editing the pull request need `gh auth login` first.

## Product in one paragraph

Control Center is a local-first Next.js dashboard for industry updates, strict brand mentions, newsletter intelligence, audience tracking, daily briefs, reminders, and tasks. A fresh install contains no personal data. Users configure sources, identities, projects, and optional AI providers in Settings. The server binds to loopback, stores durable data locally, keeps secrets server-side, and fails closed when canonical local state cannot be read safely.

Current package version: `0.3.1`.

## Work completed on this branch

### 1. Runtime dependency updates

Commit: `28da9bb chore: update vulnerable runtime dependencies`

The branch updated vulnerable runtime dependencies before adding the feature work. Review `package.json` and `package-lock.json` before changing dependency versions again.

### 2. Deterministic project routing

Commit: `e64b21b feat: add deterministic project routing`

Users can configure up to eight projects in **Settings → Projects**. Each project supports a name and up to twelve matching phrases. The matcher:

- normalizes Unicode with NFKC;
- compares text without case sensitivity;
- matches whole words and phrases rather than partial words;
- uses visible story fields and grounded explanation fields;
- preserves configured project order;
- lets one story match several projects;
- performs no network or model call.

The feature labels matching Industry and Mention cards. Settings cleaning, persistence, migration behavior, UI configuration, styles, documentation, and focused tests were included.

Primary files:

- `lib/project-routing.ts`
- `lib/types.ts`
- `lib/server/settings.ts`
- `components/control-center.tsx`
- `tests/project-routing.test.ts`
- `README.md`

### 3. Project filters

Commit: `35c70bc feat: filter stories by project`

Industry and Mentions now have an **All projects** selector. The label and filter paths call the same matcher so they cannot disagree about a story's project. Empty-filter states tell the user to choose another project or return to All projects.

The filter only changes what the current page displays. It does not change collection, importance ranking, identity verification, AI prompts, saved stories, or archive state.

### 4. Agent workflow integration

Commit: `af9a0e3 chore: integrate agent workflow tooling`

The repository now contains compact agent rules and a detailed tool workflow:

- `AGENTS.md` tells agents when to use Graphify, gstack, Last30Days, and Stop Slop.
- `docs/TOOL_WORKFLOW_INTEGRATION_HANDOFF.md` records installation, validation, safety boundaries, rollback, and change-specific verification.
- `.gitignore` excludes `graphify-out/` and `.ua/` because they contain generated local analysis.

This commit improves codebase discovery and verification discipline. It does not change application runtime behavior or user-visible performance.

### 5. Repository handoff

Commit: `49c99ec docs: add control center agent handoff`

This file was added to keep repository history, architecture, verification evidence, and continuation steps beside the code. Update it when the branch gains work that changes the resume point.

### 6. Gmail OAuth loopback-origin fix

Commit: `6276341 fix: build Gmail OAuth URLs on the browser's loopback origin`

The development server could report `localhost` while the browser used `127.0.0.1`. Google then rejected the callback because the redirect URI did not match the URI displayed in Settings. `browserFacingUrl()` now uses the request `Host` only when it names `localhost`, `127.0.0.1`, or `[::1]`; missing, foreign, credential-bearing, path-bearing, and malformed hosts fall back to the server-reported URL.

Primary files:

- `lib/google-oauth.ts`
- `app/api/auth/google/start/route.ts`
- `app/api/auth/google/callback/route.ts`
- `tests/google-oauth.test.ts`

### 7. Claude Code and Codex workflow parity

Commit: `28415fa docs: make the agent workflow run on Claude Code and Codex`

`AGENTS.md` and `docs/TOOL_WORKFLOW_INTEGRATION_HANDOFF.md` now explain how both agents find the same tools. The documentation records the Windows packaged-app storage issue, shared Graphify and Python locations, skill-name differences, and the Claude Code skill installation. Use the substitute review or browser workflow documented there when a named skill is absent from the active agent.

### 8. Skill routing rules

Commit: `bb08e3b chore: add gstack skill routing rules to CLAUDE.md`

`CLAUDE.md` maps kinds of request (bugs, reviews, QA, design, shipping) to the gstack skill that should handle them.

### 9. Project agent handoffs (Updates tab)

Commit: `56abdf7 feat: import project agent handoffs into an Updates tab`

Project repositories export a structured JSON handoff with `scripts/export-handoff.mjs`. The Updates tab imports reports, keeps a per-project history, and lets the user choose which proposed actions become tasks; nothing is accepted automatically. Reports and accepted actions live in SQLite keyed by project and report ID. Updates polls explicitly configured local folders every 15 seconds while visible. Tasks gained their own project filter and project assignment. See `docs/PROJECT_HANDOFFS.md` and `docs/AGENT_HANDOFF_AUTOMATION.md`.

`getDatabase()` runs the additive handoff and focus table initialization on every call, because development hot reload can keep a connection opened before those tables existed. Do not move it back into the first-open branch.

### 10. Focus panel

Commit: `f07693c feat: add a focus panel that turns Today into one next action`

The top of Today shows one task to do next, chosen locally (last night's pin, then due work, then the idlest project, then tasks with a first step). It adds per-task first steps with verb-based suggestions, a once-per-day **Not today** that never pulls later due dates forward or shifts a repeating series, stuck-task resolution after three postponements, a shipping streak and project idle days counted only from completed tasks and filed handoff reports, one-click **Shut down for the day** with a Today and Tomorrow catch-up stored in a `focus_journal` table, and a weekly review. Task text is never sent to an AI provider.

An independent review before commit found and fixed five defects: pins and postpone state carried into the next occurrence of a repeating task, **Edit note** creating duplicate tasks, postponing pulling later deadlines forward, stale pins overriding a new choice, and a "today" value that went stale overnight. `tests/focus-review-fixes.test.ts` covers them.

Primary files: `lib/focus.ts`, `lib/focus-store.ts`, `app/api/focus/route.ts`, `components/focus-panel.tsx`, and the `TaskItem` fields `firstStep`, `postponedCount`, `postponedOn`, and `pinnedFor` in `lib/types.ts`.

## Current architecture map

Start with these areas:

| Area | Main files | Responsibility |
| --- | --- | --- |
| Main UI | `components/control-center.tsx` | Tab views, settings screens, project labels, and filters |
| Shared types | `lib/types.ts` | Settings, stories, project routes, workspace data contracts |
| Settings | `lib/server/settings.ts`, `app/api/settings/route.ts` | Defaults, validation, secret handling, and settings API |
| Gmail OAuth | `lib/google-oauth.ts`, `app/api/auth/google/*/route.ts` | Client ID checks, loopback callback construction, OAuth state, and token exchange |
| Workspace | `lib/workspace-store.ts`, `app/api/workspace/route.ts` | Tasks, reminders, and canonical workspace persistence |
| Project handoffs | `lib/project-handoffs.ts`, `lib/project-handoff-store.ts`, `lib/handoff-files.ts`, `app/api/project-handoffs/route.ts`, `components/project-updates.tsx` | Report schema, import ledger, local-folder pickup, and the Updates tab |
| Focus | `lib/focus.ts`, `lib/focus-store.ts`, `app/api/focus/route.ts`, `components/focus-panel.tsx` | Next-task choice, postpone and stuck rules, streak, shutdown journal, and weekly review |
| Database | `lib/server/database.ts` | Local SQLite initialization and access |
| Industry | `app/api/live/industry/route.ts`, `lib/industry*.ts` | Discovery, storage, curation, ranking, and saved snapshots |
| Mentions | `app/api/live/mentions/route.ts`, `lib/mention*.ts` | Search, identity checks, curation, summaries, and backfill |
| Newsletters | `lib/server/newsletter-collector.ts`, `lib/newsletter*.ts` | Gmail collection, extraction, grouping, and persistence |
| Audience | `lib/server/audience.ts`, `lib/audience*.ts` | Public metrics, history, growth, and charts |
| Daily brief | `app/api/brief/route.ts`, `lib/daily-brief-snapshot.ts` | Bounded snapshot built from saved queues |
| Network safety | `proxy.ts`, `lib/server/safe-fetch.ts`, `lib/server/pinned-fetch.ts`, `lib/server/public-address.ts` | Loopback boundary, SSRF defenses, bounded reads, and pinned resolution |
| Operations | `scripts/launch.mjs`, `scripts/doctor.mjs`, `scripts/backup.mjs`, `scripts/smoke.mjs` | Setup, health checks, backups, launch, and smoke testing |

The project-routing path is:

1. `ProjectRoute` and the settings shape live in `lib/types.ts`.
2. `lib/server/settings.ts` cleans and bounds saved routes.
3. `components/control-center.tsx` reads the configured routes.
4. `projectsForStory()` computes labels.
5. `storyMatchesProject()` uses the same decision for filters.
6. `tests/project-routing.test.ts` protects phrase normalization, multi-project order, whole-word behavior, explanation fields, and label/filter agreement.

## Latest verification evidence

Last full verification: 2026-10-16, on the tree committed as `f07693c` (handoffs and focus together).

`npm run check` passed:

- ESLint passed.
- Test runner found 258 tests.
- 257 tests passed.
- 1 backup-permission test was intentionally skipped.
- 0 tests failed.
- TypeScript passed.
- Next.js production build passed and generated all application pages and API routes.

The handoff commit `56abdf7` was also verified on its own in a temporary worktree: TypeScript and ESLint passed, and 234 of 235 tests passed with the same intentional skip.

`npm run smoke` passed on the same tree, using an isolated temporary data directory. On this low-memory laptop it occasionally fails once on its 30-second startup deadline and passes on rerun. It verified:

- the launcher;
- the health endpoint;
- the rendered home page;
- a generic empty first run;
- the localhost request boundary.

A live development run returned HTTP 200 from the application and live API routes. The Codex in-app browser later refused a localhost reload under its own URL security policy. Do not treat that browser-tool refusal as a product failure. The repository smoke test and server logs passed.

After commit `6276341`, the user completed a real Google OAuth sign-in and confirmed that Gmail shows as connected. The registered callback still binds the current OAuth client to its configured loopback origin and port.

## Installed development tools

The following tools exist on this Windows account:

- Graphify `0.9.88`
- gstack `1.91.95.0`
- Bun `1.4.3`
- Playwright Chromium used by gstack
- Last30Days `3.28.0`
- Stop Slop
- Understand Anything

Graphify already indexed 115 code files into a local ignored graph containing 1,031 nodes and 3,008 edges. A fresh command shell can resolve `graphify` from `C:\Users\PiracyH\.local\bin`. Its shared tool and Python installations live outside packaged-app storage under `C:\Users\PiracyH\.local\share\uv`; read the workflow handoff before upgrading or uninstalling them.

Use Graphify for cross-file questions:

```powershell
graphify query "Where is project routing calculated and consumed?"
graphify update . --no-cluster
```

Run `graphify update` after meaningful code changes, not after prose-only work.

Use gstack skills according to risk:

- `plan-eng-review` before architecture or state-model changes;
- `investigate` for difficult failures;
- `review` and `test-audit` after substantive implementation;
- `design-review` and `qa` for visible UI work.

Last30Days is a discovery aid. Verify architecture, dependency, security, and privacy decisions against primary sources. Its installer reported five Socket alerts and a medium-risk Snyk result, so keep browser-cookie access disabled and review upstream changes before upgrading.

Understand Anything is installed but has not run its full repository-analysis pipeline. That pipeline requires a staged ignore-file review, explicit confirmation, and delegated subagents. Start it only when the user requests that analysis. Compare its output with Graphify before keeping two overlapping code-map systems.

## Safety boundaries

- Read `AGENTS.md` before editing. This repository uses Next.js 16, whose local documentation can differ from remembered framework behavior.
- Keep `.env*`, `.control-center/`, `graphify-out/`, and `.ua/` out of Git.
- Never print or return saved provider keys, OAuth tokens, or private connector content.
- Do not expose the loopback server through a proxy without adding authentication.
- Treat model output and generated code graphs as navigation aids. Source code and tests decide correctness.
- Preserve existing user changes. Inspect `git status` and the diff before every commit.
- Do not weaken tests, SSRF controls, origin checks, identity verification, or fail-closed storage behavior to make a check pass.

## How to resume

Run these commands from the attached checkout:

```powershell
cd C:\Users\PiracyH\Downloads\control-center
git status --short
git branch --show-current
npm run check
npm run smoke
```

For local development:

```powershell
npm run dev
```

Open `http://127.0.0.1:3000`. Stop the server with `Ctrl+C`.

Before changing project routing, read:

1. `lib/project-routing.ts`
2. `tests/project-routing.test.ts`
3. the project-routing sections of `lib/server/settings.ts`
4. the Industry and Mentions sections of `components/control-center.tsx`

## Immediate next actions

1. Review this handoff and `docs/TOOL_WORKFLOW_INTEGRATION_HANDOFF.md`.
2. Inspect the working tree before editing. These stay out of repository commits unless the user says otherwise: `next-env.d.ts` (dev-server output), `.claude/launch.json` (local preview config that attaches to an already-running dev server), `CLAUDE_CODE_HANDOFF.md` (the Claude session's private operational handoff), and the `reports/` and `research_notes/` folders (the user's personal research on agent workflows, not product code).
3. Update draft pull request #1 so its description covers all eleven commits and the current 258-test suite.
4. Keep the pull request in draft until the user asks to mark it ready.
5. For new product work, get a concrete user objective before extending routing, collectors, or private integrations.

The branch has no known failing test at this handoff. Known open defects are listed in `CLAUDE_CODE_HANDOFF.md`: misassigned Industry curation reasons, raw HTML entities in some Industry titles, and whole-word project phrases that miss plurals.

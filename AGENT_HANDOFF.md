# Control Center Agent Handoff

Use this file to resume work without relying on the previous chat. The code repository and this handoff live in the same checkout.

## Repository attachment

- Local checkout: `C:\Users\PiracyH\Downloads\control-center`
- Fork: `https://github.com/PiracyHush/control-center.git`
- Upstream: `https://github.com/mreflow/control-center.git`
- Active branch: `codex/project-routing`
- Base branch: `main`
- Current committed HEAD: `af9a0e3a23478db642c0deec1ca3430d6cd3f7f1`
- Draft pull request: `https://github.com/PiracyHush/control-center/pull/1`

The workflow-integration commit `af9a0e3` and this handoff file were committed and pushed to `origin/codex/project-routing` on 2026-10-13. Draft pull request #1 remains in draft.

Do not push, merge, publish, or change the draft status without a direct user request. The local GitHub CLI currently returns `HTTP 401: Bad credentials`, although the public pull-request page remains readable.

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

## Current architecture map

Start with these areas:

| Area | Main files | Responsibility |
| --- | --- | --- |
| Main UI | `components/control-center.tsx` | Tab views, settings screens, project labels, and filters |
| Shared types | `lib/types.ts` | Settings, stories, project routes, workspace data contracts |
| Settings | `lib/server/settings.ts`, `app/api/settings/route.ts` | Defaults, validation, secret handling, and settings API |
| Workspace | `lib/workspace-store.ts`, `app/api/workspace/route.ts` | Tasks, reminders, and canonical workspace persistence |
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

Last full verification: 2026-10-13, after the workflow integration.

`npm run check` passed:

- ESLint passed.
- Test runner found 220 tests.
- 219 tests passed.
- 1 backup-permission test was intentionally skipped.
- 0 tests failed.
- TypeScript passed.
- Next.js production build passed and generated all 15 application pages and API routes.

`npm run smoke` passed with an isolated temporary data directory. It verified:

- the launcher;
- the health endpoint;
- the rendered home page;
- a generic empty first run;
- the localhost request boundary.

A live development run returned HTTP 200 from the application and live API routes. The Codex in-app browser later refused a localhost reload under its own URL security policy. Do not treat that browser-tool refusal as a product failure. The repository smoke test and server logs passed.

## Installed development tools

The following tools exist on this Windows account:

- Graphify `0.9.88`
- gstack `1.91.95.0`
- Bun `1.4.3`
- Playwright Chromium used by gstack
- Last30Days `3.28.0`
- Stop Slop
- Understand Anything

Graphify already indexed 115 code files into a local ignored graph containing 1,031 nodes and 3,008 edges. A fresh command shell can resolve `graphify` from `C:\Users\PiracyH\.local\bin`.

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
2. Decide whether commit `af9a0e3` and this handoff should be pushed to `origin/codex/project-routing`.
3. If pushing, update draft pull request #1 so its summary and verification counts include the workflow commit and the current 220-test suite.
4. Keep the pull request in draft until the user asks to mark it ready.
5. For new product work, get a concrete user objective before extending routing, collectors, or private integrations.

The branch has no known failing test or unresolved product defect at this handoff. The remaining work is review and publication, followed by whatever product change the user chooses next.

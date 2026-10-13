# Control Center Tool Workflow Handoff

This file records what was installed, what was tested, and how a future developer or coding agent should use the tools without turning the workflow into ceremony.

## Goal

Control Center coordinates several kinds of state: projects, stories, tasks, collectors, settings, and live integrations. The toolchain below is intended to make cross-file reasoning, planning, debugging, review, UI verification, research, and documentation more reliable.

The principle is simple: use a tool when it reduces a real risk. Do not run every tool on every change.

## Verified baseline

The repository was healthy before workflow integration:

- `npm test`: 220 tests, 219 passed, 1 skipped, 0 failed.
- `npm run lint`: passed.
- `npm run build`: passed with all application pages and API routes generated.
- `GET /api/health`: returned HTTP 200 with `status: "ready"` and version `0.3.1`.

These results are the comparison point for later changes.

## Installed tools

### Graphify 0.9.88

Graphify is installed as a `uv` tool using a managed Python 3.12 runtime. It builds a local code graph so a developer can ask questions about relationships instead of reading every file manually.

An initial code-only graph was generated with:

```powershell
graphify extract . --code-only --no-cluster
```

The graph contained 1,031 nodes and 3,008 edges across 115 code files. Queries successfully traced:

- where project routing is calculated and consumed;
- how tasks and reminders are persisted;
- how API settings flow through server code and routes;
- how collector scope and cache behavior connect;
- where project-filtering behavior is tested.

Generated output lives in `graphify-out/` and is intentionally ignored by Git. It is local working data, not product source.

Use it when a question crosses modules:

```powershell
graphify query "Where is project routing calculated and consumed?"
graphify path "project-routing" "control-center"
graphify explain "workspace persistence"
```

After meaningful code changes:

```powershell
graphify update . --no-cluster
```

Do not update the graph for copy edits or an isolated one-line change. Graphify helps form a map; source code and tests remain the evidence.

### gstack 1.91.95.0

gstack is installed from `C:\Users\PiracyH\gstack` and linked into the global Codex skills directory. Bun 1.4.3 and the Playwright Chromium runtime were installed to support its browser workflow.

Only the useful skills were enabled:

- planning: `office-hours`, `plan-eng-review`;
- debugging: `investigate`;
- review: `review`, `test-audit`, `careful`;
- UI verification: `browse`, `open-gstack-browser`, `design-review`, `qa`, `qa-only`;
- maintenance: `upgrade`.

The browser was tested against the running Integrations settings page. It loaded the page, waited for network idle, and returned its accessibility tree, so automated UI inspection is working.

Use gstack according to change risk:

- A data-model or orchestration change gets `plan-eng-review` before implementation.
- A confusing regression gets `investigate` before speculative editing.
- A substantive implementation gets `review`; test-sensitive work also gets `test-audit`.
- A visible page change gets `design-review` and browser `qa` after the normal test suite.

Do not invoke all skills for a small change. That creates delay without adding confidence.

`gstack doctor` reported 8 checks healthy, 0 warnings, and 0 failures. Four optional capabilities are not configured: the standalone Codex CLI, artifact synchronization, the native CSO helper, and Claude CLI. None is required for the selected local workflow. The fallback gstack browser is operational.

### Understand Anything

Understand Anything is installed in `C:\Users\PiracyH\.understand-anything\repo`, with its Codex-compatible skills linked into `C:\Users\PiracyH\.agents\skills`.

It offers deeper onboarding and explanation flows than Graphify. Its first full repository analysis, however, requires a staged setup, explicit confirmation after generating `.ua/.understandignore`, and delegated subagents. That pipeline was deliberately not started silently. A future run should be an explicit repository-analysis task, not an automatic step in ordinary development.

When it is evaluated, keep `.ua/` local and ignored. Compare its answers with the existing Graphify queries before adopting both tools permanently. If the two tools solve the same problem, keep the lighter one.

Restart Codex before expecting the newly installed Understand Anything skills to appear in normal skill discovery.

### Last30Days 3.28.0

Last30Days is installed globally for Codex. Its preflight completed with safe defaults:

- configuration came from environment variables only;
- browser-cookie access was disabled;
- no browser stores were read;
- no project files were written;
- GitHub authentication was available without printing secrets;
- Reddit, Hacker News, Polymarket, GitHub, and general web grounding were available;
- several optional source commands were absent, which only narrows coverage.

The installer's security summary marked the skill safe in one scanner, but also surfaced five Socket alerts and a medium-risk Snyk result. Those are review signals, not proof of malicious behavior. Keep browser-cookie access disabled and inspect upstream changes before upgrading or using broader data-source access.

Use it for questions such as “what approaches have practitioners discussed recently?” It is useful for discovering terms, tools, and emerging failure modes. It is not a source of truth. Before changing dependencies, architecture, security, or privacy behavior, verify the finding in official documentation or primary source code.

### Stop Slop

Stop Slop is installed globally as a Codex skill. Use it to make README text, release notes, onboarding copy, and product prose direct and natural.

Do not let a style pass rewrite:

- code, tests, schemas, or structured data;
- exact commands, identifiers, and error messages;
- security and privacy guarantees;
- factual statements whose wording carries technical meaning.

Good prose is useful only when it remains true.

## Routine by change type

| Change | Before coding | During coding | Before handoff |
| --- | --- | --- | --- |
| Small isolated fix | Read the target and its tests | Make the smallest change | Relevant tests; use `npm run check` if runtime behavior changed |
| Cross-file orchestration or persistence | Graphify query, then `plan-eng-review` | Update focused tests with the implementation | `graphify update`, `npm run check`, `review`, and `test-audit` |
| Difficult regression | Graphify query if relationships are unclear | Use `investigate`; record evidence before changing code | Regression test, `npm run check`, then `review` |
| Visible UI change | Inspect route and component dependencies | Implement with accessibility in mind | `npm run check`, `npm run smoke`, `design-review`, and browser `qa` |
| Tool or dependency decision | Official docs first; Last30Days only for recent discovery | Pin and document the decision | Build, tests, security review, and primary-source links |
| Documentation or product copy | Gather exact facts and commands | Draft, then optionally use Stop Slop | Verify every technical claim; no graph rebuild needed |

## Required verification

The normal repository gate is:

```powershell
npm run check
```

It runs lint, tests, and the production build. For visible UI work, start the app and add both the existing smoke suite and browser inspection:

```powershell
npm run dev
npm run smoke
```

The browser check should confirm more than “the page opened.” Inspect the accessibility tree, important controls, empty/loading/error states, and the user path affected by the change.

## Safety boundaries

- Never place API keys or connector secrets in client components, logs, prompts, screenshots, or committed files.
- Keep `.env*`, `.control-center/`, `graphify-out/`, and `.ua/` uncommitted.
- Treat generated graphs and agent explanations as navigation aids, not proof.
- Prefer repository tests over an agent saying a change “looks correct.”
- Preserve user work and inspect the Git diff before committing.
- Do not install additional global tools merely because a skill lists them as optional.

## Maintenance and rollback

Recheck the toolchain after upgrades:

```powershell
graphify --version
gstack doctor
```

Graphify can be removed with `uv tool uninstall graphifyy`. Last30Days can be removed with the skills manager. Stop Slop can be removed from the Codex skills directory. Understand Anything includes an uninstall mode in its official installer; run that installer with `-Uninstall codex` if it is no longer wanted.

If a tool becomes noisy, slow, or duplicates another tool, disable it before adding a replacement. The workflow exists to shorten the path from uncertainty to evidence.

## Upstream references

- [OpenAI: Using skills with the Agents SDK](https://developers.openai.com/blog/skills-agents-sdk)
- [Graphify](https://github.com/Graphify-Labs/graphify)
- [gstack](https://github.com/garrytan/gstack)
- [Understand Anything](https://github.com/The-Pocket/understand-anything)
- [Last30Days](https://github.com/mvanhorn/last30days-skill)
- [Stop Slop](https://github.com/hardikpandya/stop-slop)

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Control Center workflow

- Use `graphify query "<question>"` for architecture or cross-file questions when `graphify-out/graph.json` exists. After meaningful code changes, run `graphify update . --no-cluster`. Skip graph work for documentation-only and small isolated edits.
- Use gstack selectively: `plan-eng-review` for architecture or state-model changes, `investigate` for difficult failures, `review` or `test-audit` after substantive code changes, and `design-review` or `qa` for visible UI changes.
- Treat Last30Days as a discovery tool, never as proof that an implementation, security claim, or dependency choice is correct. Verify important decisions against primary sources.
- Use Stop Slop only to improve nontechnical prose such as README, release notes, and product copy. Preserve exact technical, security, and privacy claims.
- When runtime code, tests, dependencies, or build behavior change, run `npm run check`. For visible UI changes, also run `npm run smoke` and browser QA.
- Keep credentials and private connector content server-side. Never commit `.control-center/`, `.env*`, `graphify-out/`, or `.ua/`.

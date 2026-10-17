import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// Whether the source changed since the last build. Shared by launch.mjs and
// restart.mjs; lib/server/build-state.ts repeats it for the running server, so
// keep SOURCE_PATHS in step there.

export const SOURCE_PATHS = [
  "app",
  "components",
  "lib",
  "instrumentation.ts",
  "proxy.ts",
  "next.config.ts",
  "package.json",
  "package-lock.json",
];

/**
 * Newest modification time under `target`. Times in the future (clock skew, an
 * extracted archive) are ignored, or the build would never count as current.
 */
function newestMtime(target, now) {
  if (!existsSync(target)) return 0;
  const info = statSync(target);
  const own = info.mtimeMs > now ? 0 : info.mtimeMs;
  if (!info.isDirectory()) return own;
  let newest = own;
  for (const entry of readdirSync(target, { withFileTypes: true }))
    newest = Math.max(newest, newestMtime(path.join(target, entry.name), now));
  return newest;
}

export function needsRebuild(cwd = process.cwd()) {
  const buildIdPath = path.join(cwd, ".next", "BUILD_ID");
  if (!existsSync(buildIdPath)) return true;
  const builtAt = statSync(buildIdPath).mtimeMs;
  const now = Date.now() + 60_000;
  return SOURCE_PATHS.some((source) => newestMtime(path.join(cwd, source), now) > builtAt);
}

import "server-only";

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// Tells the dashboard whether it is serving the newest code. A running server
// keeps the build it started with, so a rebuild (npm run check) or a source
// edit only shows up after a restart. Keep SOURCE_PATHS in step with
// scripts/build-check.mjs, which the launcher and restart script use.

const SOURCE_PATHS = [
  "app",
  "components",
  "lib",
  "instrumentation.ts",
  "proxy.ts",
  "next.config.ts",
  "package.json",
  "package-lock.json",
];

declare global {
  var controlCenterRunningBuildId: string | undefined;
}

function buildIdPath() {
  return path.join(process.cwd(), ".next", "BUILD_ID");
}

function readBuildId() {
  try {
    return readFileSync(buildIdPath(), "utf8").trim();
  } catch {
    return "";
  }
}

/** Called once at server start, before any rebuild can replace the file. */
export function recordRunningBuild() {
  globalThis.controlCenterRunningBuildId ??= readBuildId();
}

/** Times in the future (clock skew, an extracted archive) are ignored, as in scripts/build-check.mjs. */
function newestMtime(target: string, now: number): number {
  if (!existsSync(target)) return 0;
  const info = statSync(target);
  const own = info.mtimeMs > now ? 0 : info.mtimeMs;
  if (!info.isDirectory()) return own;
  let newest = own;
  for (const entry of readdirSync(target, { withFileTypes: true }))
    newest = Math.max(newest, newestMtime(path.join(/*turbopackIgnore: true*/ target, entry.name), now));
  return newest;
}

export type BuildState = {
  /** The server can restart itself: a production build started from this folder. */
  restartable: boolean;
  /** A restart would load newer code. */
  updateAvailable: boolean;
  /** The source changed after the last build, so a restart rebuilds first. */
  needsRebuild: boolean;
  runningBuildId: string;
  pid: number;
};

export function readBuildState(): BuildState {
  const runningBuildId = globalThis.controlCenterRunningBuildId ?? "";
  const restartable =
    process.env.NODE_ENV === "production"
    && Boolean(runningBuildId)
    && existsSync(path.join(process.cwd(), "scripts", "restart.mjs"));
  if (!restartable)
    return { restartable, updateAvailable: false, needsRebuild: false, runningBuildId, pid: process.pid };
  const diskBuildId = readBuildId();
  let needsRebuild = false;
  try {
    const builtAt = statSync(buildIdPath()).mtimeMs;
    const now = Date.now() + 60_000;
    needsRebuild = SOURCE_PATHS.some(
      (source) => newestMtime(path.join(/*turbopackIgnore: true*/ process.cwd(), source), now) > builtAt,
    );
  } catch {
    needsRebuild = true;
  }
  return {
    restartable,
    updateAvailable: needsRebuild || (Boolean(diskBuildId) && diskBuildId !== runningBuildId),
    needsRebuild,
    runningBuildId,
    pid: process.pid,
  };
}

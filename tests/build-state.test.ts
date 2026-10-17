import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Stub only Next's compile-time server marker, as tests/ai-runtime.test.ts does.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "data:text/javascript,export {};") return { format: "commonjs", source: "module.exports = {};", shortCircuit: true };
    return nextLoad(url, context);
  },
});

/** A fake app folder: a build from an hour ago, older sources, and the restart script. */
function fakeApp() {
  const root = mkdtempSync(path.join(os.tmpdir(), "control-center-build-"));
  const hourAgo = new Date(Date.now() - 3_600_000);
  const twoHoursAgo = new Date(Date.now() - 7_200_000);
  for (const [file, body] of [["scripts/restart.mjs", ""], ["app/page.tsx", "x"], [".next/BUILD_ID", "build-a"]] as const) {
    mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
    writeFileSync(path.join(root, file), body);
  }
  for (const target of ["app/page.tsx", "app", "scripts/restart.mjs", "scripts"])
    utimesSync(path.join(root, target), twoHoursAgo, twoHoursAgo);
  utimesSync(path.join(root, ".next/BUILD_ID"), hourAgo, hourAgo);
  return root;
}

async function inApp<T>(root: string, run: () => Promise<T>) {
  const cwd = process.cwd();
  const env = process.env.NODE_ENV;
  process.chdir(root);
  Object.assign(process.env, { NODE_ENV: "production" });
  globalThis.controlCenterRunningBuildId = undefined;
  try {
    return await run();
  } finally {
    process.chdir(cwd);
    Object.assign(process.env, { NODE_ENV: env });
    globalThis.controlCenterRunningBuildId = undefined;
    rmSync(root, { recursive: true, force: true });
  }
}

test("no update while the running build is the newest", async () => {
  const { readBuildState, recordRunningBuild } = await import("../lib/server/build-state");
  await inApp(fakeApp(), async () => {
    recordRunningBuild();
    const state = readBuildState();
    assert.equal(state.restartable, true);
    assert.equal(state.updateAvailable, false);
    assert.equal(state.runningBuildId, "build-a");
  });
});

test("a newer build on disk is an update that needs no rebuild", async () => {
  const { readBuildState, recordRunningBuild } = await import("../lib/server/build-state");
  const root = fakeApp();
  await inApp(root, async () => {
    recordRunningBuild();
    writeFileSync(path.join(root, ".next/BUILD_ID"), "build-b");
    recordRunningBuild(); // Recording again keeps the build the server started with.
    const state = readBuildState();
    assert.equal(state.runningBuildId, "build-a");
    assert.equal(state.updateAvailable, true);
    assert.equal(state.needsRebuild, false);
  });
});

test("a source edit after the build means a restart rebuilds first", async () => {
  const { readBuildState, recordRunningBuild } = await import("../lib/server/build-state");
  const root = fakeApp();
  await inApp(root, async () => {
    recordRunningBuild();
    writeFileSync(path.join(root, "app/page.tsx"), "edited");
    const state = readBuildState();
    assert.equal(state.updateAvailable, true);
    assert.equal(state.needsRebuild, true);
  });
});

test("a development server never offers to restart itself", async () => {
  const { readBuildState, recordRunningBuild } = await import("../lib/server/build-state");
  await inApp(fakeApp(), async () => {
    Object.assign(process.env, { NODE_ENV: "development" });
    recordRunningBuild();
    assert.deepEqual(
      { restartable: readBuildState().restartable, updateAvailable: readBuildState().updateAvailable },
      { restartable: false, updateAvailable: false },
    );
  });
});

test("a source file dated in the future does not force a rebuild forever", async () => {
  const { needsRebuild } = await import("../scripts/build-check.mjs");
  const root = fakeApp();
  try {
    assert.equal(needsRebuild(root), false);
    const nextYear = new Date(Date.now() + 365 * 86_400_000);
    utimesSync(path.join(root, "app/page.tsx"), nextYear, nextYear);
    assert.equal(needsRebuild(root), false);
    writeFileSync(path.join(root, "app/other.tsx"), "new file");
    assert.equal(needsRebuild(root), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { initializeHandoffStore, listHandoffs, importHandoff } from "../lib/project-handoff-store";
import { initializeWorkspaceStore, readWorkspaceState } from "../lib/workspace-store";
import { parseHandoffSources, readBoundedJson, syncHandoffFiles } from "../lib/handoff-files";
import { parseHandoff } from "../lib/project-handoffs";
// Shared exporter is also the entry point used by both project wrappers.
// @ts-expect-error The executable JS script intentionally has no declaration package.
import { exportHandoff } from "../scripts/export-handoff.mjs";

function report(projectId = "proof", id = "session-1", generatedAt = new Date().toISOString()) {
  return { schemaVersion: 1, id, projectId, generatedAt, repository: "Synthetic repository", summary: "Synthetic report", status: "awaiting-review", completed: [], evidence: ["Synthetic fixture"], decisions: [], actions: [{ id: "next", title: "Review next action", priority: "Normal" }] };
}
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "cc-handoff-files-"));
  const archive = path.join(root, ".agent-handoff", "reports");
  await mkdir(archive, { recursive: true });
  const db = initializeHandoffStore(initializeWorkspaceStore(new DatabaseSync(":memory:")));
  return { root, archive, db, dispose: async () => { db.close(); await rm(root, { recursive: true, force: true }); } };
}

test("automatic pickup imports missed sessions but never accepts tasks", async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.archive, "one.json"), JSON.stringify(report()));
    await writeFile(path.join(f.archive, "two.json"), JSON.stringify(report("proof", "session-2")));
    const statuses = await syncHandoffFiles(f.db, [{ projectId: "proof", repository: f.root }], ["proof"]);
    assert.equal(statuses[0].state, "current");
    assert.equal(listHandoffs(f.db).length, 2);
    assert.equal(readWorkspaceState(f.db).tasks.length, 0);
    await syncHandoffFiles(f.db, [{ projectId: "proof", repository: f.root }], ["proof"]);
    assert.equal(listHandoffs(f.db).length, 2);
    const saved = parseHandoff(report());
    // The previously imported immutable report is the one to accept.
    const original = parseHandoff(listHandoffs(f.db).find((item) => item.id === saved.id)!);
    assert.equal(importHandoff(f.db, original, original.actions).added, 1);
    await syncHandoffFiles(f.db, [{ projectId: "proof", repository: f.root }], ["proof"]);
    assert.equal(readWorkspaceState(f.db).tasks.length, 1);
  } finally { await f.dispose(); }
});

test("invalid, conflicting, oversized and wrong-project files cannot replace saved reports", async () => {
  const f = await fixture();
  try {
    const original = report();
    importHandoff(f.db, parseHandoff(original), []);
    for (const [name, value] of [["wrong", report("market")], ["conflict", { ...original, summary: "Changed" }], ["invalid", {}]] as const)
      await writeFile(path.join(f.archive, `${name}.json`), JSON.stringify(value));
    await writeFile(path.join(f.archive, "huge.json"), "x".repeat(500_001));
    const statuses = await syncHandoffFiles(f.db, [{ projectId: "proof", repository: f.root }], ["proof"]);
    assert.equal(statuses[0].state, "error");
    assert.match(statuses[0].message, /4 report/);
    assert.equal(listHandoffs(f.db).length, 1);
    assert.equal(listHandoffs(f.db)[0].summary, original.summary);
    assert.equal(readWorkspaceState(f.db).tasks.length, 0);
  } finally { await f.dispose(); }
});

test("source health distinguishes missing, stale and removed projects", async () => {
  const f = await fixture();
  try {
    const source = { projectId: "proof", repository: f.root };
    assert.equal((await syncHandoffFiles(f.db, [source], ["proof"]))[0].state, "missing");
    await writeFile(path.join(f.archive, "old.json"), JSON.stringify(report("proof", "old", "2025-01-01T00:00:00Z")));
    assert.equal((await syncHandoffFiles(f.db, [source], ["proof"]))[0].state, "stale");
    assert.equal((await syncHandoffFiles(f.db, [source], []))[0].state, "error");
    assert.equal((await syncHandoffFiles(f.db, [{ ...source, repository: path.join(f.root, "missing") }], ["proof"]))[0].state, "missing");
  } finally { await f.dispose(); }
});

test("configured sources require bounded, absolute, unique project mappings", () => {
  assert.throws(() => parseHandoffSources({ sources: [{ projectId: "proof", repository: "relative" }] }));
  assert.throws(() => parseHandoffSources({ sources: Array.from({ length: 21 }, () => ({ projectId: "proof", repository: os.tmpdir() })) }));
  assert.throws(() => parseHandoffSources({ sources: [{ projectId: "proof", repository: os.tmpdir() }, { projectId: "proof", repository: os.tmpdir() }] }));
  assert.deepEqual(parseHandoffSources({ sources: [] }), []);
});

test("handoff initialization upgrades a retained schema-6 connection without replacing workspace data", () => {
  const db = initializeWorkspaceStore(new DatabaseSync(":memory:"));
  try {
    db.exec("PRAGMA user_version = 6");
    const before = readWorkspaceState(db);
    initializeHandoffStore(db);
    initializeHandoffStore(db);
    assert.deepEqual(readWorkspaceState(db), before);
    assert.deepEqual(listHandoffs(db), []);
    const first = parseHandoff(report());
    assert.equal(importHandoff(db, first, []).added, 0);
    assert.equal(listHandoffs(db).length, 1);
  } finally { db.close(); }
});

test("pickup refuses linked folders outside the configured report directory", async () => {
  const f = await fixture();
  try {
    const outside = path.join(f.root, "outside");
    await mkdir(outside);
    await rm(f.archive, { recursive: true });
    await symlink(outside, f.archive, process.platform === "win32" ? "junction" : "dir");
    await writeFile(path.join(outside, "one.json"), JSON.stringify(report()));
    assert.equal((await syncHandoffFiles(f.db, [{ projectId: "proof", repository: f.root }], ["proof"]))[0].state, "error");
    assert.equal(listHandoffs(f.db).length, 0);
  } finally { await f.dispose(); }
});

test("shared exporter creates JSON and Markdown archives with real repo identity and refuses invalid input", async () => {
  const f = await fixture();
  try {
    execFileSync("git", ["init", "--quiet", f.root]);
    await writeFile(path.join(f.root, ".agent-handoff", "config.json"), JSON.stringify({ projectId: "proof" }));
    const input = path.join(f.root, ".agent-handoff", "session.json");
    await writeFile(input, JSON.stringify({ ...report("fake"), repository: "fake", commit: "fabricated" }));
    const exported = await exportHandoff(f.root, input);
    const first = parseHandoff(await readBoundedJson(exported.json));
    assert.equal(first.projectId, "proof");
    assert.equal(first.repository, f.root);
    assert.equal(first.commit, "");
    assert.match(await readFile(exported.markdown, "utf8"), /Proposed actions \(not accepted tasks\)/);
    const second = await exportHandoff(f.root, input);
    assert.notEqual(exported.id, second.id);
    assert.equal((await readdir(f.archive)).filter((name) => name.endsWith(".json")).length, 2);
    const previous = await readFile(second.json, "utf8");
    await writeFile(input, JSON.stringify({ summary: "Invalid incomplete report" }));
    await assert.rejects(() => exportHandoff(f.root, input));
    assert.equal(await readFile(second.json, "utf8"), previous);
  } finally { await f.dispose(); }
});

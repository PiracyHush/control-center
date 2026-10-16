import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { parseHandoff, taskMatchesProject } from "../lib/project-handoffs";
import { initializeHandoffStore, importHandoff, listHandoffs } from "../lib/project-handoff-store";
import { initializeWorkspaceStore, writeWorkspaceState, readWorkspaceState } from "../lib/workspace-store";
import { cleanTaskItems } from "../lib/tasks";

function report(overrides = {}) {
  return parseHandoff({ schemaVersion: 1, id: "session-1", projectId: "proof", generatedAt: "2026-10-12T10:00:00Z",
    repository: "https://example.com/proof", commit: "abc123", summary: "Added persistence", status: "working",
    completed: ["Atomic writes"], evidence: ["Tests passed"], decisions: [],
    actions: [{ id: "regression", title: "Test interrupted writes", description: "Protect the data", priority: "High" }], ...overrides });
}
function database() { return initializeHandoffStore(initializeWorkspaceStore(new DatabaseSync(":memory:"))); }
test("handoff imports preserve edits, completion, and deletions across repeated and later reports", () => {
  const db = database();
  try {
    const first = report();
    const saved = importHandoff(db, first, [{ ...first.actions[0], title: "My edited title" }]);
    assert.equal(saved.added, 1);
    assert.equal(saved.workspace.tasks[0].projectId, "proof");
    saved.workspace.tasks[0].done = true;
    writeWorkspaceState(db, saved.workspace);
    const repeat = importHandoff(db, first, first.actions);
    assert.equal(repeat.added, 0);
    assert.equal(repeat.workspace.tasks[0].title, "My edited title");
    assert.equal(repeat.workspace.tasks[0].done, true);
    const next = report({ id: "session-2", actions: [] });
    importHandoff(db, next, []);
    assert.equal(readWorkspaceState(db).tasks.length, 1);
    writeWorkspaceState(db, { tasks: [], reminders: [] });
    assert.equal(importHandoff(db, first, first.actions).workspace.tasks.length, 0);
    assert.equal(listHandoffs(db).length, 2);
  } finally { db.close(); }
});
test("skipped actions can be accepted later and action IDs are scoped by project", () => {
  const db = database();
  try {
    const first = report();
    assert.equal(importHandoff(db, first, []).added, 0);
    assert.equal(importHandoff(db, first, first.actions).added, 1);
    const other = report({ projectId: "market" });
    assert.equal(importHandoff(db, other, other.actions).added, 1);
    assert.equal(readWorkspaceState(db).tasks.length, 2);
  } finally { db.close(); }
});
test("conflicting report IDs and full task lists roll back the report and action ledger", () => {
  const db = database();
  try {
    const first = report(); importHandoff(db, first, []);
    assert.throws(() => importHandoff(db, report({ summary: "Changed" }), []), /different content/);
    writeWorkspaceState(db, { reminders: [], tasks: Array.from({ length: 10_000 }, (_, id) => ({ id, title: "Existing", description: "", due: "Today", recurrence: "One-time", priority: "Normal", done: false })) });
    const second = report({ id: "session-2" });
    assert.throws(() => importHandoff(db, second, second.actions), /full/);
    assert.equal(listHandoffs(db).length, 1);
    writeWorkspaceState(db, { tasks: [], reminders: [] });
    assert.equal(importHandoff(db, second, second.actions).added, 1);
  } finally { db.close(); }
});
test("handoff validation rejects malformed fields, duplicate actions, and invalid dates", () => {
  for (const overrides of [{ schemaVersion: 2 }, { generatedAt: "bad" }, { status: "done" }, { decisions: "text" }, { actions: [report().actions[0], report().actions[0]] }, { actions: [{ ...report().actions[0], due: "2026-02-30" }] }]) {
    assert.throws(() => report(overrides));
  }
});
test("normalized reports with omitted optional descriptions and commits can be imported again", () => {
  const normalized = report({ commit: undefined, actions: [{ id: "optional", title: "Optional fields" }] });
  assert.deepEqual(parseHandoff(normalized), normalized);
});
test("task project metadata survives cleaning and independent filters include unassigned tasks", () => {
  const cleaned = cleanTaskItems([{ id: "task", title: "Do it", projectId: "proof", handoffId: "session-1", actionId: "action" }])[0];
  assert.equal(cleaned.projectId, "proof"); assert.equal(cleaned.handoffId, "session-1");
  assert.equal(taskMatchesProject(cleaned, "proof"), true);
  assert.equal(taskMatchesProject(cleaned, "market"), false);
  assert.equal(taskMatchesProject(cleaned, ""), true);
  assert.equal(taskMatchesProject({}, "__unassigned"), true);
});

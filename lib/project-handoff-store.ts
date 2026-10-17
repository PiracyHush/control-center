import type { DatabaseSync } from "node:sqlite";
import type { ProjectHandoff, HandoffAction, SavedHandoff } from "./project-handoffs";
import { readWorkspaceState } from "./workspace-store";
import type { TaskItem } from "./types";
import { applyHandoffIdeas, initializeIdeaStore, type HandoffIdeasResult } from "./idea-store";

export function initializeHandoffStore(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS project_handoffs (
    project_id TEXT NOT NULL, report_id TEXT NOT NULL, payload TEXT NOT NULL,
    imported_at TEXT NOT NULL, PRIMARY KEY(project_id, report_id));
    CREATE TABLE IF NOT EXISTS handoff_actions (
    project_id TEXT NOT NULL, action_id TEXT NOT NULL, task_id TEXT NOT NULL,
    PRIMARY KEY(project_id, action_id));`);
  // Importing a report also writes ideas and notes, so their tables must exist too.
  return initializeIdeaStore(db);
}
export function listHandoffs(db: DatabaseSync): SavedHandoff[] {
  return (db.prepare("SELECT payload, imported_at FROM project_handoffs ORDER BY imported_at DESC").all() as unknown as { payload: string; imported_at: string }[])
    .map((row) => ({ ...JSON.parse(row.payload), importedAt: row.imported_at }));
}
export function importHandoff(db: DatabaseSync, report: ProjectHandoff, accepted: HandoffAction[], now = new Date().toISOString()) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const previous = db.prepare("SELECT payload FROM project_handoffs WHERE project_id=? AND report_id=?").get(report.projectId, report.id) as { payload: string } | undefined;
    const payload = JSON.stringify(report);
    if (previous && previous.payload !== payload) throw new Error("This report ID already exists with different content. Use a new report ID for each session.");
    const inserted = db.prepare("INSERT OR IGNORE INTO project_handoffs VALUES (?, ?, ?, ?)").run(report.projectId, report.id, payload, now);
    // Ideas and notes apply once, when the report is first stored; re-imports never duplicate them.
    const ideas: HandoffIdeasResult = inserted.changes
      ? applyHandoffIdeas(db, report, now)
      : { ideasProposed: 0, ideasSkipped: 0, notesAdded: 0, notesIgnored: 0 };
    const workspace = readWorkspaceState(db);
    let added = 0;
    for (const action of accepted) {
      const taskId = `handoff:${encodeURIComponent(report.projectId)}:${action.id}`;
      const result = db.prepare("INSERT OR IGNORE INTO handoff_actions VALUES (?, ?, ?)").run(report.projectId, action.id, taskId);
      if (!result.changes) continue;
      if (workspace.tasks.length >= 10_000) throw new Error("The task list is full.");
      const task: TaskItem = { id: taskId, projectId: report.projectId, handoffProjectId: report.projectId, handoffId: report.id, actionId: action.id,
        title: action.title, description: action.description || "Imported from an agent handoff.",
        due: action.due || "No date", priority: action.priority, recurrence: "One-time", done: false, createdAt: now };
      workspace.tasks.unshift(task);
      added++;
    }
    const write = db.prepare("INSERT INTO workspace_state VALUES (?, ?, ?) ON CONFLICT(state_key) DO UPDATE SET payload_json=excluded.payload_json, updated_at=excluded.updated_at");
    write.run("tasks", JSON.stringify(workspace.tasks), now);
    write.run("reminders", JSON.stringify(workspace.reminders), now);
    const reports = listHandoffs(db);
    db.exec("COMMIT");
    return { reports, workspace, added, ideas };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

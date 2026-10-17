import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { TaskItem } from "./types";
import { readWorkspaceState } from "./workspace-store";
import {
  ACTIVE_IDEA_STATUSES,
  MAX_ACTIVE_IDEAS,
  MAX_IDEA_TITLE,
  MAX_LINK_REASON,
  NOTABLE_IDEA_STATUSES,
  cleanIdeaText,
  cleanNoteText,
  ideaPair,
  isIdeaStatus,
  isSummaryStale,
  isUntouched,
  type Idea,
  type IdeaLink,
  type IdeaLinkStatus,
  type IdeaNote,
  type IdeaNoteAuthor,
  type IdeaStatus,
  type IdeaWithDetail,
  type IdeasState,
} from "./ideas";

/** Additive and idempotent, so it is safe to run on every connection use. */
export function initializeIdeaStore(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ideas (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      origin_kind TEXT NOT NULL,
      origin_project_id TEXT,
      origin_report_id TEXT,
      origin_key TEXT,
      summary TEXT,
      summary_at TEXT,
      promoted_to TEXT,
      created_at TEXT NOT NULL,
      last_grown_at TEXT NOT NULL,
      last_reviewed_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ideas_origin_key
      ON ideas(origin_project_id, origin_key) WHERE origin_key IS NOT NULL;
    CREATE TABLE IF NOT EXISTS idea_notes (
      id TEXT PRIMARY KEY,
      idea_id TEXT NOT NULL,
      body TEXT NOT NULL,
      author TEXT NOT NULL,
      project_id TEXT,
      report_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idea_notes_idea ON idea_notes(idea_id, created_at);
    CREATE TABLE IF NOT EXISTS idea_links (
      id TEXT PRIMARY KEY,
      idea_id TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      target_title TEXT,
      target_url TEXT,
      status TEXT NOT NULL,
      reason TEXT,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(idea_id, target_kind, target_id)
    );
    CREATE TABLE IF NOT EXISTS ideas_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return database;
}

type IdeaRow = {
  id: string; title: string; status: string; origin_kind: string;
  origin_project_id: string | null; origin_report_id: string | null;
  summary: string | null; summary_at: string | null; promoted_to: string | null;
  created_at: string; last_grown_at: string; last_reviewed_at: string | null;
};
type NoteRow = {
  id: string; idea_id: string; body: string; author: string;
  project_id: string | null; report_id: string | null; created_at: string;
};
type LinkRow = {
  id: string; idea_id: string; target_kind: string; target_id: string;
  target_title: string | null; target_url: string | null; status: string;
  reason: string | null; source: string; created_at: string;
};

function toIdea(row: IdeaRow): Idea {
  let promotedTo: Idea["promotedTo"];
  try {
    const parsed = row.promoted_to ? JSON.parse(row.promoted_to) : undefined;
    if (parsed?.kind === "tasks" && Array.isArray(parsed.taskIds)) promotedTo = { kind: "tasks", taskIds: parsed.taskIds.map(String) };
  } catch { promotedTo = undefined; }
  return {
    id: row.id,
    title: row.title,
    status: isIdeaStatus(row.status) ? row.status : "parked",
    originKind: row.origin_kind === "agent" ? "agent" : "manual",
    originProjectId: row.origin_project_id ?? undefined,
    originReportId: row.origin_report_id ?? undefined,
    summary: row.summary ?? undefined,
    summaryAt: row.summary_at ?? undefined,
    promotedTo,
    createdAt: row.created_at,
    lastGrownAt: row.last_grown_at,
    lastReviewedAt: row.last_reviewed_at ?? undefined,
  };
}
function toNote(row: NoteRow): IdeaNote {
  return {
    id: row.id, ideaId: row.idea_id, body: row.body,
    author: (["you", "agent", "connect"].includes(row.author) ? row.author : "you") as IdeaNoteAuthor,
    projectId: row.project_id ?? undefined, reportId: row.report_id ?? undefined, createdAt: row.created_at,
  };
}
function toLink(row: LinkRow): IdeaLink {
  return {
    id: row.id, ideaId: row.idea_id, targetKind: row.target_kind === "story" ? "story" : "idea",
    targetId: row.target_id, targetTitle: row.target_title ?? undefined, targetUrl: row.target_url ?? undefined,
    status: (["suggested", "accepted", "rejected"].includes(row.status) ? row.status : "suggested") as IdeaLinkStatus,
    reason: row.reason ?? undefined, source: row.source === "connect" ? "connect" : "you", createdAt: row.created_at,
  };
}

/** Runs work in one write transaction, or inside the caller's transaction. */
function inTransaction<T>(database: DatabaseSync, work: () => T): T {
  if (database.isTransaction) return work();
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function getIdeaMeta(database: DatabaseSync, key: string) {
  const row = database.prepare("SELECT value FROM ideas_meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}
export function setIdeaMeta(database: DatabaseSync, key: string, value: string) {
  database.prepare("INSERT INTO ideas_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
export function ideasAiEnabled(database: DatabaseSync) {
  return getIdeaMeta(database, "ai_enabled") === "true";
}

export function countActiveIdeas(database: DatabaseSync) {
  const placeholders = ACTIVE_IDEA_STATUSES.map(() => "?").join(", ");
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ideas WHERE status IN (${placeholders})`).get(...ACTIVE_IDEA_STATUSES) as { count: number };
  return Number(row.count);
}

export function getIdea(database: DatabaseSync, id: string) {
  const row = database.prepare("SELECT * FROM ideas WHERE id = ?").get(id) as IdeaRow | undefined;
  return row ? toIdea(row) : undefined;
}

/** Everything the Ideas tab shows, newest growth first. */
export function readIdeasState(database: DatabaseSync, now = new Date()): IdeasState {
  const ideas = (database.prepare("SELECT * FROM ideas ORDER BY last_grown_at DESC").all() as unknown as IdeaRow[]).map(toIdea);
  const notes = (database.prepare("SELECT * FROM idea_notes ORDER BY created_at DESC").all() as unknown as NoteRow[]).map(toNote);
  const links = (database.prepare("SELECT * FROM idea_links ORDER BY created_at DESC").all() as unknown as LinkRow[]).map(toLink);
  const notesByIdea = new Map<string, IdeaNote[]>();
  for (const note of notes) notesByIdea.set(note.ideaId, [...(notesByIdea.get(note.ideaId) ?? []), note]);
  const linksByIdea = new Map<string, IdeaLink[]>();
  for (const link of links) {
    linksByIdea.set(link.ideaId, [...(linksByIdea.get(link.ideaId) ?? []), link]);
    if (link.targetKind === "idea") linksByIdea.set(link.targetId, [...(linksByIdea.get(link.targetId) ?? []), link]);
  }
  const detailed: IdeaWithDetail[] = ideas.map((idea) => ({
    ...idea,
    notes: notesByIdea.get(idea.id) ?? [],
    links: linksByIdea.get(idea.id) ?? [],
    untouched: isUntouched(idea, now),
    summaryStale: isSummaryStale(idea),
  }));
  return {
    ideas: detailed,
    aiEnabled: ideasAiEnabled(database),
    connectLastRunAt: getIdeaMeta(database, "connect_last_run_at"),
    activeCount: countActiveIdeas(database),
  };
}

/** Lightweight list for agents: dashboard ids and titles of ideas they may add notes to. */
export function listNotableIdeas(database: DatabaseSync, statuses: IdeaStatus[] = NOTABLE_IDEA_STATUSES) {
  const allowed = statuses.filter((status) => NOTABLE_IDEA_STATUSES.includes(status));
  if (!allowed.length) return [];
  const placeholders = allowed.map(() => "?").join(", ");
  return (database.prepare(`SELECT id, title, status FROM ideas WHERE status IN (${placeholders}) ORDER BY last_grown_at DESC`).all(...allowed) as unknown as { id: string; title: string; status: IdeaStatus }[]);
}

function insertIdea(
  database: DatabaseSync,
  input: { title: string; status: IdeaStatus; originKind: "manual" | "agent"; originProjectId?: string; originReportId?: string; originKey?: string },
  now: string,
) {
  const id = `idea_${randomUUID()}`;
  database.prepare(`INSERT INTO ideas (id, title, status, origin_kind, origin_project_id, origin_report_id, origin_key, created_at, last_grown_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, input.title, input.status, input.originKind, input.originProjectId ?? null, input.originReportId ?? null, input.originKey ?? null, now, now,
  );
  return id;
}

function insertNote(
  database: DatabaseSync,
  input: { ideaId: string; body: string; author: IdeaNoteAuthor; projectId?: string; reportId?: string },
  now: string,
) {
  const id = `note_${randomUUID()}`;
  database.prepare("INSERT INTO idea_notes (id, idea_id, body, author, project_id, report_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, input.ideaId, input.body, input.author, input.projectId ?? null, input.reportId ?? null, now);
  database.prepare("UPDATE ideas SET last_grown_at = ? WHERE id = ?").run(now, input.ideaId);
  return id;
}

export function addIdea(
  database: DatabaseSync,
  input: { title: unknown; note?: unknown; projectId?: string },
  now = new Date().toISOString(),
) {
  const title = cleanIdeaText(input.title, MAX_IDEA_TITLE);
  if (!title) throw new Error("Give the idea a title.");
  const note = cleanNoteText(input.note);
  return inTransaction(database, () => {
    if (countActiveIdeas(database) >= MAX_ACTIVE_IDEAS)
      throw new Error(`You have ${MAX_ACTIVE_IDEAS} active ideas. Park, drop or promote some before adding more.`);
    const id = insertIdea(database, { title, status: "growing", originKind: "manual", originProjectId: input.projectId || undefined }, now);
    if (note) insertNote(database, { ideaId: id, body: note, author: "you", projectId: input.projectId || undefined }, now);
    return id;
  });
}

export function addIdeaNote(
  database: DatabaseSync,
  input: { ideaId: string; body: unknown; author?: IdeaNoteAuthor; projectId?: string; reportId?: string },
  now = new Date().toISOString(),
) {
  const body = cleanNoteText(input.body);
  if (!body) throw new Error("Write the note first.");
  return inTransaction(database, () => {
    const idea = getIdea(database, input.ideaId);
    if (!idea) throw new Error("That idea no longer exists.");
    if (!NOTABLE_IDEA_STATUSES.includes(idea.status)) throw new Error("Notes can only be added to growing or parked ideas.");
    return insertNote(database, { ideaId: idea.id, body, author: input.author ?? "you", projectId: input.projectId, reportId: input.reportId }, now);
  });
}

export type IdeaAction = "keep" | "dismiss" | "park" | "grow" | "drop";

const TRANSITIONS: Record<IdeaAction, { from: IdeaStatus[]; to: IdeaStatus }> = {
  keep: { from: ["proposed", "growing"], to: "growing" },
  dismiss: { from: ["proposed"], to: "dismissed" },
  park: { from: ["growing"], to: "parked" },
  grow: { from: ["parked", "promoted"], to: "growing" },
  drop: { from: ["growing", "parked"], to: "dropped" },
};

/**
 * Keep accepts a proposal, or marks a growing idea as reviewed so it leaves
 * "Needs a look". Dismiss keeps the row so the same agent proposal never returns.
 */
export function setIdeaStatus(database: DatabaseSync, ideaId: string, action: IdeaAction, now = new Date().toISOString()) {
  const transition = TRANSITIONS[action];
  if (!transition) throw new Error("Unknown idea action.");
  return inTransaction(database, () => {
    const idea = getIdea(database, ideaId);
    if (!idea) throw new Error("That idea no longer exists.");
    if (!transition.from.includes(idea.status)) throw new Error(`A ${idea.status} idea cannot be changed that way.`);
    if (idea.status === "promoted") {
      // Only when every task made from it is gone, e.g. deleted or overwritten
      // by an older window. Otherwise the task is where the idea lives now.
      const taskIds = new Set<string>(idea.promotedTo?.taskIds ?? []);
      if (readWorkspaceState(database).tasks.some((task) => taskIds.has(String(task.id))))
        throw new Error("This idea's task still exists. Work on it in Tasks, or delete the task first.");
      database.prepare("UPDATE ideas SET status = 'growing', promoted_to = NULL, last_reviewed_at = ? WHERE id = ?").run(now, ideaId);
    } else if (action === "keep" && idea.status === "proposed") {
      // Accepting a proposal starts its growth clock now.
      database.prepare("UPDATE ideas SET status = 'growing', last_grown_at = ?, last_reviewed_at = ? WHERE id = ?").run(now, now, ideaId);
    } else if (action === "keep" || action === "grow") {
      database.prepare("UPDATE ideas SET status = 'growing', last_reviewed_at = ? WHERE id = ?").run(now, ideaId);
    } else {
      database.prepare("UPDATE ideas SET status = ? WHERE id = ?").run(transition.to, ideaId);
    }
    return getIdea(database, ideaId)!;
  });
}

export function renameIdea(database: DatabaseSync, ideaId: string, title: unknown) {
  const clean = cleanIdeaText(title, MAX_IDEA_TITLE);
  if (!clean) throw new Error("Give the idea a title.");
  const result = database.prepare("UPDATE ideas SET title = ? WHERE id = ? AND status IN ('proposed', 'growing', 'parked')").run(clean, ideaId);
  if (!result.changes) throw new Error("Only active ideas can be renamed.");
}

export function setIdeaSummary(database: DatabaseSync, ideaId: string, summary: string, now = new Date().toISOString()) {
  database.prepare("UPDATE ideas SET summary = ?, summary_at = ? WHERE id = ?").run(summary.slice(0, 1_000), now, ideaId);
}

type LinkInput = {
  ideaId: string;
  targetKind: "idea" | "story";
  targetId: string;
  targetTitle?: string;
  targetUrl?: string;
  status: IdeaLinkStatus;
  reason?: string;
  source: "you" | "connect";
};

/**
 * Creates or updates one link. Idea pairs are stored in a fixed order, so a
 * rejected A-B pair also blocks B-A. A suggestion never overwrites a decision.
 */
export function upsertIdeaLink(database: DatabaseSync, input: LinkInput, now = new Date().toISOString()) {
  return inTransaction(database, () => {
    let ideaId = input.ideaId;
    let targetId = input.targetId;
    if (input.targetKind === "idea") {
      if (ideaId === targetId) throw new Error("An idea cannot link to itself.");
      for (const id of [ideaId, targetId]) if (!getIdea(database, id)) throw new Error("That idea no longer exists.");
      [ideaId, targetId] = ideaPair(ideaId, targetId);
    } else if (!getIdea(database, ideaId)) {
      throw new Error("That idea no longer exists.");
    }
    const existing = database.prepare("SELECT * FROM idea_links WHERE idea_id = ? AND target_kind = ? AND target_id = ?")
      .get(ideaId, input.targetKind, targetId) as LinkRow | undefined;
    const reason = input.reason ? input.reason.slice(0, MAX_LINK_REASON) : null;
    if (existing) {
      if (input.status === "suggested" && existing.status !== "suggested") return toLink(existing);
      database.prepare("UPDATE idea_links SET status = ?, reason = COALESCE(?, reason) WHERE id = ?").run(input.status, reason, existing.id);
      return toLink(database.prepare("SELECT * FROM idea_links WHERE id = ?").get(existing.id) as LinkRow);
    }
    const id = `link_${randomUUID()}`;
    database.prepare(`INSERT INTO idea_links (id, idea_id, target_kind, target_id, target_title, target_url, status, reason, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, ideaId, input.targetKind, targetId,
      input.targetTitle ? input.targetTitle.slice(0, 300) : null, input.targetUrl ? input.targetUrl.slice(0, 2_000) : null,
      input.status, reason, input.source, now,
    );
    return toLink(database.prepare("SELECT * FROM idea_links WHERE id = ?").get(id) as LinkRow);
  });
}

export function setIdeaLinkStatus(database: DatabaseSync, linkId: string, status: "accepted" | "rejected") {
  const result = database.prepare("UPDATE idea_links SET status = ? WHERE id = ?").run(status, linkId);
  if (!result.changes) throw new Error("That link no longer exists.");
}

export type HandoffIdeasResult = { ideasProposed: number; ideasSkipped: number; notesAdded: number; notesIgnored: number };

/**
 * Applies a handoff report's ideas and notes. Called inside the handoff import
 * transaction, only the first time a report is stored, so re-imports never
 * duplicate anything. New ideas wait for Keep; notes attach to growing or
 * parked ideas by their dashboard id.
 */
export function applyHandoffIdeas(
  database: DatabaseSync,
  report: { id: string; projectId: string; ideas?: { id: string; title: string; note?: string }[]; ideaNotes?: { ideaId: string; body: string }[] },
  now: string,
): HandoffIdeasResult {
  const result: HandoffIdeasResult = { ideasProposed: 0, ideasSkipped: 0, notesAdded: 0, notesIgnored: 0 };
  let active = countActiveIdeas(database);
  for (const proposal of report.ideas ?? []) {
    const exists = database.prepare("SELECT 1 FROM ideas WHERE origin_project_id = ? AND origin_key = ?").get(report.projectId, proposal.id);
    if (exists) continue;
    const title = cleanIdeaText(proposal.title, MAX_IDEA_TITLE);
    if (!title || active >= MAX_ACTIVE_IDEAS) { result.ideasSkipped++; continue; }
    const ideaId = insertIdea(database, {
      title, status: "proposed", originKind: "agent",
      originProjectId: report.projectId, originReportId: report.id, originKey: proposal.id,
    }, now);
    const note = cleanNoteText(proposal.note);
    if (note) insertNote(database, { ideaId, body: note, author: "agent", projectId: report.projectId, reportId: report.id }, now);
    active++;
    result.ideasProposed++;
  }
  for (const note of report.ideaNotes ?? []) {
    const idea = getIdea(database, note.ideaId);
    const body = cleanNoteText(note.body);
    if (!body || !idea || !NOTABLE_IDEA_STATUSES.includes(idea.status)) { result.notesIgnored++; continue; }
    insertNote(database, { ideaId: idea.id, body, author: "agent", projectId: report.projectId, reportId: report.id }, now);
    result.notesAdded++;
  }
  return result;
}

/** Marks an idea promoted and records the tasks created from it. */
export function markIdeaPromoted(database: DatabaseSync, ideaId: string, taskIds: string[]) {
  const result = database.prepare("UPDATE ideas SET status = 'promoted', promoted_to = ? WHERE id = ? AND status IN ('growing', 'parked')")
    .run(JSON.stringify({ kind: "tasks", taskIds }), ideaId);
  if (!result.changes) throw new Error("Only growing or parked ideas can be promoted.");
}

/**
 * Turns an idea into one task in the workspace and marks the idea promoted,
 * in a single transaction. The task carries `ideaId` as the back-link and
 * keeps the idea's origin project. Returns the updated task list so the page
 * can replace its copy before its next save.
 */
export function promoteIdeaToTask(
  database: DatabaseSync,
  ideaId: string,
  input: { title?: unknown; firstStep?: unknown },
  now = new Date().toISOString(),
) {
  return inTransaction(database, () => {
    const idea = getIdea(database, ideaId);
    if (!idea || !NOTABLE_IDEA_STATUSES.includes(idea.status)) throw new Error("Only growing or parked ideas can be promoted.");
    const workspace = readWorkspaceState(database);
    if (workspace.tasks.length >= 10_000) throw new Error("The task list is full.");
    const title = cleanIdeaText(input.title, 300) || idea.title;
    const firstStep = cleanIdeaText(input.firstStep, 200);
    const task: TaskItem = {
      id: `task_${randomUUID()}`,
      title,
      description: `Promoted from the idea "${idea.title}".`,
      due: "No date",
      recurrence: "One-time",
      priority: "Normal",
      done: false,
      createdAt: now,
      projectId: idea.originProjectId,
      ideaId: idea.id,
      ...(firstStep ? { firstStep } : {}),
    };
    workspace.tasks.unshift(task);
    database.prepare(`INSERT INTO workspace_state (state_key, payload_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(state_key) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`)
      .run("tasks", JSON.stringify(workspace.tasks), now);
    database.prepare(`INSERT INTO workspace_state (state_key, payload_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(state_key) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`)
      .run("reminders", JSON.stringify(workspace.reminders), now);
    markIdeaPromoted(database, idea.id, [String(task.id)]);
    return { task, workspace };
  });
}

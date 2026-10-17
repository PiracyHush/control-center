export type HandoffAction = {
  id: string; title: string; description: string;
  priority: "Normal" | "High" | "Low"; due?: string;
};
/** A side idea an agent proposes; it waits in the Ideas tab for Keep or Dismiss. */
export type HandoffIdea = { id: string; title: string; note?: string };
/** A note for an existing idea, addressed by its dashboard id (idea_<uuid>). */
export type HandoffIdeaNote = { ideaId: string; body: string };
export type ProjectHandoff = {
  schemaVersion: 1; id: string; projectId: string; generatedAt: string;
  repository: string; commit: string; summary: string;
  status: "working" | "blocked" | "awaiting-review";
  completed: string[]; evidence: string[]; decisions: string[];
  actions: HandoffAction[];
  ideas?: HandoffIdea[]; ideaNotes?: HandoffIdeaNote[];
};
export type SavedHandoff = ProjectHandoff & { importedAt: string };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an object.");
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max = 2000, optional = false) {
  if (optional && (value === undefined || value === "")) return "";
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`${label} must be nonempty text (maximum ${max} characters).`);
  return value.trim();
}
function identifier(value: unknown, label: string) {
  const id = text(value, label, 100);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id))
    throw new Error(`${label} must use letters, numbers, dots, underscores, or hyphens.`);
  return id;
}
function list(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length > 100)
    throw new Error(`${label} must be a list of at most 100 entries.`);
  return value.map((item) => text(item, label));
}
export function parseHandoff(value: unknown): ProjectHandoff {
  const input = record(value);
  if (input.schemaVersion !== 1) throw new Error("schemaVersion must be 1.");
  const generatedAt = text(input.generatedAt, "generatedAt", 40);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(generatedAt) || !Number.isFinite(Date.parse(generatedAt)) || Date.parse(generatedAt) > Date.now() + 300_000)
    throw new Error("generatedAt must be an ISO timestamp, not in the future.");
  if (!["working", "blocked", "awaiting-review"].includes(String(input.status)))
    throw new Error("status must be working, blocked, or awaiting-review.");
  if (!Array.isArray(input.actions) || input.actions.length > 100)
    throw new Error("actions must be a list of at most 100 entries.");
  const seen = new Set<string>();
  const actions = input.actions.map((raw) => {
    const item = record(raw);
    const id = identifier(item.id, "Action id");
    if (seen.has(id)) throw new Error("Action IDs must be unique within a report.");
    seen.add(id);
    const priority = item.priority ?? "Normal";
    if (!["Normal", "High", "Low"].includes(String(priority))) throw new Error("Invalid action priority.");
    const due = item.due === undefined ? undefined : text(item.due, "Action due", 10);
    if (due && (!/^\d{4}-\d{2}-\d{2}$/.test(due) || !Number.isFinite(Date.parse(due)) || new Date(due).toISOString().slice(0, 10) !== due))
      throw new Error("Action due must be a valid YYYY-MM-DD date.");
    return { id, title: text(item.title, "Action title", 300), description: text(item.description, "Action description", 2000, true), priority: priority as HandoffAction["priority"], due };
  });
  const ideas = parseHandoffIdeas(input.ideas);
  const ideaNotes = parseHandoffIdeaNotes(input.ideaNotes);
  return {
    schemaVersion: 1, id: identifier(input.id, "Report id"),
    projectId: text(input.projectId, "Project id", 100), generatedAt: new Date(generatedAt).toISOString(),
    repository: text(input.repository, "Repository", 500), commit: text(input.commit, "Commit", 100, true),
    summary: text(input.summary, "Summary", 5000), status: input.status as ProjectHandoff["status"],
    completed: list(input.completed, "Completed work"), evidence: list(input.evidence, "Evidence"),
    decisions: list(input.decisions, "Decisions"), actions,
    // Optional and omitted when absent, so reports without ideas keep their exact stored shape.
    ...(ideas ? { ideas } : {}), ...(ideaNotes ? { ideaNotes } : {}),
  };
}

function parseHandoffIdeas(value: unknown): HandoffIdea[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 50) throw new Error("ideas must be a list of at most 50 entries.");
  const seen = new Set<string>();
  return value.map((raw) => {
    const item = record(raw);
    const id = identifier(item.id, "Idea id");
    if (seen.has(id)) throw new Error("Idea IDs must be unique within a report.");
    seen.add(id);
    const note = text(item.note, "Idea note", 2000, true);
    return { id, title: text(item.title, "Idea title", 200), ...(note ? { note } : {}) };
  });
}

function parseHandoffIdeaNotes(value: unknown): HandoffIdeaNote[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 50) throw new Error("ideaNotes must be a list of at most 50 entries.");
  return value.map((raw) => {
    const item = record(raw);
    const ideaId = text(item.ideaId, "Idea note ideaId", 60);
    if (!/^idea_[0-9a-f-]{36}$/.test(ideaId))
      throw new Error("Idea note ideaId must be a dashboard idea id such as idea_<uuid>; list them with --list-ideas.");
    return { ideaId, body: text(item.body, "Idea note body", 2000) };
  });
}

export function taskMatchesProject(task: { projectId?: string }, selected: string) {
  return !selected || (selected === "__unassigned" ? !task.projectId : task.projectId === selected);
}

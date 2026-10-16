export type HandoffAction = {
  id: string; title: string; description: string;
  priority: "Normal" | "High" | "Low"; due?: string;
};
export type ProjectHandoff = {
  schemaVersion: 1; id: string; projectId: string; generatedAt: string;
  repository: string; commit: string; summary: string;
  status: "working" | "blocked" | "awaiting-review";
  completed: string[]; evidence: string[]; decisions: string[];
  actions: HandoffAction[];
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
  return {
    schemaVersion: 1, id: identifier(input.id, "Report id"),
    projectId: text(input.projectId, "Project id", 100), generatedAt: new Date(generatedAt).toISOString(),
    repository: text(input.repository, "Repository", 500), commit: text(input.commit, "Commit", 100, true),
    summary: text(input.summary, "Summary", 5000), status: input.status as ProjectHandoff["status"],
    completed: list(input.completed, "Completed work"), evidence: list(input.evidence, "Evidence"),
    decisions: list(input.decisions, "Decisions"), actions,
  };
}

export function taskMatchesProject(task: { projectId?: string }, selected: string) {
  return !selected || (selected === "__unassigned" ? !task.projectId : task.projectId === selected);
}

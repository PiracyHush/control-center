import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { parseHandoff } from "./project-handoffs";
import { importHandoff } from "./project-handoff-store";

export type HandoffSource = { projectId: string; repository: string };
export type HandoffSourceStatus = { projectId: string; state: "missing" | "current" | "stale" | "error"; message: string; lastReportedAt?: string };
const MAX_BYTES = 500_000;

export async function readBoundedJson(filename: string) {
  if ((await lstat(filename)).isSymbolicLink()) throw new Error("Linked handoff files are not allowed.");
  const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_BYTES) throw new Error("Handoff files must be regular files smaller than 500 KB.");
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await handle.read(buffer, length, buffer.length - length, null);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > MAX_BYTES) throw new Error("The handoff file is too large.");
    return JSON.parse(buffer.subarray(0, length).toString("utf8"));
  } finally { await handle.close(); }
}

export function parseHandoffSources(value: unknown): HandoffSource[] {
  if (!value || typeof value !== "object" || !("sources" in value) || !Array.isArray(value.sources) || value.sources.length > 20)
    throw new Error("Handoff sources must be a list of at most 20 configured repositories.");
  const seen = new Set<string>();
  return value.sources.map((source: unknown) => {
    if (!source || typeof source !== "object" || !("projectId" in source) || !("repository" in source) ||
      typeof source.projectId !== "string" || !source.projectId.trim() || source.projectId.length > 100 ||
      typeof source.repository !== "string" || !path.isAbsolute(source.repository)) throw new Error("Each source needs a project ID and an absolute repository path.");
    if (seen.has(source.projectId)) throw new Error("Configure only one repository per project.");
    seen.add(source.projectId);
    return { projectId: source.projectId, repository: source.repository };
  });
}

async function reportFiles(repository: string) {
  // Trust only an explicitly configured root, never a path supplied by a report.
  const root = await realpath(repository);
  const folder = path.join(root, ".agent-handoff");
  const archive = path.join(folder, "reports");
  for (const directory of [folder, archive]) {
    const info = await lstat(directory);
    // These allowlisted folders are runtime user data, not application build assets.
    if (info.isSymbolicLink() || !info.isDirectory() || await realpath(/* turbopackIgnore: true */ directory) !== directory)
      throw new Error("Linked handoff directories are not allowed.");
  }
  const entries = await readdir(archive, { withFileTypes: true });
  if (entries.length > 2000) throw new Error("The report folder is too large; archive older files outside the watched folder.");
  const files = entries.filter((entry) => entry.name.endsWith(".json"));
  if (files.some((entry) => !entry.isFile() || entry.isSymbolicLink())) throw new Error("Linked or non-file reports are not allowed.");
  const ordered = await Promise.all(files.map(async (entry) => {
    const filename = path.join(archive, entry.name);
    return { filename, modified: (await lstat(filename)).mtimeMs };
  }));
  return { files: ordered.sort((a, b) => b.modified - a.modified).slice(0, 100), truncated: ordered.length > 100 };
}

export async function syncHandoffFiles(db: DatabaseSync, sources: HandoffSource[], projectIds: string[], now = Date.now()): Promise<HandoffSourceStatus[]> {
  const statuses: HandoffSourceStatus[] = [];
  for (const source of sources) {
    if (!projectIds.includes(source.projectId)) {
      statuses.push({ projectId: source.projectId, state: "error", message: "Source project is no longer configured. No files imported." });
      continue;
    }
    let latest = "";
    let invalid = 0;
    try {
      const { files, truncated } = await reportFiles(source.repository);
      for (const file of files) {
        try {
          const report = parseHandoff(await readBoundedJson(file.filename));
          if (report.projectId !== source.projectId) throw new Error("Project mismatch.");
          importHandoff(db, report, []); // Reports only: task acceptance is always human-controlled.
          if (report.generatedAt > latest) latest = report.generatedAt;
        } catch { invalid++; }
      }
      const state = invalid || truncated ? "error" : !latest ? "missing" : now - Date.parse(latest) > 7 * 86400_000 ? "stale" : "current";
      const message = invalid ? `${invalid} report file(s) could not be imported. Check their schema, project ID, and unique report IDs.`
        : truncated ? "Only the 100 most recently modified reports were checked. Move older files outside the watched folder."
        : !latest ? "No agent report yet. The next completed work session should export one."
        : state === "stale" ? "Last report is over 7 days old. This does not confirm the project's current state."
        : "Reports picked up locally. Proposed tasks await your approval.";
      statuses.push({ projectId: source.projectId, state, message, lastReportedAt: latest || undefined });
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
      statuses.push({ projectId: source.projectId, state: missing ? "missing" : "error", message: missing ? "No agent report folder yet. Awaiting the first export." : "Cannot safely read this configured report folder. Check local paths and permissions." });
    }
  }
  return statuses;
}

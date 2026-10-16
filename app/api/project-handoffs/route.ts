import { getDatabase } from "@/lib/server/database";
import { dataDirectory, readSettings } from "@/lib/server/settings";
import { parseHandoff } from "@/lib/project-handoffs";
import { importHandoff, listHandoffs } from "@/lib/project-handoff-store";
import { parseHandoffSources, readBoundedJson, syncHandoffFiles, type HandoffSource } from "@/lib/handoff-files";
import path from "node:path";

export const runtime = "nodejs";
export async function GET() {
  try {
    const settings = await readSettings();
    let sources: HandoffSource[];
    try { sources = parseHandoffSources(await readBoundedJson(path.join(dataDirectory(), "handoff-sources.json"))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return Response.json({ reports: listHandoffs(getDatabase()), sources: [], sourceError: "Automatic pickup configuration could not be read safely." });
      sources = [];
    }
    const statuses = await syncHandoffFiles(getDatabase(), sources, settings.projectRouting.projects.map((project) => project.id));
    return Response.json({ reports: listHandoffs(getDatabase()), sources: statuses });
  }
  catch { return Response.json({ error: "Project updates could not be read safely." }, { status: 500 }); }
}
export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > 512_000) throw new Error("The import is too large (maximum 500 KB).");
    const body = JSON.parse(raw);
    const report = parseHandoff(body.report);
    const settings = await readSettings();
    if (!settings.projectRouting.projects.some((project) => project.id === report.projectId))
      throw new Error("Choose a configured project for this report.");
    if (!Array.isArray(body.acceptedActions)) throw new Error("acceptedActions must be a list.");
    const accepted = parseHandoff({ ...report, actions: body.acceptedActions }).actions;
    if (accepted.some((action) => !report.actions.some((original) => original.id === action.id)))
      throw new Error("Accepted actions must come from this report.");
    return Response.json(importHandoff(getDatabase(), report, accepted));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Import failed." }, { status: 400 }); }
}

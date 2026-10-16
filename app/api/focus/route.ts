import { getDatabase } from "@/lib/server/database";
import { listJournalEntries, parseJournalEntry, saveJournalEntry } from "@/lib/focus-store";
import { listHandoffs } from "@/lib/project-handoff-store";
import type { ReportActivity } from "@/lib/focus";

export const runtime = "nodejs";

export async function GET() {
  try {
    const database = getDatabase();
    const reports: ReportActivity[] = listHandoffs(database).map((report) => ({
      projectId: report.projectId,
      generatedAt: report.generatedAt,
      summary: typeof report.summary === "string" ? report.summary.slice(0, 300) : "",
    }));
    return Response.json({ journal: listJournalEntries(database), reports });
  } catch {
    return Response.json(
      { error: "Focus history could not be read safely." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  let entry: ReturnType<typeof parseJournalEntry>;
  try {
    const raw = await request.text();
    if (raw.length > 8_000) throw new Error("The shutdown note is too large.");
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new Error("The shutdown note must be valid JSON.");
    }
    entry = parseJournalEntry(body);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "The shutdown note is not valid." },
      { status: 400 },
    );
  }
  try {
    return Response.json(saveJournalEntry(getDatabase(), entry));
  } catch {
    return Response.json(
      { error: "The shutdown note could not be saved safely." },
      { status: 500 },
    );
  }
}

import { getDatabase } from "@/lib/server/database";
import { readSettings } from "@/lib/server/settings";
import { isIdeaStatus, type IdeaStatus } from "@/lib/ideas";
import {
  addIdea,
  addIdeaNote,
  listNotableIdeas,
  promoteIdeaToTask,
  readIdeasState,
  renameIdea,
  setIdeaLinkStatus,
  setIdeaMeta,
  setIdeaStatus,
  upsertIdeaLink,
  type IdeaAction,
} from "@/lib/idea-store";
import { IdeasAiDisabledError, connectIdeas, summariseIdea } from "@/lib/server/idea-ai";
import { AiNotConfiguredError } from "@/lib/server/ai";

export const runtime = "nodejs";

const STATUS_CHANGES: IdeaAction[] = ["keep", "dismiss", "park", "grow", "drop"];

function id(value: unknown, prefix: string) {
  if (typeof value !== "string" || !new RegExp(`^${prefix}_[0-9a-f-]{36}$`).test(value))
    throw new Error("That item no longer exists.");
  return value;
}

/**
 * GET with ?status=growing,parked returns only ids and titles, for agents
 * running `npm run handoff:export -- --list-ideas`. Without it, the full state
 * for the Ideas tab.
 */
export async function GET(request: Request) {
  try {
    const database = getDatabase();
    const statusParam = new URL(request.url).searchParams.get("status");
    if (statusParam !== null) {
      const statuses = statusParam.split(",").map((value) => value.trim()).filter(isIdeaStatus) as IdeaStatus[];
      return Response.json({ ideas: listNotableIdeas(database, statuses) });
    }
    return Response.json(readIdeasState(database));
  } catch {
    return Response.json({ error: "Ideas could not be read safely." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 20_000) throw new Error("The request is too large.");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Send a JSON object.");
    body = parsed as Record<string, unknown>;
  } catch (error) {
    return Response.json({ error: error instanceof Error && error.message !== "Unexpected end of JSON input" ? error.message : "Send a JSON object." }, { status: 400 });
  }

  try {
    const database = getDatabase();
    let extra: Record<string, unknown> = {};
    switch (body.action) {
      case "add": {
        let projectId: string | undefined;
        if (typeof body.projectId === "string" && body.projectId) {
          const settings = await readSettings();
          if (!settings.projectRouting.projects.some((project) => project.id === body.projectId))
            throw new Error("Choose a configured project.");
          projectId = body.projectId;
        }
        extra = { ideaId: addIdea(database, { title: body.title, note: body.note, projectId }) };
        break;
      }
      case "note":
        addIdeaNote(database, { ideaId: id(body.ideaId, "idea"), body: body.body, author: "you" });
        break;
      case "status": {
        const change = body.change as IdeaAction;
        if (!STATUS_CHANGES.includes(change)) throw new Error("Unknown change.");
        setIdeaStatus(database, id(body.ideaId, "idea"), change);
        break;
      }
      case "rename":
        renameIdea(database, id(body.ideaId, "idea"), body.title);
        break;
      case "link":
        upsertIdeaLink(database, {
          ideaId: id(body.ideaId, "idea"), targetKind: "idea", targetId: id(body.targetIdeaId, "idea"),
          status: "accepted", source: "you",
        });
        break;
      case "linkStatus": {
        if (body.status !== "accepted" && body.status !== "rejected") throw new Error("Unknown link decision.");
        setIdeaLinkStatus(database, id(body.linkId, "link"), body.status);
        break;
      }
      case "promote": {
        const { workspace } = promoteIdeaToTask(database, id(body.ideaId, "idea"), { title: body.title, firstStep: body.firstStep });
        extra = { tasks: workspace.tasks };
        break;
      }
      case "ai":
        if (typeof body.enabled !== "boolean") throw new Error("Say whether AI should be on or off.");
        setIdeaMeta(database, "ai_enabled", body.enabled ? "true" : "false");
        break;
      case "summarise":
        await summariseIdea(database, await readSettings(), id(body.ideaId, "idea"));
        break;
      case "connect":
        extra = { connect: await connectIdeas(database, await readSettings()) };
        break;
      default:
        throw new Error("Unknown idea action.");
    }
    return Response.json({ ...readIdeasState(database), ...extra });
  } catch (error) {
    const known = error instanceof Error;
    const status = error instanceof IdeasAiDisabledError || error instanceof AiNotConfiguredError ? 409 : 400;
    return Response.json({ error: known ? error.message : "That change could not be saved." }, { status });
  }
}

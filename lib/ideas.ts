// Shared types and pure rules for the Ideas tab. Safe to import from the
// browser: no Node or database imports here.

export const IDEA_STATUSES = ["proposed", "growing", "parked", "dismissed", "dropped", "promoted"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

/** Statuses that count toward the cap and can still change. */
export const ACTIVE_IDEA_STATUSES: IdeaStatus[] = ["proposed", "growing", "parked"];
/** Statuses an agent or you can add notes to. */
export const NOTABLE_IDEA_STATUSES: IdeaStatus[] = ["growing", "parked"];

export const MAX_ACTIVE_IDEAS = 500;
export const MAX_IDEA_TITLE = 200;
export const MAX_IDEA_NOTE = 2_000;
export const MAX_LINK_REASON = 300;
export const UNTOUCHED_DAYS = 21;
export const CONNECT_INTERVAL_MS = 60 * 60 * 1000;
export const CONNECT_MAX_IDEAS = 50;
export const CONNECT_MAX_STORIES = 40;

export type IdeaNoteAuthor = "you" | "agent" | "connect";
export type IdeaLinkTargetKind = "idea" | "story";
export type IdeaLinkStatus = "suggested" | "accepted" | "rejected";

export type IdeaNote = {
  id: string;
  ideaId: string;
  body: string;
  author: IdeaNoteAuthor;
  projectId?: string;
  reportId?: string;
  createdAt: string;
};

export type IdeaLink = {
  id: string;
  /** For idea-to-idea links this is the smaller of the two ids. */
  ideaId: string;
  targetKind: IdeaLinkTargetKind;
  targetId: string;
  /** Headline and URL captured when a story was linked, so it survives feed pruning. */
  targetTitle?: string;
  targetUrl?: string;
  status: IdeaLinkStatus;
  reason?: string;
  source: "you" | "connect";
  createdAt: string;
};

export type IdeaPromotion = { kind: "tasks"; taskIds: string[] };

export type Idea = {
  id: string;
  title: string;
  status: IdeaStatus;
  originKind: "manual" | "agent";
  originProjectId?: string;
  originReportId?: string;
  summary?: string;
  summaryAt?: string;
  promotedTo?: IdeaPromotion;
  createdAt: string;
  lastGrownAt: string;
  lastReviewedAt?: string;
};

export type IdeaWithDetail = Idea & {
  notes: IdeaNote[];
  /** Links where this idea is either end. */
  links: IdeaLink[];
  untouched: boolean;
  summaryStale: boolean;
};

export type IdeasState = {
  ideas: IdeaWithDetail[];
  aiEnabled: boolean;
  connectLastRunAt?: string;
  activeCount: number;
};

export function isIdeaStatus(value: unknown): value is IdeaStatus {
  return typeof value === "string" && (IDEA_STATUSES as readonly string[]).includes(value);
}

/** Untouched: a growing idea with no note and no review for 21 days. */
export function isUntouched(idea: Pick<Idea, "status" | "lastGrownAt" | "lastReviewedAt">, now: Date) {
  if (idea.status !== "growing") return false;
  const last = Math.max(Date.parse(idea.lastGrownAt) || 0, Date.parse(idea.lastReviewedAt ?? "") || 0);
  return now.getTime() - last >= UNTOUCHED_DAYS * 24 * 60 * 60 * 1000;
}

/** A summary is stale once a note has been added after it was written. */
export function isSummaryStale(idea: Pick<Idea, "summary" | "summaryAt" | "lastGrownAt">) {
  if (!idea.summary || !idea.summaryAt) return false;
  return Date.parse(idea.summaryAt) < Date.parse(idea.lastGrownAt);
}

/** Orders an idea pair so A-B and B-A are the same link. */
export function ideaPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/**
 * Groups ideas joined by accepted idea-to-idea links (connected components).
 * Computed locally; no AI involved. Single ideas are left out.
 */
export function ideaClusters(ideaIds: string[], links: Pick<IdeaLink, "ideaId" | "targetId" | "targetKind" | "status">[]) {
  const known = new Set(ideaIds);
  const parent = new Map(ideaIds.map((id) => [id, id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cursor = id;
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor)!;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  for (const link of links) {
    if (link.status !== "accepted" || link.targetKind !== "idea") continue;
    if (!known.has(link.ideaId) || !known.has(link.targetId)) continue;
    parent.set(find(link.ideaId), find(link.targetId));
  }
  const groups = new Map<string, string[]>();
  for (const id of ideaIds) {
    const root = find(id);
    groups.set(root, [...(groups.get(root) ?? []), id]);
  }
  return [...groups.values()].filter((group) => group.length > 1).sort((a, b) => b.length - a.length);
}

// Control characters (ANSI escapes, NUL, etc.) never belong in idea text. Agents
// read titles back through --list-ideas, so a forged line must not survive.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

export function cleanIdeaText(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").replace(CONTROL_CHARACTERS, "").trim().slice(0, max) : "";
}

export function cleanNoteText(value: unknown) {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").replace(CONTROL_CHARACTERS, "").trim().slice(0, MAX_IDEA_NOTE) : "";
}

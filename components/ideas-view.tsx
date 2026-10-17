"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  CONNECT_INTERVAL_MS,
  MAX_IDEA_NOTE,
  MAX_IDEA_TITLE,
  ideaClusters,
  type IdeaLink,
  type IdeaNote,
  type IdeaWithDetail,
  type IdeasState,
} from "@/lib/ideas";
import { MAX_FIRST_STEP_LENGTH } from "@/lib/focus";
import type { ProjectRoute } from "@/lib/types";
import styles from "./ideas-view.module.css";

type Props = {
  projects: ProjectRoute[];
  onPromote: (ideaId: string, input: { title?: string; firstStep?: string }) => Promise<void>;
};

const clock = () => Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(iso: string, now: number) {
  const days = Math.max(0, Math.floor((now - (Date.parse(iso) || now)) / DAY_MS));
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function shortDate(iso: string) {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? "" : new Date(time).toLocaleDateString();
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function safeUrl(url?: string) {
  return url && /^https?:\/\//i.test(url) ? url : undefined;
}

export function IdeasView({ projects, onPromote }: Props) {
  const [state, setState] = useState<IdeasState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [now, setNow] = useState(clock);
  const [newTitle, setNewTitle] = useState("");
  const [newProject, setNewProject] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [promoting, setPromoting] = useState(false);
  const [firstStep, setFirstStep] = useState("");
  const [confirmDrop, setConfirmDrop] = useState(false);
  // The idea the drafts and open forms below belong to.
  const [draftsFor, setDraftsFor] = useState<string | undefined>(undefined);
  const [confirmQuickDrop, setConfirmQuickDrop] = useState("");
  const [linkTarget, setLinkTarget] = useState("");
  const [connectMessage, setConnectMessage] = useState("");

  const projectName = useCallback(
    (id?: string) => (id ? projects.find((project) => project.id === id)?.name ?? "a removed project" : undefined),
    [projects],
  );

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/ideas", { cache: "no-store" });
      const body = (await response.json()) as IdeasState & { error?: string };
      if (!response.ok) throw new Error(body.error || "Ideas could not be loaded.");
      setState(body);
      setError("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Ideas could not be loaded.");
    }
  }, []);

  useEffect(() => {
    // Fetch on mount; state updates happen after the awaited response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  async function send(payload: Record<string, unknown>, failure: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as IdeasState & {
        error?: string;
        connect?: { suggested: number; ideasSent: number; storiesSent: number };
        ideaId?: string;
      };
      if (!response.ok) throw new Error(body.error || failure);
      setState(body);
      setNow(clock());
      return body;
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : failure);
      return null;
    } finally {
      setBusy(false);
    }
  }

  const ideas = useMemo(() => state?.ideas ?? [], [state]);
  const byId = useMemo(() => new Map(ideas.map((idea) => [idea.id, idea])), [ideas]);
  const proposed = ideas.filter((idea) => idea.status === "proposed");
  const growing = ideas.filter((idea) => idea.status === "growing");
  const parked = ideas.filter((idea) => idea.status === "parked");
  const closed = ideas.filter((idea) => ["dropped", "dismissed", "promoted"].includes(idea.status));
  const selectable = [...growing, ...parked, ...proposed];
  const selected: IdeaWithDetail | undefined =
    byId.get(selectedId) ?? (selectedId ? undefined : selectable[0]);
  // When the shown idea changes without a click (e.g. it was parked and the
  // next one moved up), clear half-finished forms so they cannot act on it.
  if (selected?.id !== draftsFor) {
    setDraftsFor(selected?.id);
    setRenaming(false);
    setPromoting(false);
    setFirstStep("");
    setConfirmDrop(false);
    setNoteDraft("");
    setLinkTarget("");
  }
  const allLinks = useMemo(() => {
    const seen = new Map<string, IdeaLink>();
    for (const idea of ideas) for (const link of idea.links) seen.set(link.id, link);
    return [...seen.values()];
  }, [ideas]);
  const clusters = ideaClusters(growing.map((idea) => idea.id), allLinks);
  const untouched = growing.filter((idea) => idea.untouched);

  const select = (id: string) => {
    setSelectedId(id);
    setRenaming(false);
    setPromoting(false);
    setConfirmDrop(false);
    setNoteDraft("");
    setLinkTarget("");
  };

  async function addIdea(event: FormEvent) {
    event.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    const result = await send({ action: "add", title, projectId: newProject || undefined }, "Could not add the idea.");
    if (result) {
      setNewTitle("");
      if (result.ideaId) select(result.ideaId);
    }
  }

  async function addNote(event: FormEvent) {
    event.preventDefault();
    if (!selected || !noteDraft.trim()) return;
    if (await send({ action: "note", ideaId: selected.id, body: noteDraft }, "Could not add the note.")) setNoteDraft("");
  }

  async function rename(event: FormEvent) {
    event.preventDefault();
    if (!selected || !renameDraft.trim()) return;
    if (await send({ action: "rename", ideaId: selected.id, title: renameDraft }, "Could not rename the idea."))
      setRenaming(false);
  }

  const change = (idea: IdeaWithDetail, to: "keep" | "dismiss" | "park" | "grow" | "drop") =>
    send({ action: "status", ideaId: idea.id, change: to }, "Could not update the idea.");

  async function promote(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await onPromote(selected.id, { firstStep: firstStep.trim() || undefined });
      setPromoting(false);
      setFirstStep("");
      await refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not promote the idea.");
    } finally {
      setBusy(false);
    }
  }

  async function runConnect() {
    setConnectMessage("");
    const result = await send({ action: "connect" }, "Connect could not run.");
    if (result?.connect) {
      const { suggested, ideasSent, storiesSent } = result.connect;
      setConnectMessage(
        `${suggested} ${suggested === 1 ? "suggestion" : "suggestions"} from ${ideasSent} ideas and ${storiesSent} stories.`,
      );
    }
  }

  const connectNextAt = state?.connectLastRunAt ? Date.parse(state.connectLastRunAt) + CONNECT_INTERVAL_MS : 0;
  const connectWaiting = connectNextAt > now;
  const waitMinutes = Math.max(1, Math.ceil((connectNextAt - now) / 60_000));

  const noteLabel = (note: IdeaNote) =>
    note.author === "you"
      ? "you"
      : note.author === "connect"
        ? "Connect"
        : `agent · ${projectName(note.projectId) ?? "unknown project"}`;

  const linked = selected
    ? selected.links.filter((link) => link.status === "accepted")
    : [];
  const suggestions = selected ? selected.links.filter((link) => link.status === "suggested") : [];
  const linkedIdeaIds = new Set(
    linked.filter((link) => link.targetKind === "idea").flatMap((link) => [link.ideaId, link.targetId]),
  );
  const linkChoices = selectable.filter(
    (idea) => idea.id !== selected?.id && idea.status !== "proposed" && !linkedIdeaIds.has(idea.id),
  );
  const otherEnd = (link: IdeaLink) => (link.ideaId === selected?.id ? link.targetId : link.ideaId);

  const originLine = (idea: IdeaWithDetail) =>
    idea.originKind === "agent"
      ? `Started by an agent in ${projectName(idea.originProjectId) ?? "an unknown project"} · ${shortDate(idea.createdAt)}`
      : `Added by you · ${shortDate(idea.createdAt)}`;

  const ideaRow = (idea: IdeaWithDetail) => (
    <li key={idea.id}>
      <button
        type="button"
        className={`${styles.row} ${selected?.id === idea.id ? styles.rowActive : ""}`}
        aria-current={selected?.id === idea.id ? "true" : undefined}
        onClick={() => select(idea.id)}
      >
        <b>{idea.title}</b>
        <span>
          {[
            idea.originKind === "agent" ? projectName(idea.originProjectId) : undefined,
            `${idea.notes.length} ${idea.notes.length === 1 ? "note" : "notes"}`,
            `grew ${daysAgo(idea.lastGrownAt, now)}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {idea.untouched && <em>Untouched</em>}
      </button>
    </li>
  );

  return (
    <div className={`view ${styles.view}`}>
      <div>
        <p className="eyebrow">Ideas</p>
        <h1>Ideas</h1>
        <p className={styles.lede}>
          Ideas you and your agents capture while working. They grow with notes and connect to each other and to
          the news.
        </p>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {!state && !error && <p role="status">Loading ideas…</p>}
      {state && (
        <div className={styles.grid}>
          <section className={styles.col} aria-label="Idea lists">
            <form className={`${styles.card} ${styles.addForm}`} onSubmit={addIdea}>
              <label htmlFor="idea-new-title">New idea</label>
              <input
                id="idea-new-title"
                value={newTitle}
                maxLength={MAX_IDEA_TITLE}
                onChange={(event) => setNewTitle(event.target.value)}
                placeholder="A thought worth keeping"
              />
              <label htmlFor="idea-new-project">Project (optional)</label>
              <select id="idea-new-project" value={newProject} onChange={(event) => setNewProject(event.target.value)}>
                <option value="">No project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <button className="button button-primary" disabled={busy || !newTitle.trim()}>
                Add idea
              </button>
            </form>

            {proposed.length > 0 && (
              <div className={styles.card}>
                <p className="eyebrow">Waiting for you ({proposed.length})</p>
                <ul className={styles.list}>
                  {proposed.map((idea) => (
                    <li key={idea.id} className={styles.proposal}>
                      <b>{idea.title}</b>
                      <small>{projectName(idea.originProjectId) ?? "Agent proposal"}</small>
                      {idea.notes[0] && <p>{idea.notes[0].body}</p>}
                      <div className={styles.buttons}>
                        <button className="button button-primary" disabled={busy} onClick={() => void change(idea, "keep")}>
                          Keep
                        </button>
                        <button className="button button-ghost" disabled={busy} onClick={() => void change(idea, "dismiss")}>
                          Dismiss
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className={styles.card}>
              <p className="eyebrow">Growing ({growing.length})</p>
              {growing.length ? (
                <ul className={styles.list}>{growing.map(ideaRow)}</ul>
              ) : (
                <p className={styles.muted}>Nothing growing yet. Add an idea above.</p>
              )}
            </div>

            <details className={styles.card}>
              <summary>Parked ({parked.length})</summary>
              {parked.length ? <ul className={styles.list}>{parked.map(ideaRow)}</ul> : <p className={styles.muted}>Nothing parked.</p>}
            </details>

            <details className={styles.card}>
              <summary>Closed ({closed.length})</summary>
              {closed.length ? (
                <ul className={styles.list}>
                  {closed.map((idea) => (
                    <li key={idea.id} className={styles.closed}>
                      <b>{idea.title}</b>
                      <span>{idea.status === "promoted" ? "→ task" : idea.status}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.muted}>Nothing closed.</p>
              )}
            </details>
          </section>

          <section className={styles.col} aria-label="Selected idea">
            {selected ? (
              <article className={`${styles.card} ${styles.detail}`}>
                {renaming ? (
                  <form className={styles.inline} onSubmit={rename}>
                    <input
                      aria-label="Idea title"
                      value={renameDraft}
                      maxLength={MAX_IDEA_TITLE}
                      onChange={(event) => setRenameDraft(event.target.value)}
                    />
                    <button className="button button-primary" disabled={busy || !renameDraft.trim()}>
                      Save
                    </button>
                    <button type="button" className="button button-ghost" onClick={() => setRenaming(false)}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <div className={styles.titleRow}>
                    <h2>{selected.title}</h2>
                    {["proposed", "growing", "parked"].includes(selected.status) && (
                      <button
                        className="text-button"
                        onClick={() => {
                          setRenameDraft(selected.title);
                          setRenaming(true);
                        }}
                      >
                        Rename
                      </button>
                    )}
                  </div>
                )}
                <p className={styles.muted}>
                  {originLine(selected)} · status: {selected.status}
                </p>

                <div className={styles.summary}>
                  <p className="eyebrow">Summary</p>
                  <p>{selected.summary || "No summary yet"}</p>
                  {selected.summaryStale && <small>Out of date: new notes since this summary.</small>}
                  {(selected.status === "growing" || selected.status === "parked") && <button
                    className="button button-ghost"
                    disabled={busy || !state.aiEnabled}
                    title={state.aiEnabled ? undefined : "Turn on AI for ideas to summarise"}
                    onClick={() => void send({ action: "summarise", ideaId: selected.id }, "Could not summarise.")}
                  >
                    Summarise
                  </button>}
                </div>

                {selected.status !== "proposed" && selected.status !== "promoted" && (
                  <form className={styles.noteForm} onSubmit={addNote}>
                    <label htmlFor="idea-note">Add a note</label>
                    <textarea
                      id="idea-note"
                      value={noteDraft}
                      maxLength={MAX_IDEA_NOTE}
                      onChange={(event) => setNoteDraft(event.target.value)}
                    />
                    <button className="button button-ghost" disabled={busy || !noteDraft.trim()}>
                      Add note
                    </button>
                  </form>
                )}

                <div>
                  <p className="eyebrow">Timeline</p>
                  {selected.notes.length ? (
                    <ol className={styles.timeline}>
                      {[...selected.notes]
                        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                        .map((note) => (
                          <li key={note.id}>
                            <small>
                              {noteLabel(note)} · {shortDate(note.createdAt)}
                            </small>
                            <p>{note.body}</p>
                          </li>
                        ))}
                    </ol>
                  ) : (
                    <p className={styles.muted}>No notes yet.</p>
                  )}
                </div>

                {(selected.status === "growing" || selected.status === "parked") && (
                  <div className={styles.actions}>
                    {promoting ? (
                      <form className={styles.inline} onSubmit={promote}>
                        <input
                          aria-label="First step (optional)"
                          value={firstStep}
                          maxLength={MAX_FIRST_STEP_LENGTH}
                          onChange={(event) => setFirstStep(event.target.value)}
                          placeholder="First step (optional)"
                        />
                        <button className="button button-primary" disabled={busy}>
                          Create task
                        </button>
                        <button type="button" className="button button-ghost" onClick={() => setPromoting(false)}>
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <button className="button button-primary" disabled={busy} onClick={() => setPromoting(true)}>
                        Promote to task
                      </button>
                    )}
                    {selected.status === "parked" ? (
                      <button className="button button-ghost" disabled={busy} onClick={() => void change(selected, "grow")}>
                        Un-park
                      </button>
                    ) : (
                      <button className="button button-ghost" disabled={busy} onClick={() => void change(selected, "park")}>
                        Park
                      </button>
                    )}
                    {confirmDrop ? (
                      <>
                        <button
                          className="button button-ghost"
                          disabled={busy}
                          onClick={() => {
                            setConfirmDrop(false);
                            void change(selected, "drop");
                          }}
                        >
                          Confirm drop
                        </button>
                        <button className="text-button" onClick={() => setConfirmDrop(false)}>
                          Keep it
                        </button>
                      </>
                    ) : (
                      <button className="button button-ghost" disabled={busy} onClick={() => setConfirmDrop(true)}>
                        Drop
                      </button>
                    )}
                  </div>
                )}
                {selected.status === "promoted" && (
                  <div className={styles.actions}>
                    <button
                      className="button button-ghost"
                      disabled={busy}
                      title="Only works when the task made from this idea has been deleted"
                      onClick={() => void change(selected, "grow")}
                    >
                      Grow again
                    </button>
                  </div>
                )}
                {selected.status === "proposed" && (
                  <div className={styles.actions}>
                    <button className="button button-primary" disabled={busy} onClick={() => void change(selected, "keep")}>
                      Keep
                    </button>
                    <button className="button button-ghost" disabled={busy} onClick={() => void change(selected, "dismiss")}>
                      Dismiss
                    </button>
                  </div>
                )}
              </article>
            ) : (
              <div className={`${styles.card} ${styles.emptyState}`}>
                <h2>No idea selected</h2>
                <p>
                  Add an idea on the left, or pick one from the list. Agents can add ideas through handoff reports;
                  run <code>export-handoff.mjs --list-ideas</code> to see the ids they can write notes to.
                </p>
              </div>
            )}
          </section>

          <section className={styles.col} aria-label="Connections">
            <div className={styles.card}>
              <p className="eyebrow">Connections</p>
              <ClusterMap clusters={clusters} byId={byId} selectedId={selected?.id} onSelect={select} />
            </div>

            {selected && (
              <div className={styles.card}>
                <p className="eyebrow">Linked to this idea</p>
                {linked.length ? (
                  <ul className={styles.list}>
                    {linked.map((link) => {
                      if (link.targetKind === "idea") {
                        const other = byId.get(otherEnd(link));
                        return (
                          <li key={link.id}>
                            <button type="button" className="text-button" onClick={() => other && select(other.id)}>
                              {other?.title ?? "Unknown idea"}
                            </button>
                          </li>
                        );
                      }
                      const url = safeUrl(link.targetUrl);
                      return (
                        <li key={link.id}>
                          {url ? (
                            <a href={url} target="_blank" rel="noreferrer noopener">
                              {link.targetTitle || url}
                            </a>
                          ) : (
                            <span>{link.targetTitle || "Story"}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className={styles.muted}>No links yet.</p>
                )}
                <div className={styles.inline}>
                  <label htmlFor="idea-link-target" className={styles.srOnly}>
                    Link to another idea
                  </label>
                  <select id="idea-link-target" value={linkTarget} onChange={(event) => setLinkTarget(event.target.value)}>
                    <option value="">Link to another idea</option>
                    {linkChoices.map((idea) => (
                      <option key={idea.id} value={idea.id}>
                        {clip(idea.title, 60)}
                      </option>
                    ))}
                  </select>
                  <button
                    className="button button-ghost"
                    disabled={busy || !linkTarget}
                    onClick={async () => {
                      if (await send({ action: "link", ideaId: selected.id, targetIdeaId: linkTarget }, "Could not link the ideas."))
                        setLinkTarget("");
                    }}
                  >
                    Link
                  </button>
                </div>
              </div>
            )}

            {selected && suggestions.length > 0 && (
              <div className={styles.card}>
                <p className="eyebrow">Suggestions</p>
                <ul className={styles.list}>
                  {suggestions.map((link) => {
                    const title =
                      link.targetKind === "idea" ? byId.get(otherEnd(link))?.title : link.targetTitle;
                    return (
                      <li key={link.id} className={styles.proposal}>
                        <b>{title || "Unknown"}</b>
                        <small>{link.targetKind === "story" ? "Story" : "Idea"}</small>
                        {link.reason && <p>{link.reason}</p>}
                        <div className={styles.buttons}>
                          <button
                            className="button button-primary"
                            disabled={busy}
                            onClick={() => void send({ action: "linkStatus", linkId: link.id, status: "accepted" }, "Could not link.")}
                          >
                            Link
                          </button>
                          <button
                            className="button button-ghost"
                            disabled={busy}
                            onClick={() => void send({ action: "linkStatus", linkId: link.id, status: "rejected" }, "Could not update.")}
                          >
                            Not related
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className={styles.card}>
              <p className="eyebrow">AI</p>
              <label className={styles.switch}>
                <input
                  type="checkbox"
                  checked={state.aiEnabled}
                  disabled={busy}
                  onChange={(event) => void send({ action: "ai", enabled: event.target.checked }, "Could not change the AI setting.")}
                />
                Use AI for ideas
              </label>
              <p className={styles.muted}>
                When on, idea titles, notes (including notes written by agents) and recent story headlines are sent to
                your selected AI provider to summarise ideas and suggest links. Off by default.
              </p>
              <button
                className="button button-ghost"
                disabled={busy || !state.aiEnabled || connectWaiting}
                onClick={() => void runConnect()}
              >
                Run Connect
              </button>
              <p className={styles.muted}>
                {state.connectLastRunAt ? `Last run ${new Date(state.connectLastRunAt).toLocaleString()}.` : "Not run yet."}
                {connectWaiting && ` Try again in ${waitMinutes} ${waitMinutes === 1 ? "minute" : "minutes"}.`}
              </p>
              {connectMessage && <p role="status">{connectMessage}</p>}
            </div>

            {untouched.length > 0 && (
              <div className={styles.card}>
                <p className="eyebrow">Needs a look ({untouched.length})</p>
                <ul className={styles.list}>
                  {untouched.map((idea) => (
                    <li key={idea.id} className={styles.proposal}>
                      <button type="button" className="text-button" onClick={() => select(idea.id)}>
                        {idea.title}
                      </button>
                      <div className={styles.buttons}>
                        <button className="button button-ghost" disabled={busy} onClick={() => void change(idea, "keep")}>
                          Keep
                        </button>
                        <button className="button button-ghost" disabled={busy} onClick={() => void change(idea, "park")}>
                          Park
                        </button>
                        {confirmQuickDrop === idea.id ? (
                          <button
                            className="button button-ghost"
                            disabled={busy}
                            onClick={() => {
                              setConfirmQuickDrop("");
                              void change(idea, "drop");
                            }}
                          >
                            Confirm drop
                          </button>
                        ) : (
                          <button className="button button-ghost" disabled={busy} onClick={() => setConfirmQuickDrop(idea.id)}>
                            Drop
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

const CELL_W = 300;
const CELL_H = 130;

function ClusterMap({
  clusters,
  byId,
  selectedId,
  onSelect,
}: {
  clusters: string[][];
  byId: Map<string, IdeaWithDetail>;
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  if (!clusters.length) return <p className={styles.muted}>Link two growing ideas to see a cluster here.</p>;
  const shown = clusters.slice(0, 6);
  return (
    <svg
      className={styles.map}
      viewBox={`0 0 ${CELL_W} ${shown.length * CELL_H}`}
      role="group"
      aria-label="Map of linked ideas"
    >
      <title>Map of linked ideas</title>
      {shown.map((group, row) => {
        const cx = CELL_W / 2;
        const cy = row * CELL_H + CELL_H / 2;
        const radius = Math.min(42, 14 + group.length * 7);
        const points = new Map(
          group.map((id, index) => {
            const angle = (index / group.length) * Math.PI * 2 - Math.PI / 2;
            return [id, { x: cx + Math.cos(angle) * radius * 1.8, y: cy + Math.sin(angle) * radius }] as const;
          }),
        );
        const edges: [string, string, string][] = [];
        for (const id of group) {
          for (const link of byId.get(id)?.links ?? []) {
            if (link.status !== "accepted" || link.targetKind !== "idea") continue;
            if (link.ideaId === id && points.has(link.targetId)) edges.push([link.id, link.ideaId, link.targetId]);
          }
        }
        return (
          <g key={group.join("|")}>
            {edges.map(([key, a, b]) => (
              <line key={key} x1={points.get(a)!.x} y1={points.get(a)!.y} x2={points.get(b)!.x} y2={points.get(b)!.y} className={styles.edge} />
            ))}
            {group.map((id) => {
              const point = points.get(id)!;
              const idea = byId.get(id);
              const title = idea?.title ?? "Idea";
              return (
                <g
                  key={id}
                  className={styles.node}
                  tabIndex={0}
                  role="button"
                  aria-label={`Select idea ${title}`}
                  aria-pressed={selectedId === id}
                  onClick={() => onSelect(id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(id);
                    }
                  }}
                >
                  <circle cx={point.x} cy={point.y} r={7} className={selectedId === id ? styles.dotActive : styles.dot} />
                  <text x={point.x} y={point.y + 19} textAnchor="middle">
                    {clip(title, 18)}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

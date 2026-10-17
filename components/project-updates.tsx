"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { ProjectRoute } from "@/lib/types";
import { parseHandoff, type HandoffAction, type ProjectHandoff, type SavedHandoff } from "@/lib/project-handoffs";
import styles from "./project-updates.module.css";
import type { HandoffSourceStatus } from "@/lib/handoff-files";

export function ProjectUpdates({ projects, onImport, openSettings }: {
  projects: ProjectRoute[];
  openSettings: () => void;
  onImport: (report: ProjectHandoff, actions: HandoffAction[]) => Promise<{ reports: SavedHandoff[]; added: number; ideas?: { ideasProposed: number; ideasSkipped: number; notesAdded: number; notesIgnored: number } }>;
}) {
  const [reports, setReports] = useState<SavedHandoff[]>([]);
  const [filter, setFilter] = useState("");
  const [preview, setPreview] = useState<ProjectHandoff | null>(null);
  const [drafts, setDrafts] = useState<HandoffAction[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [sources, setSources] = useState<HandoffSourceStatus[]>([]);
  const [sourceError, setSourceError] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let fetching = false;
    async function refresh() {
      if (fetching) return;
      fetching = true;
      try {
        const response = await fetch("/api/project-handoffs", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load updates.");
        if (!cancelled) { setReports(data.reports); setSources(data.sources || []); setSourceError(data.sourceError || ""); setLoading(false); setLoaded(true); }
      } catch (failure) { if (!cancelled) { setSourceError(failure instanceof Error ? failure.message : "Could not load updates."); setLoading(false); } }
      finally { fetching = false; }
    }
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 15_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [retry]);
  useEffect(() => {
    // Tasks link to the report they came from ("#report-<project>-<id>"). Only the
    // newest report per project is shown, so scroll to that project's card.
    if (loading || !reports.length || !window.location.hash.startsWith("#report-")) return;
    const target = reports.find((report) => `#report-${encodeURIComponent(report.projectId)}-${encodeURIComponent(report.id)}` === window.location.hash);
    if (target) document.getElementById(`project-${encodeURIComponent(target.projectId)}`)?.scrollIntoView();
  }, [loading, reports]);
  async function readFile(file?: File) {
    if (!file) return;
    setError(""); setNotice(""); setPreview(null);
    try {
      if (file.size > 500_000) throw new Error("Choose a JSON file smaller than 500 KB.");
      const report = parseHandoff(JSON.parse(await file.text()));
      if (!projects.some((project) => project.id === report.projectId)) throw new Error("The file's projectId must match a configured project. Download that project's template below.");
      reviewReport(report);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not read the file."); }
  }
  function reviewReport(report: ProjectHandoff) {
    setError(""); setNotice(""); setPreview(report); setDrafts(report.actions); setSelected([]);
  }
  function downloadTemplate(project: ProjectRoute) {
    const template: ProjectHandoff = { schemaVersion: 1, id: "session-unique-id", projectId: project.id,
      generatedAt: new Date().toISOString(), repository: "Repository URL or local checkout", commit: "commit-sha",
      summary: "Describe this session's progress.", status: "awaiting-review",
      completed: ["Work completed"], evidence: ["Tests run and their actual results"], decisions: ["A decision for the user"],
      actions: [{ id: "stable-action-id", title: "Next concrete action", description: "Explain the expected outcome.", priority: "Normal" }] };
    const url = URL.createObjectURL(new Blob([JSON.stringify(template, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${project.name.replace(/[^a-zA-Z0-9_-]/g, "-")}-handoff-template.json`; anchor.click(); URL.revokeObjectURL(url);
  }
  async function save() {
    if (!preview) return;
    setBusy(true); setError("");
    try {
      const result = await onImport(preview, drafts.filter((action) => selected.includes(action.id)));
      setReports(result.reports); setPreview(null);
      const ideas = result.ideas;
      const ideaNotice = !ideas ? "" : [
        ideas.ideasProposed && `${ideas.ideasProposed} idea${ideas.ideasProposed === 1 ? "" : "s"} waiting in Ideas.`,
        ideas.ideasSkipped && `${ideas.ideasSkipped} idea${ideas.ideasSkipped === 1 ? " was" : "s were"} not added (500 active ideas is the limit, so park or drop some).`,
        ideas.notesAdded && `${ideas.notesAdded} idea note${ideas.notesAdded === 1 ? "" : "s"} added.`,
        ideas.notesIgnored && `${ideas.notesIgnored} idea note${ideas.notesIgnored === 1 ? " was" : "s were"} ignored because the idea is closed or missing.`,
      ].filter(Boolean).join(" ");
      setNotice(`Report saved. ${result.added} new task${result.added === 1 ? "" : "s"} added. Previously accepted actions were preserved.${ideaNotice ? ` ${ideaNotice}` : ""}`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Import failed."); }
    finally { setBusy(false); }
  }
  const names = new Map(projects.map((project) => [project.id, project.name]));
  // Only each project's newest report is shown. Older reports stay saved, so a
  // re-imported report is still recognised and accepted actions are kept.
  const latest = [...reports]
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
    .filter((report, index, sorted) => sorted.findIndex((item) => item.projectId === report.projectId) === index)
    .filter((report) => !filter || report.projectId === filter);
  const projectChoices = [...new Map([
    ...projects.map((project) => [project.id, project.name] as const),
    ...reports.filter((report) => !names.has(report.projectId)).map((report) => [report.projectId, `${report.projectId} (removed project)`] as const),
  ]).entries()];
  const watching = sources.filter((source) => !filter || source.projectId === filter);
  return <div className={`view ${styles.view}`}>
    <header className={styles.head}>
      <div><p className="eyebrow">Project progress</p><h1>Updates</h1><p className={styles.muted}>The latest handoff from each project: what is done and what comes next.</p></div>
      <div className={styles.toolbar}>
        {projectChoices.length > 1 && <label className={styles.filter}><span>Project</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="">All projects</option>{projectChoices.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
        <label className={`button button-ghost ${styles.importButton}`} aria-disabled={busy || loading || !projects.length}>Import handoff<input type="file" accept=".json,application/json" disabled={busy || loading || !projects.length} onChange={(event) => { void readFile(event.target.files?.[0]); event.target.value = ""; }} /></label>
      </div>
    </header>
    <p className={styles.muted}>{sourceError ? <span role="alert">{sourceError}</span> : watching.length ? `Watching ${watching.length} report folder${watching.length === 1 ? "" : "s"}; checked every 15 seconds while this tab is open.` : "No report folders set up yet; see Sources and import below."}</p>
    {error && <div role="alert" className={styles.alert}>{error} {loading === false && !preview && <button className="button button-ghost" onClick={() => { setLoading(true); setRetry((value) => value + 1); }}>Retry</button>}</div>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {preview && <ReviewPanel
      report={preview} projectName={names.get(preview.projectId) || preview.projectId} drafts={drafts} setDrafts={setDrafts}
      selected={selected} setSelected={setSelected} busy={busy} onSave={() => void save()} onCancel={() => setPreview(null)}
    />}
    {loading ? <p role="status">Loading updates…</p>
      : !loaded ? <p>Updates could not be loaded. Check the message above and retry.</p>
        : !latest.length ? <div className={styles.card}><h2>No project updates yet</h2><p className={styles.muted}>When an agent finishes a session it writes a handoff, and the latest one for each project appears here.</p></div>
          : <div className={styles.grid}>{latest.map((report) => <ProjectCard
            key={report.projectId} report={report} projectName={names.get(report.projectId) || report.projectId}
            canReview={!busy && names.has(report.projectId)} onReview={() => reviewReport(report)}
          />)}</div>}
    <details className={styles.setup}>
      <summary>Sources and import</summary>
      {watching.map((source) => <p key={source.projectId}><strong>{names.get(source.projectId) || source.projectId}: {source.state}</strong> · {source.message}{source.lastReportedAt && ` Last reported ${new Date(source.lastReportedAt).toLocaleString()}.`}</p>)}
      {!sources.length && <p>No local report folders configured. See docs/PROJECT_HANDOFFS.md for setup.</p>}
      <p>Reports never add tasks without your approval. <button className="button button-ghost" disabled={busy} onClick={() => setRetry((value) => value + 1)}>Check for new reports</button></p>
      <p>To set up a project by hand, give its agent a template to fill in after each session. Use a new report ID each session and keep action IDs stable. <button className="button button-ghost" onClick={openSettings}>Project settings</button></p>
      <p>{projects.map((project) => <button key={project.id} className="button button-ghost" onClick={() => downloadTemplate(project)}>{project.name} template</button>)}</p>
    </details>
  </div>;
}

const STATUS_LABELS: Record<ProjectHandoff["status"], string> = {
  working: "In progress",
  blocked: "Blocked",
  "awaiting-review": "Needs your review",
};
const LIST_LIMIT = 5;

/** One line per item: whitespace collapsed and long entries cut at a word. */
function compress(text: string, max = 140) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).replace(/[\s,;:.-]+$/, "")}…`;
}

function ago(iso: string) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

function ShortList({ title, items, empty, tone }: { title: string; items: { key: string; text: string; tag?: string }[]; empty: string; tone: "done" | "next" }) {
  const [open, setOpen] = useState(false);
  const shown = open ? items : items.slice(0, LIST_LIMIT);
  return <div className={styles.list}>
    <h3>{title}{items.length > 0 && <span>{items.length}</span>}</h3>
    {items.length ? <ul className={tone === "done" ? styles.done : styles.next}>
      {shown.map((item) => <li key={item.key} title={item.text}>{item.tag && <b>{item.tag}</b>}{compress(item.text)}</li>)}
    </ul> : <p className={styles.muted}>{empty}</p>}
    {items.length > LIST_LIMIT && <button className="text-button" onClick={() => setOpen((value) => !value)}>{open ? "Show fewer" : `+${items.length - LIST_LIMIT} more`}</button>}
  </div>;
}

function ProjectCard({ report, projectName, canReview, onReview }: { report: SavedHandoff; projectName: string; canReview: boolean; onReview: () => void }) {
  const done = report.completed.map((text, index) => ({ key: `c${index}`, text }));
  const next = [
    ...report.decisions.map((text, index) => ({ key: `d${index}`, text, tag: "Decide" })),
    ...report.actions.map((action) => ({ key: `a${action.id}`, text: action.title, tag: action.priority === "High" ? "High" : undefined })),
  ];
  const ideas = report.ideas?.length ?? 0;
  return <article className={styles.card} id={`project-${encodeURIComponent(report.projectId)}`}>
    <header className={styles.cardHead}>
      <h2>{projectName}</h2>
      <span className={`${styles.status} ${styles[report.status === "awaiting-review" ? "needsReview" : report.status]}`}>{STATUS_LABELS[report.status]}</span>
      <time dateTime={report.generatedAt} title={new Date(report.generatedAt).toLocaleString()}>{ago(report.generatedAt)}</time>
    </header>
    <p className={styles.summary} title={report.summary}>{compress(report.summary, 260)}</p>
    <div className={styles.lists}>
      <ShortList title="Done" items={done} empty="Nothing reported as finished." tone="done" />
      <ShortList title="Next" items={next} empty="Nothing left to do in this report." tone="next" />
    </div>
    <div className={styles.cardFoot}>
      {ideas > 0 ? <span className={styles.muted}>{ideas} side idea{ideas === 1 ? "" : "s"} sent to Ideas</span> : <span />}
      {report.actions.length > 0 && <button className="button button-ghost" disabled={!canReview} onClick={onReview}>Add next steps to tasks</button>}
    </div>
  </article>;
}

function ReviewPanel({ report, projectName, drafts, setDrafts, selected, setSelected, busy, onSave, onCancel }: {
  report: ProjectHandoff; projectName: string; drafts: HandoffAction[]; setDrafts: Dispatch<SetStateAction<HandoffAction[]>>;
  selected: string[]; setSelected: Dispatch<SetStateAction<string[]>>; busy: boolean; onSave: () => void; onCancel: () => void;
}) {
  return <section className={`${styles.card} ${styles.review}`} aria-label="Handoff review">
    <header className={styles.cardHead}><h2>Review: {projectName}</h2><span className={styles.muted}>{STATUS_LABELS[report.status]}</span></header>
    <p className={styles.summary}>{compress(report.summary, 260)}</p>
    {report.completed.length > 0 && <ShortList title="Done" items={report.completed.map((text, index) => ({ key: `c${index}`, text }))} empty="" tone="done" />}
    <h3 className={styles.reviewHeading}>Choose which next steps become tasks</h3>
    {drafts.map((action, index) => <div className={styles.action} key={action.id}>
      <label className={styles.accept}><input type="checkbox" checked={selected.includes(action.id)} onChange={(event) => setSelected((values) => event.target.checked ? [...values, action.id] : values.filter((id) => id !== action.id))} /> Add as a task</label>
      <label>Task title<input value={action.title} maxLength={300} onChange={(event) => setDrafts((values) => values.map((value, i) => i === index ? { ...value, title: event.target.value } : value))} /></label>
      {action.description && <p className={styles.muted}>{compress(action.description, 220)}</p>}
      <div className={styles.actionRow}>
        <label>Priority<select value={action.priority} onChange={(event) => setDrafts((values) => values.map((value, i) => i === index ? { ...value, priority: event.target.value as HandoffAction["priority"] } : value))}><option>Low</option><option>Normal</option><option>High</option></select></label>
        <label>Due date<input type="date" value={action.due || ""} onChange={(event) => setDrafts((values) => values.map((value, i) => i === index ? { ...value, due: event.target.value || undefined } : value))} /></label>
      </div>
    </div>)}
    {!drafts.length && <p className={styles.muted}>This report proposes no tasks.</p>}
    {report.ideas?.length ? <p className={styles.muted}>{report.ideas.length} side idea{report.ideas.length === 1 ? "" : "s"} will wait for Keep in the Ideas tab.</p> : null}
    <div className={styles.reviewButtons}>
      <button className="button button-primary" disabled={busy} onClick={onSave}>{busy ? "Saving…" : selected.length ? `Save and add ${selected.length} task${selected.length === 1 ? "" : "s"}` : "Save report"}</button>
      <button className="button button-ghost" disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
  </section>;
}

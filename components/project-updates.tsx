"use client";

import { useEffect, useState } from "react";
import type { ProjectRoute } from "@/lib/types";
import { parseHandoff, type HandoffAction, type ProjectHandoff, type SavedHandoff } from "@/lib/project-handoffs";
import styles from "./project-updates.module.css";
import type { HandoffSourceStatus } from "@/lib/handoff-files";

export function ProjectUpdates({ projects, onImport, openSettings }: {
  projects: ProjectRoute[];
  openSettings: () => void;
  onImport: (report: ProjectHandoff, actions: HandoffAction[]) => Promise<{ reports: SavedHandoff[]; added: number }>;
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
    if (!loading && reports.length && window.location.hash) {
      document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
    }
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
      setNotice(`Report saved. ${result.added} new task${result.added === 1 ? "" : "s"} added. Previously accepted actions were preserved.`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Import failed."); }
    finally { setBusy(false); }
  }
  const visible = reports.filter((report) => !filter || report.projectId === filter)
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  const names = new Map(projects.map((project) => [project.id, project.name]));
  return <div className={`view ${styles.view}`}>
    <div><p className="eyebrow">Project progress</p><h1>Updates</h1><p>Read agent handoffs and choose which actions belong in your task list.</p></div>
    <div className={styles.toolbar}>
      <label>Updates project<select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="">All projects</option>{[...new Map([...projects.map((project) => [project.id, project.name] as const), ...reports.filter((report) => !names.has(report.projectId)).map((report) => [report.projectId, `${report.projectId} (removed project)`] as const)]).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label>Import agent handoff<input type="file" accept=".json,application/json" disabled={busy || loading || !projects.length} onChange={(event) => { void readFile(event.target.files?.[0]); event.target.value = ""; }} /></label>
    </div>
    <section className={styles.card} aria-label="Automatic handoff pickup"><h2>Automatic pickup</h2><p>Configured local report folders are checked every 15 seconds while Updates is open and visible. Reports never add tasks without your approval.</p>
      {!sources.length && !sourceError && <p>No local report folders configured. See docs/PROJECT_HANDOFFS.md for setup.</p>}
      {sources.filter((source) => !filter || source.projectId === filter).map((source) => <p key={source.projectId}><strong>{projects.find((project) => project.id === source.projectId)?.name || source.projectId}: {source.state}</strong> · {source.message}{source.lastReportedAt && ` Last reported ${new Date(source.lastReportedAt).toLocaleString()}.`}</p>)}
      {sourceError && <p role="alert">{sourceError}</p>}<button className="button button-ghost" disabled={busy} onClick={() => setRetry((value) => value + 1)}>Check for new reports</button>
    </section>
    <details className={styles.card}><summary>Get a handoff template for your agent</summary><p>Ask the agent to fill in this JSON and write a readable Markdown handoff beside it. Use a new report ID each session and keep action IDs stable across sessions. Files are reviewed locally before saving.</p><p>Set up projects first. <button className="button button-ghost" onClick={openSettings}>Open project settings</button></p>{projects.map((project) => <button key={project.id} className="button button-ghost" onClick={() => downloadTemplate(project)}>Download {project.name} template</button>)}</details>
    {error && <div role="alert" className={styles.card}>{error} {loading === false && !preview && <button className="button button-ghost" onClick={() => { setLoading(true); setRetry((value) => value + 1); }}>Retry loading updates</button>}</div>}
    {notice && <p role="status">{notice}</p>}
    {preview && <section className={styles.card} aria-label="Handoff preview">
      <h2>Review: {names.get(preview.projectId)}</h2><p>{preview.summary}</p><p>{preview.status} · {new Date(preview.generatedAt).toLocaleString()}</p><p>Repository: {preview.repository} · Commit: {preview.commit || "Not provided"}</p>
      <ReportLists report={preview} />
      <h3>Proposed tasks</h3><p>Select the actions to accept. You can edit their title, priority, and due date first. No date means no deadline.</p>
      {drafts.map((action, index) => <div className={styles.action} key={action.id}>
        <label><input type="checkbox" checked={selected.includes(action.id)} onChange={(event) => setSelected((values) => event.target.checked ? [...values, action.id] : values.filter((id) => id !== action.id))} /> Accept {action.title}</label>
        <label>Task title<input value={action.title} maxLength={300} onChange={(event) => setDrafts((values) => values.map((value, i) => i === index ? { ...value, title: event.target.value } : value))} /></label>
        <p>{action.description}</p>
        <label>Priority<select value={action.priority} onChange={(event) => setDrafts((values) => values.map((value, i) => i === index ? { ...value, priority: event.target.value as HandoffAction["priority"] } : value))}><option>Low</option><option>Normal</option><option>High</option></select></label>
        <label>Due date<input type="date" value={action.due || ""} onChange={(event) => setDrafts((values) => values.map((value, i) => i === index ? { ...value, due: event.target.value || undefined } : value))} /></label>
      </div>)}
      {!drafts.length && <p>This report proposes no tasks.</p>}
      <button className="button button-primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : `Save report and accept ${selected.length} actions`}</button> <button className="button button-ghost" disabled={busy} onClick={() => setPreview(null)}>Cancel</button>
    </section>}
    {loading ? <p role="status">Loading updates…</p> : !loaded ? <p>Updates could not be loaded. Check the error above and retry.</p> : !visible.length ? <div className={styles.card}><h2>No project updates yet</h2><p>Await an automatic agent export or import a handoff JSON to start tracking progress.</p></div> : visible.map((report, index) => <article className={styles.card} id={`report-${encodeURIComponent(report.projectId)}-${encodeURIComponent(report.id)}`} key={`${report.projectId}:${report.id}`}>
      <h2>{names.get(report.projectId) || report.projectId}</h2><p>{report.status} · Reported {new Date(report.generatedAt).toLocaleString()} {visible.findIndex((item) => item.projectId === report.projectId) === index && "· Latest report"}</p><p>{report.summary}</p>
      <p>Repository: {report.repository} · Commit: {report.commit || "Not provided"}</p><ReportLists report={report} />
      <details><summary>Proposed actions ({report.actions.length})</summary><ul>{report.actions.map((action) => <li key={action.id}>{action.title} ({action.priority})</li>)}</ul><p>Review this report to accept previously skipped actions. Completed or deleted accepted tasks stay unchanged.</p></details>
      <button className="button button-ghost" disabled={busy || !names.has(report.projectId)} onClick={() => reviewReport(report)}>Review actions</button>
    </article>)}
  </div>;
}
function ReportLists({ report }: { report: ProjectHandoff }) {
  return <>{([ ["Completed", report.completed], ["Evidence", report.evidence], ["Decisions needed", report.decisions] ] as const).map(([heading, entries]) => <div key={heading}><h3>{heading}</h3>{entries.length ? <ul>{entries.map((entry, index) => <li key={index}>{entry}</li>)}</ul> : <p>None reported.</p>}</div>)}</>;
}

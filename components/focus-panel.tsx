"use client";

import { useEffect, useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { ArrowRight, Check, Flame, ListTodo, Moon, Pin, Trash2 } from "lucide-react";
import {
  MAX_FIRST_STEP_LENGTH,
  MAX_JOURNAL_TEXT_LENGTH,
  STUCK_POSTPONE_COUNT,
  addDays,
  currentStreak,
  dayRecap,
  isStuck,
  localDay,
  pickNextTask,
  pinForTomorrow,
  postponeTask,
  projectActivity,
  resolveStuckTask,
  shippedDays,
  suggestFirstSteps,
  weeklyReview,
  type JournalEntry,
  type ReportActivity,
} from "@/lib/focus";
import { completeTaskItems } from "@/lib/tasks";
import type { ProjectRoute, TaskItem } from "@/lib/types";
import styles from "./focus-panel.module.css";

type FocusHistory = { journal: JournalEntry[]; reports: ReportActivity[] };

const SHUTDOWN_HOUR = 17;
const IDLE_WARNING_DAYS = 7;

function dueLabel(task: TaskItem, today: string) {
  if (task.due === today || task.due === "Today") return "Due today";
  if (/^\d{4}-\d{2}-\d{2}$/.test(task.due)) {
    if (task.due < today) return "Overdue";
    if (task.due === addDays(today, 1)) return "Due tomorrow";
    const [year, month, day] = task.due.split("-").map(Number);
    return `Due ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(year, month - 1, day, 12))}`;
  }
  return "No due date";
}

function idleLabel(idleDays?: number) {
  if (idleDays === undefined) return "No activity yet";
  if (idleDays === 0) return "Active today";
  if (idleDays === 1) return "Active yesterday";
  return `${idleDays} days idle`;
}

function StuckTask({
  task,
  today,
  setTasks,
}: {
  task: TaskItem;
  today: string;
  setTasks: Dispatch<SetStateAction<TaskItem[]>>;
}) {
  const [firstStep, setFirstStep] = useState("");
  const [due, setDue] = useState(addDays(today, 1));
  return (
    <li className={styles.stuckItem}>
      <div>
        <b>{task.title}</b>
        <small>Put off {task.postponedCount} times. Pick one.</small>
      </div>
      <form
        className={styles.stuckChoice}
        onSubmit={(event) => {
          event.preventDefault();
          if (firstStep.trim())
            setTasks((values) => resolveStuckTask(values, task.id, { kind: "break-down", firstStep }));
        }}
      >
        <input
          aria-label={`Smaller first step for ${task.title}`}
          value={firstStep}
          maxLength={MAX_FIRST_STEP_LENGTH}
          onChange={(event) => setFirstStep(event.target.value)}
          placeholder="A smaller first step"
        />
        <button className="button button-ghost" disabled={!firstStep.trim()}>
          Break it down
        </button>
      </form>
      <form
        className={styles.stuckChoice}
        onSubmit={(event) => {
          event.preventDefault();
          setTasks((values) => resolveStuckTask(values, task.id, { kind: "schedule", due }));
        }}
      >
        <input
          type="date"
          aria-label={`New date for ${task.title}`}
          required
          min={today}
          value={due}
          onChange={(event) => setDue(event.target.value)}
        />
        <button className="button button-ghost">Schedule it</button>
      </form>
      <button
        className={`text-button danger ${styles.stuckDelete}`}
        onClick={() => setTasks((values) => resolveStuckTask(values, task.id, { kind: "delete" }))}
      >
        <Trash2 size={13} /> Delete it
      </button>
    </li>
  );
}

export function FocusPanel({
  tasks,
  setTasks,
  projects,
  openTasks,
}: {
  tasks: TaskItem[];
  setTasks: Dispatch<SetStateAction<TaskItem[]>>;
  projects: ProjectRoute[];
  openTasks: () => void;
}) {
  const [now, setNow] = useState(() => new Date());
  const today = localDay(now);
  const [history, setHistory] = useState<FocusHistory>({ journal: [], reports: [] });
  const [historyError, setHistoryError] = useState("");
  const [stepDraft, setStepDraft] = useState("");
  const [shipped, setShipped] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [attachTo, setAttachTo] = useState("");
  const [editingShutdown, setEditingShutdown] = useState(false);
  const [savingShutdown, setSavingShutdown] = useState(false);
  const [shutdownError, setShutdownError] = useState("");

  // The dashboard is often left open overnight; keep "today" current.
  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = window.setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/focus")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Focus history could not be loaded.");
        if (!cancelled) setHistory({ journal: body.journal ?? [], reports: body.reports ?? [] });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setHistoryError(error instanceof Error ? error.message : "Focus history could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [untouchedIdeas, setUntouchedIdeas] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/ideas")
      .then(async (response) => {
        const body = (await response.json()) as { ideas?: { untouched?: boolean }[] };
        if (!response.ok || cancelled) return;
        setUntouchedIdeas((body.ideas ?? []).filter((idea) => idea.untouched === true).length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const activity = useMemo(
    () => projectActivity(projects, tasks, history.reports, now),
    [projects, tasks, history.reports, now],
  );
  const next = useMemo(() => pickNextTask(tasks, activity, now), [tasks, activity, now]);
  const days = useMemo(() => shippedDays(tasks, history.reports), [tasks, history.reports]);
  const streak = currentStreak(days, now);
  const review = useMemo(
    () => weeklyReview(projects, tasks, history.reports, now),
    [projects, tasks, history.reports, now],
  );
  const stuck = tasks.filter(isStuck);
  const week = Array.from({ length: 7 }, (_, index) => addDays(today, index - 6));
  const todayEntry = history.journal.find((entry) => entry.day === today);
  const recap = useMemo(
    () => dayRecap(projects, tasks, history.reports, now),
    [projects, tasks, history.reports, now],
  );
  const tomorrowTask =
    tasks.find((task) => !task.done && task.pinnedFor === addDays(today, 1)) ?? recap.tomorrowTask;
  const evening = now.getHours() >= SHUTDOWN_HOUR;
  const openTaskList = tasks.filter((task) => !task.done);
  const projectName = (id?: string) => projects.find((project) => project.id === id)?.name;

  const saveFirstStep = (event: FormEvent) => {
    event.preventDefault();
    const firstStep = stepDraft.trim().slice(0, MAX_FIRST_STEP_LENGTH);
    if (!next || !firstStep) return;
    setTasks((values) => values.map((task) => (task.id === next.id ? { ...task, firstStep } : task)));
    setStepDraft("");
  };

  const applyFirstStep = (firstStep: string) => {
    if (!next) return;
    setTasks((values) => values.map((task) => (task.id === next.id ? { ...task, firstStep } : task)));
    setStepDraft("");
  };

  // One click: record the day from what the dashboard already knows and pin tomorrow's task.
  const shutDown = async () => {
    const closingAt = new Date();
    const closing = dayRecap(projects, tasks, history.reports, closingAt);
    setSavingShutdown(true);
    setShutdownError("");
    try {
      const response = await fetch("/api/focus", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day: closing.day, shipped: closing.shippedText, nextStep: closing.nextStepText }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not shut down the day.");
      setHistory((value) => ({
        ...value,
        journal: [body as JournalEntry, ...value.journal.filter((entry) => entry.day !== closing.day)],
      }));
      setNow(closingAt);
      if (closing.tomorrowTask)
        setTasks((values) =>
          pinForTomorrow(values, "", closingAt, { existingTaskId: closing.tomorrowTask!.id }),
        );
    } catch (error) {
      setShutdownError(error instanceof Error ? error.message : "Could not shut down the day.");
    } finally {
      setSavingShutdown(false);
    }
  };

  const startShutdownEdit = () => {
    setShipped(todayEntry?.shipped ?? "");
    setNextStep(todayEntry?.nextStep ?? "");
    const pinned = tasks.find((task) => !task.done && task.pinnedFor === addDays(today, 1));
    setAttachTo(pinned ? String(pinned.id) : "");
    setShutdownError("");
    setEditingShutdown(true);
  };

  const saveShutdown = async (event: FormEvent) => {
    event.preventDefault();
    if (!shipped.trim() && !nextStep.trim()) {
      setShutdownError("Write what you shipped or tomorrow's first step.");
      return;
    }
    const savedAt = new Date();
    const day = localDay(savedAt);
    setSavingShutdown(true);
    setShutdownError("");
    try {
      const response = await fetch("/api/focus", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day, shipped, nextStep }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save the shutdown note.");
      setHistory((value) => ({
        ...value,
        journal: [body as JournalEntry, ...value.journal.filter((entry) => entry.day !== day)],
      }));
      setNow(savedAt);
      const existing = openTaskList.find((task) => String(task.id) === attachTo);
      // Re-saving an unchanged step for the task already pinned must not create a copy of it.
      const alreadyPinned =
        existing?.pinnedFor === addDays(day, 1) &&
        nextStep.trim() === (todayEntry?.nextStep ?? "").trim();
      if (!alreadyPinned && (nextStep.trim() || existing)) {
        setTasks((values) =>
          pinForTomorrow(values, nextStep, savedAt, { existingTaskId: existing?.id }),
        );
      }
      setEditingShutdown(false);
    } catch (error) {
      setShutdownError(error instanceof Error ? error.message : "Could not save the shutdown note.");
    } finally {
      setSavingShutdown(false);
    }
  };

  return (
    <section className={`${styles.focus} reveal`} aria-label="Focus">
      <div className={styles.top}>
        <div className={styles.next}>
          <p className="eyebrow">
            Do this next
            {next?.pinnedFor && next.pinnedFor <= today && (
              <span className={styles.pinned}>
                <Pin size={10} /> Chosen last night
              </span>
            )}
          </p>
          {next ? (
            <>
              <h2>{next.title}</h2>
              <p className={styles.meta}>
                {[projectName(next.projectId), dueLabel(next, today)].filter(Boolean).join(" · ")}
                {(next.postponedCount ?? 0) > 0 &&
                  ` · put off ${next.postponedCount} of ${STUCK_POSTPONE_COUNT} times`}
              </p>
              {next.firstStep ? (
                <div className={styles.step}>
                  <span>Start with</span>
                  <p>{next.firstStep}</p>
                </div>
              ) : (
                <form className={styles.stepForm} onSubmit={saveFirstStep}>
                  <label htmlFor="focus-first-step">What can you do on this in two minutes?</label>
                  <div>
                    <input
                      id="focus-first-step"
                      value={stepDraft}
                      maxLength={MAX_FIRST_STEP_LENGTH}
                      onChange={(event) => setStepDraft(event.target.value)}
                      placeholder="Open the file and write the first line"
                    />
                    <button className="button button-ghost" disabled={!stepDraft.trim()}>
                      Save step
                    </button>
                  </div>
                  <div className={styles.suggestions}>
                    <span>Or start with</span>
                    {suggestFirstSteps(next).map((suggestion) => (
                      <button type="button" key={suggestion} onClick={() => applyFirstStep(suggestion)}>
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </form>
              )}
              <div className={styles.actions}>
                <button
                  className="button button-primary"
                  onClick={() =>
                    setTasks((values) => completeTaskItems(values, next.id, { expectedDue: next.due }))
                  }
                >
                  <Check size={15} /> Done
                </button>
                <button
                  className="button button-ghost"
                  onClick={() => setTasks((values) => postponeTask(values, next.id, new Date()))}
                >
                  Not today
                </button>
                <button className="text-button" onClick={openTasks}>
                  All tasks <ArrowRight size={13} />
                </button>
              </div>
            </>
          ) : (
            <div className={styles.empty}>
              <ListTodo size={22} />
              <div>
                <h2>
                  {!openTaskList.length
                    ? "Nothing queued"
                    : stuck.length === openTaskList.length
                      ? "Everything left needs a decision"
                      : "Nothing else for today"}
                </h2>
                <p>
                  {!openTaskList.length
                    ? "Add one task that would make today count."
                    : stuck.length === openTaskList.length
                      ? "Every open task has been put off too often. Decide on them below."
                      : "The rest was moved to tomorrow. Write the shutdown note and stop."}
                </p>
              </div>
              {!openTaskList.length && (
                <button className="button button-primary" onClick={openTasks}>
                  Add a task
                </button>
              )}
            </div>
          )}
        </div>

        <div className={styles.streak}>
          <div className={styles.streakHead}>
            <Flame size={20} className={streak.length ? styles.lit : undefined} />
            <div>
              <strong>{streak.length}</strong>
              <span>{streak.length === 1 ? "day shipping streak" : "days shipping streak"}</span>
            </div>
          </div>
          <ol className={styles.week} aria-label="Days with shipped work in the last week">
            {week.map((day) => (
              <li key={day} className={days.has(day) ? styles.shipped : undefined}>
                <span aria-hidden="true">
                  {new Intl.DateTimeFormat(undefined, { weekday: "narrow" }).format(
                    new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), 12),
                  )}
                </span>
                <span className={styles.srOnly}>
                  {day}: {days.has(day) ? "shipped" : "nothing shipped"}
                </span>
              </li>
            ))}
          </ol>
          <p className={styles.streakNote}>
            {streak.shippedToday
              ? "Today counts. A completed task or an agent report is what moves this."
              : "Nothing shipped yet today. Finish one task to keep it going."}
          </p>
          {activity.length > 0 && (
            <ul className={styles.projects}>
              {activity.map((project) => (
                <li
                  key={project.id}
                  className={
                    project.idleDays === undefined || project.idleDays >= IDLE_WARNING_DAYS
                      ? styles.idle
                      : undefined
                  }
                >
                  <b>{project.name}</b>
                  <span>
                    {idleLabel(project.idleDays)} · {project.openTasks} open
                  </span>
                </li>
              ))}
            </ul>
          )}
          {historyError && <p className={styles.error}>{historyError}</p>}
        </div>
      </div>

      {stuck.length > 0 && (
        <div className={styles.stuck}>
          <p className="eyebrow">Stuck · decide now</p>
          <ul>
            {stuck.map((task) => (
              <StuckTask key={task.id} task={task} today={today} setTasks={setTasks} />
            ))}
          </ul>
        </div>
      )}

      <div className={styles.shutdown}>
        <Moon size={17} />
        {editingShutdown ? (
          <form onSubmit={saveShutdown}>
            <p className="eyebrow">Shutdown note</p>
            <label>
              What did you ship today?
              <textarea
                value={shipped}
                maxLength={MAX_JOURNAL_TEXT_LENGTH}
                onChange={(event) => setShipped(event.target.value)}
                placeholder="One or two lines. Nothing is a valid answer."
              />
            </label>
            <label>
              What is tomorrow&apos;s first step?
              <input
                value={nextStep}
                maxLength={MAX_FIRST_STEP_LENGTH}
                onChange={(event) => setNextStep(event.target.value)}
                placeholder="Small enough to start without thinking"
              />
            </label>
            <label>
              It belongs to
              <select value={attachTo} onChange={(event) => setAttachTo(event.target.value)}>
                <option value="">A new task</option>
                {openTaskList.map((task) => (
                  <option key={task.id} value={String(task.id)}>
                    {task.title}
                  </option>
                ))}
              </select>
            </label>
            {shutdownError && <p className={styles.error}>{shutdownError}</p>}
            <div className={styles.actions}>
              <button className="button button-primary" disabled={savingShutdown}>
                {savingShutdown ? "Saving" : "Save and finish the day"}
              </button>
              <button type="button" className="button button-ghost" onClick={() => setEditingShutdown(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : todayEntry ? (
          <div className={styles.recap}>
            <div className={styles.recapHead}>
              <p className="eyebrow">Day closed</p>
              <button className="text-button" onClick={startShutdownEdit}>
                Edit note
              </button>
            </div>
            <div className={styles.recapColumns}>
              <div>
                <h3>Today</h3>
                {recap.completed.length + recap.reports.length + recap.postponed.length === 0 ? (
                  <p>Nothing was completed or reported today.</p>
                ) : (
                  <ul>
                    {recap.completed.map((task) => (
                      <li key={`done-${task.id}`}>
                        <b>Done</b> {task.title}
                      </li>
                    ))}
                    {recap.reports.map((report, index) => (
                      <li key={`report-${index}`}>
                        <b>{report.projectName} agent</b> {report.summary || "Filed a report."}
                      </li>
                    ))}
                    {recap.postponed.map((task) => (
                      <li key={`postponed-${task.id}`} className={styles.recapMuted}>
                        <b>Put off</b> {task.title}
                      </li>
                    ))}
                  </ul>
                )}
                {todayEntry.shipped && todayEntry.shipped !== recap.shippedText && (
                  <p className={styles.recapNote}>
                    <b>Your note:</b> {todayEntry.shipped}
                  </p>
                )}
              </div>
              <div>
                <h3>Tomorrow</h3>
                {tomorrowTask ? (
                  <>
                    <p className={styles.recapLead}>{tomorrowTask.title}</p>
                    <p>
                      <b>Start with:</b>{" "}
                      {tomorrowTask.firstStep || "no first step yet. Pick one in the morning."}
                    </p>
                  </>
                ) : (
                  <p>Nothing is queued. Add one task before you start tomorrow.</p>
                )}
                {recap.dueTomorrow.length > 0 && (
                  <p>
                    <b>Also due:</b> {recap.dueTomorrow.map((task) => task.title).join("; ")}
                  </p>
                )}
                {recap.stuck.length > 0 && (
                  <p>
                    <b>Needs a decision:</b> {recap.stuck.length}{" "}
                    {recap.stuck.length === 1 ? "stuck task" : "stuck tasks"}
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.shutdownDone}>
            <div>
              <p className="eyebrow">End of day</p>
              <p>
                One click closes the day: it records what you finished and lines up tomorrow&apos;s
                first task.
              </p>
              {shutdownError && <p className={styles.error}>{shutdownError}</p>}
            </div>
            <button
              className={`button ${evening ? "button-primary" : "button-ghost"}`}
              disabled={savingShutdown}
              onClick={shutDown}
            >
              <Moon size={15} /> {savingShutdown ? "Closing" : "Shut down for the day"}
            </button>
          </div>
        )}
      </div>

      <details className={styles.review} open={now.getDay() <= 1}>
        <summary>
          <span className="eyebrow">Weekly review</span>
          <b>
            {review.shippedDays} of 7 days shipped · {review.completedTasks}{" "}
            {review.completedTasks === 1 ? "task" : "tasks"} · {review.reports}{" "}
            {review.reports === 1 ? "agent report" : "agent reports"}
          </b>
        </summary>
        {review.byProject.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th scope="col">Project</th>
                <th scope="col">Tasks done</th>
                <th scope="col">Agent reports</th>
              </tr>
            </thead>
            <tbody>
              {review.byProject.map((project) => (
                <tr key={project.id}>
                  <th scope="row">{project.name}</th>
                  <td>{project.completed}</td>
                  <td>{project.reports}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>Add projects in Settings to see the week by project.</p>
        )}
        {review.untouched.length > 0 && (
          <p>
            <b>Untouched this week:</b>{" "}
            {review.untouched
              .map((project) =>
                project.idleDays === undefined ? `${project.name} (never)` : `${project.name} (${project.idleDays} days)`,
              )
              .join(", ")}
          </p>
        )}
        <p>
          <b>Ideas untouched for 21+ days:</b> {untouchedIdeas}
        </p>
        <p>
          <b>Put off {STUCK_POSTPONE_COUNT} or more times:</b>{" "}
          {review.stuck.length
            ? `${review.stuck.length} ${review.stuck.length === 1 ? "task needs" : "tasks need"} a decision above.`
            : "none."}
        </p>
      </details>
    </section>
  );
}

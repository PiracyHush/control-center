import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  STUCK_POSTPONE_COUNT,
  currentStreak,
  isLocalDay,
  isStuck,
  localDay,
  pickNextTask,
  pinForTomorrow,
  postponeTask,
  projectActivity,
  resolveStuckTask,
  shippedDays,
  weeklyReview,
} from "../lib/focus";
import {
  initializeFocusStore,
  listJournalEntries,
  parseJournalEntry,
  saveJournalEntry,
} from "../lib/focus-store";
import { cleanTaskItems } from "../lib/tasks";
import type { ProjectRoute, TaskItem } from "../lib/types";

const now = new Date(2026, 9, 14, 10); // Wednesday 14 October 2026, local time
const at = (day: number, hour = 12) => new Date(2026, 9, day, hour).toISOString();
const projects: ProjectRoute[] = [
  { id: "scout", name: "Market Scout", keywords: [] },
  { id: "climate", name: "Climate Discount", keywords: [] },
];

function task(overrides: Partial<TaskItem> & Pick<TaskItem, "id">): TaskItem {
  return {
    title: `Task ${overrides.id}`,
    description: "",
    due: "No date",
    recurrence: "One-time",
    priority: "Normal",
    done: false,
    ...overrides,
  };
}

test("only completed tasks and agent reports count as shipped days", () => {
  const days = shippedDays(
    [
      task({ id: 1, done: true, completedAt: at(13) }),
      task({ id: 2, done: false, completedAt: at(12) }),
      task({ id: 3, done: true }),
      task({ id: 4, done: true, completedAt: "not a date" }),
    ],
    [{ projectId: "scout", generatedAt: at(11) }],
  );
  assert.deepEqual([...days].sort(), ["2026-10-11", "2026-10-13"]);
});

test("a streak survives an unfinished today but not a missed yesterday", () => {
  assert.deepEqual(currentStreak(new Set(["2026-10-12", "2026-10-13"]), now), {
    length: 2,
    shippedToday: false,
  });
  assert.deepEqual(
    currentStreak(new Set(["2026-10-12", "2026-10-13", "2026-10-14"]), now),
    { length: 3, shippedToday: true },
  );
  assert.equal(currentStreak(new Set(["2026-10-11", "2026-10-12"]), now).length, 0);
  assert.equal(currentStreak(new Set(), now).length, 0);
});

test("project activity reports idle days and never-touched projects", () => {
  const activity = projectActivity(
    projects,
    [
      task({ id: 1, projectId: "scout", done: true, completedAt: at(10) }),
      task({ id: 2, projectId: "scout" }),
    ],
    [{ projectId: "scout", generatedAt: at(12) }],
    now,
  );
  assert.deepEqual(activity, [
    { id: "scout", name: "Market Scout", lastActiveDay: "2026-10-12", idleDays: 2, openTasks: 1 },
    { id: "climate", name: "Climate Discount", lastActiveDay: undefined, idleDays: undefined, openTasks: 0 },
  ]);
});

test("the next task prefers last night's pin, then due work, then the idlest project", () => {
  const activity = projectActivity(
    projects,
    [task({ id: 0, projectId: "scout", done: true, completedAt: at(13) })],
    [],
    now,
  );
  const pinned = task({ id: "pinned", pinnedFor: "2026-10-14" });
  const due = task({ id: "due", due: "2026-10-14", projectId: "scout" });
  const idleProject = task({ id: "idle", projectId: "climate" });
  const activeProject = task({ id: "active", projectId: "scout" });
  const future = task({ id: "future", due: "2026-10-20", projectId: "climate" });

  assert.equal(pickNextTask([activeProject, idleProject, due, pinned], activity, now)?.id, "pinned");
  assert.equal(pickNextTask([activeProject, idleProject, due], activity, now)?.id, "due");
  assert.equal(pickNextTask([activeProject, future, idleProject], activity, now)?.id, "idle");
  assert.equal(pickNextTask([future, activeProject], activity, now)?.id, "active");
});

test("the next task prefers one with a first step and never offers stuck or done tasks", () => {
  const withStep = task({ id: "step", firstStep: "Open the file" });
  const stuck = task({ id: "stuck", due: "2026-10-14", postponedCount: STUCK_POSTPONE_COUNT });
  const done = task({ id: "done", done: true, pinnedFor: "2026-10-14" });
  assert.equal(pickNextTask([task({ id: "plain" }), withStep, stuck, done], [], now)?.id, "step");
  assert.equal(pickNextTask([stuck, done], [], now), undefined);
});

test("postponing moves a task to tomorrow, clears its pin, and makes it stuck on the third time", () => {
  let tasks = [task({ id: 1, due: "2026-10-14", pinnedFor: "2026-10-14" }), task({ id: 2 })];
  tasks = postponeTask(tasks, 1, now);
  assert.equal(tasks[0].due, "2026-10-15");
  assert.equal(tasks[0].pinnedFor, undefined);
  assert.equal(tasks[0].postponedCount, 1);
  assert.equal(tasks[0].postponedOn, "2026-10-14");
  assert.equal(isStuck(tasks[0]), false);
  assert.equal(pickNextTask(tasks, [], now)?.id, 2, "not offered again the same day");
  assert.equal(pickNextTask(tasks, [], new Date(2026, 9, 15, 9))?.id, 1, "offered again tomorrow");
  assert.equal(postponeTask(tasks, 1, now)[0], tasks[0], "a second click the same day changes nothing");
  tasks = postponeTask(postponeTask(tasks, 1, new Date(2026, 9, 15, 9)), 1, new Date(2026, 9, 16, 9));
  assert.equal(tasks[0].postponedCount, 3);
  assert.equal(isStuck(tasks[0]), true);
  assert.deepEqual(tasks[1], task({ id: 2 }));
});

test("a stuck task can be broken down, scheduled, or deleted", () => {
  const tasks = [task({ id: 1, postponedCount: 4 }), task({ id: 2 })];
  const broken = resolveStuckTask(tasks, 1, { kind: "break-down", firstStep: "  List the controls  " });
  assert.equal(broken[0].firstStep, "List the controls");
  assert.equal(broken[0].postponedCount, 0);
  assert.equal(resolveStuckTask(tasks, 1, { kind: "break-down", firstStep: "   " })[0].postponedCount, 4);

  const scheduled = resolveStuckTask(tasks, 1, { kind: "schedule", due: "2026-10-20" });
  assert.equal(scheduled[0].due, "2026-10-20");
  assert.equal(scheduled[0].postponedCount, 0);
  assert.equal(resolveStuckTask(tasks, 1, { kind: "schedule", due: "soon" })[0].postponedCount, 4);

  assert.deepEqual(resolveStuckTask(tasks, 1, { kind: "delete" }).map((item) => item.id), [2]);
});

test("a shutdown note pins an existing task or creates tomorrow's task", () => {
  const tasks = [task({ id: 1, pinnedFor: "2026-10-15" }), task({ id: 2 })];

  const attached = pinForTomorrow(tasks, "Draft the intro", now, { existingTaskId: 2 });
  assert.equal(attached.length, 2);
  assert.equal(attached[0].pinnedFor, undefined, "the earlier pin for the same day is released");
  assert.equal(attached[1].pinnedFor, "2026-10-15");
  assert.equal(attached[1].firstStep, "Draft the intro");

  const created = pinForTomorrow(tasks, "Email the dataset owner", now, { newTaskId: "new" });
  assert.equal(created.length, 3);
  assert.deepEqual(
    { id: created[0].id, title: created[0].title, due: created[0].due, pinnedFor: created[0].pinnedFor },
    { id: "new", title: "Email the dataset owner", due: "2026-10-15", pinnedFor: "2026-10-15" },
  );
  assert.equal(created[1].pinnedFor, undefined);

  assert.equal(pinForTomorrow(tasks, "   ", now), tasks);
});

test("the weekly review counts the last seven days by project", () => {
  const review = weeklyReview(
    projects,
    [
      task({ id: 1, projectId: "scout", done: true, completedAt: at(13) }),
      task({ id: 2, projectId: "scout", done: true, completedAt: at(8) }),
      task({ id: 3, projectId: "scout", done: true, completedAt: at(7) }),
      task({ id: 4, done: true, completedAt: at(14, 9) }),
      task({ id: 5, projectId: "climate", postponedCount: 3 }),
    ],
    [{ projectId: "scout", generatedAt: at(13) }],
    now,
  );
  assert.equal(review.from, "2026-10-08");
  assert.equal(review.to, "2026-10-14");
  assert.equal(review.completedTasks, 3);
  assert.equal(review.reports, 1);
  assert.equal(review.shippedDays, 3);
  assert.deepEqual(review.byProject, [
    { id: "scout", name: "Market Scout", completed: 2, reports: 1 },
    { id: "climate", name: "Climate Discount", completed: 0, reports: 0 },
  ]);
  assert.deepEqual(review.untouched, [{ id: "climate", name: "Climate Discount", idleDays: undefined }]);
  assert.deepEqual(review.stuck.map((item) => item.id), [5]);
});

test("local day helpers reject impossible dates", () => {
  assert.equal(localDay(now), "2026-10-14");
  assert.equal(isLocalDay("2026-10-14"), true);
  for (const value of ["2026-02-30", "2026-13-01", "14-10-2026", "", null, 20261014])
    assert.equal(isLocalDay(value), false, String(value));
});

test("task cleaning keeps valid focus fields and drops invalid ones", () => {
  const [kept, dropped] = cleanTaskItems([
    { id: 1, title: "A", firstStep: `  ${"x".repeat(300)}  `, postponedCount: 2, postponedOn: "2026-10-14", pinnedFor: "2026-10-15" },
    { id: 2, title: "B", firstStep: 5, postponedCount: -1, postponedOn: "today", pinnedFor: "tomorrow" },
  ]);
  assert.equal(kept.firstStep?.length, 200);
  assert.equal(kept.postponedCount, 2);
  assert.equal(kept.pinnedFor, "2026-10-15");
  assert.equal(kept.postponedOn, "2026-10-14");
  assert.equal(dropped.postponedOn, undefined);
  assert.equal(dropped.firstStep, undefined);
  assert.equal(dropped.postponedCount, undefined);
  assert.equal(dropped.pinnedFor, undefined);
  assert.equal(cleanTaskItems([{ id: 3, title: "C", postponedCount: 5000 }])[0].postponedCount, 99);
});

test("the journal stores one note per day and replaces it on re-save", () => {
  const database = initializeFocusStore(initializeFocusStore(new DatabaseSync(":memory:")));
  saveJournalEntry(database, { day: "2026-10-13", shipped: "Fixed sign-in", nextStep: "" }, "t1");
  saveJournalEntry(database, { day: "2026-10-14", shipped: "Draft", nextStep: "Review it" }, "t2");
  saveJournalEntry(database, { day: "2026-10-14", shipped: "Final", nextStep: "Ship it" }, "t3");
  assert.deepEqual(listJournalEntries(database), [
    { day: "2026-10-14", shipped: "Final", nextStep: "Ship it", updatedAt: "t3" },
    { day: "2026-10-13", shipped: "Fixed sign-in", nextStep: "", updatedAt: "t1" },
  ]);
  assert.equal(listJournalEntries(database, 1).length, 1);
  database.close();
});

test("shutdown notes are validated before they are stored", () => {
  assert.deepEqual(
    parseJournalEntry({ day: "2026-10-14", shipped: "  Did it  ", nextStep: "", extra: "ignored" }),
    { day: "2026-10-14", shipped: "Did it", nextStep: "" },
  );
  for (const value of [
    null,
    [],
    { day: "2026-02-30", shipped: "x", nextStep: "" },
    { day: "2026-10-14", shipped: "", nextStep: "   " },
    { day: "2026-10-14", shipped: 5, nextStep: "" },
    { day: "2026-10-14", shipped: "x".repeat(501), nextStep: "" },
  ])
    assert.throws(() => parseJournalEntry(value), JSON.stringify(value)?.slice(0, 60));
});

import assert from "node:assert/strict";
import test from "node:test";
import { pickNextTask, pinForTomorrow, postponeTask } from "../lib/focus";
import { completeTaskItems } from "../lib/tasks";
import type { TaskItem } from "../lib/types";

const now = new Date(2026, 9, 16, 10); // Friday 16 October 2026, local time

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

test("completing a pinned, postponed repeating task starts the next occurrence clean", () => {
  const tasks = completeTaskItems(
    [
      task({
        id: "daily",
        recurrence: "Daily",
        due: "2026-10-16",
        pinnedFor: "2026-10-16",
        postponedOn: "2026-10-15",
        postponedCount: 2,
      }),
      task({ id: "overdue", due: "2026-10-10" }),
    ],
    "daily",
    { now, occurrenceId: "done-occurrence" },
  );
  const next = tasks.find((item) => item.id === "daily")!;
  assert.equal(next.due, "2026-10-17");
  assert.equal(next.pinnedFor, undefined);
  assert.equal(next.postponedOn, undefined);
  assert.equal(next.postponedCount, undefined);
  assert.equal(pickNextTask(tasks, [], now)?.id, "overdue", "the next occurrence is not treated as chosen last night");
});

test("Not today never pulls a later due date forward or shifts a repeating series", () => {
  const tasks = [
    task({ id: "future", due: "2026-12-01" }),
    task({ id: "weekly", recurrence: "Weekly", due: "2026-10-16" }),
    task({ id: "undated", due: "No date" }),
    task({ id: "today-word", due: "Today" }),
    task({ id: "overdue", due: "2026-10-01" }),
  ];
  const postponed = tasks.reduce((values, item) => postponeTask(values, item.id, now), tasks);
  assert.deepEqual(
    postponed.map((item) => [item.id, item.due, item.postponedOn, item.postponedCount]),
    [
      ["future", "2026-12-01", "2026-10-16", 1],
      ["weekly", "2026-10-16", "2026-10-16", 1],
      ["undated", "No date", "2026-10-16", 1],
      ["today-word", "2026-10-17", "2026-10-16", 1],
      ["overdue", "2026-10-17", "2026-10-16", 1],
    ],
  );
  assert.equal(pickNextTask(postponed, [], now), undefined, "nothing put off today is offered again today");
});

test("Not today counts once per day however often it is pressed", () => {
  let tasks = [task({ id: 1, due: "2026-10-16" })];
  for (let click = 0; click < 5; click += 1) tasks = postponeTask(tasks, 1, now);
  assert.equal(tasks[0].postponedCount, 1);
});

test("a pin only counts on its own day, and choosing tomorrow releases older pins", () => {
  const stale = task({ id: "stale", pinnedFor: "2026-10-14" });
  const chosen = task({ id: "chosen", due: "2026-10-16" });
  assert.equal(pickNextTask([stale, chosen], [], now)?.id, "chosen", "a pin from an earlier day is ignored");

  const pinned = pinForTomorrow(
    [task({ id: "a", pinnedFor: "2026-10-16" }), task({ id: "b" }), task({ id: "later", pinnedFor: "2026-10-20" })],
    "",
    now,
    { existingTaskId: "b" },
  );
  assert.deepEqual(
    pinned.map((item) => [item.id, item.pinnedFor]),
    [["a", undefined], ["b", "2026-10-17"], ["later", "2026-10-20"]],
  );
  assert.equal(pickNextTask(pinned, [], new Date(2026, 9, 17, 9))?.id, "b", "tomorrow honours the new choice");
});

import assert from "node:assert/strict";
import test from "node:test";
import { dayRecap, suggestFirstSteps } from "../lib/focus";
import type { ProjectRoute, TaskItem } from "../lib/types";

const now = new Date(2026, 9, 14, 18); // Wednesday 14 October 2026, 6 pm local
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

test("first-step suggestions follow the verb the task starts with", () => {
  assert.deepEqual(suggestFirstSteps({ title: "Fix the Gmail redirect.", description: "" }), [
    "Reproduce the problem and copy the exact error",
    "Find the file where it goes wrong and open it",
    "Set a two-minute timer and list the sub-steps",
  ]);
  assert.equal(
    suggestFirstSteps({ title: "Write the weekly note", description: "" })[0],
    "Write one rough sentence for the weekly note",
  );
  assert.equal(
    suggestFirstSteps({ title: "Review PropTrack report", description: "" })[0],
    "Open PropTrack report and read the first section",
  );
  assert.equal(
    suggestFirstSteps({ title: "Integrate the tools into Proof of Work", description: "" })[0],
    "Open the file this belongs in and add a TODO line",
  );
});

test("first-step suggestions always offer something short and distinct", () => {
  for (const title of ["Taxes", "x".repeat(400), "Email  ", "Write"]) {
    const suggestions = suggestFirstSteps({ title, description: "" });
    assert.ok(suggestions.length >= 2 && suggestions.length <= 3, title.slice(0, 20));
    assert.equal(new Set(suggestions).size, suggestions.length);
    for (const suggestion of suggestions) assert.ok(suggestion.length > 0 && suggestion.length <= 200);
  }
  assert.equal(suggestFirstSteps({ title: "Write", description: "" })[0], "Write one rough sentence for this");
});

test("the day recap reports what was finished, reported, and put off today", () => {
  const recap = dayRecap(
    projects,
    [
      task({ id: 1, title: "Fix sign-in", projectId: "scout", done: true, completedAt: at(14, 10) }),
      task({ id: 2, title: "Old work", done: true, completedAt: at(13) }),
      task({ id: 3, title: "Read the report", postponedOn: "2026-10-14", due: "2026-10-15", postponedCount: 1 }),
      task({ id: 4, title: "Compare methods", projectId: "climate", firstStep: "Open both reports" }),
      task({ id: 5, title: "Due tomorrow too", due: "2026-10-15" }),
      task({ id: 6, title: "Stuck one", postponedCount: 3 }),
    ],
    [
      { projectId: "scout", generatedAt: at(14, 11), summary: " Added cost tracking " },
      { projectId: "scout", generatedAt: at(14, 15) },
      { projectId: "gone", generatedAt: at(14, 16), summary: "Orphan" },
      { projectId: "climate", generatedAt: at(13), summary: "Yesterday" },
    ],
    now,
  );
  assert.equal(recap.day, "2026-10-14");
  assert.deepEqual(recap.completed.map((item) => item.id), [1]);
  assert.deepEqual(recap.reports, [
    { projectId: "scout", projectName: "Market Scout", summary: "Added cost tracking" },
    { projectId: "scout", projectName: "Market Scout", summary: "" },
    { projectId: "gone", projectName: "Unassigned", summary: "Orphan" },
  ]);
  assert.deepEqual(recap.postponed.map((item) => item.id), [3]);
  assert.deepEqual(recap.stuck.map((item) => item.id), [6]);
  assert.equal(
    recap.shippedText,
    "Completed: Fix sign-in. Agent reports: Market Scout (2), Unassigned. Put off: Read the report.",
  );
});

test("the day recap lines up tomorrow the way tomorrow's card will", () => {
  const tasks = [
    task({ id: "postponed", due: "2026-10-15", postponedOn: "2026-10-14", postponedCount: 1 }),
    task({ id: "other", due: "2026-10-15" }),
    task({ id: "later", firstStep: "Open the file" }),
  ];
  const recap = dayRecap(projects, tasks, [], now);
  assert.equal(recap.tomorrowTask?.id, "postponed", "a task put off today is offered again tomorrow");
  assert.deepEqual(recap.dueTomorrow.map((item) => item.id), ["other"]);
  assert.equal(recap.nextStepText, "Task postponed");

  const pinned = dayRecap(
    projects,
    [...tasks, task({ id: "pinned", pinnedFor: "2026-10-15", firstStep: "Write the first test" })],
    [],
    now,
  );
  assert.equal(pinned.tomorrowTask?.id, "pinned");
  assert.equal(pinned.nextStepText, "Write the first test");
});

test("an empty day is reported as empty, not padded", () => {
  const recap = dayRecap(projects, [], [], now);
  assert.equal(recap.shippedText, "Nothing shipped today.");
  assert.equal(recap.nextStepText, "");
  assert.equal(recap.tomorrowTask, undefined);
  assert.deepEqual([recap.completed, recap.reports, recap.postponed, recap.dueTomorrow, recap.stuck], [[], [], [], [], []]);
});

test("the recap summary stays within the journal's length limit", () => {
  const many = Array.from({ length: 40 }, (_, index) =>
    task({ id: index, title: `A fairly long completed task title number ${index}`, done: true, completedAt: at(14, 9) }),
  );
  assert.equal(dayRecap(projects, many, [], now).shippedText.length, 500);
});

import type { ProjectRoute, TaskItem } from "./types";

/** A task postponed this many times stops being offered and must be decided on. */
export const STUCK_POSTPONE_COUNT = 3;
export const MAX_FIRST_STEP_LENGTH = 200;
export const MAX_JOURNAL_TEXT_LENGTH = 500;

export type JournalEntry = {
  /** Local calendar day, YYYY-MM-DD. */
  day: string;
  shipped: string;
  nextStep: string;
  updatedAt: string;
};

/** A project report reduced to what activity tracking needs. */
export type ReportActivity = { projectId: string; generatedAt: string; summary?: string };

export type ProjectActivity = {
  id: string;
  name: string;
  /** Most recent local day with a completed task or a filed report. */
  lastActiveDay?: string;
  /** Whole days since that activity; undefined when there has never been any. */
  idleDays?: number;
  openTasks: number;
};

export type WeeklyReview = {
  /** Inclusive local-day range covered, oldest first. */
  from: string;
  to: string;
  shippedDays: number;
  completedTasks: number;
  reports: number;
  byProject: Array<{ id: string; name: string; completed: number; reports: number }>;
  untouched: Array<{ id: string; name: string; idleDays?: number }>;
  stuck: TaskItem[];
};

export function localDay(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isLocalDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function addDays(day: string, amount: number) {
  const [year, month, date] = day.split("-").map(Number);
  return localDay(new Date(year, month - 1, date + amount, 12));
}

function daysBetween(earlier: string, later: string) {
  const parse = (value: string) => {
    const [year, month, date] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, date);
  };
  return Math.round((parse(later) - parse(earlier)) / 86_400_000);
}

function dayOfTimestamp(value?: string) {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? localDay(new Date(time)) : undefined;
}

/** Sorts undated tasks ("Today", "No date") relative to dated ones. */
function dueDay(task: TaskItem, today: string) {
  if (isLocalDay(task.due)) return task.due;
  return task.due === "Today" ? today : undefined;
}

export function isStuck(task: TaskItem) {
  return !task.done && (task.postponedCount ?? 0) >= STUCK_POSTPONE_COUNT;
}

/**
 * Days on which work was shipped: a task was completed or a project agent
 * filed a report. Opening the dashboard or reading stories never counts.
 */
export function shippedDays(tasks: TaskItem[], reports: ReportActivity[]) {
  const days = new Set<string>();
  for (const task of tasks) {
    const day = task.done ? dayOfTimestamp(task.completedAt) : undefined;
    if (day) days.add(day);
  }
  for (const report of reports) {
    const day = dayOfTimestamp(report.generatedAt);
    if (day) days.add(day);
  }
  return days;
}

/**
 * Consecutive shipped days ending today. A day still in progress does not
 * break the run, so the streak holds until today ends without shipping.
 */
export function currentStreak(days: Set<string>, now: Date) {
  const today = localDay(now);
  let cursor = days.has(today) ? today : addDays(today, -1);
  let length = 0;
  while (days.has(cursor)) {
    length += 1;
    cursor = addDays(cursor, -1);
  }
  return { length, shippedToday: days.has(today) };
}

export function projectActivity(
  projects: ProjectRoute[],
  tasks: TaskItem[],
  reports: ReportActivity[],
  now: Date,
): ProjectActivity[] {
  const today = localDay(now);
  return projects.map((project) => {
    const days = [
      ...tasks
        .filter((task) => task.done && task.projectId === project.id)
        .map((task) => dayOfTimestamp(task.completedAt)),
      ...reports
        .filter((report) => report.projectId === project.id)
        .map((report) => dayOfTimestamp(report.generatedAt)),
    ].filter((day): day is string => Boolean(day) && day! <= today);
    const lastActiveDay = days.sort().at(-1);
    return {
      id: project.id,
      name: project.name,
      lastActiveDay,
      idleDays: lastActiveDay ? daysBetween(lastActiveDay, today) : undefined,
      openTasks: tasks.filter((task) => !task.done && task.projectId === project.id).length,
    };
  });
}

/**
 * Chooses the single task to put in front of the user. Order of preference:
 * a task pinned for today by last night's shutdown note, then anything due,
 * then the project that has gone longest without activity, then tasks that
 * already have a first step written. Stuck tasks are never chosen, and a task
 * the user answered "Not today" on is not offered again until tomorrow.
 */
export function pickNextTask(
  tasks: TaskItem[],
  activity: ProjectActivity[],
  now: Date,
): TaskItem | undefined {
  const today = localDay(now);
  const idle = new Map(activity.map((project) => [project.id, project.idleDays ?? Number.MAX_SAFE_INTEGER]));
  const candidates = tasks.filter(
    (task) => !task.done && !isStuck(task) && task.postponedOn !== today,
  );
  const rank = (task: TaskItem) => {
    const due = dueDay(task, today);
    return [
      task.pinnedFor === today ? 0 : 1,
      due && due <= today ? 0 : 1,
      due && due > today ? 1 : 0,
      -(task.projectId ? (idle.get(task.projectId) ?? 0) : 0),
      task.firstStep ? 0 : 1,
      task.priority === "High" ? 0 : task.priority === "Low" ? 2 : 1,
    ];
  };
  return candidates
    .map((task, index) => ({ task, index, rank: rank(task) }))
    .sort((a, b) => {
      for (let position = 0; position < a.rank.length; position += 1) {
        if (a.rank[position] !== b.rank[position]) return a.rank[position] - b.rank[position];
      }
      return a.index - b.index;
    })[0]?.task;
}

/**
 * Records that a task was put off today. A one-time task due today or earlier
 * moves to tomorrow; a later due date, an undated task, and a repeating
 * series keep their dates. Counts at most once per day, so repeated clicks
 * cannot make a task stuck.
 */
export function postponeTask(tasks: TaskItem[], taskId: TaskItem["id"], now: Date) {
  const today = localDay(now);
  const tomorrow = addDays(today, 1);
  return tasks.map((task) => {
    if (task.id !== taskId || task.done || task.postponedOn === today) return task;
    const keepsDate =
      task.recurrence !== "One-time" ||
      task.due === "No date" ||
      (isLocalDay(task.due) && task.due > tomorrow);
    return {
      ...task,
      due: keepsDate ? task.due : tomorrow,
      postponedOn: today,
      pinnedFor: undefined,
      postponedCount: Math.min((task.postponedCount ?? 0) + 1, 99),
    };
  });
}

/** Applies one of the three ways out of a stuck task. */
export function resolveStuckTask(
  tasks: TaskItem[],
  taskId: TaskItem["id"],
  resolution: { kind: "break-down"; firstStep: string } | { kind: "schedule"; due: string } | { kind: "delete" },
) {
  if (resolution.kind === "delete") return tasks.filter((task) => task.id !== taskId);
  return tasks.map((task) => {
    if (task.id !== taskId) return task;
    if (resolution.kind === "schedule") {
      return isLocalDay(resolution.due) ? { ...task, due: resolution.due, postponedCount: 0 } : task;
    }
    const firstStep = resolution.firstStep.trim().slice(0, MAX_FIRST_STEP_LENGTH);
    return firstStep ? { ...task, firstStep, postponedCount: 0 } : task;
  });
}

/**
 * Turns the shutdown note's "tomorrow's first step" into tomorrow's pinned
 * task: an existing task is pinned and given the step, otherwise a new task
 * is created from it. Any pin for tomorrow or earlier is released, so an
 * old pin can never override the new choice.
 */
export function pinForTomorrow(
  tasks: TaskItem[],
  nextStep: string,
  now: Date,
  options: { existingTaskId?: TaskItem["id"]; newTaskId?: TaskItem["id"] } = {},
) {
  const step = nextStep.trim().slice(0, MAX_FIRST_STEP_LENGTH);
  const tomorrow = addDays(localDay(now), 1);
  if (!step && options.existingTaskId === undefined) return tasks;
  const released = tasks.map((task) =>
    task.pinnedFor !== undefined && task.pinnedFor <= tomorrow
      ? { ...task, pinnedFor: undefined }
      : task,
  );
  if (options.existingTaskId !== undefined) {
    return released.map((task) =>
      task.id === options.existingTaskId && !task.done
        ? { ...task, pinnedFor: tomorrow, firstStep: step || task.firstStep }
        : task,
    );
  }
  const created: TaskItem = {
    id: options.newTaskId ?? crypto.randomUUID(),
    title: step,
    description: "Set in last night's shutdown note.",
    due: tomorrow,
    recurrence: "One-time",
    priority: "Normal",
    done: false,
    createdAt: now.toISOString(),
    pinnedFor: tomorrow,
  };
  return [created, ...released];
}

export function weeklyReview(
  projects: ProjectRoute[],
  tasks: TaskItem[],
  reports: ReportActivity[],
  now: Date,
): WeeklyReview {
  const to = localDay(now);
  const from = addDays(to, -6);
  const inRange = (day?: string) => Boolean(day) && day! >= from && day! <= to;
  const completed = tasks.filter((task) => task.done && inRange(dayOfTimestamp(task.completedAt)));
  const filed = reports.filter((report) => inRange(dayOfTimestamp(report.generatedAt)));
  const shipped = [...shippedDays(tasks, reports)].filter((day) => inRange(day)).length;
  const byProject = projects.map((project) => ({
    id: project.id,
    name: project.name,
    completed: completed.filter((task) => task.projectId === project.id).length,
    reports: filed.filter((report) => report.projectId === project.id).length,
  }));
  const activity = new Map(projectActivity(projects, tasks, reports, now).map((entry) => [entry.id, entry]));
  return {
    from,
    to,
    shippedDays: shipped,
    completedTasks: completed.length,
    reports: filed.length,
    byProject,
    untouched: byProject
      .filter((project) => project.completed + project.reports === 0)
      .map((project) => ({ id: project.id, name: project.name, idleDays: activity.get(project.id)?.idleDays })),
    stuck: tasks.filter(isStuck),
  };
}

/**
 * Offers concrete two-minute ways to start a task, chosen from the verb the
 * title leads with. Purely local: task text is never sent to an AI provider.
 */
export function suggestFirstSteps(task: Pick<TaskItem, "title" | "description">): string[] {
  const title = task.title.trim();
  const lead = title.toLowerCase();
  const subject = title.replace(/^\S+\s+/, "").replace(/[.!?]+$/, "");
  const about = subject && subject !== title ? subject : "this";
  const patterns: Array<[RegExp, string[]]> = [
    [/^(write|draft|document|describe|summari[sz]e|outline)\b/, [
      `Write one rough sentence for ${about}`,
      "List three headings and stop",
    ]],
    [/^(fix|debug|resolve|repair|investigate)\b/, [
      "Reproduce the problem and copy the exact error",
      "Find the file where it goes wrong and open it",
    ]],
    [/^(read|review|check|audit|inspect|look)\b/, [
      `Open ${about} and read the first section`,
      "Write down the one question you want answered",
    ]],
    [/^(compare|evaluate|assess|benchmark|measure)\b/, [
      "Open both things side by side",
      "List three points to compare",
    ]],
    [/^(add|build|implement|create|integrate|set up|setup|make|wire|install)\b/, [
      "Open the file this belongs in and add a TODO line",
      "Write down what done looks like in one sentence",
    ]],
    [/^(email|message|contact|ask|reply|call|follow)\b/, [
      "Write the subject line and the first sentence",
      "Find the address or thread you need",
    ]],
    [/^(test|run|try|verify|validate)\b/, [
      "Run it once and note what happens",
      "Write the one command you need",
    ]],
    [/^(research|find|search|explore|learn|study)\b/, [
      "Do one search and save the best link",
      "Write the question you are trying to answer",
    ]],
    [/^(plan|decide|choose|design|scope)\b/, [
      "List the options in three bullet points",
      "Write the deciding question in one sentence",
    ]],
    [/^(update|refactor|clean|rename|move|migrate|remove|delete)\b/, [
      "Open the first file that needs changing",
      "List the files this touches",
    ]],
  ];
  const matched = patterns.find(([pattern]) => pattern.test(lead))?.[1] ?? [
    "Open what you need for this and write one line",
  ];
  return [...matched, "Set a two-minute timer and list the sub-steps"]
    .map((step) => step.slice(0, MAX_FIRST_STEP_LENGTH))
    .slice(0, 3);
}

export type DayRecap = {
  day: string;
  completed: TaskItem[];
  reports: Array<{ projectId: string; projectName: string; summary: string }>;
  postponed: TaskItem[];
  /** Tomorrow's task, chosen as the next-task card would choose it tomorrow. */
  tomorrowTask?: TaskItem;
  dueTomorrow: TaskItem[];
  stuck: TaskItem[];
  /** One-paragraph summary of the day, suitable for the shutdown note. */
  shippedText: string;
  /** Tomorrow's first step, suitable for the shutdown note. */
  nextStepText: string;
};

/**
 * Builds the end-of-day catch-up from data the dashboard already holds: what
 * was finished and reported today, what was put off, and where tomorrow
 * starts. Nothing is invented; an empty day is reported as empty.
 */
export function dayRecap(
  projects: ProjectRoute[],
  tasks: TaskItem[],
  reports: ReportActivity[],
  now: Date,
): DayRecap {
  const today = localDay(now);
  const tomorrow = addDays(today, 1);
  const [year, month, date] = tomorrow.split("-").map(Number);
  const tomorrowMorning = new Date(year, month - 1, date, 9);
  const nameOf = (id: string) => projects.find((project) => project.id === id)?.name ?? "Unassigned";
  const completed = tasks.filter((task) => task.done && dayOfTimestamp(task.completedAt) === today);
  const filed = reports
    .filter((report) => dayOfTimestamp(report.generatedAt) === today)
    .map((report) => ({
      projectId: report.projectId,
      projectName: nameOf(report.projectId),
      summary: (report.summary ?? "").trim(),
    }));
  const postponed = tasks.filter((task) => !task.done && task.postponedOn === today);
  const tomorrowTask = pickNextTask(
    tasks,
    projectActivity(projects, tasks, reports, tomorrowMorning),
    tomorrowMorning,
  );
  const parts: string[] = [];
  if (completed.length)
    parts.push(`Completed: ${completed.map((task) => task.title).join("; ")}.`);
  if (filed.length) {
    const counts = new Map<string, number>();
    for (const report of filed) counts.set(report.projectName, (counts.get(report.projectName) ?? 0) + 1);
    parts.push(
      `Agent reports: ${[...counts].map(([name, count]) => (count > 1 ? `${name} (${count})` : name)).join(", ")}.`,
    );
  }
  if (postponed.length) parts.push(`Put off: ${postponed.map((task) => task.title).join("; ")}.`);
  const shippedText = (parts.join(" ") || "Nothing shipped today.").slice(0, MAX_JOURNAL_TEXT_LENGTH);
  return {
    day: today,
    completed,
    reports: filed,
    postponed,
    tomorrowTask,
    dueTomorrow: tasks.filter((task) => !task.done && task.due === tomorrow && task.id !== tomorrowTask?.id),
    stuck: tasks.filter(isStuck),
    shippedText,
    nextStepText: (tomorrowTask?.firstStep || tomorrowTask?.title || "").slice(0, MAX_FIRST_STEP_LENGTH),
  };
}

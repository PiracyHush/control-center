import type { DatabaseSync } from "node:sqlite";
import { MAX_JOURNAL_TEXT_LENGTH, isLocalDay, type JournalEntry } from "./focus";

/** Additive and idempotent, so it is safe to run on every connection use. */
export function initializeFocusStore(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS focus_journal (
      day TEXT PRIMARY KEY,
      shipped TEXT NOT NULL,
      next_step TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return database;
}

export function listJournalEntries(database: DatabaseSync, limit = 60): JournalEntry[] {
  const rows = database
    .prepare("SELECT day, shipped, next_step, updated_at FROM focus_journal ORDER BY day DESC LIMIT ?")
    .all(Math.min(Math.max(Math.trunc(limit), 1), 366)) as unknown as Array<{
    day: string;
    shipped: string;
    next_step: string;
    updated_at: string;
  }>;
  return rows.map((row) => ({
    day: row.day,
    shipped: row.shipped,
    nextStep: row.next_step,
    updatedAt: row.updated_at,
  }));
}

function journalText(value: unknown, label: string) {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const text = value.trim();
  if (text.length > MAX_JOURNAL_TEXT_LENGTH)
    throw new Error(`${label} must be ${MAX_JOURNAL_TEXT_LENGTH} characters or fewer.`);
  return text;
}

export function parseJournalEntry(value: unknown): Omit<JournalEntry, "updatedAt"> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("The shutdown note must be an object.");
  const input = value as Record<string, unknown>;
  if (!isLocalDay(input.day)) throw new Error("The shutdown note needs a valid day.");
  const shipped = journalText(input.shipped, "What you shipped");
  const nextStep = journalText(input.nextStep, "Tomorrow's first step");
  if (!shipped && !nextStep) throw new Error("Write what you shipped or tomorrow's first step.");
  return { day: input.day, shipped, nextStep };
}

export function saveJournalEntry(
  database: DatabaseSync,
  entry: Omit<JournalEntry, "updatedAt">,
  now = new Date().toISOString(),
): JournalEntry {
  database
    .prepare(`
      INSERT INTO focus_journal (day, shipped, next_step, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (day) DO UPDATE SET
        shipped = excluded.shipped,
        next_step = excluded.next_step,
        updated_at = excluded.updated_at
    `)
    .run(entry.day, entry.shipped, entry.nextStep, now);
  return { ...entry, updatedAt: now };
}

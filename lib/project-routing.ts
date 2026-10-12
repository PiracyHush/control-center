import type { LiveStory, ProjectRoute } from "./types";

export const MAX_PROJECT_ROUTES = 8;
export const MAX_PROJECT_KEYWORDS = 12;

function normalizedWords(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.join(" ") ?? "";
}

function containsPhrase(text: string, phrase: string) {
  const normalizedPhrase = normalizedWords(phrase);
  if (normalizedPhrase.length < 2) return false;
  return ` ${text} `.includes(` ${normalizedPhrase} `);
}

/**
 * Route a story using only visible story evidence and user-authored phrases.
 * Project names are implicit phrases so a project can work without duplicate
 * keyword configuration. Input order is preserved for predictable labels.
 */
export function projectsForStory(
  story: Pick<
    LiveStory,
    | "title"
    | "summary"
    | "source"
    | "matchedTerm"
    | "importanceReason"
    | "aiSummary"
  >,
  projects: ProjectRoute[],
) {
  const text = normalizedWords(
    [
      story.title,
      story.summary,
      story.source,
      story.matchedTerm,
      story.importanceReason,
      story.aiSummary,
    ]
      .filter(Boolean)
      .join(" "),
  );

  return projects.filter((project) =>
    [project.name, ...project.keywords].some((phrase) =>
      containsPhrase(text, phrase),
    ),
  );
}

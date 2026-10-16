import assert from "node:assert/strict";
import test from "node:test";
import {
  projectsForStory,
  storyMatchesProject,
} from "../lib/project-routing";
import type { LiveStory, ProjectRoute } from "../lib/types";

const projects: ProjectRoute[] = [
  {
    id: "metamarket",
    name: "MetaMarket",
    keywords: ["openai-agents", "committee disagreement"],
  },
  {
    id: "proof-of-work",
    name: "Personal Proof of Work",
    keywords: ["personal-proof-of-work", "SQLite transaction"],
  },
];

function story(overrides: Partial<LiveStory>): LiveStory {
  return {
    id: "story-1",
    title: "Example",
    summary: "",
    url: "https://example.com/story",
    source: "Example",
    publishedAt: "2026-10-12T00:00:00.000Z",
    ...overrides,
  };
}

test("project routing matches project names and punctuation-normalized phrases", () => {
  assert.deepEqual(
    projectsForStory(
      story({
        title: "OpenAI Agents improves handoffs",
        summary: "Useful for the openai-agents integration in MetaMarket.",
      }),
      projects,
    ).map((project) => project.id),
    ["metamarket"],
  );

  assert.deepEqual(
    projectsForStory(
      story({ title: "Safer SQLite transactions for personal-proof-of-work" }),
      projects,
    ).map((project) => project.id),
    ["proof-of-work"],
  );
});

test("project routing preserves multiple matches in configured order", () => {
  assert.deepEqual(
    projectsForStory(
      story({
        title: "Pydantic contracts for MetaMarket and Personal Proof of Work",
      }),
      projects,
    ).map((project) => project.name),
    ["MetaMarket", "Personal Proof of Work"],
  );
});

test("project routing uses whole phrases instead of partial words", () => {
  const routed = projectsForStory(
    story({ title: "A proofing workflow for market agencies" }),
    [
      { id: "one", name: "Agent", keywords: [] },
      { id: "two", name: "Proof", keywords: [] },
    ],
  );
  assert.deepEqual(routed, []);
});

test("project routing can use grounded AI and importance explanations", () => {
  assert.deepEqual(
    projectsForStory(
      story({
        importanceReason: "Discusses committee disagreement handling.",
        aiSummary: "A reliability improvement for agent systems.",
      }),
      projects,
    ).map((project) => project.id),
    ["metamarket"],
  );
});

test("project filters use the same routing decision as project labels", () => {
  const routedStory = story({
    title: "Reliable model routing for MetaMarket",
  });

  assert.equal(storyMatchesProject(routedStory, "metamarket", projects), true);
  assert.equal(
    storyMatchesProject(routedStory, "proof-of-work", projects),
    false,
  );
  assert.equal(storyMatchesProject(routedStory, "", projects), true);
  assert.equal(storyMatchesProject(routedStory, "missing", projects), false);
});

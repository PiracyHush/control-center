import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, rename, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseHandoff } from "../lib/project-handoffs.ts";

async function ensureDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) throw new Error("Handoff output directories must not be linked.");
}
async function publish(filename, content) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
  await rename(temporary, filename);
}
export async function exportHandoff(repository, inputFile) {
  const root = await realpath(repository);
  const folder = path.join(root, ".agent-handoff");
  await ensureDirectory(folder);
  const config = JSON.parse(await readFile(path.join(folder, "config.json"), "utf8"));
  const input = await readFile(path.resolve(root, inputFile), "utf8");
  if (Buffer.byteLength(input) > 500_000) throw new Error("Session input is too large.");
  const session = JSON.parse(input);
  const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8", timeout: 5000 }).trim();
  if (await realpath(gitRoot) !== root) throw new Error("Choose the Git repository root.");
  let commit = "";
  try { commit = execFileSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: root, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"] }).trim(); } catch { /* A newly initialized repository may have no commit yet. */ }
  const report = parseHandoff({ ...session, schemaVersion: 1, id: `session-${randomUUID()}`, projectId: config.projectId, repository: root, commit, generatedAt: new Date().toISOString() });
  const json = JSON.stringify(report, null, 2) + "\n";
  if (Buffer.byteLength(json) > 500_000) throw new Error("Generated report is too large.");
  const section = (title, items) => `## ${title}\n\n${items.length ? items.map((item) => `- ${item}`).join("\n") : "None reported."}\n\n`;
  const markdown = `# Agent handoff\n\nReport: ${report.id}\nProject: ${report.projectId}\nRepository: ${root}\nCommit: ${commit || "No commit yet"}\nReported: ${report.generatedAt}\nStatus: ${report.status}\n\n${report.summary}\n\n`
    + section("Completed", report.completed) + section("Verification evidence", report.evidence) + section("Decisions needed", report.decisions)
    + section("Proposed actions (not accepted tasks)", report.actions.map((action) => `${action.id}: ${action.title} (${action.priority}${action.due ? `; due ${action.due}` : ""})${action.description ? `: ${action.description}` : ""}`))
    + (report.ideas?.length ? section("Side ideas (waiting for Keep in the Ideas tab)", report.ideas.map((idea) => `${idea.id}: ${idea.title}${idea.note ? `: ${idea.note}` : ""}`)) : "")
    + (report.ideaNotes?.length ? section("Notes on existing ideas", report.ideaNotes.map((note) => `${note.ideaId}: ${note.body}`)) : "");
  const archive = path.join(folder, "reports");
  await ensureDirectory(archive);
  await writeFile(path.join(archive, `${report.id}.md`), markdown, { flag: "wx", mode: 0o600 });
  // Publish the JSON last: it is the dashboard's authoritative machine-readable file.
  await publish(path.join(archive, `${report.id}.json`), json);
  await publish(path.join(folder, "latest.md"), markdown);
  await publish(path.join(folder, "latest.json"), json);
  return { id: report.id, json: path.join(folder, "latest.json"), markdown: path.join(folder, "latest.md") };
}
/**
 * Lists the dashboard's growing and parked ideas so an agent can add notes to
 * them in its handoff (`ideaNotes[].ideaId`). Reads the local dashboard over
 * loopback; never opens its database. Failure is reported, not fatal.
 */
export async function listIdeas(baseUrl = "http://127.0.0.1:3000") {
  const url = new URL("/api/ideas?status=growing,parked", baseUrl);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("--url must point at this computer (127.0.0.1).");
  try {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(3000), headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return { ok: true, ideas: Array.isArray(data.ideas) ? data.ideas : [] };
  } catch {
    return { ok: false, ideas: [] };
  }
}
async function main() {
  const option = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (process.argv.includes("--list-ideas")) {
    try {
      const result = await listIdeas(option("url"));
      if (!result.ok) console.log("Dashboard not reachable: idea list unavailable. You can still propose new ideas in the handoff.");
      else if (!result.ideas.length) console.log("No growing or parked ideas yet. Propose new ones in the handoff's ideas list.");
      else for (const idea of result.ideas) console.log(`${idea.id}	${idea.status}	${String(idea.title).replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")}`);
    } catch (error) { console.error(`Listing ideas failed: ${error.message}`); process.exitCode = 1; }
    return;
  }
  try {
    const input = option("input");
    if (!input) throw new Error("Use --input=.agent-handoff/session.json and optionally --repo=/absolute/repository.");
    console.log(JSON.stringify(await exportHandoff(option("repo") || process.cwd(), input)));
  } catch (error) { console.error(`Handoff export failed: ${error.message}`); process.exitCode = 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) void main();

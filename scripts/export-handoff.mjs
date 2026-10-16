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
    + section("Proposed actions (not accepted tasks)", report.actions.map((action) => `${action.id}: ${action.title} (${action.priority}${action.due ? `; due ${action.due}` : ""})${action.description ? `: ${action.description}` : ""}`));
  const archive = path.join(folder, "reports");
  await ensureDirectory(archive);
  await writeFile(path.join(archive, `${report.id}.md`), markdown, { flag: "wx", mode: 0o600 });
  // Publish the JSON last: it is the dashboard's authoritative machine-readable file.
  await publish(path.join(archive, `${report.id}.json`), json);
  await publish(path.join(folder, "latest.md"), markdown);
  await publish(path.join(folder, "latest.json"), json);
  return { id: report.id, json: path.join(folder, "latest.json"), markdown: path.join(folder, "latest.md") };
}
async function main() {
  const option = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  try {
    const input = option("input");
    if (!input) throw new Error("Use --input=.agent-handoff/session.json and optionally --repo=/absolute/repository.");
    console.log(JSON.stringify(await exportHandoff(option("repo") || process.cwd(), input)));
  } catch (error) { console.error(`Handoff export failed: ${error.message}`); process.exitCode = 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) void main();

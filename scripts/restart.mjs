import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import net from "node:net";
import path from "node:path";
import { needsRebuild } from "./build-check.mjs";
import { loadLocalEnvironment, resolveDataDirectory } from "./paths.mjs";
import { prepareLocalInstall } from "./setup.mjs";

// Stops the running dashboard and starts the newest code. Used by
// `npm run restart` and by the dashboard's "Restart now" button (which passes
// --from-dashboard and its own --pid).
//
// If the source changed, it builds after stopping the old server (a running
// server must not have .next rebuilt under it), keeping the previous build
// aside. When the new build fails, the previous build is put back and started,
// so a half-finished edit never leaves you with no dashboard.

const cwd = process.cwd();
loadLocalEnvironment(cwd);
const args = process.argv.slice(2);
const option = (name) => args.find((value) => value.startsWith(`--${name}=`))?.split("=")[1];
const fromDashboard = args.includes("--from-dashboard");
const port = Number(option("port") || process.env.PORT || 3000);
const url = `http://127.0.0.1:${port}`;
const logPath = path.join(cwd, "logs", "launch.log");
const nextDir = path.join(cwd, ".next");
const previousDir = path.join(cwd, ".next-previous");
const nextCli = path.join(cwd, "node_modules", "next", "dist", "bin", "next");

// The dashboard starts this with no console, so output goes to the log.
let logFd;
if (fromDashboard) {
  mkdirSync(path.dirname(logPath), { recursive: true });
  logFd = openSync(logPath, "a");
}
const say = (message) => (logFd === undefined ? console.log(message) : writeSync(logFd, `${message}\n`));
const childStdio = () => (logFd === undefined ? "inherit" : ["ignore", logFd, logFd]);
function fail(message) {
  if (logFd === undefined) console.error(message);
  else writeSync(logFd, `${message}\n`);
  process.exit(1);
}
if (fromDashboard)
  for (const event of ["uncaughtException", "unhandledRejection"])
    process.on(event, (error) => fail(`Restart error: ${error?.stack ?? error}`));

if (!Number.isInteger(port) || port < 1 || port > 65535) fail("Use a valid TCP port, for example --port=3001.");

// One restart at a time: a button click and `npm run restart` must not both
// stop and start servers.
const lockPath = path.join(resolveDataDirectory(cwd), "restart.lock");
mkdirSync(path.dirname(lockPath), { recursive: true });
try {
  writeFileSync(lockPath, String(process.pid), { flag: "wx" });
} catch (error) {
  if (error?.code !== "EEXIST") throw error;
  let holder = 0;
  try {
    holder = Number(readFileSync(lockPath, "utf8"));
    process.kill(holder, 0);
  } catch {
    holder = 0;
  }
  if (holder) fail("A restart is already in progress.");
  writeFileSync(lockPath, String(process.pid));
}
process.on("exit", () => {
  try {
    if (Number(readFileSync(lockPath, "utf8")) === process.pid) rmSync(lockPath, { force: true });
  } catch {
    // Already gone.
  }
});

function portInUse() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (busy) => {
      socket.destroy();
      resolve(busy);
    };
    socket.setTimeout(2_000, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(pathname) {
  try {
    const response = await fetch(`${url}${pathname}`, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/** The process listening on the port, from the OS. Only used once health confirmed it is ours. */
function portOwnerPid() {
  if (process.platform === "win32") {
    const output = ["TCP", "TCPv6"]
      .map((protocol) => spawnSync("netstat", ["-ano", "-p", protocol], { encoding: "utf8", windowsHide: true }).stdout ?? "")
      .join("\n");
    const listeners = new Set([`127.0.0.1:${port}`, `0.0.0.0:${port}`, `[::]:${port}`, `[::1]:${port}`]);
    const line = output.split(/\r?\n/).find((row) => {
      const columns = row.trim().split(/\s+/);
      return listeners.has(columns[1]) && columns[3] === "LISTENING";
    });
    return Number(line?.trim().split(/\s+/)[4] ?? 0) || 0;
  }
  const output = spawnSync("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).stdout ?? "";
  return Number(output.trim().split("\n")[0]) || 0;
}

/** The running dashboard's process id, or 0 when Control Center is not what answers. */
async function runningServerPid() {
  if ((await getJson("/api/health"))?.service !== "control-center") return 0;
  const system = await getJson("/api/system");
  // Older builds have no /api/system; ask the OS who owns the port instead.
  return Number.isInteger(system?.pid) ? system.pid : portOwnerPid();
}

say(`\n[${new Date().toISOString()}] Restarting Control Center${fromDashboard ? " from the dashboard" : ""}`);
let pid = Number(option("pid") || 0);
if (fromDashboard) await pause(1_000); // Let the button's response reach the browser first.
if (!pid) pid = await runningServerPid();

if (pid) {
  try {
    process.kill(pid);
  } catch (error) {
    if (error?.code !== "ESRCH") fail(`Could not stop the running dashboard (process ${pid}): ${error.message}`);
  }
  const deadline = Date.now() + 20_000;
  while (await portInUse()) {
    if (Date.now() > deadline) fail(`The old dashboard did not release port ${port} within 20 seconds.`);
    await pause(250);
  }
} else if (await portInUse()) {
  fail(`Port ${port} is in use but Control Center could not be found there. Stop what is using it, or restart with --port=3001.`);
} else {
  say("Control Center was not running; starting it.");
}

try {
  await prepareLocalInstall({ cwd, stdio: childStdio(), log: say });
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

let restored = false;
if (needsRebuild(cwd)) {
  say("Building the new version. This can take a few minutes.");
  rmSync(previousDir, { recursive: true, force: true });
  if (existsSync(nextDir)) renameSync(nextDir, previousDir);
  const build = spawnSync(process.execPath, [nextCli, "build"], { cwd, env: process.env, stdio: childStdio() });
  if (build.status === 0) {
    rmSync(previousDir, { recursive: true, force: true });
  } else if (existsSync(previousDir)) {
    say("The new version did not build. Putting the previous version back.");
    rmSync(nextDir, { recursive: true, force: true });
    renameSync(previousDir, nextDir);
    restored = true;
  } else {
    fail("The build failed and there was no previous build to fall back to. The output above has the reason.");
  }
}

if (logFd !== undefined) closeSync(logFd);
const launch = spawnSync(
  process.execPath,
  [path.join(cwd, "scripts", "launch.mjs"), "--background", "--skip-build", `--port=${port}`],
  { cwd, env: process.env, stdio: "ignore", windowsHide: true },
);
if (fromDashboard) logFd = openSync(logPath, "a");
if (launch.status !== 0) {
  if (!fromDashboard && existsSync(logPath))
    console.error(readFileSync(logPath, "utf8").trimEnd().split("\n").slice(-15).join("\n"));
  fail(`Control Center did not start. See ${path.relative(cwd, logPath)}.`);
}
if (restored)
  fail(`The new code did not build, so the previous version is running again at ${url}. The build errors are in ${path.relative(cwd, logPath)}.`);
say(`Control Center is running the newest version at ${url}`);

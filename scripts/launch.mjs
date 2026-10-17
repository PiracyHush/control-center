import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { open, readFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { loadLocalEnvironment, resolveDataDirectory } from "./paths.mjs";
import { needsRebuild } from "./build-check.mjs";
import { prepareLocalInstall } from "./setup.mjs";

// Starts the dashboard. Nothing here goes through npm: npm adds a resident
// process, seconds of start-up and, under memory pressure, can stall for minutes.
//
//   node scripts/launch.mjs              start, open the browser, stay attached
//   node scripts/launch.mjs --no-open    the same without opening a browser
//   node scripts/launch.mjs --background start detached, log to logs/launch.log,
//                                        and exit once the dashboard is ready
//                                        (used at Windows sign-in)

const cwd = process.cwd();
loadLocalEnvironment(cwd);
const args = new Set(process.argv.slice(2));
const background = args.has("--background");
const noOpen = background || args.has("--no-open") || process.env.CI === "true";
const forceBuild = args.has("--rebuild");
const portArgument = process.argv.find((value) => value.startsWith("--port="));
const port = Number(portArgument?.split("=")[1] || process.env.PORT || 3000);

// In background mode there is no console, so everything goes to the log file
// the server writes to as well.
let logFd;
const logPath = path.join(cwd, "logs", "launch.log");
const oldLogPath = path.join(cwd, "logs", "launch.old.log");
function openLog({ rotate }) {
  mkdirSync(path.dirname(logPath), { recursive: true });
  // Rotate only when nothing is running: a live server holds launch.log open
  // and would keep writing to the renamed file.
  if (rotate && existsSync(logPath) && statSync(logPath).size > 1_000_000) {
    rmSync(oldLogPath, { force: true });
    renameSync(logPath, oldLogPath);
  }
  logFd = openSync(logPath, "a");
}
const write = (stream, message) =>
  logFd === undefined ? stream.write(`${message}\n`) : writeSync(logFd, `${message}\n`);
const log = (message) => write(process.stdout, message);
const fail = (message, code = 1) => {
  write(process.stderr, message);
  process.exit(code);
};
const childStdio = () => (logFd === undefined ? "inherit" : ["ignore", logFd, logFd]);
if (background) {
  // Without a console, an unexpected error would otherwise vanish.
  for (const event of ["uncaughtException", "unhandledRejection"])
    process.on(event, (error) => {
      if (logFd === undefined) openLog({ rotate: false });
      fail(`Launcher error: ${error?.stack ?? error}`);
    });
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  if (background) openLog({ rotate: false });
  fail("Use a valid TCP port, for example: npm run launch -- --port=3001");
}

process.env.PORT = String(port);
const url = `http://127.0.0.1:${port}`;

// When memory is short the first response can take several seconds, so each
// check waits long enough not to abort a server that is merely slow.
async function isControlCenterRunning(timeoutMs = 1_500) {
  try {
    const response = await fetch(`${url}/api/health`, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    const payload = await response.json();
    return response.ok && payload.service === "control-center";
  } catch {
    return false;
  }
}

function openBrowser() {
  if (noOpen) return;
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const commandArgs =
    process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const opener = spawn(command, commandArgs, {
    detached: true,
    stdio: "ignore",
  });
  opener.on("error", () => {
    log(`Open ${url} in your browser.`);
  });
  opener.unref();
}

// Checked first: a second launch (a double click, or sign-in while it is
// already up) should cost one HTTP request, not a dependency check and a build.
// A paged-out server can take seconds to answer; mistaking it for a stopped
// one would rebuild .next underneath it.
const alreadyRunning = await isControlCenterRunning(5_000);
// Something holds the port but did not answer in time: usually this dashboard
// just after the PC wakes from sleep. Never build or start a second server then.
const portBusy = !alreadyRunning && (await portInUse());
if (background) {
  openLog({ rotate: !alreadyRunning && !portBusy });
  log(`\n[${new Date().toISOString()}] Starting Control Center in the background`);
}
if (alreadyRunning) {
  log(`Control Center is already running at ${url}`);
  openBrowser();
  process.exit(0);
}
if (portBusy)
  fail(
    `Port ${port} is already in use. If Control Center is running it is slow to answer; open ${url} in a minute. `
    + "Otherwise stop whatever is using the port, or start on another one with --port=3001.",
  );

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

// One launcher at a time from here on, so two launches cannot build at once.
let dataDirectory;
try {
  dataDirectory = resolveDataDirectory(cwd);
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
} catch (error) {
  fail(
    `${error instanceof Error ? error.message : "The local data directory is invalid."}\n`
    + "Use an absolute path in .env.local, or leave CONTROL_CENTER_DATA_DIR empty.",
  );
}
const lockPath = path.join(dataDirectory, "launcher.lock");
let lockHandle;
try {
  lockHandle = await open(lockPath, "wx", 0o600);
} catch (error) {
  if (error?.code !== "EEXIST") throw error;
  let stale = true;
  try {
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    // A lock written before this boot is left over from a shutdown or sign-out
    // that skipped cleanup; its PID may since have been reused by another process.
    const bootedAt = Date.now() - os.uptime() * 1000;
    const writtenThisBoot = Date.parse(lock.startedAt) > bootedAt;
    if (Number.isInteger(lock.pid) && writtenThisBoot) {
      process.kill(lock.pid, 0);
      stale = false;
    }
  } catch {
    stale = true;
  }
  if (!stale)
    fail("Another Control Center process is already starting. Try again in a few seconds.");
  rmSync(lockPath, { force: true });
  lockHandle = await open(lockPath, "wx", 0o600);
}
await lockHandle.writeFile(
  `${JSON.stringify({ pid: process.pid, port, startedAt: new Date().toISOString() })}\n`,
);
await lockHandle.close();
// Synchronous so it also runs on process.exit() from any path below. Only our
// own lock is removed, never one another launcher took over as stale.
process.on("exit", () => {
  try {
    if (JSON.parse(readFileSync(lockPath, "utf8")).pid === process.pid) rmSync(lockPath, { force: true });
  } catch {
    // Already gone.
  }
});
// Ctrl+C or sign-out during setup or a build: exit normally so the lock goes
// too. Replaced by the server's own stop handling once it starts.
const exitOnSignal = () => process.exit(130);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, exitOnSignal);

try {
  await prepareLocalInstall({ cwd, stdio: childStdio(), log });
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
process.env.CONTROL_CENTER_DATA_DIR = dataDirectory;

const nextCli = path.join(cwd, "node_modules", "next", "dist", "bin", "next");
// --skip-build starts whatever build exists; restart.mjs uses it after it has
// built (or restored the previous build) itself.
const needsBuild = !args.has("--skip-build") && (forceBuild || needsRebuild(cwd));
if (needsBuild) {
  log("Building the local dashboard…");
  const build = spawnSync(process.execPath, [nextCli, "build"], {
    cwd,
    env: process.env,
    stdio: childStdio(),
  });
  if (build.status !== 0)
    fail("The build failed. The output above has the reason. If it says a module is missing, run npm ci.", build.status ?? 1);
}

let child;
let forceStopTimer;
let stopping = false;
let shutdownRequested = false;
function stopChild(signal = "SIGTERM") {
  shutdownRequested = true;
  if (!child || stopping) return;
  stopping = true;
  if (child.exitCode === null && child.signalCode === null) {
    child.kill(signal);
    forceStopTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    }, 5_000);
    forceStopTimer.unref();
  }
}
for (const signal of ["SIGINT", "SIGTERM"]) process.off(signal, exitOnSignal);
if (!background) {
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => stopChild(signal));
  process.on("message", (message) => {
    if (message?.type === "shutdown") stopChild();
  });
}

child = spawn(
  process.execPath,
  [nextCli, "start", "--hostname", "127.0.0.1", "--port", String(port)],
  {
    cwd,
    env: process.env,
    stdio: childStdio(),
    // In background mode the server outlives this launcher.
    detached: background,
    windowsHide: true,
  },
);
const childExit = new Promise((resolve) =>
  child.once("exit", (code, signal) => {
    clearTimeout(forceStopTimer);
    resolve({ code, signal });
  }),
);
if (shutdownRequested) stopChild();
// Slow is not broken: on a machine short of memory `next start` alone can take
// 15 seconds. At sign-in nobody is waiting, so allow longer there.
const waitSeconds = background ? 180 : 90;
const deadline = Date.now() + waitSeconds * 1_000;
while (!(await isControlCenterRunning(5_000))) {
  const result = await Promise.race([
    childExit,
    new Promise((resolve) => setTimeout(() => resolve(null), 250)),
  ]);
  if (result)
    fail("Control Center stopped before it became ready. The server output above contains the fix.", result.code ?? 1);
  if (Date.now() > deadline) {
    if (background) {
      // Leave a slow server running rather than killing it at sign-in.
      log(`Control Center is still starting after ${waitSeconds} seconds; leaving server process ${child.pid} running. Open ${url} in a minute.`);
      child.unref();
      closeSync(logFd);
      process.exit(0);
    }
    stopChild();
    await childExit;
    fail(`Control Center did not become ready at ${url} within ${waitSeconds} seconds.`);
  }
}

log(`\nControl Center is ready at ${url}`);
log(`Local data: ${dataDirectory}`);
if (background) {
  // Hand the server off and exit, so only the server stays in memory.
  log(`Server process ${child.pid} keeps running after this launcher exits.`);
  child.unref();
  closeSync(logFd);
  process.exit(0);
}
log("Keep this window open. Press Ctrl+C to stop.\n");
openBrowser();

const result = await childExit;
process.exit(result.code ?? (result.signal ? 0 : 1));

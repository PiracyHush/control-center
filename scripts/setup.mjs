import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { npmCommand, resolveDataDirectory } from "./paths.mjs";

/**
 * Checks Node, installs the locked dependencies when they are missing or out of
 * date, and creates the private data directory. The launcher calls this in
 * process, so a normal start never spawns npm. Returns the data directory, or
 * throws an Error with a message meant for the person running it.
 */
export async function prepareLocalInstall({ cwd = process.cwd(), stdio = "inherit", log = console.log } = {}) {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 24 || (major === 24 && minor < 19))
    throw new Error(
      `Control Center needs Node.js 24.19 or newer. You have ${process.versions.node}.\n`
      + "Install the current Node.js LTS release, then run npm run setup again.",
    );

  const environmentPath = path.join(cwd, ".env.local");
  if (existsSync(environmentPath)) process.loadEnvFile(environmentPath);

  const lockPath = path.join(cwd, "package-lock.json");
  const stampPath = path.join(cwd, "node_modules", ".control-center-lock-hash");
  const lockHash = existsSync(lockPath)
    ? createHash("sha256").update(await readFile(lockPath)).digest("hex")
    : "unlocked";
  const installedHash = existsSync(stampPath)
    ? (await readFile(stampPath, "utf8")).trim()
    : "";
  if (installedHash !== lockHash || !(await dependenciesPresent(cwd))) {
    log("Installing the locked local dependencies…");
    const npm = npmCliCommand();
    const result = spawnSync(
      npm.command,
      // --include=dev: a restart from the server inherits NODE_ENV=production,
      // which would otherwise make npm skip the build tools.
      [...npm.prefix, existsSync(lockPath) ? "ci" : "install", "--include=dev"],
      { cwd, stdio },
    );
    if (result.status !== 0)
      throw new Error(`Installing dependencies failed. ${result.error ? result.error.message : "The npm output above has the reason."}`);
    await writeFile(stampPath, `${lockHash}\n`);
  }

  let dataDirectory;
  try {
    dataDirectory = resolveDataDirectory(cwd);
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : "The local data directory is invalid."}\n`
      + "Use an absolute path in .env.local, or leave CONTROL_CENTER_DATA_DIR empty.",
    );
  }
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  await chmod(dataDirectory, 0o700).catch(() => undefined);
  return dataDirectory;
}

/**
 * npm's own script next to this Node, run without a shell. Starting npm.cmd
 * needs a shell on Windows, which Node 24 warns about. Falls back to npm on PATH.
 */
function npmCliCommand() {
  if (process.env.npm_execpath)
    return { command: process.execPath, prefix: [process.env.npm_execpath] };
  const bundled = path.join(
    path.dirname(process.execPath),
    ...(process.platform === "win32" ? [] : ["..", "lib"]),
    "node_modules", "npm", "bin", "npm-cli.js",
  );
  if (existsSync(bundled)) return { command: process.execPath, prefix: [bundled] };
  const npm = npmCommand();
  return { ...npm, prefix: npm.prefix };
}

/**
 * A cheap stand-in for `npm ls --depth=0`, which reads the whole tree and can
 * take minutes when memory is short: every declared package must be installed.
 * The lock-hash stamp already covers version changes.
 */
async function dependenciesPresent(cwd) {
  const manifest = JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8"));
  const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
  return names.every((name) =>
    existsSync(path.join(cwd, "node_modules", ...name.split("/"), "package.json")),
  );
}

// Not import.meta.main: on Node too old to have it, the version check must still run.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const dataDirectory = await prepareLocalInstall();
    console.log("\nControl Center is ready.");
    console.log(`Local data: ${dataDirectory}`);
    console.log("Run npm run launch to build, start, and open the dashboard.\n");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

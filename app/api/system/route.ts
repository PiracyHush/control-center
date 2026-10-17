import { spawn } from "node:child_process";
import path from "node:path";
import { readBuildState } from "@/lib/server/build-state";

export const runtime = "nodejs";

declare global {
  var controlCenterRestarting: boolean | undefined;
}

export async function GET() {
  return Response.json({ ...readBuildState(), restarting: Boolean(globalThis.controlCenterRestarting) });
}

/** Hands the restart to scripts/restart.mjs, which stops this server and starts the new build. */
export async function POST(request: Request) {
  // This stops the server, so accept only the dashboard's own JSON requests.
  // proxy.ts rejects a foreign Origin; requiring one here also turns away
  // clients that send none, and JSON forces a CORS preflight.
  if (!request.headers.get("origin") || !request.headers.get("content-type")?.startsWith("application/json"))
    return Response.json({ error: "Restart is only available from the dashboard." }, { status: 403 });
  const text = await request.text();
  let body: { action?: unknown } = {};
  try {
    body = text.length <= 1_000 ? JSON.parse(text) : {};
  } catch {
    // Handled below.
  }
  if (body.action !== "restart")
    return Response.json({ error: "Unknown action." }, { status: 400 });
  const state = readBuildState();
  if (!state.restartable)
    return Response.json(
      { error: "Only a dashboard started with npm run launch or at sign-in can restart itself." },
      { status: 409 },
    );
  if (globalThis.controlCenterRestarting)
    return Response.json({ restarting: true, needsRebuild: state.needsRebuild }, { status: 202 });

  const port = process.env.PORT || new URL(request.url).port || "3000";
  // Next sets private variables, and NODE_ENV=production, for this server. The
  // restart must not inherit them: npm ci would skip the build tools.
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env))
    if (/^(__NEXT|NEXT_PRIVATE|NEXT_RUNTIME$|TURBOPACK|NODE_ENV$)/.test(key)) delete env[key];
  try {
    const child = spawn(
      process.execPath,
      [path.join(process.cwd(), "scripts", "restart.mjs"), "--from-dashboard", `--pid=${process.pid}`, `--port=${port}`],
      { cwd: process.cwd(), env, detached: true, stdio: "ignore", windowsHide: true },
    );
    // If the restart gives up while this server is still alive, allow another try.
    child.once("error", () => {
      globalThis.controlCenterRestarting = false;
    });
    child.once("exit", () => {
      globalThis.controlCenterRestarting = false;
    });
    child.unref();
  } catch {
    return Response.json({ error: "The restart could not be started." }, { status: 500 });
  }
  globalThis.controlCenterRestarting = true;
  return Response.json({ restarting: true, needsRebuild: state.needsRebuild }, { status: 202 });
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";

type SystemState = {
  restartable: boolean;
  updateAvailable: boolean;
  needsRebuild: boolean;
  runningBuildId: string;
  pid: number;
  restarting?: boolean;
};

const CHECK_EVERY_MS = 10 * 60_000;
const RESTART_TIMEOUT_MS = 8 * 60_000;

async function readSystem(): Promise<SystemState | null> {
  try {
    const response = await fetch("/api/system", { cache: "no-store" });
    return response.ok ? ((await response.json()) as SystemState) : null;
  } catch {
    return null;
  }
}

/**
 * Shows when the running dashboard is older than the code on disk, and restarts
 * it in place. `beforeRestart` lets pending workspace saves finish first.
 */
export function UpdateBanner({ beforeRestart }: { beforeRestart: () => Promise<void> }) {
  const [system, setSystem] = useState<SystemState | null>(null);
  const [phase, setPhase] = useState<"idle" | "restarting" | "slow" | "failed">("idle");
  const [error, setError] = useState("");
  const restarting = useRef(false);

  const check = useCallback(async () => {
    if (restarting.current) return;
    const next = await readSystem();
    if (next && !restarting.current) setSystem(next);
  }, []);

  useEffect(() => {
    void check();
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [check]);

  async function restart() {
    if (!system) return;
    restarting.current = true;
    setPhase("restarting");
    setError("");
    try {
      await beforeRestart();
      const response = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restart" }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "The dashboard could not restart.");
      }
    } catch (problem) {
      restarting.current = false;
      setPhase("failed");
      setError(problem instanceof Error ? problem.message : "The dashboard could not restart.");
      return;
    }
    // The old server goes away, then a new one answers. A different build means
    // success; the same build from a new process means the new code did not
    // build and the previous version was put back.
    const startedAt = Date.now();
    const oldBuild = system.runningBuildId;
    const oldPid = system.pid;
    while (Date.now() - startedAt < RESTART_TIMEOUT_MS) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const next = await readSystem();
      if (!next || next.restarting) continue;
      if (next.runningBuildId !== oldBuild) {
        window.location.reload();
        return;
      }
      if (next.pid !== oldPid) {
        restarting.current = false;
        setSystem(next);
        setPhase("failed");
        setError("The new code did not build, so the previous version is running again. The build errors are in logs/launch.log.");
        return;
      }
    }
    restarting.current = false;
    setPhase("slow");
  }

  if (!system?.restartable || (!system.updateAvailable && phase === "idle")) return null;

  return (
    <div className="update-banner" role="status">
      {phase === "restarting" ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}
      <span>
        {phase === "restarting"
          ? system.needsRebuild
            ? "Rebuilding and restarting. This can take a few minutes; the page reloads when it is ready."
            : "Restarting. The page reloads when the new version is ready."
          : phase === "slow"
            ? "Still restarting after 8 minutes. Check logs/launch.log, then reload this page."
            : phase === "failed"
              ? error
              : system.needsRebuild
                ? "The code changed since this version was built. Restarting rebuilds it first, which takes a few minutes."
                : "A newer version is ready."}
      </span>
      {(phase === "idle" || phase === "failed") && (
        <button className="button button-primary" onClick={() => void restart()}>
          {phase === "failed" ? "Try again" : "Restart now"}
        </button>
      )}
      {phase === "slow" && (
        <button className="button button-ghost" onClick={() => window.location.reload()}>
          Reload page
        </button>
      )}
    </div>
  );
}

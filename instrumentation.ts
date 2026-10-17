export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { recordRunningBuild } = await import("./lib/server/build-state");
  recordRunningBuild();
  const { startLocalCollectorScheduler } = await import("./lib/server/scheduler");
  startLocalCollectorScheduler();
}

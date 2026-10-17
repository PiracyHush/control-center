// Types for build-check.mjs, so TypeScript tests can import it.
export const SOURCE_PATHS: string[];
export function needsRebuild(cwd?: string): boolean;

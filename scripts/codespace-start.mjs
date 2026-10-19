import { pathToFileURL } from "node:url";
import { prepareSearchUnlocked, runCommand, withPreparationSignals } from "./search-prepare.mjs";
import { withWorkspaceLock } from "./workspace-lock.mjs";

export async function startCodespace({
  run = runCommand, prepare = prepareSearchUnlocked, withLock = withWorkspaceLock,
  env = process.env, log = console.log, signal,
} = {}) {
  return withLock(async () => {
    signal?.throwIfAborted();
    // Run the unchanged core startup first: setup preserves credentials, both
    // local catalogs are seeded, and exercise source is never edited.
    const core = await run(process.execPath, ["scripts/workspace-start.mjs"], { signal, timeout: 1800000 });
    signal?.throwIfAborted();
    if (core.error || core.cancelled || core.status !== 0) throw new Error("Core workspace startup failed. Search preparation was not started. Diagnose the error and retry npm run codespace:start (or npm run workspace:start for core only).");
    log("CORE READY: Site A/B are seeded. You can begin the hands-on exercises on private port 3000 now.");
    if (env.WORKSHOP_AUTO_SEARCH === "0") {
      log(JSON.stringify({ event: "codespace-start", core: "ready", search: "disabled" }));
      log("Automatic search preparation is disabled by WORKSHOP_AUTO_SEARCH=0. Core workshop remains available.");
      return;
    }
    log("Preparing built-in Search by meaning for both local sites. First use downloads ~274 MB of model assets plus the pinned runtime (~455 MB on amd64) and can take minutes. Continue the core exercises while this finishes; the app will briefly restart. No new TODOs, Azure access or paid AI keys.");
    try {
      await prepare(["--local-sites"], { run, log, signal });
      signal?.throwIfAborted();
      log(JSON.stringify({ event: "codespace-start", core: "ready", search: "ready" }));
      log("SEARCH READY: Refresh the planner (including its request token), then use Search by meaning / Check search readiness. Your exercise files and favorites are unchanged.");
    } catch (error) {
      log(JSON.stringify({ event: "codespace-start", core: "ready", search: "unavailable" }));
      log("Search preparation did not finish; core app/databases were not stopped. Continue the core workshop. Refresh after any app restart. Retry: npm run search:prepare -- --local-sites");
      // Optional failure must not hide cancellation or an unsafe downloader.
      if (error?.code === "SEARCH_DOWNLOAD_CLEANUP_FAILED") throw error;
      signal?.throwIfAborted();
      if (error?.name === "AbortError") throw error;
      log(`WARNING: ${error?.message || "Search unavailable."}`);
    }
  });
}

export async function codespaceStartMain(options = {}) {
  return withPreparationSignals((signal) => startCodespace({ ...options, signal }), options);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await codespaceStartMain();
}

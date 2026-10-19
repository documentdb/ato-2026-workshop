import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { withWorkspaceLock } from "./workspace-lock.mjs";
import { SEARCH_MODEL, MODEL_MAX_BYTES } from "../src/search-model.js";

export function preparationTargets(args) {
  if (args.length === 1 && args[0] === "--local-sites") return ["local", "site-b"];
  if (args.length === 2 && args[0] === "--target" && ["local", "site-b"].includes(args[1])) return [args[1]];
  throw new Error("Choose explicitly: npm run search:prepare -- --local-sites, or --target local|site-b. This helper never provisions or prepares cloud targets.");
}
export function checkManifest(text) {
  if (Buffer.byteLength(text) > 64_000 || createHash("sha256").update(text).digest("hex") !== SEARCH_MODEL.digest) throw new Error("The public embedding manifest does not match the pinned digest. Nothing was downloaded or indexed.");
  const manifest = JSON.parse(text);
  const bytes = [manifest.config, ...manifest.layers].reduce((sum, layer) => sum + layer.size, 0);
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MODEL_MAX_BYTES) throw new Error("The pinned model exceeds the optional showcase download bound.");
  return bytes;
}

// Wait for close, not just exit/abort: a cancelled Compose process must finish
// before cleanup reconciles any detached container it may have created.
export function runCommand(command, args, { signal, timeout = 900000, capture = false, quiet = false } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve) => {
    // Own the subprocess group on POSIX: terminal-wide Ctrl+C must not kill a
    // cleanup command directly, bypassing the parent's second-signal handler.
    const detached = process.platform !== "win32";
    const child = spawn(command, args, { detached, stdio: ["ignore", "pipe", "pipe"] });
    const kill = (signal) => {
      try {
        if (detached && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch { /* Already closed; the close handler is authoritative. */ }
    };
    let stdout = "";
    let cancelled = false;
    let force;
    let spawnError;
    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      kill("SIGTERM");
      force = setTimeout(() => kill("SIGKILL"), 3000);
    };
    const timer = setTimeout(cancel, timeout);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    child.stdout.on("data", (chunk) => {
      if (capture) {
        stdout += chunk;
        if (Buffer.byteLength(stdout) > 2_000_000) cancel();
      } else if (!quiet) process.stdout.write(chunk);
    });
    // Configuration/inspection output is private in memory and never relayed.
    child.stderr.on("data", (chunk) => { if (!capture && !quiet) process.stderr.write(chunk); });
    child.once("error", (error) => { spawnError = error; });
    child.once("close", (status) => {
      clearTimeout(timer); clearTimeout(force);
      signal?.removeEventListener("abort", cancel);
      resolve({ status, stdout, cancelled, error: Boolean(spawnError) });
    });
  });
}

export async function prepareSearch(args, { withLock = withWorkspaceLock, ...options } = {}) {
  preparationTargets(args); // reject invalid targets even before acquiring a lock
  return withLock(() => prepareSearchUnlocked(args, options));
}

// Caller must hold the shared startup lock across core startup and preparation.
export async function prepareSearchUnlocked(args, { run = runCommand, fetchImpl = fetch, log = console.log, signal, pause = sleep } = {}) {
  const targets = preparationTargets(args);
  if (process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT) {
    throw new Error("Search preparation requires an explicit Docker context when DOCKER_HOST is overridden. Select a context for the intended daemon before retrying; no search service was started.");
  }
  const started = performance.now();
  const checkCancelled = () => signal?.throwIfAborted();
  checkCancelled();
  const execute = async (args, options = {}) => {
    if (!options.cleanup) checkCancelled();
    const result = await run("docker", args, { signal: options.cleanup ? undefined : signal, timeout: 900000, ...options });
    if (!options.cleanup) checkCancelled();
    if (result.error || result.cancelled || result.status !== 0) throw new Error("A bounded Docker operation failed. Existing catalogs and favorites were not replaced.");
    return result.stdout || "";
  };
  // Resolve once, then freeze both selectors for every startup/cleanup command.
  // Compose configuration can contain credentials: capture it, keep only name,
  // and never include raw CLI output or error objects in a diagnostic.
  const context = (await execute(["context", "show"], { capture: true, timeout: 10000 })).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(context)) throw new Error("Cannot safely identify the active Docker context; no search service was started.");
  const files = ["-f", "compose.yaml", "-f", "compose.search.yaml"];
  let project;
  try { project = JSON.parse(await execute(["--context", context, "compose", ...files, "config", "--format", "json"], { capture: true, timeout: 10000 })).name; }
  catch { checkCancelled(); throw new Error("Cannot resolve the Compose project safely; no search service was started."); }
  if (typeof project !== "string" || !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(project)) throw new Error("Cannot safely identify this Compose project; no search service was started.");
  const base = ["--context", context, "compose", "--project-name", project, ...files];
  const docker = (args, options) => execute([...base, ...args], options);
  const waitReady = async (service) => {
    for (let attempt = 0; attempt < 20; attempt++) {
      checkCancelled();
      const result = await run("docker", [...base, "exec", "-T", service, "ollama", "list"], { signal, quiet: true, timeout: 5000 });
      checkCancelled();
      if (!result.error && !result.cancelled && result.status === 0) return true;
      await pause(1000, undefined, { signal });
    }
    return false;
  };
  // Start ONLY the read-only, internal inference service first. A cold runner
  // volume cannot initialize read-only: bounded readiness falls back to the
  // controlled downloader below. Docker may still pull a missing runtime image.
  await docker(["--profile", "search", "up", "-d", "search-model"]);
  let bytes;
  let cached = false;
  if (await waitReady("search-model")) {
    try {
      // Never trust the cache name or ollama list's truncated digest. Hash the
      // actual manifest bytes against the full pin, including bounded blob sizes,
      // then ask Ollama to parse/show the model (no inference, network or pull).
      bytes = checkManifest(await docker(["exec", "-T", "search-model", "cat", "/models/manifests/registry.ollama.ai/library/nomic-embed-text/v1.5"], { capture: true, timeout: 10000 }));
      await docker(["exec", "-T", "search-model", "ollama", "show", SEARCH_MODEL.name], { capture: true, timeout: 10000 });
      cached = true;
    } catch { checkCancelled(); }
  }
  log(JSON.stringify({ event: "search-model-cache", project, context, verified: cached }));
  if (!cached) {
    // No two services may initialize/use the writable runner cache concurrently.
    await docker(["stop", "--timeout", "10", "search-model"]);
    const response = await fetchImpl("https://registry.ollama.ai/v2/library/nomic-embed-text/manifests/v1.5", {
      redirect: "error", signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30000)]),
    });
    if (!response.ok) throw new Error("The pinned public model manifest is unavailable. Preparation did not start; the core workshop is unchanged.");
    if (!response.body) throw new Error("The public model registry returned an empty manifest.");
    const chunks = [];
    let manifestBytes = 0;
    for await (const chunk of response.body) {
      checkCancelled();
      manifestBytes += chunk.length;
      if (manifestBytes > 64_000) throw new Error("The public model manifest exceeded the size bound. Preparation did not start.");
      chunks.push(chunk);
    }
    checkCancelled();
    bytes = checkManifest(Buffer.concat(chunks).toString("utf8"));
  }
  log(`Optional embedding-only showcase: pinned query-model assets ${bytes} bytes (Apache-2.0); document vectors are imported from the checked-in bundle, not generated here. No answer model or paid API. Targets: ${targets.join(", ")}.`);
  let attemptedDownload = false;
  let cleanupPromise;
  const cleanup = () => cleanupPromise ||= (async () => {
    if (!attemptedDownload) return;
    log(JSON.stringify({ event: "search-download-cleanup-started", project, context }));
    // No caller AbortSignal: repeated SIGINT/SIGTERM cannot kill this cleanup.
    // Every command remains independently time-bounded; no deletion or pruning.
    try {
      await docker(["stop", "--timeout", "10", "search-download"], { cleanup: true, timeout: 45000, capture: true });
      const inventory = async () => {
        const output = await execute(["--context", context, "ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`, "--filter", "label=com.docker.compose.service=search-download"], { cleanup: true, timeout: 10000, capture: true });
        const ids = output.trim() ? output.trim().split(/\s+/) : [];
        if (ids.length > 4 || ids.some((id) => !/^[a-f0-9]{12,64}$/.test(id))) throw new Error("Invalid owned container inventory");
        for (const id of ids) {
          const text = await execute(["--context", context, "inspect", "--format", "{{json .State}}", id], { cleanup: true, timeout: 5000, capture: true });
          const state = JSON.parse(text);
          if (state.Running !== false || !["exited", "created", "dead"].includes(state.Status)) throw new Error("Owned downloader is still running");
        }
        return ids;
      };
      const ids = await inventory();
      // Recheck after the cancelled startup client has closed and Docker settled.
      await sleep(250);
      const finalIds = await inventory();
      if (JSON.stringify(ids.sort()) !== JSON.stringify(finalIds.sort())) throw new Error("Owned downloader inventory changed during cleanup");
      log(JSON.stringify({ event: "search-download-stopped", project, context, verified: true, containers: finalIds.length }));
    } catch {
      const error = new Error(`SEARCH_DOWNLOAD_CLEANUP_FAILED: could not verify search-download stopped in project ${project}, Docker context ${context}. Run the scoped recovery command in docs/semantic-search.md before retrying. No data or volumes were deleted.`);
      error.code = "SEARCH_DOWNLOAD_CLEANUP_FAILED";
      throw error;
    }
  })();
  if (!cached) try {
    checkCancelled();
    attemptedDownload = true;
    await docker(["--profile", "search-download", "up", "-d", "search-download"]);
    log(JSON.stringify({ event: "search-download-started", project, context }));
    if (!await waitReady("search-download")) throw new Error("The model download service did not become ready. Core workshop startup does not depend on it.");
    await docker(["exec", "-T", "search-download", "ollama", "pull", SEARCH_MODEL.name]);
  } finally { await cleanup(); }
  checkCancelled();
  await docker(["--profile", "search", "up", "--build", "-d", "--wait", "--wait-timeout", "240", "app", "search-model"]);
  if (!await waitReady("search-model")) throw new Error("The internal model service did not become ready. Core browsing remains available; retry search preparation.");
  for (const target of targets) {
    checkCancelled();
    await docker(["exec", "-T", "app", "node", "scripts/search-index.mjs", "--target", target]);
  }
  checkCancelled();
  log(JSON.stringify({ status: "ready", targets, model: SEARCH_MODEL, modelAssetBytes: bytes, cached, elapsedMs: Math.round(performance.now() - started) }));
  log("Search by meaning is enabled. Refresh the page/readiness. This is a built-in showcase, not an extra lab exercise. Normal workspace:start remains model-free.");
}

export async function withPreparationSignals(operation, options = {}) {
  const interrupted = new AbortController();
  let receivedSignal;
  const onSignal = (signal) => {
    receivedSignal ||= signal;
    interrupted.abort(); // idempotent; never exit before cleanup completes
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    await operation(interrupted.signal);
    return receivedSignal === "SIGINT" ? 130 : receivedSignal ? 143 : 0;
  } catch (error) {
    const message = error?.code === "SEARCH_DOWNLOAD_CLEANUP_FAILED" ? error.message
      : receivedSignal ? "Search preparation interrupted. No later preparation steps were started; inspect the scoped downloader cleanup receipt."
        : error?.name === "AbortError" || error?.name === "TimeoutError" ? "Search preparation timed out or was cancelled before completion."
          : error?.message || "Search preparation failed.";
    (options.errorLog || console.error)(message);
    return error?.code === "SEARCH_DOWNLOAD_CLEANUP_FAILED" ? 1 : receivedSignal === "SIGINT" ? 130 : receivedSignal ? 143 : 1;
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}
export async function searchPrepareMain(args, options = {}) {
  return withPreparationSignals((signal) => prepareSearch(args, { ...options, signal }), options);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await searchPrepareMain(process.argv.slice(2));
}

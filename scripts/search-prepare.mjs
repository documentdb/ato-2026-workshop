import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
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
export async function prepareSearch(args, { run = spawnSync, fetchImpl = fetch, log = console.log } = {}) {
  const targets = preparationTargets(args);
  const started = performance.now();
  const response = await fetchImpl("https://registry.ollama.ai/v2/library/nomic-embed-text/manifests/v1.5", { redirect: "error", signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error("The pinned public model manifest is unavailable. Preparation did not start; the core workshop is unchanged.");
  if (!response.body) throw new Error("The public model registry returned an empty manifest.");
  const chunks = [];
  let manifestBytes = 0;
  for await (const chunk of response.body) {
    manifestBytes += chunk.length;
    if (manifestBytes > 64_000) throw new Error("The public model manifest exceeded the size bound. Preparation did not start.");
    chunks.push(chunk);
  }
  const bytes = checkManifest(Buffer.concat(chunks).toString("utf8"));
  log(`Optional embedding-only showcase: pinned model assets ${bytes} bytes (Apache-2.0); no generation model or paid API. Targets: ${targets.join(", ")}.`);
  const base = ["compose", "-f", "compose.yaml", "-f", "compose.search.yaml"];
  const docker = (args, options = {}) => {
    const result = run("docker", [...base, ...args], { stdio: "inherit", timeout: 900000, ...options });
    if (result.error || result.status !== 0) throw new Error(`Optional search preparation stopped at Docker ${args[0]}. Check the preceding service output. Existing catalogs and favorites were not replaced.`);
    return result;
  };
  try {
    docker(["--profile", "search-download", "up", "-d", "search-download"]);
    let ready = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const result = run("docker", [...base, "exec", "-T", "search-download", "ollama", "list"], { stdio: "ignore", timeout: 5000 });
      if (result.status === 0) { ready = true; break; }
      await sleep(1000);
    }
    if (!ready) throw new Error("The model download service did not become ready. Core workshop startup does not depend on it.");
    docker(["exec", "-T", "search-download", "ollama", "pull", SEARCH_MODEL.name]);
  } finally {
    // No down -v, no pruning, no other projects. Inference uses an internal-only network.
    docker(["stop", "search-download"]);
  }
  docker(["--profile", "search", "up", "--build", "-d", "--wait", "--wait-timeout", "240", "app", "search-model"]);
  for (const target of targets) docker(["exec", "-T", "app", "node", "scripts/search-index.mjs", "--target", target]);
  log(JSON.stringify({ status: "ready", targets, model: SEARCH_MODEL, modelAssetBytes: bytes, elapsedMs: Math.round(performance.now() - started) }));
  log("Search by meaning is enabled. Refresh the page/readiness. This is a built-in showcase, not an extra lab exercise. Normal workspace:start remains model-free.");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  prepareSearch(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}

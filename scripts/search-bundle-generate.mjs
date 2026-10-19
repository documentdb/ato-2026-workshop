// Maintainer-only: genuine local model inference, never called by search:prepare.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, rename, open, unlink, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { readCatalog } from "../src/catalog.js";
import { SearchModel, SEARCH_MODEL, MODEL_BATCH } from "../src/search-model.js";
import { documentText, hash, TEXT_VERSION } from "../src/search-contract.js";
import { BUNDLE_VERSION, BUNDLE_ENCODING, BUNDLE_NORMALIZATION, BUNDLE_FILES, byteHash, decodeSearchBundle } from "../src/search-bundle.js";

export async function generateVectors(catalog, model = new SearchModel()) {
  const sessions = [...catalog.sessions].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  await model.verify();
  const data = Buffer.alloc(sessions.length * SEARCH_MODEL.dimensions * 4);
  const entries = [];
  let calls = 0;
  for (let start = 0; start < sessions.length; start += MODEL_BATCH) {
    const batch = sessions.slice(start, start + MODEL_BATCH);
    const vectors = await model.embed(batch.map(documentText));
    calls += batch.length;
    for (const [offset, session] of batch.entries()) {
      const index = start + offset;
      // Binary float32 is explicit, compact and round-trip exact. Do not round
      // decimal JSON coordinates or renormalize differently at import time.
      for (let axis = 0; axis < SEARCH_MODEL.dimensions; axis++) data.writeFloatLE(vectors[offset][axis], (index * SEARCH_MODEL.dimensions + axis) * 4);
      const vector = Array.from({ length: SEARCH_MODEL.dimensions }, (_, axis) => data.readFloatLE((index * SEARCH_MODEL.dimensions + axis) * 4));
      entries.push({ id: session.id, sourceHash: hash(session), textHash: hash(documentText(session)), vectorHash: hash(vector) });
    }
  }
  return { entries, data, documentEmbeddingCalls: calls };
}

async function emit() {
  const version = await fetch("http://search-model:11434/api/version", { redirect: "error", signal: AbortSignal.timeout(5000) }).then((response) => response.json());
  if (version.version !== "0.1.48") throw new Error("Maintainer generation requires the reviewed runtime version.");
  const catalog = await readCatalog();
  const generated = await generateVectors(catalog);
  process.stdout.write(JSON.stringify({
    entries: generated.entries, base64: generated.data.toString("base64"),
    provenance: {
      generatedAt: new Date().toISOString(), method: "fresh-local-model-inference",
      runtime: "ollama/ollama:0.1.48", runtimeImageDigest: "sha256:4a3c5b5261f325580d7f4f6440e5094d807784f0513439dcabfda9c2bdf4191e",
      platform: process.platform, architecture: process.arch,
      endpoint: "/api/embeddings", options: { num_thread: 2, num_ctx: 2048, num_gpu: 0 },
      documentEmbeddingCalls: generated.documentEmbeddingCalls,
      license: "Apache-2.0", modelSource: "https://huggingface.co/nomic-ai/nomic-embed-text-v1.5",
      corpus: "Only this repository's public ATO schedule titles and tracks; no abstracts or private corpus.",
      reproducibility: "Stable session order and float32 encoding; CPU/backend floating-point results may differ. Regeneration changes checksums and requires review.",
    },
  }));
}

// Exclusive guard spans the entire three-file publication; unique temp files
// alone cannot prevent two publishers from interleaving final-file renames.
// Injectable I/O is only for offline race tests; production paths are fixed.
export async function publishBundle(manifestBytes, data, catalog, pin, io = { mkdir, writeFile, rename, open, unlink, readFile }) {
  decodeSearchBundle(manifestBytes, data, catalog, pin);
  const directory = new URL("../data/search/", import.meta.url);
  await io.mkdir(directory, { recursive: true });
  const lockFile = new URL(".publication.lock", directory);
  let lock;
  try { lock = await io.open(lockFile, "wx", 0o600); }
  catch (error) {
    if (error.code === "EEXIST") {
      const busy = new Error("Another bundle publication owns data/search/.publication.lock. After an interrupted maintainer publication, review/restore all three artifacts and recover the stale guard explicitly; never remove a live publisher's guard.");
      busy.code = "BUNDLE_PUBLICATION_BUSY";
      throw busy;
    }
    throw error;
  }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + "\n");
    for (const [name, bytes] of [[BUNDLE_FILES.data, data], [BUNDLE_FILES.manifest, manifestBytes]]) {
      await io.writeFile(new URL(`${name}.pending`, directory), bytes, { mode: 0o644 });
      await io.rename(new URL(`${name}.pending`, directory), new URL(name, directory));
    }
    // Pin last: interrupted publication is rejected, not silently accepted.
    const pinFile = new URL("../src/search-bundle-pin.js", import.meta.url);
    const temporary = new URL("../src/search-bundle-pin.js.pending", import.meta.url);
    await io.writeFile(temporary, `// Generated by the explicit maintainer workflow. Review with both data/search assets.\n// A manifest cannot authorize itself: production also requires these source pins.\nexport const SEARCH_BUNDLE_PIN = Object.freeze(${JSON.stringify(pin, null, 2)});\n`, { mode: 0o644 });
    await io.rename(temporary, pinFile);
    // Read final assets back while still owning the guard, before success.
    decodeSearchBundle(await io.readFile(new URL(BUNDLE_FILES.manifest, directory)), await io.readFile(new URL(BUNDLE_FILES.data, directory)), catalog, pin);
  } finally {
    await lock.close();
    await io.unlink(lockFile);
  }
}

async function writeBundle() {
  const started = performance.now();
  const execute = promisify(execFile);
  const base = ["compose", "-f", "compose.yaml", "-f", "compose.search.yaml"];
  const container = (await execute("docker", [...base, "ps", "-q", "search-model"], { timeout: 10000, maxBuffer: 10000 })).stdout.trim();
  if (!/^[a-f0-9]{12,64}$/.test(container)) throw new Error("Exactly one prepared model service must be running.");
  const image = (await execute("docker", ["inspect", "--format", "{{.Config.Image}}", container], { timeout: 10000, maxBuffer: 10000 })).stdout.trim();
  if (!image.endsWith("@sha256:4a3c5b5261f325580d7f4f6440e5094d807784f0513439dcabfda9c2bdf4191e")) throw new Error("Generation requires the exact reviewed model-service image.");
  const { stdout } = await execute("docker", [...base, "exec", "-T", "app", "node", "scripts/search-bundle-generate.mjs", "--emit"], { timeout: 1800000, maxBuffer: 3_000_000 });
  const generated = JSON.parse(stdout);
  const catalog = await readCatalog();
  if (generated.provenance.documentEmbeddingCalls !== catalog.sessions.length) throw new Error("Every catalog entry must have fresh model provenance.");
  // Inspect the actual running backend, not the requested override or host CPU.
  const { stdout: runners } = await execute("docker", [...base, "exec", "-T", "search-model", "sh", "-c", "for f in /proc/[0-9]*/cmdline; do tr '\\000' ' ' < \"$f\" 2>/dev/null; printf '\\n'; done"], { timeout: 10000, maxBuffer: 256000 });
  const backends = [...new Set([...runners.matchAll(/(?:^|\n)\/runners\/(cpu(?:_avx2|_avx)?)\/ollama_llama_server(?: |$)/g)].map((match) => match[1]))];
  if (backends.length !== 1) throw new Error("Could not establish exactly one running CPU backend for generation provenance.");
  generated.provenance.backend = backends[0];
  generated.provenance.backendEvidence = "Observed /runners/<backend>/ollama_llama_server in the model container process command line immediately after generation.";
  const data = Buffer.from(generated.base64, "base64");
  const manifest = {
    version: BUNDLE_VERSION, catalogFingerprint: catalog.fingerprint,
    model: SEARCH_MODEL, textVersion: TEXT_VERSION, normalization: BUNDLE_NORMALIZATION,
    encoding: BUNDLE_ENCODING, count: catalog.sessions.length,
    data: { file: BUNDLE_FILES.data, bytes: data.length, sha256: byteHash(data) },
    provenance: generated.provenance, sessions: generated.entries,
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
  const pin = { version: BUNDLE_VERSION, count: catalog.sessions.length, manifestBytes: manifestBytes.length, manifestSha256: byteHash(manifestBytes), dataBytes: data.length, dataSha256: byteHash(data) };
  decodeSearchBundle(manifestBytes, data, catalog, pin);
  await publishBundle(manifestBytes, data, catalog, pin);
  console.log(JSON.stringify({ status: "generated-for-review", ...pin, provenance: generated.provenance, elapsedMs: Math.round(performance.now() - started) }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === "--emit") await emit();
    else if (args.length === 1 && args[0] === "--write") await writeBundle();
    else throw new Error("Maintainers only: npm run search:bundle:generate -- --write. Start the pinned local service first; this deliberately replaces the derived bundle and pin for review, not any database.");
  } catch (error) {
    if (error.code === "BUNDLE_PUBLICATION_BUSY") console.error(error.message);
    console.error("Maintainer bundle generation failed. Check the pinned local model/runtime, writable repository and reviewed generator invocation. No database was modified; if publication was interrupted, restore/review all three bundle files together.");
    process.exitCode = 1;
  }
}

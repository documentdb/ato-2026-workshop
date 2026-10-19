// Reads the genuine checked-in model output. Corruption tests modify copies in
// memory; no model service, synthetic retrieval, or database writes occur here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readCatalog } from "../src/catalog.js";
import { readSearchBundle, decodeSearchBundle, byteHash, BUNDLE_FILES, BUNDLE_VERSION } from "../src/search-bundle.js";
import { SEARCH_BUNDLE_PIN } from "../src/search-bundle-pin.js";
import { SEARCH_MODEL } from "../src/search-model.js";
import { hash, documentText, TEXT_VERSION } from "../src/search-contract.js";
import { generateVectors, publishBundle } from "../scripts/search-bundle-generate.mjs";
import { SearchStore } from "../src/search-store.js";

const catalog = await readCatalog();
const manifestBytes = await readFile(new URL(`../data/search/${BUNDLE_FILES.manifest}`, import.meta.url));
const data = await readFile(new URL(`../data/search/${BUNDLE_FILES.data}`, import.meta.url));
const manifest = JSON.parse(manifestBytes);
const repin = (m, d = data) => ({ ...SEARCH_BUNDLE_PIN, manifestBytes: m.length, manifestSha256: byteHash(m), dataBytes: d.length, dataSha256: byteHash(d) });
const rejectsBundle = (operation) => assert.throws(operation, { code: "SEARCH_BUNDLE_INVALID" });

test("reviewed real bundle matches all 216 canonical IDs, public source/text hashes, dense normalized vectors and separate pins", async () => {
  const bundle = await readSearchBundle(catalog);
  assert.equal(bundle.version, BUNDLE_VERSION);
  assert.equal(bundle.rows.size, 216);
  assert.equal(data.length, 216 * 768 * 4);
  assert.ok(manifestBytes.length < 150000);
  assert.equal(bundle.digest, byteHash(manifestBytes));
  assert.equal(bundle.dataDigest, byteHash(data));
  assert.deepEqual(manifest.model, SEARCH_MODEL);
  assert.equal(manifest.textVersion, TEXT_VERSION);
  assert.equal(manifest.provenance.documentEmbeddingCalls, 216);
  assert.equal(manifest.provenance.method, "fresh-local-model-inference");
  assert.equal(manifest.provenance.license, "Apache-2.0");
  assert.ok(["cpu", "cpu_avx", "cpu_avx2"].includes(manifest.provenance.backend));
  for (const session of catalog.sessions) {
    const row = bundle.rows.get(session.id);
    assert.equal(row.sourceHash, hash(session));
    assert.equal(row.textHash, hash(documentText(session)));
    assert.equal(row.vectorHash, hash(row.embedding));
    assert.equal(row.embedding.length, 768);
    assert.ok(row.embedding.every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(...row.embedding) - 1) < 1e-6);
  }
  assert.ok(new Set([...bundle.rows.values()].map((row) => row.vectorHash)).size > 150, "artifact contains varied actual session vectors, not repeated dummy embeddings");
});

test("a changed manifest cannot authorize itself and any one-coordinate mutation fails the data pin", () => {
  const altered = Buffer.from(data);
  altered.writeFloatLE(altered.readFloatLE(0) + 0.0001, 0);
  rejectsBundle(() => decodeSearchBundle(manifestBytes, altered, catalog));
  const replaced = structuredClone(manifest);
  replaced.data.sha256 = byteHash(altered);
  const bytes = Buffer.from(JSON.stringify(replaced));
  rejectsBundle(() => decodeSearchBundle(bytes, altered, catalog));
  // Even a test-only updated outer pin must still match the per-session hash.
  rejectsBundle(() => decodeSearchBundle(bytes, altered, catalog, repin(bytes, altered)));
  rejectsBundle(() => decodeSearchBundle(Buffer.concat([manifestBytes, Buffer.from(" ")]), data, catalog));
});

test("malformed shape, duplicate/missing/extra/reordered IDs and stale source metadata fail closed", () => {
  for (const change of [
    (m) => { m.sessions.pop(); },
    (m) => { m.sessions.push(m.sessions[0]); },
    (m) => { m.sessions[1] = m.sessions[0]; },
    (m) => { [m.sessions[0], m.sessions[1]] = [m.sessions[1], m.sessions[0]]; },
    (m) => { m.sessions[0].id = "unexpected-id"; },
    (m) => { m.sessions[0].sourceHash = "0".repeat(64); },
    (m) => { m.sessions[0].textHash = "0".repeat(64); },
    (m) => { m.sessions[0].vectorHash = "0".repeat(64); },
    (m) => { m.count--; },
    (m) => { m.encoding = "arbitrary-json"; },
    (m) => { m.normalization = "other-v1"; },
    (m) => { m.data.file = "https://evil.invalid/model"; },
  ]) {
    const changed = structuredClone(manifest); change(changed);
    const bytes = Buffer.from(JSON.stringify(changed));
    rejectsBundle(() => decodeSearchBundle(bytes, data, catalog, repin(bytes)));
  }
});

test("wrong model, dimensions, catalog and text schema reject even when test pins are deliberately recomputed", () => {
  for (const change of [
    (m) => { m.model.name = "different-model"; }, (m) => { m.model.digest = "0".repeat(64); },
    (m) => { m.model.dimensions = 384; }, (m) => { m.catalogFingerprint = "0".repeat(64); },
    (m) => { m.textVersion++; }, (m) => { m.version = "unknown-version"; },
  ]) {
    const changed = structuredClone(manifest); change(changed);
    const bytes = Buffer.from(JSON.stringify(changed));
    rejectsBundle(() => decodeSearchBundle(bytes, data, catalog, repin(bytes)));
  }
  rejectsBundle(() => decodeSearchBundle(manifestBytes, data, { ...catalog, fingerprint: "changed" }));
});

test("nonfinite, zero, out-of-norm and truncated binary vectors are rejected", () => {
  for (const bad of [NaN, Infinity, -Infinity, 10]) {
    const changed = Buffer.from(data); changed.writeFloatLE(bad, 0);
    const m = structuredClone(manifest); m.data.sha256 = byteHash(changed);
    const bytes = Buffer.from(JSON.stringify(m));
    rejectsBundle(() => decodeSearchBundle(bytes, changed, catalog, repin(bytes, changed)));
  }
  const zero = Buffer.from(data); zero.fill(0, 0, 768 * 4);
  const m = structuredClone(manifest); m.data.sha256 = byteHash(zero);
  const bytes = Buffer.from(JSON.stringify(m));
  rejectsBundle(() => decodeSearchBundle(bytes, zero, catalog, repin(bytes, zero)));
  rejectsBundle(() => decodeSearchBundle(manifestBytes, data.subarray(0, -4), catalog));
  rejectsBundle(() => decodeSearchBundle(Buffer.alloc(150001), data, catalog));
});

test("missing/corrupt bundle errors occur before any database operation or model inference and can retry", async () => {
  let loads = 0;
  const db = { collection() { return {}; }, command() { assert.fail("no DB operation"); } };
  const model = { verify() { assert.fail("no model verification before bundle validity"); }, embed() { assert.fail("no fallback inference"); } };
  const store = new SearchStore(db, catalog, { bundleLoader: async () => { loads++; decodeSearchBundle(manifestBytes, data.subarray(4), catalog); } });
  await assert.rejects(store.prepare(model), { code: "SEARCH_BUNDLE_INVALID" });
  await assert.rejects(store.prepare(model), { code: "SEARCH_BUNDLE_INVALID" });
  assert.equal(loads, 2);
});

test("maintainer encoder alone computes bounded prefixed vectors in stable ID order (mock model, not live provenance)", async () => {
  const source = { ...catalog, sessions: catalog.sessions.slice(0, 6).reverse() };
  let verifies = 0;
  const prompts = [];
  const mock = {
    async verify() { verifies++; },
    async embed(texts) { prompts.push(...texts); return texts.map(() => Array.from({ length: 768 }, (_, i) => i === 0 ? 1 : 0)); },
  };
  const result = await generateVectors(source, mock);
  assert.equal(verifies, 1);
  assert.equal(result.documentEmbeddingCalls, 6);
  assert.equal(result.data.length, 6 * 768 * 4);
  const ordered = [...source.sessions].sort((a, b) => a.id < b.id ? -1 : 1);
  assert.deepEqual(result.entries.map((row) => row.id), ordered.map((row) => row.id));
  assert.deepEqual(prompts, ordered.map(documentText));
  const preparation = await readFile(new URL("../scripts/search-prepare.mjs", import.meta.url), "utf8");
  const store = await readFile(new URL("../src/search-store.js", import.meta.url), "utf8");
  assert.doesNotMatch(preparation, /search-bundle-generate|generateVectors/);
  assert.doesNotMatch(store, /model\.embed\(/);
});

test("overlapping maintainers cannot interleave any final asset/pin writes (in-memory I/O race)", async () => {
  const files = new Map();
  let locked = false;
  let reached;
  const firstWrite = new Promise((resolve) => { reached = resolve; });
  let proceed;
  const paused = new Promise((resolve) => { proceed = resolve; });
  let writes = 0;
  const io = {
    async mkdir() {},
    async open(_url, flags) {
      assert.equal(flags, "wx");
      if (locked) throw Object.assign(new Error("exists"), { code: "EEXIST" });
      locked = true;
      return { async writeFile() {}, async close() {} };
    },
    async writeFile(url, bytes) {
      writes++;
      files.set(url.href, typeof bytes === "string" ? Buffer.from(bytes) : Buffer.from(bytes));
      if (writes === 1) { reached(); await paused; }
    },
    async rename(from, to) { assert.ok(files.has(from.href)); files.set(to.href, files.get(from.href)); files.delete(from.href); },
    async readFile(url) { return files.get(url.href); },
    async unlink() { locked = false; },
  };
  const first = publishBundle(manifestBytes, data, catalog, SEARCH_BUNDLE_PIN, io);
  await firstWrite;
  const changed = structuredClone(manifest);
  changed.provenance.generatedAt = "2099-01-01T00:00:00.000Z";
  const changedBytes = Buffer.from(JSON.stringify(changed));
  await assert.rejects(publishBundle(changedBytes, data, catalog, repin(changedBytes), io), { code: "BUNDLE_PUBLICATION_BUSY" });
  assert.equal(writes, 1, "losing publisher writes no temp file, final asset or pin");
  assert.equal(locked, true, "loser cannot release another publisher's guard");
  proceed();
  await first;
  assert.equal(locked, false);
  const directory = new URL("../data/search/", import.meta.url);
  assert.equal(decodeSearchBundle(files.get(new URL(BUNDLE_FILES.manifest, directory).href), files.get(new URL(BUNDLE_FILES.data, directory).href), catalog).digest, SEARCH_BUNDLE_PIN.manifestSha256);
  const pinText = files.get(new URL("../src/search-bundle-pin.js", import.meta.url).href).toString();
  assert.ok(pinText.includes(SEARCH_BUNDLE_PIN.manifestSha256));
});

test("failed publication releases its own guard and never reports successful completion", async () => {
  let locked = false;
  let closed = false;
  const io = {
    async mkdir() {},
    async open() { locked = true; return { async writeFile() {}, async close() { closed = true; } }; },
    async writeFile() { throw new Error("synthetic write failure"); },
    async rename() { assert.fail("no publication after a failed write"); },
    async readFile() { assert.fail("no success verification after a failed write"); },
    async unlink() { locked = false; },
  };
  await assert.rejects(publishBundle(manifestBytes, data, catalog, SEARCH_BUNDLE_PIN, io), /synthetic write failure/);
  assert.equal(locked, false);
  assert.equal(closed, true);
});

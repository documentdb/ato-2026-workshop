// Opt-in integration: real shipped document embeddings, pinned local QUERY embeddings,
// and actual DocumentDB vector queries. Preparation must never embed documents.
// Run inside the explicitly prepared Compose app. Never part of npm test.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readConfig } from "../src/config.js";
import { createConnections } from "../src/connections.js";
import { readCatalog, seedCatalog } from "../src/catalog.js";
import { SearchModel, SEARCH_MODEL } from "../src/search-model.js";
import { readSearchBundle } from "../src/search-bundle.js";
import { SearchStore, SEARCH_COLLECTION, SEARCH_META, SEARCH_OWNER, SEARCH_INDEX, hash } from "../src/search-store.js";
import { createSearch } from "../src/search.js";
import { createApp } from "../src/server.js";
import * as repository from "../examples/complete/repository.js";

test("real precomputed bundle + query model + DocumentDB: owned import, zero document embeds, index, query, filters and safe rejection", { timeout: 600000 }, async (t) => {
  const name = `search_verify_${randomUUID().replaceAll("-", "")}`;
  const config = readConfig({ ...process.env, SEARCH_ENABLED: "1", ACTIVE_TARGET: "local", LOCAL_DATABASE_NAME: name });
  const connections = createConnections(config);
  let db;
  let owned = false;
  let app;
  t.after(async () => {
    try { if (owned) await db.dropDatabase(); }
    finally { if (app) await app.close(); else await connections.close(); }
  });
  db = await connections.db("local");
  assert.equal(await db.listCollections({}, { nameOnly: true }).hasNext(), false, "never adopt an existing test database");
  await db.createCollection("integration_ownership");
  owned = true;
  const catalog = await readCatalog();
  const bundle = await readSearchBundle(catalog);
  assert.equal(bundle.version, "ato-session-embeddings-v1");
  assert.equal(bundle.rows.size, 216);
  const bundleInfo = { version: bundle.version, digest: bundle.digest, dataDigest: bundle.dataDigest };
  const realModel = new SearchModel();
  const calls = { verify: 0, documents: 0, queries: [] };
  const preparationModel = {
    async verify() { calls.verify += 1; return realModel.verify(); },
    async embed() { calls.documents += 1; assert.fail("bundle preparation and self-probes must never invoke model.embed"); },
  };
  const queryModel = {
    verify: () => realModel.verify(),
    async embed(texts, signal) {
      assert.equal(texts.length, 1, "each semantic query embeds exactly one query string");
      assert.match(texts[0], /^search_query: /);
      calls.queries.push([...texts]);
      return realModel.embed(texts, signal);
    },
  };
  assert.equal((await realModel.verify()).digest, SEARCH_MODEL.digest);
  const service = createSearch({ config, connections, model: queryModel });
  assert.equal((await service.status("local")).code, "CATALOG_NOT_SEEDED");
  await seedCatalog(db, catalog);
  await repository.saveFavorite(db, catalog.sessions[0].id);
  const snapshot = async () => hash({
    sessions: await db.collection("sessions").find({}).sort({ _id: 1 }).toArray(),
    favorites: await db.collection("favorites").find({}).sort({ _id: 1 }).toArray(),
    catalog: await db.collection("workshop_meta").find({}).sort({ _id: 1 }).toArray(),
  });
  const before = await snapshot();
  assert.equal((await service.status("local")).code, "SEARCH_NOT_PREPARED");
  const store = new SearchStore(db, catalog);
  assert.deepEqual(await store.prepare(preparationModel, () => {}), {
    count: 216, reused: false, model: SEARCH_MODEL, bundle: bundleInfo, documentEmbeddingCalls: 0,
  });
  assert.deepEqual(await store.prepare(preparationModel, () => {}), {
    count: 216, reused: true, model: SEARCH_MODEL, bundle: bundleInfo, documentEmbeddingCalls: 0,
  });
  assert.equal(calls.verify, 2);
  assert.equal(calls.documents, 0);
  assert.deepEqual(calls.queries, []);
  const imported = await db.collection(SEARCH_COLLECTION).find({}).toArray();
  assert.equal(imported.length, bundle.rows.size);
  for (const row of imported) {
    const authoritative = bundle.rows.get(row._id);
    assert.ok(authoritative, "every imported row belongs to the real bundle");
    for (const key of ["sourceHash", "textHash", "vectorHash"]) assert.equal(row[key], authoritative[key]);
    assert.deepEqual(row.embedding, authoritative.embedding);
    assert.equal(hash(row.embedding), authoritative.vectorHash);
    assert.equal(row.bundleVersion, bundle.version);
    assert.equal(row.bundleDigest, bundle.digest);
  }
  assert.equal(await snapshot(), before, "search preparation must not change canonical catalog, metadata or favorites");
  assert.equal((await service.status("local")).ready, true);
  const marker = await store.marker();
  assert.equal(marker.ready, true);
  assert.equal(marker.bundleVersion, bundle.version);
  assert.equal(marker.bundleDigest, bundle.digest);
  await store.ready({ full: true });
  const query = await service.query("local", { query: "running AI locally", limit: 5 });
  assert.deepEqual(calls.queries, [["search_query: running AI locally"]], "the actual query invokes model.embed exactly once; import invoked it zero times");
  assert.equal(calls.documents, 0);
  assert.ok(query.results.length > 0);
  assert.equal(query.inspector.candidates, 216);
  assert.equal(query.inspector.pipeline[0].$search.cosmosSearch.k, 216);
  assert.equal(query.inspector.pipeline[0].$search.cosmosSearch.vector, "[768 numeric values omitted]");
  assert.equal(query.inspector.model.digest, SEARCH_MODEL.digest);
  assert.ok(query.results.every((result) => catalog.sessions.some((session) => session.id === result.session.id)));
  const session = query.results[0].session;
  const filtered = await service.query("local", { query: "running AI locally", track: session.track, limit: 10 });
  assert.equal(calls.queries.length, 2, "a repeated filtered query gets its own single query embedding");
  assert.ok(filtered.results.length);
  assert.ok(filtered.results.every((result) => result.session.track === session.track));
  assert.deepEqual(filtered.inspector.pipeline[2], { $match: { track: session.track } });
  await assert.rejects(service.query("local", { query: "AI", track: { $ne: "" } }), { code: "SEARCH_FILTER_INVALID" });
  for (const text of ["sourdough bread baking recipes", "penguin veterinary surgery in Antarctica"]) {
    const unrelated = await service.query("local", { query: text });
    console.log(JSON.stringify({ probe: text, results: unrelated.results.map((result) => ({ title: result.session.title, similarity: result.similarity })) }));
    assert.equal(unrelated.results.length, 0, "these sampled unrelated queries should have no accepted matches; not a universal guarantee");
  }
  // Owned test-only marker corruption is restored before any later assertion.
  await db.collection(SEARCH_META).updateOne({ _id: SEARCH_OWNER }, { $set: { modelDigest: "0".repeat(64) } });
  try {
    await assert.rejects(store.prepare(preparationModel, () => {}), { code: "SEARCH_SNAPSHOT_MISMATCH" });
    assert.equal((await service.status("local")).ready, false);
  } finally { await db.collection(SEARCH_META).replaceOne({ _id: SEARCH_OWNER }, marker); }
  for (const mutation of [
    { $unset: { bundleVersion: "", bundleDigest: "" } },
    { $set: { bundleVersion: "legacy-generated-vectors" } },
    { $set: { bundleDigest: "0".repeat(64) } },
  ]) {
    await db.collection(SEARCH_META).updateOne({ _id: SEARCH_OWNER }, mutation);
    try {
      const incompatible = await store.marker();
      await assert.rejects(store.ready({ full: true }), { code: "SEARCH_SNAPSHOT_MISMATCH" });
      await assert.rejects(store.prepare(preparationModel, () => {}), { code: "SEARCH_SNAPSHOT_MISMATCH" });
      assert.deepEqual(await store.marker(), incompatible, "legacy/mismatched markers are never silently adopted or replaced");
      assert.equal(await db.collection(SEARCH_COLLECTION).countDocuments({}), 216);
      assert.equal(await snapshot(), before);
    } finally { await db.collection(SEARCH_META).replaceOne({ _id: SEARCH_OWNER }, marker); }
  }
  const row = await db.collection(SEARCH_COLLECTION).findOne({ _id: catalog.sessions[0].id });
  // A different REAL bundle vector has a valid norm and matching self-hash, but
  // it is not authoritative for this ID. Never synthesize integration vectors.
  const other = [...bundle.rows.values()].find((candidate) => candidate.vectorHash !== row.vectorHash);
  assert.ok(other, "the real catalog contains distinct embeddings");
  for (const mutation of [
    { $set: { vectorHash: "invalid" } },
    { $set: { embedding: other.embedding, vectorHash: other.vectorHash } },
    { $unset: { bundleVersion: "", bundleDigest: "" } },
  ]) {
    await db.collection(SEARCH_COLLECTION).updateOne({ _id: row._id }, mutation);
    try {
      const incompatible = await db.collection(SEARCH_COLLECTION).findOne({ _id: row._id });
      await assert.rejects(store.ready({ full: true }), { code: "SEARCH_SNAPSHOT_MISMATCH" });
      await assert.rejects(store.prepare(preparationModel, () => {}), { code: "SEARCH_SNAPSHOT_MISMATCH" });
      assert.deepEqual(await db.collection(SEARCH_COLLECTION).findOne({ _id: row._id }), incompatible, "drift is not repaired by overwriting stored vectors");
    } finally { await db.collection(SEARCH_COLLECTION).replaceOne({ _id: row._id }, row); }
  }
  await db.collection(SEARCH_COLLECTION).dropIndex(SEARCH_INDEX.name);
  try { await assert.rejects(service.query("local", { query: "local AI" }), { code: "SEARCH_INDEX_MISMATCH" }); }
  finally { await db.command({ createIndexes: SEARCH_COLLECTION, indexes: [SEARCH_INDEX] }); }
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(service.query("local", { query: "local AI" }, cancelled.signal), { code: "SEARCH_CANCELLED" });
  assert.ok((await service.query("local", { query: "local AI" })).results.length, "cancel does not permanently poison readiness");
  assert.equal(await snapshot(), before);

  app = await createApp({ config, connections, repository, logger: { error() {} } });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const details = await fetch(`${origin}/api/config`).then((response) => response.json());
  const response = await fetch(`${origin}/api/search`, { method: "POST", headers: { "Content-Type": "application/json", "X-Workshop-Token": details.csrfToken }, body: JSON.stringify({ target: "local", query: "securing software supply chains", limit: 5 }) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.ok(result.results.length);
  assert.equal(result.inspector.status, "executed");
  assert.equal(result.target, "local");
  assert.equal(calls.documents, 0);
  assert.equal(await snapshot(), before);
  console.log(JSON.stringify({ liveHttp: true, top: result.results.map((row) => ({ title: row.session.title, similarity: row.similarity })), model: SEARCH_MODEL.name, count: result.inspector.candidates, bundle: bundleInfo, documentEmbeddingCalls: calls.documents, observedDirectQueryEmbeddingCalls: calls.queries.length }));
});

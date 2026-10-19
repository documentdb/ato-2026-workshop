// Opt-in integration: real pinned local embeddings AND actual DocumentDB vector queries.
// Run inside the explicitly prepared Compose app. Never part of npm test.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readConfig } from "../src/config.js";
import { createConnections } from "../src/connections.js";
import { readCatalog, seedCatalog } from "../src/catalog.js";
import { SearchModel, SEARCH_MODEL } from "../src/search-model.js";
import { SearchStore, SEARCH_COLLECTION, SEARCH_META, SEARCH_OWNER, SEARCH_INDEX, hash } from "../src/search-store.js";
import { createSearch } from "../src/search.js";
import { createApp } from "../src/server.js";
import * as repository from "../examples/complete/repository.js";

test("real model + DocumentDB: complete owned snapshot, index, query, filters, persistence and safe rejection", { timeout: 600000 }, async (t) => {
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
  const model = new SearchModel();
  assert.equal((await model.verify()).digest, SEARCH_MODEL.digest);
  const service = createSearch({ config, connections });
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
  assert.equal((await store.prepare(model, () => {})).count, 216);
  assert.equal((await store.prepare(model, () => {})).reused, true);
  assert.equal(await snapshot(), before, "search preparation must not change canonical catalog, metadata or favorites");
  assert.equal((await service.status("local")).ready, true);
  const marker = await store.marker();
  assert.equal(marker.ready, true);
  await store.ready({ full: true });
  const query = await service.query("local", { query: "running AI locally", limit: 5 });
  assert.ok(query.results.length > 0);
  assert.equal(query.inspector.candidates, 216);
  assert.equal(query.inspector.pipeline[0].$search.cosmosSearch.k, 216);
  assert.equal(query.inspector.pipeline[0].$search.cosmosSearch.vector, "[768 numeric values omitted]");
  assert.equal(query.inspector.model.digest, SEARCH_MODEL.digest);
  assert.ok(query.results.every((result) => catalog.sessions.some((session) => session.id === result.session.id)));
  const session = query.results[0].session;
  const filtered = await service.query("local", { query: "running AI locally", track: session.track, limit: 10 });
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
    await assert.rejects(store.prepare(model, () => {}), { code: "SEARCH_SNAPSHOT_MISMATCH" });
    assert.equal((await service.status("local")).ready, false);
  } finally { await db.collection(SEARCH_META).replaceOne({ _id: SEARCH_OWNER }, marker); }
  const row = await db.collection(SEARCH_COLLECTION).findOne({ _id: catalog.sessions[0].id });
  await db.collection(SEARCH_COLLECTION).updateOne({ _id: row._id }, { $set: { vectorHash: "invalid" } });
  try { await assert.rejects(store.ready({ full: true }), { code: "SEARCH_SNAPSHOT_MISMATCH" }); }
  finally { await db.collection(SEARCH_COLLECTION).replaceOne({ _id: row._id }, row); }
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
  console.log(JSON.stringify({ liveHttp: true, top: result.results.map((row) => ({ title: row.session.title, similarity: row.similarity })), model: SEARCH_MODEL.name, count: result.inspector.candidates }));
});

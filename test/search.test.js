import test from "node:test";
import assert from "node:assert/strict";
import { validateCatalog } from "../src/catalog.js";
import { WorkshopError } from "../src/errors.js";
import { checkedVector, MODEL_BATCH, MODEL_MAX_BYTES, MODEL_URL, SEARCH_MODEL, SearchModel } from "../src/search-model.js";
import {
  documentText, hash, SEARCH_COLLECTION, SEARCH_INDEX, SEARCH_META, SEARCH_OWNER,
  SearchStore, searchFields, TEXT_VERSION, validateIndex, validateMarker, validateRow, vectorPipeline,
} from "../src/search-store.js";
import { availableFilters, createSearch, SIMILARITY_CUTOFF, validateSearchInput } from "../src/search.js";

// Entirely offline contract tests. The in-memory adapter below is NOT a vector engine:
// it returns explicit synthetic scores and only models the collection operations used
// by SearchStore. These tests are not live DocumentDB/model or retrieval-quality proof.
const catalog = validateCatalog({
  kind: "practice", title: "Synthetic semantic-search fixture", timeZone: "America/New_York",
  version: "search-test-v1", source: "Fictional offline unit-test data", snapshotDate: "2026-10-18",
  sessions: Array.from({ length: 6 }, (_, n) => ({
    id: `session-${n + 1}`, title: `Synthetic topic ${n + 1}`, room: `Room ${n + 1}`,
    track: n % 2 ? "Databases" : "Community",
    startsAt: `2026-10-${19 + Math.floor(n / 3)}T13:00:00Z`,
    endsAt: `2026-10-${19 + Math.floor(n / 3)}T14:00:00Z`,
    url: `https://example.invalid/sessions/${n + 1}`,
  })),
});
const clone = (value) => structuredClone(value);
const unitVector = (axis = 0) => Array.from({ length: 768 }, (_, n) => Number(n === axis));
const code = (expected) => (error) => {
  assert.ok(error instanceof WorkshopError);
  assert.equal(error.code, expected);
  return true;
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const pinnedTags = (changes = {}) => ({ models: [{ name: SEARCH_MODEL.name, digest: SEARCH_MODEL.digest, size: 274_000_000, ...changes }] });
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const markerFor = (changes = {}) => ({
  _id: SEARCH_OWNER, owner: SEARCH_OWNER, fingerprint: catalog.fingerprint,
  modelDigest: SEARCH_MODEL.digest, dimensions: 768, schemaVersion: 1,
  textVersion: TEXT_VERSION, count: catalog.sessions.length, ready: true,
  readyAt: "2026-10-18T00:00:00.000Z", ...changes,
});
const rowFor = (session, n = 0) => {
  const { id, ...fields } = searchFields(session, catalog);
  const embedding = unitVector(n);
  return { _id: id, ...fields, embedding, vectorHash: hash(embedding) };
};

function fakeDatabase({ prepared = true } = {}) {
  const { sessions, ...metadata } = catalog;
  const state = {
    collections: new Map([
      ["workshop_meta", [{ _id: "catalog", ...metadata, ready: true }]],
      ["sessions", sessions.map(({ id, ...fields }) => ({ _id: id, ...fields, catalogVersion: catalog.fingerprint, schemaVersion: 1 }))],
      ["favorites", [{ _id: sessions[0].id, savedAt: "2026-10-18T00:00:00.000Z" }]],
    ]),
    indexes: prepared ? [clone(SEARCH_INDEX)] : [], writes: [], aggregates: [], reads: [],
    scores: new Map(sessions.map((session, n) => [session.id, [0.95, 0.7, SIMILARITY_CUTOFF, SIMILARITY_CUTOFF - 0.001, -0.2, 0.7][n]])),
    aggregateHook: undefined, readError: undefined,
  };
  if (prepared) {
    state.collections.set(SEARCH_META, [markerFor()]);
    state.collections.set(SEARCH_COLLECTION, sessions.map(rowFor));
  }
  const matches = (row, filter) => Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === "object" && "$lt" in value) return row[key] < value.$lt;
    return row[key] === value;
  });
  const recordWrite = (name, operation, value) => {
    assert.ok([SEARCH_COLLECTION, SEARCH_META].includes(name), `Canonical collection ${name} must never be mutated by search`);
    state.writes.push({ name, operation, value: clone(value) });
  };
  const docs = (name) => state.collections.get(name) || [];
  const writable = (name) => {
    if (!state.collections.has(name)) state.collections.set(name, []);
    return docs(name);
  };
  const db = {
    collection(name) {
      return {
        async findOne(filter) {
          state.reads.push({ name, operation: "findOne" });
          return clone(docs(name).find((row) => matches(row, filter)) || null);
        },
        find(filter) {
          let limit = Infinity;
          const cursor = {
            limit(value) { limit = value; return cursor; },
            async toArray() {
              state.reads.push({ name, operation: "find" });
              return clone(docs(name).filter((row) => matches(row, filter)).slice(0, limit));
            },
          };
          return cursor;
        },
        async countDocuments(filter) {
          if (state.readError) throw state.readError;
          return docs(name).filter((row) => matches(row, filter)).length;
        },
        listIndexes() { return { toArray: async () => clone(state.indexes) }; },
        aggregate(pipeline, options) {
          state.aggregates.push({ pipeline: clone(pipeline), options });
          return { async toArray() {
            if (state.aggregateHook) return state.aggregateHook(pipeline, options);
            const filter = pipeline.find((stage) => stage.$match)?.$match || {};
            return docs(name).filter((row) => matches(row, filter)).map((row) => {
              const { embedding, ...projected } = clone(row);
              return { ...projected, similarity: state.scores.get(row._id) };
            });
          } };
        },
        async insertOne(document) {
          recordWrite(name, "insertOne", document);
          assert.ok(!docs(name).some((row) => row._id === document._id));
          writable(name).push(clone(document));
          return { insertedId: document._id };
        },
        async updateOne(filter, update) {
          recordWrite(name, "updateOne", { filter, update });
          const row = docs(name).find((candidate) => matches(candidate, filter));
          if (!row) return { matchedCount: 0 };
          Object.assign(row, clone(update.$set || {}));
          for (const key of Object.keys(update.$unset || {})) delete row[key];
          return { matchedCount: 1 };
        },
        async bulkWrite(operations, options) {
          recordWrite(name, "bulkWrite", { operations, options });
          for (const { updateOne: operation } of operations) {
            assert.deepEqual(Object.keys(operation.update), ["$setOnInsert"]);
            assert.equal(operation.upsert, true);
            if (!docs(name).some((row) => matches(row, operation.filter))) {
              writable(name).push({ ...clone(operation.filter), ...clone(operation.update.$setOnInsert) });
            }
          }
          return { ok: 1 };
        },
      };
    },
    listCollections() { return { toArray: async () => [...state.collections.keys()].map((name) => ({ name })) }; },
    async createCollection(name) {
      recordWrite(name, "createCollection", {});
      if (state.collections.has(name)) throw new Error("NamespaceExists");
      state.collections.set(name, []);
    },
    async command(command) {
      recordWrite(command.createIndexes, "command", command);
      assert.deepEqual(command, { createIndexes: SEARCH_COLLECTION, indexes: [SEARCH_INDEX] });
      state.indexes.push(...clone(command.indexes));
      return { ok: 1 };
    },
  };
  return { db, state };
}

function searchFixture({ enabled = true, model, database = fakeDatabase(), catalogLoader = async () => catalog } = {}) {
  const targets = [];
  const calls = { verify: 0, embed: [] };
  const defaultModel = {
    async verify() { calls.verify += 1; return SEARCH_MODEL; },
    async embed(texts) { calls.embed.push(clone(texts)); return texts.map(() => unitVector()); },
  };
  const search = createSearch({
    config: { searchEnabled: enabled, targets: { local: { database: "offline_a" }, "site-b": { database: "offline_b" } } },
    connections: { async db(target) { targets.push(target); return database.db; } },
    model: model || defaultModel, catalogLoader,
  });
  return { search, targets, calls, ...database };
}

function canonicalSnapshot(state) {
  return ["sessions", "favorites", "workshop_meta"].map((name) => [name, clone(state.collections.get(name))]);
}

test("embeddings must be finite, unit-normalized, dense 768-element numeric arrays", () => {
  const valid = unitVector();
  assert.equal(checkedVector(valid), valid);
  assert.doesNotThrow(() => checkedVector(Array(768).fill(1 / Math.sqrt(768))));
  const sparse = Array(768); sparse[0] = 1;
  for (const vector of [
    null, new Float32Array(768), [], valid.slice(1), [...valid, 0], Array(768).fill(0),
    [2, ...valid.slice(1)], [NaN, ...valid.slice(1)], [Infinity, ...valid.slice(1)],
    [-Infinity, ...valid.slice(1)], ["1", ...valid.slice(1)], [null, ...valid.slice(1)], sparse,
  ]) assert.throws(() => checkedVector(vector), code("SEARCH_VECTOR_INVALID"), `reject ${Array.isArray(vector) && Object.keys(vector).length !== vector.length ? "sparse embedding" : "invalid embedding"}`);
});

test("model pin verification rejects changed digest/name/size and permits the exact sha256 pin", async () => {
  for (const data of [
    { models: [] }, pinnedTags({ digest: "f".repeat(64) }), pinnedTags({ name: "other-model:latest" }),
    pinnedTags({ size: MODEL_MAX_BYTES + 1 }), pinnedTags({ size: 0 }), pinnedTags({ size: -1 }), pinnedTags({ size: null }), pinnedTags({ size: "274000000" }),
  ]) {
    const calls = [];
    const model = new SearchModel({ fetchImpl: async (url) => { calls.push(url); return jsonResponse(data); } });
    await assert.rejects(model.embed(["search_query: vector databases"]), code("SEARCH_MODEL_MISMATCH"));
    assert.deepEqual(calls, [`${MODEL_URL}/api/tags`]);
    assert.equal(model.busy, false);
  }
  const model = new SearchModel({ fetchImpl: async () => jsonResponse(pinnedTags({ digest: `sha256:${SEARCH_MODEL.digest}` })) });
  assert.equal(await model.verify(), SEARCH_MODEL);
});

test("the model service address and API operations cannot be redirected to URLs or generation", async () => {
  let calls = 0;
  for (const url of ["http://169.254.169.254/latest/meta-data", "http://localhost:11434", "https://evil.invalid", `${MODEL_URL}/`, `${MODEL_URL}@evil.invalid`]) {
    assert.throws(() => new SearchModel({ url, fetchImpl: async () => { calls += 1; } }), code("SEARCH_CONFIGURATION"));
  }
  const model = new SearchModel({ fetchImpl: async () => { calls += 1; } });
  for (const path of ["/api/generate", "/api/chat", "/api/pull", "http://evil.invalid/api/embeddings", "/api/embeddings?url=http://evil.invalid"]) {
    await assert.rejects(model.call(path, {}), /Unsupported search model operation/);
  }
  assert.equal(calls, 0);
});

test("embedding uses only fixed tags/embeddings endpoints, explicit prefixes, bounded CPU settings, and no generation", async () => {
  const calls = [];
  let axis = 0;
  const model = new SearchModel({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    // The pinned runtime's single-prompt API returns raw vectors; the adapter
    // normalizes each one before it can reach the store/query pipeline.
    return jsonResponse(url.endsWith("/api/tags") ? pinnedTags() : { embedding: unitVector(axis++).map((n) => n * 3) });
  } });
  const texts = [documentText(catalog.sessions[0]), "search_query: a topic"];
  assert.deepEqual(await model.embed(texts), [unitVector(), unitVector(1)]);
  assert.deepEqual(calls.map(({ url }) => url), [`${MODEL_URL}/api/tags`, `${MODEL_URL}/api/embeddings`, `${MODEL_URL}/api/embeddings`]);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.body, undefined);
  for (const [n, { options: request }] of calls.slice(1).entries()) {
    assert.equal(request.method, "POST");
    assert.equal(request.redirect, "error");
    assert.ok(request.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(request.body), {
      model: SEARCH_MODEL.name, prompt: texts[n], keep_alive: "2m",
      options: { num_thread: 2, num_ctx: 2048, num_gpu: 0 },
    });
  }
  assert.ok(calls.every(({ url, options }) => new URL(url).origin === MODEL_URL && options.redirect === "error"));
});

test("unprefixed, unbounded, or malformed embedding requests never reach fetch", async () => {
  let calls = 0;
  const model = new SearchModel({ fetchImpl: async () => { calls += 1; } });
  for (const texts of [undefined, [], "search_query: x", [null], ["x"], ["search_query:x"], ["search_document: " + "x".repeat(3000)], Array(MODEL_BATCH + 1).fill("search_query: x")]) {
    await assert.rejects(model.embed(texts), code("SEARCH_EMBED_INPUT"));
  }
  assert.equal(calls, 0);
});

test("malformed model responses and outage details are rejected without exposing upstream secrets", async () => {
  const secret = "mongodb://private-user:private-password@private-host.invalid/db";
  for (const response of [
    () => jsonResponse({ embedding: [] }), () => jsonResponse({ embedding: Array(768).fill(0) }),
    () => jsonResponse({ embeddings: [unitVector(), unitVector()] }),
    () => jsonResponse({ embedding: [null, ...unitVector().slice(1)] }),
    () => jsonResponse({ embedding: ["1", ...unitVector().slice(1)] }),
    () => jsonResponse({ error: secret }), () => new Response(secret, { status: 500 }),
    () => new Response("not JSON"), () => new Response("x".repeat(256_001)),
    () => { throw new Error(secret); },
  ]) {
    const model = new SearchModel({ fetchImpl: async (url) => url.endsWith("/api/tags") ? jsonResponse(pinnedTags()) : response() });
    await assert.rejects(model.embed(["search_query: x"]), (error) => {
      assert.ok(error instanceof WorkshopError);
      assert.doesNotMatch(error.message, /private-user|private-password|private-host|mongodb:\/\//);
      return true;
    });
    assert.equal(model.busy, false);
  }
});

test("model cancellation releases its one-request lock and permits a fresh retry", { timeout: 5000 }, async () => {
  const entered = deferred();
  let block = true;
  let embeddings = 0;
  const model = new SearchModel({ fetchImpl: async (url, options) => {
    if (url.endsWith("/api/tags")) return jsonResponse(pinnedTags());
    embeddings += 1;
    if (!block) return jsonResponse({ embedding: unitVector() });
    entered.resolve();
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
  } });
  const controller = new AbortController();
  const pending = model.embed(["search_query: first"], controller.signal);
  await entered.promise;
  await assert.rejects(model.embed(["search_query: second"]), code("SEARCH_BUSY"));
  assert.equal(embeddings, 1);
  const cancelled = assert.rejects(pending, code("SEARCH_CANCELLED"));
  controller.abort();
  await cancelled;
  assert.equal(model.busy, false);
  block = false;
  assert.deepEqual(await model.embed(["search_query: retry"]), [unitVector()]);
  assert.equal(embeddings, 2);
});

test("search input has a 500-character bound, a 1–10 limit, and catalog-only explicit filters", () => {
  assert.deepEqual(validateSearchInput({ target: "local", query: ` ${"x".repeat(498)} `, limit: 10 }, catalog), { query: "x".repeat(498), limit: 10, filters: {} });
  assert.equal(validateSearchInput({ query: "x".repeat(500), limit: 1 }, catalog).query.length, 500);
  assert.equal(validateSearchInput({ query: "x" }, catalog).limit, 5);
  for (const data of [null, [], "x", {}, { query: "" }, { query: "   " }, { query: 1 }, { query: "x".repeat(501) }, ...["\n", "\r", "\t", "\0", "\u007f"].map((control) => ({ query: `x${control}y` }))]) {
    assert.throws(() => validateSearchInput(data, catalog), code("SEARCH_INPUT_INVALID"));
  }
  for (const limit of [0, -1, 11, 1.5, "5", Infinity, NaN, {}, true]) {
    assert.throws(() => validateSearchInput({ query: "x", limit }, catalog), code("SEARCH_LIMIT_INVALID"));
  }
  const options = availableFilters(catalog);
  assert.deepEqual(options, { days: ["2026-10-19", "2026-10-20"], tracks: ["Community", "Databases"] });
  assert.deepEqual(validateSearchInput({ query: "x", day: options.days[0], track: options.tracks[0] }, catalog).filters, { day: options.days[0], track: options.tracks[0] });
  assert.deepEqual(validateSearchInput({ query: "Tuesday database talks", day: "", track: "" }, catalog).filters, {}, "prompt words must not silently become filters");
  for (const data of [{ day: "2026-10-21" }, { track: "databases" }, { day: { $ne: null } }, { track: ["Community"] }, { day: null }]) {
    assert.throws(() => validateSearchInput({ query: "x", ...data }, catalog), code("SEARCH_FILTER_INVALID"));
  }
});

test("unknown fields and request-selected URL/model/pipeline options are rejected rather than used", () => {
  for (const key of ["url", "modelUrl", "baseURL", "model", "digest", "dimensions", "filters", "pipeline", "embedding", "$where", "messages", "history", "temperature"]) {
    assert.throws(() => validateSearchInput({ query: "x", [key]: "http://169.254.169.254/latest/meta-data" }, catalog), code("SEARCH_INPUT_INVALID"));
  }
});

test("document text is title/track metadata only and the real pipeline encodes full-catalog post-filtering", () => {
  assert.equal(documentText(catalog.sessions[0]), "search_document: Synthetic topic 1\nTrack: Community");
  assert.doesNotMatch(documentText(catalog.sessions[0]), /Room|https:|2026/);
  const vector = unitVector();
  const filters = { day: "2026-10-19", track: "Community" };
  const pipeline = vectorPipeline(vector, catalog.sessions.length, filters);
  assert.deepEqual(pipeline, [
    { $search: { cosmosSearch: { vector, path: "embedding", k: 6 }, returnStoredSource: true } },
    { $addFields: { similarity: { $meta: "searchScore" } } },
    { $match: filters },
    { $project: { embedding: 0, __cosmos_meta__: 0 } },
  ]);
  assert.equal(pipeline[0].$search.cosmosSearch.vector.length, SEARCH_INDEX.cosmosSearchOptions.dimensions);
  assert.deepEqual(SEARCH_INDEX.cosmosSearchOptions, { kind: "vector-ivf", numLists: 1, similarity: "COS", dimensions: 768 });
  assert.equal(vectorPipeline(vector, 6).some((stage) => stage.$match), false);
  assert.doesNotMatch(JSON.stringify(pipeline), /\$vectorSearch|knnBeta|compound/);
});

test("ownership markers reject foreign owners, snapshots, model pins, dimensions, counts, and schemas", () => {
  assert.equal(validateMarker(markerFor(), catalog).owner, SEARCH_OWNER);
  assert.throws(() => validateMarker(null, catalog), code("SEARCH_NOT_PREPARED"));
  for (const changes of [
    { owner: "another-owner" }, { fingerprint: "different" }, { modelDigest: "different" },
    { dimensions: 1536 }, { textVersion: TEXT_VERSION + 1 }, { schemaVersion: 2 }, { count: 5 },
  ]) assert.throws(() => validateMarker(markerFor(changes), catalog), code("SEARCH_SNAPSHOT_MISMATCH"));
});

test("stored metadata, source/text/vector hashes, model identity, and index definition must agree", () => {
  const session = catalog.sessions[0];
  const row = rowFor(session);
  assert.doesNotThrow(() => validateRow(row, session, catalog, true));
  for (const changes of [
    { title: "Changed" }, { room: "Changed" }, { url: "https://example.invalid/changed" }, { sourceHash: "wrong" },
    { textHash: "wrong" }, { modelDigest: "wrong" }, { textVersion: 2 }, { schemaVersion: 2 },
    { day: "2026-10-21" }, { vectorHash: "wrong" }, { embedding: unitVector(1) },
  ]) assert.throws(() => validateRow({ ...row, ...changes }, session, catalog, true), code("SEARCH_SNAPSHOT_MISMATCH"));
  assert.throws(() => validateRow(row, undefined, catalog, true), code("SEARCH_SNAPSHOT_MISMATCH"));
  assert.throws(() => validateRow({ ...row, embedding: Array(768).fill(0) }, session, catalog, true), code("SEARCH_VECTOR_INVALID"));
  assert.doesNotThrow(() => validateIndex(clone(SEARCH_INDEX)));
  for (const index of [
    null, { ...SEARCH_INDEX, key: { other: "cosmosSearch" } }, { ...SEARCH_INDEX, key: { embedding: 1 } },
    ...[{ kind: "vector-hnsw" }, { numLists: 2 }, { similarity: "IP" }, { dimensions: 767 }].map((change) => ({ ...SEARCH_INDEX, cosmosSearchOptions: { ...SEARCH_INDEX.cosmosSearchOptions, ...change } })),
  ]) assert.throws(() => validateIndex(index), code("SEARCH_INDEX_MISMATCH"));
});

test("readiness rejects missing, duplicate, extra, corrupted, or wrong-catalog rows without creating an index", async () => {
  const cases = [
    (state) => state.collections.get(SEARCH_COLLECTION).pop(),
    (state) => state.collections.get(SEARCH_COLLECTION).push(rowFor(catalog.sessions[0])),
    (state) => { state.collections.get(SEARCH_COLLECTION)[1] = rowFor(catalog.sessions[0]); },
    (state) => { state.collections.get(SEARCH_COLLECTION)[0].sourceHash = "changed"; },
    (state) => { state.collections.get(SEARCH_COLLECTION)[0].vectorHash = "changed"; },
    (state) => { state.collections.get("workshop_meta")[0].fingerprint = "different-canonical-catalog"; },
  ];
  for (const mutate of cases) {
    const { db, state } = fakeDatabase(); mutate(state);
    await assert.rejects(new SearchStore(db, catalog).ready({ full: true }), code("SEARCH_SNAPSHOT_MISMATCH"));
    assert.equal(state.writes.length, 0);
  }
  const { db, state } = fakeDatabase(); state.indexes = [];
  await assert.rejects(new SearchStore(db, catalog).ready(), code("SEARCH_INDEX_MISMATCH"));
  assert.equal(state.writes.length, 0);
  state.indexes = [clone(SEARCH_INDEX), { ...clone(SEARCH_INDEX), name: "ambiguous_second_vector_index" }];
  await assert.rejects(new SearchStore(db, catalog).ready(), code("SEARCH_INDEX_MISMATCH"));
  assert.equal(state.writes.length, 0);
});

test("preparation refuses unowned search namespaces and incompatible ownership without mutation", async () => {
  const model = { verify: async () => SEARCH_MODEL, embed: async () => assert.fail("must not embed") };
  for (const existing of [SEARCH_COLLECTION, SEARCH_META]) {
    const { db, state } = fakeDatabase({ prepared: false });
    state.collections.set(existing, []);
    const before = clone([...state.collections]);
    await assert.rejects(new SearchStore(db, catalog).prepare(model, () => {}), code("SEARCH_UNOWNED"));
    assert.deepEqual([...state.collections], before);
    assert.equal(state.writes.length, 0);
  }
  for (const changes of [{ owner: "foreign" }, { fingerprint: "foreign" }, { modelDigest: "foreign" }, { count: 99 }]) {
    const { db, state } = fakeDatabase();
    Object.assign(state.collections.get(SEARCH_META)[0], changes);
    const before = clone([...state.collections]);
    await assert.rejects(new SearchStore(db, catalog).prepare(model, () => {}), code("SEARCH_SNAPSHOT_MISMATCH"));
    assert.deepEqual([...state.collections], before);
    assert.equal(state.writes.length, 0);
  }
});

test("explicit preparation batches prefixed metadata, checks stored vectors/index/probe, and never changes canonical collections", async () => {
  const { db, state } = fakeDatabase({ prepared: false });
  const before = canonicalSnapshot(state);
  const inputs = [];
  state.scores.set(catalog.sessions[0].id, 1); // Synthetic self-score; no engine calculation.
  const model = { verify: async () => SEARCH_MODEL, async embed(texts) { inputs.push(clone(texts)); return texts.map(() => unitVector()); } };
  const store = new SearchStore(db, catalog);
  const result = await store.prepare(model, () => {});
  assert.deepEqual(result, { count: 6, reused: false, model: SEARCH_MODEL });
  assert.deepEqual(inputs.flat(), catalog.sessions.map(documentText));
  assert.deepEqual(inputs.map((batch) => batch.length), [4, 2]);
  assert.deepEqual(canonicalSnapshot(state), before);
  assert.ok(state.writes.every(({ name }) => [SEARCH_META, SEARCH_COLLECTION].includes(name)));
  assert.deepEqual(state.indexes, [SEARCH_INDEX]);
  assert.equal(state.collections.get(SEARCH_META)[0].ready, true);
  assert.equal(state.collections.get(SEARCH_META)[0].leaseId, undefined);
  for (const row of state.collections.get(SEARCH_COLLECTION)) {
    validateRow(row, catalog.sessions.find((session) => session.id === row._id), catalog, true);
    assert.equal(row.embedding.length, 768);
  }
  const writes = state.writes.length;
  assert.deepEqual(await store.prepare(model, () => {}), { count: 6, reused: true, model: SEARCH_MODEL });
  assert.equal(inputs.length, 2, "ready snapshots are verified and reused, not re-embedded");
  assert.equal(state.writes.length, writes);
  assert.equal(state.aggregates.length, 2);
  assert.ok(state.aggregates.every(({ pipeline }) => pipeline[0].$search.cosmosSearch.k === catalog.sessions.length));
});

test("preparation never repairs drift by overwriting canonical content, vectors, or a conflicting index", async () => {
  for (const [mutate, expected] of [
    [(state) => { state.collections.get("sessions")[0].title = "canonical drift"; }, "SEARCH_SNAPSHOT_MISMATCH"],
    [(state) => { state.collections.get(SEARCH_COLLECTION)[0].vectorHash = "vector drift"; }, "SEARCH_SNAPSHOT_MISMATCH"],
    [(state) => { state.indexes[0].cosmosSearchOptions.dimensions = 12; }, "SEARCH_INDEX_MISMATCH"],
  ]) {
    const { db, state } = fakeDatabase(); mutate(state);
    const before = clone([...state.collections]); const indexes = clone(state.indexes);
    const model = { verify: async () => SEARCH_MODEL, embed: async () => assert.fail("must not re-embed drift") };
    await assert.rejects(new SearchStore(db, catalog).prepare(model, () => {}), code(expected));
    assert.deepEqual([...state.collections], before);
    assert.deepEqual(state.indexes, indexes);
    assert.equal(state.writes.length, 0);
  }
});

test("disabled status/query need no catalog, database, or model and report explicit unavailability", async () => {
  const never = async () => assert.fail("disabled semantic search must not touch dependencies");
  const search = createSearch({ config: { searchEnabled: false, targets: {} }, connections: { db: never }, model: { verify: never, embed: never }, catalogLoader: never });
  const status = await search.status("local");
  assert.equal(status.enabled, false);
  assert.equal(status.ready, false);
  assert.equal(status.code, "SEARCH_DISABLED");
  await assert.rejects(search.query("local", { query: "topic" }), code("SEARCH_DISABLED"));
});

test("status catches and sanitizes database/model errors, and does not cache failed readiness", async () => {
  const fixture = searchFixture();
  assert.equal((await fixture.search.status("local")).ready, true);
  const error = new Error("mongodb://private-user:private-password@private-host.invalid/db");
  error.name = "MongoServerSelectionError";
  fixture.state.readError = error;
  const failed = await fixture.search.status("local");
  assert.equal(failed.ready, false);
  assert.equal(failed.code, "DATABASE_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(failed), /private-user|private-password|private-host|mongodb:\/\//);
  fixture.state.readError = undefined;
  fixture.state.collections.get(SEARCH_COLLECTION)[0].vectorHash = "changed after failure";
  assert.equal((await fixture.search.status("local")).code, "SEARCH_SNAPSHOT_MISMATCH", "failed status must invalidate prior full verification");
  const unavailable = searchFixture({ model: { async verify() { throw error; } } });
  assert.equal((await unavailable.search.status("local")).code, "DATABASE_UNAVAILABLE");
  const unknown = searchFixture();
  assert.equal((await unknown.search.status("arbitrary")).code, "TARGET_NOT_CONFIGURED");
  assert.deepEqual(unknown.targets, []);
});

test("a failed catalog load is retried rather than retained as a rejected promise", async () => {
  let loads = 0;
  const fixture = searchFixture({ catalogLoader: async () => { loads += 1; if (loads === 1) throw new Error("private catalog path"); return catalog; } });
  const failure = await fixture.search.status("local");
  assert.equal(failure.code, "INTERNAL_ERROR");
  assert.doesNotMatch(JSON.stringify(failure), /private catalog path/);
  assert.equal((await fixture.search.status("local")).ready, true);
  assert.equal(loads, 2);
});

test("search ranks numeric scores with a cutoff/limit, returns source evidence, and shows the executed DocumentDB contract", async () => {
  const fixture = searchFixture();
  const result = await fixture.search.query("local", { target: "local", query: "  distributed systems  ", limit: 3 });
  assert.deepEqual(fixture.calls.embed, [["search_query: distributed systems"]]);
  assert.deepEqual(result.results.map(({ session, rank, similarity }) => [session.id, rank, similarity]), [["session-1", 1, 0.95], ["session-2", 2, 0.7], ["session-6", 3, 0.7]]);
  for (const item of result.results) {
    assert.deepEqual(item.session, catalog.sessions.find((session) => session.id === item.session.id));
    assert.deepEqual(item.evidence, { title: item.session.title, track: item.session.track });
    assert.ok(item.similarity >= SIMILARITY_CUTOFF);
    assert.equal(item.session.embedding, undefined);
  }
  assert.equal(result.inspector.target, "local");
  assert.equal(result.inspector.database, "offline_a");
  assert.equal(result.inspector.collection, SEARCH_COLLECTION);
  assert.equal(result.inspector.metadataOnly, true);
  assert.equal(result.inspector.candidates, 6);
  assert.equal(result.inspector.cutoff, SIMILARITY_CUTOFF);
  assert.deepEqual(result.inspector.model, SEARCH_MODEL);
  assert.deepEqual(result.inspector.index, SEARCH_INDEX);
  assert.equal(result.inspector.pipeline[0].$search.cosmosSearch.vector, "[768 numeric values omitted]");
  assert.equal(fixture.state.aggregates[0].pipeline[0].$search.cosmosSearch.vector.length, 768);
  assert.equal(fixture.state.aggregates[0].pipeline[0].$search.cosmosSearch.k, 6, "request limit is not retrieval k");
  assert.equal(fixture.state.aggregates[0].options.maxTimeMS, 10000);
  for (const key of ["embeddingMs", "databaseMs", "totalMs"]) assert.ok(Number.isFinite(result.inspector[key]) && result.inspector[key] >= 0);
  assert.match(result.inspector.filterStrategy, /not pre-retrieval/);
  assert.match(result.inspector.rankingPolicy, /not probabilities/);
  assert.equal(fixture.state.writes.length, 0);
});

test("explicit day/track post-filters preserve full catalog k and include the exact configured cutoff", async () => {
  const fixture = searchFixture();
  const result = await fixture.search.query("local", { query: "topic", limit: 10, day: "2026-10-19", track: "Community" });
  assert.deepEqual(result.results.map(({ session }) => session.id), ["session-1", "session-3"]);
  assert.equal(result.results[1].similarity, SIMILARITY_CUTOFF);
  assert.equal(result.inspector.candidates, 2);
  const pipeline = fixture.state.aggregates[0].pipeline;
  assert.equal(pipeline[0].$search.cosmosSearch.k, 6);
  assert.deepEqual(pipeline[2], { $match: { day: "2026-10-19", track: "Community" } });
  const empty = await fixture.search.query("local", { query: "topic", day: "2026-10-20", track: "Community" });
  assert.deepEqual(empty.results, []);
  assert.match(empty.message, /No strong metadata matches/);
});

test("model outage never runs the vector query or substitutes keyword browsing, and retry is not cached", async () => {
  let failing = true;
  const embeds = [];
  const fixture = searchFixture({ model: {
    async embed(texts) {
      embeds.push(clone(texts));
      if (failing) throw new WorkshopError(503, "SEARCH_MODEL_UNAVAILABLE", "Optional embedding is unavailable.");
      return [unitVector()];
    },
  } });
  const before = canonicalSnapshot(fixture.state);
  await assert.rejects(fixture.search.query("local", { query: "topic" }), code("SEARCH_MODEL_UNAVAILABLE"));
  assert.equal(fixture.state.aggregates.length, 0);
  assert.equal(fixture.state.reads.some(({ name }) => ["sessions", "favorites"].includes(name)), false, "no keyword/favorite fallback was read");
  failing = false;
  assert.ok((await fixture.search.query("local", { query: "topic" })).results.length > 0);
  assert.deepEqual(embeds, [["search_query: topic"], ["search_query: topic"]]);
  assert.equal(fixture.state.aggregates.length, 1);
  assert.deepEqual(canonicalSnapshot(fixture.state), before);
  assert.equal(fixture.state.writes.length, 0);
});

test("identical and subsequent queries are independently embedded/queried with no history or result persistence", async () => {
  const fixture = searchFixture();
  for (const query of ["first private query", "second private query", "first private query"]) await fixture.search.query("local", { query });
  assert.deepEqual(fixture.calls.embed, [["search_query: first private query"], ["search_query: second private query"], ["search_query: first private query"]]);
  assert.equal(fixture.state.aggregates.length, 3);
  assert.equal(fixture.state.writes.length, 0);
  assert.doesNotMatch(JSON.stringify([...fixture.state.collections]), /private query/);
});

test("only one query is allowed across targets; model cancellation releases busy and allows retry", { timeout: 5000 }, async () => {
  const entered = deferred();
  let block = true;
  let calls = 0;
  const fixture = searchFixture({ model: {
    async embed(_texts, signal) {
      calls += 1;
      if (!block) return [unitVector()];
      entered.resolve();
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    },
  } });
  const controller = new AbortController();
  const pending = fixture.search.query("local", { query: "first" }, controller.signal);
  await entered.promise;
  await assert.rejects(fixture.search.query("site-b", { query: "second" }), code("SEARCH_BUSY"));
  assert.deepEqual(fixture.targets, ["local"]);
  const cancelled = assert.rejects(pending, code("SEARCH_CANCELLED"));
  controller.abort();
  await cancelled;
  assert.equal(fixture.state.aggregates.length, 0);
  block = false;
  assert.equal((await fixture.search.query("site-b", { query: "retry" })).target, "site-b");
  assert.equal(calls, 2);
});

test("database cancellation propagates its signal, discards results, and releases busy for a new request", { timeout: 5000 }, async () => {
  const fixture = searchFixture();
  const entered = deferred();
  const controller = new AbortController();
  fixture.state.aggregateHook = async (_pipeline, options) => {
    assert.equal(options.signal, controller.signal);
    entered.resolve();
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
  };
  const pending = fixture.search.query("local", { query: "cancel in database" }, controller.signal);
  await entered.promise;
  const cancelled = assert.rejects(pending, code("SEARCH_CANCELLED"));
  controller.abort(); await cancelled;
  fixture.state.aggregateHook = undefined;
  assert.ok((await fixture.search.query("local", { query: "retry" })).results.length > 0);
  assert.equal(fixture.state.aggregates.length, 2);
});

test("an already cancelled query never obtains a database or calls the model", async () => {
  const fixture = searchFixture();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(fixture.search.query("local", { query: "cancelled" }, controller.signal), code("SEARCH_CANCELLED"));
  assert.deepEqual(fixture.targets, []);
  assert.deepEqual(fixture.calls.embed, []);
  assert.equal(fixture.state.aggregates.length, 0);
  assert.ok((await fixture.search.query("local", { query: "retry" })).results.length > 0);
});

test("partial, duplicated, drifted, or nonnumeric engine results are rejected instead of becoming fallback results", async () => {
  for (const [transform, expected] of [
    [(rows) => rows.slice(1), "SEARCH_SNAPSHOT_MISMATCH"],
    [(rows) => rows.map((row, n) => n === 1 ? rows[0] : row), "SEARCH_SNAPSHOT_MISMATCH"],
    [(rows) => rows.map((row, n) => n ? row : { ...row, sourceHash: "drift" }), "SEARCH_SNAPSHOT_MISMATCH"],
    ...[undefined, null, "0.9", NaN, Infinity, 2, -2].map((similarity) => [(rows) => rows.map((row, n) => n ? row : { ...row, similarity }), "SEARCH_SCORE_INVALID"]),
  ]) {
    const fixture = searchFixture();
    const rows = fixture.state.collections.get(SEARCH_COLLECTION).map((row) => ({ ...clone(row), similarity: 0.8 }));
    fixture.state.aggregateHook = async () => transform(rows);
    await assert.rejects(fixture.search.query("local", { query: "topic" }), code(expected));
    assert.equal(fixture.state.aggregates.length, 1);
    assert.equal(fixture.state.writes.length, 0);
    fixture.state.aggregateHook = undefined;
    assert.ok((await fixture.search.query("local", { query: "topic" })).results.length > 0, "engine failure is not cached");
  }
});

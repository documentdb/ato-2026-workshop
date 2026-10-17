import { inspectDatabase } from "../src/inspection.js";
import { programCounts } from "../scripts/program-counts.mjs";
import { programCountsPipeline } from "../examples/complete/program-counts.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readConfig } from "../src/config.js";
import { createConnections } from "../src/connections.js";
import { readCatalog, seedCatalog } from "../src/catalog.js";
import * as repository from "../examples/complete/repository.js";
import { readPlanner } from "../src/planner.js";
import { copyFavorites } from "../src/transfer.js";
import { createCalendar } from "../src/calendar.js";
import { createApp } from "../src/server.js";
import { WorkshopError } from "../src/errors.js";
import { readPracticeCatalog } from "./fixtures/catalog.js";

test("two real independent DocumentDB servers: independent data, retry-safe round trip, partial outcomes, migration, API", async (t) => {
  const runId = randomUUID().replaceAll("-", "");
  const localEnv = {
    ...process.env,
    ACTIVE_TARGET: "local",
    WORKSHOP_SCENARIO: "attendee",
    CLOUD_DOCUMENTDB_URI: "",
    CLOUD_DATABASE_NAME: "",
  };
  const config = readConfig({ ...localEnv, LOCAL_DATABASE_NAME: `verify_source_${runId}` });
  const sourceConnections = createConnections(config);
  const destinationConnections = createConnections(readConfig({ ...localEnv, SITE_B_DATABASE_NAME: `verify_destination_${runId}` }));
  let source;
  let destination;
  let sourceOwned = false;
  let destinationOwned = false;
  // Register ownership-aware cleanup before the first asynchronous acquisition.
  t.after(async () => {
    try {
      if (sourceOwned) await source.dropDatabase();
    } finally {
      try {
        if (destinationOwned) await destination.dropDatabase();
      } finally {
        await Promise.all([sourceConnections.close(), destinationConnections.close()]);
      }
    }
  });
  source = await sourceConnections.db("local");
  destination = await destinationConnections.db("site-b");
  assert.notEqual(config.targets.local.uri.split("@")[1], config.targets["site-b"].uri.split("@")[1], "integration requires two distinct server endpoints");
  // Site A's credentials must not authenticate to Site B (or vice versa).
  for (const [from, to] of [["local", "site-b"], ["site-b", "local"]]) {
    const foreign = createConnections({ targets: { local: {
      ...config.targets[from],
      uri: `${config.targets[from].uri.split("@")[0]}@${config.targets[to].uri.split("@")[1]}`,
    } } });
    try {
      await assert.rejects(async () => (await foreign.db("local")).command({ ping: 1 }), { code: 18 });
    } finally { await foreign.close(); }
  }
  await source.createCollection("verification_ownership");
  sourceOwned = true;
  await destination.createCollection("verification_ownership");
  destinationOwned = true;
  const catalog = await readPracticeCatalog();
  await seedCatalog(source, catalog);
  await seedCatalog(destination, catalog);
  const ids = catalog.sessions.map((session) => session.id);
  await repository.saveFavorite(source, ids[0]);
  await repository.saveFavorite(source, ids[1]);
  const originalSavedAt = (await source.collection("favorites").findOne({ _id: ids[0] })).savedAt;
  await repository.saveFavorite(destination, ids[2]);
  await seedCatalog(source, catalog);
  assert.equal((await readPlanner(source, repository)).favorites.length, 2);
  await assert.rejects(seedCatalog(source, await readCatalog()), { code: "CATALOG_MISMATCH" });
  assert.equal((await readPlanner(source, repository)).favorites.length, 2);
  assert.deepEqual((await readPlanner(destination, repository)).favorites, [ids[2]]);

  const partialDestination = {
    collection(name) {
      const collection = destination.collection(name);
      if (name !== "favorites") return collection;
      return {
        updateOne(filter, ...args) {
          if (filter._id === ids[1]) throw new WorkshopError(503, "INJECTED_FAILURE", "Deliberate verification failure.");
          return collection.updateOne(filter, ...args);
        },
      };
    },
  };
  const partial = await copyFavorites(source, partialDestination, [ids[0], ids[1], ids[3]]);
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.results.map((item) => item.status), ["copied", "failed", "invalid"]);
  const destinationSavedAt = (await destination.collection("favorites").findOne({ _id: ids[0] })).savedAt;
  const retry = await copyFavorites(source, destination, [ids[0], ids[1]]);
  assert.equal(retry.complete, true);
  assert.deepEqual(retry.results.map((item) => item.status), ["already_present", "copied"]);
  const repeated = await copyFavorites(source, destination, [ids[0], ids[1]]);
  assert.equal((await destination.collection("favorites").findOne({ _id: ids[0] })).savedAt, destinationSavedAt);
  assert.equal((await source.collection("favorites").findOne({ _id: ids[0] })).savedAt, originalSavedAt);
  assert.ok(repeated.results.every((item) => item.status === "already_present"));
  await copyFavorites(destination, source, [ids[2]]);
  assert.deepEqual(new Set((await readPlanner(source, repository)).favorites), new Set(ids.slice(0, 3)));
  assert.deepEqual(new Set((await readPlanner(destination, repository)).favorites), new Set(ids.slice(0, 3)));
  await destination.collection("workshop_meta").updateOne({ _id: "catalog" }, { $set: { fingerprint: "different" } });
  await assert.rejects(copyFavorites(source, destination, [ids[0]]), { code: "CATALOG_MISMATCH" });
  await destination.collection("workshop_meta").updateOne({ _id: "catalog" }, { $set: { fingerprint: catalog.fingerprint } });
  const originalSession = await destination.collection("sessions").findOne({ _id: ids[0] });
  await destination.collection("sessions").updateOne({ _id: ids[0] }, { $set: { room: "Changed practice room" } });
  const drift = await copyFavorites(source, destination, [ids[0]]);
  assert.equal(drift.complete, false);
  assert.equal(drift.results[0].status, "invalid");
  assert.match(drift.results[0].message, /details differ/);
  await destination.collection("sessions").updateOne({ _id: ids[0] }, { $set: { room: originalSession.room } });

  const beforeMigration = await inspectDatabase(source);
  assert.equal(beforeMigration.session.schemaVersion, 1);
  assert.equal(Object.hasOwn(beforeMigration.session, "attendanceMode"), false);
  assert.ok(beforeMigration.favorite.savedAt);
  await source.collection("sessions").createIndex({ startsAt: 1, _id: 1 }, { name: "schedule_order" });
  const migrate = () => source.collection("sessions").updateMany(
    { catalogVersion: catalog.fingerprint, schemaVersion: 1, attendanceMode: { $exists: false } },
    { $set: { schemaVersion: 2, attendanceMode: "in-person" } },
  );
  assert.equal((await migrate()).modifiedCount, catalog.sessions.length);
  assert.equal((await migrate()).modifiedCount, 0);
  const afterMigration = await inspectDatabase(source);
  assert.equal(afterMigration.session._id, beforeMigration.session._id);
  assert.equal(afterMigration.session.schemaVersion, 2);
  assert.equal(afterMigration.session.attendanceMode, "in-person");
  assert.equal(afterMigration.favorite.savedAt, beforeMigration.favorite.savedAt);
  assert.ok(afterMigration.indexes.some(({ name }) => name === "schedule_order"));
  await seedCatalog(source, catalog);
  assert.equal(await source.collection("sessions").countDocuments({ schemaVersion: 2 }), catalog.sessions.length);
  const state = await readPlanner(source, repository);
  const calendar = createCalendar(state.sessions.filter((session) => state.favorites.includes(session.id)), state.catalog);
  assert.equal((calendar.match(/BEGIN:VEVENT/g) || []).length, 3);

  const app = await createApp({
    config: { ...config, mode: "complete" },
    connections: { db: async (target) => {
      if (target === "local") return source;
      if (target === "site-b") return destination;
      throw new WorkshopError(409, "TARGET_NOT_CONFIGURED", "No cloud access in this test.");
    }, close: async () => {} },
    repository,
    logger: { error() {} },
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const origin = `http://127.0.0.1:${app.server.address().port}`;
    assert.equal((await fetch(`${origin}/api/health`)).status, 200);
    const response = await fetch(`${origin}/api/state`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).sessions.length, catalog.sessions.length);
    const exported = await fetch(`${origin}/api/calendar?target=local`);
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get("content-type"), /text\/calendar/);
    const details = await (await fetch(`${origin}/api/config`)).json();
    const saved = await fetch(`${origin}/api/favorites`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Workshop-Token": details.csrfToken },
      body: JSON.stringify({ target: "local", sessionId: ids[3] }),
    });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).status, "saved");
    const post = (path, body) => fetch(`${origin}/api/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Workshop-Token": details.csrfToken },
      body: JSON.stringify(body),
    });
    assert.equal((await post("target", { target: "local", nextTarget: "cloud" })).status, 409);
    assert.equal((await post("target", { target: "local", nextTarget: "site-b" })).status, 200);
    const siteBState = await (await fetch(`${origin}/api/state`)).json();
    assert.equal(siteBState.target, "site-b");
    assert.equal(siteBState.favorites.includes(ids[3]), false, "switching must not copy");
    assert.equal((await post("target", { target: "local", nextTarget: "site-b" })).status, 409, "stale requests fail closed");
    assert.equal((await post("target", { target: "site-b", nextTarget: "local" })).status, 200);
    const copied = await post("transfer", { target: "local", source: "local", destination: "site-b", sessionIds: [ids[3]] });
    assert.equal(copied.status, 200);
    assert.equal((await copied.json()).results[0].status, "copied");
    await source.collection("favorites").deleteOne({ _id: ids[3] });
    assert.ok(await destination.collection("favorites").findOne({ _id: ids[3] }), "removal is not synchronized");
  } finally {
    await app.close();
  }
});

test("optional aggregation queries the actual official snapshot on an owned local test database", async (t) => {
  const connections = createConnections(readConfig({
    ...process.env, ACTIVE_TARGET: "local", WORKSHOP_SCENARIO: "attendee",
    LOCAL_DATABASE_NAME: `verify_query_${randomUUID().replaceAll("-", "")}`,
  }));
  let db;
  let owned = false;
  t.after(async () => {
    try { if (owned) await db.dropDatabase(); }
    finally { await connections.close(); }
  });
  db = await connections.db("local");
  await db.createCollection("verification_ownership");
  owned = true;
  const catalog = await readCatalog();
  await seedCatalog(db, catalog);
  const result = await programCounts(db, programCountsPipeline);
  // Independent calculation: conference timezone rather than pipeline bounds.
  const expected = new Map();
  for (const session of catalog.sessions) {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: catalog.timeZone }).format(new Date(session.startsAt));
    if (day === "2026-10-19") expected.set(session.track, (expected.get(session.track) || 0) + 1);
  }
  assert.deepEqual(result.rows, [...expected].map(([_id, entries]) => ({ _id, entries }))
    .sort((a, b) => b.entries - a.entries || a._id.localeCompare(b._id)));
  assert.equal(result.rows.length, 17);
  assert.equal(result.rows.reduce((sum, row) => sum + row.entries, 0), 74);
  assert.equal(await db.collection("sessions").countDocuments(), 216);
  assert.equal(await db.collection("favorites").countDocuments(), 0);
});

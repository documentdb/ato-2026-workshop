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

test("real local DocumentDB: independent data, retry-safe round trip, partial outcomes, migration, API", async (t) => {
  const runId = randomUUID().replaceAll("-", "");
  const localEnv = {
    ...process.env,
    ACTIVE_TARGET: "local",
    CLOUD_DOCUMENTDB_URI: "",
    CLOUD_DATABASE_NAME: "",
  };
  const config = readConfig({ ...localEnv, LOCAL_DATABASE_NAME: `verify_source_${runId}` });
  const sourceConnections = createConnections(config);
  const destinationConnections = createConnections(readConfig({ ...localEnv, LOCAL_DATABASE_NAME: `verify_destination_${runId}` }));
  const source = sourceConnections.db("local");
  const destination = destinationConnections.db("local");
  let sourceOwned = false;
  let destinationOwned = false;
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
  const retry = await copyFavorites(source, destination, [ids[0], ids[1]]);
  assert.equal(retry.complete, true);
  assert.deepEqual(retry.results.map((item) => item.status), ["already_present", "copied"]);
  const repeated = await copyFavorites(source, destination, [ids[0], ids[1]]);
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

  await source.collection("sessions").createIndex({ startsAt: 1, _id: 1 }, { name: "schedule_order" });
  const migrate = () => source.collection("sessions").updateMany(
    { catalogVersion: catalog.fingerprint, schemaVersion: 1, attendanceMode: { $exists: false } },
    { $set: { schemaVersion: 2, attendanceMode: "in-person" } },
  );
  assert.equal((await migrate()).modifiedCount, catalog.sessions.length);
  assert.equal((await migrate()).modifiedCount, 0);
  await seedCatalog(source, catalog);
  assert.equal(await source.collection("sessions").countDocuments({ schemaVersion: 2 }), catalog.sessions.length);
  const state = await readPlanner(source, repository);
  const calendar = createCalendar(state.sessions.filter((session) => state.favorites.includes(session.id)), state.catalog);
  assert.equal((calendar.match(/BEGIN:VEVENT/g) || []).length, 3);

  const app = await createApp({
    config: { ...config, mode: "complete" },
    connections: { db: () => source, close: async () => {} },
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
  } finally {
    await app.close();
  }
});

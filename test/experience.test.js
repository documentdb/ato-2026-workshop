import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { readCatalog } from "../src/catalog.js";
import { inspectDatabase } from "../src/inspection.js";
import { programCounts, validatePipeline } from "../scripts/program-counts.mjs";
import { programCountsPipeline } from "../examples/complete/program-counts.js";

async function browser() {
  const html = await readFile(new URL("../src/public/index.html", import.meta.url), "utf8");
  const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].at(-1)[1];
  const elements = new Map();
  const element = () => ({ hidden: true, textContent: "", value: "", children: [],
    addEventListener() {}, setAttribute() {}, append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
  });
  const context = vm.createContext({ URLSearchParams, Intl, Date, Set, Map, Error, console,
    document: {
      getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
      createElement: element, querySelectorAll: () => [],
    },
  });
  // Exercise the actual page functions without auto-boot/network. Separate HTTP
  // tests verify the endpoint contracts. This is not a rendered-browser proof.
  vm.runInContext(script.replace(/    perform\(refresh\);\s*$/, ""), context);
  vm.runInContext('config = {mode:"starter", target:"local", targets:[{id:"local",label:"Site A"}], scenario:"attendee", location:"codespaces"}', context);
  return { elements, context, run: (source) => vm.runInContext(source, context) };
}

test("expected TODOs show a guided checkpoint, not red error or indefinite loading", async () => {
  const { elements, run } = await browser();
  run('showFailure({code:"TODO_LIST_SESSIONS",message:"TODO"})');
  assert.equal(elements.get("exercise").hidden, false);
  assert.match(elements.get("exercise-title").textContent, /Exercise 1/);
  assert.match(elements.get("exercise-help").textContent, /listSessions/);
  assert.match(elements.get("exercise-guide").href, /#2-read-the-catalog$/);
  assert.doesNotMatch(elements.get("catalog-empty").textContent, /Loading/);
  assert.doesNotMatch(elements.get("catalog-source").textContent, /Loading/);
  assert.equal(elements.get("error")?.hidden ?? true, true);
  run('showFailure({code:"TODO_SAVE_FAVORITE",message:"TODO"})');
  assert.match(elements.get("exercise-title").textContent, /Exercise 2/);
  assert.match(elements.get("exercise-help").textContent, /saveFavorite/);
  assert.match(elements.get("exercise-guide").href, /#3-save-favorites-and-prove-persistence$/);
  run('renderConfiguration()');
  assert.match(elements.get("mode").textContent, /Exercise implementation/);
  assert.doesNotMatch(elements.get("mode").textContent, /TODO|unfinished/);
});

test("real errors remain errors; completed exercise state is not inferred from mode", async () => {
  const { elements, run } = await browser();
  run('showFailure({code:"DATABASE_UNAVAILABLE",message:"Database unavailable"})');
  assert.equal(elements.get("exercise").hidden, true);
  assert.equal(elements.get("error").hidden, false);
  assert.match(elements.get("catalog-empty").textContent, /could not be loaded/);
  run('config.mode="complete"; showFailure({code:"TODO_LIST_SESSIONS",message:"Unexpected TODO"})');
  assert.equal(elements.get("exercise").hidden, true);
  assert.equal(elements.get("error").textContent, "Unexpected TODO");
});

test("inspect returns actual bounded projected sessions/favorites and index definitions", async () => {
  const calls = [];
  const session = { _id: "sample", title: "Published entry", startsAt: "2026-10-19T13:00:00.000Z", schemaVersion: 1 };
  const favorite = { _id: "sample", savedAt: "2026-10-17T13:00:00.000Z" };
  const db = { collection(name) { return {
    async findOne() { return { _id: "catalog", version: "test", fingerprint: "fp" }; },
    find(filter, options) {
      calls.push({ name, filter, options });
      return { sort(order) { calls.at(-1).sort = order; return this; }, limit(count) { calls.at(-1).limit = count; return this; },
        async toArray() { return [structuredClone(name === "sessions" ? session : favorite)]; } };
    },
    listIndexes() { return { async toArray() { return [{ name: "schedule_order", key: { startsAt: 1, _id: 1 }, ignored: "not emitted" }]; } }; },
  }; } };
  const before = await inspectDatabase(db);
  assert.deepEqual(before.session, session);
  assert.equal(Object.hasOwn(before.session, "attendanceMode"), false);
  assert.deepEqual(before.favorite, favorite);
  assert.ok(calls.every(({ limit }) => limit === 1));
  assert.deepEqual(calls[0].filter, { catalogVersion: "fp" });
  assert.deepEqual(calls[1].options.projection, { _id: 1, savedAt: 1 });
  assert.deepEqual(before.indexes, [{ name: "schedule_order", key: { startsAt: 1, _id: 1 } }]);
  Object.assign(session, { schemaVersion: 2, attendanceMode: "in-person" });
  const after = await inspectDatabase(db);
  assert.equal(after.session.schemaVersion, 2);
  assert.equal(after.session.attendanceMode, "in-person");
  assert.equal(after.favorite.savedAt, before.favorite.savedAt);
});

test("optional reference counts match the real fixed snapshot, not attendees or the current day", async () => {
  const catalog = await readCatalog();
  const pipeline = programCountsPipeline(catalog.fingerprint);
  assert.deepEqual(validatePipeline(pipeline), pipeline);
  assert.equal(pipeline[0].$match.catalogVersion, catalog.fingerprint);
  const range = pipeline[0].$match.startsAt;
  const selected = catalog.sessions.filter(({ startsAt }) => startsAt >= range.$gte && startsAt < range.$lt);
  assert.ok(selected.every(({ startsAt }) => new Intl.DateTimeFormat("en-CA", { timeZone: catalog.timeZone }).format(new Date(startsAt)) === "2026-10-19"));
  const counts = new Map();
  for (const row of selected) counts.set(row.track, (counts.get(row.track) || 0) + 1);
  const expected = [...counts].map(([_id, entries]) => ({ _id, entries })).sort((a, b) => b.entries - a.entries || a._id.localeCompare(b._id));
  assert.deepEqual(pipeline[1], { $group: { _id: "$track", entries: { $sum: 1 } } });
  assert.deepEqual(pipeline[2], { $sort: { entries: -1, _id: 1 } });
  // These values are independently computed from data/catalog.json; changing
  // the snapshot requires reviewing both the challenge's expected result and test.
  assert.equal(selected.length, 74);
  assert.equal(expected.length, 17);
  assert.deepEqual(expected[0], { _id: "Inclusion & Diversity in Open Source", entries: 10 });
  let actualPipeline;
  const db = { collection(name) { return {
    async findOne() { assert.equal(name, "workshop_meta"); return { _id: "catalog", fingerprint: catalog.fingerprint, version: catalog.version }; },
    aggregate(stages, options) { actualPipeline = stages; assert.equal(options.maxTimeMS, 5000); return { async toArray() { return expected; } }; },
  }; } };
  assert.deepEqual((await programCounts(db, programCountsPipeline)).rows, expected);
  assert.deepEqual(actualPipeline.at(-1), { $limit: 30 });
  for (const stage of ["$out", "$merge", "$lookup", "$unionWith"]) {
    assert.throws(() => validatePipeline([{ [stage]: "forbidden" }]), { code: "READ_ONLY_PIPELINE" });
  }
});

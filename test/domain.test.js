import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { validateCatalog } from "../src/catalog.js";
import { readPracticeCatalog } from "./fixtures/catalog.js";
import { findConflicts } from "../src/planner.js";
import { createCalendar, escapeCalendarText, foldCalendarLine } from "../src/calendar.js";
import { readConfig, validateCloudUri } from "../src/config.js";
import { WorkshopError, publicError, reportError } from "../src/errors.js";
import { validateSelection } from "../src/transfer.js";
import * as starter from "../exercises/starter/repository.js";

const localEnv = { DOCUMENTDB_USERNAME: "test-user", DOCUMENTDB_PASSWORD: "test-only", LOCAL_DOCUMENTDB_HOST: "localhost" };

test("the practice catalog is explicit, stable, and independent of input ordering", async () => {
  const catalog = await readPracticeCatalog();
  assert.equal(catalog.kind, "practice");
  assert.match(catalog.source, /fictional/);
  assert.equal(validateCatalog({ ...catalog, sessions: [...catalog.sessions].reverse() }).fingerprint, catalog.fingerprint);
});

test("catalog validation rejects ambiguous dates, duplicate IDs, and unsafe links", async () => {
  const catalog = await readPracticeCatalog();
  for (const change of [
    { startsAt: "2026-10-19T09:00:00" },
    { startsAt: "2026-02-30T09:00:00Z" },
    { endsAt: "2026-10-18T09:00:00Z" },
    { id: "bad\r\nid" },
    { url: "javascript:alert(1)" },
  ]) {
    assert.throws(() => validateCatalog({ ...catalog, sessions: [{ ...catalog.sessions[0], ...change }] }), /Session|session|UTC/);
  }
  assert.throws(() => validateCatalog({ ...catalog, sessions: [catalog.sessions[0], catalog.sessions[0]] }), /unique/);
});

test("overlaps include containment but exclude adjacent times and different days", () => {
  const session = (id, start, end) => ({ id, startsAt: `2026-10-19T${start}:00Z`, endsAt: `2026-10-19T${end}:00Z` });
  const sessions = [
    session("a", "09:00", "10:00"),
    session("b", "09:30", "10:30"),
    session("c", "10:00", "11:00"),
    session("d", "09:40", "09:50"),
    { id: "tomorrow", startsAt: "2026-10-20T09:00:00Z", endsAt: "2026-10-20T10:00:00Z" },
  ];
  const pairs = findConflicts(sessions).map((pair) => pair.sort().join(":")).sort();
  assert.deepEqual(pairs, ["a:b", "a:d", "b:c", "b:d"]);
});

test("calendar exports stable UTC events, labels practice data, and escapes text", async () => {
  const catalog = await readPracticeCatalog();
  const session = { ...catalog.sessions[0], title: "A, B; C\\D\r\nNew line" };
  const output = createCalendar([session], catalog, new Date("2026-10-12T12:00:00Z"));
  const unfolded = output.replace(/\r\n /g, "");
  assert.match(unfolded, /PRACTICE - NOT ATO SCHEDULE/);
  assert.match(unfolded, new RegExp(`UID:${session.id}@ato-2026-workshop.invalid`));
  assert.match(unfolded, /DTSTAMP:20261012T120000Z/);
  assert.match(unfolded, /A\\, B\\; C\\\\D\\nNew line/);
  assert.ok(output.endsWith("END:VCALENDAR\r\n"));
  assert.ok(output.split("\r\n").every((line) => Buffer.byteLength(line) <= 75));
  assert.throws(() => createCalendar([], catalog), /at least one/);
});

test("calendar folding counts UTF-8 octets, including the continuation space", () => {
  const line = `SUMMARY:${"\u00e9\u{1f30d}".repeat(40)}`;
  const folded = foldCalendarLine(line);
  assert.ok(folded.split("\r\n").every((part) => Buffer.byteLength(part) <= 75));
  assert.equal(folded.replace(/\r\n /g, ""), line);
  assert.equal(escapeCalendarText("a\r\nb,c;d\\e"), "a\\nb\\,c\\;d\\\\e");
});

test("only the local development target permits a development certificate", () => {
  const config = readConfig({ ...localEnv, CLOUD_DOCUMENTDB_URI: "mongodb+srv://cluster.example.invalid/", CLOUD_DATABASE_NAME: "test_workshop" });
  assert.equal(config.targets.local.developmentCertificate, true);
  assert.equal(config.targets.cloud.developmentCertificate, false);
  assert.equal(config.activeTarget, "local");
  assert.throws(() => readConfig({ ...localEnv, LOCAL_DOCUMENTDB_HOST: "remote.example.invalid" }), /development database/);
  assert.throws(() => readConfig({ ...localEnv, ACTIVE_TARGET: "cloud" }), /not configured/);
  assert.throws(() => readConfig({ ...localEnv, CLOUD_DOCUMENTDB_URI: "mongodb+srv://cluster.example.invalid/" }), /explicit database name/);
  assert.throws(() => readConfig({ ...localEnv, WORKSHOP_MODE: "typo" }), /WORKSHOP_MODE/);
  assert.throws(() => readConfig({ ...localEnv, WORKSHOP_PUBLIC_HOST: "*.example.invalid" }), /exact hostname/);
});

test("cloud validation rejects insecure TLS, including mixed-case and duplicate options", () => {
  for (const options of [
    "tls=false", "ssl=false", "tlsInsecure=true", "tlsAllowInvalidCertificates=true",
    "tlsAllowInvalidHostnames=true", "TLS=true&tLs=false",
  ]) {
    assert.throws(() => validateCloudUri(`mongodb+srv://cluster.example.invalid/?${options}`), /TLS/);
  }
  assert.equal(validateCloudUri("mongodb+srv://cluster.example.invalid/?tls=true"), "mongodb+srv://cluster.example.invalid/?tls=true");
  assert.throws(() => validateCloudUri("not a connection string"), /valid MongoDB/);
});

test("errors do not disclose driver messages or credentials", () => {
  const error = new Error("mongodb://sensitive-value@cluster.example.invalid");
  error.name = "MongoServerSelectionError";
  const logs = [];
  reportError(error, { error: (line) => logs.push(line) });
  assert.equal(publicError(error).status, 503);
  assert.doesNotMatch(JSON.stringify({ logs, error: publicError(error) }), /sensitive-value|cluster\.example/);
});

test("copy selections are bounded, explicit, unique identifiers", () => {
  assert.deepEqual(validateSelection(["session-1"]), ["session-1"]);
  for (const ids of [[], ["x", "x"], ["x\n"], new Array(101).fill("x"), "all"]) {
    assert.throws(() => validateSelection(ids));
  }
});

test("starter methods either explain their TODO or satisfy the completed exercise contract", async () => {
  const documents = [{ _id: "session-1", catalogVersion: "version" }];
  const db = {
    collection(name) {
      if (name === "sessions") {
        return {
          find(filter) {
            assert.deepEqual(filter, { catalogVersion: "version" });
            return {
              sort(order) {
                assert.deepEqual(order, { startsAt: 1, _id: 1 });
                return { toArray: async () => documents };
              },
            };
          },
        };
      }
      assert.equal(name, "favorites");
      return {
        async updateOne(filter, update, options) {
          assert.deepEqual(filter, { _id: "session-1" });
          assert.deepEqual(options, { upsert: true });
          assert.deepEqual(Object.keys(update), ["$setOnInsert"]);
          assert.ok(Number.isFinite(Date.parse(update.$setOnInsert.savedAt)));
          return { upsertedCount: 1 };
        },
      };
    },
  };
  try {
    assert.deepEqual(await starter.listSessions(db, "version"), documents);
  } catch (error) {
    if (!(error instanceof WorkshopError) || error.code !== "TODO_LIST_SESSIONS") throw error;
    assert.equal(error.status, 501);
  }
  try {
    assert.deepEqual(await starter.saveFavorite(db, "session-1"), { upsertedCount: 1 });
  } catch (error) {
    if (!(error instanceof WorkshopError) || error.code !== "TODO_SAVE_FAVORITE") throw error;
    assert.equal(error.status, 501);
  }
});

test("browser scripts parse and explicit light/dark themes win over OS preference", async () => {
  const html = await readFile(new URL("../src/public/index.html", import.meta.url), "utf8");
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  for (const script of scripts) new vm.Script(script);
  for (const theme of ["light", "dark"]) {
    let applied;
    vm.runInNewContext(scripts[0], {
      URLSearchParams,
      window: { location: { search: `?scoutTheme=${theme}` }, matchMedia: () => ({ matches: theme !== "dark" }) },
      document: { documentElement: { setAttribute: (_key, value) => { applied = value; } } },
    });
    assert.equal(applied, theme);
  }
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=/);
});

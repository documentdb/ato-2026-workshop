import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setup } from "../scripts/setup.mjs";
import { readConfig, validateCloudUri, targetLabel } from "../src/config.js";
import { seedCatalog, requireCatalog, validateCatalog } from "../src/catalog.js";
import { readPracticeCatalog } from "./fixtures/catalog.js";
import { startWorkspace, workspaceSteps } from "../scripts/workspace-start.mjs";

const env = { DOCUMENTDB_USERNAME: "a", DOCUMENTDB_PASSWORD: "a-test-only", SITE_B_USERNAME: "b", SITE_B_PASSWORD: "b-test-only" };

test("attendees get exactly two independent sites and ignore even invalid legacy cloud settings", () => {
  const config = readConfig({ ...env, CLOUD_DOCUMENTDB_URI: "not a uri", CLOUD_DATABASE_NAME: "invalid/name" });
  assert.equal(config.scenario, "attendee");
  assert.deepEqual(Object.keys(config.targets), ["local", "site-b"]);
  assert.notEqual(config.targets.local.uri, config.targets["site-b"].uri);
  assert.equal(config.targets["site-b"].developmentCertificate, true);
  assert.match(targetLabel("local", "codespaces"), /Site A/);
  assert.match(targetLabel("site-b", "codespaces"), /Site B/);
  assert.throws(() => readConfig({ ...env, SITE_B_PASSWORD: env.DOCUMENTDB_PASSWORD }), /independently/);
  assert.throws(() => readConfig({ ...env, SITE_B_DOCUMENTDB_HOST: "outside.example.invalid" }), /development database/);
  assert.throws(() => readConfig({ ...env, LOCAL_DOCUMENTDB_HOST: "localhost", SITE_B_DOCUMENTDB_HOST: "127.0.0.1" }), /separate database endpoints/);
  assert.throws(() => readConfig({ ...env, WORKSHOP_SCENARIO: "typo" }), /WORKSHOP_SCENARIO/);
  assert.throws(() => readConfig({ ...env, ACTIVE_TARGET: "cloud", CLOUD_DOCUMENTDB_URI: "mongodb://example.invalid" }), /not configured/);
});

test("presenter mode is explicit, excludes Site B, and validates cloud TLS with multi-host URIs", () => {
  const uri = "mongodb://host-a.example.invalid:27017,host-b.example.invalid:27017/?tls=true";
  assert.equal(validateCloudUri(uri), uri);
  const config = readConfig({ ...env, SITE_B_PASSWORD: "", WORKSHOP_SCENARIO: "presenter", CLOUD_DOCUMENTDB_URI: uri, CLOUD_DATABASE_NAME: "approved_demo" });
  assert.deepEqual(Object.keys(config.targets), ["local", "cloud"]);
  assert.equal(config.targets.cloud.developmentCertificate, false);
  assert.match(targetLabel("local", "laptop", "presenter"), /laptop/);
  assert.match(targetLabel("cloud", "laptop", "presenter"), /Azure/);
  assert.throws(() => readConfig({ ...env, WORKSHOP_SCENARIO: "presenter", ACTIVE_TARGET: "site-b" }), /not configured/);
  for (const suffix of ["&tls=false", "&tlsAllowInvalidCertificates=true", "&tLsInsecure=false", "&ssl=false"]) {
    assert.throws(() => validateCloudUri(uri + suffix), /TLS/);
  }
});

test("setup creates distinct credentials, preserves .env bytes, and safely extends a legacy notebook", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ato-setup-"));
  t.after(() => rm(directory, { recursive: true }));
  const messages = [];
  await setup(directory, {}, (message) => messages.push(message));
  const filename = join(directory, ".env");
  const content = await readFile(filename, "utf8");
  const values = Object.fromEntries(content.trim().split("\n").map((line) => line.split("=")));
  assert.notEqual(values.DOCUMENTDB_PASSWORD, values.SITE_B_PASSWORD);
  if (process.platform !== "win32") assert.equal((await stat(filename)).mode & 0o077, 0);
  await setup(directory, {}, () => {});
  assert.equal(await readFile(filename, "utf8"), content);
  const legacy = '# Keep my notebook\r\nDOCUMENTDB_USERNAME=old\r\nDOCUMENTDB_PASSWORD=preserve-me\r\nLOCAL_DATABASE_NAME=my_favorites\r\nCLOUD_DOCUMENTDB_URI="legacy-secret"';
  await writeFile(filename, legacy);
  await setup(directory, {}, (message) => messages.push(message));
  const extended = await readFile(filename, "utf8");
  assert.ok(extended.startsWith(legacy + "\n"));
  assert.match(extended, /SITE_B_USERNAME=workshop_site_b/);
  assert.match(extended, /SITE_B_PASSWORD=[0-9a-f]{48}/);
  await setup(directory, {}, () => {});
  assert.equal(await readFile(filename, "utf8"), extended);
  assert.doesNotMatch(messages.join("\n"), /preserve-me|legacy-secret|[0-9a-f]{48}/);
  for (const partial of ["SITE_B_USERNAME=already_exists\n", "SITE_B_USERNAME=b\nSITE_B_PASSWORD=\n", "SITE_B_USERNAME=b\nSITE_B_PASSWORD=p\nSITE_B_PASSWORD=p2\n"]) {
    await writeFile(filename, partial);
    await assert.rejects(setup(directory, {}, () => {}), /manual review/);
    assert.equal(await readFile(filename, "utf8"), partial);
  }
});

test("any second-site readiness or seed failure stops startup without reporting success", () => {
  for (let failing = 1; failing < workspaceSteps.length; failing++) {
    let count = 0;
    const logs = [];
    assert.throws(() => startWorkspace(() => ({ status: count++ === failing ? 1 : 0 }), (line) => logs.push(line)), /startup stopped/);
    assert.equal(count, failing + 1);
    assert.deepEqual(logs, []);
  }
});

function fakeDatabase() {
  const data = { sessions: new Map(), workshop_meta: new Map() };
  let writes = 0;
  let failAt = Infinity;
  const matches = (document, filter) => Object.entries(filter).every(([key, value]) =>
    value && typeof value === "object" && "$ne" in value ? document[key] !== value.$ne : document[key] === value);
  return {
    data,
    interruptAfter(count) { failAt = writes + count; },
    resume() { failAt = Infinity; },
    collection(name) {
      const rows = data[name];
      return {
        async findOne(filter) { return [...rows.values()].find((document) => matches(document, filter)) || null; },
        async updateOne(filter, update, options = {}) {
          if (name === "sessions" && ++writes > failAt) throw new Error("simulated interruption");
          const row = [...rows.values()].find((document) => matches(document, filter));
          if (row) Object.assign(row, update.$set || {});
          else if (options.upsert) rows.set(filter._id, { ...filter, ...structuredClone(update.$setOnInsert || {}), ...update.$set });
          return { upsertedCount: !row && options.upsert ? 1 : 0 };
        },
      };
    },
  };
}

test("interrupted first seed claims its catalog and resumes without exposing partial readiness", async () => {
  const db = fakeDatabase();
  const catalog = await readPracticeCatalog();
  db.interruptAfter(1);
  await assert.rejects(seedCatalog(db, catalog), /interruption/);
  await assert.rejects(requireCatalog(db), { code: "CATALOG_NOT_SEEDED" });
  const revised = validateCatalog({ ...catalog, sessions: catalog.sessions.map((session) => ({ ...session, room: "changed" })) });
  await assert.rejects(seedCatalog(db, revised), { code: "CATALOG_MISMATCH" });
  db.resume();
  await seedCatalog(db, catalog);
  assert.equal((await requireCatalog(db)).fingerprint, catalog.fingerprint);
  assert.equal(db.data.sessions.size, catalog.sessions.length);
  assert.ok([...db.data.sessions.values()].every((row) => row.catalogVersion === catalog.fingerprint));
  await seedCatalog(db, catalog);
  assert.equal(db.data.sessions.size, catalog.sessions.length);
});

test("legacy interrupted seed rows without metadata reject a changed catalog instead of hiding data", async () => {
  const db = fakeDatabase();
  const catalog = await readPracticeCatalog();
  db.data.sessions.set("legacy-session", { _id: "legacy-session", catalogVersion: "old-fingerprint" });
  await assert.rejects(seedCatalog(db, catalog), { code: "CATALOG_MISMATCH" });
  assert.equal(db.data.workshop_meta.size, 0);
  assert.equal(db.data.sessions.size, 1);
});

test("Compose default never passes Azure settings and keeps the old Site A volume", async () => {
  const compose = await readFile(new URL("../compose.yaml", import.meta.url), "utf8");
  const presenter = await readFile(new URL("../compose.presenter.yaml", import.meta.url), "utf8");
  assert.match(compose, /documentdb-data:\/data/);
  assert.match(compose, /documentdb-site-b-data:\/data/);
  assert.match(compose, /WORKSHOP_SCENARIO: attendee/);
  assert.match(compose, /CLOUD_DOCUMENTDB_URI: ""/);
  assert.match(compose, /ACTIVE_TARGET: local/);
  assert.doesNotMatch(compose, /\$\{CLOUD_/);
  assert.match(presenter, /WORKSHOP_SCENARIO: presenter/);
  assert.match(presenter, /\$\{CLOUD_DOCUMENTDB_URI:-\}/);
});


test("container package metadata stays readable by the non-root runtime with restrictive host modes", async () => {
  const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /COPY --chown=node:node package\.json package-lock\.json \.npmrc \.\//);
  assert.match(dockerfile, /USER node/);
});

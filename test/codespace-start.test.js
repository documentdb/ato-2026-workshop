import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startCodespace, codespaceStartMain } from "../scripts/codespace-start.mjs";
import { withWorkspaceLock } from "../scripts/workspace-lock.mjs";
import { prepareSearch } from "../scripts/search-prepare.mjs";

const unlocked = (operation) => operation();
function fixture() {
  const calls = [], logs = [];
  return { calls, logs, options: {
    withLock: unlocked, env: {}, log: (message) => logs.push(message),
    run: async (command, args, options) => { calls.push([command, args, options]); return { status: 0 }; },
    prepare: async (args, options) => { calls.push(["prepare", args]); assert.ok(logs.some((line) => line.startsWith("CORE READY"))); assert.ok(options.signal); },
  } };
}

test("Codespaces serially starts unchanged core, then prepares both sites with an honest readiness receipt", async () => {
  const { calls, logs, options } = fixture();
  assert.equal(await codespaceStartMain(options), 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], process.execPath);
  assert.deepEqual(calls[0][1], ["scripts/workspace-start.mjs"]);
  assert.deepEqual(calls[1], ["prepare", ["--local-sites"]]);
  assert.match(logs.join("\n"), /can take minutes/);
  assert.match(logs.join("\n"), /"core":"ready","search":"ready"/);
  assert.match(logs.join("\n"), /Refresh the planner/);
});

test("core failure aborts search and does not claim core readiness", async () => {
  const { calls, logs, options } = fixture();
  options.run = async () => ({ status: 1 });
  assert.equal(await codespaceStartMain({ ...options, errorLog: (message) => logs.push(message) }), 1);
  assert.equal(calls.length, 0);
  assert.doesNotMatch(logs.join("\n"), /CORE READY|"core":"ready"/);
});

test("explicit opt-out keeps core, without invoking preparation", async () => {
  const { calls, logs, options } = fixture();
  assert.equal(await codespaceStartMain({ ...options, env: { WORKSHOP_AUTO_SEARCH: "0" } }), 0);
  assert.equal(calls.length, 1);
  assert.match(logs.join("\n"), /"search":"disabled"/);
});

for (const mode of ["unavailable", "SEARCH_DOWNLOAD_CLEANUP_FAILED", "AbortError"]) {
  test(`optional failure ${mode}: core remains available, unsafe/cancelled runs are nonzero`, async () => {
    const { calls, logs, options } = fixture();
    options.prepare = async () => { const error = new Error(mode); error.code = mode; error.name = mode; throw error; };
    assert.equal(await codespaceStartMain({ ...options, errorLog: (message) => logs.push(message) }), mode === "unavailable" ? 0 : 1);
    assert.equal(calls.length, 1, "must not stop core Docker services after search failure");
    assert.match(logs.join("\n"), /"core":"ready","search":"unavailable"/);
    assert.doesNotMatch(logs.join("\n"), /SEARCH READY|"search":"ready"/);
    assert.match(logs.join("\n"), /npm run search:prepare -- --local-sites/);
    if (mode === "SEARCH_DOWNLOAD_CLEANUP_FAILED") assert.match(logs.join("\n"), /SEARCH_DOWNLOAD_CLEANUP_FAILED/);
  });
}

for (const phase of ["core", "search"]) for (const signal of ["SIGINT", "SIGTERM"]) {
  test(`${signal} during ${phase} waits for cleanup and returns the correct exit`, async () => {
    const { calls, logs, options } = fixture();
    let cleaned = false;
    const interrupt = async (...args) => {
      process.emit(signal, signal);
      await new Promise((resolve) => setImmediate(resolve));
      cleaned = true;
      args.at(-1).signal.throwIfAborted();
    };
    if (phase === "core") options.run = interrupt;
    else options.prepare = interrupt;
    assert.equal(await codespaceStartMain({ ...options, errorLog: (message) => logs.push(message) }), signal === "SIGINT" ? 130 : 143);
    assert.equal(cleaned, true);
    assert.ok(calls.every(([command]) => command !== "prepare"));
    assert.doesNotMatch(logs.join("\n"), /SEARCH READY/);
  });
}

test("same checkout lock excludes simultaneous automatic/manual preparation and is released on failure", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "startup-lock-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const lock = (operation) => withWorkspaceLock(operation, directory);
  await assert.rejects(lock(async () => {
    assert.equal((await stat(join(directory, ".workshop-private/startup.lock"))).mode & 0o077, 0);
    await assert.rejects(startCodespace({ withLock: lock, run: () => assert.fail("busy startup") }), { code: "WORKSHOP_STARTUP_BUSY" });
    await assert.rejects(prepareSearch(["--local-sites"], { withLock: lock, run: () => assert.fail("busy preparation") }), { code: "WORKSHOP_STARTUP_BUSY" });
    throw new Error("operation failed");
  }), /operation failed/);
  await lock(async () => {});
  const path = join(directory, ".workshop-private/startup.lock");
  await writeFile(path, '{"pid":99999999}');
  await assert.rejects(lock(() => assert.fail("must not steal stale lock")), { code: "WORKSHOP_STARTUP_BUSY" });
  assert.equal(await readFile(path, "utf8"), '{"pid":99999999}');
});

test("lifecycle has no source-control, Azure, exercise writes, scheduler or destructive cleanup commands", async () => {
  for (const path of ["scripts/codespace-start.mjs", "scripts/workspace-start.mjs", "scripts/search-prepare.mjs"]) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /["'`](?:git|az|azd|crontab|systemctl)["'`]|\b(?:checkout|reset|stash|prune)\b|--volumes/);
    assert.doesNotMatch(source, /writeFile|["']\.env["']/);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createApp } from "../src/server.js";
import { createSearch, validateSearchInput } from "../src/search.js";
import { validateCatalog } from "../src/catalog.js";
import { WorkshopError } from "../src/errors.js";

// Local HTTP + explicit injected fakes only. No DocumentDB or model service is
// contacted; target/race/security assertions are not live vector-quality evidence.
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const catalog = validateCatalog({
  kind: "practice", title: "Offline HTTP search fixture", timeZone: "America/New_York",
  version: "http-search-test-v1", source: "Fictional unit-test data", snapshotDate: "2026-10-18",
  sessions: [{ id: "synthetic-session", title: "Synthetic database topic", track: "Databases", room: "Test room",
    startsAt: "2026-10-19T13:00:00Z", endsAt: "2026-10-19T14:00:00Z", url: "https://example.invalid/synthetic-session" }],
});
const configFor = (searchEnabled = true) => ({
  activeTarget: "local", mode: "complete", scenario: "attendee", location: "laptop", searchEnabled,
  targets: { local: { database: "offline_a" }, "site-b": { database: "offline_b" } },
});

async function serve(t, { config = configFor(), search, connections } = {}) {
  const dbCalls = [];
  const logs = [];
  const app = await createApp({ config, search, repository: {}, logger: { error: (message) => logs.push(message) },
    connections: connections || {
      async db(target) { dbCalls.push(target); return { command: async () => ({ ok: 1 }) }; },
      async close() {},
    },
  });
  await new Promise((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => { app.server.closeAllConnections(); return app.close(); });
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const get = (path) => fetch(`${origin}${path}`);
  const details = await (await get("/api/config")).json();
  const post = (path, body, token = details.csrfToken) => fetch(`${origin}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(token === undefined ? {} : { "X-Workshop-Token": token }) },
    body: JSON.stringify(body),
  });
  return {
    app, origin, get, post, details, dbCalls, logs,
    switchTarget: (target, nextTarget) => post("/api/target", { target, nextTarget }),
  };
}

async function expectError(response, status, code) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.error.code, code);
  assert.equal(body.results, undefined);
  return body;
}

test("core startup, page/config, and health work with search disabled and without a model dependency", { timeout: 5000 }, async (t) => {
  const realFetch = globalThis.fetch;
  const modelFetches = [];
  t.mock.method(globalThis, "fetch", async (url, ...args) => {
    if (new URL(url).hostname !== "127.0.0.1") modelFetches.push(url);
    assert.equal(new URL(url).hostname, "127.0.0.1", "offline startup must not fetch model/remote endpoints");
    return realFetch(url, ...args);
  });
  // Exercise createApp's actual default createSearch, not an injected search fake.
  const fixture = await serve(t, { config: configFor(false) });
  assert.deepEqual(fixture.dbCalls, []);
  assert.equal(fixture.details.target, "local");
  const page = await fixture.get("/");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<!doctype html>/i);
  const status = await fixture.get("/api/search/status");
  assert.equal(status.status, 200);
  assert.equal(status.headers.get("cache-control"), "no-store");
  const payload = await status.json();
  assert.equal(payload.target, "local");
  assert.equal(payload.enabled, false);
  assert.equal(payload.ready, false);
  assert.equal(payload.code, "SEARCH_DISABLED");
  await expectError(await fixture.post("/api/search", { target: "local", query: "topic" }), 503, "SEARCH_DISABLED");
  assert.deepEqual(fixture.dbCalls, [], "disabled status and POST must not open a database");
  assert.deepEqual(modelFetches, []);
  const health = await fixture.get("/api/health");
  assert.equal(health.status, 200);
  assert.deepEqual(fixture.dbCalls, ["local"], "core health still uses its ordinary database ping");
});

test("POST /api/search requires the request token before invoking any search work", { timeout: 5000 }, async (t) => {
  const queries = [];
  const fixture = await serve(t, { search: {
    status: async (target) => ({ target, enabled: true, ready: true }),
    async query(target, data, signal) { queries.push({ target, data, signal }); return { target, results: [] }; },
  } });
  for (const token of ["", "wrong", "x".repeat(64)]) {
    await expectError(await fixture.post("/api/search", { target: "local", query: "topic" }, token), 403, "REQUEST_TOKEN_REQUIRED");
  }
  const missing = await fetch(`${fixture.origin}/api/search`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target: "local", query: "topic" }),
  });
  await expectError(missing, 403, "REQUEST_TOKEN_REQUIRED");
  assert.equal(queries.length, 0);
  assert.deepEqual(fixture.dbCalls, []);
  const result = await fixture.post("/api/search", { target: "local", query: "topic" });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.deepEqual(await result.json(), { target: "local", results: [] });
  assert.equal(queries.length, 1);
  assert.equal(queries[0].target, "local");
  assert.deepEqual(queries[0].data, { target: "local", query: "topic" });
  assert.ok(queries[0].signal instanceof AbortSignal);
  assert.equal(queries[0].signal.aborted, false);
  assert.equal((await fixture.get("/api/search/status")).status, 200, "status is a read-only GET");
});

test("search HTTP rejects malformed/oversized bodies, unknown URL/model inputs, and nonwhitelisted filters before DB/model access", { timeout: 5000 }, async (t) => {
  const config = configFor();
  const touches = [];
  const connections = { async db() { touches.push("db"); throw new Error("unexpected DB access"); }, async close() {} };
  const model = { async verify() { touches.push("verify"); }, async embed() { touches.push("embed"); } };
  const search = createSearch({ config, connections, model, catalogLoader: async () => catalog });
  const fixture = await serve(t, { config, connections, search });
  for (const [data, expected] of [
    [{ query: "x".repeat(501) }, "SEARCH_INPUT_INVALID"], [{ query: "" }, "SEARCH_INPUT_INVALID"],
    [{ query: "x\ny" }, "SEARCH_INPUT_INVALID"], [{ query: "x", limit: 11 }, "SEARCH_LIMIT_INVALID"],
    [{ query: "x", limit: 0 }, "SEARCH_LIMIT_INVALID"], [{ query: "x", limit: "5" }, "SEARCH_LIMIT_INVALID"],
    [{ query: "x", day: "2026-10-20" }, "SEARCH_FILTER_INVALID"], [{ query: "x", track: { $ne: "" } }, "SEARCH_FILTER_INVALID"],
    ...["url", "modelUrl", "baseURL", "model", "pipeline", "history", "filters"].map((key) => [{ query: "x", [key]: "http://169.254.169.254/latest/meta-data" }, "SEARCH_INPUT_INVALID"]),
  ]) {
    await expectError(await fixture.post("/api/search", { target: "local", ...data }), 400, expected);
  }
  await expectError(await fixture.post("/api/search", { target: "local", query: "x".repeat(17_000) }), 413, "REQUEST_TOO_LARGE");
  for (const body of ["[]", "null", "{invalid"]) {
    await expectError(await fetch(`${fixture.origin}/api/search`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Workshop-Token": fixture.details.csrfToken }, body,
    }), 400, "INVALID_JSON");
  }
  await expectError(await fetch(`${fixture.origin}/api/search`, {
    method: "POST", headers: { "Content-Type": "text/plain", "X-Workshop-Token": fixture.details.csrfToken },
    body: JSON.stringify({ target: "local", query: "x" }),
  }), 415, "JSON_REQUIRED");
  assert.deepEqual(touches, []);
});

test("valid boundary queries use POST bodies, never GET/history, and do not echo private query text in responses or logs", { timeout: 5000 }, async (t) => {
  const calls = [];
  const fixture = await serve(t, { search: {
    async query(target, data) {
      calls.push(validateSearchInput(data, catalog));
      return { target, results: [], inspector: { metadataOnly: true } };
    },
  } });
  const query = "q".repeat(500);
  for (const limit of [1, 10]) {
    const response = await fixture.post("/api/search", { target: "local", query, limit, day: "2026-10-19", track: "Databases" });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.doesNotMatch(await response.text(), new RegExp(query));
  }
  assert.deepEqual(calls.map(({ limit }) => limit), [1, 10]);
  const notSearch = await fixture.get(`/api/search?target=local&query=${query}`);
  await expectError(notSearch, 404, "NOT_FOUND");
  assert.equal(calls.length, 2);
  assert.doesNotMatch(JSON.stringify(fixture.logs), new RegExp(query));
});

test("stale request targets are rejected before search; selected targets are not silently substituted", { timeout: 5000 }, async (t) => {
  const queries = [];
  const fixture = await serve(t, { search: {
    async query(target) { queries.push(target); return { target, results: [] }; },
    async status(target) { return { target, enabled: true, ready: true }; },
  } });
  await expectError(await fixture.post("/api/search", { target: "site-b", query: "x" }), 409, "TARGET_CHANGED");
  await expectError(await fixture.post("/api/search", { query: "x" }), 409, "TARGET_CHANGED");
  assert.deepEqual(queries, []);
  assert.equal((await fixture.switchTarget("local", "site-b")).status, 200);
  await expectError(await fixture.post("/api/search", { target: "local", query: "x" }), 409, "TARGET_CHANGED");
  assert.equal((await fixture.get("/api/search/status")).status, 200);
  const status = await (await fixture.get("/api/search/status")).json();
  assert.equal(status.target, "site-b");
  const current = await fixture.post("/api/search", { target: "site-b", query: "x" });
  assert.equal(current.status, 200);
  assert.equal((await current.json()).target, "site-b");
  assert.deepEqual(queries, ["site-b"]);
  assert.deepEqual(fixture.dbCalls, ["site-b"], "only explicit target switching performs the injected ping");
});

for (const roundTrip of [false, true]) {
  test(`in-flight search results are discarded after ${roundTrip ? "A→B→A" : "A→B"} target switching`, { timeout: 5000 }, async (t) => {
    const entered = deferred();
    const release = deferred();
    const calls = [];
    const fixture = await serve(t, { search: {
      async query(target) {
        calls.push(target);
        if (calls.length === 1) { entered.resolve(); await release.promise; }
        return { target, results: [{ session: { id: calls.length === 1 ? "stale-result-must-not-escape" : "fresh-result" } }] };
      },
    } });
    const pending = fixture.post("/api/search", { target: "local", query: "topic" });
    try {
      await entered.promise;
      assert.equal((await fixture.switchTarget("local", "site-b")).status, 200);
      if (roundTrip) assert.equal((await fixture.switchTarget("site-b", "local")).status, 200);
    } finally { release.resolve(); }
    const response = await pending;
    const payload = await expectError(response, 409, "TARGET_CHANGED");
    assert.doesNotMatch(JSON.stringify(payload), /stale-result-must-not-escape/);
    assert.deepEqual(calls, ["local"], "stale requests are not replayed on another target");
    const active = roundTrip ? "local" : "site-b";
    assert.equal((await (await fixture.get("/api/config")).json()).target, active);
    const retry = await fixture.post("/api/search", { target: active, query: "topic" });
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).results[0].session.id, "fresh-result");
    assert.deepEqual(calls, ["local", active]);
  });
}

for (const roundTrip of [false, true]) {
  test(`in-flight readiness is also discarded after ${roundTrip ? "A→B→A" : "A→B"} target switching`, { timeout: 5000 }, async (t) => {
    const entered = deferred();
    const release = deferred();
    const fixture = await serve(t, { search: {
      async status(target) { entered.resolve(); await release.promise; return { target, ready: true, message: "stale-readiness" }; },
    } });
    const pending = fixture.get("/api/search/status");
    try {
      await entered.promise;
      assert.equal((await fixture.switchTarget("local", "site-b")).status, 200);
      if (roundTrip) assert.equal((await fixture.switchTarget("site-b", "local")).status, 200);
    } finally { release.resolve(); }
    const response = await pending;
    const payload = await expectError(response, 409, "TARGET_CHANGED");
    assert.doesNotMatch(JSON.stringify(payload), /stale-readiness/);
  });
}

test("HTTP disconnect aborts search and the subsequent request can retry", { timeout: 5000 }, async (t) => {
  const entered = deferred();
  const cancelled = deferred();
  let calls = 0;
  let seenSignal;
  const fixture = await serve(t, { search: {
    async query(target, _data, signal) {
      calls += 1;
      if (calls > 1) return { target, results: [] };
      seenSignal = signal;
      entered.resolve();
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
        cancelled.resolve(); reject(new WorkshopError(499, "SEARCH_CANCELLED", "Search was cancelled."));
      }, { once: true }));
    },
  } });
  const controller = new AbortController();
  const pending = fetch(`${fixture.origin}/api/search`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Workshop-Token": fixture.details.csrfToken },
    body: JSON.stringify({ target: "local", query: "cancel me" }), signal: controller.signal,
  });
  await entered.promise;
  const rejected = assert.rejects(pending, { name: "AbortError" });
  controller.abort();
  await rejected;
  await cancelled.promise;
  assert.equal(seenSignal.aborted, true);
  assert.equal((await fixture.post("/api/search", { target: "local", query: "retry" })).status, 200);
  assert.equal(calls, 2);
});

test("search/status HTTP failures and logs exclude database URI, credentials, private endpoints, and query text", { timeout: 5000 }, async (t) => {
  const secret = "mongodb://secret-user:secret-password@private-db.example.invalid/db?tls=true";
  const privateQuery = "private query not for logs";
  let mode = "mongo";
  const fail = async () => {
    if (mode === "model") throw new WorkshopError(503, "SEARCH_MODEL_UNAVAILABLE", "Optional embedding is unavailable; no fallback was used.");
    const error = new Error(`${secret}; ${privateQuery}`);
    if (mode === "mongo") error.name = "MongoServerSelectionError";
    throw error;
  };
  const fixture = await serve(t, { search: { query: fail, status: fail } });
  for (const [nextMode, status, expected] of [["mongo", 503, "DATABASE_UNAVAILABLE"], ["raw", 500, "INTERNAL_ERROR"], ["model", 503, "SEARCH_MODEL_UNAVAILABLE"]]) {
    mode = nextMode;
    const queryFailure = await expectError(await fixture.post("/api/search", { target: "local", query: privateQuery }), status, expected);
    const statusFailure = await expectError(await fixture.get("/api/search/status"), status, expected);
    assert.doesNotMatch(JSON.stringify({ queryFailure, statusFailure, logs: fixture.logs }), /mongodb:\/\/|secret-user|secret-password|private-db|private query not for logs/);
  }
  assert.deepEqual(fixture.dbCalls, [], "HTTP never falls back to a different connection after search errors");
  assert.ok(fixture.logs.every((line) => Object.keys(JSON.parse(line)).sort().join(",") === "code,event"));
});

test("a target switch while a POST body is arriving cannot query the originally captured database", { timeout: 5000 }, async (t) => {
  let queries = 0;
  const fixture = await serve(t, { search: {
    status: async (target) => ({ target, enabled: true, ready: true }),
    async query(target) { queries++; return { target, results: [] }; },
  } });
  const started = deferred();
  fixture.app.server.on("request", (request) => { if (request.url === "/api/search") started.resolve(); });
  let request;
  const completed = new Promise((resolve, reject) => {
    request = http.request(`${fixture.origin}/api/search`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Workshop-Token": fixture.details.csrfToken },
    }, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
    });
    request.on("error", reject);
  });
  request.write('{"target":"site-b",');
  await started.promise;
  assert.equal((await fixture.switchTarget("local", "site-b")).status, 200);
  request.end('"query":"topic"}');
  const response = await completed;
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, "TARGET_CHANGED");
  assert.equal(queries, 0, "no query is allowed against stale captured Site A or newly selected Site B");
});

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createApp } from "../src/server.js";
import { WorkshopError } from "../src/errors.js";

test("HTTP target changes are explicit; errors are sanitized and writes require a request token", async (t) => {
  const calls = [];
  const config = { activeTarget: "local", mode: "complete", location: "laptop", targets: { local: {} } };
  const connections = {
    db(target) {
      calls.push(target);
      if (target !== "local") throw new WorkshopError(409, "TARGET_NOT_CONFIGURED", "No cloud target.");
      return { command: async () => ({ ok: 1 }) };
    },
    close: async () => {},
  };
  const app = await createApp({ config, connections, repository: {}, logger: { error() {} } });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(() => app.close());
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const html = await fetch(origin);
  assert.match(html.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(html.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(await html.text(), /__CSP_NONCE__/);
  const details = await (await fetch(`${origin}/api/config`)).json();
  assert.equal(details.target, "local");
  assert.equal(details.targets.length, 1);
  assert.equal((await fetch(`${origin}/api/health`)).status, 200);
  const unapprovedHost = await new Promise((resolve, reject) => {
    http.get(`${origin}/api/config`, { headers: { Host: "unapproved.example.invalid" } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).on("error", reject);
  });
  assert.equal(unapprovedHost, 403);
  const request = (body, token = details.csrfToken) => fetch(`${origin}/api/target`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Workshop-Token": token },
    body: JSON.stringify(body),
  });
  assert.equal((await request({ target: "local", nextTarget: "cloud" }, "")).status, 403);
  assert.equal((await request({ target: "cloud", nextTarget: "local" })).status, 409);
  assert.equal((await request({ target: "local", nextTarget: "arbitrary" })).status, 400);
  assert.equal((await request({ target: "local", nextTarget: "cloud" })).status, 409);
  assert.equal((await (await fetch(`${origin}/api/config`)).json()).target, "local");
  assert.deepEqual(calls, ["local", "cloud"]);
  assert.equal((await fetch(`${origin}/missing`)).status, 404);
});

test("unavailable Site B does not switch the active target or fall back after a successful switch", async (t) => {
  let unavailable = true;
  const calls = [];
  const config = { activeTarget: "local", mode: "complete", scenario: "attendee", location: "codespaces", targets: { local: {}, "site-b": {} } };
  const app = await createApp({
    config, repository: {}, logger: { error() {} },
    connections: {
      db(target) {
        calls.push(target);
        return { async command() {
          if (target === "site-b" && unavailable) {
            const error = new Error("synthetic private endpoint details");
            error.name = "MongoServerSelectionError";
            throw error;
          }
          return { ok: 1 };
        } };
      },
      async close() {},
    },
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(() => app.close());
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const configResponse = () => fetch(`${origin}/api/config`).then((response) => response.json());
  const details = await configResponse();
  assert.equal(details.scenario, "attendee");
  assert.deepEqual(details.targets.map((item) => item.label), ["Site A — self-hosted", "Site B — self-hosted"]);
  const switchToB = () => fetch(`${origin}/api/target`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Workshop-Token": details.csrfToken },
    body: JSON.stringify({ target: "local", nextTarget: "site-b" }),
  });
  const failure = await switchToB();
  assert.equal(failure.status, 503);
  assert.doesNotMatch(await failure.text(), /synthetic|private endpoint/);
  assert.equal((await configResponse()).target, "local");
  unavailable = false;
  assert.equal((await switchToB()).status, 200);
  assert.equal((await configResponse()).target, "site-b");
  unavailable = true;
  assert.equal((await fetch(`${origin}/api/health`)).status, 503);
  assert.equal((await configResponse()).target, "site-b");
  assert.deepEqual(calls, ["site-b", "site-b", "site-b"]);
});

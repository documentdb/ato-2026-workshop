import test from "node:test";
import assert from "node:assert/strict";
import { createConnections } from "../src/connections.js";
import { waitForDatabase } from "../scripts/database.mjs";

const config = { targets: {
  local: { uri: "mongodb://site-a.invalid", database: "test_a", developmentCertificate: true },
  "site-b": { uri: "mongodb://site-b.invalid", database: "test_b", developmentCertificate: true },
  cloud: { uri: "mongodb://managed.invalid", database: "test_cloud", developmentCertificate: false },
} };
function mockDriver() {
  const clients = [];
  const failure = () => Object.assign(new Error("synthetic failure"), { name: "MongoServerSelectionError" });
  class Client {
    constructor(uri, options) {
      Object.assign(this, { uri, options, connects: 0, closes: 0, topology: null });
      clients.push(this);
    }
    async connect() {
      this.connects++;
      if (Client.gate) await Client.gate;
      // Model the pinned driver's failed-lazy-connect state. Only explicit
      // connect may repair it; db()/commands never repair a closed topology.
      this.topology = Client.available ? "connected" : "closed";
      if (!Client.available) throw failure();
      return this;
    }
    db(name) {
      return { name, command: async () => {
        if (this.topology !== "connected" || !Client.available) throw failure();
        return { ok: 1 };
      } };
    }
    async close() { this.closes++; this.topology = "closed"; }
  }
  Client.available = false;
  return { Client, clients };
}

test("first failed acquisition retries explicitly on the same cached client, without replaying commands", async () => {
  const { Client, clients } = mockDriver();
  const connections = createConnections(config, { Client });
  await assert.rejects(connections.db("site-b"), { name: "MongoServerSelectionError" });
  assert.equal(clients[0].topology, "closed");
  Client.available = true;
  assert.deepEqual(await (await connections.db("site-b")).command({ ping: 1 }), { ok: 1 });
  assert.equal(clients.length, 1);
  assert.equal(clients[0].connects, 2);
  Client.available = false;
  await assert.rejects(clients[0].db("test_b").command({ ping: 1 }));
  assert.equal(clients[0].connects, 2, "a failed operation isn't automatically retried");
  Client.available = true;
  await (await connections.db("site-b")).command({ ping: 1 });
  assert.equal(clients[0].connects, 3);
  await connections.close();
});

test("concurrent failed and healthy acquisitions settle, reuse one client, and keep TLS/timeouts", async () => {
  const { Client, clients } = mockDriver();
  const connections = createConnections(config, { Client });
  const failed = await Promise.allSettled(Array.from({ length: 3 }, () => connections.db("site-b")));
  assert.ok(failed.every(({ status }) => status === "rejected"));
  Client.available = true;
  assert.equal((await Promise.all(Array.from({ length: 3 }, () => connections.db("site-b")))).length, 3);
  assert.equal(clients.length, 1);
  assert.equal(clients[0].connects, 6);
  const { options } = clients[0];
  assert.equal(options.tls, true);
  assert.equal(options.tlsAllowInvalidCertificates, true);
  assert.equal(options.tlsAllowInvalidHostnames, false);
  assert.equal(options.retryWrites, false);
  assert.equal(options.serverSelectionTimeoutMS, 5000);
  assert.equal(options.connectTimeoutMS, 5000);
  assert.equal(options.timeoutMS, 10000);
  await connections.db("cloud");
  assert.equal(clients[1].options.tlsAllowInvalidCertificates, false);
  await assert.rejects(connections.db("unknown"), { code: "TARGET_NOT_CONFIGURED" });
  await connections.close();
  assert.ok(clients.every(({ closes }) => closes === 1));
});

test("close is terminal and idempotent and waits for acquisitions without handing out a closing Db", async () => {
  const { Client, clients } = mockDriver();
  Client.available = true;
  let release;
  Client.gate = new Promise((resolve) => { release = resolve; });
  const connections = createConnections(config, { Client });
  const acquisition = assert.rejects(connections.db("local"), { code: "CONNECTIONS_CLOSED" });
  const closing = connections.close();
  assert.equal(connections.close(), closing);
  assert.equal(clients[0].closes, 0);
  await assert.rejects(connections.db("site-b"), { code: "CONNECTIONS_CLOSED" });
  release();
  await Promise.all([acquisition, closing]);
  assert.equal(clients.length, 1);
  assert.equal(clients[0].closes, 1);
  await assert.rejects(connections.db("local"), { code: "CONNECTIONS_CLOSED" });
});

test("wait retries acquisition INSIDE its loop, then the original invocation succeeds", async () => {
  let attempts = 0;
  let clock = 0;
  const connections = { async db(target) {
    assert.equal(target, "site-b");
    if (++attempts < 3) throw new Error("not ready yet");
    return { async command(command) { assert.deepEqual(command, { ping: 1 }); } };
  } };
  await waitForDatabase(connections, "site-b", { timeoutMS: 6000, now: () => clock, sleep: async (ms) => { clock += ms; } });
  assert.equal(attempts, 3);
  assert.equal(clock, 4000);
});

test("wait deadline is bounded even when every acquisition rejects", async () => {
  let attempts = 0;
  let clock = 0;
  const failure = new Error("unavailable");
  await assert.rejects(waitForDatabase({ async db() { attempts++; throw failure; } }, "site-b", {
    timeoutMS: 4500, now: () => clock, sleep: async (ms) => { clock += ms; },
  }), (error) => error === failure);
  assert.equal(attempts, 3);
  assert.equal(clock, 4500);
});

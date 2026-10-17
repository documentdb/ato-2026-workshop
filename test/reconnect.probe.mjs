// Internal live harness helper, run inside its OWN disposable Compose project.
// JSON lines keep one connection manager alive across host-controlled outages.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { readConfig } from "../src/config.js";
import { createConnections } from "../src/connections.js";

const config = readConfig();
assert.equal(config.scenario, "attendee");
const connections = createConnections(config);
try {
  if (process.argv[2] === "snapshot") {
    const result = {};
    for (const target of ["local", "site-b"]) {
      const db = await connections.db(target);
      const favorites = await db.collection("favorites").find({}).sort({ _id: 1 }).toArray();
      result[target] = {
        sessions: await db.collection("sessions").countDocuments(),
        favorites: favorites.length,
        favoriteDigest: createHash("sha256").update(JSON.stringify(favorites)).digest("hex"),
      };
    }
    console.log(JSON.stringify(result));
  } else {
    console.log(JSON.stringify({ ready: true, pid: process.pid }));
    for await (const line of createInterface({ input: process.stdin })) {
      const { expected } = JSON.parse(line);
      assert.ok(["ready", "unavailable"].includes(expected));
      const outcomes = await Promise.allSettled(Array.from({ length: 3 }, async () => {
        const db = await connections.db("site-b");
        await db.command({ ping: 1 });
      }));
      assert.ok(outcomes.every(({ status }) => status === (expected === "ready" ? "fulfilled" : "rejected")));
      if (expected === "unavailable") assert.ok(outcomes.every(({ reason }) => reason.name?.startsWith("Mongo")));
      console.log(JSON.stringify({ expected, concurrent: 3, passed: true, pid: process.pid }));
    }
  }
} catch {
  // Never print a driver's raw message, URI, stack, or supplied input.
  console.error(JSON.stringify({ error: "RECONNECT_PROBE_FAILED" }));
  process.exitCode = 1;
} finally { await connections.close(); }

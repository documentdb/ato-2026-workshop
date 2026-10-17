import { pathToFileURL } from "node:url";
import { inspectDatabase } from "../src/inspection.js";
import { setTimeout as delay } from "node:timers/promises";
import { readConfig } from "../src/config.js";
import { createConnections } from "../src/connections.js";
import { readCatalog, requireCatalog, seedCatalog } from "../src/catalog.js";
import { WorkshopError, reportError } from "../src/errors.js";

// Retry only readiness, not writes. The deadline may be exceeded by at most
// one bounded driver acquisition/ping already in flight.
export async function waitForDatabase(connections, target, {
  timeoutMS = 240000, now = Date.now, sleep = delay,
} = {}) {
  const deadline = now() + timeoutMS;
  for (;;) {
    try {
      // Acquisition MUST be inside this try on every attempt: the first
      // connection itself may fail, before there is any Db handle to ping.
      const db = await connections.db(target);
      await db.command({ ping: 1 });
      return;
    } catch (error) {
      const remaining = deadline - now();
      if (remaining <= 0) throw error;
      await sleep(Math.min(2000, remaining));
      if (now() >= deadline) throw error;
    }
  }
}

async function run() {
  const [operation, flag, target, ...extra] = process.argv.slice(2);
  if (!["wait", "seed", "indexes", "migrate", "check", "inspect"].includes(operation) ||
      flag !== "--target" || !["local", "site-b", "cloud"].includes(target) || extra.length) {
    throw new WorkshopError(400, "USAGE", "Use: npm run <wait:database|seed|indexes|migrate|check|inspect> -- --target <local|site-b|cloud>. The target is always explicit.");
  }
  const connections = createConnections(readConfig());
  try {
    if (operation === "inspect" && target === "cloud") {
      throw new WorkshopError(400, "LOCAL_TARGET_REQUIRED", "The attendee inspection exercise accepts only local (Site A) or site-b.");
    }
    if (operation === "wait") {
      await waitForDatabase(connections, target);
      console.log(JSON.stringify({ target, ready: true }));
      return;
    }
    const db = await connections.db(target);
    await db.command({ ping: 1 });
    if (operation === "inspect") {
      console.log(JSON.stringify({ target, ...await inspectDatabase(db) }, null, 2));
    } else if (operation === "seed") {
      const result = await seedCatalog(db, await readCatalog());
      console.log(JSON.stringify({ target, ...result, favoritesChanged: false }));
    } else if (operation === "indexes") {
      await requireCatalog(db);
      const name = await db.collection("sessions").createIndex({ startsAt: 1, _id: 1 }, { name: "schedule_order" });
      console.log(JSON.stringify({ target, index: name }));
    } else if (operation === "migrate") {
      const catalog = await requireCatalog(db);
      const result = await db.collection("sessions").updateMany(
        { catalogVersion: catalog.fingerprint, schemaVersion: 1, attendanceMode: { $exists: false } },
        { $set: { attendanceMode: "in-person", schemaVersion: 2 } },
      );
      console.log(JSON.stringify({ target, migrated: result.modifiedCount,
        message: result.modifiedCount === 0
          ? "No eligible version-1 records remain. Re-running is idempotent; existing values were preserved."
          : "Added attendanceMode and advanced eligible sessions to schemaVersion 2. Run inspect on this same target to see a real document.",
      }));
    } else {
      const catalog = await requireCatalog(db);
      const [sessions, favorites, indexes, schemaVersions] = await Promise.all([
        db.collection("sessions").countDocuments({ catalogVersion: catalog.fingerprint }),
        db.collection("favorites").countDocuments(),
        db.collection("sessions").listIndexes().toArray(),
        db.collection("sessions").distinct("schemaVersion", { catalogVersion: catalog.fingerprint }),
      ]);
      console.log(JSON.stringify({ target, ready: true, catalog: catalog.version, kind: catalog.kind, sessions, favorites, schemaVersions, indexes: indexes.map((index) => index.name) }));
    }
  } finally {
    await connections.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run().catch((error) => {
  reportError(error);
  if (error instanceof WorkshopError) console.error(error.message);
  process.exitCode = 1;
});

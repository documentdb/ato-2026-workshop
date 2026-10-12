import { readConfig } from "../src/config.js";
import { createConnections } from "../src/connections.js";
import { readCatalog, requireCatalog, seedCatalog } from "../src/catalog.js";
import { WorkshopError, reportError } from "../src/errors.js";

async function run() {
  const [operation, flag, target, ...extra] = process.argv.slice(2);
  if (!["seed", "indexes", "migrate", "check"].includes(operation) ||
      flag !== "--target" || !["local", "cloud"].includes(target) || extra.length) {
    throw new WorkshopError(400, "USAGE", "Use: npm run <seed|indexes|migrate|check> -- --target <local|cloud>. The target is always explicit.");
  }
  const connections = createConnections(readConfig());
  try {
    const db = connections.db(target);
    await db.command({ ping: 1 });
    if (operation === "seed") {
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
      console.log(JSON.stringify({ target, migrated: result.modifiedCount }));
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

run().catch((error) => {
  reportError(error);
  if (error instanceof WorkshopError) console.error(error.message);
  process.exitCode = 1;
});

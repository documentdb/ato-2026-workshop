import { requireCatalog } from "./catalog.js";

// Deliberately bounded and read-only: never enumerate system collections or
// print connection settings. Projection also excludes unrelated custom fields.
export async function inspectDatabase(db) {
  const catalog = await requireCatalog(db);
  const [sessions, favorites, indexes] = await Promise.all([
    db.collection("sessions").find({ catalogVersion: catalog.fingerprint }, {
      projection: { _id: 1, title: 1, startsAt: 1, schemaVersion: 1, attendanceMode: 1 },
    }).sort({ startsAt: 1, _id: 1 }).limit(1).toArray(),
    db.collection("favorites").find({}, {
      projection: { _id: 1, savedAt: 1 },
    }).sort({ _id: 1 }).limit(1).toArray(),
    db.collection("sessions").listIndexes().toArray(),
  ]);
  return {
    catalog: catalog.version,
    session: sessions[0] || null,
    favorite: favorites[0] || null,
    indexes: indexes.map(({ name, key }) => ({ name, key })),
  };
}

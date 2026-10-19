// READ-ONLY TEMPLATE: do not run this unbound repository file directly.
// In DocumentDB Connections, right-click the intended Site A/B DATABASE >
// New Query Playground. Check its connection/database CodeLens, then copy this
// whole block into that new .documentdb.js file. The extension supplies db.
// No database switching, connection string, name editing, or writes are needed.
const inspectionCatalog = db.workshop_meta.find({ _id: "catalog", ready: true }).limit(1).maxTimeMS(5000).toArray();
if (!inspectionCatalog[0]?.fingerprint) throw new Error("Stop: select the seeded workshop database.");
db.sessions.find({ catalogVersion: inspectionCatalog[0].fingerprint }, {
  _id: 1, title: 1, startsAt: 1, catalogVersion: 1, schemaVersion: 1, attendanceMode: 1,
}).sort({ startsAt: 1, _id: 1 }).limit(5).maxTimeMS(5000).toArray();

// READ-ONLY REFERENCE: create New Query Playground from the intended Site A/B
// DATABASE first; check its connection/database CodeLens, then copy this block.
// The extension provides db, including a custom workshop database name.
// One self-contained block: no variables depend on a previous Run Block.
// Counts published Monday program entries, NOT attendees or unique speakers.
const countsCatalog = db.workshop_meta.find({ _id: "catalog", ready: true }).limit(1).maxTimeMS(5000).toArray();
if (!countsCatalog[0]?.fingerprint) throw new Error("Stop: select the seeded workshop database.");
db.sessions.aggregate([
  { $match: {
    catalogVersion: countsCatalog[0].fingerprint,
    // startsAt is a normalized ISO UTC string. Monday in America/New_York:
    startsAt: { $gte: "2026-10-19T04:00:00.000Z", $lt: "2026-10-20T04:00:00.000Z" },
  } },
  { $group: { _id: "$track", entries: { $sum: 1 } } },
  { $sort: { entries: -1, _id: 1 } },
  { $project: { _id: 1, entries: 1 } },
  { $limit: 30 },
], { maxTimeMS: 5000 }).toArray();

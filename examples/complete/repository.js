export function listSessions(db, catalogVersion) {
  return db.collection("sessions")
    .find({ catalogVersion })
    .sort({ startsAt: 1, _id: 1 })
    .toArray();
}

export function saveFavorite(db, sessionId) {
  return db.collection("favorites").updateOne(
    { _id: sessionId },
    { $setOnInsert: { savedAt: new Date().toISOString() } },
    { upsert: true },
  );
}

import { validSessionId, requireCatalog, sessionView, validateCatalog } from "./catalog.js";
import { WorkshopError } from "./errors.js";

export function findConflicts(sessions) {
  const conflicts = [];
  const sorted = [...sessions].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  for (let left = 0; left < sorted.length; left++) {
    for (let right = left + 1; right < sorted.length; right++) {
      if (Date.parse(sorted[right].startsAt) >= Date.parse(sorted[left].endsAt)) break;
      conflicts.push([sorted[left].id, sorted[right].id]);
    }
  }
  return conflicts;
}

export async function favoriteIds(db) {
  const favorites = await db.collection("favorites").find({}, { projection: { _id: 1 } }).toArray();
  return favorites.map((favorite) => favorite._id);
}

export async function readPlanner(db, repository) {
  const catalog = await requireCatalog(db);
  const [documents, favorites] = await Promise.all([
    repository.listSessions(db, catalog.fingerprint),
    favoriteIds(db),
  ]);
  const sessions = documents.map(sessionView);
  if (sessions.length) validateCatalog({ ...catalog, sessions });
  const ids = new Set(favorites);
  const unknown = favorites.filter((id) => !sessions.some((session) => session.id === id));
  return {
    catalog,
    sessions,
    favorites,
    conflicts: findConflicts(sessions.filter((session) => ids.has(session.id))),
    orphanedFavorites: unknown,
  };
}

export async function requireSession(db, id) {
  if (!validSessionId(id)) {
    throw new WorkshopError(400, "INVALID_SESSION", "Choose a valid session identifier.");
  }
  const catalog = await requireCatalog(db);
  const session = await db.collection("sessions").findOne({ _id: id, catalogVersion: catalog.fingerprint });
  if (!session) {
    throw new WorkshopError(404, "SESSION_NOT_FOUND", "This session is not in the active database's catalog.");
  }
  return session;
}

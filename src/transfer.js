import { requireCatalog, validSessionId, sessionView } from "./catalog.js";
import { saveFavorite } from "../examples/complete/repository.js";
import { WorkshopError, publicError } from "./errors.js";

export function validateSelection(ids) {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100 || !ids.every(validSessionId)) {
    throw new WorkshopError(400, "INVALID_SELECTION", "Select between 1 and 100 valid favorite session identifiers.");
  }
  if (new Set(ids).size !== ids.length) {
    throw new WorkshopError(400, "DUPLICATE_SELECTION", "Each selected favorite must appear only once.");
  }
  return ids;
}

export async function copyFavorites(sourceDb, destinationDb, sessionIds) {
  const ids = validateSelection(sessionIds);
  const [sourceCatalog, destinationCatalog] = await Promise.all([
    requireCatalog(sourceDb),
    requireCatalog(destinationDb),
  ]);
  if (sourceCatalog.fingerprint !== destinationCatalog.fingerprint) {
    throw new WorkshopError(409, "CATALOG_MISMATCH", "The catalogs differ. Load the same schedule into both environments before copying favorites.");
  }
  const sourceFavorites = await sourceDb.collection("favorites")
    .find({ _id: { $in: ids } }, { projection: { _id: 1 } }).toArray();
  const selectedFavorites = new Set(sourceFavorites.map((favorite) => favorite._id));
  const [sourceSessions, destinationSessions] = await Promise.all([
    sourceDb.collection("sessions").find({ _id: { $in: ids }, catalogVersion: sourceCatalog.fingerprint }).toArray(),
    destinationDb.collection("sessions").find({ _id: { $in: ids }, catalogVersion: destinationCatalog.fingerprint }).toArray(),
  ]);
  const sourceDocuments = new Map(sourceSessions.map((session) => [session._id, session]));
  const destinationDocuments = new Map(destinationSessions.map((session) => [session._id, session]));
  const results = [];
  const deadline = Date.now() + 30000;
  for (const id of ids) {
    if (!selectedFavorites.has(id) || !sourceDocuments.has(id) || !destinationDocuments.has(id)) {
      results.push({ id, status: "invalid", message: "The source favorite or matching session is missing." });
    } else if (JSON.stringify(sessionView(sourceDocuments.get(id))) !== JSON.stringify(sessionView(destinationDocuments.get(id)))) {
      results.push({ id, status: "invalid", message: "The session details differ between targets. Review catalog drift before copying this favorite." });
    } else if (Date.now() >= deadline) {
      results.push({ id, status: "not_attempted", message: "The copy time limit was reached. Retry the remaining selection." });
    } else {
      try {
        const result = await saveFavorite(destinationDb, id);
        results.push({ id, status: result.upsertedCount === 1 ? "copied" : "already_present" });
      } catch (error) {
        const safe = publicError(error);
        results.push({ id, status: "failed", code: safe.code, message: safe.message });
      }
    }
  }
  const complete = results.every((result) => ["copied", "already_present"].includes(result.status));
  return { complete, results };
}

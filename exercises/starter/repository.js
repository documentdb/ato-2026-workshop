import { WorkshopError } from "../../src/errors.js";

export async function listSessions(db, catalogVersion) {
  // TODO 1: Return matching sessions, ordered by startsAt and then _id.
  throw new WorkshopError(501, "TODO_LIST_SESSIONS", "Complete TODO 1 in exercises/starter/repository.js to browse the catalog.");
}

export async function saveFavorite(db, sessionId) {
  // TODO 2: Upsert by _id and set savedAt only when inserting.
  throw new WorkshopError(501, "TODO_SAVE_FAVORITE", "Complete TODO 2 in exercises/starter/repository.js to save a favorite.");
}

import { createHash } from "node:crypto";
import { SEARCH_MODEL } from "./search-model.js";

export const SEARCH_COLLECTION = "session_search";
export const SEARCH_META = "search_meta";
export const SEARCH_OWNER = "ato-workshop-semantic-search-v1";
export const TEXT_VERSION = 1;
export const SEARCH_INDEX = Object.freeze({
  name: "session_meaning_ivf", key: { embedding: "cosmosSearch" },
  cosmosSearchOptions: { kind: "vector-ivf", numLists: 1, similarity: "COS", dimensions: 768 },
});
export const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const documentText = (session) => `search_document: ${session.title}\nTrack: ${session.track}`;
export function sessionDay(session, catalog) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: catalog.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(session.startsAt));
}
export function searchFields(session, catalog) {
  return { ...session, day: sessionDay(session, catalog), sourceHash: hash(session), textHash: hash(documentText(session)), modelDigest: SEARCH_MODEL.digest, textVersion: TEXT_VERSION, schemaVersion: 1 };
}

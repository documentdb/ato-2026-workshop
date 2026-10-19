import { createHash, randomUUID } from "node:crypto";
import { requireCatalog, sessionView } from "./catalog.js";
import { WorkshopError } from "./errors.js";
import { checkedVector, MODEL_BATCH, SEARCH_MODEL } from "./search-model.js";

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
function incompatible(message = "The search snapshot or embedding model does not match. Preserve this database and prepare a fresh database, or review an explicit search-only migration.") {
  throw new WorkshopError(409, "SEARCH_SNAPSHOT_MISMATCH", message);
}
export function validateMarker(marker, catalog) {
  if (!marker) throw new WorkshopError(409, "SEARCH_NOT_PREPARED", "This target has no prepared semantic search. Run search:prepare explicitly for this target; no other target was searched.");
  if (marker.owner !== SEARCH_OWNER || marker.fingerprint !== catalog.fingerprint || marker.modelDigest !== SEARCH_MODEL.digest ||
      marker.dimensions !== SEARCH_MODEL.dimensions || marker.textVersion !== TEXT_VERSION || marker.schemaVersion !== 1 || marker.count !== catalog.sessions.length) incompatible();
  return marker;
}
export function validateRow(row, expected, catalog, withVector = false) {
  if (!expected || hash(sessionView(row)) !== hash(expected)) incompatible("Search session metadata has drifted from the public catalog. No stale results were returned.");
  const fields = searchFields(expected, catalog);
  for (const key of ["sourceHash", "textHash", "modelDigest", "textVersion", "schemaVersion", "day"]) if (row[key] !== fields[key]) incompatible();
  if (withVector && hash(checkedVector(row.embedding)) !== row.vectorHash) incompatible("Stored search vectors failed their integrity check. No stale results were returned.");
}
export function validateIndex(index) {
  if (!index || hash(index.key) !== hash(SEARCH_INDEX.key) ||
      Object.entries(SEARCH_INDEX.cosmosSearchOptions).some(([key, value]) => index.cosmosSearchOptions?.[key] !== value)) {
    throw new WorkshopError(409, "SEARCH_INDEX_MISMATCH", "The required DocumentDB IVF/COS/768 index is missing or incompatible. Run explicit preparation; no index is created by a query.");
  }
}
export function vectorPipeline(vector, count, filters = {}) {
  checkedVector(vector);
  return [
    { $search: { cosmosSearch: { vector, path: "embedding", k: count }, returnStoredSource: true } },
    { $addFields: { similarity: { $meta: "searchScore" } } },
    ...(Object.keys(filters).length ? [{ $match: filters }] : []),
    { $project: { embedding: 0, __cosmos_meta__: 0 } },
  ];
}

export class SearchStore {
  constructor(db, catalog) {
    this.db = db;
    this.catalog = catalog;
    this.expected = new Map(catalog.sessions.map((session) => [session.id, session]));
    this.rows = db.collection(SEARCH_COLLECTION);
    this.meta = db.collection(SEARCH_META);
  }
  async canonical() {
    const metadata = await requireCatalog(this.db);
    if (metadata.fingerprint !== this.catalog.fingerprint) incompatible("The active target has a different canonical catalog. Search is unavailable for this snapshot.");
  }
  async marker() { return this.meta.findOne({ _id: SEARCH_OWNER }); }
  async index() {
    const indexes = await this.rows.listIndexes().toArray();
    if (indexes.some((index) => index.key?.embedding === "cosmosSearch" && index.name !== SEARCH_INDEX.name)) {
      throw new WorkshopError(409, "SEARCH_INDEX_MISMATCH", "Multiple vector indexes could serve this embedding path. Review the search-only indexes explicitly; no ambiguous index was used.");
    }
    validateIndex(indexes.find((index) => index.name === SEARCH_INDEX.name));
  }
  async verifyAll() {
    const rows = await this.rows.find({}).limit(this.expected.size + 1).toArray();
    if (rows.length !== this.expected.size || new Set(rows.map((row) => row._id)).size !== this.expected.size) incompatible("The search snapshot is incomplete or contains unexpected rows. Retry explicit preparation; browsing is unchanged.");
    for (const row of rows) validateRow(row, this.expected.get(row._id), this.catalog, true);
    return rows;
  }
  async ready({ full = false } = {}) {
    await this.canonical();
    const marker = validateMarker(await this.marker(), this.catalog);
    if (!marker.ready) throw new WorkshopError(409, "SEARCH_NOT_PREPARED", "Search preparation for this target is incomplete. Retry search:prepare; keyword browsing is separate.");
    if (await this.rows.countDocuments({}) !== this.expected.size) incompatible("The search row count changed. Search is unavailable until reviewed.");
    await this.index();
    if (full) await this.verifyAll();
    return marker;
  }
  async query(vector, filters, signal) {
    const pipeline = vectorPipeline(vector, this.expected.size, filters);
    const rows = await this.rows.aggregate(pipeline, { maxTimeMS: 10000, signal }).toArray();
    const count = this.catalog.sessions.filter((session) => (!filters.day || sessionDay(session, this.catalog) === filters.day) && (!filters.track || session.track === filters.track)).length;
    if (rows.length !== count || new Set(rows.map((row) => row._id)).size !== count) incompatible("The vector query did not return the complete bounded candidate set. No partial or keyword fallback results were returned.");
    for (const row of rows) {
      validateRow(row, this.expected.get(row._id), this.catalog);
      if (!Number.isFinite(row.similarity) || row.similarity < -1.000001 || row.similarity > 1.000001) throw new WorkshopError(503, "SEARCH_SCORE_INVALID", "DocumentDB did not return valid cosine searchScore metadata.");
    }
    return { rows, pipeline };
  }

  async prepare(model, log = console.log) {
    await this.canonical();
    // Confirm canonical documents themselves, not just their ready marker.
    const canonical = await this.db.collection("sessions").find({}).limit(this.expected.size + 1).toArray();
    if (canonical.length !== this.expected.size || canonical.some((row) => hash(sessionView(row)) !== hash(this.expected.get(row._id)))) incompatible("Canonical session documents have changed. Search preparation did not alter them.");
    await model.verify();
    let marker = await this.marker();
    if (!marker) {
      const existing = await this.db.listCollections({}, { nameOnly: true }).toArray();
      if (existing.some((collection) => [SEARCH_META, SEARCH_COLLECTION].includes(collection.name))) {
        throw new WorkshopError(409, "SEARCH_UNOWNED", "An existing search collection has no ownership marker. It was not adopted or modified. Use a fresh database or review it explicitly.");
      }
      // Create (not upsert) the control collection: only its creator can claim it.
      try { await this.db.createCollection(SEARCH_META); }
      catch (error) {
        if (error.code === 48 || error.codeName === "NamespaceExists") {
          throw new WorkshopError(409, "SEARCH_PREPARING", "Another preparation claimed the search namespace. Retry after it finishes.");
        }
        throw error;
      }
      await this.meta.insertOne({
        _id: SEARCH_OWNER, owner: SEARCH_OWNER, fingerprint: this.catalog.fingerprint,
        modelDigest: SEARCH_MODEL.digest, dimensions: SEARCH_MODEL.dimensions,
        schemaVersion: 1, textVersion: TEXT_VERSION, count: this.expected.size, ready: false,
        leaseUntil: new Date(0),
      });
      marker = await this.marker();
    }
    validateMarker(marker, this.catalog);
    if (marker.ready) {
      await this.ready({ full: true });
      await this.probe();
      return { count: this.expected.size, reused: true, model: SEARCH_MODEL };
    }
    const leaseId = randomUUID();
    const lease = await this.meta.updateOne({ _id: SEARCH_OWNER, ready: false, leaseUntil: { $lt: new Date() } }, { $set: { leaseId, leaseUntil: new Date(Date.now() + 180000) } });
    if (lease.matchedCount !== 1) throw new WorkshopError(409, "SEARCH_PREPARING", "Another preparation holds the search lease. After an interruption, wait three minutes before retrying.");
    const renew = async () => {
      const result = await this.meta.updateOne({ _id: SEARCH_OWNER, leaseId, ready: false }, { $set: { leaseUntil: new Date(Date.now() + 180000) } });
      if (result.matchedCount !== 1) throw new WorkshopError(409, "SEARCH_PREPARING", "Search preparation ownership changed. No ready marker was written.");
    };
    try {
      const present = await this.rows.find({}).limit(this.expected.size + 1).toArray();
      if (present.length > this.expected.size) incompatible();
      for (const row of present) validateRow(row, this.expected.get(row._id), this.catalog, true);
      const ids = new Set(present.map((row) => row._id));
      const missing = this.catalog.sessions.filter((session) => !ids.has(session.id));
      for (let i = 0; i < missing.length; i += MODEL_BATCH) {
        await renew();
        const batch = missing.slice(i, i + MODEL_BATCH);
        const vectors = await model.embed(batch.map(documentText));
        await renew();
        await this.rows.bulkWrite(batch.map((session, n) => {
          const { id, ...fields } = searchFields(session, this.catalog);
          return { updateOne: { filter: { _id: id }, update: { $setOnInsert: { ...fields, embedding: checkedVector(vectors[n]), vectorHash: hash(vectors[n]) } }, upsert: true } };
        }), { ordered: true });
        log(`Embedded ${Math.min(i + MODEL_BATCH, missing.length)}/${missing.length} missing catalog entries.`);
      }
      await renew();
      const indexes = await this.rows.listIndexes().toArray();
      const index = indexes.find((item) => item.name === SEARCH_INDEX.name);
      if (index) validateIndex(index);
      else await this.db.command({ createIndexes: SEARCH_COLLECTION, indexes: [SEARCH_INDEX] });
      await this.index();
      await this.verifyAll();
      await this.probe();
      await renew();
      const result = await this.meta.updateOne({ _id: SEARCH_OWNER, leaseId, ready: false }, { $set: { ready: true, readyAt: new Date().toISOString() }, $unset: { leaseId: "", leaseUntil: "" } });
      if (result.matchedCount !== 1) throw new WorkshopError(409, "SEARCH_PREPARING", "Search ownership changed before publication.");
      return { count: this.expected.size, reused: false, model: SEARCH_MODEL };
    } finally {
      await this.meta.updateOne({ _id: SEARCH_OWNER, leaseId, ready: false }, { $set: { leaseUntil: new Date(0) }, $unset: { leaseId: "" } });
    }
  }
  async probe() {
    const first = await this.rows.findOne({ _id: this.catalog.sessions[0].id });
    validateRow(first, this.expected.get(first?._id), this.catalog, true);
    const { rows } = await this.query(first.embedding, {});
    if (!rows.some((row) => row._id === first._id && row.similarity > 0.99)) {
      throw new WorkshopError(503, "SEARCH_PROBE_FAILED", "The real DocumentDB vector self-query failed. Search was not marked ready.");
    }
  }
}

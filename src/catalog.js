import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { WorkshopError } from "./errors.js";

export function validSessionId(id) {
  return typeof id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(id);
}

function invalidCatalog(message) {
  throw new WorkshopError(422, "INVALID_CATALOG", message);
}

export function validateCatalog(input) {
  if (!input || !["practice", "official"].includes(input.kind)) {
    invalidCatalog("The catalog must identify itself as practice or official.");
  }
  for (const key of ["title", "timeZone", "version", "source", "snapshotDate"]) {
    if (typeof input[key] !== "string" || !input[key].trim()) {
      invalidCatalog(`Catalog ${key} is required.`);
    }
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.timeZone });
  } catch {
    invalidCatalog("The catalog timezone is invalid.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.snapshotDate)) {
    invalidCatalog("The catalog snapshot date must use YYYY-MM-DD.");
  }
  if (!Array.isArray(input.sessions) || input.sessions.length === 0 || input.sessions.length > 2000) {
    invalidCatalog("The catalog must have between 1 and 2000 sessions.");
  }
  const ids = new Set();
  const sessions = input.sessions.map((session) => {
    if (!session || !validSessionId(session.id) || ids.has(session.id)) {
      invalidCatalog("Every session needs a unique, stable identifier.");
    }
    ids.add(session.id);
    for (const key of ["title", "room", "track", "startsAt", "endsAt", "url"]) {
      if (typeof session[key] !== "string" || !session[key].trim() || session[key].length > 1000) {
        invalidCatalog(`Session ${session.id} has an invalid ${key}.`);
      }
    }
    if (![session.startsAt, session.endsAt].every((value) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === (value.includes(".") ? value : value.replace("Z", ".000Z")))) {
      invalidCatalog(`Session ${session.id} must use explicit UTC timestamps.`);
    }
    if (Date.parse(session.startsAt) >= Date.parse(session.endsAt)) {
      invalidCatalog(`Session ${session.id} must end after it starts.`);
    }
    let link;
    try {
      link = new URL(session.url);
    } catch {
      invalidCatalog(`Session ${session.id} has an invalid source link.`);
    }
    if (link.protocol !== "https:" || link.username || link.password) {
      invalidCatalog(`Session ${session.id} must link to an HTTPS source without credentials.`);
    }
    return {
      id: session.id,
      title: session.title,
      room: session.room,
      track: session.track,
      startsAt: new Date(session.startsAt).toISOString(),
      endsAt: new Date(session.endsAt).toISOString(),
      url: link.href,
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const metadata = Object.fromEntries(
    ["kind", "title", "timeZone", "version", "source", "snapshotDate"].map((key) => [key, input[key]]),
  );
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ ...metadata, sessions }))
    .digest("hex");
  return { ...metadata, fingerprint, sessions };
}

export async function readCatalog() {
  const content = await readFile(new URL("../data/catalog.json", import.meta.url), "utf8");
  try {
    return validateCatalog(JSON.parse(content));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new WorkshopError(422, "INVALID_CATALOG", "data/catalog.json is not valid JSON.");
    }
    throw error;
  }
}

export async function requireCatalog(db) {
  const catalog = await db.collection("workshop_meta").findOne({ _id: "catalog" });
  if (!catalog) {
    throw new WorkshopError(409, "CATALOG_NOT_SEEDED", "The selected database has no session catalog. Run the explicit seed command for this target.");
  }
  const { _id, ...metadata } = catalog;
  return metadata;
}

export async function seedCatalog(db, catalog) {
  const metadata = await db.collection("workshop_meta").findOne({ _id: "catalog" });
  if (metadata && metadata.fingerprint !== catalog.fingerprint) {
    throw new WorkshopError(409, "CATALOG_MISMATCH", "This database has a different catalog. Review the schedule change instead of overwriting it with seed.");
  }
  for (const session of catalog.sessions) {
    const { id, ...fields } = session;
    await db.collection("sessions").updateOne(
      { _id: id },
      { $setOnInsert: { ...fields, catalogVersion: catalog.fingerprint, schemaVersion: 1 } },
      { upsert: true },
    );
  }
  const { sessions, ...fields } = catalog;
  await db.collection("workshop_meta").updateOne(
    { _id: "catalog" },
    { $setOnInsert: fields },
    { upsert: true },
  );
  return { sessions: sessions.length, kind: catalog.kind, version: catalog.version };
}

export function sessionView(document) {
  return {
    id: document._id,
    title: document.title,
    room: document.room,
    track: document.track,
    startsAt: document.startsAt,
    endsAt: document.endsAt,
    url: document.url,
  };
}

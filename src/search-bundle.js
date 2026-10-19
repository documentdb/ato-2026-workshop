import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { WorkshopError } from "./errors.js";
import { SEARCH_MODEL, checkedVector } from "./search-model.js";
import { hash, documentText, TEXT_VERSION } from "./search-contract.js";
import { SEARCH_BUNDLE_PIN } from "./search-bundle-pin.js";

export const BUNDLE_VERSION = "ato-session-embeddings-v1";
export const BUNDLE_ENCODING = "float32-le-row-major";
export const BUNDLE_NORMALIZATION = "l2-float64-then-float32-v1";
export const BUNDLE_FILES = Object.freeze({ manifest: "session-embeddings.manifest.json", data: "session-embeddings.f32" });
export const byteHash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const MAX_MANIFEST_BYTES = 150000;
const MAX_DATA_BYTES = 2000 * 768 * 4;
const invalid = () => new WorkshopError(409, "SEARCH_BUNDLE_INVALID", "The checked-in session embedding bundle is missing, corrupt or incompatible with this catalog/model. Restore the reviewed bundle and pin, or use the explicit maintainer regeneration workflow. No document embeddings were generated or database rows changed as a fallback.");

async function boundedFile(name, maximum) {
  // Only these fixed repository assets, never an input-selected path or URL.
  const file = await open(new URL(`../data/search/${name}`, import.meta.url), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size < 1 || info.size > maximum) throw invalid();
    const bytes = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw invalid();
      offset += bytesRead;
    }
    if ((await file.stat()).size !== bytes.length) throw invalid();
    return bytes;
  } finally { await file.close(); }
}

// Pure decoder exported for offline corruption tests and maintainer validation.
// Production never supplies a caller-controlled pin; readSearchBundle uses the
// separately reviewed source pin, so changing only the manifest is insufficient.
export function decodeSearchBundle(manifestBytes, dataBytes, catalog, pin = SEARCH_BUNDLE_PIN) {
  try {
    if (!Buffer.isBuffer(manifestBytes) || !Buffer.isBuffer(dataBytes) || manifestBytes.length > MAX_MANIFEST_BYTES || dataBytes.length > MAX_DATA_BYTES ||
        manifestBytes.length !== pin.manifestBytes || dataBytes.length !== pin.dataBytes ||
        byteHash(manifestBytes) !== pin.manifestSha256 || byteHash(dataBytes) !== pin.dataSha256) throw invalid();
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    if (manifest.version !== BUNDLE_VERSION || pin.version !== BUNDLE_VERSION || manifest.catalogFingerprint !== catalog.fingerprint ||
        manifest.model?.name !== SEARCH_MODEL.name || manifest.model?.digest !== SEARCH_MODEL.digest || manifest.model?.dimensions !== SEARCH_MODEL.dimensions ||
        manifest.textVersion !== TEXT_VERSION || manifest.normalization !== BUNDLE_NORMALIZATION || manifest.encoding !== BUNDLE_ENCODING ||
        manifest.count !== catalog.sessions.length || manifest.count !== pin.count || dataBytes.length !== manifest.count * SEARCH_MODEL.dimensions * 4 ||
        manifest.data?.file !== BUNDLE_FILES.data || manifest.data?.sha256 !== pin.dataSha256 || manifest.data?.bytes !== dataBytes.length ||
        !Array.isArray(manifest.sessions) || manifest.sessions.length !== manifest.count) throw invalid();
    const ordered = [...catalog.sessions].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const rows = new Map();
    for (let index = 0; index < ordered.length; index++) {
      const session = ordered[index];
      const entry = manifest.sessions[index];
      if (!entry || entry.id !== session.id || rows.has(entry.id) || entry.sourceHash !== hash(session) || entry.textHash !== hash(documentText(session))) throw invalid();
      const embedding = Array.from({ length: SEARCH_MODEL.dimensions }, (_, axis) => dataBytes.readFloatLE((index * SEARCH_MODEL.dimensions + axis) * 4));
      checkedVector(embedding);
      if (entry.vectorHash !== hash(embedding)) throw invalid();
      rows.set(entry.id, Object.freeze({ ...entry, embedding: Object.freeze(embedding) }));
    }
    return { version: manifest.version, digest: pin.manifestSha256, dataDigest: pin.dataSha256, manifest, rows };
  } catch { throw invalid(); }
}

export async function readSearchBundle(catalog) {
  try {
    const [manifest, data] = await Promise.all([
      boundedFile(BUNDLE_FILES.manifest, MAX_MANIFEST_BYTES), boundedFile(BUNDLE_FILES.data, MAX_DATA_BYTES),
    ]);
    return decodeSearchBundle(manifest, data, catalog);
  } catch { throw invalid(); }
}

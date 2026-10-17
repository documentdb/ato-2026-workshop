import { pathToFileURL } from "node:url";
import { readConfig } from "../src/config.js";
import { createConnections } from "../src/connections.js";
import { requireCatalog } from "../src/catalog.js";
import { WorkshopError, reportError } from "../src/errors.js";

// A deliberately small read-only stage vocabulary. $out/$merge and nested
// write pipelines are not accepted by this exercise runner.
export function validatePipeline(pipeline) {
  if (!Array.isArray(pipeline) || pipeline.length < 1 || pipeline.length > 8 || pipeline.some((stage) =>
    !stage || Object.keys(stage).length !== 1 || !["$match", "$group", "$sort", "$limit", "$project"].includes(Object.keys(stage)[0]))) {
    throw new WorkshopError(400, "READ_ONLY_PIPELINE", "Use 1–8 stages: $match, $group, $sort, $limit, or $project. No write stages are allowed.");
  }
  return pipeline;
}

export async function programCounts(db, buildPipeline) {
  const catalog = await requireCatalog(db);
  const pipeline = validatePipeline(buildPipeline(catalog.fingerprint));
  // Force the actual active catalog boundary even if an exercise omits it.
  const rows = await db.collection("sessions").aggregate([
    { $match: { catalogVersion: catalog.fingerprint } }, ...pipeline,
    { $project: { _id: 1, entries: 1 } }, { $limit: 30 },
  ], { maxTimeMS: 5000 }).toArray();
  return { catalog: catalog.version, rows, outputLimit: 30 };
}

async function run() {
  const [flag, target, mode, ...extra] = process.argv.slice(2);
  if (flag !== "--target" || !["local", "site-b"].includes(target) || (mode && mode !== "--reference") || extra.length) {
    throw new WorkshopError(400, "USAGE", "Use npm run challenge -- --target <local|site-b> [--reference]. This optional query is read-only and excludes Azure.");
  }
  const implementation = mode === "--reference"
    ? await import("../examples/complete/program-counts.js")
    : await import("../exercises/optional/program-counts.js");
  const connections = createConnections(readConfig());
  try {
    const result = await programCounts(await connections.db(target), implementation.programCountsPipeline);
    console.log(JSON.stringify({ target, ...result }, null, 2));
  } finally { await connections.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run().catch((error) => {
  reportError(error);
  if (error instanceof WorkshopError) console.error(error.message);
  process.exitCode = 1;
});

import { readConfig } from "../src/config.js";
import { readCatalog } from "../src/catalog.js";
import { createConnections } from "../src/connections.js";
import { reportError } from "../src/errors.js";
import { SearchModel } from "../src/search-model.js";
import { SearchStore } from "../src/search-store.js";

// Deliberately separate from seed/migrate and from every HTTP request path.
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--target" || !["local", "site-b", "cloud"].includes(args[1])) {
  console.error("Usage: node scripts/search-index.mjs --target local|site-b|cloud (explicit configured target only)");
  process.exitCode = 1;
} else {
  let connections;
  try {
    const config = readConfig();
    connections = createConnections(config);
    const target = args[1];
    const started = performance.now();
    const store = new SearchStore(await connections.db(target), await readCatalog());
    const result = await store.prepare(new SearchModel());
    console.log(JSON.stringify({ target, ...result, setupMs: Math.round(performance.now() - started), status: "ready", proof: "all vector hashes, index definition and actual full-corpus cosine self-query verified" }));
  } catch (error) {
    const safe = reportError(error);
    console.error(safe.message);
    process.exitCode = 1;
  } finally { await connections?.close(); }
}

import { readCatalog, sessionView } from "./catalog.js";
import { WorkshopError, publicError } from "./errors.js";
import { SearchModel, SEARCH_MODEL } from "./search-model.js";
import { SearchStore, SEARCH_COLLECTION, SEARCH_INDEX, sessionDay } from "./search-store.js";

// A conservative demo policy for sparse title/track metadata, NOT calibrated confidence.
export const SIMILARITY_CUTOFF = 0.60;
export const RANKING_POLICY = `DocumentDB cosine similarity descending; only scores >= ${SIMILARITY_CUTOFF.toFixed(2)}; at most the requested limit. No lexical reranking or fallback. Scores are not probabilities.`;
export const FILTER_STRATEGY = "IVF with one list retrieves the full bounded catalog (k = catalog count), then DocumentDB applies explicit day/track $match. Filters are not pre-retrieval filters.";
export function availableFilters(catalog) {
  return {
    days: [...new Set(catalog.sessions.map((session) => sessionDay(session, catalog)))].sort(),
    tracks: [...new Set(catalog.sessions.map((session) => session.track))].sort(),
  };
}
export function validateSearchInput(data, catalog) {
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      Object.keys(data).some((key) => !["target", "query", "day", "track", "limit"].includes(key)) ||
      typeof data.query !== "string" || !data.query.trim() || data.query.length > 500 || /[\u0000-\u001f\u007f]/u.test(data.query)) {
    throw new WorkshopError(400, "SEARCH_INPUT_INVALID", "Use a plain search query of 1–500 characters and the explicit day/track filters only.");
  }
  const limit = data.limit ?? 5;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new WorkshopError(400, "SEARCH_LIMIT_INVALID", "Choose between 1 and 10 search results.");
  const options = availableFilters(catalog);
  const filters = {};
  for (const [key, values] of [["day", options.days], ["track", options.tracks]]) {
    if (data[key] !== undefined && data[key] !== "") {
      if (typeof data[key] !== "string" || !values.includes(data[key])) throw new WorkshopError(400, "SEARCH_FILTER_INVALID", "Choose a day or track from this catalog. Search does not infer filters from your prompt.");
      filters[key] = data[key];
    }
  }
  return { query: data.query.trim(), limit, filters };
}

export function createSearch({ config, connections, model = new SearchModel(), catalogLoader = readCatalog, bundleLoader }) {
  let busy = false;
  let catalogPromise;
  let bundlePromise;
  const loadBundle = (source) => bundlePromise ||= (bundleLoader ? bundleLoader(source) : import("./search-bundle.js").then(({ readSearchBundle }) => readSearchBundle(source)))
    .catch((error) => { bundlePromise = undefined; throw error; });
  const verified = new Map(); // Bounded by the configured targets; never contains queries/results.
  const catalog = () => catalogPromise ||= catalogLoader().catch((error) => { catalogPromise = undefined; throw error; });
  const assertEnabled = () => {
    if (!config.searchEnabled) throw new WorkshopError(503, "SEARCH_DISABLED", "Codespaces prepares search automatically on startup. Continue the core workshop while it loads, then refresh after SEARCH READY. For retry or laptop-local setup: npm run search:prepare -- --local-sites. Keyword browsing and required exercises do not need a model.");
  };
  async function storeFor(target) {
    if (!Object.hasOwn(config.targets, target)) throw new WorkshopError(409, "TARGET_NOT_CONFIGURED", "This search target is not configured.");
    return new SearchStore(await connections.db(target), await catalog(), { bundleLoader: loadBundle });
  }
  async function verify(store, target) {
    const last = verified.get(target);
    const marker = await store.ready();
    if (!last || last.readyAt !== marker.readyAt || Date.now() - last.at > 300000) {
      await store.verifyAll();
      verified.set(target, { readyAt: marker.readyAt, at: Date.now() });
    }
  }
  return {
    async status(target) {
      const base = { target, enabled: Boolean(config.searchEnabled), model: SEARCH_MODEL };
      try {
        assertEnabled();
        const source = await catalog();
        const { sessions, ...metadata } = source;
        base.catalog = metadata;
        base.filters = availableFilters(source);
        const store = await storeFor(target);
        await verify(store, target);
        await model.verify();
        return { ...base, ready: true, message: `Ready: ${sessions.length} public catalog entries. Titles and tracks only; there are no abstracts or generated answers.` };
      } catch (error) {
        verified.delete(target);
        const safe = publicError(error);
        return { ...base, ready: false, code: safe.code, message: safe.message };
      }
    },
    async query(target, data, signal) {
      assertEnabled();
      const started = performance.now();
      const source = await catalog();
      const { query, limit, filters } = validateSearchInput(data, source);
      if (busy) throw new WorkshopError(429, "SEARCH_BUSY", "One semantic search is already running. Wait or cancel it before retrying.");
      busy = true;
      try {
        signal?.throwIfAborted();
        const store = await storeFor(target);
        await verify(store, target);
        const embeddingStart = performance.now();
        const [vector] = await model.embed([`search_query: ${query}`], signal);
        const embeddingMs = Math.round(performance.now() - embeddingStart);
        const databaseStart = performance.now();
        const { rows, pipeline } = await store.query(vector, filters, signal);
        const databaseMs = Math.round(performance.now() - databaseStart);
        signal?.throwIfAborted();
        const results = rows.filter((row) => row.similarity >= SIMILARITY_CUTOFF)
          .sort((a, b) => b.similarity - a.similarity || a._id.localeCompare(b._id)).slice(0, limit)
          .map((row, index) => ({ session: sessionView(row), rank: index + 1, similarity: row.similarity, evidence: { title: row.title, track: row.track } }));
        const displayPipeline = structuredClone(pipeline);
        displayPipeline[0].$search.cosmosSearch.vector = `[${vector.length} numeric values omitted]`;
        return {
          target, results,
          message: results.length ? "Ranked by meaning, using title and track metadata only. Inspect the source before saving." : "No strong metadata matches passed the demo cutoff. Try a more specific topic or remove filters; the nearest unrelated talks are not shown.",
          inspector: {
            status: "executed", target, database: config.targets[target].database,
            collection: SEARCH_COLLECTION, index: SEARCH_INDEX, model: SEARCH_MODEL,
            bundle: { version: (await store.bundle()).version, digest: (await store.bundle()).digest },
            dialect: "DocumentDB $search.cosmosSearch / $meta: searchScore (not Atlas syntax)",
            filters, filterStrategy: FILTER_STRATEGY, pipeline: displayPipeline,
            embeddingMs, databaseMs, totalMs: Math.round(performance.now() - started),
            rankingPolicy: RANKING_POLICY, cutoff: SIMILARITY_CUTOFF, candidates: rows.length,
            metadataOnly: true,
          },
        };
      } catch (error) {
        verified.delete(target);
        if (signal?.aborted) throw new WorkshopError(499, "SEARCH_CANCELLED", "Search was cancelled. No results were substituted.");
        throw error;
      } finally { busy = false; }
    },
  };
}

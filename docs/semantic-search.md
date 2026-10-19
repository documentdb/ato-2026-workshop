# Optional showcase: Search by meaning

This is a **built-in site feature, not another required lab exercise**. Prepare it
before or after the 105-minute workshop. The required TODOs, extension activities,
copy/return flow and calendar export are unchanged. Normal `npm ci` and
`npm run workspace:start` do **not** download a model or create a vector index.

The panel uses an embedding model to turn a query into a vector, then asks the
**selected DocumentDB instance** to retrieve similar session metadata. There is
no answer-generation model, agent, chat history, paid API key, or separate vector
database. The existing **Keyword search** remains a distinct substring browser.
If either the model or selected database is unavailable, semantic search fails
explicitly; it never silently uses keywords, static results, Site A, or another
model as a substitute.

## Enable explicitly in Codespaces or the local workshop

First finish ordinary startup so both canonical catalogs are seeded. Run in the
repository terminal (inside Codespaces for the Codespaces workshop):

```sh
npm run search:prepare -- --local-sites
```

This uses the current Compose project and its existing credentials/volumes. It:

1. Checks the pinned public embedding manifest and its download size.
2. Starts an **unpublished, temporary download service**, downloads only the
   embedding model, then stops that service on success, failure, **SIGINT or
   SIGTERM**. It waits for cancelled subprocesses to close, stops only this
   project's downloader, and verifies the container state before continuing.
3. Starts the internal-only CPU embedding service and enables the app's optional
   search configuration with `compose.search.yaml`.
4. Prepares and live-probes a separate search collection in **both** local sites.
   A target is only marked ready after all vectors, hashes, index options and an
   actual full-corpus DocumentDB cosine query pass verification.

Refresh the planner, or click **Check search readiness**. The showcase works
independently of TODO 1, but **Save favorite** uses the same TODO 2 implementation
as the ordinary cards; it does not bypass your exercise code. Using the complete
reference is optional. To keep reference mode while preparing, set it explicitly
for this command (this does not overwrite the starter file):

```sh
WORKSHOP_MODE=complete npm run search:prepare -- --local-sites
```

Prepare just one selected local site instead:

```sh
npm run search:prepare -- --target local
# Or explicitly: npm run search:prepare -- --target site-b
```

There is **no default target** for preparation. A site that was not prepared is
unavailable in semantic mode; switching sites clears results and ignores late
responses. Preparing search never seeds a missing canonical catalog or copies
favorites. The helper never provisions Azure or prepares a cloud target.

### Restart, stop, or return to the model-free workshop

With cached assets, this restart needs no model registry access:

```sh
docker compose -f compose.yaml -f compose.search.yaml --profile search up -d --wait --wait-timeout 240 app search-model
```

Add `-f compose.complete.yaml` **after** the search overlay if you want reference
mode. Keep port **3000 private**. Never forward the model port (11434), and retain
the existing database-port/TLS precautions in the [extension guide](extension.md).

To disable the optional feature while preserving every catalog, vector and favorite:

```sh
docker compose -f compose.yaml up -d --wait --wait-timeout 240 app
docker compose -f compose.yaml -f compose.search.yaml stop search-model search-download
```

`npm run workspace:start` also restores normal model-free app configuration. It
does not remove the optional cached model or stop a previously running sidecar;
use the explicit `stop` command above to release its memory. Do not use volume
pruning or `down --volumes` as a troubleshooting step.

### Interruptions and emergency downloader recovery

Use Ctrl+C once to cancel preparation and **wait for the
`search-download-stopped` / `verified: true` receipt**. The helper handles SIGINT
and SIGTERM during the manifest fetch, readiness and model pull. Cleanup is
independent of the cancelled operation; a second SIGINT/SIGTERM does not interrupt
it. No later app-start or indexing step begins after cancellation. The helper
freezes the resolved Docker context/project before starting the downloader and
uses only those selectors during bounded cleanup. A failed stop or unverifiable
container state produces **`SEARCH_DOWNLOAD_CLEANUP_FAILED`**, a nonzero exit,
and the safe context/project names—not a success claim. Catalogs, favorites,
model caches and volumes are never deleted by cleanup.

**SIGKILL, a killed terminal/container, a host crash or an unavailable Docker
daemon cannot be reliably cleaned up by process signal handlers.** If the receipt
is missing, or cleanup reports failure, inspect and stop the downloader manually.
Use the context/project reported by the helper, in the same workshop checkout:

```sh
# Replace these two placeholders with the exact names from the receipt/error.
docker --context YOUR_CONTEXT compose --project-name YOUR_PROJECT -f compose.yaml -f compose.search.yaml stop --timeout 10 search-download
docker --context YOUR_CONTEXT compose --project-name YOUR_PROJECT -f compose.yaml -f compose.search.yaml ps --all search-download
```

The downloader must show **Exited**, or no container. If it is still running,
restore Docker access and repeat the scoped stop before retrying preparation.
Never substitute a different project, delete volumes, or run a system-wide prune.
If termination happened before the helper printed project/context names, use
`docker context show` and `docker compose -f compose.yaml -f compose.search.yaml
config --format json` locally to establish the original selection; the latter
contains private credentials and must **not** be pasted into chat or a public log.
Do not run concurrent preparation commands for the same Compose project. If your
terminal overrides `DOCKER_HOST` without selecting `DOCKER_CONTEXT`, preparation
refuses to guess a daemon: select the matching explicit Docker context first.
It must be the same daemon that already owns your workshop volumes.

## What is actually searched?

The same checked-in **216-entry official public schedule snapshot** is used.
There are **no abstracts**, private conference datasets or invented descriptions.
The text embedded for each entry is exactly:

```text
search_document: <published title>
Track: <published track>
```

Queries are prefixed with `search_query: `. Source URL, room, start/end time and
conference-local day remain grounded metadata on each card; day/track are explicit
validated filters, not guesses from a language model. A query such as “Monday
only” does **not** set the day filter for you.

Short titles are imperfect evidence. Broad topics, puns and missing terminology
can produce poor rankings or no matches. Check the published title/track and
source before saving. The raw similarity score is **not confidence, probability,
attendance relevance, or a guarantee that a talk covers a requested technique**.

### Real DocumentDB index and query

`session_search` contains derived vectors and metadata; `search_meta` records
ownership, catalog fingerprint, model digest, text/schema version, count and
readiness. The canonical `sessions`, `workshop_meta` and `favorites` are not
changed by preparation. Vectors are finite, 768-dimensional and unit-normalized;
source/text/vector hashes are verified during preparation and periodically on
successful reads. Requests also check ownership, count, index options and returned
metadata. Mismatched or unowned collections are rejected, not adopted or dropped.

The pinned local DocumentDB **0.117.0** executes this index definition:

```js
{
  createIndexes: "session_search",
  indexes: [{
    name: "session_meaning_ivf",
    key: { embedding: "cosmosSearch" },
    cosmosSearchOptions: {
      kind: "vector-ivf", numLists: 1, similarity: "COS", dimensions: 768
    }
  }]
}
```

For this deliberately small corpus, one IVF list and `k: 216` retrieve the entire
candidate set before explicit filters. The **actual executed** query appears in
the inspector, with only vector coordinates abbreviated:

```js
[
  { $search: {
    cosmosSearch: { vector: [/* 768 numbers */], path: "embedding", k: 216 },
    returnStoredSource: true
  } },
  { $addFields: { similarity: { $meta: "searchScore" } } },
  // Present only when selected; this is POST-retrieval filtering in DocumentDB:
  { $match: { day: "2026-10-19", track: "<selected published track>" } },
  { $project: { embedding: 0, __cosmos_meta__: 0 } }
]
```

This is **DocumentDB's `$search.cosmosSearch` dialect**, not a claim that Atlas
`$vectorSearch` and its score metadata are identical. The application sorts the
actual returned scores, applies the disclosed **0.60 cosine cutoff**, then keeps
at most 10 results (the UI requests 5). No lexical gate, reciprocal-rank fusion,
answer generation or hidden fallback is applied. Nearest neighbors below the
cutoff are withheld rather than dressed up as confident recommendations. The
cutoff is an educational heuristic for this metadata snapshot, not a calibrated
universal relevance threshold. An initial 0.45 trial admitted unrelated bread,
ankle and basket-weaving queries; the stricter policy rejected those sampled
queries while retaining the three prompt-chip topics. This is a small sanity
check, not a benchmark or a guarantee for arbitrary queries.

The inspector reports target/database name (never a URI), model/digest/dimensions,
index, filters, candidate count, ranking policy and embedding/database/total
latencies. It only shows a pipeline after successful execution. Queries create no
indexes and persist no query histories. Query text is kept transiently in memory,
not in a server-side result cache. Internal errors are reported by safe codes.

## Model, runtime and resource budget

- Model: [`nomic-embed-text:v1.5`](https://ollama.com/library/nomic-embed-text:v1.5),
  768 dimensions. Its official [model card](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5)
  declares **Apache-2.0** and documents the query/document prefixes.
- Model manifest SHA-256:
  `0a109f422b47e3a30ba2b10eca18548e944e8a23073ee3f3e947efcf3c45e59f`.
  Assets total **274,302,450 bytes** (~262 MiB), including model/license/config.
  Ollama verifies blob hashes; the app verifies the pinned manifest digest on
  every embedding batch. Model assets stay in the Compose volume, never Git.
- Runtime: official [`ollama/ollama:0.1.48`](https://github.com/ollama/ollama/releases/tag/v0.1.48),
  pinned multi-platform image digest
  `4a3c5b5261f325580d7f4f6440e5094d807784f0513439dcabfda9c2bdf4191e`.
  Both Linux amd64 and arm64 manifests were checked before selection. Compressed
  image layers are approximately **455 MB amd64 / 410 MB arm64**. The older runtime
  uses the single-prompt `/api/embeddings` endpoint; the app normalizes its output
  and batches preparation as four sequential bounded requests.
- **Deliberate size tradeoff:** a newer GPU-bundled runtime considered for this
  feature was an amd64-only digest with **3.78 GB of compressed layers**. It was
  not downloaded. This small older pinned runtime avoids that download and a new
  Python runtime, but it is **not a recommendation for public or production
  inference hosting**. This choice is not a vulnerability audit or security
  certification. Keep it isolated; upgrading it requires re-proving the
  embedding contract and resource use. The large bundled image does **not** prove
  that every current CPU-only build is unsuitable: evaluating a supported current
  CPU-only distribution/custom image is future maintenance, not a completed
  comparison. A smaller final image may still require large build-time downloads.
  Its unused bundled GPU runner is extracted
  to an owned disk-backed cache (~555 MiB observed on arm64), never used for inference.
- CPU only, **2 threads**, **1 GiB service memory limit**, one loaded model and one
  inference at a time. No GPU pass-through or generation model. The app permits
  one search at a time and bounds queries to 500 characters, result limits to
  1–10, vector queries to the catalog count, model calls to 60 seconds and database
  queries to 10 seconds. Cold model loading takes longer than warm searches.
- Inference runs on a Docker **internal-only network**, with no published ports
  and read-only model/runner volumes. Only the temporary download service has an
  outbound route. There are no user-configurable inference URLs, HTTP redirects,
  remote embedding APIs or query-time model downloads. **The app adapter invokes
  only model-tag verification and embeddings; Ollama itself still has a broader
  model-management/generation API.** Network isolation and read-only inference
  volumes reduce exposure; they do not remove that API or patch runtime defects.
  The temporary downloader is writable and internet-connected, which is why its
  verified shutdown matters. The host preparation command contacts the public
  model registry; queries do not.

Reserve roughly **2 GB of extra disk** beyond the normal workshop and enough RAM
for the extra 1 GiB-limited sidecar. Codespaces compute/storage usage still applies;
there is no paid inference API. Test the chosen two-core Codespace before a demo,
not during the timed lab. If preparation fails or runs out of resources, use the
normal workshop while investigating; do not resize machines or delete unrelated
images automatically.

## Failures and ownership

- **Disabled / unseeded / not prepared:** use the explicit target command after
  ordinary startup. The search panel is separate from core workshop readiness.
- **Model missing/digest mismatch:** preparation checks the fixed manifest and
  repulls the pinned public model; a different model is never substituted.
- **Interrupted matching preparation:** rerun it; validated existing vectors are
  reused and only missing rows are embedded. A crashed writer's lease expires in
  three minutes. Ready is published only after the final real query probe.
- **Changed catalog/model/index or unowned namespace:** preserve the database and
  investigate, or select a fresh explicit database name, seed it and prepare it.
  There is intentionally no “force overwrite” or automatic deletion command.
  A namespace interrupted before its ownership marker was written also requires
  review rather than being silently claimed.
- **No strong match:** try a more specific subject or broaden the explicit filters.
  Returning nothing can be more honest than the nearest unrelated talk.
- **Timeout / busy / cancellation:** retry after the in-flight work finishes.
  Cancel clears the panel; late target/query replies cannot restore old cards.

The ideas are inspired by an “Ask the conference” search pattern: local embeddings,
native vector retrieval, grounded source cards and an inspectable query. This is
an independently authored, search-only implementation over this repository's
public catalog, not a copied conference corpus or an additional required exercise.

## Verification

Offline tests include model shape/digest checks, explicit input and target guards,
UI cancel/switch races and honest unavailable states. Separate subprocess tests
send real SIGINT/SIGTERM during mocked manifest reads, startup, readiness and pull;
verify second-signal-resistant cleanup; and check normal failure, stop failure
and a still-running container are never reported as safe completion. They use labeled mocks and
do **not** establish real vector-search compatibility:

```sh
npm test
npm run test:docs
```

After explicit preparation, run the opt-in real model/database suite:

```sh
docker compose -f compose.yaml -f compose.search.yaml exec -T app npm run test:search
```

It creates a uniquely named owned test database, embeds the actual public catalog,
executes native vector queries, checks sampled unrelated queries, validates
non-destructive re-preparation and intentional mismatch rejection, and removes
**only its owned temporary test database**. It does not change workshop favorites.
The ordinary two-site integration and reconnect tests remain separate. A manual
**Optional semantic search showcase** Actions workflow runs the real-model suite;
it is intentionally not added to every normal push/PR or attendee startup.

### Local evidence and limits (October 18, 2026)

On an isolated arm64 Docker Linux VM with **2 CPUs / 4 GB RAM**, shared with other
running applications:

- Both existing sites prepared **216 real 768-dimensional vectors** each, using
  the pinned model and DocumentDB image. Fresh indexing took **40.9 s / 40.4 s**
  after the model was cached. A complete idempotent `search:prepare -- --local-sites`
  rerun took **9.8 s**. These are not full cold Codespaces startup measurements.
- The real-model integration suite passed, including exact index options,
  full-corpus query, explicit track filtering, source/vector hashes, read-only
  canonical catalog/favorites, repeat preparation, unseeded status and intentional
  search marker/vector/index mismatch rejection. Ordinary two-site integration
  and both loopback extension authentication checks also passed.
- The preparation cleanup fix was separately live-tested with **SIGINT and
  SIGTERM delivered to the whole CLI process group**, followed by a second,
  different signal during cleanup. Both runs started only the owned cached
  downloader, verified it **Exited**, and returned **130 / 143** respectively.
  The app and both databases stayed stopped; pre-existing unrelated services were
  unchanged. No indexing started. Offline subprocess tests also cover blocked
  manifest/readiness/pull calls, ordinary success/failure and cleanup failure.
- A changed on-disk **model manifest digest** was rejected by both readiness and
  query endpoints. Restoring the original manifest restored readiness. Stopping
  the actual model service returned explicit failures while ordinary catalog
  browsing remained available. Restart and canceled-HTTP retry recovered without
  restarting the app or changing the notebook.
- Within that same owned project, first-use and previously healthy Site B outages
  recovered with the same app token and the same three-concurrent-acquisition
  probe process. The original database wait process also survived its first
  failed connection. There was no target fallback or notebook change. The
  standalone reconnect harness was not launched because it creates another
  project; its critical cases were exercised against the owned test project.
- Warm HTTP samples took **69–216 ms**. “running AI locally” ranked **Running
  Agents Locally with Open Source: From Laptop to Kubernetes** first (0.747) and
  **How to Run and Orchestrate LLMs Locally** second (0.724). The supply-chain chip
  returned supply-chain titles (top 0.719). Accessibility returned the published
  accessibility titles (top 0.682), **but also generic “Workflow Phase” / “Community
  Phase” entries because of their accessibility track**—a visible metadata limit,
  not evidence that those entries cover interface implementation.
- Sample bread-baking, Antarctic veterinary surgery, broken-ankle, basket-weaving,
  and banana-teleportation queries produced **zero accepted matches** at 0.60.
  “developer mental health” also produced no accepted match. The earlier 0.45
  trial produced unrelated suggestions and was rejected. No universal relevance
  claim follows from these few probes.

Browser rendering and a fresh two-core Codespaces run require separate proof;
DOM-unit tests and this local API evidence are not substitutes. No Azure resources,
paid inference services, private corpus, or model binaries were added to this repo.

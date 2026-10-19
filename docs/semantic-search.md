# Optional showcase: Search by meaning

This is a **built-in site feature, not another required lab exercise**. Both
Codespaces profiles automatically prepare it after core startup via
`npm run codespace:start`. The required TODOs, extension activities, copy/return
flow and calendar export are unchanged. Normal `npm ci`, laptop setup and
`npm run workspace:start` still do **not** download a model or create a vector index.

The panel uses an embedding model to turn a query into a vector, then asks the
**selected DocumentDB instance** to retrieve similar session metadata. There is
no answer-generation model, agent, chat history, paid API key, or separate vector
database. The existing **Keyword search** remains a distinct substring browser.
If either the model or selected database is unavailable, semantic search fails
explicitly; it never silently uses keywords, static results, Site A, or another
model as a substitute.

## Automatic Codespaces preparation; manual retry or laptop opt-in

The Codespaces `postStartCommand` runs `npm run codespace:start` for both Attendee
and Organizer. It first runs the unchanged core `workspace:start` (setup, app,
Site A/B wait and catalog seed), then prepares search for **both local sites**.
No Azure operation, paid AI key, source-control operation, exercise edit or
credential rotation is added. Organizer remains a local-only simulation.

At **CORE READY**, start the hands-on workshop on private port 3000 while search
finishes. Cold model/runtime downloads can take minutes; the app briefly restarts
when search is enabled. At **SEARCH READY**, refresh the planner and its request
token, then use **Search by meaning** / **Check search readiness**. A search-only
failure reports `search: unavailable`, leaves the core services alone, and exits
successfully so the core workshop can continue. Core startup failure stops before
search; cancellation or **SEARCH_DOWNLOAD_CLEANUP_FAILED** remains nonzero.

For a one-run opt-out use `WORKSHOP_AUTO_SEARCH=0 npm run codespace:start`.
For a persistent opt-out add `"WORKSHOP_AUTO_SEARCH": "0"` to `containerEnv` in the
selected `.devcontainer/devcontainer.json` or `.devcontainer/organizer/devcontainer.json`
and apply that config with a rebuild, or set the equivalent Codespaces environment
variable. It is read from the **lifecycle process environment**, not the private
Compose `.env`. `npm run workspace:start` is always a core-only fallback. Opt-out
skips preparation; it does not stop a sidecar from an earlier search-enabled run
(see the explicit stop command below).

Older existing Codespaces do not auto-update their checkout or lifecycle. Preserve
and review your changes, manually `git pull --ff-only` on the intended branch once,
then `npm run codespace:start`. If Git refuses, ask a helper rather than resetting,
stashing or overwriting exercises. No full rebuild is required to prepare search
in an already-running environment with the existing CLI tools. Fresh/rebuilt
configurations apply the new start hook; until then, invoke it explicitly. Startup
never pulls, checks out, commits or modifies attendee source files.

To retry **only search**, or opt in on a laptop, first ensure both canonical
catalogs are seeded, then run in the repository terminal:

```sh
npm run search:prepare -- --local-sites
```

This uses the current Compose project and its existing credentials/volumes. It:

1. **Before any inference startup, cache access, registry request or indexing**,
   inventories only this frozen Docker context/project's downloader containers.
   Two stable inspections must show none running, restarting or paused. Unknown
   states or failed inspection also return **SEARCH_DOWNLOAD_CLEANUP_FAILED**;
   a released process lock or valid model cache is not evidence of safe cleanup.
   Use the scoped recovery below before retrying. A clean exited downloader is
   inspected but never restarted on a cache hit.
2. Starts the read-only, internal-only CPU service and waits with bounded retries
   for its process. A cache hit verifies the **full SHA-256 of actual manifest
   bytes**, including pinned blob sizes, and checks `ollama show` can read the
   model. Filenames and `ollama list`'s shortened hash are not trusted. This uses
   **no embedding call, external model-registry fetch/DNS, or downloader start**.
   Docker may still pull the fixed runtime image if its local image cache is absent.
3. **Only if the cache/model/runner assets are missing or invalid**, stops the
   inference service, checks the pinned public manifest and size, starts an
   **unpublished, temporary download service**, initializes runtime assets and
   pulls only the embedding model. It stops that service on success, failure,
   **SIGINT or SIGTERM**, waits for cancelled subprocesses to close, and verifies
   only this project's downloader is stopped before continuing. The registry
   manifest must still match the pin; a changed upstream tag is not accepted.
4. Starts the internal-only CPU service and enables the app's optional search
   configuration with `compose.search.yaml`, with another bounded readiness probe.
5. Imports the **same checked-in 216-session embedding bundle** into a separate
   search collection in **both** local sites, builds each native vector index,
   and live-probes it. There are **zero document-embedding calls during ordinary
   preparation**. A target is only marked ready after the reviewed bundle, stored
   vectors/hashes, index options and actual full-corpus cosine query pass checks.

The ~716 KiB bundle is **precomputed document embeddings, not precomputed search
results**. Arbitrary user queries still need the pinned ~274 MB local model;
each query is embedded at runtime and retrieved from the selected DocumentDB.
The first preparation downloads/caches that model once for both sites, not once
per session or site. It does not generate the 216 document vectors on an attendee
machine. Missing, corrupted or stale bundle files fail closed, never fall back
to generating them.

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

On a normal Codespaces resume, the start hook repeats core startup and verifies
cached search/model assets without re-pulling the model. Search-store reuse still
checks the bundled vector hashes, real index and full-corpus query; there are no
document embeddings. The terminal emits `search-model-cache` with `verified: true`
and the final search receipt includes `cached: true`.

To run that lifecycle manually, use `npm run codespace:start`. To restart just
already-prepared search services with cached assets and no model registry access:

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

Use Ctrl+C once to cancel preparation and **wait for exit and, if a downloader
was started, the `search-download-stopped` / `verified: true` receipt**. A verified
cache hit never starts the downloader and therefore has no download cleanup receipt. The helper handles SIGINT
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

The downloader must show **Exited**, or no container. Every subsequent preparation
performs its own bounded, fail-closed inventory before enabling inference—even
when a preceding pull succeeded and the model cache is valid. The preflight receipt
is `search-download-preflight` / `verified: true`, not a claim that a new download
ran. If the downloader is still running,
restore Docker access and repeat the scoped stop before retrying preparation.
Never substitute a different project, delete volumes, or run a system-wide prune.
If termination happened before the helper printed project/context names, use
`docker context show` and `docker compose -f compose.yaml -f compose.search.yaml
config --format json` locally to establish the original selection; the latter
contains private credentials and must **not** be pasted into chat or a public log.
Automatic startup and manual search preparation share an exclusive
`.workshop-private/startup.lock` in the same checkout. A second invocation fails
with `WORKSHOP_STARTUP_BUSY` rather than racing app changes or downloader cleanup;
it does not wait forever or steal a stale lock. Normal exit and handled signals
release it. After SIGKILL/crash, first ensure the old Node/Docker clients are gone
and complete the scoped downloader recovery above, then remove **only**
`.workshop-private/startup.lock` and retry. Never run two checkouts against the same
Compose project or run a competing core-only startup during preparation.
If your
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
readiness, plus the **bundle version and manifest digest**. The canonical
`sessions`, `workshop_meta` and `favorites` are not changed by preparation. Vectors are finite, 768-dimensional and unit-normalized;
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

## Checked-in bundle and maintainer regeneration

The [bundle manifest and provenance](../data/search/README.md) describe these
fixed artifacts:

- `data/search/session-embeddings.f32`: **663,552 bytes**, 216 × 768 float32
  little-endian coordinates in ascending session-ID order.
- `data/search/session-embeddings.manifest.json`: **69,657 bytes**. Catalog
  fingerprint, model/digest, text and normalization version, encoding, per-session
  ID/source/text/vector hashes, data SHA-256 and actual generation provenance.
- `src/search-bundle-pin.js`: separately reviewed manifest/data SHA-256 and size
  pins. A changed manifest cannot authorize its own changed coordinates.

Combined embedding/manifest payload: **733,209 bytes**. These are freshly generated
vectors over the public snapshot, not model weights, canned query results or a
portable physical database index. DocumentDB still builds its index on each target.
The bundle was generated once with Nomic v1.5, Linux arm64 and the observed CPU
backend; its full provenance and model's Apache-2.0 attribution/license are included.
The shared adapter normalizes model output in float64 and the bundle encodes it as
float32. Import validates finite coordinates, unit norm tolerance and every hash.

**Maintainers only, outside the lab:** after starting the pinned search service and
app in your own local Compose project, deliberately regenerate with:

```sh
# Only needed to build/start the current app and cached embedding service:
docker compose -f compose.yaml -f compose.search.yaml --profile search up --build -d --wait --wait-timeout 240 app search-model
npm run search:bundle:generate -- --write
npm test
```

The generator computes all 216 embeddings with the fixed model, verifies the actual
CPU runner, writes the two fixed assets, and updates the source pin last. It writes
**no database**, does not scrape a new catalog or download a different model, and is
never invoked by ordinary startup/preparation. A missing cached model requires the
explicit model preparation workflow first. Review and commit all three generated
files together; restore them together if publication is interrupted. Ordering and
encoding are reproducible, but different CPU backends can produce slightly different
floating-point coordinates. New checksums must be reviewed, not described as
bit-identical cross-platform output. Update the artifact byte/hash documentation
when approving a regenerated bundle. Rebuild/restart the app after approving a
changed bundle so its source pin and cached decoded bundle are reloaded, then run
the real `test:search` suite against its separately owned fresh test database.
Publication holds an exclusive `data/search/.publication.lock` guard through all
three final-file writes and read-back verification. A concurrent publisher fails
without touching the winning publisher's files. If a maintainer process is killed
while publishing, confirm that no generator is running, review/restore the three
artifacts together, then remove **only the stale** `.publication.lock` file before
retrying. Never remove a live publisher's guard. A stale guard is not used as
permission to overwrite data or silently regenerate on attendee startup.

**Existing pre-bundle or differently bundled search targets are intentionally not
adopted or overwritten.** They return `SEARCH_SNAPSHOT_MISMATCH`; their catalog,
favorites and old vectors remain intact. For branch-testing recovery, select fresh
explicit `LOCAL_DATABASE_NAME` / `SITE_B_DATABASE_NAME` values in the existing private
`.env`, preserving credentials and all other settings; recreate the app, explicitly
seed those new databases, and prepare search. The [older-catalog recovery instructions](../README.md#existing-notebook-or-older-practice-version)
show that same non-destructive workflow. Changing a name selects another notebook;
it does not migrate favorites. Otherwise arrange a separately reviewed search-only
migration—there is no automatic deletion/force-overwrite command.

## Model, runtime and resource budget

- Model: [`nomic-embed-text:v1.5`](https://ollama.com/library/nomic-embed-text:v1.5),
  768 dimensions. Its official [model card](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5)
  declares **Apache-2.0** and documents the query/document prefixes.
- Model manifest SHA-256:
  `0a109f422b47e3a30ba2b10eca18548e944e8a23073ee3f3e947efcf3c45e59f`.
  Assets total **274,302,450 bytes** (~262 MiB), including model/license/config.
  Ollama verifies blob hashes; the app verifies the pinned manifest digest on
  every embedding batch. Model weights stay in the Compose volume, never Git;
  only derived session vectors and model-license attribution are checked in.
- Runtime: official [`ollama/ollama:0.1.48`](https://github.com/ollama/ollama/releases/tag/v0.1.48),
  pinned multi-platform image digest
  `4a3c5b5261f325580d7f4f6440e5094d807784f0513439dcabfda9c2bdf4191e`.
  Both Linux amd64 and arm64 manifests were checked before selection. Compressed
  image layers are approximately **455 MB amd64 / 410 MB arm64**. The older runtime
  uses the single-prompt `/api/embeddings` endpoint; the app normalizes its output
  for each live query. Only the explicit maintainer regeneration tool makes
  four-at-a-time batches of sequential document calls; attendee preparation imports
  the already-reviewed vectors without calling document inference.
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
- CPU backend is automatically selected (AVX2/AVX when available, otherwise the
  portable backend); `OLLAMA_LLM_LIBRARY=cpu` is deliberately not forced because
  it prevents those optimized CPU choices. Every embedding request retains
  `num_gpu: 0`, and no GPU is passed through. Runtime/backend changes require
  measured vector/ranking compatibility checks, not an assumption of identical
  floating-point coordinates.
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
  model registry only on a cache miss; cached preparation and queries do not.

Reserve roughly **2 GB of extra disk** beyond the normal workshop and enough RAM
for the extra 1 GiB-limited sidecar. Codespaces compute/storage usage still applies;
there is no paid inference API. Test the chosen two-core Codespace before a demo,
not during the timed lab. If preparation fails or runs out of resources, use the
normal workshop while investigating; do not resize machines or delete unrelated
images automatically.

## Failures and ownership

- **Disabled / unseeded / not prepared:** current Codespaces startup prepares both
  sites automatically. If it did not finish, retry `npm run search:prepare -- --local-sites`
  after core startup. The search panel is separate from core workshop readiness.
- **Model missing/digest mismatch:** preparation checks the fixed manifest and
  repulls the pinned public model; a different model is never substituted.
- **Interrupted matching preparation:** rerun it; validated bundle-bound existing
  vectors are reused and only missing rows are imported from the checked-in bundle.
  A crashed writer's lease expires in three minutes. Ready is published only after the final real query probe.
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

It creates a uniquely named owned test database, imports the genuine checked-in
catalog embeddings with an inference-throwing preparation adapter, then executes
real model query embeddings and native vector queries. It checks sampled unrelated
queries and validates non-destructive re-preparation and intentional mismatch rejection, and removes
**only its owned temporary test database**. It does not change workshop favorites.
The ordinary two-site integration and reconnect tests remain separate. A manual
**Optional semantic search showcase** Actions workflow runs the real-model suite;
it is intentionally not added to every normal push/PR or attendee startup.

### Local evidence and limits (October 18, 2026)

On an isolated arm64 Docker Linux VM with **2 CPUs / 4 GB RAM**, shared with other
running applications:

- **Current bundled preparation:** importing the reviewed 216 vectors, building the
  IVF index and performing full integrity/query probes on fresh canonical databases
  took **1.302 s on Site A / 1.281 s on Site B**. The entire one-command preparation
  with cached model/image took **10.775 s** (including model-manifest check, downloader
  shutdown verification and app readiness). These are local—not Codespaces—timings.
- An actual model adapter that throws if document inference is requested observed
  **zero document embedding calls** for both initial and repeat preparation. Real
  user queries still performed one model embedding each. All 216 stored vectors
  matched the reviewed bundle; canonical catalog/favorite byte hashes were unchanged.
- Comparing all bundled vectors with the previously validated same-runtime vectors
  gave minimum cosine **0.9999999999999979**, maximum coordinate change
  **7.45e-9** (float32 encoding). This is not a cross-CPU bit-identity claim. Old
  unbound search markers were rejected without changing rows or favorites.
- **Historical per-document preparation, before the checked-in bundle:** both
  sites generated 216 real vectors each, taking **40.9 s / 40.4 s** locally after
  model caching. A cached reuse run took 9.8 s. These arm64 timings did not predict
  a two-core amd64 Codespace running a generic CPU backend: that earlier path took
  several minutes per site. The default path now imports precomputed vectors;
  those old generation timings are **not current preparation claims**.
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

### Codespace and browser acceptance (October 18, 2026)

The bundled source `d4c10d6c7b2f2722e9f672045cd80841d520885c` was tested in an
existing owned **two-core / 8 GiB Codespace**, using fresh canonical database
names on both sites. Earlier notebooks, solved files, credentials and model cache
were preserved. These measurements precede the automatic-start/cache-first lifecycle.

- Complete `search:prepare -- --local-sites` with cached image/model assets took
  **17.07 seconds**, including service readiness and verified downloader shutdown.
  Site A import/index/integrity/probes took **1.756 seconds**; Site B also took
  **1.756 seconds**. Both imported all 216 vectors. This is **not a first model
  download or cold Codespace creation measurement**.
- **Zero document embedding calls** were independently observed: the real model
  request count stayed unchanged during the complete preparation. An adapter
  that throws on preparation inference also passed initial/repeat import. Every
  stored coordinate and ID/source/text/vector-hash tuple matched the bundle.
- Each browser search still made **one genuine query-embedding request**. The
  first query after model restart, “running AI locally,” returned the expected
  0.747 / 0.724 top scores in **1.732 seconds** total. A later Site B query returned
  the same five ranked results in **248 ms**. These are individual observations,
  not a latency guarantee.
- Actual private browser controls passed unfiltered search, unrelated bread
  query with zero accepted results, combined day/track filtering, target switching,
  native pipeline/model/bundle inspector, and saving a search result through the
  existing favorite route. The favorite remained in ordinary browsing after refresh.
- Codespace root tests: **152/152 passed**, no skips; **67 documentation links**
  checked. Real bundle/model/DocumentDB integration: **1/1 passed in 8.55 seconds**.
- Earlier browser acceptance of the same query/UI implementation at `75547c2`
  also exercised all three chips, cancellation/retry, query-edit and target races,
  model outage with explicit errors while keyword browsing/copy remained usable,
  model-only recovery, and the required TODO 2 gate. Those simulations were not
  repeated for the bundle-only preparation change.
- The CPU backend comparison sampled three prompts on generic CPU versus detected
  AVX2: roughly **10–11× faster warm query embeddings**, vector cosine agreement
  above **0.9999994**, and identical accepted result IDs/order. This does not promise
  bit-identical coordinates across architectures or universal search quality.
- Legacy collection hashes, including previous search vectors/markers and favorite
  timestamps, were unchanged. Only fresh selected notebook names received imports.
  Only app port 3000 was privately forwarded; database/model ports were not forwarded.
- The owned test Codespace was stopped and authoritative **Shutdown** verified;
  notebooks/cache were retained under its existing 24-hour retention setting.

Code/setup operations used CLI assistance; searches, filters, result actions and
inspector checks used the real browser. This was not a timed novice classroom
study, a new Azure test, or proof of full cold model-download timing. No Azure
resources, paid inference services, private corpus, or model binaries were added
to this repository.


### Automatic Codespaces startup acceptance

A fresh two-core Attendee Codespace automatically reached core HTTP readiness at
about **4m30s** and search readiness at **6m39s**, including first model download.
No manual preparation or Git pull ran. Real stop/restart reused the cache without
restarting the downloader: **12.951s search phase**, **83.792s total VM/core/search
resume**. The final downloader-preflight correction was then tested in that same
Codespace: an unsafe running downloader was refused before model/fetch/index work;
scoped recovery and cache-only retry passed. Final root tests: **195/195**.

These are measured observations, not universal timings. The initial lifecycle and
targeted guard checks used different documented revisions; see the full
[acceptance record](acceptance.md#actual-fresh-attendee-codespace-and-real-resume).
Organizer-profile creation, representative classroom accounts and networks, and
a timed human rehearsal were not separately exercised.

# Reviewed session embedding bundle

This directory contains **derived vectors, not model weights, query results, or a
physical database index**. The default optional preparation imports this same
bundle into either explicitly selected DocumentDB site. Every new user query is
still embedded locally and executed against the selected database.

## Assets and provenance

- `session-embeddings.f32`: **663,552 bytes**; 216 rows × 768 float32 little-endian
  coordinates, row-major in ascending session-ID order.
  SHA-256: `f1f6ae30c6550fdd14cb80fa0ad9d2876b86b2e8faf8784308a6bf669c19b582`.
- `session-embeddings.manifest.json`: **69,657 bytes**. Contains the exact model,
  catalog fingerprint, text/normalization version, vector-file digest, source/text
  and decoded-vector hashes for every session, and generation provenance.
  SHA-256: `4b0c03a82b77eee871ef3d2a29b8176f2a994e31a5a9e94ee058532247929da0`.
- Combined vector/manifest payload: **733,209 bytes** (~716 KiB). A separately
  reviewed source pin in `src/search-bundle-pin.js` authenticates both assets;
  editing only a manifest cannot authorize changed vectors.

Generated afresh on **2026-10-19 03:48:30 UTC** using the pinned
`nomic-embed-text:v1.5` manifest
`0a109f422b47e3a30ba2b10eca18548e944e8a23073ee3f3e947efcf3c45e59f`.
The official Ollama 0.1.48 image index is
`4a3c5b5261f325580d7f4f6440e5094d807784f0513439dcabfda9c2bdf4191e`.
Runtime: Linux **arm64**, observed **cpu** runner, two threads, `num_gpu: 0`,
`num_ctx: 2048`, `/api/embeddings`. Generation performed **216 real document
embedding calls**, not an export of unverified old rows or synthetic embeddings.

Only this repository's checked-in public ATO schedule **titles and tracks** were
embedded, using `search_document: <title>\nTrack: <track>`. There are no abstracts
or private conference materials. Catalog fingerprint:
`867c0473e9366654f222ad585515d4028289f192b6f39bd3123d9f704ddde106`.

The model output was normalized in float64 by the shared adapter, then encoded as
float32 without further normalization. Import validates every finite coordinate,
unit norm tolerance, hash, source text and ID. CPU/backend floating-point results
may differ: regeneration is deterministic in ordering/format, **not guaranteed
bit-identical across machines**. New checksums are deliberate reviewable changes.

## Attribution and license

Model: Nomic AI, [nomic-embed-text-v1.5 model card](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5),
licensed **Apache-2.0**. `MODEL-LICENSE.txt` is the exact license layer distributed
with the pinned Ollama model, SHA-256
`c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4`.
No model weights are redistributed here. The generator and workshop code retain
the repository's MIT license; the public schedule's original source and caveats
remain in `data/catalog.json` and the schedule import report. Derived vectors do
not add a new license claim over the original published conference material.

## Maintainer regeneration (never an attendee startup step)

See [the complete optional-search guide](../../docs/semantic-search.md) for service
startup, runtime caveats and ownership. With the correct local Compose project
and pinned model already running, run from the repository host terminal:

```sh
npm run search:bundle:generate -- --write
```

This explicitly computes all 216 document embeddings in the app container, checks
the actual model runtime/backend, writes the two fixed assets and updates the
source pin **last**. It modifies no database. Review all three files together,
run offline tests, rebuild/restart the app to reload its pin and decoded bundle,
run actual search tests, and deliberately commit the updated assets.
Restore all three files together if generation/publication is interrupted.
Regenerated assets are not silently adopted by existing database search rows;
use a fresh explicit database or a reviewed search-only migration.

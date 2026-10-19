# Local to Cloud and Back

A 105-minute DocumentDB workshop for All Things Open 2026. Build a personal
conference planner: browse sessions, save favorites, flag overlaps, and download
a calendar. Then discover why changing a database connection does not move data.

**No attendee Azure subscription, cloud database credentials, or Kubernetes setup.**
Attendees use two independent self-hosted DocumentDB instances: **Site A / Site B**.
They share application code, not storage, credentials, or favorites. In Codespaces,
both instances run inside the same development environment: this is a **two-site
simulation**, not an on-prem deployment, live hybrid cloud, replication, or failover.
The presenter separately demonstrates the same application against a real local
laptop database and an existing, authorized Azure DocumentDB instance.

**Codespaces-first:** bring a browser, a GitHub account, and available Codespaces
usage. No Docker, Node.js, Git, Azure CLI, or Kubernetes installation is required
on attendees' laptops. Codespaces still requires internet access and available
usage; it is not a promise of free or offline hosting.

The app includes the [official ATO schedule](https://2026.allthingsopen.org/schedule)
snapshot captured October 12, 2026: **216 distinct scheduled entries, October 18–20**.
On the preceding main source, a fresh **two-core attendee Codespace** reached both
sites in **4m47s**, actual Site A/B checks passed **34/34 plus integration**, Google
Calendar imported **3/3 events**, and a real **local Mac mini → managed Azure**
round trip passed (temporary cloud resource cleaned up). See the
[acceptance record](docs/acceptance.md) for scope. **The preceding reconnect/onboarding revision also passed a restarted-Codespace
attendee run: 47/47 tests, actual browser exercises, and cold first-connection
recovery in the same app process. This extension-integrated revision still needs
a fresh Codespace and actual extension GUI acceptance; those earlier counts do
not prove it.**
Timed human classroom delivery and conference-laptop networking are
not verified; automated checks are not substitutes.

The web schedule is primary; October 9 Monday/Tuesday PDFs were cross-checked,
not silently merged. See [source notes](docs/instructor.md#schedule-data) for
cross-listings, unresolved disagreements, and the excluded invalid break time.

## Start in Codespaces

1. [Open the workshop in Codespaces](https://codespaces.new/documentdb/ato-2026-workshop).
   Choose **ATO 2026 - Attendee** if prompted.
2. Wait for setup to finish. It installs dependencies, generates independent
   private development credentials, starts both databases and the app, waits for
   each database, and seeds the same catalog in both. It does not copy favorites.
3. When the terminal says **Site A and Site B are ready and both catalogs are
   seeded**, select **Ports** beside Terminal in the editor's bottom panel. Find
   row **3000** and use **Open in Browser** (globe). Keep visibility **Private**.
4. Run `npm run extension:connections`, then follow the
   [private connection steps](docs/extension.md#connect-the-two-existing-sites-privately)
   to save **Workshop — Site A** and **Workshop — Site B** in the DocumentDB
   extension's **Connections** tree. No Azure sign-in or **Set Up Local** wizard.
   The helper never prints credentials; keep its generated file private.
5. Follow the [attendee guide](docs/lab.md), also linked persistently in the planner.
   The blue **Exercise 1** checkpoint is intentional, not a broken database.
6. Edit in Codespaces: **Explorer → exercises → starter → repository.js**, or
   **Ctrl/Cmd+P**, then type `exercises/starter/repository.js`. A GitHub file link
   is a read-only source view, not the editable file in your running Codespace.

Both Codespaces profiles include the official
[DocumentDB for VS Code extension](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-documentdb)
(`ms-azuretools.vscode-documentdb`; guide targets version 1.0.0). Use it throughout
the lab: inspect catalog JSON before TODO 1, see favorite writes after TODO 2,
compare sites around the **app's** selected copy, and observe index/migration
changes. The extension does not implement your driver code or copy favorites
automatically. Compose still owns both containers; saved connections do not
turn them into extension-managed Local instances.

Only the app's **3000** port is privately forwarded. Database ports **10270/10271**
are bound to outer-container loopback for the remote extension and ignored by
auto-forwarding; never forward them or make them public. Both host ports are
configurable without touching credentials/volumes. See the
[networking explanation and CLI fallback](docs/extension.md).

Every workshop terminal command runs **inside Codespaces**, unless explicitly
following the optional [laptop-local appendix](docs/local.md).

If account policy or quota blocks startup, ask a helper for the agreed pairing or
follow-along path. Do not share logins or publish ports to bypass access controls.
Two databases need more memory/storage than the earlier single-site version;
preflight cold creation on the chosen Codespaces machine before class. Helpers
should triage at minute 12, not spend the workshop installing Docker on laptops.

Retry a failed setup after reading and resolving the error:

```sh
npm run workspace:start
```

This command selects the attendee Compose file explicitly, starts at Site A,
waits for **both** local services, and seeds only `local` and `site-b`.
A failed step stops startup; readiness is not reported after a failed second site.
The default Compose file does not pass Azure connection values to the app, even
if they remain in an older `.env`. No Azure login, provisioning, or seed occurs.

### Existing notebook or older practice version?

Keep the same checkout directory and Compose project name to retain the existing
`documentdb-data` volume: it is still **Site A**. Site B gets a new, separate
`documentdb-site-b-data` volume. Changing directories/project names selects other
volumes; it does not move your notebook.

Setup preserves every existing `.env` value and appends only missing Site B
settings. It never rotates Site A credentials. Partial/empty Site B credentials
require manual review rather than generating a password for a possibly existing
volume. Do not delete `.env` or volumes as a repair step.

Seeding the real snapshot into a practice database returns `CATALOG_MISMATCH`.
Choose a fresh name in your private `.env`, for example
`LOCAL_DATABASE_NAME=ato_workshop_2026` (and `SITE_B_DATABASE_NAME` if Site B also
contains an older catalog). Recreate the app, then seed both targets:

```sh
docker compose -f compose.yaml up -d --wait --wait-timeout 240 app
docker compose -f compose.yaml exec app npm run seed -- --target local
docker compose -f compose.yaml exec app npm run seed -- --target site-b
```

The old database/favorites remain in their volume; reverting the name selects
them again. Use the complete-reference override too if that is your active mode.
Fictional practice favorites cannot automatically map to real conference sessions.
An interrupted seed of the same catalog can be retried; incompatible partial
catalogs are rejected rather than silently hidden or overwritten.

## Complete reference and recovery

The starter and reference use the same app, catalog, configuration, and volumes:

- [TODO starter](exercises/starter/repository.js): two focused driver exercises.
- [Complete reference](examples/complete/repository.js): working recovery path.

Run the reference **without replacing your exercise or resetting favorites**:

```sh
docker compose -f compose.yaml -f compose.complete.yaml up -d --wait --wait-timeout 240 app
```

Return to the starter (unless you deliberately set `WORKSHOP_MODE` in `.env`):

```sh
docker compose -f compose.yaml up -d --wait --wait-timeout 240 app
```

Refresh the browser after every app restart: its request token changes. Node
watches the exercise file. If Docker file notifications are unavailable:

```sh
docker compose -f compose.yaml restart app
```

The attendee app always restarts at **Site A**. Switching the live connection is
explicit and never falls back silently after a failure. `WORKSHOP_MODE` selects
starter/reference; the separate `WORKSHOP_SCENARIO` selects attendee/presenter.
The base Compose file fixes the scenario to `attendee`.

## What the two sites teach

```text
Browser -> Node app -> Site A (OSS DocumentDB, own credentials + volume)
                   -> Site B (OSS DocumentDB, own credentials + volume)
                      One active target at a time; explicit copying only

Presenter capstone, separately:
Laptop app + local DocumentDB <-> existing managed Azure DocumentDB
                                 Explicit favorite copying, not replication
```

The standard MongoDB Node.js driver talks to DocumentDB's MongoDB-compatible API.
The repository methods do not branch by deployment. The self-hosted DocumentDB
engine is built on PostgreSQL; Azure supplies a managed operational environment.
The exercise proves the specific driver operations tested here, not universal
MongoDB feature parity or identical operational behavior.

- `sessions`: seeded catalog with stable identifiers and UTC times.
- `favorites`: selected session ID and its initial save timestamp.
- `workshop_meta`: catalog ownership/readiness and practice/official metadata.
- Switching connections does not seed, copy, replace, or delete favorites.
- Explicit copying inserts only missing selected favorites; retries do not create
  duplicates or overwrite their initial timestamps at the destination. Each site
  records its own first-save time; copying does not transplant the source timestamp.
- Per-record results distinguish copied, already present, invalid, failed, and
  unattempted. Partial success is not a transaction rollback.
- Removals do not synchronize; this is not replication, general conflict
  resolution, or automatic failover.

Both sites need the same catalog. Seeding preserves favorites and migrations and
rejects a different catalog. A schedule update is a reviewed data change, not a
startup scrape. Reproduce the checked-in catalog/audit offline with:

```sh
npm run import:schedule
```

The [captured source](data/schedule-source.json) and
[audit report](data/schedule-import-report.json) preserve provenance. A replacement
snapshot requires reviewed migration or fresh databases.

Calendar export is a snapshot, not a subscription. Follow the
[Google Calendar / Apple Calendar import steps](docs/lab.md#9-take-your-selections-with-you).
Published blocks may contain
sequential keynotes/lightning talks; no per-talk timing is invented. Overlap
warnings need interpretation. Favorites neither reserve seats nor grant entry to
separately registered events.

## Presenter-only real Azure capstone

Follow [the presenter runbook](docs/presenter.md). Use one existing approved Azure
DocumentDB instance and a dedicated approved demo database. Attendees never need
its credentials. An existing resource avoids new provisioning, not access policy
or charges. Managed TLS validation remains enabled.

Use **actual laptop-local** DocumentDB for an on-prem/cloud analogy. A Codespace
connected to Azure is self-hosted-to-managed, not an on-prem demonstration.
Keep a rehearsed recording as backup; the attendee lab and calendar outcome
remain complete if cloud networking fails. Kubernetes is optional future reading,
not a dependency or a substitute for cloud resource access.

The [organizer guide](docs/organizer.md) describes classroom preparation.
The alternate Organizer Codespace includes Azure CLI/Bicep for separately
approved legacy provisioning only; it grants no permissions and still starts
only the attendee simulation. Do not share an authenticated organizer environment.

## Stop without losing your planner

Export your calendar and preserve code, then stop your Codespace from
[Your codespaces](https://github.com/codespaces). Stopping compute may not stop
storage charges. Deletion or retention expiry removes local databases and
unpreserved work: Codespaces is not permanent hosting.

Laptop users can `docker compose -f compose.yaml stop`. Do not delete volumes or
replace `.env` for normal stopping. Deleting/stopping a Codespace does **not**
stop or delete Azure resources. The presenter follows the approved ownership and
cleanup policy for the existing Azure resource; never delete a shared cluster.

## Contributor checks

With Node.js 24.13 or newer (already available inside Codespaces):

```sh
npm ci --ignore-scripts
npm test
npm run test:docs
```

With the two-site Compose stack running:

```sh
docker compose -f compose.yaml exec app npm run test:database
```

Integration checks use uniquely named temporary databases on **two different
local server services**, never the configured cloud endpoint. They remove only
their own temporary databases. Checks cover independent favorites, additive
round trips, timestamp/duplicate preservation, partial results, indexes,
migrations with real before/after inspection, the optional read-only aggregation,
and HTTP target switching. For first-use failure/concurrent/wait-process recovery
on a **new isolated stack**, run `npm run test:reconnect` from the Docker host;
see [scope and cleanup](docs/acceptance.md#how-to-verify-the-revision). CI runs
these checks on Linux; this is not a fresh Codespaces or live Azure claim.

See the [lab](docs/lab.md), [instructor guide](docs/instructor.md),
[presenter runbook](docs/presenter.md), and [delivery plan](.azure/deployment-plan.md).
Code is available under the [MIT license](LICENSE).

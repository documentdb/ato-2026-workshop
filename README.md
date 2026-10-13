# Local to Cloud and Back

A 105-minute DocumentDB workshop for All Things Open 2026. Build a personal
conference planner: browse sessions, save favorites, flag overlaps, and download
a calendar. Then discover why changing a database connection does not move data.

**Codespaces-first:** attendees need a browser, a GitHub account, and available
Codespaces usage. No Docker, Node.js, Git, or Azure CLI installation is required
on their laptops. Docker and the development database run inside Codespaces.

The app includes a snapshot of the
[official ATO schedule](https://2026.allthingsopen.org/schedule), captured on
October 12, 2026. It contains 216 distinct scheduled entries across October 18-20.
A live Codespaces app/API rehearsal passed. The revised organizer configuration
and the full managed-Azure round trip still need a fresh end-to-end rehearsal.
Opening either configuration does not provision Azure resources.

The web schedule is the primary data source; the supplied October 9 Monday and
Tuesday PDFs were cross-checked, not silently merged. See the
[source notes](docs/instructor.md#schedule-data) for duplicates, unresolved
disagreements, unavailable details, and the excluded invalid break time.

## Start in Codespaces

1. [Open the workshop in Codespaces](https://codespaces.new/documentdb/ato-2026-workshop).
   Choose **ATO 2026 - Attendee** if prompted for a dev-container configuration.
2. Wait for setup to finish. It installs dependencies, generates private
   development credentials, starts DocumentDB and the app, and seeds the catalog.
   The terminal reports when the development database and catalog are ready.
3. Open port **3000** from the **Ports** tab. Keep its visibility **Private**.
4. Follow the [attendee guide](docs/lab.md). The starter's `TODO_LIST_SESSIONS`
   prompt is intentional until you complete the first exercise.

Every workshop terminal command runs **inside Codespaces**, unless explicitly
following the optional laptop-local appendix. The browser editor is your editor.

The Codespace needs connectivity and available GitHub usage; a GitHub account
alone does not guarantee access or free usage. If account policy or quota blocks
startup, ask a helper for a pairing or follow-along path. Do not publish ports or
share login sessions to get around access controls.

The source calls its development target `local`: that means local to the
development environment, not physically on your laptop. The second target,
`cloud`, is managed Azure DocumentDB. This is not an offline workshop.

Setup never overwrites an existing `.env`. If startup fails, inspect the terminal
error, resolve it, and retry:

```sh
npm run workspace:start
```

This starts and seeds only the development database; it does not sign in to Azure
or provision cloud resources.

### Already ran the practice version?

Seeding this snapshot into a practice database intentionally returns
`CATALOG_MISMATCH`. Do not delete the volume or overwrite its catalog to get past it.
To keep that practice notebook intact, choose a fresh local database name in your
private `.env`, for example `LOCAL_DATABASE_NAME=ato_workshop_2026`, recreate the
app with your usual Compose command, and seed `local` again. The old database
and its favorites remain in the volume. Reverting the name selects the old data.

Practice favorites are fictional sessions and cannot be mapped automatically
onto real conference sessions. No existing database or favorite is migrated by
updating this repository.

## Complete reference and recovery

The two implementations use the same application, fixture, configuration, and
database volume:

| Version | File | Purpose |
| --- | --- | --- |
| TODO starter | [exercises/starter/repository.js](exercises/starter/repository.js) | Two focused database exercises |
| Complete reference | [examples/complete/repository.js](examples/complete/repository.js) | Working implementation and recovery path |

In the Codespaces terminal, run the complete reference without editing or
replacing your exercise:

```sh
docker compose -f compose.yaml -f compose.complete.yaml up -d --wait --wait-timeout 240 app
```

To return to the starter:

```sh
docker compose up -d --wait --wait-timeout 240 app
```

Refresh the browser after a restart. The API's request token changes when the
server restarts. Changes to the repository exercise file restart the Node server
automatically. If Docker file notifications are unavailable, use:

```sh
docker compose restart app
```

## Attendee and organizer environments

| Configuration | Purpose | Azure identity |
| --- | --- | --- |
| **ATO 2026 - Attendee** (default) | Complete the TODOs, compare databases, copy favorites, export a calendar | No Azure-management login; use assigned database credentials |
| **ATO 2026 - Organizer** | The same development environment, plus preinstalled Azure CLI and Bicep | Explicit sign-in by an authorized organizer |

See [deploying from an organizer Codespace](docs/organizer.md). Do not share an
authenticated organizer Codespace, Azure login cache, or administrator credentials
with attendees. Selecting a configuration installs tools; it grants no Azure
permissions.

Optional GitHub CLI diagnostics use the SSH feature. Browser-only attendees do
not need a local GitHub CLI or SSH setup.

## Optional laptop-local path

Already have Docker and prefer your own machine? The
[laptop-local appendix](docs/local.md) uses the same application and Compose
files. It is not an attendee prerequisite and is not part of the timed setup.

## How the data works

- `sessions` holds a seeded catalog with stable identifiers and UTC times.
- `favorites` holds a selected session ID and its initial save timestamp.
- `workshop_meta` identifies the catalog version and whether it is practice data.
- The browser talks to the Node API, never directly to a database.
- Connection changes do not seed, copy, replace, or delete favorites.
- Explicit copying only inserts missing selected favorites. Repeating it does
  not duplicate favorites or overwrite their original save timestamps.
- Copy results distinguish copied, already present, invalid, failed, and
  unattempted records. Retrying is safe after resolving a partial failure.
- Copying does not synchronize removals or resolve arbitrary document conflicts.

Both database targets need the same catalog before a copy. The seed command is
explicit, preserves favorites and migrated documents, and refuses a known
different catalog. Loading a new conference schedule is a reviewed data change,
not an automatic startup refresh.

Calendar export is a snapshot, not a calendar subscription. It retains the
published block times; individual keynotes or lightning talks within a shared
block do not have invented per-talk timings. Overlap warnings are checks, not
proof that two talks in the same program compete. Favorites do not reserve seats
or confer access to events requiring separate registration.

The original practice catalog is retained only as a deterministic test fixture.
Actual schedule changes still require a reviewed update:

```sh
npm run import:schedule
```

This offline command reproduces the catalog and
[audit report](data/schedule-import-report.json) from the captured
[public metadata](data/schedule-source.json). It neither scrapes the network nor
changes a database. Capture and review a new source snapshot deliberately before
using it for an update.

## Managed Azure DocumentDB, later

An organizer must provide an approved, isolated sandbox and its database
credentials. Leave the cloud fields in `.env` blank until then. Never commit the
file, paste connection strings into screenshots, or put credentials in the UI.

See [organizer guidance](docs/instructor.md#azure-readiness) before enabling cloud
access. The managed database must validate TLS; the development container's
self-signed certificate exception is not used for the cloud target.

The primary app stays in Codespaces. Azure app hosting, background sync, personal
Azure-account creation, and an attendee login system are not workshop requirements.

## Stop without losing your planner

Export your calendar and preserve your code changes, then stop your Codespace
from [Your codespaces](https://github.com/codespaces). Stopping compute does not
necessarily end storage charges. Deletion or retention expiry removes its
development database and unpreserved work; this is not permanent hosting.

Do not delete Docker volumes or replace `.env` as a recovery step. That can lose
favorites or leave credentials out of sync with the database.

Stopping or deleting a Codespace does **not** delete Azure resources. The organizer
must follow the separately approved cleanup procedure in the
[organizer runbook](docs/organizer.md#cleanup-and-shutdown).

## Contributor checks

In either Codespaces configuration, or for contributors with Node.js 24.13 or newer:

```sh
npm ci
npm test
```

With the development Compose stack running:

```sh
docker compose exec app npm run test:database
```

Database checks use uniquely named temporary databases on the **local** endpoint
and remove only those databases. They explicitly ignore cloud configuration.
They exercise independence, additive round trips, duplicate prevention, partial
results, indexes, migrations, and the API. They are not an Azure compatibility
claim.

See the [attendee guide](docs/lab.md), [instructor guide](docs/instructor.md),
[organizer runbook](docs/organizer.md), and [Azure plan](.azure/deployment-plan.md).
Code is available under the
[MIT license](LICENSE).

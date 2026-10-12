# Local to Cloud and Back

A 105-minute DocumentDB workshop for All Things Open 2026. Build a personal
conference planner: browse sessions, save favorites, flag overlaps, and download
a calendar. Then discover why changing a database connection does not move data.

**Current status:** local-first implementation with a snapshot of the
[official ATO schedule](https://2026.allthingsopen.org/schedule), captured on
October 12, 2026. It contains 216 distinct scheduled entries across October 18-20.
Managed Azure DocumentDB access and a live Codespaces rehearsal remain separate
readiness gates. No cloud subscription or resources are provisioned here.

The web schedule is the primary data source; the supplied October 9 Monday and
Tuesday PDFs were cross-checked, not silently merged. See the
[source notes](docs/instructor.md#schedule-data) for duplicates, unresolved
disagreements, unavailable details, and the excluded invalid break time.

## Start on your laptop

You need Docker running with Linux containers, Docker Compose, a browser, and a
text editor for the two TODOs. No local Node.js, database client, or cloud account
is required. Download the repository ZIP and extract it, or clone it with Git.
Open a terminal in the extracted project directory.

The commands below work in PowerShell and Unix shells. Installation and image
downloads may need administrator access, a reboot, and reliable connectivity.
See the [attendee guide](docs/lab.md) if local setup is blocked.

```sh
docker compose -f compose.setup.yaml run --rm setup
docker compose up --build -d --wait --wait-timeout 240
docker compose exec app npm run seed -- --target local
```

Open **http://localhost:3000**. The database should be reachable. The starter
intentionally shows `TODO_LIST_SESSIONS` until you complete the first exercise.

Setup generates private local credentials in `.env` without displaying them.
It never overwrites an existing `.env`. The database is not published on a host
port; the app is bound to laptop loopback. Do not publish either port publicly.

The default package source is the public npm registry. On a network that requires
an approved anonymous package mirror, put its URL in `NPM_REGISTRY` in your private
`.env` before building. Never put a token or password into a build argument, and
never disable TLS verification. The lockfile pins versions and integrity hashes
without baking a developer's registry URLs into the public repository.

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

To run the complete reference without editing or replacing your exercise:

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

## Codespaces fallback

[Open this repository in GitHub Codespaces](https://codespaces.new/documentdb/ato-2026-workshop)
using its supplied dev-container configuration.
It prepares Node dependencies, Docker-in-Docker, the app, and a development
DocumentDB container. Keep forwarded port 3000 **private**.

This is a development database inside Codespaces, not a database on your laptop.
The UI labels the difference. It requires internet connectivity and available
Codespaces usage; a GitHub account alone does not guarantee access or free usage.
Base-image tags have been checked, but this path still needs a live Codespaces
rehearsal before it can be advertised as event-ready.

Database initialization happens at startup, not merely because a prebuild exists.
If startup fails, read the dev-container log and retry the same Compose and seed
commands above after correcting the error. Do not use a publicly forwarded port
to work around authentication.

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

The app itself stays on the laptop or in Codespaces. Azure app hosting, background
sync, personal cloud-account creation, and an attendee login system are not
workshop requirements.

## Stop without losing your planner

Export your calendar, then stop these containers:

```sh
docker compose stop
```

The named database volume is retained. Restart with the same Compose command and
project directory. Do not run volume deletion or pruning commands as a recovery
step: that can delete your favorites. Keep `.env` paired with its database volume;
changing credentials in the file is not a database password rotation.

In Codespaces, stopping the codespace stops compute, not necessarily storage
charges. Save your code and export your calendar before any deliberate deletion.

## Contributor checks

For contributors with Node.js 24.13 or newer:

```sh
npm ci
npm test
```

With the local Compose stack running:

```sh
docker compose exec app npm run test:database
```

Database checks use uniquely named temporary databases on the **local** endpoint
and remove only those databases. They explicitly ignore cloud configuration.
They exercise independence, additive round trips, duplicate prevention, partial
results, indexes, migrations, and the API. They are not an Azure compatibility
claim.

See the [attendee guide](docs/lab.md), [instructor guide](docs/instructor.md), and
[deferred Azure plan](.azure/deployment-plan.md). Code is available under the
[MIT license](LICENSE).

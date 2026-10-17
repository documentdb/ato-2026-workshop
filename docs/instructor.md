# Instructor and helper guide

Audience: developers comfortable with APIs, new to DocumentDB and hybrid apps.
One or two helpers handle setup while the presenter keeps the group moving.
The protected attendee outcome is a useful planner and a completed copy/return
trip across two independent OSS DocumentDB instances—without Azure access.

## The 105-minute journey

| Minutes | Activity |
| --- | --- |
| 0–20 | One-minute finished-planner demo, architecture, Codespaces setup; triage at minute 12 |
| 20–50 | Two repository TODOs, favorites, overlaps, persistence |
| 50–70 | Site A/B switch, missing favorites, explicit copy, retry, return trip |
| 70–85 | Presenter-only actual laptop-to-Azure demonstration or rehearsed recording |
| 85–95 | Repeatable indexes and migration extension |
| 95–105 | Calendar export, safe stopping, upstream pointers, questions |

This is a planned allocation, not a measured rehearsal. Setup delays consume the
index/migration extension first. Protect the return trip, calendar export, and
cleanup. Keep cloud troubleshooting off the critical attendee path.

## Opening explanation

Show the finished planner for one minute. Draw browser → Node app → DocumentDB.
The MongoDB Node.js driver sends operations to DocumentDB's MongoDB-compatible
API; the self-hosted engine is built on PostgreSQL. Both repository methods stay
the same when the deployment changes. This verifies selected operations, not
universal MongoDB parity or identical managed/self-hosted operations.

Say: **“Same code, separate data.”** Attendees have two independent containers,
credentials, and storage volumes, **not** two databases sharing one server.
In Codespaces both are hosted inside one development environment, not physically
on-prem. Site A/B are a simulation of site boundaries; copying selected favorites
is application logic, not streaming replication, automatic failover, or a generic
synchronization engine. The presenter demonstrates the actual laptop/cloud boundary.

## Setup risks and recovery

Attendees need a browser, GitHub account, internet, and available Codespaces usage.
Confirm machine capacity, quota/funding and conference-network access in advance.
Two database containers increase cold-start/storage/memory demand. Do not promise
startup times without measuring representative fresh accounts/machines.

At minute 12, helpers triage blocked sign-in, policy, quota and startup. Target a
working environment by minute 20. Use the agreed pairing/follow-along option;
never share logins or publish app/database ports. Optional laptop Docker is only
for people who already have it working—not an installation exercise.

`npm run workspace:start` safely adds missing Site B configuration, explicitly
uses the attendee Compose file, waits for each database, and seeds both catalogs.
It does not authenticate to or seed Azure. A failed Site B wait/seed is a failed
setup, not silent success with one working site. An older Azure URI in `.env`
is not passed into the attendee app. Keep secrets out of logs/screenshots.

Both dev-container configurations start this simulation; the Organizer profile's
Azure tooling is optional and does not confer permissions. The browser editor
supports the TODOs. The complete-reference override preserves exercises and data.
Optional GitHub CLI/SSH diagnostics are helper tools, not attendee prerequisites.

## Observable checkpoints

- Both sites ready and seeded; the intentional TODO explains the empty planner.
- TODO 1: 216 entries. TODO 2: save two favorites and retain them across app restart.
- Switch A → B: same catalog, no automatic favorite movement; A remains intact.
- Copy A → B; switch back to A before repeating that same direction; Already present.
- New favorite at B; copy B → A; original A choices survive.
- Removal is local to its site, not propagated to copies.
- Export from the intended site, preserve code, stop without deleting volumes.

## Schedule data

The [catalog](../data/catalog.json) is an official-web-schedule snapshot captured
October 12, 2026, at 16:57:37 UTC. It covers October 18-20 and all eight sections
of the unfiltered [schedule page](https://2026.allthingsopen.org/schedule).
Playwright read the page's published schedule data and checked its row count
against the rendered page. Only factual session metadata was captured, not
abstracts, speaker biographies, website scripts, or authenticated content.

The [captured metadata](../data/schedule-source.json) and
[import report](../data/schedule-import-report.json) make the transformation
reproducible with `npm run import:schedule`, without network access:

- 274 source listings become 216 distinct scheduled entries.
- 57 identical cross-listings are collapsed; genuinely different time slots
  remain separate.
- 190 distinct published session identifiers are represented.
- 23 entries have no published room and explicitly say "Room not listed."
- One invalid Community Leadership Summit break, printed on the web as
  12:00 pm-12:15 am on Monday, is excluded rather than silently corrected.

Entry identifiers combine the published numeric session ID, conference date,
and ordered occurrence on that date. A single session's time changing does not
change its ID. Adding, removing, or reordering repeated occurrences requires
reviewing the ID mapping before a future migration.

The page labels its times `US/ET`; the catalog uses `America/New_York`, with UTC
timestamps round-tripped against that zone. Times describe published program
blocks. Keynote and lightning-talk entries can share a block and run in sequence;
neither the importer nor the calendar exporter invents per-talk durations.
Overlap warnings must therefore be interpreted in the context of the program.

The workshop itself is listed Monday, October 19, 9:00-10:45 a.m. Eastern,
room 304, under Deep Dive Sessions 5. This matches the confirmed 105-minute length.

### PDF cross-check and unresolved discrepancies

The organizer supplied the October 9 versions of the
[Monday PDF](https://2026.allthingsopen.org/wp-content/uploads/2026/10/10.19.26.ATO_Schedule_Monday_10.09.26.pdf)
and [Tuesday PDF](https://2026.allthingsopen.org/wp-content/uploads/2026/10/10.20.26.ATO_Schedule_Tuesday_10.09.26.pdf).
They were cross-checked as secondary sources, not merged automatically.

| Item | Published web snapshot | Supplied PDF | Treatment |
| --- | --- | --- | --- |
| This workshop | Monday 9:00-10:45 am, room 304 | Same title/room, but the morning end label reads 10:45 pm | Keep the web time, consistent with the workshop's confirmed 105 minutes |
| Monday CLS noon break | 12:00 pm-12:15 am | 12:00 pm-12:15 pm | Keep the source discrepancy visible; exclude the invalid web range pending review |
| AI for DevSecOps room | Ballroom C | Ballroom A | Keep the web room; require organizer confirmation before treating the discrepancy as resolved |
| Tuesday morning keynotes | 8:45-10:10 am, room spelled "Ballrom B" | Overview starts at 8:45 am, places the next break at 10:15 am, and names Ballrooms A, B, & C | Keep the published web block and spelling; do not infer individual keynote timings |
| Some Tuesday slots | Track labels such as "Big Data" instead of specific talk titles | Corresponding slots are marked TBA | Preserve the published placeholder labels; do not fabricate titles |
| Stop Wasting GPUs detail link | Listed at 11:15-11:45 am Tuesday, but its published query-style URL returned HTTP 404 when checked | The title, room, and slot are present | Retain the schedule entry and the source URL; use the full schedule if the detail page remains unavailable |

The PDFs also contain other morning AM/PM labels that conflict with the surrounding
program. This is a focused metadata cross-check, not a claim that every PDF cell
or every detail-page URL has been independently verified.

These are snapshots, not promises of final room assignments or ticket eligibility.
Keep the website as the primary source for this import, and resolve material
differences with the organizer before event delivery. Saving favorites does not
register someone for a paid workshop or grant access to separately registered
Monday events.

### Updating without losing attendee data

Do not scrape a schedule on every attendee startup or infer unpublished times.
A replacement snapshot changes the catalog fingerprint; use fresh, approved
workshop databases or a reviewed migration. Existing practice databases are
deliberately not overwritten. The README provides a new-local-database path
that preserves the old catalog and all its favorites.

Seed the same snapshot in both targets, but never pre-copy attendee favorites.
Otherwise the missing-favorites exercise either hides its own lesson or becomes
confused with a missing catalog.

## Presenter Azure readiness

Follow the dedicated [presenter runbook](presenter.md). The organizer already has
an existing authorized Azure DocumentDB instance: no classroom cluster fleet or
new test subscriptions are required. Attendees never receive those credentials.
Use an approved dedicated demo database; no generic deletion of shared resources.

Use actual laptop-local DocumentDB for the live hybrid story. A Codespaces source
must instead be labeled self-hosted-to-managed. Rehearse the same catalog, local
favorites, empty managed favorites, explicit copy/retry, and return trip before
class. The repo's earlier managed round trip remains unverified until that proof
is recorded. Have a checked recording; if live connectivity fails, switch to it
rather than spend attendee time debugging access.

Validated cloud TLS stays enabled. Observe current source IP/DNS and use approved
narrow network rules; never broaden to all addresses or disable certificates.
Editing `.env` does not rotate database users and requires recreating the app.
Presenter commands select `compose.presenter.yaml` explicitly; normal attendee
startup selects only `compose.yaml` and will return to Site A/B.

The operator is optional further reading, not a workshop dependency. OSS operator
cross-cluster replication/promotion is a different demonstration from this app's
favorite copying to managed Azure. Do not imply those engines automatically
replicate together. No extra cloud resources are authorized by this guide.

## Troubleshooting without losing the lesson

| Observation | Response |
| --- | --- |
| Codespaces sign-in/policy/quota blocked | Pairing/follow-along; no last-minute laptop installation |
| Site A or B startup/seed fails | Read the bounded setup error; fix and retry `npm run workspace:start` |
| `TODO_LIST_SESSIONS` / `TODO_SAVE_FAVORITE` | Complete the exercise or use reference override |
| `DATABASE_UNAVAILABLE` | Confirm intended site, readiness and private logs; never silently use the other site |
| `CATALOG_NOT_SEEDED` | Seed that explicit local target, or retry interrupted same-catalog seed |
| `CATALOG_MISMATCH` | Preserve the old notebook, choose a fresh database name, or review migration |
| Site B favorites empty after switch | Expected: switching isn't copying |
| Incomplete copy | Read per-record outcomes, resolve failure, retry same direction |
| Browser fails after restart | Refresh to obtain the new request token; attendee restarts at Site A |
| Changed credentials fail | Recreate app for config changes; `.env` edits do not rotate an existing volume's users |
| Azure inaccessible | Presenter recording; attendee planner remains usable |
| Orphaned favorites block export | Diagnose catalog drift instead of silently dropping favorites |

Avoid `docker compose config` without `--quiet`: expanded output can disclose
credentials. Never reset databases, prune volumes, replace `.env`, or overwrite
attendee exercises as generic recovery. Keep the same Compose project name to
retain Site A's existing volume.

## Rehearsal checklist

- Fresh attendee Codespace with both instances and measured resource/startup cost.
- Setup upgrade from a legacy `.env` without changing old credentials/data.
- Starter/reference switching and restart persistence at both sites.
- Same catalog, independent favorites before copying, safe repeat/return trip.
- Second-site outage: clear error, no fallback; recovery retains both notebooks.
- Usable calendar import, honest simulation labels, private forwarded port.
- Actual presenter laptop/Azure round trip, narrow access, validated TLS, recording.
- Safe stopping, code/data retention explanation, existing-resource cleanup owner.
- Full 105-minute rehearsal with time to export; no last-minute feature expansion.

## Contribution pointers

Use [DocumentDB](https://documentdb.io/),
[the upstream repository](https://github.com/documentdb/documentdb), and
[documentation](https://documentdb.io/docs/). Show how to reproduce an issue,
improve docs, or contribute. Keep roadmap claims tied to current official sources.

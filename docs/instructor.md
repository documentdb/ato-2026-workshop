# Instructor and helper guide

Audience: developers comfortable with APIs, new to DocumentDB and hybrid apps.
Use short explanations and observable checkpoints. One or two helpers support
setup while the presenter keeps the main group moving.

## The 105-minute journey

| Minutes | Activity |
| --- | --- |
| 0-5 | Introduce the planner; launch the attendee Codespace |
| 5-20 | Finish browser sign-in and automated setup; open the private app port |
| 20-35 | Complete the two repository TODOs and save favorites |
| 35-43 | Explore scheduling conflicts and development-database persistence |
| 43-53 | Switch the same application to Azure; diagnose missing favorites |
| 53-68 | Copy selected favorites; demonstrate an idempotent retry |
| 68-80 | Create a cloud favorite, copy it back, and preserve development choices |
| 80-90 | Demonstrate repeatable indexes and a document migration |
| 90-98 | Export calendars, explain hosted-access expiry, and stop safely |
| 98-100 | Point to the upstream project, docs, and contribution routes |
| 100-105 | Questions and recovery buffer |

The protected outcome is the same data-access code against self-hosted development
DocumentDB and managed Azure DocumentDB. "Local" means local to the development
environment; with Codespaces, both environments are physically cloud-hosted.
Shorten the index/migration extension before sacrificing the central
connection-versus-data lesson, return trip, or cleanup explanation.

Align attendee communications with this delivery choice: browser, GitHub account,
and available Codespaces usage; no laptop Docker installation. Explain the
development-local meaning of "local" at the start rather than promising offline
laptop operation.

## Setup risks

Attendees need a browser, GitHub account, connectivity, and available Codespaces
usage. No local Docker, Node.js, Git, or Azure CLI installation is required.
At about minute 12, triage blocked sign-in, organization policy, or usage limits
with a helper; target a working environment by minute 20.

Do not promise startup timings without measuring cold creation on representative
accounts and networks. Optional local Docker is only for people who already have
it working; it is not the default path or an installation exercise.

Codespaces needs a GitHub account, available usage, and network access. Confirm
the funding/access arrangement and a pairing or instructor-follow-along option
for people blocked from Codespaces. Do not publish app or database ports to bypass
access controls.

The browser editor supports the TODOs. The complete reference provides a recovery
path without replacing an attendee's exercise file or changing their database.

Optional GitHub CLI diagnostics require both the `codespace` OAuth scope and an
SSH server in the dev container. Those are instructor-tooling requirements, not
extra steps for browser-only attendees. The completed-exercise test contract
accepts either an explicit unfinished TODO or the correct implementation.

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

## Azure readiness

Use the separate **ATO 2026 - Organizer** configuration and
[organizer runbook](organizer.md) to provision from Codespaces. Attendee startup
does not request Azure-management credentials. Never share the authenticated
organizer environment with students.

Arrange organizer-provided workshop accounts before attendee delivery. Establish
account/subscription scope, permitted regions and tiers, quotas, attendee access
policy, expiry, and cleanup authority.

A separately approved Azure subscription may be used for rehearsal before event
accounts are available. Confirm the target before any provider access or database
operation. Rehearsal success does not prove that event accounts have the same
policies, quotas, or permissions.

Attendees should receive prepared, isolated data-plane access; they do not need
Azure portal accounts for this lab. Establish a permitted network route from
laptops and Codespaces, including DNS/SRV lookup and validated TLS. Do not solve
conference-network problems by allowing the whole internet or sharing admin
credentials.

A Codespace's outbound IP changed during the live rehearsal after stop/resume.
Re-observe it and update only its exact firewall entry before cloud access;
do not assume a previously allowlisted address is still correct.

Do not assume that a database per attendee on one cluster is isolated. Current
native secondary-user permissions are cluster-wide. Use separately assigned
clusters for the direct-credential model and verify denied cross-attendee access
with two test identities. The two-cluster control-plane rehearsal succeeded;
managed data-plane isolation and the classroom-scale rollout remain unverified
and need their own approved scope.

Record the approved scope, runtime bounds, exact workshop resource ownership,
credential delivery/revocation, and cleanup owner before provisioning. If cleanup
fails, stop new provisioning and escalate visibly. Management access expiring
does not prove resource deletion.

Follow the organizer's approved resource policy, service quotas, subscription
policies, time/retry bounds, and cleanup requirements. Codespaces billing is
separate.

## Troubleshooting without losing the lesson

| Observation | Response |
| --- | --- |
| Codespaces sign-in, policy, or quota blocks startup | Use the agreed pairing/follow-along path; do not spend the lab installing laptop tooling |
| Container startup fails inside Codespaces | Read the setup error, fix it, and retry `npm run workspace:start`; never hide failure by changing targets |
| App says `TODO_LIST_SESSIONS` or `TODO_SAVE_FAVORITE` | Work the corresponding exercise, or use the complete-reference override |
| App says `DATABASE_UNAVAILABLE` | Confirm readiness and the intended target; inspect local logs privately |
| App says `CATALOG_NOT_SEEDED` | Run seed against that explicit, approved target |
| Cloud favorites are empty | Check whether the connection succeeded; data movement is a separate operation |
| Copy says `CATALOG_MISMATCH` | Compare the catalog versions; do not bypass the check |
| Copy is incomplete | Read per-record outcomes; retry after resolving the failure |
| Edits are not reflected | Save, restart the app if file watching is unavailable, then refresh |
| Credentials changed in `.env` but auth fails | Recreate the app to load config; changing `.env` does not rotate existing database users |
| Calendar export is blocked by orphaned favorites | Diagnose catalog drift instead of silently discarding favorite records |

Avoid `docker compose config` without its quiet flag: expanded configuration can
print credentials. Avoid database reset, volume pruning, global container cleanup,
or replacing the attendee's starter file as a generic fix.

## Rehearsal checklist

- Fresh attendee Codespace and organizer configuration, not just warm containers.
- Working starter/reference switching without loss of favorites.
- Both targets seeded with the same catalog.
- Same repository methods against real local and managed DocumentDB.
- Independent favorites before explicit copying.
- Retry-safe copying in both directions, including partial outcomes.
- Local choices preserved on the return trip.
- Conflict boundary cases and usable calendar import.
- Honest development-versus-managed labels; no physical-laptop/offline claim.
- Codespaces private port, cold startup, and available usage.
- Two-identity isolation and approved network access.
- Explicit shutdown, credential expiry, and verified cloud cleanup.
- A full timed rehearsal, with buffer rather than a new last-minute feature.

## Contribution pointers

Use [DocumentDB](https://documentdb.io/),
[the upstream repository](https://github.com/documentdb/documentdb), and
[the project documentation](https://documentdb.io/docs/). Explain where attendees
can reproduce an issue, propose a docs improvement, or contribute to the project.
Keep roadmap remarks tied to current official sources rather than promising
unannounced capabilities.

# Your conference planner

You are building against a real DocumentDB database, using the standard MongoDB
Node.js driver. Your application code will stay the same when its database moves.
Its data will not move unless you explicitly copy it.

You only need a browser, a GitHub account, and available Codespaces usage.
Docker, Node.js, the editor, and the development database run in your Codespace.
Do not install Docker on your laptop for this workshop.

The repository contains the October 12 snapshot of the published ATO schedule.
It is not a live feed. Times are published program blocks; several keynotes or
lightning talks may run in sequence inside the same block. Some Monday events
require separate registration; saving a favorite does not book a place.

If you already ran the older practice version, follow the
[non-destructive switch instructions](../README.md#already-ran-the-practice-version)
before seeding the real schedule.

## 1. Get to a working environment

Follow [Start in Codespaces](../README.md#start-in-codespaces) and select
**ATO 2026 - Attendee**. Wait for the development-database ready message, then
open private port 3000 from the Ports tab.

Use your own GitHub account for Codespaces. Check that you have usage available.
If account policy or quota blocks access, tell a helper early so they can arrange
pairing or a follow-along path. Do not share account logins or start a last-minute
Docker installation.

Run every command below in the Codespaces terminal. The internal target name
`local` means the development DocumentDB inside that Codespace; `cloud` means
managed Azure DocumentDB.

Open the planner. Check the active-database label and implementation label.
`TODO_LIST_SESSIONS` is an exercise prompt, not a failed database connection.
`DATABASE_UNAVAILABLE` means the chosen database is not ready or reachable.

## 2. Read the catalog

Open [the starter repository](../exercises/starter/repository.js).
Complete `listSessions(db, catalogVersion)`:

- Use the `sessions` collection.
- Filter on the supplied `catalogVersion`.
- Sort by `startsAt`, then `_id`, ascending.
- Return the cursor's array.

Do not change the connection code. Node watches this exercise file; refresh the
browser after saving. You should see 216 published schedule entries.

Need a recovery point? Use the [complete reference](../README.md#complete-reference-and-recovery).
Switching implementations does not replace your exercise or reset your data.

## 3. Save a favorite

Complete `saveFavorite(db, sessionId)`:

- Use the session identifier as the favorite's `_id`.
- Use `updateOne` with `upsert: true`.
- Set `savedAt` with `$setOnInsert` so retrying preserves the original timestamp.
- Return the driver's update result.

Save two genuinely parallel Monday sessions, such as "Local to Cloud and Back:
Building Hybrid Applications on Open Source" and "From Zero to Secure Agent:
Building and Hardening AI Agents with Open Source Tools." Both are listed at
9:00-10:45 a.m. Eastern in different rooms. Their cards and your favorites list
should flag the overlap. Back-to-back sessions are not a conflict.

Two talks sharing a keynote or lightning-talk block can be consecutive, so use
the published program to interpret those overlap warnings.

Restart the app, then refresh. Your favorites should still be there.

The development database is independent of Azure DocumentDB, but it is still
hosted in Codespaces. Stay connected to the internet; disconnecting your laptop
is not part of this workshop.

## 4. Connect the same code to Azure

This section requires organizer-issued sandbox access. It is not runnable until
the organizer confirms the target is authorized.

Put the supplied connection URI and database name in the two cloud fields of
your private `.env`. Keep real values out of source code, screenshots, and chat.
Use the assigned database only. Do not change TLS validation settings.

Recreate the app so it reads the updated configuration, using the same starter
or complete-reference Compose command you have been using.

Seed **the catalog only** in your assigned cloud database:

```sh
docker compose exec app npm run seed -- --target cloud
```

Select **Azure DocumentDB** and choose **Switch connection**.
The session catalog should remain familiar, but your development favorites are absent.

Before trying to "fix" the code, explain:

- Which database is active?
- Did the switch fail, or is the selected database simply holding different data?
- Where are the original favorites?

Switch back to the development target and confirm the originals are still there.
No data-access code needed a cloud-specific rewrite.

If connectivity fails, distinguish configuration, authentication, certificate,
and network access. The API does not fall back to another environment silently.
Use the active-target label and sanitized error code; ask a helper to inspect
credentials privately. Never fix an Azure certificate problem by disabling TLS.

## 5. Copy selected favorites

While connected to the development database, select favorite checkboxes in the
side panel. Choose **Copy selected favorites**. Review the source, destination,
and records in the confirmation dialog, then confirm.

Switch to Azure and see the copied favorites. Repeat the same copy once:
the records should report **Already present**, not create duplicates.

The tool reports every selected record. If a copy is incomplete, review the
failed or unattempted records. Retry only after resolving the cause; do not assume
the entire request was rolled back.

## 6. Bring one back

Save another favorite while the cloud target is active. Select that favorite,
review the copy back to the development target, and confirm.

Switch back. Your original choices remain, and the new choice is added.
Any new overlap is flagged.

Removing a favorite from one database does not remove it from the other. This is
deliberate copying, not a complete bidirectional synchronization system.

## 7. Make changes repeatable

The instructor will demonstrate the same commands against each authorized target:

```sh
docker compose exec app npm run indexes -- --target local
docker compose exec app npm run migrate -- --target local
docker compose exec app npm run check -- --target local
```

The index exercise makes an index definition repeatable; it does not prove that
a particular engine will use it for sorting. The migration adds `attendanceMode` to
version-1 documents. Run it again: it should report zero newly migrated records.
Apply the corresponding command to `cloud` only when that target is approved.

Compare index names and document versions rather than claiming a tiny dataset
must exhibit a visible speedup. Re-seeding does not undo the migration.

## 8. Take your selections with you

Choose **Download calendar (.ics)** and import the downloaded snapshot manually
into your calendar. Conflicting selections are exported too: warnings inform you,
not silently choose which sessions you attend.

The file uses real session titles and dates from the captured schedule, not
practice labels. Check the official schedule for subsequent changes and for the
sequence of talks inside shared program blocks.

Export before the end of temporary Azure access or Codespaces retention. Your
downloaded calendar is independent of both services. Preserve code changes before
deleting a Codespace; its development database is not permanent hosting. Follow
the stop instructions in the
[README](../README.md#stop-without-losing-your-planner); do not delete volumes as
part of normal stopping.

# Your conference planner

Build against real self-hosted DocumentDB using the standard MongoDB Node.js
driver. Your application code stays the same when you switch databases.
**Its data does not move unless you explicitly copy it.**

You need a browser, a GitHub account, and available Codespaces usage. No Azure
subscription, cloud database credentials, Docker installation on your laptop,
or Kubernetes knowledge is needed. Both independent databases run inside your
Codespace. **Site A / Site B simulate two sites; they are not two clouds, an
on-prem deployment, replication, or automatic failover.**

The catalog is the October 12 snapshot of ATO's published schedule, not a live
feed. Times are published blocks; keynotes/lightning talks may be sequential
inside a shared block. Some Monday events require separate registration.
Saving a favorite does not reserve admission.

Already used the practice version? Follow the
[non-destructive notebook instructions](../README.md#existing-notebook-or-older-practice-version)
before seeding. Never delete volumes to get past a catalog mismatch.

## 1. Start both sites

Follow [Start in Codespaces](../README.md#start-in-codespaces), choosing
**ATO 2026 - Attendee**. Wait for **both** sites to be ready and seeded, then open
private port **3000**. In the bottom panel of the Codespaces editor, choose
**Ports** (beside Terminal), find row **3000**, then use its **Open in Browser**
(globe) action. If Ports is hidden, use **View → Terminal**, then select **Ports**
in that panel. Keep **Port Visibility → Private** in the row's context menu.
Run the commands below in the **Terminal** tab of this same Codespace.

The planner's top-right **Attendee guide (opens new tab)** link stays visible
throughout the lab. The exercise checkpoint also links directly to its step and
hints. Keep the guide and your private planner open in separate tabs.

If account policy or quota blocks startup, tell a helper early for pairing or
follow-along. Do not share logins, expose public ports, or install Docker during
the timed lab. Retry a diagnosed setup failure with `npm run workspace:start`.

Check the active label: **Site A — self-hosted**. The implementation label should
say **Exercise implementation (your editable code)**. This labels the selected
file, not whether you have finished it. The blue **Exercise 1 — Read the catalog**
checkpoint is expected; `DATABASE_UNAVAILABLE`
is not. The internal CLI name `local` means Site A; `site-b` means Site B.
Neither means managed Azure. Both sites have separate credentials and volumes.

### Connect your visual database explorer

Run `npm run extension:connections` and follow the
[private setup steps](extension.md#connect-the-two-existing-sites-privately). Save
**Workshop — Site A** and **Workshop — Site B** in DocumentDB **Connections**.
Expand each to its actual workshop database. This is required lab tooling, not an
Azure demo: no sign-in, no **Set Up Local** third database, no forwarded database
ports. Keep the credential file out of screen sharing. If the editor is blocked,
ask a helper and use [CLI inspection](extension.md#if-the-visual-explorer-is-blocked)
as a fallback, not as a claimed visual-explorer pass.

## 2. Read the catalog

**First see the data before writing code.** In DocumentDB **Connections**, expand
**Workshop — Site A → your database → sessions** and open its **Documents**
child (or the collection's leftmost inline icon). Follow
[Browse, query and refresh](extension.md#browse-query-and-refresh): read the catalog
fingerprint from `workshop_meta`, filter `sessions` by it, and inspect one actual
JSON document with `_id`, `startsAt`, `catalogVersion` and `schemaVersion`.
Notice that `_id` is a stable session identifier and `startsAt` an ISO UTC string.
Keep this `_id` to revisit in step 8. Do not edit the seeded catalog.

**Now implement the application read.** In the **Codespaces editor**, use the left **Explorer** panel:
**exercises → starter → repository.js**. Or press **Ctrl+P** (Windows/Linux) /
**Cmd+P** (Mac), type `exercises/starter/repository.js`, and press Enter.

The [GitHub source link](../exercises/starter/repository.js) opens a **read-only
file view**, not your running Codespace's editable file. Edit in Codespaces, not
in that GitHub tab. Leave the imports and `saveFavorite` function in place.

Complete `listSessions(db, catalogVersion)`:

- Use `sessions`.
- Filter on the supplied `catalogVersion`.
- Sort by `startsAt`, then `_id`, ascending.
- Return the cursor's array.

Do not change connection code. Save and refresh the browser: expect **216 entries**.
The same repository function will run against both sites. If a genuine connection
or catalog error appears instead of the blue checkpoint, diagnose that error;
completing a TODO will not repair a database outage.

<details>
<summary>Hint 1 — What does find return?</summary>

`db.collection("sessions")` selects a collection. `find({ catalogVersion })`
selects only this seeded catalog's documents and returns a **cursor**, not an
array. A cursor describes work for the server; `toArray()` executes/collects its
results for this small, bounded catalog. Return that promise (or await it).

</details>

<details>
<summary>Hint 2 — Stable ordering</summary>

Chain `.sort({ startsAt: 1, _id: 1 })` between `find` and `toArray`.
`1` means ascending; `_id` breaks ties between parallel entries with the same
start time. `_id` is the stable session identifier, not the array position.

</details>

<details>
<summary>Solution / recovery reference</summary>

```js
return db.collection("sessions")
  .find({ catalogVersion })
  .sort({ startsAt: 1, _id: 1 })
  .toArray();
```

Compare with [the complete repository](../examples/complete/repository.js), or
use the non-destructive reference mode below. Do not replace the whole starter
file if you only want to complete one exercise.

</details>

Need recovery without replacing your exercise?

```sh
docker compose -f compose.yaml -f compose.complete.yaml up -d --wait --wait-timeout 240 app
```

Refresh. This selects the complete reference but retains your code and both
notebooks. Return to the starter with:

```sh
docker compose -f compose.yaml up -d --wait --wait-timeout 240 app
```

## 3. Save favorites and prove persistence

Complete `saveFavorite(db, sessionId)`:

- Use the session ID as the favorite's `_id`.
- Use `updateOne` with `upsert: true`.
- Set `savedAt` with `$setOnInsert` so retries preserve the initial timestamp.
- Return the driver's update result.

Save the file and refresh the planner. Trying **Save favorite** before this
function is implemented shows the blue **Exercise 2** checkpoint, not a database
failure. After implementation, try the save again.

<details>
<summary>Hint 1 — Give a favorite a stable identity</summary>

Use `db.collection("favorites").updateOne(...)`. Its first argument is
`{ _id: sessionId }`. The database's unique `_id` identifies one favorite per
session, so repeating a save selects the same record rather than another row.
An `upsert` updates a match, or inserts a document when nothing matches.

</details>

<details>
<summary>Hint 2 — Preserve when it was first saved</summary>

The second argument is an update document. `$set` would overwrite a timestamp
on every save; `$setOnInsert` applies only when the upsert inserts a new record.
Use `{ $setOnInsert: { savedAt: new Date().toISOString() } }` and the third
argument `{ upsert: true }`. Return the driver's result so the UI can distinguish
`upsertedCount === 1` (new) from an already-saved favorite.

</details>

<details>
<summary>Solution / recovery reference</summary>

```js
return db.collection("favorites").updateOne(
  { _id: sessionId },
  { $setOnInsert: { savedAt: new Date().toISOString() } },
  { upsert: true },
);
```

The [complete repository](../examples/complete/repository.js) uses the same
standard MongoDB driver, not a different deployment-specific SDK.

</details>

Save two genuinely parallel Monday sessions, for example:

- “Local to Cloud and Back: Building Hybrid Applications on Open Source”
- “From Zero to Secure Agent: Building and Hardening AI Agents with Open Source Tools”

Both are listed Monday, 9:00–10:45 a.m. Eastern, in different rooms. Their cards
and favorites should flag an overlap. Back-to-back sessions do not conflict.
Interpret shared keynote/lightning-talk blocks using the official program.

**See the write in the extension.** Refresh the **Workshop — Site A** tree;
`favorites` now exists. Open **Documents**, use JSON view, and inspect a saved
session's `_id` and `savedAt` (project only those fields). This is the database
record your TODO wrote, not browser storage. Your stable `_id` plus
`$setOnInsert` explains why retrying the upsert cannot add a duplicate or change
its first-save timestamp. Do not edit the JSON to “test” it; step 5 exercises a
real retry through the app. [Rerun/reopen the query](extension.md#browse-query-and-refresh)
after changes rather than trusting stale results.

Restart the app and refresh:

```sh
docker compose -f compose.yaml restart app
```

Your Site A favorites remain. The browser is not their storage. A restart returns
the attendee app to Site A and changes its request token; refresh after restarting.
Stay connected to Codespaces: laptop-offline operation is not part of this lab.

## 4. Switch the connection, not the data

Select **Site B — self-hosted**, then **Switch connection**.
The same 216-entry catalog is there, but Site A's favorites are absent.

In the extension, compare **Workshop — Site A** and **Workshop — Site B**. Open
each database's `favorites` Documents view (refresh the tree first). B may have
no `favorites` collection yet, or no records in it; A still has your actual JSON
records. Merely opening an extension tab does not switch the app.

Before “fixing” any code, explain:

- Which database is active?
- Did the connection fail, or does this database simply contain different data?
- Where are the original favorites?

Switch back to **Site A** and confirm the originals remain. No repository-method
rewrite was required. Setup seeded catalogs, not favorites.

If switching fails, the API does not silently fall back. Check the active label,
sanitized error, and helper guidance. Once that site is healthy, retry the switch
in the same app: acquisition explicitly reconnects, including after a failed
first connection. This does **not** replay a failed save/copy automatically.
Do not delete data or restart the app as a routine connection repair.

## 5. Copy selected favorites and retry

While **Site A** is active:

1. Select favorite checkboxes in the side panel.
2. Choose **Copy selected favorites**.
3. Verify the confirmation says **Site A → Site B**, inspect the selection, confirm.
4. Switch to **Site B** and see the copied favorites.
5. **Switch back to Site A**, select the same favorites, and repeat **Site A → Site B**.
   Expect **Already present**, not new duplicates.

After the first copy, refresh/reopen **Site B → favorites** in the extension.
Filter one copied `_id`, note B's `savedAt`, then compare that same `_id` on A.
After repeating the copy, rerun B's query: still one record with the **same B
timestamp**. A remains unchanged. B records its own initial save time, so it need
not equal A's timestamp. If your notebook was used before, compare your actual
before/after records rather than assuming an empty destination.

Use the **planner app's Copy selected favorites**, never extension **Copy
Collection**. The latter is a different operation without this exercise's
selected-record/catalog-validation/per-record-outcome semantics.

The source is always the active site; switching before copying changes direction.
Read the confirmation instead of assuming the destination.

Partial results are per record: copied, already present, invalid, failed, or
unattempted. A failed batch is not automatically rolled back. Resolve the cause
and retry safely; each destination's initial save timestamps and existing choices
are preserved. Each site records its own first-save time, not the other site's.

## 6. Bring one back

Switch to **Site B**. Save a different session. Select that new favorite and
confirm **Site B → Site A**. Switch back to **Site A**: the original choices remain
and the new one is added. Any resulting overlap is flagged. Refresh both extension
views to see the newly added `_id` and each site's independent `savedAt`.

Removing a favorite from one site does not remove its copy at the other. This
is explicit additive copying, not bidirectional synchronization or conflict
resolution. The two containers simulate deployment boundaries; they do not prove
multi-cloud networking or disaster recovery.

## 7. Watch the real hybrid capstone

The presenter repeats the same mechanics on their screen using an actual
laptop-local DocumentDB and an existing managed Azure DocumentDB instance.
You do **not** enter Azure credentials or follow cloud commands.

Predict what should happen before the presenter switches or copies. The lesson
is the same: **same code, separate data**. Azure supplies a managed environment;
application-level favorite copying is not database replication.

If cloud networking is unavailable, the presenter uses a rehearsed recording.
Your planner and remaining exercises still work. Codespaces itself still needs
internet access. A presenter using Codespaces rather than a laptop must describe
that as self-hosted-to-managed, not on-prem-to-cloud.

## 8. Make changes repeatable

Follow the instructor against **Site A (`local`)**. In the extension, reopen the
**same session `_id`** you inspected in step 2. On an unmigrated notebook, it has
`schemaVersion: 1` and **no** `attendanceMode`. Keep a favorite's `_id`/`savedAt`
visible too. These are actual documents, not canned JSON. Use a narrow projection
as in [the explorer guide](extension.md#browse-query-and-refresh).

Create the repeatable index from the terminal (explicit target):

```sh
docker compose -f compose.yaml exec app npm run indexes -- --target local
```

In Site A's `sessions` Collection View, select **Indexes → Refresh**, then expand
`schedule_order`. Inspect the actual key definition **`{ startsAt: 1, _id: 1 }`**,
including field order, not just its name. This shows a reproducible index exists;
it does not prove that the engine chooses it or that this small catalog is faster.
Do not create a second index through the extension.

Run the versioned migration, then rerun/reopen that session query in the extension:

```sh
docker compose -f compose.yaml exec app npm run migrate -- --target local
```

The **same `_id`** now has `schemaVersion: 2` and `attendanceMode: "in-person"`;
the title and `startsAt` are unchanged. Refresh the favorite query too: its
`savedAt` is unchanged. You observed the CLI's real write through a separate
client. Do not manually edit documents or run a hidden playground migration.

Run the migration again to test idempotency:

```sh
docker compose -f compose.yaml exec app npm run migrate -- --target local
docker compose -f compose.yaml exec app npm run check -- --target local
```

The second migration reports **zero newly migrated records** because only
version-1 records without `attendanceMode` match. If this notebook was migrated
earlier, it will already show version 2 and both runs may report zero. Do not
reset it to recreate a before state. Re-seeding does not undo migration.

**CLI fallback at any checkpoint:** run this before and after the same commands
if the extension is unavailable. It prints one actual projected session, one
favorite and actual index definitions, never credentials:

```sh
docker compose -f compose.yaml exec app npm run inspect -- --target local
```

A null favorite means save one on **this target** first. To repeat on B, use its
extension connection and `--target site-b` in **every** CLI command. Neither the
browser's selected site nor a focused extension tab changes the CLI target.

### Optional extension playground — inspect without writes

After the required checkpoints, right-click the intended **database** under
**Workshop — Site A → your actual database** → **New Query Playground**. Verify
its connection/database **CodeLens** header. Copy the single block from
[inspect.documentdb.js](../exercises/optional/inspect.documentdb.js) into that new
playground, then click the block's **Run** CodeLens. It reads this database's
catalog metadata and at most **five** projected sessions, with a five-second
server query limit. It contains no credentials or writes.

Do **not** run the unbound repository template directly or add `use(...)`.
Version 1.0 playgrounds are bound to the cluster/database where they were created;
they do not have a switch-connection workflow. For B or a custom database name,
create another playground from **that exact database node** and copy the template.
The extension supplies `db`, so no database-name code edit is needed.

Blank lines separate blocks. **Run** executes one block; **Run All** executes the
whole file after confirmation. Variables persist only within Run All, not between
separate block runs. Each supplied template is self-contained. Results include
the connection/database header; check it each time. See the
[official playground guide](https://microsoft.github.io/vscode-documentdb/user-manual/query-playground).
These templates are read-only by code and workshop intent; the credentials are
not a read-only database role. Do not add write stages or export private settings.

### Optional developer challenge — Monday program entries by track

This is an **optional read-only aggregation**, not a third required planner TODO.
It queries the real database, not an in-memory replacement. It counts **published
program entries**, including breaks/registration and shared blocks—not attendees,
seat capacity, or unique speakers. Finish the two required exercises first.

1. In Codespaces, open `exercises/optional/program-counts.js` with Explorer or
   Ctrl/Cmd+P. Replace its deliberate optional exception with an aggregation
   pipeline returned by `programCountsPipeline(catalogVersion)`.
2. Match this catalog and Monday **October 19, 2026 in America/New_York**.
   Group by `track`, count each entry as one, then sort by count descending and
   track ascending to break ties. Return rows shaped `{ _id: <track>, entries: <count> }`.
3. Run on explicit **Site A**, without changing the planner:

   ```sh
   docker compose -f compose.yaml exec app npm run challenge -- --target local
   ```

   Or use `--target site-b` to compare that site's seeded catalog. Azure is not
   accepted by this runner. It permits only read-only stages, limits output to
   30 groups, and uses a five-second server query budget.

<details>
<summary>Hint 1 — Date type and conference timezone</summary>

`startsAt` is a normalized **ISO UTC string**, not a BSON Date. String comparisons
work for these consistently formatted timestamps. Monday's bounds are inclusive
`2026-10-19T04:00:00.000Z` and exclusive `2026-10-20T04:00:00.000Z`
(EDT = UTC−4). Use `$match` with `catalogVersion` and `$gte` / `$lt` on `startsAt`.
Do not use today's date or midnight UTC for a conference-local day.

</details>

<details>
<summary>Hint 2 — Group and count, then order</summary>

Use `{ $group: { _id: "$track", entries: { $sum: 1 } } }`.
In an aggregation expression `"$track"` reads that field; `"track"` would be a
literal string and collapse all entries into one group. Follow with
`{ $sort: { entries: -1, _id: 1 } }`.

</details>

<details>
<summary>Solution and expected result from the checked-in snapshot</summary>

See [the complete pipeline](../examples/complete/program-counts.js), or execute
it without replacing your optional exercise:

```sh
docker compose -f compose.yaml exec app npm run challenge -- --target local --reference
```

For the equivalent **extension** result, create a new playground from the same
explicit database node as above and copy the single self-contained block from
[program-counts.documentdb.js](../exercises/optional/program-counts.documentdb.js).
Click **Run**. It reads the active catalog fingerprint, projects only group/count,
limits to 30 groups and applies a five-second server query budget. It does not
read or print all 216 session documents, change the planner, or write data.

The October 12 snapshot produces **17 track groups totaling 74 Monday entries**.
The first three are `Inclusion & Diversity in Open Source: 10`, `Break: 9`, and
`Open Source Accessibility Summit: 8`. The offline test derives these from the
216-entry snapshot; the live integration test compares every aggregate row with
an independent conference-timezone calculation. Different snapshots must not
silently reuse these expected counts.

</details>

## 9. Take your selections with you

On the site containing your final choices, choose **Download calendar (.ics)**.
Save the `.ics` file when prompted; the helper link below that button returns to
these import steps. Conflicting selections are exported too; warnings inform you
rather than silently choosing for you.

**Google Calendar (web):**

1. Open Google Calendar in your own account. If experimenting, first create a
   separate calendar (Settings → Add calendar → Create new calendar).
2. Open **Settings → Import & export → Import**.
3. Choose **Select file from your computer**, select the downloaded `.ics`, then
   choose the intended **Add to calendar** destination. Check it before importing.
4. Click **Import**, then return to the calendar and inspect the imported events.

**Apple Calendar (macOS):**

1. Open Calendar. For experiments, create a separate calendar with **File → New
   Calendar** and select the account/location you intend to use.
2. Choose **File → Import**, select the downloaded `.ics`, and choose **Import**.
3. In the destination dialog, select that calendar (or create a new one) and
   confirm. Inspect the events in Calendar afterward.

Check the displayed timezone: the workshop starts **October 19, 2026 at 9:00 a.m.
Eastern = 6:00 a.m. Pacific**. The file encodes UTC instants; your calendar may
show them in your own timezone. A shifted display is not automatically a bad
export.

This is a **snapshot, not a live subscription**. A later favorite change or
schedule update does not update an imported calendar. Although event IDs are
stable, calendar clients differ in how they handle repeated imports; do not
promise universal deduplication or update-in-place. Use your own separate test
calendar if experimenting, review it before reimporting, and never import into
a shared/team calendar unintentionally. The workshop makes no Google API writes.

The export contains real titles/dates from the captured schedule. Check the
[official schedule](https://2026.allthingsopen.org/schedule) for changes and
within-block talk ordering. The file is independent of Codespaces and Azure.

Export and preserve code before stopping/deleting the Codespace. Follow
[stop instructions](../README.md#stop-without-losing-your-planner). Do not delete
volumes or `.env` as normal cleanup; retention expiry still removes hosted data.

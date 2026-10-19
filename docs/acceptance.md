# Acceptance record and remaining gates

## Extension-integrated revision — live GUI acceptance

**Core fresh attendee GUI acceptance passed October 18, 2026.** A new two-core
Codespace ran merged source `e294aa6e11286c669fe06fe5d07a9cecb6e73bff` with
DocumentDB for VS Code **1.0.0** installed by the attendee profile. The concurrent
TLS clarification in `fd4fab89c5bc9fd03b1719a61ed0839b8f06d28c` changed guide and
private-handoff wording/tests, not connection URIs or application behavior; it
was not pulled into the running test. This record update changes documentation only.

### Executed proof

- Untouched automatic cold creation/start/seed took **4m57s** in this one run.
  Both independent catalogs contained **216** sessions. No manual startup or
  reseed was used to conceal a lifecycle failure.
- The private handoff used a `700` directory and `600` file, excluded from Git.
  Existing generated credentials were entered only into the normal extension's
  separate native-auth prompts, with the password prompt masked. No connection
  storage injection, credential rotation, Azure sign-in or third-instance wizard.
- Actual saved **Workshop — Site A** and **Workshop — Site B** connection trees
  expanded to the database and collections. Both session JSON views were queried
  by actual `_id`; Site A catalog metadata was also queried in the GUI.
- **Allow invalid certificates** worked for both loopback connections. Extension
  1.0.0 displayed the misleading **TLS/SSL Disabled** warning; the supplied URI
  retained `tls=true` and the installed native-auth code applied the local
  certificate-validation exception. See the [local TLS note](extension.md#connect-the-two-existing-sites-privately).
- Sequential TODO completion produced the catalog, then saved two overlapping
  Monday favorites. Actual extension JSON displayed their `_id` and `savedAt`.
  Site B initially had the catalog but no favorites.
- The **app's** selected copy produced **2 Copied**, then **2 Already present**.
  Actual Site B JSON refresh showed unchanged destination timestamps on retry.
  A new Tuesday favorite copied back; Site A's actual JSON showed **three**.
- The same session's GUI JSON changed from **version 1 / no attendanceMode** to
  **version 2 / in-person** after the explicit CLI migration; title and times were
  unchanged. Favorites JSON was byte-identical before/after. Migration: **216 → 0**.
- Actual **Indexes** view was refreshed and `schedule_order` expanded to show
  **startsAt ascending, then _id ascending**, not just an index name.
- Both database-created, **prebound** playgrounds executed the exact committed
  templates through their Run controls: **5-document inspection** and **17 groups /
  74 Monday entries**, leading counts **10 / 9 / 8**. Results came from actual
  extension result panels, not replacement CLI queries.
- Actual browser calendar download contained **three events** with verified
  identifiers, titles and UTC times. App restart retained **216 / 3 / 1 overlap**.
- Codespace Linux tests: **58/58 passed**; **61 documentation links** passed;
  real database integration **2/2 passed**. Both published loopback TLS/auth reads
  and counterpart credential-denial checks passed.
- Both CLI and editor Ports UI showed only **3000 / Private** forwarded. Database
  endpoints were loopback-bound on **10270 / 10271**, not web-forwarded.
- Only the owned test Codespace was stopped; authoritative **Shutdown** was
  verified. Its solved files, notebooks and saved connections were retained with
  a 24-hour retention setting. The user's active Codespace was not modified.

### Experience and precision limits

Seeing an app save appear as actual favorite JSON, then comparing Site B before
and after an explicit copy, made **same code, separate data** concrete. Connection
setup was the most difficult part: repeated prompts, a certificate-validation
choice that is wrong for this local setup by default, and contradictory warning
wording afterward. The local TLS clarification addresses that observed friction.
Collection tabs use short database/collection names, so open them from the correct
site's tree. Verify the connection header when creating each playground.

Application and extension actions used a real browser; code edits and documented
commands used CLI assistance. Monaco focus/clipboard handling and clipped
accessibility snapshots added automation overhead. This was not a novice timing
study or a timed 105-minute class.

Project/Sort form controls were not each tested separately (the actual inspection
playground exercised projection/sort). Site B metadata's collection was expanded,
but its metadata JSON was not separately reopened. Custom-database-name playground
GUI behavior, every manual connection-update variation, and Apple Calendar import
were not tested here. The isolated reconnect harness was **not rerun in this fresh
GUI session**; separate local and CI reconnect checks passed on this implementation.
No new Azure or calendar-import test is claimed from this run.

## Executed evidence before the reconnect / attendee-polish revision

Recorded October 17, 2026 against the preceding main source
`e6eae569f0879ea59656c847db6c13a1dee0b7d1` (or tree-identical rehearsal source):

- **Fresh two-core attendee Codespace:** cold creation to both Site A/B catalogs
  ready took **4 minutes 47 seconds** in that run. The actual Site A/B acceptance
  checklist passed **34/34**, plus the live database integration test. This is
  one measured environment, not a promised startup time for every account/network.
- **Attendee revisit:** the same Codespace was stopped/restarted and the two
  starter exercises were completed again with new notebook database names.
  Browsing, favorites, restart persistence, connection-only switching, selected
  copying in both directions, safe repeat, migration and calendar download worked.
  Editor focus required terminal assistance for the code replacements: not a
  novice usability study or an entirely mouse-and-keyboard editing rehearsal.
- **Google Calendar web:** an actual downloaded calendar was imported through the
  UI, **3/3 events**, with titles, timezones, UIDs, locations and Unicode checked.
  No claim of Apple Calendar UI acceptance or universal repeat-import behavior.
- **Managed Azure data plane:** actual local **Mac mini workstation → managed
  Azure DocumentDB** seed/switch/copy/retry/copy-back passed. The temporary cloud
  resource used for that authorized test was cleaned up. This is real local-to-
  managed evidence, not a conference-laptop/network rehearsal or an instruction
  to provision attendee resources. Normal delivery still uses an approved
  existing presenter resource and narrow access.

No account emails, private Codespace identifiers, subscription IDs, connection
strings or credentials are needed in this public record.

## Defect found during acceptance, and this revision's scope

The preceding source had a confirmed first-connection recovery defect with the
pinned MongoDB Node.js driver 7.1.0: if a cached client's first lazy connection
failed, later lazy commands could see a closed topology even after the database
was healthy. A previously connected client recovered from an ordinary outage.
The prior success record must **not** be read as proof of first-failure recovery;
restarting the app was then a workaround.

This revision explicitly awaits the driver's public `connect()` on every async
connection acquisition. The readiness CLI reacquires **inside** its retry loop.
It does not replay writes, change TLS policy, silently fall back to another site,
or replace credentials/volumes. Shutdown rejects new/racing acquisitions and
closes pools after pending connects settle.

New offline tests cover connection lifecycles, concurrent acquisition, bounded
wait retries, exercise guidance, bounded document inspection and the optional
query's snapshot-derived expected result. The live regression command below
checks first-use failure, the original waiting CLI process, concurrent clients,
a healthy-client outage control, unchanged favorite digests, and the **same app
PID** across recovery. A test added to source is not an executed live result.

## Executed reconnect / attendee-polish acceptance

Recorded October 17, 2026. The same attendee Codespace was restarted and rebuilt
from `8993fac38709a5d6cdece1f8170ffe9392111d14`, then fast-forwarded to
`a3f9c5aeb16f8350b3ece7ca74887987ddc94824` for the harness-only cleanup update.
That update changed no application/UI code; the final record update is docs-only.
Earlier notebooks, credentials, volumes and solved exercises were preserved with
private backups and separate fresh notebook database names.

- Final repository-root tests in Codespaces: **47/47 passed**, no skips;
  **46 local documentation links** checked.
- Actual two-server database integration: **2/2 passed**, including the optional
  official-catalog aggregation.
- Browser flow: blue Exercise 1, edit the first TODO, 216 entries, blue Exercise 2,
  save overlapping favorites, persistence, initially empty Site B, two records
  copied, repeat Already present, and a third favorite copied back. Complete-
  reference switching preserved both solved files and notebook timestamps.
- **Main-app cold-connection regression:** Site B was stopped before that app
  process ever acquired it. The browser switch failed with a genuine 503 and
  stayed on Site A. After starting only Site B, the same browser retry succeeded
  with the **same server PID, start time, container and request-token hash**.
  No app restart or code edit was needed to recover.
- The isolated live harness independently proved recovery of the **original
  waiting CLI process**, concurrent first acquisitions and a previously healthy
  client. All scoped cleanup receipts passed.
- Interruption regressions: **2/2 passed** in Codespaces, including repeated
  SIGINT/SIGTERM during cleanup and independent empty resource inventories.
- Actual document inspection showed the same session change from version 1 with
  no attendanceMode to version 2/in-person. Migration changed **216 then 0**;
  the favorite timestamp was unchanged. The optional solved database aggregation
  returned **17 groups / 74 Monday entries**, matching the reference.
- Actual browser calendar download contained **three events**, validated against
  the real state. This revision did not repeat the earlier Google Calendar import
  or managed Azure test; calendar serialization and transfer semantics are unchanged.
- Resume to first SSH was about **39 seconds**; the explicit revised-code
  build/start/seed took **27 seconds**, measured separately. Neither is a fresh
  cold-creation measurement or a promised attendee timing.
- The exact Codespace was stopped and its **Shutdown** state verified; notebooks
  and solved work remain retained. No new Azure resources were used in this retest.

Application actions and dialogs used a real browser; code edits used the
Codespaces CLI after locating the editable files. This is expert-assisted
acceptance, not a novice or timed classroom study. During premerge testing,
canonical main guide links still served the previous guide, so the trusted
branch guide was used; the docs and app are published together.

## How to verify the revision

Offline, from the repository root with Node 24.13+:

```sh
npm ci --ignore-scripts
npm test
npm run test:docs
```

On an already authorized attendee stack rebuilt from this source:

```sh
docker compose -f compose.yaml exec -T app npm run test:database
```

The integration test creates/drops only uniquely named owned temporary databases
on the two self-hosted servers; it does not select cloud. Rebuild the app image
when scripts/tests/package metadata change; source bind mounts alone do not
update those copied image files.

For the destructive-outage regression, **do not stop an attendee's databases**.
Run this from the repository root on a Docker host (including a disposable
Codespace terminal), not inside the app container:

```sh
npm run test:reconnect
```

Requires Docker Compose **2.24.4+** for its port override. It creates a fresh random
`ato-reconnect-*` project, private temporary `.env`, independent volumes and a
random **loopback-only** app port. The override removes both database port
mappings, so parallel harness projects never reserve the attendee extension
ports. It ignores ambient workshop credentials and
never adopts an existing project. It stops/starts only its Site B, captures
sanitized pass/fail receipts, and removes **only its own ephemeral project and
volumes** through a single idempotent cleanup path. **SIGINT / SIGTERM** abort
in-flight HTTP requests and probe waits, cancel child commands (with a five-second
force-termination grace), and enter that same cleanup path with a nonzero exit.
Repeated signals do not cancel cleanup. Its Compose deadline is 120 seconds;
each resource-inventory check has a 15-second deadline (plus termination grace).
The private directory is removed only after successful `down` and independent
empty inventories for the project's **containers, volumes and networks**.

Normal notebooks and `.env` are untouched. If cleanup or verification fails,
the process exits nonzero and retains its private configuration, printing only
the generated project name/private directory for manual review; it does not run
a global prune or claim success. SIGKILL, machine loss, or an unreachable Docker
daemon cannot guarantee cleanup. CI runs the normal regression as a separate
ephemeral job. The application runs directly without file watching in this
harness so checking its PID really establishes no app restart.

Opt-in interruption regression (Docker host, separate from the offline suite):

```sh
node --test test/reconnect-interruption.integration.js
```

This creates two fresh owned projects sequentially, sends SIGTERM and SIGINT
respectively after startup, repeats each signal during cleanup, and independently
checks nonzero handled exits, absent containers/volumes/networks, and removal of
only each run's private temporary directory. It does not stop an existing stack.

**Harness-only proof, October 17:** after adding handled-signal cleanup, the
normal live reconnect regression passed all five recovery/cleanup checks. The
real interruption test passed both SIGTERM (exit 143) and SIGINT (exit 130),
including repeated signals during cleanup. Independent filtered inventories
confirmed zero owned containers, volumes and networks and absent private
configuration directories for all three runs. These harness results do not
constitute another Codespace, browser, calendar or Azure acceptance run.

Then reopen/restart the actual attendee Codespace and follow [the lab](lab.md):
verify the friendly first screen, edit TODO 1, save TODO 2, inspect before/after,
optional query, Site A/B copying and calendar helper links in a real browser.
Offline UI mocks are not a rendered-browser acceptance test.

## Still unverified delivery gates

- A brand-new cold Codespace on this revision (the executed polish test restarted
  the existing Codespace; the earlier 4m47s cold result remains scoped above).
- Fresh Organizer-profile acceptance (not required for attendees).
- Representative attendee accounts, quotas, resource needs, and conference
  laptop/Wi-Fi networking; one two-core Codespace measurement is not capacity proof.
- Full **105-minute human classroom rehearsal**, including pairing fallback,
  editing fluency, export and safe stopping.
- Approved existing-resource presenter rehearsal on the actual conference laptop
  and network, and a verified backup recording.
- Apple Calendar GUI import and client-specific repeated-import handling.

The default attendee path remains Site A/B only. It never requires Azure,
Kubernetes, a laptop Docker installation, or automatic calendar API access.

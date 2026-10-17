# Acceptance record and remaining gates

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
random **loopback-only** app port. It ignores ambient workshop credentials and
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

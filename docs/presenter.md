# Presenter-only: actual laptop to managed Azure

This optional 15-minute capstone uses **one existing, authorized Azure DocumentDB
instance**. It does not provision a cluster, create cloud subscriptions, install
Kubernetes, or grant permissions. Attendees never receive the connection string
and do not execute this runbook. Their Site A/B lab works independently.

**Acceptance status:** a prior local Mac mini → managed Azure round trip passed,
as scoped in the [acceptance record](acceptance.md). That does not prove the
extension-integrated revision or conference laptop/network. Rehearse this path
on the actual laptop and approved Azure endpoint; local tests and successful
infrastructure deployment are not proof.
Keep a verified recording for conference-network failure. Do not claim a live
cloud result from a recording or the two-container simulation.

## 1. Approve the scope and prepare privately

- Confirm the existing cluster, dedicated demo database name, data-plane user,
  permitted writes, network clients, timeframe and cleanup owner.
- Never seed into a shared application database. Use a fresh approved demo
  database to make “no favorites yet” true; don't erase existing favorites.
- Use the service's approved connection URI with validated TLS. Keep it in your
  private `.env`, never in source code, terminal history, chat, screenshots, or
  slides. No administrator credential distribution or Azure login sharing.
- Verify DNS/SRV, current laptop egress IP and the existing approved firewall
  route. An old IP entry may be stale. Follow the resource owner's access process;
  do not open the whole internet or disable TLS to make the demonstration work.
- Azure usage/retention policies still apply to an existing resource. Stopping the
  local app does not stop charges or delete anything in Azure.

For a genuine laptop/cloud demonstration, use Docker already working **on your
laptop** and the [local appendix](local.md). A Codespace is not on-prem: if you use
one, clearly describe self-hosted-to-managed portability instead of hybrid on-prem.

Prefer a separate presenter checkout/Compose project from your attendee notebook,
so rehearsal does not mix personal favorites. A new project gets new local volumes;
it does not migrate an existing notebook. Record the project name and keep using it.
Do not switch names as a recovery shortcut.

## 2. Prepare local databases, then opt in to the presenter scenario

In the presenter checkout, generate private local credentials (no host Node needed):

```sh
docker compose -f compose.setup.yaml run --rm setup
```

Edit `.env` privately:

```dotenv
WORKSHOP_LOCATION=laptop
ACTIVE_TARGET=local
CLOUD_DOCUMENTDB_URI=<existing-approved-Azure-connection-URI>
CLOUD_DATABASE_NAME=<dedicated-approved-demo-database>
```

Do not put those placeholders into a real runnable configuration. Do not change
`DOCUMENTDB_PASSWORD` for an existing local volume: `.env` editing is not password
rotation. Setup adds missing Site B settings without replacing the old notebook.

Start the complete reference with the explicit presenter override:

```sh
docker compose -f compose.yaml -f compose.presenter.yaml -f compose.complete.yaml up --build -d --wait --wait-timeout 240
```

This changes the app's target pair to **local / cloud**. Site B is not in the UI;
the unused local Site B container may still be running because the shared Compose
stack preserves the attendee environment. It does not copy or synchronize anything.
The app starts at `ACTIVE_TARGET` (keep `local` for the rehearsal).

Opening presenter mode does not seed Azure. The app normally touches Azure only
when you explicitly switch/copy or run a target-specific command. Keep
`ACTIVE_TARGET=local` to avoid cloud health checks on app startup.

Wait for and seed the local catalog:

```sh
docker compose -f compose.yaml -f compose.presenter.yaml -f compose.complete.yaml exec app npm run wait:database -- --target local
docker compose -f compose.yaml -f compose.presenter.yaml -f compose.complete.yaml exec app npm run seed -- --target local
```

After verifying the URI/database are the approved target, explicitly seed **the
catalog only** into Azure:

```sh
docker compose -f compose.yaml -f compose.presenter.yaml -f compose.complete.yaml exec app npm run seed -- --target cloud
docker compose -f compose.yaml -f compose.presenter.yaml -f compose.complete.yaml exec app npm run check -- --target cloud
```

Expect the same catalog and **zero favorites in a fresh demo database**. A catalog
mismatch is a stop-and-review condition, not permission to delete or overwrite.
If you reuse a previously demonstrated database, favorites will still be there;
choose a new approved database for the missing-favorites lesson.

Open **http://localhost:3000** (or the privately configured `WORKSHOP_PORT`).
Verify **Complete reference**, **DocumentDB on this laptop**, and exactly the
local/Azure target pair. Do not show `.env` or raw connection errors on screen.

### Optional presenter-only extension view

The attendee extension Connections tree contains only their own **Site A/B**;
attendees need no Azure subscription, login or credential. The private handoff
helper deliberately never exports `CLOUD_DOCUMENTDB_URI`.

If already authorized and rehearsed, the presenter may separately attach the
approved Azure database in their **own** extension and inspect its catalog and
favorites beside the laptop connection. Enter cloud credentials privately through
the service's supported authentication flow; the connection-string field is not
a safe place to project secrets. Use a clear presenter-only label, close private
configuration, and verify the actual database before screen sharing. **Keep
validated TLS and hostname validation enabled for Azure.** Never apply the
loopback self-signed certificate exception to cloud or disable global TLS.

This optional visual observation uses the existing 15-minute capstone allocation,
not extra classroom time. Perform transfers with the **app's selected favorite
copy**, never extension **Copy Collection**. Saved Connections expose databases;
they do not change Compose container ownership. If extension/cloud networking
is blocked, use the rehearsed recording rather than changing attendee setup.

## 3. Rehearse the 15-minute story

1. **0–2 min: identify the boundary.** Laptop runs app + self-hosted DocumentDB;
   the other target is managed Azure. Same MongoDB-driver repository methods.
2. **2–5 min: switch without moving data.** Save two local favorites. Switch to
   **Azure DocumentDB (presenter)**: same catalog, no copied favorites. Ask where
   the originals are; switch back and show them intact.
3. **5–9 min: copy explicitly.** With laptop target active, select favorites and
   confirm laptop → Azure. Switch to verify. **Switch back to laptop before
   repeating the same copy direction**: expect Already present.
4. **9–12 min: bring one back.** Save a new favorite in Azure. Select it and confirm
   Azure → laptop. Switch back: original choices survive and the new one is added.
5. **12–15 min: explain and return to attendees.** Application compatibility does
   not move data. This app copies selected records; it is not streaming replication,
   sync, conflict resolution, failover or proof of every MongoDB feature. Let
   attendees finish their own calendar export.

If any cloud operation fails, show the active-target label and sanitized error,
then move to the checked recording. Do not debug firewall rules or credentials
on the projector. Recordings must demonstrate the actual topology and be labeled
as recordings. The hands-on Site A/B lesson remains complete.

## 4. Configuration changes and switching modes

After editing cloud fields, **recreate**, not merely restart, the presenter app:

```sh
docker compose -f compose.yaml -f compose.presenter.yaml -f compose.complete.yaml up -d --wait --wait-timeout 240 app
```

Refresh the browser for the new request token. To demonstrate completed attendee
exercise code rather than the reference, omit `-f compose.complete.yaml` while
retaining `-f compose.presenter.yaml`.

To return to the complete-reference **Site A / Site B simulation**:

```sh
docker compose -f compose.yaml -f compose.complete.yaml up -d --wait --wait-timeout 240 app
docker compose -f compose.yaml exec app npm run wait:database -- --target site-b
docker compose -f compose.yaml exec app npm run seed -- --target site-b
```

Or run `npm run workspace:start` from an environment with Node installed: it
selects attendee mode explicitly and seeds both sites. Default attendee Compose
does not pass cloud settings into the app. Neither mode switch moves favorites.

## 5. Shutdown and data ownership

Export the intended notebook first. Stop only this local Compose project:

```sh
docker compose -f compose.yaml -f compose.presenter.yaml -f compose.complete.yaml stop
```

Keep local volumes and private configuration for rehearsal continuity. Do not use
volume deletion or `.env` replacement as normal stopping. Revoke demo access or
remove the dedicated demo database only under the resource owner's approved
policy. **Do not delete the existing shared Azure cluster/resource group.**
No cloud deletion command is included here; this runbook does not create resources.

## Optional Kubernetes follow-up

The [DocumentDB operator](https://github.com/documentdb/documentdb-kubernetes-operator)
has local Kubernetes and AKS/EKS/GKE deployment paths, plus multi-cloud replication
and promotion documentation. This is a separate operations demonstration with
its own version, networking, storage, permissions and failure-mode rehearsal.
It does not remove cloud-account costs or establish automatic replication between
OSS DocumentDB and managed Azure DocumentDB. Keep it off this workshop's critical path.

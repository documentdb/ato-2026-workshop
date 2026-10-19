# DocumentDB explorer: the lab's second view

Use the official **DocumentDB for VS Code** extension
[`ms-azuretools.vscode-documentdb`](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-documentdb),
with the **1.0.0** UI described here. Both Codespaces profiles preinstall it.
It is the required visual database explorer throughout the lab, not a separate
Azure demo. Your two TODOs still implement real MongoDB-driver application code;
connecting an editor does not implement them or switch the app's target.

## Connect the two existing sites privately

Wait for workshop setup to finish. Run in the **Codespaces terminal**, not inside
`app` and not on your laptop:

```sh
npm run extension:connections
```

This reads the existing `.env` as data and generates
`.workshop-private/extension-connections.txt`. It prints only the path, labels,
ports and database names, never a URI or credential. The directory is mode `700`
and the file `600`; both Git and Docker exclude it. Re-running atomically updates
only this helper's generated file, never `.env`, database users or volumes.
It exports **only local** settings, even if an old `.env` contains Azure settings.

1. Open that private file with **Ctrl/Cmd+P** in the Codespaces editor. Do not use
   `cat`, put it in a screenshot, commit it, sync it, or share your screen while it
   is visible. There are separate **Site A / Site B** sections, including your
   actual database names (which may differ from `ato_workshop`).
2. Open the Command Palette (**F1**) and select **DocumentDB: New Connection…**,
   then **Connection String**. This attaches an existing database. Do **not** use
   **Set Up Local**: Compose already owns two instances; that wizard would create
   an unrelated third one. No Azure sign-in or subscription is wanted.
3. From the Site A section, copy **only the credential-free connection string**
   into the URI input. That field is **not masked**. Never paste a password-bearing
   URI there. The generated URI points to `127.0.0.1`, selects your database, and
   specifies TLS, `SCRAM-SHA-256`, `authSource=admin` and `directConnection=true`.
4. **In the local TLS prompt, select “Allow invalid certificates” for BOTH
   Workshop — Site A and Workshop — Site B. Do not leave “Enable TLS (default)”
   selected for these workshop connections.** The default validates certificates
   and rejects the development server's self-signed certificate with the error
   **“self-signed certificate.”** Keep `tls=true` in the generated URI: encryption
   stays **on**; only certificate validation is relaxed for these specific
   `127.0.0.1` development connections. Never apply this exception to Azure or
   another remote service.

   > **DocumentDB for VS Code 1.0.0 label caveat:** after this choice, the tree or
   > dashboard may display **“⚠ TLS/SSL Disabled.”** That wording is misleading
   > for this exact workshop configuration: the supplied URI still has `tls=true`,
   > and the extension applies `tlsAllowInvalidCertificates=true` rather than
   > disabling encryption. Both local connections were exercised successfully
   > with this choice in the attendee test. This is not an instruction to set
   > `tls=false`, disable TLS globally, or change your database password.
5. If asked for an authentication method, choose **Username and Password**
   (native authentication). Enter the section's username and paste its password only
   into the **masked password prompt**. Do not select Microsoft Entra/Azure login.
6. In the extension's **Connections** tree, the new connection may initially be
   named by host/port. Right-click it → **Rename Connection**, and name it
   **Workshop — Site A**. Repeat steps 2–6 with Site B's own values and name it
   **Workshop — Site B**. These are separate credentials, not interchangeable.
7. Close the private file before sharing your screen. Expand each connection and
   the database named in your private instructions. Do not browse `admin` or
   another application's database. An empty `favorites` collection may not exist
   until the first save; that is normal.

Expected **saved Connections** tree (use your custom database names if applicable):

```text
Workshop — Site A
  ato_workshop
    sessions
    workshop_meta
    favorites       (appears after the first save)
Workshop — Site B
  ato_workshop
    sessions
    workshop_meta
    favorites       (appears after a save/copy into B)
```

These connections make the two databases visible for exploration. They do **not**
adopt Compose containers into the extension's managed **Local** instances list:
that list owns only instances created by its own setup workflow. Use this
checkout's Compose commands (or a separately installed Container Tools view) for
container lifecycle, and DocumentDB **Connections** for data. Never create fake
extension ownership records or run a third-database wizard to make a list appear.

The connection flow is based on the extension's public
[connection-string step](https://github.com/microsoft/vscode-documentdb/blob/main/src/commands/newConnection/PromptConnectionStringStep.ts),
[local TLS choice](https://github.com/microsoft/vscode-documentdb/blob/main/src/commands/newConnection/PromptTlsExceptionStep.ts),
and [authentication labels](https://github.com/microsoft/vscode-documentdb/blob/main/src/documentdb/auth/AuthMethod.ts).
The exact fresh-Codespace GUI acceptance is tracked separately in
[the acceptance record](acceptance.md#extension-integrated-revision--live-gui-acceptance).

The helper supports generated settings and ordinary single/double-quoted legacy
values. It rejects duplicate bindings, interpolation, multiline values and
ambiguous quoting rather than guessing. If it fails, have a helper review `.env`
**privately**; never source it as a shell script or regenerate credentials for an
existing volume. The workshop does not store connection strings in committed
VS Code settings, create credential-bearing deep links, or automate SecretStorage.
The extension itself retains the connection you deliberately add: use your own
Codespace/editor account, not a shared authenticated environment.

## Why these ports are not web links

In Codespaces the extension runs remotely in the **outer development container**.
The databases are inside its Docker-in-Docker Compose network. The extension uses
these loopback-only published endpoints:

- Site A: `127.0.0.1:10270` → `documentdb:10260`.
- Site B: `127.0.0.1:10271` → `documentdb-site-b:10260`.

The app still uses Compose DNS on port `10260`; do not replace its hostnames with
these editor endpoints. Your laptop's localhost is not the Codespace's localhost.
Never open database ports in a browser or forward them, publicly **or privately**.
Both dev-container profiles ignore automatic forwarding for `10270`/`10271` and
all other unlisted ports, including custom database ports. Only app port `3000`
is explicitly forwarded, with **Private** visibility. Do not alter that policy.

If a port is occupied, Compose reports a bind/port-allocation error. Do not kill
another process or stack. In this checkout's private `.env`, choose two distinct
unused ports using `SITE_A_EXTENSION_PORT` and `SITE_B_EXTENSION_PORT`; defaults
are `10270` and `10271`. Do not export conflicting shell overrides. Reapply only
this same Compose project (the same directory/project name and volumes):

```sh
docker compose -f compose.yaml up -d --wait --wait-timeout 240
npm run extension:connections
```

Use the complete/presenter override as well if that is your intentional mode.
Reconnect the extension using the regenerated instructions. Never change database
credentials, delete volumes, or change projects to repair a port collision.

A helper can test both published endpoints, TLS and independent authentication,
without printing secrets or changing data:

```sh
npm run extension:check
```

This runs from the outer Codespace/host where the extension runs. It verifies a
bounded authenticated catalog read and rejects the other site's credentials on
each endpoint. It is **not** proof that the extension GUI connected successfully.

## Browse, query and refresh

Expand a collection and double-click its **Documents** child, or use the
collection's **leftmost inline icon** to open **Collection View**. Use the
**Filter**, **Project**, and **Sort** editors and the JSON document view. The
[official collection-query guide](https://microsoft.github.io/vscode-documentdb/user-manual/collection-view-querying)
describes these controls.

- Read `workshop_meta` with Filter `{ _id: "catalog" }`: note its `fingerprint`
  and `ready: true`. This identifies the current seeded catalog.
- Open `sessions`; filter `{ catalogVersion: "<the fingerprint you just read>" }`,
  project `{ _id: 1, title: 1, startsAt: 1, catalogVersion: 1, schemaVersion: 1, attendanceMode: 1 }`,
  and sort `{ startsAt: 1, _id: 1 }`. Inspect one JSON document, not all 216. The
  placeholder means **replace it with your actual value**, not a literal query.
- Keep that session `_id`. Filter `{ _id: "<your actual session id>" }` to compare
  the same record after migration. `startsAt` is an ISO UTC **string**, not a BSON
  Date. `catalogVersion` is the fingerprint, not the human-readable version label.
- For favorites, filter a saved session's `_id`, project `{ _id: 1, savedAt: 1 }`.
  If the collection is newly created, refresh the **Connections** tree first.
- After an app save/copy or CLI migration, **rerun the query**. If the open view
  still shows old results, close it and reopen **Documents** from that exact
  site's collection, then reapply the filter. A tree refresh alone is not proof
  that an already-open result view fetched new data.
- In the `sessions` Collection View, open **Indexes**, select **Refresh**, and
  expand `schedule_order` to inspect the actual ordered keys after the CLI creates
  it. See the [official index guide](https://microsoft.github.io/vscode-documentdb/user-manual/collection-view-index-management).

Treat the catalog as **read-only by workshop intent**, not enforced permissions:
these development credentials can write. Do not edit/delete catalog JSON, rename
collections, drop indexes, or use extension **Copy Collection**. The app's
**Copy selected favorites** performs selected, catalog-validated, additive upserts
with per-record outcomes and destination first-save timestamps. A generic
collection copy is a different operation and would defeat the exercise.

## If the visual explorer is blocked

Tell a helper; continue the core driver/copy lab with its existing CLI inspection
fallback rather than spending the workshop on editor troubleshooting:

```sh
docker compose -f compose.yaml exec app npm run inspect -- --target local
docker compose -f compose.yaml exec app npm run inspect -- --target site-b
```

`inspect` returns one actual projected session, one favorite and actual index
definitions without credentials. The CLI target is always explicit; neither the
app's selected target nor a focused extension tab chooses it. A successful CLI
inspection is fallback evidence, **not** a claimed extension acceptance pass.

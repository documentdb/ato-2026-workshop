# Optional laptop-local setup

The attendee workshop is browser-first. Use this appendix only if Docker already
works on your laptop; do not spend the timed workshop installing/repairing it.
You need Docker with Linux containers, Docker Compose, a browser, and VS Code
with the official `ms-azuretools.vscode-documentdb` extension (guide: version 1.0.0).
No host Node.js, Azure CLI or Kubernetes installation is required.

Download/extract or clone the repository and open a terminal in its directory.
Use a consistent directory and Compose project name to keep the same volumes.

```sh
docker compose -f compose.setup.yaml run --rm setup
docker compose -f compose.yaml up --build -d --wait --wait-timeout 240
docker compose -f compose.yaml exec app npm run wait:database -- --target local
docker compose -f compose.yaml exec app npm run wait:database -- --target site-b
docker compose -f compose.yaml exec app npm run seed -- --target local
docker compose -f compose.yaml exec app npm run seed -- --target site-b
```

Stop at any failing command, diagnose it, then retry; do not skip readiness or
pretend the second site is available. These commands access only local sites.

Open **http://localhost:3000**. The starter shows a blue **Exercise 1** checkpoint until
the first exercise is complete. Follow the [lab](lab.md); here both independent
sites run on your physical laptop rather than inside Codespaces. It is still a
two-site simulation, not two physical sites or cloud providers.

Setup creates independent private credentials. For an old `.env`, it preserves
all old values and appends only missing Site B settings. It refuses partial/empty
Site B credentials rather than guessing about an existing volume. Neither database
is publicly exposed: Site A publishes **127.0.0.1:10270**, Site B
**127.0.0.1:10271**, and the app binds to loopback. The VS Code extension on this
laptop connects to those two distinct host ports; the app still uses Compose DNS.
Do not forward or expose database ports. See [port-conflict recovery](extension.md#why-these-ports-are-not-web-links).

### Show both sites in DocumentDB for VS Code

If host Node.js 24 is available, run `npm run extension:connections`. Otherwise
on macOS/Linux, use the already-downloaded setup container under your own UID/GID:

```sh
docker compose -f compose.setup.yaml run --rm --user "$(id -u):$(id -g)" setup node scripts/extension-connections.mjs
```

This only reads your existing `.env` and writes the owner-only, Git/Docker-ignored
`.workshop-private/extension-connections.txt`; it does not create or change users.
Open it privately in **local VS Code** and follow the
[existing-connection steps](extension.md#connect-the-two-existing-sites-privately):
credential-free URI in the unmasked field, native username/password in their
separate prompts, local-only self-signed certificate exception with TLS still on.
Save **Workshop — Site A/B** in **Connections**, expand your database names, and
close the private file before sharing. Do not use **Set Up Local** (third database)
or expect Compose containers to be adopted into the extension-managed Local list.
On a platform without the shell UID/GID commands, use host Node or ask a helper;
do not loosen file permissions as a workaround. The CLI `inspect` fallback in
[the lab](lab.md#8-make-changes-repeatable) remains available without host Node.

On a network requiring an approved anonymous npm mirror, set `NPM_REGISTRY` in
your private `.env`. Never put tokens/passwords in build arguments or disable TLS.

Site A retains the original `documentdb-data` volume; Site B has its own
`documentdb-site-b-data` volume. The
[existing-notebook instructions](../README.md#existing-notebook-or-older-practice-version)
preserve older practice data. Switching starter/reference does not reset either.

To stop without deleting notebooks:

```sh
docker compose -f compose.yaml stop
```

After dependencies/images are downloaded and startup completes, the self-hosted
app/databases can operate without internet. Official schedule links still need
connectivity. This is not an offline promise for Codespaces.

For the **presenter-only** actual laptop/Azure capstone, follow the
[separate runbook](presenter.md) and explicit presenter override. The normal
attendee commands do not enable Azure even when cloud settings exist in `.env`.

# Optional laptop-local setup

The attendee workshop is browser-first. Use this appendix only if Docker already
works on your laptop; do not spend the timed workshop installing/repairing it.
You need Docker with Linux containers, Docker Compose, a browser and text editor.
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

Open **http://localhost:3000**. The starter reports `TODO_LIST_SESSIONS` until
the first exercise is complete. Follow the [lab](lab.md); here both independent
sites run on your physical laptop rather than inside Codespaces. It is still a
two-site simulation, not two physical sites or cloud providers.

Setup creates independent private credentials. For an old `.env`, it preserves
all old values and appends only missing Site B settings. It refuses partial/empty
Site B credentials rather than guessing about an existing volume. Neither database
publishes a host port; the app binds to loopback. Do not expose them publicly.

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

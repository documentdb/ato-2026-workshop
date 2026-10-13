# Optional laptop-local setup

The workshop is browser-first. Use this appendix only if you already have Docker
working and prefer a physical-laptop environment; do not spend the timed workshop
installing or repairing Docker.

You need Docker with Linux containers, Docker Compose, a browser, and a text
editor. No host Node.js installation is required. Download/extract the repository
ZIP or clone it, then open a terminal in the project directory.

```sh
docker compose -f compose.setup.yaml run --rm setup
docker compose up --build -d --wait --wait-timeout 240
docker compose exec app npm run seed -- --target local
```

Open **http://localhost:3000**. The starter intentionally reports
`TODO_LIST_SESSIONS` until you finish the first exercise. Continue with the
[attendee guide](lab.md), interpreting its development target as your local
container instead of a container inside Codespaces.

Setup creates private local credentials in `.env` and never replaces an existing
file. The database has no published host port; the app is bound to loopback.
Do not expose either publicly.

On a network requiring an approved anonymous npm mirror, put its URL in
`NPM_REGISTRY` in your private `.env`. Never include a token/password in a build
argument or disable TLS verification.

Your development data persists in the named Docker volume. The
[practice-to-official catalog instructions](../README.md#already-ran-the-practice-version)
preserve an older notebook. Changing code variants does not reset the volume.

To stop without deleting your notebook:

```sh
docker compose stop
```

Once setup and image downloads finish, the app and development database can run
without internet access. Azure connectivity still needs a network connection.
This optional behavior is not an offline promise for the Codespaces-first workshop.

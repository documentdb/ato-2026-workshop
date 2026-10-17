# Workshop delivery plan

**Direction: subscription-free attendee lab; existing-resource presenter capstone.**
No new Azure deployment is required for the selected workshop. The organizer has
an existing Azure DocumentDB instance available for a presenter-only demonstration.
A previous local Mac mini → managed Azure round trip passed; this does not
prove the delivery revision on the conference laptop/network.

## Mandatory attendee path

- Browser + GitHub account + available Codespaces usage/connectivity.
- Two independent OSS DocumentDB containers, credentials and named volumes:
  Site A / Site B. The old `documentdb-data` volume remains Site A.
- Same two MongoDB-driver TODOs/reference, explicit connection switching,
  selected-favorite copying, repeatable retry, return trip, calendar export.
- Site simulation, not actual on-prem/cloud topology, replication or failover.
- No Azure credentials, Azure management login, new subscriptions or Kubernetes.
- Base Compose excludes cloud settings even from a legacy `.env`; bounded startup
  waits for and seeds both local sites, stopping on failure.
- Setup preserves existing notebook configuration and appends only absent Site B
  fields. Partial credentials or incompatible catalog remnants fail for review.

## Presenter-only cloud path

Use [docs/presenter.md](../docs/presenter.md), a physical laptop running the app
and local DocumentDB, and one existing approved managed Azure DocumentDB endpoint.
A dedicated authorized demo database prevents mixing workshop and shared app data.
`compose.presenter.yaml` explicitly selects local/cloud targets instead of Site A/B.
It neither provisions nor automatically seeds Azure. Attendees receive no credentials.

The proof is selected same-driver operations and explicit application-level
copy-out/back, not streaming replication or full MongoDB/operational parity.
Codespaces-to-Azure must be described as self-hosted-to-managed, not on-prem.
Have a rehearsed recording; cloud/network problems must not block attendee completion.

Keep validated cloud TLS, private credential handling and approved narrow network
access. Do not disable certificates, open all-address firewall ranges, or share
an authenticated organizer environment. Existing resources can still incur costs;
cleanup follows their owner's policy, not generic cluster/group deletion.

## Retained optional infrastructure

The Organizer dev-container, Azure CLI/Bicep tooling, private parameter helper,
and two-M30-cluster rehearsal templates remain for **separately authorized future
provisioning only**. See [the legacy runbook](../docs/legacy-azure-provisioning.md).
They are not an attendee dependency, classroom-capacity plan, or authorization
to deploy. Native-user cluster-wide permissions are why a shared managed cluster
with database-per-attendee credentials was not chosen for this workshop.

Earlier evidence: a real single-development-database Codespace app/API rehearsal
passed; the previous corrected Azure two-cluster control-plane deployment reached
Ready with public access disabled and was cleaned up. Managed CRUD/copy-back/
cross-attendee authentication did **not** finish in that run. Do not carry that
control-plane result forward as a managed data-plane or revised two-site proof.

## Verification gates

Automated gates in this revision:

- Offline Linux tests, including owner-only organizer files and setup preservation.
- Two actual independent local database services, temporary per-run test databases,
  copy-out/back/retry, partial outcomes, timestamp retention, index/migration, HTTP.
- Complete-reference recovery and expected 216-entry catalog.
- No cloud endpoint used by attendee startup or database integration tests.

Executed on preceding main source (see [dated acceptance](../docs/acceptance.md)):

- [x] Fresh two-core attendee Codespace, 4m47s cold, actual Site A/B 34/34 plus integration.
- [x] Actual Google Calendar UI import, 3/3 events.
- [x] Local Mac mini → managed Azure round trip; temporary resource cleaned up.

Still requiring environment-specific acceptance (not replaced by those receipts):

- [ ] This reconnect/onboarding revision's fresh/restarted attendee Codespace and live failure recovery.
- [ ] Fresh Organizer profile and representative account/machine capacity checks.
- [ ] Presenter existing-resource rehearsal on the conference laptop/network.
- [ ] Verified backup recording; Apple Calendar UI and repeat-import handling.
- [ ] Full 105-minute human rehearsal, pairing fallback, export and safe stopping.

No unattended cleanup worker, cloud IAM grants, Kubernetes dependency, background
sync, Azure app hosting or new cloud resources are introduced by this plan.

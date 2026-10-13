# Azure deployment plan

**Status: Ready for Validation - Codespaces-first; live organizer checks pending.**

## Direction

Attendees use a browser and a GitHub account. Node.js, Docker, and the development
DocumentDB run inside their Codespace. A physical-laptop database and offline
operation are no longer workshop requirements. Local Docker remains optional.

The teaching comparison is a self-hosted development database versus managed
Azure DocumentDB. Both may physically run in the cloud; do not describe the
Codespaces path as offline or as running on the attendee's laptop.

## Role separation

| Environment | Tools and purpose | Azure access |
| --- | --- | --- |
| Attendee (default) | Node.js, Docker, DocumentDB, TODOs/reference app | Organizer-issued database credentials only |
| Organizer (alternate) | Attendee tools plus Azure CLI and Bicep | Explicit Entra sign-in and approved deployment scope |

The organizer configuration installs tools but does not sign in or provision
anything on startup. A configuration name is not an authorization boundary:
Azure RBAC, identity, and network controls still enforce access. Never share the
organizer's Azure login cache or authenticated Codespace with attendees.

## Preparation work

- Make the browser-first entry point and attendee prerequisites the default.
- Share a bounded development-database startup command between both configurations.
- Preinstall Azure CLI and Bicep in the organizer configuration.
- Provide a Linux/Codespaces helper that prepares private, owner-only deployment
  inputs outside Git, without performing Azure operations.
- Document explicit validation, deployment, observation, and ownership-checked
  cleanup commands in the organizer runbook.
- Preserve the same data layer, explicit copying, existing favorites, and the
  optional laptop-local path.

## Infrastructure recipe

Use standalone Bicep through Azure CLI from the organizer Codespace. No `azd`
project, CI workflow, standing worker, or new IAM role assignment is introduced.

The current templates model a two-attendee rehearsal: a fresh group and two
isolated M30 clusters in East US, one shard and 128 GiB per cluster, native
authentication, no HA or replicas, and public access initially disabled. This
is a rehearsal inventory, not a classroom-wide sizing recommendation.

Only observed single IPv4 client addresses are allowed. Do not create an
all-address firewall range or the special Azure-service bypass rule. Re-observe
Codespaces egress after a restart.

## Credentials and execution boundary

The parameter-preparation helper generates credentials in private storage in the
organizer environment. It does not deploy, grant approval, or verify cloud state.
The parameter file is sensitive even though Bicep marks its password object
secure. Keep it out of Git, terminal output, screenshots, and attendee workspaces.

Before any live run, confirm the actual subscription, region, permissions,
resource inventory, execution limits, provider-specific usage policy, expiry,
and cleanup authority outside this public repository. Keep ownership records
before writes and verify real provider results afterward.

The organizer runbook is supervised, not an unattended scheduler. Stopping a
Codespace does not stop or delete Azure resources. An expiry tag is not an
automatic cleanup mechanism.

## Existing rehearsal evidence

- A real two-core Codespace ran the published app and its development database.
  Completed exercises, 216 schedule entries, favorites, duplicate prevention,
  overlaps, and calendar export were exercised.
- The corrected exercise-aware tests passed locally and in Codespaces.
- Azure template validation and what-if passed, but the first real request
  rejected the documented `networkBypassMode` property. The templates now omit it.
- The corrected two-cluster deployment reached `Succeeded` and both clusters
  reached `Ready` with public access disabled. Managed CRUD, copy-back, and
  cross-attendee authentication were not completed within that rehearsal.
- The temporary Codespace, clusters, and empty group were deleted and temporary
  credentials removed.

## Remaining validation

- [ ] Fresh startup of both revised dev-container configurations.
- [ ] Organizer Azure sign-in under the target tenant's MFA/conditional-access policy.
- [ ] Approved scope, quotas, policy checks, validation, and what-if for a new run.
- [ ] Managed database connection, seed, copy-out, copy-back, and credential isolation.
- [ ] Narrow-IP refresh after stop/resume and verified resource cleanup.
- [ ] Calendar-app import and the full 105-minute attendee rehearsal.

Static checks or a previously healthy Codespace do not establish these outcomes.

## Local validation proof

- Twenty-five focused checks passed in a non-root Linux container, including
  owner-only organizer-file permissions, refusal to overwrite a prior run, and
  refusal to write organizer state inside the repository.
- Windows checks passed with the POSIX-only permission test explicitly skipped.
- The rehearsal Bicep compiled successfully.
- The Azure CLI feature's `installBicep` option and pinned feature release were
  checked against the official published manifest. The pinned Bicep release
  includes public Linux x64 and arm64 assets.
- Shared startup is bounded and seeds only the development target. Neither
  configuration signs in to Azure or provisions cloud resources on startup.
- No managed identities or new Azure IAM role assignments are introduced.

The new organizer profile has not yet completed a fresh Codespaces build or a
managed-data-plane rehearsal. This is preparation evidence, not a `Validated`
Azure deployment or permission to start a new live run.

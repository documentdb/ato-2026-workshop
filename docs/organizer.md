# Organizer preparation: subscription-free attendees

The default workshop uses two independent local OSS DocumentDB instances in each
attendee's Codespace. **Do not provision an Azure cluster per attendee.** Attendees
need no Azure subscription, cloud database credentials, Azure CLI, or Kubernetes.
The presenter uses one existing, authorized Azure instance for an optional capstone.

## Before the event

1. Confirm GitHub/Codespaces account access, available usage, machine capacity,
   conference connectivity, storage retention and the pairing/follow-along plan.
2. Measure a fresh **ATO 2026 - Attendee** Codespace with both database services.
   The preceding main source measured 4m47s on a fresh two-core attendee Codespace;
   repeat on the delivery revision and representative accounts/network.
3. Rehearse TODOs/reference recovery, app restart persistence, both copy directions,
   duplicate-safe retry, second-site failure/recovery and a real calendar-app import.
4. Follow the [presenter runbook](presenter.md) on the actual presenter laptop,
   with a dedicated approved database on the existing Azure resource. Rehearse
   network/TLS access and record a working round trip as the backup.
5. Time the [105-minute instructor plan](instructor.md); shorten the index/migration
   extension first. Preserve return-trip, export and safe stopping time.

## Credentials and environment boundaries

Default setup generates separate Site A/B credentials and preserves the existing
Site A volume. It only appends missing Site B fields to an old `.env`; partial
credentials require manual review. The attendee Compose file excludes cloud values,
even if legacy settings remain in `.env`, and starts at Site A.

The optional **ATO 2026 - Organizer** dev-container configuration retains Azure
CLI/Bicep for separately approved operations. Both configurations start the
attendee simulation only. Selecting Organizer installs tools; it neither signs
in nor grants access, and is unnecessary for the existing-instance presenter path.
Do not share an authenticated organizer Codespace or Azure login cache.

Never distribute a shared cluster's administrator credentials. Database names
alone are not an attendee isolation boundary under cluster-wide native roles.
Avoid this classroom risk altogether: students keep their own self-hosted sites,
and the presenter keeps the managed credentials private.

## Stop and retain work safely

Students export calendars and preserve code before stopping Codespaces. Stopping
compute may not end storage charges. Deletion/retention expiry removes both local
notebooks; changing a Compose project name selects different volumes rather than
migrating data. Never prune volumes or replace `.env` as generic troubleshooting.

The existing Azure resource has its own owner and approved cleanup policy.
Stopping a Codespace/local app does not stop cloud billing or delete Azure data.
Only clean up the dedicated demo data/access when authorized; never delete the
shared cluster or resource group as workshop cleanup.

## Optional legacy provisioning

The old two-cluster Bicep templates and private input helper remain available for
separately approved infrastructure rehearsals. They are **not required by this
workshop**, do not model classroom-wide capacity, and confer no deployment authority.
If a future run explicitly needs new resources, use the
[legacy provisioning runbook](legacy-azure-provisioning.md), including ownership
records, validation, narrow network controls and verified cleanup. Do not run it
merely to deliver the current attendee lab or existing-instance presenter demo.

## Evidence and remaining acceptance

Automated tests cover configuration/scenario separation, legacy `.env` preservation,
catalog ownership, bounded two-site startup, and real two-server data flows in CI.
The preceding source has fresh two-core Codespaces (4m47s; 34/34 plus integration),
Google Calendar (3/3), and actual local Mac mini → managed Azure data-plane proof;
the temporary Azure resource was cleaned up. See the [acceptance record](acceptance.md)
for limitations and the reconnect defect found. New-HEAD acceptance, human timing,
and conference-laptop/network proof remain pending. See also the
[delivery plan](../.azure/deployment-plan.md).

# Azure deployment plan

**Status: Planning - Azure execution deferred.**

## Approved local work

Build a JavaScript / Node.js conference planner with DocumentDB running locally
in Docker, a TODO starter and complete reference implementation, schedule
conflict warnings, and calendar export. Prepare a Codespaces fallback.

The application uses standard MongoDB-driver database operations. Its managed
database target will be Azure DocumentDB; deploying the application itself to
Azure is not part of the workshop.

## Azure scope

This repository does not provision Azure resources or grant access to a cloud
account. Organizers must supply an approved sandbox before enabling the managed
database exercise. A separately approved subscription can be used for rehearsal
before event accounts are available.

Before any live Azure operation, confirm the exact subscription, resource scope,
region, permissions, network approach, operation/time/retry bounds, resource
ownership record, credential handling, and cleanup authority. Those decisions
are intentionally unresolved, not defaulted.

Follow the organizer's approved resource policy, provider quotas, subscription
policies, and cleanup requirements.

## Components

| Component | Implementation | Hosting |
| --- | --- | --- |
| Planner UI | Self-contained HTML, CSS, JavaScript | Local Node.js API |
| API and data layer | Node.js and the MongoDB driver | Local Docker container |
| Development database | Pinned DocumentDB Local image | Local Docker volume |
| Managed database | Azure DocumentDB | Deferred |

## Readiness gates

- [ ] Confirm rehearsal subscription and region.
- [ ] Approve exact resources and network exposure.
- [ ] Verify attendee isolation against the selected service.
- [ ] Confirm temporary-account permissions, policies, and expiry.
- [ ] Define credential distribution and revocation.
- [ ] Confirm capacity after attendance is known.
- [ ] Record cleanup owner, scope, expiry, retries, and escalation.
- [ ] Select an infrastructure recipe if provisioning is required.
- [ ] Validate the approved Azure configuration before deployment.
- [ ] Complete an authorized local-to-managed-service rehearsal.

Local tests or two local containers do not establish managed-service readiness.

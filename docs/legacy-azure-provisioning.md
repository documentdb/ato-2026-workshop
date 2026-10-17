> **Optional legacy provisioning only.** Not part of attendee setup or the current
> presenter path, which uses an existing approved Azure instance. No new resources
> are needed for the workshop. This runbook requires separate provisioning authority.
> Start with [organizer guidance](organizer.md) and the [presenter runbook](presenter.md).

# Deploy from an organizer Codespace

This is a supervised organizer runbook, not an attendee prerequisite or an
unattended cleanup worker. It uses Azure CLI and the existing Bicep templates;
no Azure tooling needs to be installed on your laptop.

The templates currently model two isolated rehearsal participants in East US.
Plan classroom capacity separately once attendance and account policies are
known. A configuration or generated parameter file is not authorization to deploy.

## 1. Open the organizer environment

In the repository's **Code > Codespaces** menu, create a Codespace with advanced
options and select **ATO 2026 - Organizer** as the dev-container configuration.
Attendees should select **ATO 2026 - Attendee** instead.

The organizer environment includes the development app/database, Azure CLI, and
Bicep. Startup verifies tooling and starts only the development environment:

```sh
npm run organizer:check
```

Nothing signs in to Azure or provisions resources automatically. Do not share this
authenticated Codespace or its Azure login cache with attendees. Selecting the
organizer configuration grants tools, not Azure permissions.

## 2. Establish the approved scope

Before creating anything, record the authorized subscription, region, two-cluster
inventory, operation/time/retry bounds, expiry, network clients, usage policy, and
cleanup owner in approved private storage. Set a bounded Codespaces machine,
runtime, retention, and spending allowance too.

Sign in as the approved Azure operator:

```sh
az login --use-device-code
```

Complete the browser sign-in and any MFA yourself. GitHub authentication does not
grant Azure access. If tenant policy blocks authentication from Codespaces, stop;
do not copy a laptop's login cache or work around conditional access.

Set the approved subscription explicitly and verify it:

```sh
export SUBSCRIPTION_ID="<approved-subscription-guid>"
az account show --subscription "$SUBSCRIPTION_ID" \
  --query "{id:id,name:name,tenantId:tenantId}" --output json
```

The subscription-scoped template creates a new resource group. Its operator needs
permission for that deployment scope, not merely permission to query a database.
Do not grant new roles or policy exemptions as an automatic fallback.

## 3. Prepare private inputs

Observe each client IP from the environment that will connect. For example, run
the following inside the organizer Codespace, and have the participant environment
observe its own address:

```sh
curl -4 --fail --silent --show-error --max-time 20 https://api.ipify.org
```

An IP check made on your laptop is not the Codespace's address. A stopped/resumed
Codespace can get a new address. Never replace a narrow rule with an all-address
range to avoid checking.

Prepare a new private run, supplying the addresses and UTC expiry approved above:

```sh
npm run organizer:prepare -- \
  --subscription "$SUBSCRIPTION_ID" \
  --location eastus \
  --client-ip "<organizer-ipv4>" \
  --client-ip "<participant-ipv4>" \
  --expires-at "<approved-UTC-expiry>"
```

If there is only one distinct client, omit the second `--client-ip`. The helper
creates a fresh owner-only directory under the organizer's home, outside Git.
It writes:

- `manifest.json`: proposed IDs, names, ownership correlation, clients, and expiry.
- `parameters.json`: deployment inputs, including independently generated
  administrator passwords. This file is sensitive; never print or publish it.

The helper makes **no Azure calls**. `actionsExecuted: false` is intentional.
Preserve the manifest in approved durable private storage outside the Codespace
before deployment; its local disk is not an independent recovery service.

Set the private path printed by the helper, then load only non-secret context:

```sh
export RUN_DIR="<private-state-directory-printed-by-the-helper>"
export RESOURCE_GROUP="$(node -p 'require(process.env.RUN_DIR + "/manifest.json").resourceGroupName')"
export DEPLOYMENT_NAME="$(node -p 'require(process.env.RUN_DIR + "/manifest.json").deploymentName')"
export RUN_ID="$(node -p 'require(process.env.RUN_DIR + "/manifest.json").runId')"
```

Keep `SUBSCRIPTION_ID` consistent with the manifest. Do not regenerate passwords
by rerunning preparation when a deployment outcome is uncertain.

## 4. Validate, preview, and deploy

Verify that the generated resource group does not already exist:

```sh
az group exists --name "$RESOURCE_GROUP" \
  --subscription "$SUBSCRIPTION_ID" --output tsv
```

Continue only after a successful response of `false`. Authentication and permission
errors are not evidence of absence. Inspect inherited policy, regional availability,
and quota before executing the approved plan.

Build and validate using the sensitive parameter **file path**, not inline passwords:

```sh
az bicep build --file infra/rehearsal.bicep --outfile "$RUN_DIR/template.json"

az deployment sub validate \
  --name "$DEPLOYMENT_NAME" --location eastus \
  --subscription "$SUBSCRIPTION_ID" \
  --template-file "$RUN_DIR/template.json" \
  --parameters "@$RUN_DIR/parameters.json"

az deployment sub what-if \
  --name "$DEPLOYMENT_NAME" --location eastus \
  --subscription "$SUBSCRIPTION_ID" \
  --template-file "$RUN_DIR/template.json" \
  --parameters "@$RUN_DIR/parameters.json"
```

Review the exact inventory: the fresh group, two named clusters, and only the
supplied single-IP rules. No unrelated modifications or deletions are acceptable.
Use the normal preparation/validation approval process before the actual write:

```sh
az deployment sub create \
  --name "$DEPLOYMENT_NAME" --location eastus \
  --subscription "$SUBSCRIPTION_ID" \
  --template-file "$RUN_DIR/template.json" \
  --parameters "@$RUN_DIR/parameters.json" \
  --query "{id:id,state:properties.provisioningState,timestamp:properties.timestamp}" \
  --output json > "$RUN_DIR/deployment-result.json"
```

Check the real result and both cluster states. A submitted request, an intent
manifest, or a successful what-if is not proof of a usable database. Keep the
receipt in the approved private recovery record. If a write times out, reconcile
the exact IDs before retrying; do not launch duplicate creates.

Initial public access is **disabled**. Before enabling it, verify ownership and
the exact firewall rules, and re-observe the clients' current IPs. Review a new
what-if with `enablePublicAccess=true`; only then apply that same approved change.
Do not add an Azure-service bypass rule or disable TLS validation.

Prepare participant-only database credentials and verify isolation using the
service's supported user-management procedure. Do not distribute the administrator
password object or the organizer's Azure session. Native permissions are currently
cluster-wide, so database names alone do not isolate participants.

## 5. Rehearse the application

Use the organizer's development app to verify the managed connection before
attendee delivery. Then follow the [lab](lab.md): seed the same catalog, switch
targets without moving favorites, copy selected favorites, retry safely, and
copy a new cloud favorite back.

Opening a Codespace from the repository does not demonstrate this managed
data-plane journey. Neither the new organizer profile nor this complete procedure
has had a fresh end-to-end live rehearsal yet.

## Cleanup and shutdown

Keep the approved execution window and stop path visible. An expiry tag does not
delete Azure resources; an idle/stopped/deleted Codespace can no longer run your
cleanup commands.

Before deleting each cluster, read its **exact ID from the manifest** and verify
the real resource's subscription, location, and `ato-rehearsal-run` tag:

```sh
export CLUSTER_ID="<one-exact-cluster-id-from-the-private-manifest>"
az resource show --ids "$CLUSTER_ID" --subscription "$SUBSCRIPTION_ID" \
  --api-version 2026-06-01 \
  --query "{id:id,type:type,location:location,run:tags.\"ato-rehearsal-run\"}" \
  --output json
```

Only after ownership and cleanup authority are confirmed:

```sh
az resource delete --ids "$CLUSTER_ID" \
  --subscription "$SUBSCRIPTION_ID" --api-version 2026-06-01
```

Repeat for the other recorded cluster. Wait for authoritative absence of both
IDs; an authentication failure or accepted delete request is not absence.

Verify the group still belongs to the run and its resource inventory is empty
before deleting that exact group. If unexpected resources are present, stop and
escalate rather than deleting them.

```sh
az resource list --resource-group "$RESOURCE_GROUP" \
  --subscription "$SUBSCRIPTION_ID" --output table

# Run only after the ownership and empty-inventory checks above.
az group delete --name "$RESOURCE_GROUP" \
  --subscription "$SUBSCRIPTION_ID" --yes
```

Verify group absence. Remove the temporary parameter file only after cleanup is
confirmed; retain the non-secret ownership/cleanup record as required. Deleting
deployment history alone does not delete the resources.

Export any work you need before stopping/deleting the Codespace. Do not report
success while resources or cleanup status remain unresolved.

## References

- [Azure CLI sign-in](https://learn.microsoft.com/cli/azure/authenticate-azure-cli-interactively)
- [Deploy Bicep with Azure CLI](https://learn.microsoft.com/azure/azure-resource-manager/bicep/deploy-cli)
- [Azure CLI dev-container feature](https://github.com/devcontainers/features/tree/main/src/azure-cli)
- [DocumentDB native-user limitations](https://learn.microsoft.com/azure/documentdb/limitations#native-documentdb-secondary-users)

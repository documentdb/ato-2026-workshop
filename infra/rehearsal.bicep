targetScope = 'subscription'

@description('Approved temporary resource group; supplied from the private run plan.')
param resourceGroupName string

@allowed(['eastus'])
param location string = 'eastus'

@description('Unique ownership correlation; not a credential.')
param runId string

@description('Expiry is for recovery records, not an automatic Azure deletion mechanism.')
param expiresAt string

@minLength(2)
@maxLength(2)
param clusterNames array

@secure()
param administratorPasswords object

@minLength(1)
@maxLength(2)
@description('Only the observed, approved single IPv4 client addresses.')
param clientIps array

@description('Keep disabled during initial creation. Enable only after firewall rules are verified.')
param enablePublicAccess bool = false

resource rehearsalGroup 'Microsoft.Resources/resourceGroups@2023-07-01' = {
  name: resourceGroupName
  location: location
  tags: {
    'ato-rehearsal-run': runId
    'ato-rehearsal-expiry': expiresAt
    'ms-resiliency-classification': 'test resource'
    'ms-resiliency-classification-scope': 'all'
  }
}

module clusters './rehearsal-clusters.bicep' = {
  name: 'ato-rehearsal-clusters'
  scope: rehearsalGroup
  params: {
    location: location
    runId: runId
    expiresAt: expiresAt
    clusterNames: clusterNames
    administratorPasswords: administratorPasswords
    clientIps: clientIps
    enablePublicAccess: enablePublicAccess
  }
}

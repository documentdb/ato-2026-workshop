targetScope = 'resourceGroup'

param location string
param runId string
param expiresAt string
param clusterNames array

@secure()
param administratorPasswords object

param clientIps array
param enablePublicAccess bool

// Each attendee owns a separate cluster because native roles are cluster-wide.
resource clusters 'Microsoft.DocumentDB/mongoClusters@2026-06-01' = [for name in clusterNames: {
  name: name
  location: location
  tags: {
    'ato-rehearsal-run': runId
    'ato-rehearsal-expiry': expiresAt
    'ms-resiliency-classification': 'test resource'
    'ms-resiliency-classification-scope': 'all'
  }
  properties: {
    administrator: {
      userName: 'rehearsaladmin'
      password: administratorPasswords[name]
    }
    authConfig: {
      allowedModes: [
        'NativeAuth'
      ]
    }
    compute: {
      tier: 'M30'
    }
    createMode: 'Default'
    dataApi: {
      mode: 'Disabled'
    }
    highAvailability: {
      targetMode: 'Disabled'
    }
    publicNetworkAccess: enablePublicAccess ? 'Enabled' : 'Disabled'
    serverVersion: '8.0'
    sharding: {
      shardCount: 1
    }
    storage: {
      sizeGb: 128
    }
  }
}]

// Never create the special Azure-service bypass rule or an all-address range.
resource firstClientRules 'Microsoft.DocumentDB/mongoClusters/firewallRules@2026-06-01' = [for (name, index) in clusterNames: {
  parent: clusters[index]
  name: 'rehearsal-client-0'
  properties: {
    startIpAddress: clientIps[0]
    endIpAddress: clientIps[0]
  }
}]

resource secondClientRules 'Microsoft.DocumentDB/mongoClusters/firewallRules@2026-06-01' = [for (name, index) in clusterNames: if (length(clientIps) > 1) {
  parent: clusters[index]
  name: 'rehearsal-client-1'
  properties: {
    startIpAddress: clientIps[1]
    endIpAddress: clientIps[1]
  }
}]

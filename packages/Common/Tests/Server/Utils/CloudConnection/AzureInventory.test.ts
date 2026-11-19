import {
  AZURE_INVENTORY_ONLY_QUERY_TYPES,
  AZURE_INVENTORY_PROPERTIES,
  AZURE_SUBNET_TYPE,
  AZURE_VIRTUAL_NETWORK_TYPE,
  buildAzureInventoryItem,
  buildAzureInventoryItems,
  buildAzureInventoryQuery,
  getAzureOwningResourceId,
  getAzureParentResourceId,
  getAzureVirtualNetworkOfSubnet,
} from "../../../../Server/Utils/CloudConnection/Azure/AzureInventory";
import { CloudInventoryItem } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import {
  CLOUD_RELATIONSHIPS_MAX,
  CloudRelationshipKind,
  CloudResourceRelationship,
} from "../../../../Types/Cloud/CloudInventory";
import {
  CloudLinkedResource,
  CloudResourceLink,
  getCloudResourceLinks,
} from "../../../../Types/Cloud/CloudResourceIndex";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  CloudMonitoredResource,
  resolveCloudMonitoredResource,
} from "../../../../Types/Cloud/CloudMonitoredResource";
import { AZURE_RESOURCE_TYPES } from "../../../../Types/Cloud/CloudResourceCatalog";
import { describe, expect, test } from "@jest/globals";

/*
 * An Azure subscription's inventory is one Resource Graph query: these hold
 * the query to the types OneUptime knows and to the fields it keeps, and
 * each row to the resource its Azure Monitor metrics name - by ARM id,
 * whatever case Resource Graph writes it in.
 */

const SUBSCRIPTION: string = "aaaaaaaa-0000-4000-8000-000000000001";
const RG: string = `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod`;
const VM_ID: string = `${RG}/providers/Microsoft.Compute/virtualMachines/vm-web-1`;

describe("the query", () => {
  const query: string = buildAzureInventoryQuery();

  test("asks only for the types the catalog knows, each once", () => {
    for (const descriptor of AZURE_RESOURCE_TYPES) {
      expect(query).toContain(`'${descriptor.type.toLowerCase()}'`);
    }

    expect(query).toContain("| where type in~ (");
  });

  test("projects every field the inventory reads - never the whole properties bag", () => {
    for (const field of AZURE_INVENTORY_PROPERTIES) {
      /*
       * kind is projected as it is; a subnet's ranges come from the subnet
       * query, and the rest are worked out from what was projected.
       */
      if (
        [
          "kind",
          "addressPrefix",
          "addressPrefixes",
          "delegatedTo",
          "inbound",
          "outbound",
        ].includes(field)
      ) {
        continue;
      }
      expect(query).toContain(`${field} = `);
    }

    expect(query).toContain("| project id, name, type");
    expect(query).not.toMatch(/project[^\n]*\bproperties\s*,/);
    expect(query).not.toContain("properties.siteConfig");
    expect(query).not.toContain("connectionString");
  });

  test("puts nothing in the query but the catalog's own type names", () => {
    expect(query).not.toContain('"');
    expect(query.split("'").length % 2).toBe(1);

    // The only other quoted words pick the two types whose lists are read.
    const quoted: Array<string> = (query.match(/'[^']*'/g) || []).map(
      (literal: string): string => {
        return literal.slice(1, -1);
      },
    );
    const catalog: Array<string> = [
      ...AZURE_RESOURCE_TYPES.map((descriptor: { type: string }): string => {
        return descriptor.type;
      }),
      // Listed only (#9375): a network security group publishes no metrics.
      ...AZURE_INVENTORY_ONLY_QUERY_TYPES,
    ].map((type: string): string => {
      return type.toLowerCase();
    });

    for (const literal of quoted) {
      expect(catalog).toContain(literal);
    }
  });

  test("projects where each resource runs, what guards it and what it sends traffic to", () => {
    for (const field of [
      "virtualNetworkSubnetId = tostring(properties.virtualNetworkSubnetId)",
      "subnetId = tostring(properties.subnet.id)",
      "gatewayIPConfigurations = properties.gatewayIPConfigurations",
      "frontendIPConfigurations = properties.frontendIPConfigurations",
      "agentPoolProfiles = properties.agentPoolProfiles",
      "networkInterfaceConfigurations = properties.virtualMachineProfile.networkProfile.networkInterfaceConfigurations",
      "infrastructureSubnetId = tostring(properties.vnetConfiguration.infrastructureSubnetId)",
      "networkSecurityGroupId = tostring(properties.networkSecurityGroup.id)",
      "elasticPoolId = tostring(properties.elasticPoolId)",
      "natGatewayId = tostring(properties.natGateway.id)",
      "privateLinkServiceConnections = properties.privateLinkServiceConnections",
      "manualPrivateLinkServiceConnections = properties.manualPrivateLinkServiceConnections",
    ]) {
      expect(query).toContain(field);
    }
  });

  test("reads a virtual network's subnets and a gateway's pools only for the type that needs them", () => {
    /*
     * A virtual network's subnets list every interface in them, and a load
     * balancer's pools every instance: read for every row, they would
     * make a large subscription's pages heavy for nothing.
     */
    expect(query).toContain(
      "natGatewaySubnets = iff(type =~ 'microsoft.network/natgateways', properties.subnets, dynamic(null))",
    );
    expect(query).toContain(
      "gatewayBackendPools = iff(type =~ 'microsoft.network/applicationgateways', properties.backendAddressPools, dynamic(null))",
    );
    expect(query).not.toMatch(/[=]\s*properties\.subnets\b/);
    expect(query).not.toMatch(/[=]\s*properties\.backendAddressPools\b/);
  });
});

describe("ids", () => {
  test("a nested resource is part of its parent", () => {
    expect(
      getAzureParentResourceId(
        `${RG}/providers/Microsoft.Sql/servers/sql-1/databases/orders`,
      ),
    ).toBe(`${RG}/providers/Microsoft.Sql/servers/sql-1`);
    expect(getAzureParentResourceId(VM_ID)).toBe("");
    expect(getAzureParentResourceId("not an id")).toBe("");
  });

  test("a sub-resource belongs to the resource it is part of", () => {
    expect(
      getAzureOwningResourceId(
        `${RG}/providers/Microsoft.Network/networkInterfaces/nic-1/ipConfigurations/ipconfig1`,
      ),
    ).toBe(`${RG}/providers/Microsoft.Network/networkInterfaces/nic-1`);
    expect(getAzureOwningResourceId(VM_ID)).toBe(VM_ID);
    expect(getAzureOwningResourceId("")).toBe("");
  });

  test("a subnet is in its virtual network; nothing else is", () => {
    expect(
      getAzureVirtualNetworkOfSubnet(
        `${RG}/providers/Microsoft.Network/virtualNetworks/vnet-1/subnets/default`,
      ),
    ).toBe(`${RG}/providers/Microsoft.Network/virtualNetworks/vnet-1`);
    // Resource Graph writes some ids in lower case: the case is kept.
    expect(
      getAzureVirtualNetworkOfSubnet(
        `${RG.toLowerCase()}/providers/microsoft.network/virtualnetworks/vnet-1/subnets/apps`,
      ),
    ).toBe(
      `${RG.toLowerCase()}/providers/microsoft.network/virtualnetworks/vnet-1`,
    );
    expect(
      getAzureVirtualNetworkOfSubnet(
        `${RG}/providers/Microsoft.Network/virtualNetworks/vnet-1`,
      ),
    ).toBe("");
    expect(
      getAzureVirtualNetworkOfSubnet(
        `${RG}/providers/Microsoft.Sql/servers/sql-1/databases/orders`,
      ),
    ).toBe("");
    // A "subnets" child of something that is not a virtual network.
    expect(
      getAzureVirtualNetworkOfSubnet(
        `${RG}/providers/Microsoft.Other/virtualNetworks/vnet-1/subnets/default`,
      ),
    ).toBe("");
    expect(getAzureVirtualNetworkOfSubnet("subnet-0abc")).toBe("");
    expect(getAzureVirtualNetworkOfSubnet("")).toBe("");
  });
});

describe("a row", () => {
  test("is the resource its Azure Monitor metrics name", () => {
    const item: CloudInventoryItem | null = buildAzureInventoryItem({
      // Resource Graph lowercases types; ids keep their case.
      id: VM_ID,
      name: "vm-web-1",
      type: "microsoft.compute/virtualmachines",
      location: "westeurope",
      resourceGroup: "rg-prod",
      subscriptionId: SUBSCRIPTION,
    });
    const fromMetrics: CloudMonitoredResource | null =
      resolveCloudMonitoredResource({
        metricName: "Percentage CPU",
        attributes: {
          "azuremonitor.resource_id": VM_ID,
          name: "vm-web-1",
          location: "westeurope",
          resource_group: "rg-prod",
          "resource.azuremonitor.subscription_id": SUBSCRIPTION,
        },
      });

    expect(item).not.toBeNull();
    expect(item!.resource.identityKey).toBe(fromMetrics!.identityKey);
    expect(item!.resource.resourceType).toBe(
      "Microsoft.Compute/virtualMachines",
    );
    expect(item!.resource.accountId).toBe(SUBSCRIPTION);
    expect(item!.displayName).toBe("vm-web-1");
  });

  test("keeps its tags, the properties projected for it, and nothing else", () => {
    const item: CloudInventoryItem | null = buildAzureInventoryItem({
      id: VM_ID,
      name: "vm-web-1",
      type: "Microsoft.Compute/virtualMachines",
      location: "westeurope",
      resourceGroup: "rg-prod",
      subscriptionId: SUBSCRIPTION,
      tags: { team: "storefront", env: "production" },
      vmSize: "Standard_D4s_v5",
      powerState: "VM running",
      provisioningState: "Succeeded",
      secretSetting: "should never be kept",
    });

    expect(item!.tags).toEqual({ team: "storefront", env: "production" });
    expect(item!.properties).toEqual({
      provisioningState: "Succeeded",
      vmSize: "Standard_D4s_v5",
      powerState: "VM running",
    });
  });

  /*
   * A managed disk's size (properties.diskSizeGB, an int in Azure's ARM
   * reference), so its page says how big it is (#9648): one more column of
   * the same Resource Graph query, read only for a disk.
   */
  test("a managed disk keeps its size, read only for a disk", () => {
    expect(AZURE_INVENTORY_PROPERTIES).toContain("diskSizeGB");
    expect(buildAzureInventoryQuery()).toContain(
      "diskSizeGB = iff(type =~ 'microsoft.compute/disks', tolong(properties.diskSizeGB), long(null))",
    );

    const disk: CloudInventoryItem | null = buildAzureInventoryItem({
      id: `${RG}/providers/Microsoft.Compute/disks/vm-web-1-data`,
      name: "vm-web-1-data",
      type: "Microsoft.Compute/disks",
      location: "westeurope",
      resourceGroup: "rg-prod",
      subscriptionId: SUBSCRIPTION,
      skuName: "Premium_LRS",
      diskSizeGB: 512,
    });
    expect(disk!.properties).toMatchObject({ diskSizeGB: 512 });

    // Any other type's row has none: nothing is kept.
    const vm: CloudInventoryItem | null = buildAzureInventoryItem({
      id: VM_ID,
      name: "vm-web-1",
      type: "Microsoft.Compute/virtualMachines",
      location: "westeurope",
      resourceGroup: "rg-prod",
      subscriptionId: SUBSCRIPTION,
      diskSizeGB: null,
    });
    expect(vm!.properties).not.toHaveProperty("diskSizeGB");
  });

  test("a disk is attached to the VM that manages it, a database is part of its server", () => {
    const disk: CloudInventoryItem | null = buildAzureInventoryItem({
      id: `${RG}/providers/Microsoft.Compute/disks/vm-web-1-os`,
      name: "vm-web-1-os",
      type: "microsoft.compute/disks",
      subscriptionId: SUBSCRIPTION,
      managedBy: VM_ID,
    });
    const database: CloudInventoryItem | null = buildAzureInventoryItem({
      id: `${RG}/providers/Microsoft.Sql/servers/sql-1/databases/orders`,
      name: "sql-1/orders",
      type: "microsoft.sql/servers/databases",
      subscriptionId: SUBSCRIPTION,
    });

    expect(disk!.relationships).toEqual([
      { kind: CloudRelationshipKind.AttachedTo, target: VM_ID },
    ]);
    expect(database!.relationships).toEqual([
      {
        kind: CloudRelationshipKind.PartOf,
        target: `${RG}/providers/Microsoft.Sql/servers/sql-1`,
      },
    ]);
  });

  test("a web app is part of its plan and answers on its host names", () => {
    const item: CloudInventoryItem | null = buildAzureInventoryItem({
      id: `${RG}/providers/Microsoft.Web/sites/shop`,
      name: "shop",
      type: "microsoft.web/sites",
      subscriptionId: SUBSCRIPTION,
      serverFarmId: `${RG}/providers/Microsoft.Web/serverfarms/plan-1`,
      defaultHostName: "shop.azurewebsites.net",
      hostNames: ["shop.azurewebsites.net", "www.example.com"],
    });

    expect(item!.relationships).toEqual([
      {
        kind: CloudRelationshipKind.PartOf,
        target: `${RG}/providers/Microsoft.Web/serverfarms/plan-1`,
        targetType: "Microsoft.Web/serverFarms",
      },
    ]);
    expect(item!.endpoints).toEqual([
      "shop.azurewebsites.net",
      "www.example.com",
    ]);
  });

  test("a network interface is attached to its VM and runs in its subnets and their network; a public IP is attached to what it is on", () => {
    const subnet: string = `${RG}/providers/Microsoft.Network/virtualNetworks/vnet-1/subnets/default`;
    const nic: CloudInventoryItem | null = buildAzureInventoryItem({
      id: `${RG}/providers/Microsoft.Network/networkInterfaces/nic-1`,
      name: "nic-1",
      type: "microsoft.network/networkinterfaces",
      subscriptionId: SUBSCRIPTION,
      virtualMachineId: VM_ID,
      ipConfigurations: [{ properties: { subnet: { id: subnet } } }],
    });
    const publicIp: CloudInventoryItem | null = buildAzureInventoryItem({
      id: `${RG}/providers/Microsoft.Network/publicIPAddresses/pip-1`,
      name: "pip-1",
      type: "microsoft.network/publicipaddresses",
      subscriptionId: SUBSCRIPTION,
      ipConfigurationId: `${RG}/providers/Microsoft.Network/networkInterfaces/nic-1/ipConfigurations/ipconfig1`,
      ipAddress: "20.1.2.3",
      dnsFqdn: "shop.westeurope.cloudapp.azure.com",
    });

    expect(nic!.relationships).toEqual([
      {
        kind: CloudRelationshipKind.AttachedTo,
        target: VM_ID,
        targetType: "Microsoft.Compute/virtualMachines",
      },
      {
        kind: CloudRelationshipKind.RunsIn,
        target: subnet,
        targetType: "Microsoft.Network/virtualNetworks/subnets",
      },
      // Azure lists no subnet as a resource: the account holds its network.
      {
        kind: CloudRelationshipKind.RunsIn,
        target: `${RG}/providers/Microsoft.Network/virtualNetworks/vnet-1`,
        targetType: "Microsoft.Network/virtualNetworks",
      },
    ]);
    expect(publicIp!.relationships).toEqual([
      {
        kind: CloudRelationshipKind.AttachedTo,
        target: `${RG}/providers/Microsoft.Network/networkInterfaces/nic-1`,
      },
    ]);
    expect(publicIp!.endpoints).toEqual([
      "shop.westeurope.cloudapp.azure.com",
      "20.1.2.3",
    ]);
  });

  test("a storage account and a container app answer on their own hosts", () => {
    const storage: CloudInventoryItem | null = buildAzureInventoryItem({
      id: `${RG}/providers/Microsoft.Storage/storageAccounts/shopassets`,
      name: "shopassets",
      type: "microsoft.storage/storageaccounts",
      subscriptionId: SUBSCRIPTION,
      primaryWeb: "https://shopassets.z6.web.core.windows.net/",
      primaryBlob: "https://shopassets.blob.core.windows.net/",
    });

    expect(storage!.endpoints).toEqual([
      "shopassets.z6.web.core.windows.net",
      "shopassets.blob.core.windows.net",
    ]);
  });

  test("a row without an id names nothing", () => {
    expect(buildAzureInventoryItem({ name: "orphan" })).toBeNull();
    expect(buildAzureInventoryItem({ id: "not an ARM id" })).toBeNull();
  });
});

const VNET: string = `${RG}/providers/Microsoft.Network/virtualNetworks/vnet-prod`;
const APPS_SUBNET: string = `${VNET}/subnets/apps`;
const DATA_SUBNET: string = `${VNET}/subnets/data`;

function runsIn(subnet: string): Array<CloudResourceRelationship> {
  return [
    {
      kind: CloudRelationshipKind.RunsIn,
      target: subnet,
      targetType: AZURE_SUBNET_TYPE,
    },
    {
      kind: CloudRelationshipKind.RunsIn,
      target: getAzureVirtualNetworkOfSubnet(subnet),
      targetType: AZURE_VIRTUAL_NETWORK_TYPE,
    },
  ];
}

function relationshipsOf(row: JSONObject): Array<CloudResourceRelationship> {
  const item: CloudInventoryItem | null = buildAzureInventoryItem({
    subscriptionId: SUBSCRIPTION,
    ...row,
  });

  expect(item).not.toBeNull();

  return item!.relationships;
}

describe("where a resource runs", () => {
  test("a web app runs in the subnet its VNet integration names, and its network", () => {
    expect(
      relationshipsOf({
        id: `${RG}/providers/Microsoft.Web/sites/shop`,
        type: "microsoft.web/sites",
        virtualNetworkSubnetId: APPS_SUBNET,
      }),
    ).toEqual(runsIn(APPS_SUBNET));
  });

  test("a private endpoint runs in its subnet and sends traffic to the service it links to", () => {
    const storage: string = `${RG}/providers/Microsoft.Storage/storageAccounts/shopassets`;
    const vault: string = `${RG}/providers/Microsoft.KeyVault/vaults/shop-secrets`;

    expect(
      relationshipsOf({
        id: `${RG}/providers/Microsoft.Network/privateEndpoints/pe-assets`,
        type: "microsoft.network/privateendpoints",
        subnetId: DATA_SUBNET,
        privateLinkServiceConnections: [
          { properties: { privateLinkServiceId: storage } },
        ],
        manualPrivateLinkServiceConnections: [
          { properties: { privateLinkServiceId: vault } },
        ],
      }),
    ).toEqual([
      ...runsIn(DATA_SUBNET),
      { kind: CloudRelationshipKind.RoutesTo, target: storage },
      { kind: CloudRelationshipKind.RoutesTo, target: vault },
    ]);
  });

  test("a cluster runs where its node pools do, each subnet once", () => {
    expect(
      relationshipsOf({
        id: `${RG}/providers/Microsoft.ContainerService/managedClusters/aks-1`,
        type: "microsoft.containerservice/managedclusters",
        agentPoolProfiles: [
          { name: "system", vnetSubnetID: APPS_SUBNET },
          { name: "user", vnetSubnetID: APPS_SUBNET },
          { name: "kubenet" },
        ],
      }),
    ).toEqual(runsIn(APPS_SUBNET));
  });

  test("a scale set runs in the subnets of the interfaces it gives its instances", () => {
    expect(
      relationshipsOf({
        id: `${RG}/providers/Microsoft.Compute/virtualMachineScaleSets/vmss-web`,
        type: "microsoft.compute/virtualmachinescalesets",
        networkInterfaceConfigurations: [
          {
            name: "nic",
            properties: {
              ipConfigurations: [
                { properties: { subnet: { id: APPS_SUBNET } } },
                { properties: { subnet: { id: DATA_SUBNET } } },
              ],
            },
          },
        ],
      }),
    ).toEqual([
      ...runsIn(APPS_SUBNET),
      {
        kind: CloudRelationshipKind.RunsIn,
        target: DATA_SUBNET,
        targetType: AZURE_SUBNET_TYPE,
      },
    ]);
  });

  test("an application gateway, an internal load balancer, a firewall and an environment run in their subnets", () => {
    const gatewaySubnet: string = `${VNET}/subnets/gateway`;

    expect(
      relationshipsOf({
        id: `${RG}/providers/Microsoft.Network/applicationGateways/agw-1`,
        type: "microsoft.network/applicationgateways",
        gatewayIPConfigurations: [
          { properties: { subnet: { id: gatewaySubnet } } },
        ],
      }),
    ).toEqual(runsIn(gatewaySubnet));
    expect(
      relationshipsOf({
        id: `${RG}/providers/Microsoft.Network/loadBalancers/lb-internal`,
        type: "microsoft.network/loadbalancers",
        frontendIPConfigurations: [
          { properties: { subnet: { id: APPS_SUBNET } } },
          // A public frontend names an address, not a subnet.
          { properties: { publicIPAddress: { id: "pip" } } },
        ],
      }),
    ).toEqual(runsIn(APPS_SUBNET));
    expect(
      relationshipsOf({
        id: `${RG}/providers/Microsoft.Network/azureFirewalls/fw-1`,
        type: "microsoft.network/azurefirewalls",
        ipConfigurations: [
          {
            properties: {
              subnet: { id: `${VNET}/subnets/AzureFirewallSubnet` },
            },
          },
        ],
      }),
    ).toEqual(runsIn(`${VNET}/subnets/AzureFirewallSubnet`));
    expect(
      relationshipsOf({
        id: `${RG}/providers/Microsoft.App/managedEnvironments/env-1`,
        type: "microsoft.app/managedenvironments",
        infrastructureSubnetId: APPS_SUBNET,
      }),
    ).toEqual(runsIn(APPS_SUBNET));
  });

  test("a subnet the cloud names some other way is kept as written, with no network", () => {
    expect(
      relationshipsOf({
        id: `${RG}/providers/Microsoft.Web/sites/legacy`,
        type: "microsoft.web/sites",
        virtualNetworkSubnetId: "not-an-arm-id",
      }),
    ).toEqual([
      {
        kind: CloudRelationshipKind.RunsIn,
        target: "not-an-arm-id",
        targetType: AZURE_SUBNET_TYPE,
      },
    ]);
  });
});

describe("what a resource is part of, attached to and protected by", () => {
  test("a network interface is protected by its network security group", () => {
    const group: string = `${RG}/providers/Microsoft.Network/networkSecurityGroups/nsg-web`;

    expect(
      relationshipsOf({
        id: `${RG}/providers/Microsoft.Network/networkInterfaces/nic-1`,
        type: "microsoft.network/networkinterfaces",
        networkSecurityGroupId: group,
      }),
    ).toEqual([
      {
        kind: CloudRelationshipKind.ProtectedBy,
        target: group,
        targetType: "Microsoft.Network/networkSecurityGroups",
      },
    ]);
  });

  test("a database is part of its server and of the elastic pool it shares", () => {
    const server: string = `${RG}/providers/Microsoft.Sql/servers/sql-1`;
    const pool: string = `${server}/elasticPools/pool-1`;

    expect(
      relationshipsOf({
        id: `${server}/databases/orders`,
        type: "microsoft.sql/servers/databases",
        elasticPoolId: pool,
      }),
    ).toEqual([
      { kind: CloudRelationshipKind.PartOf, target: server },
      {
        kind: CloudRelationshipKind.PartOf,
        target: pool,
        targetType: "Microsoft.Sql/servers/elasticPools",
      },
    ]);
  });

  test("a container app is part of its environment", () => {
    const environment: string = `${RG}/providers/Microsoft.App/managedEnvironments/env-1`;

    expect(
      relationshipsOf({
        id: `${RG}/providers/Microsoft.App/containerApps/checkout`,
        type: "microsoft.app/containerapps",
        managedEnvironmentId: environment,
      }),
    ).toEqual([
      {
        kind: CloudRelationshipKind.PartOf,
        target: environment,
        targetType: "Microsoft.App/managedEnvironments",
      },
    ]);
  });

  test("a public IP is attached to its NAT gateway, and the gateway to the subnets it serves", () => {
    const nat: string = `${RG}/providers/Microsoft.Network/natGateways/nat-1`;

    expect(
      relationshipsOf({
        id: `${RG}/providers/Microsoft.Network/publicIPAddresses/pip-nat`,
        type: "microsoft.network/publicipaddresses",
        natGatewayId: nat,
      }),
    ).toEqual([
      {
        kind: CloudRelationshipKind.AttachedTo,
        target: nat,
        targetType: "Microsoft.Network/natGateways",
      },
    ]);
    expect(
      relationshipsOf({
        id: nat,
        type: "microsoft.network/natgateways",
        natGatewaySubnets: [{ id: APPS_SUBNET }, { id: DATA_SUBNET }],
      }),
    ).toEqual([
      {
        kind: CloudRelationshipKind.AttachedTo,
        target: APPS_SUBNET,
        targetType: AZURE_SUBNET_TYPE,
      },
      {
        kind: CloudRelationshipKind.AttachedTo,
        target: VNET,
        targetType: AZURE_VIRTUAL_NETWORK_TYPE,
      },
      {
        kind: CloudRelationshipKind.AttachedTo,
        target: DATA_SUBNET,
        targetType: AZURE_SUBNET_TYPE,
      },
    ]);
  });

  test("a row's relationships stay within the bound, however much it names", () => {
    const pools: Array<JSONObject> = [];

    for (let index: number = 0; index < CLOUD_RELATIONSHIPS_MAX + 20; index++) {
      pools.push({
        name: `pool-${index}`,
        vnetSubnetID: `${VNET}/subnets/s-${index}`,
      });
    }

    expect(
      relationshipsOf({
        id: `${RG}/providers/Microsoft.ContainerService/managedClusters/aks-big`,
        type: "microsoft.containerservice/managedclusters",
        agentPoolProfiles: pools,
      }).length,
    ).toBe(CLOUD_RELATIONSHIPS_MAX);
  });
});

describe("what the rows say read together", () => {
  const LB: string = `${RG}/providers/Microsoft.Network/loadBalancers/lb-web`;
  const AGW: string = `${RG}/providers/Microsoft.Network/applicationGateways/agw-shop`;
  const NIC: string = `${RG}/providers/Microsoft.Network/networkInterfaces/vm-web-1-nic`;
  const VMSS: string = `${RG}/providers/Microsoft.Compute/virtualMachineScaleSets/vmss-api`;
  const SHOP: string = `${RG}/providers/Microsoft.Web/sites/shop`;

  function rows(): Array<JSONObject> {
    return [
      {
        id: VM_ID,
        name: "vm-web-1",
        type: "microsoft.compute/virtualmachines",
        subscriptionId: SUBSCRIPTION,
        location: "westeurope",
      },
      {
        id: NIC,
        name: "vm-web-1-nic",
        type: "microsoft.network/networkinterfaces",
        subscriptionId: SUBSCRIPTION,
        location: "westeurope",
        // Resource Graph may write a reference in another case than the row's id.
        virtualMachineId: VM_ID.toLowerCase(),
        ipConfigurations: [
          {
            properties: {
              subnet: { id: APPS_SUBNET },
              loadBalancerBackendAddressPools: [
                { id: `${LB}/backendAddressPools/web` },
                { id: `${LB}/backendAddressPools/web-canary` },
              ],
              applicationGatewayBackendAddressPools: [
                { id: `${AGW}/backendAddressPools/vms` },
              ],
            },
          },
        ],
      },
      {
        id: VMSS,
        name: "vmss-api",
        type: "microsoft.compute/virtualmachinescalesets",
        subscriptionId: SUBSCRIPTION,
        location: "westeurope",
        networkInterfaceConfigurations: [
          {
            properties: {
              ipConfigurations: [
                {
                  properties: {
                    subnet: { id: APPS_SUBNET },
                    loadBalancerBackendAddressPools: [
                      { id: `${LB}/backendAddressPools/api` },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
      {
        id: LB,
        name: "lb-web",
        type: "microsoft.network/loadbalancers",
        subscriptionId: SUBSCRIPTION,
        location: "westeurope",
      },
      {
        id: AGW,
        name: "agw-shop",
        type: "microsoft.network/applicationgateways",
        subscriptionId: SUBSCRIPTION,
        location: "westeurope",
        gatewayBackendPools: [
          {
            properties: {
              backendAddresses: [
                { fqdn: "SHOP.azurewebsites.net" },
                { fqdn: "legacy.example.com" },
                { ipAddress: "10.0.1.4" },
              ],
            },
          },
        ],
      },
      {
        id: SHOP,
        name: "shop",
        type: "microsoft.web/sites",
        subscriptionId: SUBSCRIPTION,
        location: "westeurope",
        defaultHostName: "shop.azurewebsites.net",
      },
      {
        id: VNET,
        name: "vnet-prod",
        type: "microsoft.network/virtualnetworks",
        subscriptionId: SUBSCRIPTION,
        location: "westeurope",
      },
    ];
  }

  function itemOf(
    items: Array<CloudInventoryItem>,
    name: string,
  ): CloudInventoryItem {
    const item: CloudInventoryItem | undefined = items.find(
      (candidate: CloudInventoryItem): boolean => {
        return candidate.displayName === name;
      },
    );

    expect(item).toBeDefined();

    return item!;
  }

  test("a virtual machine runs in the subnet and network its interfaces run in", () => {
    const items: Array<CloudInventoryItem> = buildAzureInventoryItems(rows());

    expect(itemOf(items, "vm-web-1").relationships).toEqual([
      {
        kind: CloudRelationshipKind.RunsIn,
        target: `${VNET}/subnets/apps`,
        targetType: AZURE_SUBNET_TYPE,
      },
      {
        kind: CloudRelationshipKind.RunsIn,
        target: VNET,
        targetType: AZURE_VIRTUAL_NETWORK_TYPE,
      },
    ]);
  });

  test("a load balancer sends traffic to each interface and scale set in its pools, once each", () => {
    const items: Array<CloudInventoryItem> = buildAzureInventoryItems(rows());

    expect(itemOf(items, "lb-web").relationships).toEqual([
      {
        kind: CloudRelationshipKind.RoutesTo,
        target: NIC,
        targetType: "Microsoft.Network/networkInterfaces",
      },
      // And through the interface, to its machine (#9375).
      {
        kind: CloudRelationshipKind.RoutesTo,
        target: `${RG}/providers/Microsoft.Compute/virtualMachines/vm-web-1`,
        targetType: "Microsoft.Compute/virtualMachines",
      },
      {
        kind: CloudRelationshipKind.RoutesTo,
        target: VMSS,
        targetType: "Microsoft.Compute/virtualMachineScaleSets",
      },
    ]);
  });

  test("an application gateway sends traffic to the interfaces in its pools and to the app answering on a host they name", () => {
    const items: Array<CloudInventoryItem> = buildAzureInventoryItems(rows());

    expect(itemOf(items, "agw-shop").relationships).toEqual([
      {
        kind: CloudRelationshipKind.RoutesTo,
        target: NIC,
        targetType: "Microsoft.Network/networkInterfaces",
      },
      {
        kind: CloudRelationshipKind.RoutesTo,
        target: SHOP,
        targetType: "Microsoft.Web/sites",
      },
      // Nothing listed answers on these: kept as the gateway writes them.
      { kind: CloudRelationshipKind.RoutesTo, target: "legacy.example.com" },
      { kind: CloudRelationshipKind.RoutesTo, target: "10.0.1.4" },
    ]);
  });

  test("a host two listed resources answer on is never guessed", () => {
    const twins: Array<JSONObject> = [
      ...rows(),
      {
        id: `${RG}/providers/Microsoft.Web/sites/shop-staging`,
        name: "shop-staging",
        type: "microsoft.web/sites",
        subscriptionId: SUBSCRIPTION,
        hostNames: ["shop.azurewebsites.net"],
      },
    ];
    const items: Array<CloudInventoryItem> = buildAzureInventoryItems(twins);

    expect(itemOf(items, "agw-shop").relationships).toContainEqual({
      kind: CloudRelationshipKind.RoutesTo,
      target: "SHOP.azurewebsites.net",
    });
    expect(itemOf(items, "agw-shop").relationships).not.toContainEqual(
      expect.objectContaining({ target: SHOP }),
    );
  });

  test("a resource named by no other row keeps exactly what its own row says", () => {
    const items: Array<CloudInventoryItem> = buildAzureInventoryItems(rows());

    expect(itemOf(items, "shop").relationships).toEqual([]);
    expect(itemOf(items, "vm-web-1-nic").relationships).toEqual(
      buildAzureInventoryItem(rows()[1]!)!.relationships,
    );
  });

  test("a balancer or a machine the subscription does not list gains nothing, and a row naming nothing is left out", () => {
    const items: Array<CloudInventoryItem> = buildAzureInventoryItems([
      rows()[1]!,
      { name: "orphan" },
    ]);

    expect(items.length).toBe(1);
    expect(items[0]!.displayName).toBe("vm-web-1-nic");
  });

  test("on the account, each one resolves to the resource it names", () => {
    const items: Array<CloudInventoryItem> = buildAzureInventoryItems(rows());
    const linked: Array<CloudLinkedResource> = items.map(
      (item: CloudInventoryItem, index: number): CloudLinkedResource => {
        return {
          id: new ObjectID(
            `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          ),
          name: item.displayName || "",
          providerResourceId: item.resource.providerResourceId,
          type: item.resource.resourceType,
          relationships: item.relationships,
        };
      },
    );
    const nameOf: (id: string) => string = (id: string): string => {
      return (
        linked.find((resource: CloudLinkedResource): boolean => {
          return resource.id.toString() === id;
        })?.name || id
      );
    };
    const links: Array<string> = getCloudResourceLinks(linked).map(
      (link: CloudResourceLink): string => {
        return `${nameOf(link.fromId)} ${link.kind} ${nameOf(link.toId)}`;
      },
    );

    expect(links.sort()).toEqual(
      [
        "vm-web-1 runs-in vnet-prod",
        "vm-web-1-nic attached-to vm-web-1",
        "vm-web-1-nic runs-in vnet-prod",
        "vmss-api runs-in vnet-prod",
        "lb-web routes-to vm-web-1-nic",
        "lb-web routes-to vm-web-1",
        "lb-web routes-to vmss-api",
        "agw-shop routes-to vm-web-1-nic",
        "agw-shop routes-to shop",
      ].sort(),
    );
  });
});

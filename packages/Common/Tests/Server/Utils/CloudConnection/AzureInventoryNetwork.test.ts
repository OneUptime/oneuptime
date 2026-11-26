import { describe, expect, test } from "@jest/globals";
import AzureCloudConnector from "../../../../Server/Utils/CloudConnection/Azure/AzureCloudConnector";
import {
  AZURE_LISTED_ONLY_TYPES,
  AZURE_NETWORK_SECURITY_GROUP_TYPE,
  AZURE_NETWORK_SUBNET_COUNT_FIELD,
  AZURE_RESOURCE_GRAPH_MAX_EXPANDED_ROWS,
  AZURE_SUBNET_TYPE,
  AZURE_VIRTUAL_NETWORK_TYPE,
  buildAzureInventoryItem,
  buildAzureInventoryItems,
  buildAzureInventoryQuery,
  buildAzureSubnetQuery,
  describeAzureNetworksPastExpandedRows,
  getAzureNetworksPastExpandedRows,
  networkSecurityGroupRules,
} from "../../../../Server/Utils/CloudConnection/Azure/AzureInventory";
import {
  CloudConnectionSettings,
  CloudInventoryItem,
  CloudInventoryResult,
  CloudReadBudget,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import {
  CloudRelationshipKind,
  CloudResourceRelationship,
} from "../../../../Types/Cloud/CloudInventory";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  CloudResourceLink,
  getCloudResourceLinks,
} from "../../../../Types/Cloud/CloudResourceIndex";
import {
  getCloudResourceTypeDescriptor,
  isInventoryOnlyCloudResourceType,
} from "../../../../Types/Cloud/CloudResourceCatalog";
import {
  AZURE_APPLICATION_GATEWAY_WAF_POLICY_TYPE,
  AZURE_FRONT_DOOR_WAF_POLICY_TYPE,
} from "../../../../Types/CloudConnection/AzureWafBlocklist";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { AZURE_READ_ONLY_ROLE } from "../../../../Types/CloudConnection/CloudConnectionSetupCommands";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  FakeProviderApi,
  FakeResponse,
  bodyOf,
  createFakeProviderApi,
  json,
} from "../LlmObservability/FakeProviderApi";
import {
  RECORDED_PARSER_FAILURE,
  strictResourceGraph,
} from "./StrictResourceGraph";

/*
 * An Azure subscription's network, from Resource Graph (#9375), as a
 * Google Cloud project's (#9365) and an AWS account's are: its subnets -
 * read out of their virtual networks - and its network security groups
 * are Cloud Resources of their own; a virtual machine runs in its subnet
 * and is protected by the groups on its interfaces and its subnet; a load
 * balancer sends traffic through an interface to its machine; and an AKS
 * cluster's node scale sets are part of it. The fixtures are Resource
 * Graph rows as the inventory's queries project them.
 */

const SUB: string = "aaaaaaaa-0000-4000-8000-000000000001";
const RG: string = `/subscriptions/${SUB}/resourceGroups/rg-prod`;
const NODE_RG: string = `/subscriptions/${SUB}/resourceGroups/MC_rg-prod_aks-prod_westeurope`;
const VNET: string = `${RG}/providers/Microsoft.Network/virtualNetworks/vnet-prod`;
const APPS: string = `${VNET}/subnets/apps`;
const DATA: string = `${VNET}/subnets/data`;
const NSG_APPS: string = `${RG}/providers/Microsoft.Network/networkSecurityGroups/nsg-apps`;
const NSG_NIC: string = `${RG}/providers/Microsoft.Network/networkSecurityGroups/nsg-web`;
const ROUTES: string = `${RG}/providers/Microsoft.Network/routeTables/rt-apps`;
const VM: string = `${RG}/providers/Microsoft.Compute/virtualMachines/vm-web-1`;
const NIC: string = `${RG}/providers/Microsoft.Network/networkInterfaces/vm-web-1-nic`;
const LB: string = `${RG}/providers/Microsoft.Network/loadBalancers/lb-web`;
const AKS: string = `${RG}/providers/Microsoft.ContainerService/managedClusters/aks-prod`;
const NODE_VMSS: string = `${NODE_RG}/providers/Microsoft.Compute/virtualMachineScaleSets/aks-system-12345678-vmss`;
const AKS_VNET: string = `${NODE_RG}/providers/Microsoft.Network/virtualNetworks/aks-vnet-12345678`;
const AKS_SUBNET: string = `${AKS_VNET}/subnets/aks-subnet`;

function row(fields: JSONObject): JSONObject {
  return {
    subscriptionId: SUB,
    location: "westeurope",
    resourceGroup: "rg-prod",
    ...fields,
  };
}

function subnetRow(id: string, fields: JSONObject = {}): JSONObject {
  const parts: Array<string> = id.split("/");

  return row({
    id,
    name: `${parts[parts.length - 3]}/${parts[parts.length - 1]}`,
    type: "microsoft.network/virtualnetworks/subnets",
    provisioningState: "Succeeded",
    ...fields,
  });
}

const RULES: Array<JSONObject> = [
  {
    name: "allow-https",
    properties: {
      direction: "Inbound",
      access: "Allow",
      protocol: "Tcp",
      priority: 100,
      sourceAddressPrefix: "Internet",
      destinationPortRange: "443",
    },
  },
  {
    name: "allow-ssh-from-bastion",
    properties: {
      direction: "Inbound",
      access: "Allow",
      protocol: "Tcp",
      priority: 110,
      sourceAddressPrefixes: ["10.0.9.0/24", "10.0.10.0/24"],
      destinationPortRanges: ["22", "2222"],
    },
  },
  {
    name: "deny-all-in",
    properties: {
      direction: "Inbound",
      access: "Deny",
      protocol: "*",
      priority: 4096,
      sourceAddressPrefix: "*",
      destinationPortRange: "*",
    },
  },
  {
    name: "app-to-db",
    properties: {
      direction: "Outbound",
      access: "Allow",
      protocol: "Tcp",
      priority: 200,
      destinationApplicationSecurityGroups: [
        {
          id: `${RG}/providers/Microsoft.Network/applicationSecurityGroups/asg-db`,
        },
      ],
      destinationPortRange: "5432",
    },
  },
];

function rows(): Array<JSONObject> {
  return [
    row({
      id: VNET,
      name: "vnet-prod",
      type: "microsoft.network/virtualnetworks",
    }),
    subnetRow(APPS, {
      addressPrefix: "10.0.1.0/24",
      networkSecurityGroupId: NSG_APPS,
      routeTableId: ROUTES,
      delegations: [],
    }),
    subnetRow(DATA, {
      addressPrefixes: ["10.0.2.0/24", "fd00:db8::/64"],
      delegations: [
        {
          name: "flexible-servers",
          properties: {
            serviceName: "Microsoft.DBforPostgreSQL/flexibleServers",
          },
        },
      ],
    }),
    row({
      id: NSG_APPS,
      name: "nsg-apps",
      type: "microsoft.network/networksecuritygroups",
      securityRules: RULES,
    }),
    row({
      id: NSG_NIC,
      name: "nsg-web",
      type: "microsoft.network/networksecuritygroups",
      securityRules: [],
    }),
    row({
      id: VM,
      name: "vm-web-1",
      type: "microsoft.compute/virtualmachines",
    }),
    row({
      id: NIC,
      name: "vm-web-1-nic",
      type: "microsoft.network/networkinterfaces",
      virtualMachineId: VM,
      networkSecurityGroupId: NSG_NIC,
      ipConfigurations: [
        {
          id: `${NIC}/ipConfigurations/ipconfig1`,
          properties: {
            subnet: { id: APPS },
            loadBalancerBackendAddressPools: [
              { id: `${LB}/backendAddressPools/web` },
            ],
          },
        },
      ],
    }),
    row({
      id: LB,
      name: "lb-web",
      type: "microsoft.network/loadbalancers",
    }),
    row({
      id: AKS,
      name: "aks-prod",
      type: "microsoft.containerservice/managedclusters",
      nodeResourceGroup: "MC_rg-prod_aks-prod_westeurope",
      agentPoolProfiles: [{ name: "system" }],
    }),
    row({
      id: NODE_VMSS,
      name: "aks-system-12345678-vmss",
      type: "microsoft.compute/virtualmachinescalesets",
      resourceGroup: "MC_rg-prod_aks-prod_westeurope",
      networkInterfaceConfigurations: [
        {
          name: "aks-system-12345678-vmss",
          properties: {
            networkSecurityGroup: {
              id: `${NODE_RG}/providers/Microsoft.Network/networkSecurityGroups/aks-agentpool-nsg`,
            },
            ipConfigurations: [
              { name: "ipconfig1", properties: { subnet: { id: AKS_SUBNET } } },
            ],
          },
        },
      ],
    }),
  ];
}

function itemOf(
  items: Array<CloudInventoryItem>,
  name: string,
): CloudInventoryItem {
  const found: CloudInventoryItem | undefined = items.find(
    (item: CloudInventoryItem): boolean => {
      return item.displayName === name;
    },
  );

  expect({ name, found: Boolean(found) }).toEqual({ name, found: true });

  return found!;
}

describe("the subnet query", () => {
  const query: string = buildAzureSubnetQuery().toString();

  test("reads each virtual network's subnets, one row each, shaped as the main query's rows", () => {
    expect(query).toContain(
      "| where type =~ 'microsoft.network/virtualnetworks'",
    );
    // What it expands first, its row limit - Resource Graph's most - last (#11142).
    expect(query).toContain(
      `| mv-expand subnet = properties.subnets limit ${AZURE_RESOURCE_GRAPH_MAX_EXPANDED_ROWS}`,
    );
    expect(AZURE_RESOURCE_GRAPH_MAX_EXPANDED_ROWS).toBe(2000);
    expect(query).not.toContain("mv-expand limit");
    expect(query).toContain(
      "| project id = tostring(subnet.id), name = strcat(name, '/', tostring(subnet.name)), type = 'microsoft.network/virtualnetworks/subnets', location, resourceGroup, subscriptionId,",
    );

    for (const field of [
      "addressPrefix = tostring(subnet.properties.addressPrefix)",
      "addressPrefixes = subnet.properties.addressPrefixes",
      "networkSecurityGroupId = tostring(subnet.properties.networkSecurityGroup.id)",
      "routeTableId = tostring(subnet.properties.routeTable.id)",
      "delegations = subnet.properties.delegations",
      // How many subnets the row's network holds: more than it expands says some went unlisted.
      `${AZURE_NETWORK_SUBNET_COUNT_FIELD} = array_length(properties.subnets)`,
    ]) {
      expect(query).toContain(field);
    }
  });

  test("never the interfaces a subnet lists, nor a quote but a type's name", () => {
    expect(query).not.toContain("ipConfigurations");
    expect(query).not.toContain('"');

    for (const literal of (query.match(/'[^']*'/g) || []).map(
      (quoted: string): string => {
        return quoted.slice(1, -1);
      },
    )) {
      expect([
        "microsoft.network/virtualnetworks",
        "microsoft.network/virtualnetworks/subnets",
        "/",
      ]).toContain(literal);
    }
  });

  test("the main query lists network security groups, with their rules and a cluster's node resource group", () => {
    const main: string = buildAzureInventoryQuery().toString();

    expect(main).toContain("'microsoft.network/networksecuritygroups'");
    expect(main).toContain(
      "securityRules = iff(type =~ 'microsoft.network/networksecuritygroups', properties.securityRules, dynamic(null))",
    );
    expect(main).toContain(
      "nodeResourceGroup = tostring(properties.nodeResourceGroup)",
    );
    // Azure's own default rules are not read.
    expect(main).not.toContain("defaultSecurityRules");
  });
});

describe("a subnet", () => {
  test("is identified by its ARM id, named after its network, and runs in that network", () => {
    const subnet: CloudInventoryItem = buildAzureInventoryItem(
      subnetRow(APPS, {
        addressPrefix: "10.0.1.0/24",
        networkSecurityGroupId: NSG_APPS,
        routeTableId: ROUTES,
      }),
    )!;

    expect(subnet.resource).toEqual(
      expect.objectContaining({
        provider: CloudProvider.Azure,
        resourceType: AZURE_SUBNET_TYPE,
        name: "vnet-prod/apps",
        providerResourceId: APPS,
        accountId: SUB,
        region: "westeurope",
        resourceGroup: "rg-prod",
        identityKey: `azure|${APPS.toLowerCase()}`,
      }),
    );
    expect(subnet.properties).toEqual({
      provisioningState: "Succeeded",
      addressPrefix: "10.0.1.0/24",
    });
    expect(subnet.relationships).toEqual([
      {
        kind: CloudRelationshipKind.RunsIn,
        target: VNET,
        targetType: AZURE_VIRTUAL_NETWORK_TYPE,
      },
      {
        kind: CloudRelationshipKind.ProtectedBy,
        target: NSG_APPS,
        targetType: AZURE_NETWORK_SECURITY_GROUP_TYPE,
      },
      {
        kind: CloudRelationshipKind.AttachedTo,
        target: ROUTES,
        targetType: "Microsoft.Network/routeTables",
      },
    ]);
    // In its network, never "part of" it as well.
    expect(
      subnet.relationships.filter((relationship: CloudResourceRelationship) => {
        return relationship.kind === CloudRelationshipKind.PartOf;
      }),
    ).toEqual([]);
  });

  test("keeps its ranges and the services it is delegated to", () => {
    expect(
      buildAzureInventoryItem(
        subnetRow(DATA, {
          addressPrefixes: ["10.0.2.0/24", "fd00:db8::/64"],
          delegations: [
            {
              properties: {
                serviceName: "Microsoft.DBforPostgreSQL/flexibleServers",
              },
            },
          ],
        }),
      )!.properties,
    ).toEqual({
      provisioningState: "Succeeded",
      addressPrefixes: ["10.0.2.0/24", "fd00:db8::/64"],
      delegatedTo: ["Microsoft.DBforPostgreSQL/flexibleServers"],
    });
  });
});

describe("a network security group", () => {
  test("keeps its rules one line each, by priority, and nothing of them raw", () => {
    const group: CloudInventoryItem = buildAzureInventoryItem(
      row({
        id: NSG_APPS,
        name: "nsg-apps",
        type: "microsoft.network/networksecuritygroups",
        securityRules: RULES,
      }),
    )!;

    expect(group.resource.resourceType).toBe(AZURE_NETWORK_SECURITY_GROUP_TYPE);
    expect(group.properties).toEqual({
      inbound: [
        "Allow tcp:443 from Internet (100)",
        "Allow tcp:22,2222 from 10.0.9.0/24, 10.0.10.0/24 (110)",
        "Deny all from * (4096)",
      ],
      outbound: ["Allow tcp:5432 to asg-db (200)"],
    });
    expect(Object.keys(group.properties)).not.toContain("securityRules");
  });

  test.each([
    ["no rules", undefined, []],
    ["not a list", "Allow all", []],
    [
      "a rule of the other direction",
      [{ properties: { direction: "Outbound", protocol: "Udp" } }],
      [],
    ],
    [
      "a rule with no priority, protocol or peer",
      [{ properties: { direction: "Inbound" } }],
      ["Allow all from *"],
    ],
  ])("%s", (_name: string, rules: unknown, expected: Array<string>) => {
    expect(networkSecurityGroupRules(rules, "Inbound")).toEqual(expected);
  });
});

describe("what the rows say read together", () => {
  test("a virtual machine runs in its interface's subnet and network, protected by the groups on the interface and on the subnet", () => {
    const items: Array<CloudInventoryItem> = buildAzureInventoryItems(rows());

    expect(itemOf(items, "vm-web-1").relationships).toEqual([
      {
        kind: CloudRelationshipKind.RunsIn,
        target: APPS,
        targetType: AZURE_SUBNET_TYPE,
      },
      {
        kind: CloudRelationshipKind.RunsIn,
        target: VNET,
        targetType: AZURE_VIRTUAL_NETWORK_TYPE,
      },
      {
        kind: CloudRelationshipKind.ProtectedBy,
        target: NSG_NIC,
        targetType: AZURE_NETWORK_SECURITY_GROUP_TYPE,
      },
      {
        kind: CloudRelationshipKind.ProtectedBy,
        target: NSG_APPS,
        targetType: AZURE_NETWORK_SECURITY_GROUP_TYPE,
      },
    ]);
  });

  test("an interface is protected by its subnet's group too", () => {
    const items: Array<CloudInventoryItem> = buildAzureInventoryItems(rows());

    expect(itemOf(items, "vm-web-1-nic").relationships).toEqual(
      expect.arrayContaining([
        {
          kind: CloudRelationshipKind.ProtectedBy,
          target: NSG_NIC,
          targetType: AZURE_NETWORK_SECURITY_GROUP_TYPE,
        },
        {
          kind: CloudRelationshipKind.ProtectedBy,
          target: NSG_APPS,
          targetType: AZURE_NETWORK_SECURITY_GROUP_TYPE,
        },
      ]),
    );
  });

  test("a load balancer sends traffic to the interface in its pool and to the machine behind it", () => {
    const items: Array<CloudInventoryItem> = buildAzureInventoryItems(rows());

    expect(itemOf(items, "lb-web").relationships).toEqual([
      {
        kind: CloudRelationshipKind.RoutesTo,
        target: NIC,
        targetType: "Microsoft.Network/networkInterfaces",
      },
      {
        kind: CloudRelationshipKind.RoutesTo,
        target: VM,
        targetType: "Microsoft.Compute/virtualMachines",
      },
    ]);
  });

  test("an AKS cluster's node scale set is part of it, guarded by the group on its interfaces; a cluster on AKS's own network runs where its nodes do", () => {
    const items: Array<CloudInventoryItem> = buildAzureInventoryItems(rows());

    expect(itemOf(items, "aks-system-12345678-vmss").relationships).toEqual(
      expect.arrayContaining([
        {
          kind: CloudRelationshipKind.PartOf,
          target: AKS,
          targetType: "Microsoft.ContainerService/managedClusters",
        },
        {
          kind: CloudRelationshipKind.ProtectedBy,
          target: `${NODE_RG}/providers/Microsoft.Network/networkSecurityGroups/aks-agentpool-nsg`,
          targetType: AZURE_NETWORK_SECURITY_GROUP_TYPE,
        },
        {
          kind: CloudRelationshipKind.RunsIn,
          target: AKS_SUBNET,
          targetType: AZURE_SUBNET_TYPE,
        },
      ]),
    );
    expect(itemOf(items, "aks-prod").relationships).toEqual([
      {
        kind: CloudRelationshipKind.RunsIn,
        target: AKS_SUBNET,
        targetType: AZURE_SUBNET_TYPE,
      },
      {
        kind: CloudRelationshipKind.RunsIn,
        target: AKS_VNET,
        targetType: AZURE_VIRTUAL_NETWORK_TYPE,
      },
    ]);
  });

  test("a cluster on a subnet of its own keeps it; a node resource group two clusters name is never a guess", () => {
    const own: Array<JSONObject> = rows().map((entry: JSONObject) => {
      return entry["id"] === AKS
        ? { ...entry, agentPoolProfiles: [{ vnetSubnetID: APPS }] }
        : entry;
    });

    expect(
      itemOf(buildAzureInventoryItems(own), "aks-prod").relationships,
    ).toEqual([
      {
        kind: CloudRelationshipKind.RunsIn,
        target: APPS,
        targetType: AZURE_SUBNET_TYPE,
      },
      {
        kind: CloudRelationshipKind.RunsIn,
        target: VNET,
        targetType: AZURE_VIRTUAL_NETWORK_TYPE,
      },
    ]);

    const twice: Array<JSONObject> = [
      ...rows(),
      row({
        id: `${RG}/providers/Microsoft.ContainerService/managedClusters/aks-copy`,
        name: "aks-copy",
        type: "microsoft.containerservice/managedclusters",
        nodeResourceGroup: "mc_rg-prod_aks-prod_westeurope",
      }),
    ];

    expect(
      itemOf(
        buildAzureInventoryItems(twice),
        "aks-system-12345678-vmss",
      ).relationships.filter((relationship: CloudResourceRelationship) => {
        return relationship.kind === CloudRelationshipKind.PartOf;
      }),
    ).toEqual([]);
  });

  test("on the account, each one resolves to the resource it names", () => {
    const items: Array<CloudInventoryItem> = buildAzureInventoryItems(rows());
    const ids: Map<CloudInventoryItem, ObjectID> = new Map(
      items.map((entry: CloudInventoryItem) => {
        return [entry, ObjectID.generate()];
      }),
    );
    const nameOf: Map<string, string> = new Map(
      items.map((entry: CloudInventoryItem) => {
        return [ids.get(entry)!.toString(), entry.displayName || ""];
      }),
    );
    const links: Array<string> = getCloudResourceLinks(
      items.map((entry: CloudInventoryItem) => {
        return {
          id: ids.get(entry)!,
          name: entry.resource.name,
          providerResourceId: entry.resource.providerResourceId,
          type: entry.resource.resourceType,
          relationships: entry.relationships,
        };
      }),
    ).map((link: CloudResourceLink): string => {
      return `${nameOf.get(link.fromId)} ${link.kind} ${nameOf.get(link.toId)}`;
    });

    expect(links.sort()).toEqual(
      [
        "vnet-prod/apps runs-in vnet-prod",
        "vnet-prod/data runs-in vnet-prod",
        "vnet-prod/apps protected-by nsg-apps",
        "vm-web-1 runs-in vnet-prod/apps",
        "vm-web-1 runs-in vnet-prod",
        "vm-web-1 protected-by nsg-web",
        "vm-web-1 protected-by nsg-apps",
        "vm-web-1-nic attached-to vm-web-1",
        "vm-web-1-nic runs-in vnet-prod/apps",
        "vm-web-1-nic runs-in vnet-prod",
        "vm-web-1-nic protected-by nsg-web",
        "vm-web-1-nic protected-by nsg-apps",
        "lb-web routes-to vm-web-1-nic",
        "lb-web routes-to vm-web-1",
        "aks-system-12345678-vmss part-of aks-prod",
      ].sort(),
    );
  });
});

describe("the catalog and the role", () => {
  test("subnets, network security groups and WAF policies are listed as resources with no metrics of their own", () => {
    expect(AZURE_LISTED_ONLY_TYPES).toEqual([
      AZURE_NETWORK_SECURITY_GROUP_TYPE,
      AZURE_SUBNET_TYPE,
      // The WAF policies the blocklist can be enforced in (#10348).
      AZURE_APPLICATION_GATEWAY_WAF_POLICY_TYPE,
      AZURE_FRONT_DOOR_WAF_POLICY_TYPE,
    ]);

    for (const type of AZURE_LISTED_ONLY_TYPES) {
      expect(isInventoryOnlyCloudResourceType(CloudProvider.Azure, type)).toBe(
        true,
      );
    }

    expect(
      getCloudResourceTypeDescriptor(CloudProvider.Azure, AZURE_SUBNET_TYPE)
        ?.label,
    ).toBe("Virtual Network Subnet");
    expect(
      getCloudResourceTypeDescriptor(
        CloudProvider.Azure,
        AZURE_NETWORK_SECURITY_GROUP_TYPE,
      )?.label,
    ).toBe("Network Security Group");
  });

  test("Monitoring Reader reads them: the role is unchanged", () => {
    expect(AZURE_READ_ONLY_ROLE).toBe("Monitoring Reader");
  });
});

const TENANT: string = "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c";
const CLIENT: string = "00001111-aaaa-2222-bbbb-3333cccc4444";
const connector: AzureCloudConnector = new AzureCloudConnector();

function settings(): CloudConnectionSettings {
  return {
    provider: CloudProvider.Azure,
    projectId: "11111111-1111-4111-8111-111111111111",
    config: {
      authMethod: CloudConnectionAuthMethod.AzureClientSecret,
      tenantId: TENANT,
      clientId: CLIENT,
      cloud: "public",
    },
    secrets: { clientSecret: "client-secret~value" },
  };
}

interface FakeGraph extends FakeProviderApi {
  queries: Array<string>;
}

/*
 * Resource Graph, reading each query it is sent as Azure would
 * (StrictResourceGraph): a query Azure refuses is refused here too, with
 * Azure's answer, before the suite's rows are given (#11142).
 */
function createFakeGraph(options: {
  main: Array<JSONObject>;
  subnets: Array<JSONObject>;
  subnetError?: FakeResponse | undefined;
  // The subscriptions the app may read: the one production subscription unless said.
  subscriptions?: Array<JSONObject> | undefined;
}): FakeGraph {
  const queries: Array<string> = [];

  return {
    ...createFakeProviderApi([
      {
        host: "login.microsoftonline.com",
        path: `/${TENANT}/oauth2/v2.0/token`,
        method: "POST",
        respond: (): FakeResponse => {
          return json({ access_token: "azure-access-token", expires_in: 3599 });
        },
      },
      {
        host: "management.azure.com",
        path: "/subscriptions",
        respond: (): FakeResponse => {
          return json({
            value: options.subscriptions || [
              {
                subscriptionId: SUB,
                displayName: "Production",
                state: "Enabled",
              },
            ],
          });
        },
      },
      {
        host: "management.azure.com",
        path: "/providers/Microsoft.ResourceGraph/resources",
        method: "POST",
        respond: (
          request: DataSourceHttpRequest,
        ): FakeResponse | Promise<FakeResponse> => {
          const query: string = String(bodyOf(request)["query"]);
          queries.push(query);

          if (query.includes("mv-expand") && options.subnetError) {
            return options.subnetError;
          }

          return strictResourceGraph((): FakeResponse => {
            return json({
              data: query.includes("mv-expand")
                ? options.subnets
                : options.main,
            });
          })(request, new URL(request.url));
        },
      },
    ]),
    queries,
  };
}

async function readInventory(fake: FakeGraph): Promise<CloudInventoryResult> {
  return await connector.readInventory(settings(), {
    transport: fake.transport,
    now: () => {
      return new Date("2026-11-17T12:07:00Z");
    },
    sleep: async () => {},
    state: {},
    connectionId: "33333333-3333-4333-8333-333333333333",
    budget: new CloudReadBudget({ maxRequests: 100, maxDurationMs: 60000 }),
  });
}

describe("a subscription's inventory, against a Resource Graph that reads its queries", () => {
  const all: Array<JSONObject> = rows();
  const main: Array<JSONObject> = all.filter((entry: JSONObject) => {
    return entry["type"] !== "microsoft.network/virtualnetworks/subnets";
  });
  const subnets: Array<JSONObject> = all.filter((entry: JSONObject) => {
    return entry["type"] === "microsoft.network/virtualnetworks/subnets";
  });

  test("asks for the resources and the subnets, and lists both, each listed in full", async () => {
    const fake: FakeGraph = createFakeGraph({ main, subnets });
    const result: CloudInventoryResult = await readInventory(fake);

    expect(fake.queries).toEqual([
      buildAzureInventoryQuery().toString(),
      buildAzureSubnetQuery().toString(),
    ]);
    expect(
      result.items
        .filter((entry: CloudInventoryItem): boolean => {
          return (
            entry.resource.resourceType === AZURE_SUBNET_TYPE ||
            entry.resource.resourceType === AZURE_NETWORK_SECURITY_GROUP_TYPE
          );
        })
        .map((entry: CloudInventoryItem): string => {
          return `${entry.resource.resourceType} ${entry.displayName}`;
        })
        .sort(),
    ).toEqual(
      [
        `${AZURE_SUBNET_TYPE} vnet-prod/apps`,
        `${AZURE_SUBNET_TYPE} vnet-prod/data`,
        `${AZURE_NETWORK_SECURITY_GROUP_TYPE} nsg-apps`,
        `${AZURE_NETWORK_SECURITY_GROUP_TYPE} nsg-web`,
      ].sort(),
    );
    // Read across the queries: the machine is guarded by its subnet's group.
    expect(itemOf(result.items, "vm-web-1").relationships).toContainEqual({
      kind: CloudRelationshipKind.ProtectedBy,
      target: NSG_APPS,
      targetType: AZURE_NETWORK_SECURITY_GROUP_TYPE,
    });
    expect(result.warnings).toEqual([]);
    expect(result.completelyListed).toEqual([
      {
        accountId: SUB,
        resourceTypes: expect.arrayContaining([
          AZURE_SUBNET_TYPE,
          AZURE_NETWORK_SECURITY_GROUP_TYPE,
          "Microsoft.Compute/virtualMachines",
        ]),
      },
    ]);
  });

  test("a subnet query that fails is a warning: the rest is listed, and no subnet is taken for gone", async () => {
    // Azure's answer to the subnet query of 16.0.0, as the customer's report recorded it (#11142).
    const fake: FakeGraph = createFakeGraph({
      main,
      subnets,
      subnetError: json(RECORDED_PARSER_FAILURE, 400),
    });
    const result: CloudInventoryResult = await readInventory(fake);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(
      "Could not list the subnets: Azure resource graph query failed with HTTP 400",
    );
    expect(result.warnings[0]).toContain("ParserFailure");
    expect(
      result.items.some((entry: CloudInventoryItem): boolean => {
        return entry.resource.resourceType === AZURE_SUBNET_TYPE;
      }),
    ).toBe(false);
    expect(result.completelyListed[0]!.resourceTypes).not.toContain(
      AZURE_SUBNET_TYPE,
    );
    expect(result.completelyListed[0]!.resourceTypes).toContain(
      AZURE_NETWORK_SECURITY_GROUP_TYPE,
    );
  });

  /*
   * The customer's connection (#11142): every subscription in the tenant
   * (no subscriptions named), tested from the connection's Test step. The
   * subscriptions go into the request, never into the query's text, and
   * each one's subnets are listed.
   */
  test("every subscription in the tenant: both queries go to every subscription, and each one's subnets are listed with nothing warned", async () => {
    const STAGING: string = "aaaaaaaa-0000-4000-8000-000000000002";
    const STAGING_VNET: string = `/subscriptions/${STAGING}/resourceGroups/rg-staging/providers/Microsoft.Network/virtualNetworks/vnet-staging`;
    const STAGING_SUBNET: string = `${STAGING_VNET}/subnets/apps`;
    const fake: FakeGraph = createFakeGraph({
      main: [
        ...main,
        row({
          id: STAGING_VNET,
          name: "vnet-staging",
          type: "microsoft.network/virtualnetworks",
          subscriptionId: STAGING,
          resourceGroup: "rg-staging",
        }),
      ],
      subnets: [
        ...subnets,
        subnetRow(STAGING_SUBNET, {
          subscriptionId: STAGING,
          resourceGroup: "rg-staging",
          addressPrefix: "10.1.0.0/24",
        }),
      ],
      subscriptions: [
        { subscriptionId: SUB, displayName: "Production", state: "Enabled" },
        { subscriptionId: STAGING, displayName: "Staging", state: "Enabled" },
        {
          subscriptionId: "aaaaaaaa-0000-4000-8000-000000000003",
          displayName: "Retired",
          state: "Disabled",
        },
      ],
    });
    const result: CloudInventoryResult = await readInventory(fake);
    const graph: Array<DataSourceHttpRequest> = fake.requestsTo(
      "/providers/Microsoft.ResourceGraph/resources",
    );

    expect(graph).toHaveLength(2);

    for (const request of graph) {
      expect(bodyOf(request)["subscriptions"]).toEqual([SUB, STAGING]);
      expect(String(bodyOf(request)["query"])).not.toContain(SUB);
      expect(String(bodyOf(request)["query"])).not.toContain(STAGING);
    }

    expect(result.warnings).toEqual([]);
    expect(result.accounts).toEqual([
      { accountId: SUB, name: "Production" },
      { accountId: STAGING, name: "Staging" },
    ]);
    expect(
      result.items
        .filter((entry: CloudInventoryItem): boolean => {
          return entry.resource.resourceType === AZURE_SUBNET_TYPE;
        })
        .map((entry: CloudInventoryItem): string => {
          return entry.displayName || "";
        })
        .sort(),
    ).toEqual(["vnet-prod/apps", "vnet-prod/data", "vnet-staging/apps"]);

    for (const listed of result.completelyListed) {
      expect(listed.resourceTypes).toContain(AZURE_SUBNET_TYPE);
    }

    expect(
      result.completelyListed.map((listed: { accountId: string }): string => {
        return listed.accountId;
      }),
    ).toEqual([SUB, STAGING]);
  });

  /*
   * Azure lets a virtual network hold 3,000 subnets, and Resource Graph
   * expands 2,000 of one row: the rest of a larger network's are not
   * listed, so the subnets are not listed in full and none is taken for
   * gone, and the inventory says which network.
   */
  test("a network of more subnets than Resource Graph expands: its subnets are listed as far as they go, none taken for gone, and the network named", async () => {
    const crowded: Array<JSONObject> = subnets.map(
      (entry: JSONObject): JSONObject => {
        return { ...entry, [AZURE_NETWORK_SUBNET_COUNT_FIELD]: 2400 };
      },
    );
    const result: CloudInventoryResult = await readInventory(
      createFakeGraph({ main, subnets: crowded }),
    );

    expect(result.warnings).toEqual([
      "The virtual network vnet-prod has 2400 subnets: the first 2000 are listed, the most Resource Graph lists of one network.",
    ]);
    expect(
      result.items
        .filter((entry: CloudInventoryItem): boolean => {
          return entry.resource.resourceType === AZURE_SUBNET_TYPE;
        })
        .map((entry: CloudInventoryItem): string => {
          return entry.displayName || "";
        })
        .sort(),
    ).toEqual(["vnet-prod/apps", "vnet-prod/data"]);
    expect(result.completelyListed[0]!.resourceTypes).not.toContain(
      AZURE_SUBNET_TYPE,
    );
    expect(result.completelyListed[0]!.resourceTypes).toContain(
      AZURE_NETWORK_SECURITY_GROUP_TYPE,
    );
    // The count is read, never kept as a property of the subnet.
    expect(
      Object.keys(itemOf(result.items, "vnet-prod/apps").properties || {}),
    ).not.toContain(AZURE_NETWORK_SUBNET_COUNT_FIELD);
  });

  test("a network of exactly as many subnets as Resource Graph expands is listed in full", async () => {
    const full: Array<JSONObject> = subnets.map(
      (entry: JSONObject): JSONObject => {
        return {
          ...entry,
          [AZURE_NETWORK_SUBNET_COUNT_FIELD]:
            AZURE_RESOURCE_GRAPH_MAX_EXPANDED_ROWS,
        };
      },
    );
    const result: CloudInventoryResult = await readInventory(
      createFakeGraph({ main, subnets: full }),
    );

    expect(result.warnings).toEqual([]);
    expect(result.completelyListed[0]!.resourceTypes).toContain(
      AZURE_SUBNET_TYPE,
    );
  });
});

describe("the networks whose subnets were not all listed", () => {
  const NETWORK: string = `${RG}/providers/Microsoft.Network/virtualNetworks`;

  function counted(
    network: string,
    subnet: string,
    count: unknown,
  ): JSONObject {
    return subnetRow(`${NETWORK}/${network}/subnets/${subnet}`, {
      [AZURE_NETWORK_SUBNET_COUNT_FIELD]: count as never,
    });
  }

  test("are each named once, the most subnets first, and a network within the limit is not one", () => {
    expect(
      getAzureNetworksPastExpandedRows([
        counted("vnet-a", "s1", 2001),
        counted("vnet-a", "s2", 2001),
        counted("vnet-b", "s1", 3000),
        counted("vnet-c", "s1", 2000),
        counted("vnet-d", "s1", 12),
        counted("vnet-e", "s1", "2400"),
        subnetRow(`${NETWORK}/vnet-f/subnets/s1`),
      ]),
    ).toEqual([
      { name: "vnet-b", subnets: 3000 },
      { name: "vnet-a", subnets: 2001 },
    ]);
  });

  test("are none when no row counts more than Resource Graph expands", () => {
    expect(getAzureNetworksPastExpandedRows([])).toEqual([]);
    expect(
      getAzureNetworksPastExpandedRows([counted("vnet-a", "s1", 1)]),
    ).toEqual([]);
  });

  test("are said in one warning, naming five at most", () => {
    expect(describeAzureNetworksPastExpandedRows([])).toBe("");
    expect(
      describeAzureNetworksPastExpandedRows([
        { name: "vnet-b", subnets: 3000 },
        { name: "vnet-a", subnets: 2001 },
      ]),
    ).toBe(
      "2 virtual networks have more than 2000 subnets (vnet-b 3000, vnet-a 2001): the first 2000 of each are listed, the most Resource Graph lists of one network.",
    );
    expect(
      describeAzureNetworksPastExpandedRows(
        ["a", "b", "c", "d", "e", "f", "g"].map(
          (name: string): { name: string; subnets: number } => {
            return { name: `vnet-${name}`, subnets: 2500 };
          },
        ),
      ),
    ).toBe(
      "7 virtual networks have more than 2000 subnets (vnet-a 2500, vnet-b 2500, vnet-c 2500, vnet-d 2500, vnet-e 2500 and 2 more): the first 2000 of each are listed, the most Resource Graph lists of one network.",
    );
  });
});

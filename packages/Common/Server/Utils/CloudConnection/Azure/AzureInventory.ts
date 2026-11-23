import {
  CloudRelationshipKind,
  CloudResourceRelationship,
  boundCloudRelationships,
  normalizeCloudEndpoints,
  normalizeCloudHost,
  normalizeCloudTags,
  pickCloudProperties,
  readCloudPath,
} from "../../../../Types/Cloud/CloudInventory";
import {
  AZURE_MONITOR_RESOURCE_ID_ATTRIBUTE,
  AZURE_MONITOR_SUBSCRIPTION_ID_ATTRIBUTE,
  CloudMonitoredResource,
  parseAzureResourceId,
  resolveCloudMonitoredResource,
} from "../../../../Types/Cloud/CloudMonitoredResource";
import {
  AZURE_RESOURCE_TYPES,
  CloudResourceTypeDescriptor,
} from "../../../../Types/Cloud/CloudResourceCatalog";
import {
  AZURE_APPLICATION_GATEWAY_WAF_POLICY_TYPE,
  AZURE_FRONT_DOOR_WAF_POLICY_TYPE,
} from "../../../../Types/CloudConnection/AzureWafBlocklist";
import { JSONObject } from "../../../../Types/JSON";
import { CloudInventoryItem } from "../CloudConnectorTypes";

/*
 * AN AZURE SUBSCRIPTION'S INVENTORY, from one Azure Resource Graph query:
 * every resource of the types OneUptime knows (CloudResourceCatalog's
 * AZURE_RESOURCE_TYPES), with its tags, a few properties, what it is part
 * of, attached to, runs in, is protected by and sends traffic to, and the
 * host names it answers on.
 *
 * Azure lists a subnet inside its virtual network, never as a resource of
 * its own, so whatever runs in a subnet - a network interface, an app's
 * VNet integration, a private endpoint, a cluster's node pool - runs in
 * that subnet's virtual network too, which the account does hold. What one
 * row cannot say alone is read across the rows (buildAzureInventoryItems):
 * a virtual machine runs where its network interfaces do, and a load
 * balancer or an application gateway sends traffic to the interfaces,
 * scale sets and apps in its backend pools.
 *
 * The query projects only the fields kept (AZURE_INVENTORY_QUERY), so a
 * subscription of thousands of resources is a few pages, and nothing a
 * resource's properties hold beyond them - a connection string, an app
 * setting - ever leaves Azure. Monitoring Reader may run it: Resource
 * Graph answers with what the app may read.
 *
 * Each row is identified the way its Azure Monitor metrics are - by its ARM
 * id, through ingest's own resolver - so a listed resource and the one its
 * metrics name are one row.
 */

// The properties a resource keeps, as the query names them.
export const AZURE_INVENTORY_PROPERTIES: ReadonlyArray<string> = [
  "kind",
  "skuName",
  "skuTier",
  "provisioningState",
  "state",
  "vmSize",
  "powerState",
  "osType",
  "version",
  // A subnet's ranges and what it is delegated to (#9375).
  "addressPrefix",
  "addressPrefixes",
  "delegatedTo",
  // A network security group's rules, one line each (#9375).
  "inbound",
  "outbound",
  /*
   * A managed disk's size in GiB (properties.diskSizeGB), so its page says
   * how big it is (#9648): one more column of the same query, no call.
   */
  "diskSizeGB",
];

// The fields a resource's host names are read from, as the query names them.
const ENDPOINT_FIELDS: ReadonlyArray<string> = [
  "defaultHostName",
  "fullyQualifiedDomainName",
  "fqdn",
  "dnsFqdn",
  "ipAddress",
  "hostName",
  "documentEndpoint",
  "gatewayUrl",
  "ingressFqdn",
  "primaryWeb",
  "primaryBlob",
  "cname",
];

// The ARM types the relationships name, as CloudResourceCatalog spells them.
export const AZURE_SUBNET_TYPE: string =
  "Microsoft.Network/virtualNetworks/subnets";
export const AZURE_VIRTUAL_NETWORK_TYPE: string =
  "Microsoft.Network/virtualNetworks";
const AZURE_VIRTUAL_MACHINE_TYPE: string = "Microsoft.Compute/virtualMachines";
const AZURE_NETWORK_INTERFACE_TYPE: string =
  "Microsoft.Network/networkInterfaces";
const AZURE_SCALE_SET_TYPE: string =
  "Microsoft.Compute/virtualMachineScaleSets";
const AZURE_APPLICATION_GATEWAY_TYPE: string =
  "Microsoft.Network/applicationGateways";
export const AZURE_NETWORK_SECURITY_GROUP_TYPE: string =
  "Microsoft.Network/networkSecurityGroups";
const AZURE_MANAGED_CLUSTER_TYPE: string =
  "Microsoft.ContainerService/managedClusters";
const AZURE_LOAD_BALANCER_TYPE: string = "Microsoft.Network/loadBalancers";

/*
 * The types the inventory lists that publish no metrics of their own
 * (#9375): network security groups, read by the main query, and subnets,
 * read out of their virtual networks by a query of their own
 * (buildAzureSubnetQuery). Their descriptors are the catalog's
 * INVENTORY_ONLY_RESOURCE_TYPES.
 */
export const AZURE_INVENTORY_ONLY_QUERY_TYPES: ReadonlyArray<string> = [
  AZURE_NETWORK_SECURITY_GROUP_TYPE,
  // The WAF policies the blocklist can be enforced in (#10348).
  AZURE_APPLICATION_GATEWAY_WAF_POLICY_TYPE,
  AZURE_FRONT_DOOR_WAF_POLICY_TYPE,
];
export const AZURE_LISTED_ONLY_TYPES: ReadonlyArray<string> = [
  AZURE_NETWORK_SECURITY_GROUP_TYPE,
  AZURE_SUBNET_TYPE,
  AZURE_APPLICATION_GATEWAY_WAF_POLICY_TYPE,
  AZURE_FRONT_DOOR_WAF_POLICY_TYPE,
];

/*
 * The query. Types are the catalog's own (letters, dots and slashes only),
 * so they go into the query as they are.
 */
export function buildAzureInventoryQuery(): string {
  const types: string = [
    ...AZURE_RESOURCE_TYPES.map(
      (descriptor: CloudResourceTypeDescriptor): string => {
        return descriptor.type;
      },
    ),
    ...AZURE_INVENTORY_ONLY_QUERY_TYPES,
  ]
    .map((type: string): string => {
      return `'${type.toLowerCase()}'`;
    })
    .join(", ");

  return [
    "Resources",
    `| where type in~ (${types})`,
    "| project id, name, type, location, resourceGroup, subscriptionId, tags, kind, managedBy,",
    "  skuName = tostring(sku.name), skuTier = tostring(sku.tier),",
    "  provisioningState = tostring(properties.provisioningState),",
    "  state = tostring(properties.state),",
    "  vmSize = tostring(properties.hardwareProfile.vmSize),",
    "  powerState = tostring(properties.extended.instanceView.powerState.displayStatus),",
    "  osType = tostring(properties.storageProfile.osDisk.osType),",
    "  version = tostring(properties.version),",
    "  serverFarmId = tostring(properties.serverFarmId),",
    "  virtualMachineId = tostring(properties.virtualMachine.id),",
    "  ipConfigurationId = tostring(properties.ipConfiguration.id),",
    "  ipConfigurations = properties.ipConfigurations,",
    "  defaultHostName = tostring(properties.defaultHostName),",
    "  hostNames = properties.hostNames,",
    "  fullyQualifiedDomainName = tostring(properties.fullyQualifiedDomainName),",
    "  fqdn = tostring(properties.fqdn),",
    "  dnsFqdn = tostring(properties.dnsSettings.fqdn),",
    "  ipAddress = tostring(properties.ipAddress),",
    "  hostName = tostring(properties.hostName),",
    "  documentEndpoint = tostring(properties.documentEndpoint),",
    "  gatewayUrl = tostring(properties.gatewayUrl),",
    "  ingressFqdn = tostring(properties.configuration.ingress.fqdn),",
    "  primaryWeb = tostring(properties.primaryEndpoints.web),",
    "  primaryBlob = tostring(properties.primaryEndpoints.blob),",
    "  cname = tostring(properties.cname),",
    // Where it runs, besides a network interface's subnets.
    "  virtualNetworkSubnetId = tostring(properties.virtualNetworkSubnetId),",
    "  subnetId = tostring(properties.subnet.id),",
    "  gatewayIPConfigurations = properties.gatewayIPConfigurations,",
    "  frontendIPConfigurations = properties.frontendIPConfigurations,",
    "  agentPoolProfiles = properties.agentPoolProfiles,",
    "  networkInterfaceConfigurations = properties.virtualMachineProfile.networkProfile.networkInterfaceConfigurations,",
    "  infrastructureSubnetId = tostring(properties.vnetConfiguration.infrastructureSubnetId),",
    // What guards it, what it is part of and what it is attached to.
    "  networkSecurityGroupId = tostring(properties.networkSecurityGroup.id),",
    "  managedEnvironmentId = coalesce(tostring(properties.managedEnvironmentId), tostring(properties.environmentId)),",
    "  elasticPoolId = tostring(properties.elasticPoolId),",
    "  natGatewayId = tostring(properties.natGateway.id),",
    // A virtual network lists its subnets too: only a NAT gateway's are read.
    "  natGatewaySubnets = iff(type =~ 'microsoft.network/natgateways', properties.subnets, dynamic(null)),",
    // What it sends traffic to.
    "  privateLinkServiceConnections = properties.privateLinkServiceConnections,",
    "  manualPrivateLinkServiceConnections = properties.manualPrivateLinkServiceConnections,",
    "  gatewayBackendPools = iff(type =~ 'microsoft.network/applicationgateways', properties.backendAddressPools, dynamic(null)),",
    // A network security group's own rules; a cluster's node resource group.
    "  securityRules = iff(type =~ 'microsoft.network/networksecuritygroups', properties.securityRules, dynamic(null)),",
    "  nodeResourceGroup = tostring(properties.nodeResourceGroup),",
    // A managed disk's size; nothing for any other type.
    "  diskSizeGB = iff(type =~ 'microsoft.compute/disks', tolong(properties.diskSizeGB), long(null))",
  ].join("\n");
}

/*
 * The subnets, read out of their virtual networks (#9375): Azure lists a
 * subnet inside its virtual network, never as a resource of its own. One
 * row each, shaped as the main query's rows are, with only what a subnet
 * is: its ranges, its network security group and its route table - never
 * the interfaces it lists, which would make a large network's rows heavy.
 */
export function buildAzureSubnetQuery(): string {
  return [
    "Resources",
    "| where type =~ 'microsoft.network/virtualnetworks'",
    "| mv-expand limit 2000 subnet = properties.subnets",
    "| where isnotempty(tostring(subnet.id))",
    "| project id = tostring(subnet.id), name = strcat(name, '/', tostring(subnet.name)), type = 'microsoft.network/virtualnetworks/subnets', location, resourceGroup, subscriptionId,",
    "  provisioningState = tostring(subnet.properties.provisioningState),",
    "  addressPrefix = tostring(subnet.properties.addressPrefix),",
    "  addressPrefixes = subnet.properties.addressPrefixes,",
    "  networkSecurityGroupId = tostring(subnet.properties.networkSecurityGroup.id),",
    "  routeTableId = tostring(subnet.properties.routeTable.id),",
    "  delegations = subnet.properties.delegations",
  ].join("\n");
}

function text(row: JSONObject, key: string): string {
  const value: unknown = row[key];
  return typeof value === "string" ? value.trim() : "";
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asList(value: unknown): Array<unknown> {
  return Array.isArray(value) ? value : [];
}

// The text at a dotted path of each entry of a list: ids out of an ARM array.
function textsAt(list: unknown, path: string): Array<string> {
  const texts: Array<string> = [];

  for (const entry of asList(list)) {
    const value: string = asText(readCloudPath(entry, path));

    if (value) {
      texts.push(value);
    }
  }

  return texts;
}

/*
 * The resource a sub-resource id belongs to:
 * ".../networkInterfaces/nic-1/ipConfigurations/ipconfig1" ->
 * ".../networkInterfaces/nic-1". An id that is a resource stays as it is.
 */
export function getAzureOwningResourceId(id: string): string {
  const parsed: ReturnType<typeof parseAzureResourceId> =
    parseAzureResourceId(id);

  if (!parsed) {
    return "";
  }

  const segments: Array<string> = id.split("/").filter((part: string) => {
    return part.length > 0;
  });
  const providersIndex: number = segments.findIndex((part: string) => {
    return part.toLowerCase() === "providers";
  });

  // providers / namespace / type / name: the resource; anything after is a sub-resource.
  if (providersIndex < 0 || segments.length < providersIndex + 4) {
    return "";
  }

  return `/${segments.slice(0, providersIndex + 4).join("/")}`;
}

/*
 * A nested resource's parent: ".../servers/sql-1/databases/orders" is part
 * of ".../servers/sql-1". "" for a top-level resource.
 */
export function getAzureParentResourceId(id: string): string {
  const segments: Array<string> = id.split("/").filter((part: string) => {
    return part.length > 0;
  });
  const providersIndex: number = segments.findIndex((part: string) => {
    return part.toLowerCase() === "providers";
  });

  if (providersIndex < 0 || segments.length < providersIndex + 6) {
    return "";
  }

  return `/${segments.slice(0, segments.length - 2).join("/")}`;
}

/*
 * The virtual network a subnet is in:
 * ".../virtualNetworks/vnet-1/subnets/default" -> ".../virtualNetworks/vnet-1".
 * "" for anything that is not a virtual network's subnet.
 */
export function getAzureVirtualNetworkOfSubnet(subnetId: string): string {
  if (!parseAzureResourceId(subnetId)) {
    return "";
  }

  const segments: Array<string> = subnetId
    .trim()
    .split("/")
    .filter((part: string) => {
      return part.length > 0;
    });
  const length: number = segments.length;

  if (
    length < 5 ||
    segments[length - 2]!.toLowerCase() !== "subnets" ||
    segments[length - 4]!.toLowerCase() !== "virtualnetworks" ||
    segments[length - 5]!.toLowerCase() !== "microsoft.network"
  ) {
    return "";
  }

  return `/${segments.slice(0, length - 2).join("/")}`;
}

/*
 * Where a resource runs, from the subnets it names: in each subnet, as
 * Azure names it, and in that subnet's virtual network, which the account
 * holds as a resource of its own.
 */
function placementsIn(
  subnetIds: ReadonlyArray<string>,
): Array<CloudResourceRelationship> {
  const relationships: Array<CloudResourceRelationship> = [];

  for (const subnet of subnetIds) {
    relationships.push({
      kind: CloudRelationshipKind.RunsIn,
      target: subnet,
      targetType: AZURE_SUBNET_TYPE,
    });

    const network: string = getAzureVirtualNetworkOfSubnet(subnet);

    if (network) {
      relationships.push({
        kind: CloudRelationshipKind.RunsIn,
        target: network,
        targetType: AZURE_VIRTUAL_NETWORK_TYPE,
      });
    }
  }

  return relationships;
}

// A scale set's IP configurations, from every network interface it gives its instances.
function scaleSetIpConfigurations(row: JSONObject): Array<unknown> {
  return asList(row["networkInterfaceConfigurations"]).flatMap(
    (configuration: unknown): Array<unknown> => {
      return asList(
        readCloudPath(configuration, "properties.ipConfigurations"),
      );
    },
  );
}

/*
 * Every subnet a row names, wherever its type keeps it: a network
 * interface's, a firewall's, a Bastion's or a gateway's IP configurations;
 * an application gateway's gateway configurations; an internal load
 * balancer's frontends; an app's VNet integration; a private endpoint's
 * subnet; a cluster's node pools; a scale set's network profile; a
 * Container Apps environment's infrastructure subnet.
 */
function subnetsOf(row: JSONObject): Array<string> {
  return [
    ...textsAt(row["ipConfigurations"], "properties.subnet.id"),
    ...textsAt(row["gatewayIPConfigurations"], "properties.subnet.id"),
    ...textsAt(row["frontendIPConfigurations"], "properties.subnet.id"),
    text(row, "virtualNetworkSubnetId"),
    text(row, "subnetId"),
    ...textsAt(row["agentPoolProfiles"], "vnetSubnetID"),
    ...textsAt(scaleSetIpConfigurations(row), "properties.subnet.id"),
    text(row, "infrastructureSubnetId"),
  ].filter((subnet: string): boolean => {
    return subnet.length > 0;
  });
}

// "443", "8000-8100", or the ranges joined: "80,443"; "" for every port.
function portsOf(rule: unknown): string {
  const ranges: Array<string> = [
    asText(readCloudPath(rule, "properties.destinationPortRange")),
    ...asList(readCloudPath(rule, "properties.destinationPortRanges")).map(
      (range: unknown): string => {
        return asText(range);
      },
    ),
  ].filter((range: string): boolean => {
    return range.length > 0 && range !== "*";
  });

  return ranges.join(",");
}

// Where a rule's traffic comes from or goes to: "Internet", "10.0.0.0/8, 10.1.0.0/16".
function peersOf(rule: unknown, side: "source" | "destination"): string {
  const peers: Array<string> = [
    asText(readCloudPath(rule, `properties.${side}AddressPrefix`)),
    ...asList(readCloudPath(rule, `properties.${side}AddressPrefixes`)).map(
      (prefix: unknown): string => {
        return asText(prefix);
      },
    ),
    ...textsAt(
      readCloudPath(rule, `properties.${side}ApplicationSecurityGroups`),
      "id",
    ).map((id: string): string => {
      return id.slice(id.lastIndexOf("/") + 1);
    }),
  ].filter((peer: string): boolean => {
    return peer.length > 0;
  });

  return peers.length > 0 ? peers.join(", ") : "*";
}

/*
 * A network security group's rules of one direction, one line each, by
 * priority, as the portal reads them: "Allow tcp:443 from Internet (100)",
 * "Deny all to * (4096)". Its default rules are Azure's own and not read.
 */
export function networkSecurityGroupRules(
  rules: unknown,
  direction: "Inbound" | "Outbound",
): Array<string> {
  return asList(rules)
    .filter((rule: unknown): boolean => {
      return (
        asText(readCloudPath(rule, "properties.direction")).toLowerCase() ===
        direction.toLowerCase()
      );
    })
    .map((rule: unknown): { priority: number; line: string } => {
      const access: string =
        asText(readCloudPath(rule, "properties.access")) || "Allow";
      const rawProtocol: string = asText(
        readCloudPath(rule, "properties.protocol"),
      ).toLowerCase();
      const protocol: string =
        !rawProtocol || rawProtocol === "*" ? "all" : rawProtocol;
      const ports: string = portsOf(rule);
      const peer: string =
        direction === "Inbound"
          ? `from ${peersOf(rule, "source")}`
          : `to ${peersOf(rule, "destination")}`;
      const priorityValue: unknown = readCloudPath(rule, "properties.priority");
      const priority: number =
        typeof priorityValue === "number" ? priorityValue : 0;

      return {
        priority,
        line: `${access} ${ports ? `${protocol}:${ports}` : protocol} ${peer}${
          priority ? ` (${priority})` : ""
        }`,
      };
    })
    .sort(
      (
        a: { priority: number; line: string },
        b: { priority: number; line: string },
      ): number => {
        return a.priority - b.priority;
      },
    )
    .map((entry: { line: string }): string => {
      return entry.line;
    });
}

// What a row's properties are worked out to, beside the ones projected as they are.
function derivedPropertiesOf(row: JSONObject): JSONObject {
  const derived: JSONObject = {};
  const type: string = text(row, "type").toLowerCase();

  if (type === AZURE_NETWORK_SECURITY_GROUP_TYPE.toLowerCase()) {
    derived["inbound"] = networkSecurityGroupRules(
      row["securityRules"],
      "Inbound",
    );
    derived["outbound"] = networkSecurityGroupRules(
      row["securityRules"],
      "Outbound",
    );
  }

  if (type === AZURE_SUBNET_TYPE.toLowerCase()) {
    derived["delegatedTo"] = textsAt(
      row["delegations"],
      "properties.serviceName",
    );
  }

  return derived;
}

function relationshipsOf(row: JSONObject): Array<CloudResourceRelationship> {
  const relationships: Array<CloudResourceRelationship> = [];
  const id: string = text(row, "id");
  const parent: string = getAzureParentResourceId(id);
  const network: string = getAzureVirtualNetworkOfSubnet(id);

  // A subnet runs in its virtual network, as everything in it does.
  if (network) {
    relationships.push({
      kind: CloudRelationshipKind.RunsIn,
      target: network,
      targetType: AZURE_VIRTUAL_NETWORK_TYPE,
    });
  } else if (parent) {
    relationships.push({ kind: CloudRelationshipKind.PartOf, target: parent });
  }

  // A SQL database in an elastic pool shares the pool's compute and storage.
  const pool: string = text(row, "elasticPoolId");

  if (pool) {
    relationships.push({
      kind: CloudRelationshipKind.PartOf,
      target: pool,
      targetType: "Microsoft.Sql/servers/elasticPools",
    });
  }

  const managedBy: string = text(row, "managedBy");

  if (managedBy) {
    relationships.push({
      kind: CloudRelationshipKind.AttachedTo,
      target: managedBy,
    });
  }

  const plan: string = text(row, "serverFarmId");

  if (plan) {
    relationships.push({
      kind: CloudRelationshipKind.PartOf,
      target: plan,
      targetType: "Microsoft.Web/serverFarms",
    });
  }

  // A container app runs in its Container Apps environment.
  const environment: string = text(row, "managedEnvironmentId");

  if (environment) {
    relationships.push({
      kind: CloudRelationshipKind.PartOf,
      target: environment,
      targetType: "Microsoft.App/managedEnvironments",
    });
  }

  const virtualMachine: string = text(row, "virtualMachineId");

  if (virtualMachine) {
    relationships.push({
      kind: CloudRelationshipKind.AttachedTo,
      target: virtualMachine,
      targetType: AZURE_VIRTUAL_MACHINE_TYPE,
    });
  }

  // A public IP names the interface or load balancer frontend it is on.
  const ipConfiguration: string = getAzureOwningResourceId(
    text(row, "ipConfigurationId"),
  );

  if (ipConfiguration) {
    relationships.push({
      kind: CloudRelationshipKind.AttachedTo,
      target: ipConfiguration,
    });
  }

  // A public IP a NAT gateway sends its outbound traffic from.
  const natGateway: string = text(row, "natGatewayId");

  if (natGateway) {
    relationships.push({
      kind: CloudRelationshipKind.AttachedTo,
      target: natGateway,
      targetType: "Microsoft.Network/natGateways",
    });
  }

  // The subnets it runs in, and their virtual networks.
  relationships.push(...placementsIn(subnetsOf(row)));

  // A NAT gateway is attached to the subnets whose outbound traffic it carries.
  for (const subnet of textsAt(row["natGatewaySubnets"], "id")) {
    relationships.push({
      kind: CloudRelationshipKind.AttachedTo,
      target: subnet,
      targetType: AZURE_SUBNET_TYPE,
    });

    const network: string = getAzureVirtualNetworkOfSubnet(subnet);

    if (network) {
      relationships.push({
        kind: CloudRelationshipKind.AttachedTo,
        target: network,
        targetType: AZURE_VIRTUAL_NETWORK_TYPE,
      });
    }
  }

  /*
   * The network security group on a network interface or a subnet, and on
   * each interface a scale set gives its instances.
   */
  for (const securityGroup of [
    text(row, "networkSecurityGroupId"),
    ...textsAt(
      row["networkInterfaceConfigurations"],
      "properties.networkSecurityGroup.id",
    ),
  ]) {
    if (securityGroup) {
      relationships.push({
        kind: CloudRelationshipKind.ProtectedBy,
        target: securityGroup,
        targetType: AZURE_NETWORK_SECURITY_GROUP_TYPE,
      });
    }
  }

  // A subnet's route table.
  const routeTable: string = text(row, "routeTableId");

  if (routeTable) {
    relationships.push({
      kind: CloudRelationshipKind.AttachedTo,
      target: routeTable,
      targetType: "Microsoft.Network/routeTables",
    });
  }

  /*
   * A private endpoint sends traffic on to the service it is a private
   * link to: a storage account, a database server, a key vault, an app.
   */
  for (const service of [
    ...textsAt(
      row["privateLinkServiceConnections"],
      "properties.privateLinkServiceId",
    ),
    ...textsAt(
      row["manualPrivateLinkServiceConnections"],
      "properties.privateLinkServiceId",
    ),
  ]) {
    relationships.push({
      kind: CloudRelationshipKind.RoutesTo,
      target: service,
    });
  }

  return boundCloudRelationships(relationships);
}

function endpointsOf(row: JSONObject): Array<string> {
  const values: Array<unknown> = ENDPOINT_FIELDS.map((field: string) => {
    return row[field];
  });
  const hostNames: unknown = row["hostNames"];

  if (Array.isArray(hostNames)) {
    values.push(...hostNames);
  }

  return normalizeCloudEndpoints(values);
}

/*
 * One Resource Graph row as an inventory item, or null when it names no
 * resource the ingest would file metrics under.
 */
export function buildAzureInventoryItem(
  row: JSONObject,
): CloudInventoryItem | null {
  const id: string = text(row, "id");
  const subscriptionId: string = text(row, "subscriptionId");

  if (!id) {
    return null;
  }

  const resource: CloudMonitoredResource | null = resolveCloudMonitoredResource(
    {
      metricName: "azure_inventory",
      attributes: {
        [AZURE_MONITOR_RESOURCE_ID_ATTRIBUTE]: id,
        [AZURE_MONITOR_SUBSCRIPTION_ID_ATTRIBUTE]: subscriptionId,
        name: text(row, "name"),
        location: text(row, "location"),
        resource_group: text(row, "resourceGroup"),
      },
    },
  );

  if (!resource) {
    return null;
  }

  return {
    resource,
    displayName: text(row, "name") || undefined,
    tags: normalizeCloudTags(row["tags"]),
    properties: pickCloudProperties(
      { ...row, ...derivedPropertiesOf(row) },
      AZURE_INVENTORY_PROPERTIES,
    ),
    relationships: relationshipsOf(row),
    endpoints: endpointsOf(row),
  };
}

// One listed row with the item it made: what the reads across the rows start from.
interface AzureListedRow {
  id: string;
  type: string;
  row: JSONObject;
  item: CloudInventoryItem;
}

// The resource that owns each id, once: a pool's load balancer, an interface's VM.
function owningIds(ids: ReadonlyArray<string>): Array<string> {
  const owners: Array<string> = [];

  for (const id of ids) {
    const owner: string = getAzureOwningResourceId(id);

    if (owner && !owners.includes(owner)) {
      owners.push(owner);
    }
  }

  return owners;
}

/*
 * The load balancers and application gateways a network interface or a
 * scale set is in the backend pools of, by their ids.
 */
function backendPoolOwners(listed: AzureListedRow): {
  loadBalancers: Array<string>;
  gateways: Array<string>;
} {
  const configurations: Array<unknown> =
    listed.type === AZURE_SCALE_SET_TYPE.toLowerCase()
      ? scaleSetIpConfigurations(listed.row)
      : asList(listed.row["ipConfigurations"]);
  const loadBalancerPools: Array<string> = [];
  const gatewayPools: Array<string> = [];

  for (const configuration of configurations) {
    loadBalancerPools.push(
      ...textsAt(
        readCloudPath(
          configuration,
          "properties.loadBalancerBackendAddressPools",
        ),
        "id",
      ),
    );
    gatewayPools.push(
      ...textsAt(
        readCloudPath(
          configuration,
          "properties.applicationGatewayBackendAddressPools",
        ),
        "id",
      ),
    );
  }

  return {
    loadBalancers: owningIds(loadBalancerPools),
    gateways: owningIds(gatewayPools),
  };
}

/*
 * The hosts and addresses an application gateway's backend pools name
 * (the apps it fronts), as written: "shop.azurewebsites.net", "10.0.1.4".
 */
function gatewayBackendAddresses(row: JSONObject): Array<string> {
  const addresses: Array<string> = [];

  for (const pool of asList(row["gatewayBackendPools"])) {
    for (const address of asList(
      readCloudPath(pool, "properties.backendAddresses"),
    )) {
      const value: string =
        asText(readCloudPath(address, "fqdn")) ||
        asText(readCloudPath(address, "ipAddress"));

      if (value && !addresses.includes(value)) {
        addresses.push(value);
      }
    }
  }

  return addresses;
}

/*
 * A subscription's rows as inventory items, with what only the rows read
 * together say:
 *
 *   - a virtual machine runs in the subnets and virtual networks its
 *     network interfaces run in, and is protected by the network security
 *     groups on them and on their subnets (#9375);
 *   - a network interface and a scale set are protected by the network
 *     security group on each subnet they run in, as Azure applies both;
 *   - a load balancer also sends traffic to the virtual machine of each
 *     network interface in its pools;
 *   - a Kubernetes cluster's node scale sets and machines - the ones in its
 *     node resource group - are part of it, and a cluster that names no
 *     subnet of its own runs where they do;
 *   - a load balancer or an application gateway sends traffic to each
 *     network interface and scale set in its backend pools, which those
 *     list rather than the balancer;
 *   - an application gateway sends traffic to the app that answers on a
 *     host its backend pools name, matched to the host names the apps
 *     answer on, or to the host or address as written when no listed
 *     resource answers on it.
 *
 * A row that names no resource is left out, as buildAzureInventoryItem
 * leaves it.
 */
export function buildAzureInventoryItems(
  rows: ReadonlyArray<JSONObject>,
): Array<CloudInventoryItem> {
  const listed: Array<AzureListedRow> = [];
  const byId: Map<string, AzureListedRow> = new Map();

  for (const row of rows) {
    const item: CloudInventoryItem | null = buildAzureInventoryItem(row);

    if (!item) {
      continue;
    }

    const entry: AzureListedRow = {
      id: text(row, "id"),
      type: text(row, "type").toLowerCase(),
      row,
      item,
    };
    listed.push(entry);
    byId.set(entry.id.toLowerCase(), entry);
  }

  const added: Map<
    CloudInventoryItem,
    Array<CloudResourceRelationship>
  > = new Map();
  const add: (
    entry: AzureListedRow | undefined,
    relationship: CloudResourceRelationship,
  ) => void = (
    entry: AzureListedRow | undefined,
    relationship: CloudResourceRelationship,
  ): void => {
    if (!entry) {
      return;
    }

    added.set(entry.item, [...(added.get(entry.item) || []), relationship]);
  };

  // The network security group on each subnet, by the subnet's id.
  const securityGroupOfSubnet: Map<string, string> = new Map();

  for (const entry of listed) {
    if (entry.type === AZURE_SUBNET_TYPE.toLowerCase()) {
      const group: string = text(entry.row, "networkSecurityGroupId");

      if (group) {
        securityGroupOfSubnet.set(entry.id.toLowerCase(), group);
      }
    }
  }

  // Protected by the security groups of the subnets a resource runs in.
  const subnetGuards: (
    relationships: ReadonlyArray<CloudResourceRelationship>,
  ) => Array<CloudResourceRelationship> = (
    relationships: ReadonlyArray<CloudResourceRelationship>,
  ): Array<CloudResourceRelationship> => {
    const guards: Array<CloudResourceRelationship> = [];

    for (const relationship of relationships) {
      if (
        relationship.kind !== CloudRelationshipKind.RunsIn ||
        relationship.targetType !== AZURE_SUBNET_TYPE
      ) {
        continue;
      }

      const group: string | undefined = securityGroupOfSubnet.get(
        relationship.target.toLowerCase(),
      );

      if (group) {
        guards.push({
          kind: CloudRelationshipKind.ProtectedBy,
          target: group,
          targetType: AZURE_NETWORK_SECURITY_GROUP_TYPE,
        });
      }
    }

    return guards;
  };

  // The clusters whose nodes each resource group holds: AKS's MC_ groups.
  const clustersByNodeGroup: Map<string, Array<AzureListedRow>> = new Map();

  for (const entry of listed) {
    const nodeGroup: string = text(entry.row, "nodeResourceGroup");

    if (entry.type === AZURE_MANAGED_CLUSTER_TYPE.toLowerCase() && nodeGroup) {
      const key: string =
        `${text(entry.row, "subscriptionId")}|${nodeGroup}`.toLowerCase();
      clustersByNodeGroup.set(key, [
        ...(clustersByNodeGroup.get(key) || []),
        entry,
      ]);
    }
  }

  // The resources that answer on each host: an app behind a gateway.
  const byHost: Map<string, Array<AzureListedRow>> = new Map();

  for (const entry of listed) {
    for (const endpoint of entry.item.endpoints) {
      byHost.set(endpoint, [...(byHost.get(endpoint) || []), entry]);
    }
  }

  for (const entry of listed) {
    if (
      entry.type === AZURE_NETWORK_INTERFACE_TYPE.toLowerCase() ||
      entry.type === AZURE_SCALE_SET_TYPE.toLowerCase()
    ) {
      const targetType: string =
        entry.type === AZURE_SCALE_SET_TYPE.toLowerCase()
          ? AZURE_SCALE_SET_TYPE
          : AZURE_NETWORK_INTERFACE_TYPE;
      const owners: { loadBalancers: Array<string>; gateways: Array<string> } =
        backendPoolOwners(entry);

      const machine: AzureListedRow | undefined =
        entry.type === AZURE_NETWORK_INTERFACE_TYPE.toLowerCase()
          ? byId.get(text(entry.row, "virtualMachineId").toLowerCase())
          : undefined;

      for (const balancer of [...owners.loadBalancers, ...owners.gateways]) {
        const owner: AzureListedRow | undefined = byId.get(
          balancer.toLowerCase(),
        );

        add(owner, {
          kind: CloudRelationshipKind.RoutesTo,
          target: entry.id,
          targetType,
        });

        // Through the interface, to the machine behind it.
        if (machine && owner?.type === AZURE_LOAD_BALANCER_TYPE.toLowerCase()) {
          add(owner, {
            kind: CloudRelationshipKind.RoutesTo,
            target: machine.id,
            targetType: AZURE_VIRTUAL_MACHINE_TYPE,
          });
        }
      }

      // Guarded by the security group on each subnet it runs in, too.
      for (const guard of subnetGuards(entry.item.relationships)) {
        add(entry, guard);
      }
    }

    /*
     * A virtual machine runs where the network interfaces attached to it
     * do, and is guarded by what guards them: the security groups on the
     * interfaces and on their subnets.
     */
    if (entry.type === AZURE_NETWORK_INTERFACE_TYPE.toLowerCase()) {
      const machine: AzureListedRow | undefined = byId.get(
        text(entry.row, "virtualMachineId").toLowerCase(),
      );

      for (const relationship of entry.item.relationships) {
        if (
          (relationship.kind === CloudRelationshipKind.RunsIn &&
            (relationship.targetType === AZURE_SUBNET_TYPE ||
              relationship.targetType === AZURE_VIRTUAL_NETWORK_TYPE)) ||
          (relationship.kind === CloudRelationshipKind.ProtectedBy &&
            relationship.targetType === AZURE_NETWORK_SECURITY_GROUP_TYPE)
        ) {
          add(machine, relationship);
        }
      }

      for (const guard of subnetGuards(entry.item.relationships)) {
        add(machine, guard);
      }
    }

    // A cluster's node scale sets and machines are part of it.
    if (
      entry.type === AZURE_SCALE_SET_TYPE.toLowerCase() ||
      entry.type === AZURE_VIRTUAL_MACHINE_TYPE.toLowerCase()
    ) {
      const clusters: Array<AzureListedRow> =
        clustersByNodeGroup.get(
          `${text(entry.row, "subscriptionId")}|${text(entry.row, "resourceGroup")}`.toLowerCase(),
        ) || [];

      // One cluster's node resource group: never a guess between two.
      if (clusters.length === 1) {
        const cluster: AzureListedRow = clusters[0]!;

        add(entry, {
          kind: CloudRelationshipKind.PartOf,
          target: cluster.id,
          targetType: AZURE_MANAGED_CLUSTER_TYPE,
        });

        // A cluster on a network AKS made for it runs where its nodes do.
        const own: boolean = cluster.item.relationships.some(
          (relationship: CloudResourceRelationship): boolean => {
            return relationship.kind === CloudRelationshipKind.RunsIn;
          },
        );

        if (!own) {
          for (const relationship of entry.item.relationships) {
            if (relationship.kind === CloudRelationshipKind.RunsIn) {
              add(cluster, relationship);
            }
          }
        }
      }
    }

    if (entry.type === AZURE_APPLICATION_GATEWAY_TYPE.toLowerCase()) {
      for (const address of gatewayBackendAddresses(entry.row)) {
        const answering: Array<AzureListedRow> =
          byHost.get(normalizeCloudHost(address)) || [];

        // One app answers on it: the gateway sends to that app, never a guess.
        if (answering.length === 1 && answering[0] !== entry) {
          add(entry, {
            kind: CloudRelationshipKind.RoutesTo,
            target: answering[0]!.id,
            targetType: answering[0]!.item.resource.resourceType,
          });
          continue;
        }

        add(entry, { kind: CloudRelationshipKind.RoutesTo, target: address });
      }
    }
  }

  return listed.map((entry: AzureListedRow): CloudInventoryItem => {
    const more: Array<CloudResourceRelationship> | undefined = added.get(
      entry.item,
    );

    return more
      ? {
          ...entry.item,
          relationships: boundCloudRelationships([
            ...entry.item.relationships,
            ...more,
          ]),
        }
      : entry.item;
  });
}

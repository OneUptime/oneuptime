import {
  CloudRelationshipKind,
  CloudResourceRelationship,
  boundCloudRelationships,
  normalizeCloudEndpoints,
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
import { JSONObject } from "../../../../Types/JSON";
import { CloudInventoryItem } from "../CloudConnectorTypes";

/*
 * AN AZURE SUBSCRIPTION'S INVENTORY, from one Azure Resource Graph query:
 * every resource of the types OneUptime knows (CloudResourceCatalog's
 * AZURE_RESOURCE_TYPES), with its tags, a few properties, what it is part
 * of or attached to, and the host names it answers on.
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

/*
 * The query. Types are the catalog's own (letters, dots and slashes only),
 * so they go into the query as they are.
 */
export function buildAzureInventoryQuery(): string {
  const types: string = AZURE_RESOURCE_TYPES.map(
    (descriptor: CloudResourceTypeDescriptor): string => {
      return `'${descriptor.type.toLowerCase()}'`;
    },
  ).join(", ");

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
    "  cname = tostring(properties.cname)",
  ].join("\n");
}

function text(row: JSONObject, key: string): string {
  const value: unknown = row[key];
  return typeof value === "string" ? value.trim() : "";
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

function relationshipsOf(row: JSONObject): Array<CloudResourceRelationship> {
  const relationships: Array<CloudResourceRelationship> = [];
  const id: string = text(row, "id");
  const parent: string = getAzureParentResourceId(id);

  if (parent) {
    relationships.push({ kind: CloudRelationshipKind.PartOf, target: parent });
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

  const virtualMachine: string = text(row, "virtualMachineId");

  if (virtualMachine) {
    relationships.push({
      kind: CloudRelationshipKind.AttachedTo,
      target: virtualMachine,
      targetType: "Microsoft.Compute/virtualMachines",
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

  // A network interface's subnets.
  const configurations: unknown = row["ipConfigurations"];

  if (Array.isArray(configurations)) {
    for (const configuration of configurations) {
      const subnet: unknown = readCloudPath(configuration, "properties.subnet.id");

      if (typeof subnet === "string" && subnet.trim()) {
        relationships.push({
          kind: CloudRelationshipKind.RunsIn,
          target: subnet.trim(),
          targetType: "Microsoft.Network/virtualNetworks/subnets",
        });
      }
    }
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

  const resource: CloudMonitoredResource | null =
    resolveCloudMonitoredResource({
      metricName: "azure_inventory",
      attributes: {
        [AZURE_MONITOR_RESOURCE_ID_ATTRIBUTE]: id,
        [AZURE_MONITOR_SUBSCRIPTION_ID_ATTRIBUTE]: subscriptionId,
        name: text(row, "name"),
        location: text(row, "location"),
        resource_group: text(row, "resourceGroup"),
      },
    });

  if (!resource) {
    return null;
  }

  return {
    resource,
    displayName: text(row, "name") || undefined,
    tags: normalizeCloudTags(row["tags"]),
    properties: pickCloudProperties(row, AZURE_INVENTORY_PROPERTIES),
    relationships: relationshipsOf(row),
    endpoints: endpointsOf(row),
  };
}

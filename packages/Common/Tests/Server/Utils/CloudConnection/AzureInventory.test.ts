import {
  AZURE_INVENTORY_PROPERTIES,
  buildAzureInventoryItem,
  buildAzureInventoryQuery,
  getAzureOwningResourceId,
  getAzureParentResourceId,
} from "../../../../Server/Utils/CloudConnection/Azure/AzureInventory";
import { CloudInventoryItem } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { CloudRelationshipKind } from "../../../../Types/Cloud/CloudInventory";
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
      if (field === "kind") {
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

  test("a network interface is attached to its VM and runs in its subnets; a public IP is attached to what it is on", () => {
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

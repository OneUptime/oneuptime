import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import {
  INVENTORY_DISPLAY_NAME_RULES,
  InventoryItemService,
} from "../../../Server/Services/InventoryItemService";
import EntityExtractor, {
  EntityAttributes,
  ExtractedEntity,
} from "../../../Server/Utils/Telemetry/TelemetryEntity";
import { REGISTRY_PROMOTED_TYPES } from "../../../Server/Utils/Telemetry/EntityRegistry";
import EntityType from "../../../Types/Telemetry/EntityType";
import {
  INVENTORY_ENTITY_TYPES,
  MANUAL_ENTITY_TYPES,
} from "../../../Types/Telemetry/EntityTypeGroups";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHAT INVENTORY CALLS EACH DISCOVERED ITEM (#11254).
 *
 * With vCenter telemetry, Inventory listed hundreds of "VMware Virtual
 * Machine" items all named after the vCenter (vmware.vcenter.name), and every
 * ESXi host after its datacenter: the generic rule named an item by the
 * longest `*.name` key of its identity, which for a VM is the vCenter's name
 * (its own name is not identity) and for a host, a cluster and a datastore is
 * vcenter.datacenter.name (longer than each of their own). Each kind now has
 * a rule of its own (INVENTORY_DISPLAY_NAME_RULES), read through the real
 * extractor here from the attributes the collectors send: the issue's own
 * two VMs, and every object of the vcenter receiver's recorded export of a
 * simulated vCenter (Probe/Tests/Utils/VMware/Fixtures). A row named by the
 * old rule takes its own name the next time it is seen, and a name a person
 * typed is kept.
 */

const PROJECT_ID: string = "6b3d1f0a-2a4c-4f7e-9d1b-1a2b3c4d5e6f";

const RECORDED_VCENTER: string = path.resolve(
  __dirname,
  "../../../../Probe/Tests/Utils/VMware/Fixtures/vcenterreceiver-0.161.0-vcsim-vcenter.json",
);

interface RecordedResourceMetrics {
  resource: {
    attributes: Array<{ key: string; value: { stringValue?: string } }>;
  };
}

function recordedResources(): Array<EntityAttributes> {
  const body: { resourceMetrics: Array<RecordedResourceMetrics> } = JSON.parse(
    fs.readFileSync(RECORDED_VCENTER, "utf8"),
  );
  return body.resourceMetrics.map(
    (resourceMetrics: RecordedResourceMetrics): EntityAttributes => {
      const attributes: EntityAttributes = {};
      for (const attribute of resourceMetrics.resource.attributes) {
        attributes[attribute.key] = attribute.value.stringValue ?? null;
      }
      return attributes;
    },
  );
}

function extract(attributes: EntityAttributes): Array<ExtractedEntity> {
  return EntityExtractor.extractEntities({
    projectId: PROJECT_ID,
    attributes,
  });
}

function ofType(
  attributes: EntityAttributes,
  entityType: EntityType,
): ExtractedEntity {
  const entity: ExtractedEntity | undefined = extract(attributes).find(
    (candidate: ExtractedEntity): boolean => {
      return candidate.entityType === entityType;
    },
  );
  if (!entity) {
    throw new Error(`No ${entityType} entity in ${JSON.stringify(attributes)}`);
  }
  return entity;
}

function nameOf(attributes: EntityAttributes, entityType: EntityType): string {
  return InventoryItemService.deriveDisplayName(ofType(attributes, entityType));
}

/*
 * The names every item of a kind gets from the recorded export, by key:
 * one entity per key, however many resources report it (a host is seen on
 * its own resource and on every VM it runs).
 */
function recordedNamesOf(entityType: EntityType): Array<string> {
  const byKey: Map<string, string> = new Map<string, string>();
  for (const attributes of recordedResources()) {
    for (const entity of extract(attributes)) {
      if (entity.entityType === entityType) {
        byKey.set(
          entity.entityKey,
          InventoryItemService.deriveDisplayName(entity),
        );
      }
    }
  }
  return Array.from(byKey.values()).sort();
}

function existingRow(data: {
  displayName?: string | undefined;
  descriptiveAttributes?: Record<string, string> | undefined;
}): InventoryItem {
  const row: InventoryItem = new InventoryItem();
  if (data.displayName !== undefined) {
    row.displayName = data.displayName;
  }
  if (data.descriptiveAttributes) {
    row.descriptiveAttributes = data.descriptiveAttributes;
  }
  return row;
}

function renameOnNextReport(
  entity: ExtractedEntity,
  existing: InventoryItem,
): string | undefined {
  return (
    InventoryItemService as unknown as {
      buildDescriptiveUpdate: (
        incoming: ExtractedEntity,
        row: InventoryItem,
      ) => { displayName?: string };
    }
  ).buildDescriptiveUpdate(entity, existing).displayName;
}

// The issue's own example: two VMs of one vCenter, both shown "vcsa01.acme.lan".
const ITEM_A: EntityAttributes = {
  "vmware.vcenter.name": "vcsa01.acme.lan",
  "vcenter.datacenter.name": "DC-NORTH",
  "vcenter.cluster.name": "cluster-alpha",
  "vcenter.host.name": "esx-node-07.acme.lan",
  "vcenter.vm.name": "web-frontend-03",
  "vcenter.vm.id": "4a1c9e72-5b3f-4c11-9d2e-7f1a2b3c4d5e",
};
const ITEM_B: EntityAttributes = {
  "vmware.vcenter.name": "vcsa01.acme.lan",
  "vcenter.datacenter.name": "DC-NORTH",
  "vcenter.cluster.name": "cluster-beta",
  "vcenter.host.name": "esx-node-12.acme.lan",
  "vcenter.vm.name": "billing-db-01",
  "vcenter.vm.id": "4a7d02b8-e61a-4f22-8b3c-9d0e1f2a3b4c",
};

describe("the issue's two VMs (#11254)", () => {
  test("each VM is named by vcenter.vm.name, not by the vCenter", () => {
    expect(nameOf(ITEM_A, EntityType.VMwareVirtualMachine)).toBe(
      "web-frontend-03",
    );
    expect(nameOf(ITEM_B, EntityType.VMwareVirtualMachine)).toBe(
      "billing-db-01",
    );
  });

  test("each ESXi host is named by vcenter.host.name, not by its datacenter", () => {
    expect(nameOf(ITEM_A, EntityType.VMwareHost)).toBe("esx-node-07.acme.lan");
    expect(nameOf(ITEM_B, EntityType.VMwareHost)).toBe("esx-node-12.acme.lan");
    expect(nameOf(ITEM_A, EntityType.VMwareHost)).not.toBe("dc-north");
  });

  test("each cluster is named by vcenter.cluster.name, and the vCenter by its own", () => {
    expect(nameOf(ITEM_A, EntityType.VMwareCluster)).toBe("cluster-alpha");
    expect(nameOf(ITEM_B, EntityType.VMwareCluster)).toBe("cluster-beta");
    expect(nameOf(ITEM_A, EntityType.VMwareVCenter)).toBe("vcsa01.acme.lan");
  });

  test("identity still rests on the VM's id: only the name changed", () => {
    const vm: ExtractedEntity = ofType(ITEM_A, EntityType.VMwareVirtualMachine);
    expect(vm.identifyingAttributes).toEqual({
      "vmware.vcenter.name": "vcsa01.acme.lan",
      "vcenter.vm.id": "4a1c9e72-5b3f-4c11-9d2e-7f1a2b3c4d5e",
    });
    const renamed: ExtractedEntity = ofType(
      { ...ITEM_A, "vcenter.vm.name": "web-frontend-03-old" },
      EntityType.VMwareVirtualMachine,
    );
    expect(renamed.entityKey).toBe(vm.entityKey);
  });
});

describe("the vcenter receiver's recorded export of a simulated vCenter", () => {
  test("six VMs get six names of their own, none the vCenter's", () => {
    expect(recordedNamesOf(EntityType.VMwareVirtualMachine)).toEqual([
      "DC0_C0_RP1_VM0",
      "DC0_C0_RP1_VM1",
      "DC0_C1_RP1_VM0",
      "DC0_C1_RP1_VM1",
      "DC0_H0_VM0",
      "DC0_H0_VM1",
    ]);
  });

  test("five ESXi hosts get their own names, as vCenter spells them", () => {
    expect(recordedNamesOf(EntityType.VMwareHost)).toEqual([
      "DC0_C0_H0",
      "DC0_C0_H1",
      "DC0_C1_H0",
      "DC0_C1_H1",
      "DC0_H0",
    ]);
  });

  test("two clusters and a datastore get their own names, not the datacenter's", () => {
    expect(recordedNamesOf(EntityType.VMwareCluster)).toEqual([
      "DC0_C0",
      "DC0_C1",
    ]);
    expect(recordedNamesOf(EntityType.VMwareDatastore)).toEqual(["LocalDS_0"]);
  });

  test("the vCenter is named by vmware.vcenter.name", () => {
    expect(recordedNamesOf(EntityType.VMwareVCenter)).toEqual([
      "golden-vcenter",
    ]);
  });

  test("datacenters and resource pools are not Inventory items, so they need no name", () => {
    const kinds: Set<EntityType> = new Set<EntityType>();
    for (const attributes of recordedResources()) {
      for (const entity of extract(attributes)) {
        kinds.add(entity.entityType);
      }
    }
    expect(Array.from(kinds).sort()).toEqual(
      [
        EntityType.VMwareCluster,
        EntityType.VMwareDatastore,
        EntityType.VMwareHost,
        EntityType.VMwareVCenter,
        EntityType.VMwareVirtualMachine,
      ].sort(),
    );
  });

  test("a resource pool's resource names its cluster or host, never as the pool", () => {
    const pool: EntityAttributes = recordedResources().find(
      (attributes: EntityAttributes): boolean => {
        return (
          attributes["vcenter.resource_pool.name"] === "DC0_C0_RP1" &&
          !attributes["vcenter.vm.id"]
        );
      },
    )!;
    expect(nameOf(pool, EntityType.VMwareCluster)).toBe("DC0_C0");
  });
});

describe("a name nothing reports falls back to something that tells items apart", () => {
  const vcenter: EntityAttributes = {
    "vmware.vcenter.name": "vcsa01.acme.lan",
    "vcenter.datacenter.name": "DC-NORTH",
  };

  test("a template is named by vcenter.vm_template.name", () => {
    expect(
      nameOf(
        {
          ...vcenter,
          "vcenter.host.name": "esx-node-07.acme.lan",
          "vcenter.vm_template.name": "ubuntu-24.04-golden",
          "vcenter.vm_template.id": "50211d0c-8b8e-4f5c-9a43-3b7b0c6f1e2d",
        },
        EntityType.VMwareVirtualMachine,
      ),
    ).toBe("ubuntu-24.04-golden");
  });

  test("a VM vCenter names nothing is named by its instance UUID, not the vCenter", () => {
    expect(
      nameOf(
        { ...vcenter, "vcenter.vm.id": "4A1C9E72-5B3F-4C11-9D2E-7F1A2B3C4D5E" },
        EntityType.VMwareVirtualMachine,
      ),
    ).toBe("4a1c9e72-5b3f-4c11-9d2e-7f1a2b3c4d5e");
  });

  test("a host, cluster and datastore with no descriptive spelling read their identity", () => {
    const host: ExtractedEntity = ofType(
      { ...vcenter, "vcenter.host.name": "ESX-Node-07.ACME.lan" },
      EntityType.VMwareHost,
    );
    expect(InventoryItemService.deriveDisplayName(host)).toBe(
      "ESX-Node-07.ACME.lan",
    );
    expect(
      InventoryItemService.deriveDisplayName({
        ...host,
        descriptiveAttributes: {},
      }),
    ).toBe("esx-node-07.acme.lan");
  });

  test("vCenter's spelling is kept for every VMware kind, not lowercased", () => {
    const attributes: EntityAttributes = {
      "vmware.vcenter.name": "VCSA-Prod",
      "vcenter.datacenter.name": "DC-NORTH",
      "vcenter.cluster.name": "Prod-Cluster-A",
      "vcenter.host.name": "ESX-01.Acme.LAN",
      "vcenter.datastore.name": "DS_SSD_01",
    };
    expect(nameOf(attributes, EntityType.VMwareVCenter)).toBe("VCSA-Prod");
    expect(nameOf(attributes, EntityType.VMwareCluster)).toBe("Prod-Cluster-A");
    expect(nameOf(attributes, EntityType.VMwareHost)).toBe("ESX-01.Acme.LAN");
    expect(nameOf(attributes, EntityType.VMwareDatastore)).toBe("DS_SSD_01");
  });
});

describe("the same rule for Proxmox, OpenStack, XCP-ng and storage arrays", () => {
  test("a Proxmox node by its own name, not its cluster's", () => {
    expect(
      nameOf(
        {
          "proxmox.cluster.name": "pve-production",
          "proxmox.node.name": "pve1",
        },
        EntityType.ProxmoxNode,
      ),
    ).toBe("pve1");
  });

  test("a Proxmox guest by its name, else its VMID, never its cluster's", () => {
    const cluster: EntityAttributes = { "proxmox.cluster.name": "pve-prod" };
    expect(
      nameOf(
        {
          ...cluster,
          "proxmox.guest.vmid": "101",
          "proxmox.guest.name": "Web-01",
        },
        EntityType.ProxmoxGuest,
      ),
    ).toBe("Web-01");
    expect(
      nameOf(
        { ...cluster, "proxmox.guest.vmid": "101" },
        EntityType.ProxmoxGuest,
      ),
    ).toBe("101");
    expect(nameOf(cluster, EntityType.ProxmoxCluster)).toBe("pve-prod");
  });

  test("an OpenStack instance by its name, else its id, never its cloud's", () => {
    const cloud: EntityAttributes = { "openstack.cloud.name": "Acme-Cloud" };
    expect(
      nameOf(
        {
          ...cloud,
          "openstack.instance.id": "8f14e45f-ceea-467a-9575-c8a6d2a1b3c4",
          "openstack.instance.name": "api-gateway-2",
        },
        EntityType.OpenStackInstance,
      ),
    ).toBe("api-gateway-2");
    expect(
      nameOf(
        {
          ...cloud,
          "openstack.instance.id": "8f14e45f-ceea-467a-9575-c8a6d2a1b3c4",
        },
        EntityType.OpenStackInstance,
      ),
    ).toBe("8f14e45f-ceea-467a-9575-c8a6d2a1b3c4");
    expect(nameOf(cloud, EntityType.OpenStackCloud)).toBe("Acme-Cloud");
  });

  test("an OpenStack hypervisor by its own name", () => {
    expect(
      nameOf(
        {
          "openstack.cloud.name": "acme-cloud",
          "openstack.hypervisor.name": "compute-07.acme",
        },
        EntityType.OpenStackHypervisor,
      ),
    ).toBe("compute-07.acme");
  });

  test("an XCP-ng pool by its name, else as the XCP-ng pages call it, not by its UUID", () => {
    const poolId: string = "3F2A9C1E-0B4D-4E6F-8A1B-2C3D4E5F6A7B";
    expect(
      nameOf(
        { "xcp_ng.pool.id": poolId, "xcp_ng.pool.name": "Lab Pool" },
        EntityType.XcpNgPool,
      ),
    ).toBe("Lab Pool");
    expect(nameOf({ "xcp_ng.pool.id": poolId }, EntityType.XcpNgPool)).toBe(
      "Pool 3f2a9c1e",
    );
  });

  test("a storage array, a Ceph cluster and a swarm by their own names, as spelled", () => {
    expect(
      nameOf(
        {
          "storage.array.name": "Pure-Prod-01",
          "storage.system": "purestorage.flasharray",
        },
        EntityType.StorageArray,
      ),
    ).toBe("Pure-Prod-01");
    expect(
      nameOf({ "ceph.cluster.name": "Ceph-EU" }, EntityType.CephCluster),
    ).toBe("Ceph-EU");
    expect(
      nameOf(
        { "docker.swarm.cluster.name": "Swarm-Edge" },
        EntityType.DockerSwarmCluster,
      ),
    ).toBe("Swarm-Edge");
  });
});

describe("every kind ingest promotes has a naming rule", () => {
  /*
   * Kinds named some other way: by hand (manual), by the row they mirror
   * (InventoryEntityRegistry), by their own dependency rules (a database,
   * a remote endpoint), or never resolved from a resource at all (the swarm
   * node, service and task arrive as JSON-line logs, not resources).
   */
  const NAMED_ELSEWHERE: ReadonlySet<EntityType> = new Set<EntityType>([
    EntityType.Database,
    EntityType.RemoteService,
    EntityType.DockerSwarmNode,
    EntityType.DockerSwarmService,
    EntityType.DockerSwarmTask,
  ]);

  test("no promoted, discovered kind is left to the generic rule", () => {
    const missing: Array<EntityType> = Array.from(REGISTRY_PROMOTED_TYPES)
      .filter((entityType: EntityType): boolean => {
        return (
          !MANUAL_ENTITY_TYPES.has(entityType) &&
          !INVENTORY_ENTITY_TYPES.has(entityType) &&
          !NAMED_ELSEWHERE.has(entityType) &&
          !INVENTORY_DISPLAY_NAME_RULES.has(entityType)
        );
      })
      .sort();
    expect(missing).toEqual([]);
  });

  test("every rule reads at least one attribute", () => {
    const empty: Array<EntityType> = Array.from(
      INVENTORY_DISPLAY_NAME_RULES.entries(),
    )
      .filter(([, rule]: [EntityType, { keys: ReadonlyArray<string> }]) => {
        return rule.keys.length === 0;
      })
      .map(([entityType]: [EntityType, unknown]): EntityType => {
        return entityType;
      });
    expect(empty).toEqual([]);
  });

  test("the parents that named every child before (#11254) name no child now", () => {
    const parents: ReadonlyMap<string, EntityType> = new Map<
      string,
      EntityType
    >([
      ["vmware.vcenter.name", EntityType.VMwareVCenter],
      ["proxmox.cluster.name", EntityType.ProxmoxCluster],
      ["openstack.cloud.name", EntityType.OpenStackCloud],
      ["k8s.cluster.name", EntityType.KubernetesCluster],
    ]);
    const namedByAParent: Array<string> = [];
    for (const [entityType, rule] of INVENTORY_DISPLAY_NAME_RULES) {
      for (const key of rule.keys) {
        const owner: EntityType | undefined = parents.get(key);
        if (owner && owner !== entityType) {
          namedByAParent.push(`${entityType} reads ${key}`);
        }
      }
      if (rule.keys.includes("vcenter.datacenter.name")) {
        namedByAParent.push(`${entityType} reads vcenter.datacenter.name`);
      }
    }
    expect(namedByAParent).toEqual([]);
  });
});

describe("a stored row named by the old rule takes its own name on its next report", () => {
  test("a VM named after its vCenter is renamed to the VM's name", () => {
    const vm: ExtractedEntity = ofType(ITEM_A, EntityType.VMwareVirtualMachine);
    expect(
      renameOnNextReport(vm, existingRow({ displayName: "vcsa01.acme.lan" })),
    ).toBe("web-frontend-03");
  });

  test("an ESXi host, cluster and datastore named after their datacenter are renamed", () => {
    const attributes: EntityAttributes = {
      ...ITEM_A,
      "vcenter.datastore.name": "DS_SSD_01",
    };
    expect(
      renameOnNextReport(
        ofType(attributes, EntityType.VMwareHost),
        existingRow({ displayName: "dc-north" }),
      ),
    ).toBe("esx-node-07.acme.lan");
    expect(
      renameOnNextReport(
        ofType(attributes, EntityType.VMwareCluster),
        existingRow({ displayName: "dc-north" }),
      ),
    ).toBe("cluster-alpha");
    expect(
      renameOnNextReport(
        ofType(attributes, EntityType.VMwareDatastore),
        existingRow({ displayName: "dc-north" }),
      ),
    ).toBe("DS_SSD_01");
  });

  test("a Proxmox node and guest named after their cluster, and an OpenStack instance after its cloud", () => {
    expect(
      renameOnNextReport(
        ofType(
          {
            "proxmox.cluster.name": "pve-production",
            "proxmox.node.name": "pve1",
          },
          EntityType.ProxmoxNode,
        ),
        existingRow({ displayName: "pve-production" }),
      ),
    ).toBe("pve1");
    expect(
      renameOnNextReport(
        ofType(
          {
            "proxmox.cluster.name": "pve-production",
            "proxmox.guest.vmid": "101",
            "proxmox.guest.name": "web-01",
          },
          EntityType.ProxmoxGuest,
        ),
        existingRow({ displayName: "pve-production" }),
      ),
    ).toBe("web-01");
    expect(
      renameOnNextReport(
        ofType(
          {
            "openstack.cloud.name": "acme-cloud",
            "openstack.instance.id": "8f14e45f-ceea-467a-9575-c8a6d2a1b3c4",
            "openstack.instance.name": "api-gateway-2",
          },
          EntityType.OpenStackInstance,
        ),
        existingRow({ displayName: "acme-cloud" }),
      ),
    ).toBe("api-gateway-2");
  });

  test("an XCP-ng pool named by its UUID takes its name", () => {
    expect(
      renameOnNextReport(
        ofType(
          {
            "xcp_ng.pool.id": "3f2a9c1e-0b4d-4e6f-8a1b-2c3d4e5f6a7b",
            "xcp_ng.pool.name": "Lab Pool",
          },
          EntityType.XcpNgPool,
        ),
        existingRow({ displayName: "3f2a9c1e-0b4d-4e6f-8a1b-2c3d4e5f6a7b" }),
      ),
    ).toBe("Lab Pool");
  });

  test("a name read from the identity alone takes vCenter's spelling once it arrives", () => {
    const host: ExtractedEntity = ofType(
      {
        ...ITEM_A,
        "vcenter.host.name": "ESX-Node-07.acme.lan",
      },
      EntityType.VMwareHost,
    );
    expect(
      renameOnNextReport(
        host,
        existingRow({ displayName: "esx-node-07.acme.lan" }),
      ),
    ).toBe("ESX-Node-07.acme.lan");
  });

  test("a VM renamed in vCenter is renamed in Inventory too", () => {
    const vm: ExtractedEntity = ofType(
      { ...ITEM_A, "vcenter.vm.name": "web-frontend-04" },
      EntityType.VMwareVirtualMachine,
    );
    expect(
      renameOnNextReport(
        vm,
        existingRow({
          displayName: "web-frontend-03",
          descriptiveAttributes: { "vcenter.vm.name": "web-frontend-03" },
        }),
      ),
    ).toBe("web-frontend-04");
  });

  test("a name a person typed on the item's Settings page is kept", () => {
    const vm: ExtractedEntity = ofType(ITEM_A, EntityType.VMwareVirtualMachine);
    expect(
      renameOnNextReport(
        vm,
        existingRow({
          displayName: "Storefront (blue)",
          descriptiveAttributes: { "vcenter.vm.name": "web-frontend-03" },
        }),
      ),
    ).toBeUndefined();
    expect(
      renameOnNextReport(
        ofType(ITEM_A, EntityType.VMwareHost),
        existingRow({ displayName: "Rack 7, top" }),
      ),
    ).toBeUndefined();
  });

  test("a report that does not name the VM keeps the name learned before", () => {
    const sparse: ExtractedEntity = ofType(
      {
        "vmware.vcenter.name": "vcsa01.acme.lan",
        "vcenter.vm.id": "4a1c9e72-5b3f-4c11-9d2e-7f1a2b3c4d5e",
      },
      EntityType.VMwareVirtualMachine,
    );
    expect(
      renameOnNextReport(
        sparse,
        existingRow({
          displayName: "web-frontend-03",
          descriptiveAttributes: { "vcenter.vm.name": "web-frontend-03" },
        }),
      ),
    ).toBeUndefined();
  });

  test("a row whose name is current writes nothing", () => {
    const vm: ExtractedEntity = ofType(ITEM_A, EntityType.VMwareVirtualMachine);
    expect(
      renameOnNextReport(
        vm,
        existingRow({
          displayName: "web-frontend-03",
          descriptiveAttributes: vm.descriptiveAttributes,
        }),
      ),
    ).toBeUndefined();
  });

  test("a row with no name yet is given one", () => {
    expect(
      renameOnNextReport(
        ofType(ITEM_B, EntityType.VMwareVirtualMachine),
        existingRow({}),
      ),
    ).toBe("billing-db-01");
  });

  test("a VM first seen without a name, named by its UUID, takes its name later", () => {
    expect(
      renameOnNextReport(
        ofType(ITEM_A, EntityType.VMwareVirtualMachine),
        existingRow({ displayName: "4a1c9e72-5b3f-4c11-9d2e-7f1a2b3c4d5e" }),
      ),
    ).toBe("web-frontend-03");
  });
});

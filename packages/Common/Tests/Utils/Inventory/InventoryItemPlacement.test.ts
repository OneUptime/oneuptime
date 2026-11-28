import {
  INVENTORY_PLACEMENT_ATTRIBUTES,
  INVENTORY_PLACEMENT_LEVELS,
  INVENTORY_PLACEMENT_LEVEL_ATTRIBUTES,
  INVENTORY_PLACEMENT_LEVEL_COLUMNS,
  INVENTORY_PLACEMENT_TRIMMED_CODE_POINTS,
  InventoryPlacementLevel,
  getInventoryItemPlacement,
  getInventoryItemPlacementAt,
  getInventoryPlacementAttribute,
  getInventoryPlacementLevelTypes,
  getInventoryPlacementSql,
  isInventoryPlacementLevel,
} from "../../../Utils/Inventory/InventoryItemPlacement";
import EntityType from "../../../Types/Telemetry/EntityType";
import { describe, expect, test } from "@jest/globals";

/*
 * WHERE AN ITEM SITS, UNDER ITS NAME IN INVENTORY'S LIST (#11254).
 *
 * The issue asked for a VM's cluster and host beside its name: a name alone
 * does not tell two VMs called web-01 in two folders apart, nor a cluster
 * from another datacenter's of the same name. The line is read from the
 * attributes the row keeps - the producer's spelling first - and is the
 * nearest two places, nothing for a root or an item that reports none.
 */

describe("getInventoryItemPlacement", () => {
  test("a VM reads its ESXi host and cluster, as the issue asks", () => {
    expect(
      getInventoryItemPlacement({
        entityType: EntityType.VMwareVirtualMachine,
        identifyingAttributes: {
          "vmware.vcenter.name": "vcsa01.acme.lan",
          "vcenter.vm.id": "4a1c9e72-5b3f-4c11-9d2e-7f1a2b3c4d5e",
        },
        descriptiveAttributes: {
          "vcenter.vm.name": "web-frontend-03",
          "vcenter.host.name": "esx-node-07.acme.lan",
          "vcenter.cluster.name": "cluster-alpha",
          "vcenter.datacenter.name": "DC-NORTH",
        },
      }),
    ).toBe("esx-node-07.acme.lan · cluster-alpha");
  });

  test("a VM on a standalone host reads its host and datacenter", () => {
    expect(
      getInventoryItemPlacement({
        entityType: EntityType.VMwareVirtualMachine,
        descriptiveAttributes: {
          "vcenter.host.name": "esx-standalone",
          "vcenter.datacenter.name": "DC-EDGE",
        },
      }),
    ).toBe("esx-standalone · DC-EDGE");
  });

  test("an ESXi host reads its cluster, then its datacenter as vCenter spells it", () => {
    expect(
      getInventoryItemPlacement({
        entityType: EntityType.VMwareHost,
        identifyingAttributes: {
          "vmware.vcenter.name": "vcsa01.acme.lan",
          "vcenter.datacenter.name": "dc-north",
          "vcenter.host.name": "esx-node-07.acme.lan",
        },
        descriptiveAttributes: { "vcenter.cluster.name": "cluster-alpha" },
      }),
    ).toBe("cluster-alpha · dc-north");
  });

  test("a cluster and a datastore read their datacenter", () => {
    for (const entityType of [
      EntityType.VMwareCluster,
      EntityType.VMwareDatastore,
    ]) {
      expect(
        getInventoryItemPlacement({
          entityType,
          identifyingAttributes: { "vcenter.datacenter.name": "dc-north" },
        }),
      ).toBe("dc-north");
    }
  });

  test("Proxmox, OpenStack, XCP-ng and Kubernetes items read their parents", () => {
    expect(
      getInventoryItemPlacement({
        entityType: EntityType.ProxmoxGuest,
        identifyingAttributes: {
          "proxmox.cluster.name": "pve-prod",
          "proxmox.guest.vmid": "101",
        },
      }),
    ).toBe("pve-prod");
    expect(
      getInventoryItemPlacement({
        entityType: EntityType.OpenStackInstance,
        identifyingAttributes: { "openstack.cloud.name": "acme-cloud" },
        descriptiveAttributes: { "openstack.hypervisor.name": "compute-07" },
      }),
    ).toBe("compute-07 · acme-cloud");
    expect(
      getInventoryItemPlacement({
        entityType: EntityType.XcpNgPool,
        descriptiveAttributes: { "xen_orchestra.name": "xo-prod" },
      }),
    ).toBe("xo-prod");
    expect(
      getInventoryItemPlacement({
        entityType: EntityType.KubernetesPod,
        identifyingAttributes: {
          "k8s.cluster.name": "prod-eu",
          "k8s.namespace.name": "payments",
          "k8s.pod.name": "checkout-7d9f",
        },
      }),
    ).toBe("payments · prod-eu");
  });

  test("a root, a kind with no place and an item that reports none read nothing", () => {
    expect(
      getInventoryItemPlacement({
        entityType: EntityType.VMwareVCenter,
        identifyingAttributes: { "vmware.vcenter.name": "vcsa01.acme.lan" },
      }),
    ).toBeNull();
    expect(
      getInventoryItemPlacement({
        entityType: EntityType.Service,
        identifyingAttributes: { "service.name": "checkout" },
      }),
    ).toBeNull();
    expect(
      getInventoryItemPlacement({
        entityType: EntityType.VMwareVirtualMachine,
        identifyingAttributes: {
          "vmware.vcenter.name": "vcsa01.acme.lan",
          "vcenter.vm.id": "4a1c9e72-5b3f-4c11-9d2e-7f1a2b3c4d5e",
        },
      }),
    ).toBeNull();
    expect(getInventoryItemPlacement({ entityType: undefined })).toBeNull();
  });

  test("blank and non-string values are no place", () => {
    expect(
      getInventoryItemPlacement({
        entityType: EntityType.VMwareVirtualMachine,
        descriptiveAttributes: {
          "vcenter.host.name": "   ",
          "vcenter.cluster.name": 42,
          "vcenter.datacenter.name": " DC-NORTH ",
        },
      }),
    ).toBe("DC-NORTH");
  });

  test("never names the item itself: no kind lists its own name as its place", () => {
    const ownName: Partial<Record<EntityType, string>> = {
      [EntityType.VMwareVirtualMachine]: "vcenter.vm.name",
      [EntityType.VMwareHost]: "vcenter.host.name",
      [EntityType.VMwareCluster]: "vcenter.cluster.name",
      [EntityType.VMwareDatastore]: "vcenter.datastore.name",
      [EntityType.ProxmoxNode]: "proxmox.node.name",
      [EntityType.ProxmoxGuest]: "proxmox.guest.name",
      [EntityType.OpenStackHypervisor]: "openstack.hypervisor.name",
      [EntityType.OpenStackInstance]: "openstack.instance.name",
      [EntityType.XcpNgPool]: "xcp_ng.pool.name",
      [EntityType.KubernetesNamespace]: "k8s.namespace.name",
      [EntityType.KubernetesNode]: "k8s.node.name",
      [EntityType.KubernetesPod]: "k8s.pod.name",
      [EntityType.KubernetesDeployment]: "k8s.deployment.name",
    };
    const selfNamed: Array<EntityType> = [];
    for (const [entityType, keys] of INVENTORY_PLACEMENT_ATTRIBUTES) {
      if (keys.includes(ownName[entityType] || "")) {
        selfNamed.push(entityType);
      }
    }
    expect(selfNamed).toEqual([]);
  });
});

/*
 * WHERE AN ITEM SITS, AS A FILTER (#11470): the cluster, the host and the
 * datacenter an item is in, read by the rule the list's line is read by,
 * and the same rule written as the SQL Postgres filters and counts by.
 */
describe("the places Inventory filters by", () => {
  const VM: {
    entityType: EntityType;
    identifyingAttributes: Record<string, unknown>;
    descriptiveAttributes: Record<string, unknown>;
  } = {
    entityType: EntityType.VMwareVirtualMachine,
    identifyingAttributes: {
      "vmware.vcenter.name": "vcsa01.acme.lan",
      "vcenter.vm.id": "4a1c9e72-5b3f-4c11-9d2e-7f1a2b3c4d5e",
      "vcenter.datacenter.name": "dc-north",
    },
    descriptiveAttributes: {
      "vcenter.host.name": "esx-node-07.acme.lan",
      "vcenter.cluster.name": "cluster-alpha",
      "vcenter.datacenter.name": "DC-NORTH",
    },
  };

  test("are the cluster, the host and the datacenter, in that order", () => {
    expect(INVENTORY_PLACEMENT_LEVELS).toEqual([
      InventoryPlacementLevel.Cluster,
      InventoryPlacementLevel.Host,
      InventoryPlacementLevel.Datacenter,
    ]);
    expect(INVENTORY_PLACEMENT_LEVEL_COLUMNS).toEqual({
      cluster: "placementCluster",
      host: "placementHost",
      datacenter: "placementDatacenter",
    });
    expect(isInventoryPlacementLevel("cluster")).toBe(true);
    expect(isInventoryPlacementLevel("namespace")).toBe(false);
    expect(isInventoryPlacementLevel(undefined)).toBe(false);
  });

  test("each is named only by place attributes the list reads", () => {
    const placeKeys: Set<string> = new Set<string>(
      Array.from(INVENTORY_PLACEMENT_ATTRIBUTES.values()).flat(),
    );
    for (const level of INVENTORY_PLACEMENT_LEVELS) {
      for (const key of INVENTORY_PLACEMENT_LEVEL_ATTRIBUTES[level]) {
        expect({ level, key, isPlace: placeKeys.has(key) }).toEqual({
          level,
          key,
          isPlace: true,
        });
      }
    }
  });

  test("a kind sits at a level by at most one attribute", () => {
    for (const [entityType, keys] of INVENTORY_PLACEMENT_ATTRIBUTES) {
      for (const level of INVENTORY_PLACEMENT_LEVELS) {
        const named: Array<string> = keys.filter((key: string): boolean => {
          return INVENTORY_PLACEMENT_LEVEL_ATTRIBUTES[level].includes(key);
        });
        expect({ entityType, level, many: named.length > 1 }).toEqual({
          entityType,
          level,
          many: false,
        });
      }
    }
  });

  test("a VM sits on a host, in a cluster and in a datacenter", () => {
    expect(
      getInventoryPlacementAttribute(
        EntityType.VMwareVirtualMachine,
        InventoryPlacementLevel.Host,
      ),
    ).toBe("vcenter.host.name");
    expect(getInventoryItemPlacementAt(VM, InventoryPlacementLevel.Host)).toBe(
      "esx-node-07.acme.lan",
    );
    expect(
      getInventoryItemPlacementAt(VM, InventoryPlacementLevel.Cluster),
    ).toBe("cluster-alpha");
    // As the producer spelled it, ahead of the identity's spelling.
    expect(
      getInventoryItemPlacementAt(VM, InventoryPlacementLevel.Datacenter),
    ).toBe("DC-NORTH");
  });

  test("which kinds sit somewhere at each level", () => {
    expect(
      getInventoryPlacementLevelTypes(InventoryPlacementLevel.Cluster),
    ).toEqual([
      EntityType.VMwareVirtualMachine,
      EntityType.VMwareHost,
      EntityType.ProxmoxNode,
      EntityType.ProxmoxGuest,
      EntityType.KubernetesNamespace,
      EntityType.KubernetesNode,
      EntityType.KubernetesPod,
      EntityType.KubernetesDeployment,
    ]);
    expect(
      getInventoryPlacementLevelTypes(InventoryPlacementLevel.Host),
    ).toEqual([EntityType.VMwareVirtualMachine, EntityType.OpenStackInstance]);
    expect(
      getInventoryPlacementLevelTypes(InventoryPlacementLevel.Datacenter),
    ).toEqual([
      EntityType.VMwareVirtualMachine,
      EntityType.VMwareHost,
      EntityType.VMwareCluster,
      EntityType.VMwareDatastore,
    ]);
  });

  test("an OpenStack instance's host is its hypervisor; a pod's cluster its Kubernetes cluster", () => {
    expect(
      getInventoryItemPlacementAt(
        {
          entityType: EntityType.OpenStackInstance,
          descriptiveAttributes: {
            "openstack.hypervisor.name": "compute-03",
            "openstack.cloud.name": "prod",
          },
        },
        InventoryPlacementLevel.Host,
      ),
    ).toBe("compute-03");
    expect(
      getInventoryItemPlacementAt(
        {
          entityType: EntityType.KubernetesPod,
          identifyingAttributes: {
            "k8s.namespace.name": "payments",
            "k8s.cluster.name": "prod-eu",
          },
        },
        InventoryPlacementLevel.Cluster,
      ),
    ).toBe("prod-eu");
  });

  test("a kind with no place at a level, a root, an unknown kind and a blank are in none", () => {
    const cases: Array<
      [
        Parameters<typeof getInventoryItemPlacementAt>[0],
        InventoryPlacementLevel,
      ]
    > = [
      [
        {
          entityType: EntityType.VMwareHost,
          descriptiveAttributes: { "vcenter.host.name": "x" },
        },
        InventoryPlacementLevel.Host,
      ],
      [
        {
          entityType: EntityType.OpenStackHypervisor,
          descriptiveAttributes: { "openstack.cloud.name": "prod" },
        },
        InventoryPlacementLevel.Cluster,
      ],
      [
        {
          entityType: EntityType.XcpNgPool,
          descriptiveAttributes: { "xen_orchestra.name": "xo" },
        },
        InventoryPlacementLevel.Cluster,
      ],
      [
        {
          entityType: EntityType.KubernetesCluster,
          descriptiveAttributes: { "k8s.cluster.name": "prod-eu" },
        },
        InventoryPlacementLevel.Cluster,
      ],
      [
        {
          entityType: "some.future.type",
          descriptiveAttributes: { "vcenter.cluster.name": "c" },
        },
        InventoryPlacementLevel.Cluster,
      ],
      [
        {
          entityType: EntityType.VMwareVirtualMachine,
          descriptiveAttributes: { "vcenter.cluster.name": "  " },
        },
        InventoryPlacementLevel.Cluster,
      ],
      [
        {
          entityType: EntityType.VMwareVirtualMachine,
          descriptiveAttributes: { "vcenter.cluster.name": 7 },
        },
        InventoryPlacementLevel.Cluster,
      ],
      [
        { entityType: EntityType.VMwareVirtualMachine },
        InventoryPlacementLevel.Cluster,
      ],
    ];
    for (const [item, level] of cases) {
      expect({
        entityType: item.entityType,
        level,
        place: getInventoryItemPlacementAt(item, level),
      }).toEqual({ entityType: item.entityType, level, place: null });
    }
  });

  test("every place at a level is one the list's line can show", () => {
    for (const level of INVENTORY_PLACEMENT_LEVELS) {
      for (const entityType of getInventoryPlacementLevelTypes(level)) {
        const key: string = getInventoryPlacementAttribute(entityType, level)!;
        const keys: ReadonlyArray<string> =
          INVENTORY_PLACEMENT_ATTRIBUTES.get(entityType)!;
        expect({ entityType, level, listed: keys.includes(key) }).toEqual({
          entityType,
          level,
          listed: true,
        });
      }
    }
  });
});

describe("the places as SQL", () => {
  test("one branch per attribute, keyed by the kinds that read it, NULL for anything else", () => {
    const sql: string = getInventoryPlacementSql(
      `"InventoryItem"`,
      InventoryPlacementLevel.Cluster,
    );
    expect(sql.startsWith("(CASE WHEN ")).toBe(true);
    expect(sql.endsWith(" ELSE NULL END)")).toBe(true);
    expect(sql).toContain(
      `WHEN "InventoryItem"."entityType" IN ('vmware.vm', 'vmware.host') THEN`,
    );
    expect(sql).toContain(
      `WHEN "InventoryItem"."entityType" IN ('proxmox.node', 'proxmox.guest') THEN`,
    );
    expect(sql).toContain(
      `WHEN "InventoryItem"."entityType" IN ('k8s.namespace', 'k8s.node', 'k8s.pod', 'k8s.deployment') THEN`,
    );
    expect(sql.match(/WHEN "InventoryItem"\."entityType"/g)).toHaveLength(3);
  });

  test("reads the producer's spelling first, then the identity's, strings only, trimmed", () => {
    const sql: string = getInventoryPlacementSql(
      `"InventoryItem"`,
      InventoryPlacementLevel.Datacenter,
    );
    const descriptive: number = sql.indexOf(
      `jsonb_typeof("InventoryItem"."descriptiveAttributes" -> 'vcenter.datacenter.name') = 'string'`,
    );
    const identifying: number = sql.indexOf(
      `jsonb_typeof("InventoryItem"."identifyingAttributes" -> 'vcenter.datacenter.name') = 'string'`,
    );
    expect(descriptive).toBeGreaterThan(0);
    expect(identifying).toBeGreaterThan(descriptive);
    expect(sql).toContain("COALESCE(NULLIF(BTRIM(");
    // Every character JavaScript's trim takes off.
    for (const codePoint of INVENTORY_PLACEMENT_TRIMMED_CODE_POINTS) {
      expect(sql).toContain(`chr(${codePoint})`);
      expect(String.fromCodePoint(codePoint).trim()).toBe("");
    }
    // And one it leaves: a zero-width space is part of a name.
    expect(`x${String.fromCodePoint(0x200b)}`.trim()).not.toBe("x");
  });

  test("is written for the alias it is handed, and binds nothing", () => {
    const sql: string = getInventoryPlacementSql(
      `"scope"`,
      InventoryPlacementLevel.Host,
    );
    expect(sql).toContain(`"scope"."entityType"`);
    expect(sql).not.toContain(`"InventoryItem"`);
    expect(sql).not.toMatch(/:\w+|\$\d/);
    expect(sql).not.toContain(";");
  });
});

import {
  INVENTORY_PLACEMENT_ATTRIBUTES,
  getInventoryItemPlacement,
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

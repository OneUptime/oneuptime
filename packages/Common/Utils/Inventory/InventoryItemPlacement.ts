import EntityType from "../../Types/Telemetry/EntityType";

/*
 * WHERE AN INVENTORY ITEM SITS, UNDER ITS NAME IN THE LIST (#11254).
 *
 * A name alone does not tell two items apart. vSphere lets two VMs in two
 * folders share a name, a cluster and a datastore are named within their
 * datacenter, and a pod is named within its namespace. So Inventory's list
 * says under each name where it is: a VM's ESXi host and cluster, a host's
 * cluster and datacenter, a pod's namespace and cluster.
 *
 * Each kind lists the attributes that say where, the nearest first. The
 * first two of them an item reports are shown, joined by " · ", each as the
 * producer spelled it (its descriptive attributes) where the item keeps it,
 * else as its identity holds it. Nothing is shown for a kind not listed, a
 * root (a vCenter, a Kubernetes cluster) or an item that reports none.
 */
export const INVENTORY_PLACEMENT_SEPARATOR: string = " · ";

// How many of a kind's places are shown: the nearest two say where it is.
export const INVENTORY_PLACEMENT_MAX_PARTS: number = 2;

export const INVENTORY_PLACEMENT_ATTRIBUTES: ReadonlyMap<
  EntityType,
  ReadonlyArray<string>
> = new Map<EntityType, ReadonlyArray<string>>([
  // On a standalone host a VM has no cluster: its datacenter says where.
  [
    EntityType.VMwareVirtualMachine,
    ["vcenter.host.name", "vcenter.cluster.name", "vcenter.datacenter.name"],
  ],
  [EntityType.VMwareHost, ["vcenter.cluster.name", "vcenter.datacenter.name"]],
  [EntityType.VMwareCluster, ["vcenter.datacenter.name"]],
  [EntityType.VMwareDatastore, ["vcenter.datacenter.name"]],
  [EntityType.ProxmoxNode, ["proxmox.cluster.name"]],
  [EntityType.ProxmoxGuest, ["proxmox.cluster.name"]],
  [EntityType.OpenStackHypervisor, ["openstack.cloud.name"]],
  [
    EntityType.OpenStackInstance,
    ["openstack.hypervisor.name", "openstack.cloud.name"],
  ],
  [EntityType.XcpNgPool, ["xen_orchestra.name"]],
  [EntityType.KubernetesNamespace, ["k8s.cluster.name"]],
  [EntityType.KubernetesNode, ["k8s.cluster.name"]],
  [EntityType.KubernetesPod, ["k8s.namespace.name", "k8s.cluster.name"]],
  [EntityType.KubernetesDeployment, ["k8s.namespace.name", "k8s.cluster.name"]],
]);

function readString(
  attributes: Record<string, unknown> | null | undefined,
  key: string,
): string {
  if (!attributes || typeof attributes !== "object") {
    return "";
  }
  const value: unknown = attributes[key];
  return typeof value === "string" ? value.trim() : "";
}

/*
 * "esx-node-07.acme.lan · cluster-alpha" for a VM, or null when the item's
 * kind has no place, or it reports none.
 */
export function getInventoryItemPlacement(item: {
  entityType?: EntityType | string | undefined;
  identifyingAttributes?: Record<string, unknown> | null | undefined;
  descriptiveAttributes?: Record<string, unknown> | null | undefined;
}): string | null {
  const keys: ReadonlyArray<string> | undefined =
    INVENTORY_PLACEMENT_ATTRIBUTES.get(item.entityType as EntityType);
  if (!keys) {
    return null;
  }

  const parts: Array<string> = [];
  for (const key of keys) {
    const value: string =
      readString(item.descriptiveAttributes, key) ||
      readString(item.identifyingAttributes, key);
    if (value) {
      parts.push(value);
    }
    if (parts.length === INVENTORY_PLACEMENT_MAX_PARTS) {
      break;
    }
  }

  return parts.length > 0 ? parts.join(INVENTORY_PLACEMENT_SEPARATOR) : null;
}

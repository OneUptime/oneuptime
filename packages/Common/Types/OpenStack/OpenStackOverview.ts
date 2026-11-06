/*
 * What a cloud's Overview reads beyond its inventory summary, in one shape for the server
 * that answers it (OpenStackResourceService) and the page that draws it.
 */

/*
 * Rows a read counted and did not bring. A cloud of 5,000 hypervisors holds 20,000 hosts and workers,
 * and the Overview needs every one of them only to say how many are up: read whole, that is 12 MB
 * of JSON every time it opens. So past a line a read brings the ones that may need someone, and
 * says how many others there are, by whatever a page counts them by.
 */
export type OpenStackRowState = "up" | "down" | "disabled";

export interface OpenStackRowsLeftOut {
  kind: string;
  regionName: string | null;
  // A worker's binary, and whose it is. A hypervisor is counted by neither.
  name: string | null;
  family: string | null;
  state: OpenStackRowState;
  count: number;
}

// What one region holds: the Overview's Regions card reads these.
export interface OpenStackRegionSummary {
  regionName: string;
  apiCount: number;
  downApiCount: number;
  serviceCount: number;
  // An enabled one. A service someone disabled is planned work, and is not down.
  downServiceCount: number;
  hypervisorCount: number;
  instanceCount: number;
  vcpuCapacity: number;
  vcpuAllocated: number;
  memoryCapacityBytes: number;
  memoryAllocatedBytes: number;
  storageCapacityBytes: number;
  storageUsedBytes: number;
}

export interface OpenStackTopConsumer {
  // Keystone's ID, because a project can be renamed.
  projectId: string;
  // Its name when the inventory holds its project row.
  name: string | null;
  value: number;
}

export interface OpenStackTopConsumers {
  projectsByInstances: Array<OpenStackTopConsumer>;
  projectsByVolumeBytes: Array<OpenStackTopConsumer>;
}

/*
 * What a cloud's Overview reads beyond its inventory summary, in one shape for the server
 * that answers it (OpenStackResourceService) and the page that draws it.
 */

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

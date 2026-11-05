/*
 * What there is of one resource class, as the Bare Metal page shows it: counted on the server, from
 * the nodes' rows. A node may be counted twice over, in maintenance and failed say, because both are
 * true of it. `resourceClass` is null for a node that has none, which no flavor can ask for.
 */
export interface OpenStackBareMetalClass {
  resourceClass: string | null;
  nodeCount: number;
  // What Nova's Ironic driver would offer: canOpenStackBareMetalNodeTakeAnInstance.
  availableCount: number;
  deployedCount: number;
  maintenanceCount: number;
  failedCount: number;
}

// More classes than this and a page has stopped being read. A cloud has a few.
export const OPENSTACK_BARE_METAL_CLASS_LIMIT: number = 100;

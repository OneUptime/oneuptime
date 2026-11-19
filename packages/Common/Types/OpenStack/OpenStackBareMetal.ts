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

/*
 * The most failed nodes of one class the Bare Metal page's "Failed: N" lists when pressed
 * (#9751): what someone reads through, the rest a step away on the nodes list.
 */
export const OPENSTACK_BARE_METAL_FAILED_NODES_LIMIT: number = 100;

/*
 * A resource class as the page names it to the server: one a node has, or null for the nodes
 * with none - which the class count groups apart from an empty string, as Postgres does.
 */
export type OpenStackBareMetalResourceClass = string | null;

// The longest resource class a request may name. Ironic's own limit is 80.
export const OPENSTACK_BARE_METAL_RESOURCE_CLASS_MAX_LENGTH: number = 255;

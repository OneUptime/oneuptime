/*
 * The kinds of row OpenStackResource holds, and which OpenStack service reports
 * each one. The ingest scan, the stale-row rule and the dashboard all read these
 * literal strings, so they live in one place.
 */

export enum OpenStackResourceKind {
  // One service's API in one region, up or down.
  Api = "Api",
  /*
   * A worker: nova-compute, nova-scheduler, nova-conductor, a Neutron agent,
   * cinder-volume and so on. OpenStack's own lists split these three ways
   * (compute service, network agent, volume service), and an operator reads them
   * as one question, so they are one kind with a family.
   */
  Service = "Service",
  Hypervisor = "Hypervisor",
  Instance = "Instance",
  Flavor = "Flavor",
  Image = "Image",
  Volume = "Volume",
  StoragePool = "StoragePool",
  Snapshot = "Snapshot",
  // Only a probe reports these: the exporter has no series for a volume backup.
  Backup = "Backup",
  Network = "Network",
  Subnet = "Subnet",
  Router = "Router",
  FloatingIp = "FloatingIp",
  Project = "Project",
  Domain = "Domain",
  /*
   * One machine of what the cloud stands on: a RabbitMQ node, a MariaDB one, a host's Open
   * vSwitch. Its facts say which (OpenStackControlPlane). No OpenStack service reports these
   * and none vouches for them, so they age out on their own: see deleteStaleForCloud.
   */
  ControlPlane = "ControlPlane",
  /*
   * One machine Ironic manages. Its status is its provision state, and its adminState says
   * whether someone put it in maintenance, with their reason in disabledReason, as a disabled
   * worker's does. Only Ironic's own series make one (OpenStackSnapshotScan), so a cloud without
   * Ironic has none.
   */
  BareMetalNode = "BareMetalNode",
  /*
   * What Placement holds of a bare metal node: one of its own resource class, under the node's
   * UUID. Nova's Ironic driver names a hypervisor the same way, and neither is a place to run a
   * virtual machine, so neither is a Hypervisor row. No page lists these. They are what capacity
   * by resource class adds up, and what says how many nodes there are whatever Ironic shows this
   * credential: it answers a project with only what that project owns.
   */
  PlacementProvider = "PlacementProvider",
}

/*
 * The OpenStack services the agent scrapes one at a time, by the name the
 * exporter's `include_services` parameter and the Keystone catalog use.
 */
export enum OpenStackServiceType {
  Identity = "identity",
  Compute = "compute",
  Placement = "placement",
  Network = "network",
  Volume = "volume",
  Image = "image",
  // A service a cloud may not run: see OPENSTACK_SERVICES_EVERY_CLOUD_RUNS.
  BareMetal = "baremetal",
}

/*
 * The services a scrape's own series can speak for, because every cloud runs them. The agent also
 * asks the exporter for services a cloud may not run, such as load-balancer and baremetal, and for
 * one that is not in the catalog the exporter answers 200 with nothing. `up` reads 1 for that
 * scrape, and 0 for all of them when the exporter is down, on a cloud that has never had the
 * service. So these series never make a row for one of those: only what the exporter says about the
 * service itself can, which it says only if the catalog has it. This is written out rather than read
 * from OpenStackServiceType, so that adding a service there does not start giving every cloud a row
 * for it. So are the agent's VM metric jobs left out, which read compute nodes rather than an API
 * to list.
 */
export const OPENSTACK_SERVICES_EVERY_CLOUD_RUNS: ReadonlySet<string> = new Set(
  [
    OpenStackServiceType.Identity,
    OpenStackServiceType.Compute,
    OpenStackServiceType.Placement,
    OpenStackServiceType.Network,
    OpenStackServiceType.Volume,
    OpenStackServiceType.Image,
  ],
);

// The word people use for each service, in lists and alert text.
export const OPENSTACK_SERVICE_TITLES: Record<OpenStackServiceType, string> = {
  [OpenStackServiceType.Identity]: "Identity (Keystone)",
  [OpenStackServiceType.Compute]: "Compute (Nova)",
  [OpenStackServiceType.Placement]: "Placement",
  [OpenStackServiceType.Network]: "Networking (Neutron)",
  [OpenStackServiceType.Volume]: "Block Storage (Cinder)",
  [OpenStackServiceType.Image]: "Images (Glance)",
  [OpenStackServiceType.BareMetal]: "Bare Metal (Ironic)",
};

/*
 * Which service's scrape vouches for each kind's rows. A row ages out only when
 * this service's scrape succeeded without it, so a failing Nova never empties
 * its instances: see OpenStackResourceService.deleteStaleForCloud.
 *
 * Project and Domain are global to a Keystone rather than to a region, and a
 * Hypervisor is reported by both Nova and Placement: Nova's scrape vouches for it.
 */
export const OPENSTACK_KINDS_BY_SERVICE: Record<
  OpenStackServiceType,
  ReadonlyArray<OpenStackResourceKind>
> = {
  [OpenStackServiceType.Identity]: [
    OpenStackResourceKind.Project,
    OpenStackResourceKind.Domain,
  ],
  [OpenStackServiceType.Compute]: [
    OpenStackResourceKind.Hypervisor,
    OpenStackResourceKind.Instance,
    OpenStackResourceKind.Flavor,
  ],
  [OpenStackServiceType.Placement]: [OpenStackResourceKind.PlacementProvider],
  [OpenStackServiceType.Network]: [
    OpenStackResourceKind.Network,
    OpenStackResourceKind.Subnet,
    OpenStackResourceKind.Router,
    OpenStackResourceKind.FloatingIp,
  ],
  [OpenStackServiceType.Volume]: [
    OpenStackResourceKind.Volume,
    OpenStackResourceKind.StoragePool,
    OpenStackResourceKind.Snapshot,
    OpenStackResourceKind.Backup,
  ],
  [OpenStackServiceType.Image]: [OpenStackResourceKind.Image],
  [OpenStackServiceType.BareMetal]: [OpenStackResourceKind.BareMetalNode],
};

/*
 * Which family a Service row belongs to. The words differ by family, and each
 * keeps its own: Nova and Cinder say enabled and disabled, Neutron says up and
 * down.
 */
export enum OpenStackServiceFamily {
  Compute = "compute",
  Network = "network",
  Volume = "volume",
  // Only a probe says these: the exporter has no series for Ironic's conductors.
  BareMetal = "baremetal",
}

/*
 * Words for a row's status. These are OpenStack's own, as `status` holds them;
 * the sets say which ones the health rules and the stuck-state rule treat alike.
 */

// A worker's status: `openstack compute service list` and friends.
export const OPENSTACK_SERVICE_STATUS_UP: string = "up";
export const OPENSTACK_SERVICE_STATUS_DOWN: string = "down";
/*
 * An API this credential can't read: a page's word, never stored or reported. Its own status
 * says down, and getOpenStackRowsAsThisCredentialReadsThem says why that means nothing here.
 */
export const OPENSTACK_API_STATUS_CLOSED: string = "closed";

// Instance statuses that are on the way to something else.
export const OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES: ReadonlySet<string> =
  new Set([
    "BUILD",
    "BUILD(spawning)",
    "REBUILD",
    "RESIZE",
    "VERIFY_RESIZE",
    "REVERT_RESIZE",
    "MIGRATING",
    "REBOOT",
    "HARD_REBOOT",
    "PASSWORD",
  ]);

// Volume statuses that are on the way to something else.
export const OPENSTACK_VOLUME_TRANSITIONAL_STATUSES: ReadonlySet<string> =
  new Set([
    "creating",
    "attaching",
    "detaching",
    "deleting",
    "extending",
    "downloading",
    "uploading",
    "retyping",
    "backing-up",
    "restoring-backup",
    "maintenance",
    "reserved",
    "awaiting-transfer",
  ]);

// Volume statuses that say something went wrong.
export const OPENSTACK_VOLUME_ERROR_STATUSES: ReadonlySet<string> = new Set([
  "error",
  "error_deleting",
  "error_backing-up",
  "error_restoring",
  "error_extending",
  "error_managing",
]);

/*
 * Image statuses that are on the way to something else. pending_delete is left out:
 * Glance holds an image there on purpose when delayed delete is on, so its length
 * says nothing about whether anything is wrong.
 */
export const OPENSTACK_IMAGE_TRANSITIONAL_STATUSES: ReadonlySet<string> =
  new Set(["queued", "saving", "uploading", "importing"]);

/*
 * Ironic's provision states, as openstack_ironic_node's provision_state holds them
 * (ironic.common.states). A node in one of these failed at what it was doing, and stays there
 * until someone acts: Ironic retries none of them by itself, and does not always put such a node
 * in maintenance (recorded: services-ironic/clean-failed reads maintenance=false).
 */
export const OPENSTACK_BARE_METAL_ERROR_STATES: ReadonlySet<string> = new Set([
  "deploy failed",
  "clean failed",
  "inspect failed",
  "adopt failed",
  "rescue failed",
  "unrescue failed",
  "service failed",
  // What taking a deployed node back failed at. Ironic has no word with "failed" in it for this.
  "error",
]);

/*
 * On the way to something else. Left out on purpose: `deploy hold`, `clean hold` and `service
 * hold`, where a step someone wrote asked Ironic to wait, for as long as they like.
 */
export const OPENSTACK_BARE_METAL_TRANSITIONAL_STATES: ReadonlySet<string> =
  new Set([
    "verifying",
    "inspecting",
    "inspect wait",
    "cleaning",
    "clean wait",
    "deploying",
    "wait call-back",
    "deleting",
    "adopting",
    "rescuing",
    "rescue wait",
    "unrescuing",
    "servicing",
    "service wait",
  ]);

// What a node's adminState says: Ironic's `maintenance`, as this column holds such things.
export const OPENSTACK_BARE_METAL_IN_MAINTENANCE: string = "maintenance";
export const OPENSTACK_BARE_METAL_IN_SERVICE: string = "in service";

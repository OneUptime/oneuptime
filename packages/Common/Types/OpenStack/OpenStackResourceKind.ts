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
  Network = "Network",
  Subnet = "Subnet",
  Router = "Router",
  FloatingIp = "FloatingIp",
  Project = "Project",
  Domain = "Domain",
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
}

// The word people use for each service, in lists and alert text.
export const OPENSTACK_SERVICE_TITLES: Record<OpenStackServiceType, string> = {
  [OpenStackServiceType.Identity]: "Identity (Keystone)",
  [OpenStackServiceType.Compute]: "Compute (Nova)",
  [OpenStackServiceType.Placement]: "Placement",
  [OpenStackServiceType.Network]: "Networking (Neutron)",
  [OpenStackServiceType.Volume]: "Block Storage (Cinder)",
  [OpenStackServiceType.Image]: "Images (Glance)",
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
  [OpenStackServiceType.Placement]: [],
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
  ],
  [OpenStackServiceType.Image]: [OpenStackResourceKind.Image],
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
}

/*
 * Words for a row's status. These are OpenStack's own, as `status` holds them;
 * the sets say which ones the health rules and the stuck-state rule treat alike.
 */

// A worker's status: `openstack compute service list` and friends.
export const OPENSTACK_SERVICE_STATUS_UP: string = "up";
export const OPENSTACK_SERVICE_STATUS_DOWN: string = "down";

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

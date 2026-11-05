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
  // What a cloud that runs Heat has been asked to build: see OpenStackOptionalServices.
  Stack = "Stack",
  /*
   * A Kubernetes cluster Magnum built. "Cluster" alone would read as OneUptime's own
   * KubernetesCluster, which this can be linked to and is not.
   */
  ContainerCluster = "ContainerCluster",
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
  /*
   * Services a cloud may not run. Each has an entry in OPENSTACK_OPTIONAL_SERVICES, and
   * nothing of one appears anywhere until the exporter says something about it.
   */
  Orchestration = "orchestration",
  ContainerInfra = "container-infra",
}

// The word people use for each service, in lists and alert text.
export const OPENSTACK_SERVICE_TITLES: Record<OpenStackServiceType, string> = {
  [OpenStackServiceType.Identity]: "Identity (Keystone)",
  [OpenStackServiceType.Compute]: "Compute (Nova)",
  [OpenStackServiceType.Placement]: "Placement",
  [OpenStackServiceType.Network]: "Networking (Neutron)",
  [OpenStackServiceType.Volume]: "Block Storage (Cinder)",
  [OpenStackServiceType.Image]: "Images (Glance)",
  [OpenStackServiceType.Orchestration]: "Orchestration (Heat)",
  [OpenStackServiceType.ContainerInfra]: "Kubernetes Clusters (Magnum)",
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
    OpenStackResourceKind.Backup,
  ],
  [OpenStackServiceType.Image]: [OpenStackResourceKind.Image],
  [OpenStackServiceType.Orchestration]: [OpenStackResourceKind.Stack],
  [OpenStackServiceType.ContainerInfra]: [
    OpenStackResourceKind.ContainerCluster,
  ],
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
  /*
   * Heat's engines and Magnum's conductors. Only a native read of their APIs lists these: the
   * exporter has no series for them, so only a probe's cloud has these rows.
   */
  Orchestration = "orchestration",
  ContainerInfra = "container-infra",
}

/*
 * Which family's workers each service's API answers for: the rows it vouches for beside its
 * kinds, and what a page groups under it.
 */
export const OPENSTACK_WORKER_FAMILY_BY_SERVICE: Partial<
  Record<OpenStackServiceType, OpenStackServiceFamily>
> = {
  [OpenStackServiceType.Compute]: OpenStackServiceFamily.Compute,
  [OpenStackServiceType.Network]: OpenStackServiceFamily.Network,
  [OpenStackServiceType.Volume]: OpenStackServiceFamily.Volume,
  [OpenStackServiceType.Orchestration]: OpenStackServiceFamily.Orchestration,
  [OpenStackServiceType.ContainerInfra]: OpenStackServiceFamily.ContainerInfra,
};

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
 * Heat and Magnum say what they are doing and how it went in one word, ACTION_STATE, and the
 * exporter's status lists are where a word comes from. Heat's are knownStackStatuses, the
 * same thirty openstack_heat_stack_status_counter reports on a real cloud. Magnum has fewer
 * (knownClusterStatuses): nothing there fails or waits to resume, for one.
 */
const OPENSTACK_STACK_ACTIONS: ReadonlyArray<string> = [
  "INIT",
  "CREATE",
  "DELETE",
  "UPDATE",
  "ROLLBACK",
  "SUSPEND",
  "RESUME",
  "ADOPT",
  "SNAPSHOT",
  "CHECK",
];

export const OPENSTACK_STACK_FAILED_STATUSES: ReadonlySet<string> = new Set(
  OPENSTACK_STACK_ACTIONS.map((action: string): string => {
    return `${action}_FAILED`;
  }),
);

export const OPENSTACK_STACK_IN_PROGRESS_STATUSES: ReadonlySet<string> =
  new Set(
    OPENSTACK_STACK_ACTIONS.map((action: string): string => {
      return `${action}_IN_PROGRESS`;
    }),
  );

export const OPENSTACK_CONTAINER_CLUSTER_FAILED_STATUSES: ReadonlySet<string> =
  new Set([
    "CREATE_FAILED",
    "UPDATE_FAILED",
    "DELETE_FAILED",
    "RESUME_FAILED",
    "ROLLBACK_FAILED",
  ]);

export const OPENSTACK_CONTAINER_CLUSTER_IN_PROGRESS_STATUSES: ReadonlySet<string> =
  new Set([
    "CREATE_IN_PROGRESS",
    "UPDATE_IN_PROGRESS",
    "DELETE_IN_PROGRESS",
    "ROLLBACK_IN_PROGRESS",
  ]);

// What Magnum says of a cluster it can reach. UNKNOWN is what it says of one it can't.
export const OPENSTACK_CONTAINER_CLUSTER_UNHEALTHY: string = "UNHEALTHY";

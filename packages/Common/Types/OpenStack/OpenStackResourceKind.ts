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
  /*
   * A shared file system Manila serves. Only Manila's own series make one (OpenStackSnapshotScan),
   * so a cloud without Manila has none.
   */
  Share = "Share",
  /*
   * A load balancer Octavia runs. Its status is its provisioning status, which is what Octavia
   * changes when someone asks for something, and its operating status is a fact: they say different
   * things, and a pool whose members are all down leaves the load balancer provisioning ACTIVE. Only
   * Octavia's own series make one (OpenStackSnapshotScan), so a cloud without Octavia has none.
   */
  LoadBalancer = "LoadBalancer",
  // A pool of members behind a load balancer, with the same two statuses.
  LoadBalancerPool = "LoadBalancerPool",
  /*
   * A virtual machine Octavia runs a load balancer in. Its status is Octavia's word for it
   * (ALLOCATED, ERROR), its role says MASTER or BACKUP, and its compute instance is a fact.
   */
  Amphora = "Amphora",
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
  // A service a cloud may not run: see OPENSTACK_SERVICES_EVERY_CLOUD_RUNS.
  BareMetal = "baremetal",
  SharedFileSystems = "sharev2",
  // Octavia's name in the catalog, and the exporter's.
  LoadBalancer = "load-balancer",
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
  [OpenStackServiceType.Orchestration]: "Orchestration (Heat)",
  [OpenStackServiceType.ContainerInfra]: "Kubernetes Clusters (Magnum)",
  [OpenStackServiceType.BareMetal]: "Bare Metal (Ironic)",
  [OpenStackServiceType.SharedFileSystems]: "Shared File Systems (Manila)",
  [OpenStackServiceType.LoadBalancer]: "Load Balancers (Octavia)",
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
  [OpenStackServiceType.Orchestration]: [OpenStackResourceKind.Stack],
  [OpenStackServiceType.ContainerInfra]: [
    OpenStackResourceKind.ContainerCluster,
  ],
  [OpenStackServiceType.BareMetal]: [OpenStackResourceKind.BareMetalNode],
  [OpenStackServiceType.SharedFileSystems]: [OpenStackResourceKind.Share],
  [OpenStackServiceType.LoadBalancer]: [
    OpenStackResourceKind.LoadBalancer,
    OpenStackResourceKind.LoadBalancerPool,
    OpenStackResourceKind.Amphora,
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
  // Only a probe says these: the exporter has no series for Ironic's conductors.
  BareMetal = "baremetal",
  // Nor for Manila's services: its API lists them, and only for an admin.
  SharedFileSystems = "sharev2",
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
  [OpenStackServiceType.BareMetal]: OpenStackServiceFamily.BareMetal,
  [OpenStackServiceType.Orchestration]: OpenStackServiceFamily.Orchestration,
  [OpenStackServiceType.ContainerInfra]: OpenStackServiceFamily.ContainerInfra,
  [OpenStackServiceType.SharedFileSystems]:
    OpenStackServiceFamily.SharedFileSystems,
};

/*
 * Words for a row's status. These are OpenStack's own, as `status` holds them;
 * the sets say which ones the health rules and the stuck-state rule treat alike.
 */

// A worker's status: `openstack compute service list` and friends.
export const OPENSTACK_SERVICE_STATUS_UP: string = "up";
export const OPENSTACK_SERVICE_STATUS_DOWN: string = "down";
/*
 * Manila's word for a service that was shut down cleanly, recorded: manila-share reads `stopped` at
 * once, and `down` only when one died and its heartbeat has grown old (services-manila). Whatever
 * stopped it meant to, so it reads apart from one that died.
 */
export const OPENSTACK_SERVICE_STATUS_STOPPED: string = "stopped";
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

/*
 * Manila's share statuses (manila.common.constants). The exporter's status counter knows nineteen of
 * these, recorded, and its series carry whatever word Manila says.
 */
export const OPENSTACK_SHARE_ERROR_STATUSES: ReadonlySet<string> = new Set([
  "error",
  "error_deleting",
  "extending_error",
  "shrinking_error",
  "shrinking_possible_data_loss_error",
  "manage_error",
  "unmanage_error",
  "migration_error",
  "reverting_error",
  "backup_restoring_error",
]);

/*
 * On the way to something else. Left out on purpose: `migrating`, `migrating_to` and a backup's two
 * words, which last as long as a share's data takes to copy, because someone asked for that.
 */
export const OPENSTACK_SHARE_TRANSITIONAL_STATUSES: ReadonlySet<string> =
  new Set([
    "creating",
    "creating_from_snapshot",
    "deleting",
    "deferred_deleting",
    "soft_deleting",
    "extending",
    "shrinking",
    "managing",
    "manage_starting",
    "unmanaging",
    "unmanage_starting",
    "reverting",
    "reverting_to_snapshot",
    "restoring",
    "updating",
    "replication_change",
    "ensuring",
  ]);

/*
 * Octavia's statuses (octavia.common.constants). A load balancer, a listener, a pool and a member each
 * have two: the provisioning status, which is Octavia's work on the object, and the operating status,
 * which is what its health checks say. They are different questions, recorded apart: a pool whose
 * members every one fail their health monitor is ACTIVE in provisioning and ERROR in operating.
 */
export const OPENSTACK_LOAD_BALANCER_ERROR_STATUSES: ReadonlySet<string> =
  new Set(["ERROR"]);

// Octavia gives these no timeout of its own once its worker has the request, recorded on a stopped one.
export const OPENSTACK_LOAD_BALANCER_TRANSITIONAL_STATUSES: ReadonlySet<string> =
  new Set(["PENDING_CREATE", "PENDING_UPDATE", "PENDING_DELETE"]);

// What an operating status says when nothing at all is healthy behind it.
export const OPENSTACK_LOAD_BALANCER_OPERATING_ERROR: string = "ERROR";
export const OPENSTACK_LOAD_BALANCER_OPERATING_DEGRADED: string = "DEGRADED";

// An amphora's status: ALLOCATED to a load balancer, READY in the spare pool, BOOTING on the way.
export const OPENSTACK_AMPHORA_ERROR_STATUSES: ReadonlySet<string> = new Set([
  "ERROR",
]);
export const OPENSTACK_AMPHORA_ROLE_MASTER: string = "MASTER";
export const OPENSTACK_AMPHORA_ROLE_BACKUP: string = "BACKUP";
// A load balancer on one amphora has this role, and no pair to split.
export const OPENSTACK_AMPHORA_ROLE_STANDALONE: string = "STANDALONE";

import { XcpNgScope } from "./XcpNgTelemetry";

/*
 * ------------------------------------------------------------------
 * XAPI's messages, as OneUptime reads them (#10997)
 * ------------------------------------------------------------------
 *
 * XAPI tells a pool's operators what happened through messages: a VM that
 * crashed, a host HA lost, a storage repository that failed to plug, a
 * threshold perfmon watches (an ALARM). Each has a name, a priority and the
 * object it is about. Xen Orchestra relays them (/rest/v0/messages and
 * /rest/v0/alarms) and so does XAPI itself (message.get_since); a pool read
 * either way lands here.
 *
 * Priority, as XAPI defines it (ocaml/xapi-consts/api_messages.ml):
 *
 *   1 Critical       take action now or data may be lost
 *   2 Major          take action now or a service may fail (a VM crash)
 *   3 Warning        take action now or a service may suffer
 *   4 Minor          something improved, or changed (the pool master moved)
 *   5 Informational  day to day (a VM started, migrated, was snapshotted)
 *
 * What OneUptime does with each: priority 1 to 3 alert, through the alert
 * templates of XcpNgEventAlertTemplates, each turned on or off on its own;
 * priority 1 to 4 land on the pool's feed; and every message, whatever its
 * priority, is kept in the pool's Logs. Priority 5 stays out of the feed:
 * every backup run snapshots its VMs, and a feed of VM_SNAPSHOTTED lines
 * would bury what someone has to read.
 *
 * Xen Orchestra's REST objects carry no priority (only XAPI's own records
 * do), so a message read through Xen Orchestra takes the priority of its
 * name below; one read from XAPI keeps the priority XAPI gave it. A name
 * this table does not know (a plugin's own) reads as priority 4: on the
 * feed, never an alert, since nothing says it is serious.
 *
 * A perfmon ALARM carries its own priority, set per variable on the object
 * (alarm_priority, 3 unless someone set another: python3/bin/perfmon), not
 * the 1 api_messages.ml lists for the name - so through Xen Orchestra an
 * ALARM is priority 3.
 *
 * Message names and the kinds below are stored in customers' logs and
 * monitors: never rename one.
 * ------------------------------------------------------------------
 */

export const XCP_NG_MOST_SEVERE_PRIORITY: number = 1;
export const XCP_NG_LEAST_SEVERE_PRIORITY: number = 5;

// Priority 1 to 3 alert.
export const XCP_NG_ALERTING_PRIORITY_MAX: number = 3;

// Priority 1 to 4 land on the pool's feed.
export const XCP_NG_FEED_PRIORITY_MAX: number = 4;

// What a name this table does not know is read as: the feed, no alert.
export const XCP_NG_UNKNOWN_MESSAGE_PRIORITY: number = 4;

// perfmon's default alarm_priority.
export const XCP_NG_PERFMON_ALARM_PRIORITY: number = 3;

/*
 * Which alert template a message is for, stamped on its log record
 * (xcp_ng.message.alert). The named templates take the messages they are
 * named after; "other_alarm" takes every other message of priority 1 to 3,
 * so turning every template on alerts once on each alerting message and
 * never twice; "none" is a message no template alerts on.
 */
export enum XcpNgMessageAlert {
  VmCrashed = "vm_crashed",
  HaHostFailed = "ha_host_failed",
  HaStatefileLost = "ha_statefile_lost",
  HaProtectedVmRestartFailed = "ha_protected_vm_restart_failed",
  PbdPlugFailed = "pbd_plug_failed",
  StorageGcNoSpace = "sr_gc_no_space",
  PoolMasterChanged = "pool_master_changed",
  OtherAlarm = "other_alarm",
  None = "none",
}

/*
 * What a message is about, as OneUptime names it: an XCP-ng scope where it
 * is one of the pool's objects OneUptime pages, "other" for a class XAPI has
 * that OneUptime does not page (a snapshot schedule, a PVS proxy, a
 * certificate), "unknown" when nothing says.
 */
export type XcpNgMessageObjectType =
  | XcpNgScope.Pool
  | XcpNgScope.Host
  | XcpNgScope.VM
  | XcpNgScope.StorageRepository
  | XcpNgScope.VDI
  | "other"
  | "unknown";

export interface XcpNgMessageDefinition {
  priority: number;
  // The object XAPI raises it on (its `cls`).
  objectType: XcpNgMessageObjectType;
  // A few words, in English: the feed's line and the log record's lead.
  title: string;
  alert: XcpNgMessageAlert;
}

interface CatalogEntry {
  priority: number;
  objectType: XcpNgMessageObjectType;
  title: string;
  alert?: XcpNgMessageAlert | undefined;
}

const VM: XcpNgMessageObjectType = XcpNgScope.VM;
const HOST: XcpNgMessageObjectType = XcpNgScope.Host;
const POOL: XcpNgMessageObjectType = XcpNgScope.Pool;
const SR: XcpNgMessageObjectType = XcpNgScope.StorageRepository;
const VDI: XcpNgMessageObjectType = XcpNgScope.VDI;
const OTHER: XcpNgMessageObjectType = "other";

/*
 * Every message api_messages.ml defines (xen-api master, read on 26
 * November 2026), with its priority and the class it is raised on.
 */
const CATALOG: Readonly<Record<string, CatalogEntry>> = {
  // --- High availability ---
  HA_STATEFILE_LOST: {
    priority: 2,
    objectType: HOST,
    title: "HA lost its state file",
    alert: XcpNgMessageAlert.HaStatefileLost,
  },
  HA_HEARTBEAT_APPROACHING_TIMEOUT: {
    priority: 5,
    objectType: HOST,
    title: "HA heartbeat is close to timing out",
  },
  HA_STATEFILE_APPROACHING_TIMEOUT: {
    priority: 5,
    objectType: HOST,
    title: "HA state file is close to timing out",
  },
  HA_XAPI_HEALTHCHECK_APPROACHING_TIMEOUT: {
    priority: 5,
    objectType: HOST,
    title: "HA's XAPI health check is close to timing out",
  },
  HA_NETWORK_BONDING_ERROR: {
    priority: 3,
    objectType: HOST,
    title: "HA network bond error",
  },
  HA_POOL_OVERCOMMITTED: {
    priority: 3,
    objectType: POOL,
    title: "HA is overcommitted",
  },
  HA_POOL_DROP_IN_PLAN_EXISTS_FOR: {
    priority: 3,
    objectType: POOL,
    title: "HA can tolerate fewer host failures",
  },
  HA_PROTECTED_VM_RESTART_FAILED: {
    priority: 2,
    objectType: VM,
    title: "HA could not restart a protected VM",
    alert: XcpNgMessageAlert.HaProtectedVmRestartFailed,
  },
  HA_HOST_FAILED: {
    priority: 3,
    objectType: HOST,
    title: "HA lost a host",
    alert: XcpNgMessageAlert.HaHostFailed,
  },
  HA_HOST_WAS_FENCED: {
    priority: 4,
    objectType: HOST,
    title: "HA fenced a host",
  },

  // --- Pool metadata, networking, QoS ---
  METADATA_LUN_HEALTHY: {
    priority: 4,
    objectType: POOL,
    title: "The metadata LUN is healthy again",
  },
  METADATA_LUN_BROKEN: {
    priority: 3,
    objectType: POOL,
    title: "The metadata LUN is broken",
  },
  IP_CONFIGURED_PIF_CAN_UNPLUG: {
    priority: 3,
    objectType: HOST,
    title: "A network interface with an IP address can be unplugged",
  },
  VIF_QOS_FAILED: {
    priority: 3,
    objectType: VM,
    title: "A VM's network QoS could not be applied",
  },
  VBD_QOS_FAILED: {
    priority: 3,
    objectType: VM,
    title: "A VM's disk QoS could not be applied",
  },
  VCPU_QOS_FAILED: {
    priority: 3,
    objectType: VM,
    title: "A VM's CPU QoS could not be applied",
  },
  BOND_STATUS_CHANGED: {
    priority: 3,
    objectType: HOST,
    title: "A network bond changed status",
  },
  MULTIPATH_PERIODIC_ALERT: {
    priority: 3,
    objectType: HOST,
    title: "Storage paths are down",
  },

  // --- VM lifecycle ---
  VM_STARTED: { priority: 5, objectType: VM, title: "VM started" },
  VM_SHUTDOWN: { priority: 5, objectType: VM, title: "VM shut down" },
  VM_REBOOTED: { priority: 5, objectType: VM, title: "VM rebooted" },
  VM_MIGRATED: { priority: 5, objectType: VM, title: "VM migrated" },
  VM_SNAPSHOTTED: { priority: 5, objectType: VM, title: "VM snapshotted" },
  VM_SNAPSHOT_REVERTED: {
    priority: 5,
    objectType: VM,
    title: "VM reverted to a snapshot",
  },
  VM_CHECKPOINTED: { priority: 5, objectType: VM, title: "VM checkpointed" },
  VM_SUSPENDED: { priority: 5, objectType: VM, title: "VM suspended" },
  VM_RESUMED: { priority: 5, objectType: VM, title: "VM resumed" },
  VM_PAUSED: { priority: 5, objectType: VM, title: "VM paused" },
  VM_UNPAUSED: { priority: 5, objectType: VM, title: "VM unpaused" },
  VM_CLONED: { priority: 5, objectType: VM, title: "VM cloned" },
  VM_SECURE_BOOT_FAILED: {
    priority: 5,
    objectType: VM,
    title: "VM failed Secure Boot",
  },
  VM_CRASHED: {
    priority: 2,
    objectType: VM,
    title: "VM crashed",
    alert: XcpNgMessageAlert.VmCrashed,
  },

  // --- Hosts ---
  HOST_SYNC_DATA_FAILED: {
    priority: 3,
    objectType: HOST,
    title: "A host could not sync its data",
  },
  HOST_CLOCK_SKEW_DETECTED: {
    priority: 3,
    objectType: HOST,
    title: "A host's clock is out of step with the pool master",
  },
  HOST_CLOCK_WENT_BACKWARDS: {
    priority: 1,
    objectType: HOST,
    title: "A host's clock went backwards",
  },
  POOL_MASTER_TRANSITION: {
    priority: 4,
    objectType: HOST,
    title: "The pool master changed",
    alert: XcpNgMessageAlert.PoolMasterChanged,
  },
  HOST_CPU_FEATURES_DOWN: {
    priority: 3,
    objectType: HOST,
    title: "A host lost CPU features",
  },
  HOST_CPU_FEATURES_UP: {
    priority: 5,
    objectType: HOST,
    title: "A host gained CPU features",
  },
  POOL_CPU_FEATURES_DOWN: {
    priority: 5,
    objectType: POOL,
    title: "The pool's CPU features dropped",
  },
  POOL_CPU_FEATURES_UP: {
    priority: 5,
    objectType: POOL,
    title: "The pool's CPU features rose",
  },
  XAPI_STARTUP_BLOCKED_AS_VERSION_HIGHER_THAN_COORDINATOR: {
    priority: 2,
    objectType: HOST,
    title: "XAPI did not start: the host is newer than the pool master",
  },
  FAILED_LOGIN_ATTEMPTS: {
    priority: 3,
    objectType: HOST,
    title: "Failed sign-in attempts to XAPI",
  },
  TLS_VERIFICATION_EMERGENCY_DISABLED: {
    priority: 3,
    objectType: HOST,
    title: "TLS verification was switched off in an emergency",
  },
  PERIODIC_UPDATE_SYNC_FAILED: {
    priority: 3,
    objectType: POOL,
    title: "The update sync failed",
  },

  // --- Storage ---
  PBD_PLUG_FAILED_ON_SERVER_START: {
    priority: 3,
    objectType: HOST,
    title: "Storage failed to plug when a host started",
    alert: XcpNgMessageAlert.PbdPlugFailed,
  },
  SM_GC_NO_SPACE: {
    priority: 3,
    objectType: SR,
    title: "Storage garbage collection has no space",
    alert: XcpNgMessageAlert.StorageGcNoSpace,
  },
  VDI_CBT_METADATA_INCONSISTENT: {
    priority: 3,
    objectType: VDI,
    title: "A disk's change tracking metadata is inconsistent",
  },
  VDI_CBT_SNAPSHOT_FAILED: {
    priority: 3,
    objectType: VDI,
    title: "A disk's change tracking snapshot failed",
  },
  VDI_CBT_RESIZE_FAILED: {
    priority: 3,
    objectType: VDI,
    title: "A disk's change tracking resize failed",
  },

  // --- The threshold alarms perfmon raises ---
  ALARM: {
    priority: XCP_NG_PERFMON_ALARM_PRIORITY,
    objectType: "unknown",
    title: "Threshold alarm",
  },

  // --- Workload balancing ---
  WLB_CONSULTATION_FAILED: {
    priority: 3,
    objectType: POOL,
    title: "Workload balancing could not be consulted",
  },
  WLB_OPTIMIZATION_ALERT: {
    priority: 3,
    objectType: POOL,
    title: "Workload balancing has a recommendation",
  },

  // --- External authentication ---
  EXTAUTH_INIT_IN_HOST_FAILED: {
    priority: 2,
    objectType: HOST,
    title: "External authentication did not start on a host",
  },
  EXTAUTH_IN_POOL_IS_NON_HOMOGENEOUS: {
    priority: 2,
    objectType: POOL,
    title: "External authentication differs across the pool",
  },

  // --- Licences ---
  LICENSE_DOES_NOT_SUPPORT_POOLING: {
    priority: 2,
    objectType: HOST,
    title: "The licence does not support pooling",
  },
  LICENSE_EXPIRES_SOON: {
    priority: 2,
    objectType: HOST,
    title: "The licence expires soon",
  },
  LICENSE_EXPIRED: {
    priority: 2,
    objectType: HOST,
    title: "The licence expired",
  },
  LICENSE_SERVER_CONNECTED: {
    priority: 4,
    objectType: HOST,
    title: "The licence server is reachable again",
  },
  LICENSE_SERVER_UNAVAILABLE: {
    priority: 3,
    objectType: HOST,
    title: "The licence server is unavailable",
  },
  GRACE_LICENSE: {
    priority: 3,
    objectType: HOST,
    title: "The host runs on a grace licence",
  },
  LICENSE_NOT_AVAILABLE: {
    priority: 2,
    objectType: HOST,
    title: "No licence is available",
  },
  LICENSE_SERVER_UNREACHABLE: {
    priority: 2,
    objectType: HOST,
    title: "The licence server is unreachable",
  },
  LICENSE_SERVER_VERSION_OBSOLETE: {
    priority: 2,
    objectType: HOST,
    title: "The licence server's version is obsolete",
  },

  // --- PVS proxy ---
  PVS_PROXY_NO_CACHE_SR_AVAILABLE: {
    priority: 3,
    objectType: OTHER,
    title: "A PVS proxy has no cache storage",
  },
  PVS_PROXY_SETUP_FAILED: {
    priority: 3,
    objectType: OTHER,
    title: "A PVS proxy could not be set up",
  },
  PVS_PROXY_NO_SERVER_AVAILABLE: {
    priority: 3,
    objectType: OTHER,
    title: "A PVS proxy has no server",
  },
  PVS_PROXY_SR_OUT_OF_SPACE: {
    priority: 3,
    objectType: OTHER,
    title: "A PVS proxy's storage is out of space",
  },

  // --- Snapshot schedules (VMSS) and their predecessor (VMPP) ---
  VMPP_SNAPSHOT_LOCK_FAILED: {
    priority: 3,
    objectType: OTHER,
    title: "A protection policy could not take its snapshot lock",
  },
  VMPP_SNAPSHOT_SUCCEEDED: {
    priority: 5,
    objectType: OTHER,
    title: "A protection policy took its snapshots",
  },
  VMPP_SNAPSHOT_FAILED: {
    priority: 3,
    objectType: OTHER,
    title: "A protection policy's snapshot failed",
  },
  VMPP_ARCHIVE_LOCK_FAILED: {
    priority: 3,
    objectType: OTHER,
    title: "A protection policy could not take its archive lock",
  },
  VMPP_ARCHIVE_FAILED_0: {
    priority: 3,
    objectType: OTHER,
    title: "A protection policy's archive failed",
  },
  VMPP_ARCHIVE_SUCCEEDED: {
    priority: 5,
    objectType: OTHER,
    title: "A protection policy archived its snapshots",
  },
  VMPP_ARCHIVE_TARGET_MOUNT_FAILED: {
    priority: 3,
    objectType: OTHER,
    title: "A protection policy could not mount its archive target",
  },
  VMPP_ARCHIVE_TARGET_UNMOUNT_FAILED: {
    priority: 3,
    objectType: OTHER,
    title: "A protection policy could not unmount its archive target",
  },
  VMPP_LICENSE_ERROR: {
    priority: 3,
    objectType: OTHER,
    title: "A protection policy's licence does not allow it",
  },
  VMPP_XAPI_LOGON_FAILURE: {
    priority: 3,
    objectType: OTHER,
    title: "A protection policy could not sign in to XAPI",
  },
  VMPP_SNAPSHOT_MISSED_EVENT: {
    priority: 3,
    objectType: OTHER,
    title: "A protection policy missed a snapshot",
  },
  VMPP_ARCHIVE_MISSED_EVENT: {
    priority: 3,
    objectType: OTHER,
    title: "A protection policy missed an archive",
  },
  VMPP_SNAPSHOT_ARCHIVE_ALREADY_EXISTS: {
    priority: 3,
    objectType: OTHER,
    title: "A protection policy's archive already exists",
  },
  VMSS_SNAPSHOT_LOCK_FAILED: {
    priority: 3,
    objectType: OTHER,
    title: "A snapshot schedule could not take its lock",
  },
  VMSS_SNAPSHOT_SUCCEEDED: {
    priority: 5,
    objectType: OTHER,
    title: "A snapshot schedule took its snapshots",
  },
  VMSS_SNAPSHOT_FAILED: {
    priority: 3,
    objectType: OTHER,
    title: "A snapshot schedule's snapshot failed",
  },
  VMSS_LICENSE_ERROR: {
    priority: 3,
    objectType: OTHER,
    title: "A snapshot schedule's licence does not allow it",
  },
  VMSS_XAPI_LOGON_FAILURE: {
    priority: 3,
    objectType: OTHER,
    title: "A snapshot schedule could not sign in to XAPI",
  },
  VMSS_SNAPSHOT_MISSED_EVENT: {
    priority: 3,
    objectType: OTHER,
    title: "A snapshot schedule missed a snapshot",
  },

  // --- Clustering (XOSTOR, GFS2) ---
  CLUSTER_QUORUM_APPROACHING_LOST: {
    priority: 2,
    objectType: POOL,
    title: "The cluster is close to losing quorum",
  },
  CLUSTER_HOST_ENABLE_FAILED: {
    priority: 3,
    objectType: HOST,
    title: "A host could not join the cluster",
  },
  CLUSTER_HOST_FENCING: {
    priority: 2,
    objectType: HOST,
    title: "The cluster is fencing a host",
  },
  CLUSTER_HOST_LEAVING: {
    priority: 3,
    objectType: HOST,
    title: "A host is leaving the cluster",
  },
  CLUSTER_HOST_JOINING: {
    priority: 4,
    objectType: HOST,
    title: "A host is joining the cluster",
  },

  // --- Certificates ---
  HOST_SERVER_CERTIFICATE_EXPIRED: {
    priority: 1,
    objectType: HOST,
    title: "A host's TLS certificate expired",
  },
  HOST_INTERNAL_CERTIFICATE_EXPIRED: {
    priority: 1,
    objectType: HOST,
    title: "A host's internal certificate expired",
  },
  POOL_CA_CERTIFICATE_EXPIRED: {
    priority: 1,
    objectType: POOL,
    title: "A CA certificate of the pool expired",
  },
  POOL_PINNED_CERTIFICATE_EXPIRED: {
    priority: 1,
    objectType: POOL,
    title: "A pinned certificate of the pool expired",
  },

  // --- Anti-affinity ---
  ALL_RUNNING_VMS_IN_ANTI_AFFINITY_GRP_ON_SINGLE_HOST: {
    priority: 3,
    objectType: OTHER,
    title: "An anti-affinity group's VMs all run on one host",
  },
};

/*
 * The certificate warnings XAPI raises 30, 14 and 7 days before expiry,
 * named <base>_30, _14 and _07, more severe as the day comes.
 */
const CERTIFICATE_EXPIRING: ReadonlyArray<{
  base: string;
  objectType: XcpNgMessageObjectType;
  title: string;
}> = [
  {
    base: "HOST_SERVER_CERTIFICATE_EXPIRING",
    objectType: HOST,
    title: "A host's TLS certificate expires soon",
  },
  {
    base: "HOST_INTERNAL_CERTIFICATE_EXPIRING",
    objectType: HOST,
    title: "A host's internal certificate expires soon",
  },
  {
    base: "POOL_CA_CERTIFICATE_EXPIRING",
    objectType: POOL,
    title: "A CA certificate of the pool expires soon",
  },
  {
    base: "POOL_PINNED_CERTIFICATE_EXPIRING",
    objectType: POOL,
    title: "A pinned certificate of the pool expires soon",
  },
];

const CERTIFICATE_EXPIRING_PRIORITY: Readonly<Record<string, number>> = {
  "30": 3,
  "14": 2,
  "07": 1,
};

// HOST_KERNEL_ENCOUNTERED_ERROR_<which> (2) and _WARNING_<which> (3).
const KERNEL_ERROR_PREFIX: string = "HOST_KERNEL_ENCOUNTERED_ERROR_";
const KERNEL_WARNING_PREFIX: string = "HOST_KERNEL_ENCOUNTERED_WARNING_";

function lookUp(name: string): CatalogEntry | null {
  const known: CatalogEntry | undefined = Object.prototype.hasOwnProperty.call(
    CATALOG,
    name,
  )
    ? CATALOG[name]
    : undefined;

  if (known) {
    return known;
  }

  for (const certificate of CERTIFICATE_EXPIRING) {
    if (name.startsWith(`${certificate.base}_`)) {
      const days: string = name.substring(certificate.base.length + 1);
      const priority: number | undefined = CERTIFICATE_EXPIRING_PRIORITY[days];

      if (priority !== undefined) {
        return {
          priority: priority,
          objectType: certificate.objectType,
          title: certificate.title,
        };
      }
    }
  }

  if (name.startsWith(KERNEL_ERROR_PREFIX)) {
    return {
      priority: 2,
      objectType: HOST,
      title: "A host's kernel hit an error",
    };
  }

  if (name.startsWith(KERNEL_WARNING_PREFIX)) {
    return {
      priority: 3,
      objectType: HOST,
      title: "A host's kernel raised a warning",
    };
  }

  return null;
}

// A priority as XAPI writes one, or null: 1 to 5, whole.
export function normalizeXcpNgMessagePriority(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") {
    return null;
  }
  const priority: number =
    typeof value === "string" ? Number(value.trim()) : value;

  if (
    !Number.isInteger(priority) ||
    priority < XCP_NG_MOST_SEVERE_PRIORITY ||
    priority > XCP_NG_LEAST_SEVERE_PRIORITY
  ) {
    return null;
  }

  return priority;
}

// "VM_CRASHED" -> "Vm crashed": the words of a name this table does not know.
function describeUnknownName(name: string): string {
  const words: string = name.split("_").filter(Boolean).join(" ").toLowerCase();

  if (!words) {
    return "XAPI message";
  }

  return words.charAt(0).toUpperCase() + words.substring(1);
}

/*
 * What a message is, from its name - and its priority from XAPI's record
 * when it carries one (the XAPI path), else from its name (Xen Orchestra,
 * whose objects drop it).
 */
export function getXcpNgMessageDefinition(data: {
  name: string;
  reportedPriority?: unknown;
}): XcpNgMessageDefinition {
  const name: string = (data.name || "").trim().toUpperCase();
  const entry: CatalogEntry | null = lookUp(name);
  const reported: number | null = normalizeXcpNgMessagePriority(
    data.reportedPriority,
  );

  const priority: number =
    reported ?? entry?.priority ?? XCP_NG_UNKNOWN_MESSAGE_PRIORITY;

  return {
    priority: priority,
    objectType: entry?.objectType || "unknown",
    title: entry?.title || describeUnknownName(name),
    alert: getXcpNgMessageAlert({
      namedAlert: entry?.alert,
      priority: priority,
    }),
  };
}

/*
 * The template a message is for: its own, where one is named after it;
 * else "other_alarm" at priority 1 to 3; else none. A named template takes
 * its message at any priority XAPI gives it, so turning it on is enough.
 */
export function getXcpNgMessageAlert(data: {
  namedAlert?: XcpNgMessageAlert | undefined;
  priority: number;
}): XcpNgMessageAlert {
  if (data.namedAlert) {
    return data.namedAlert;
  }

  return isXcpNgAlertingPriority(data.priority)
    ? XcpNgMessageAlert.OtherAlarm
    : XcpNgMessageAlert.None;
}

export function isXcpNgAlertingPriority(priority: number): boolean {
  return (
    priority >= XCP_NG_MOST_SEVERE_PRIORITY &&
    priority <= XCP_NG_ALERTING_PRIORITY_MAX
  );
}

export function isXcpNgFeedPriority(priority: number): boolean {
  return (
    priority >= XCP_NG_MOST_SEVERE_PRIORITY &&
    priority <= XCP_NG_FEED_PRIORITY_MAX
  );
}

/*
 * Whether a message's alert stays open until XAPI forgets the message:
 * every message one of the templates alerts on, except Pool Master Changed,
 * which says what happened rather than what is wrong.
 */
export function isXcpNgMessageClearable(alert: XcpNgMessageAlert): boolean {
  return (
    alert !== XcpNgMessageAlert.None &&
    alert !== XcpNgMessageAlert.PoolMasterChanged
  );
}

/*
 * The OpenTelemetry severity a message's log record is stored with:
 * FATAL for priority 1, ERROR for 2, WARN for 3, INFO2 for 4 (something
 * changed), INFO for 5.
 */
export function getXcpNgMessageSeverityNumber(priority: number): number {
  switch (priority) {
    case 1:
      return 21;
    case 2:
      return 17;
    case 3:
      return 13;
    case 4:
      return 10;
    default:
      return 9;
  }
}

// The XAPI class names (a message record's `cls`) an object type is read from.
export function getXcpNgMessageObjectTypeFromClass(
  value: string | null | undefined,
): XcpNgMessageObjectType {
  switch ((value || "").trim().toLowerCase()) {
    case "vm":
      return XcpNgScope.VM;
    case "host":
      return XcpNgScope.Host;
    case "sr":
      return XcpNgScope.StorageRepository;
    case "pool":
      return XcpNgScope.Pool;
    case "vdi":
      return XcpNgScope.VDI;
    case "":
    case "unknown":
      return "unknown";
    default:
      return "other";
  }
}

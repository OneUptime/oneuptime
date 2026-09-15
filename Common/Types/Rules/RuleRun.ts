import { JSONObject } from "../JSON";
import ObjectID from "../ObjectID";

/*
 * "Run now" for the rules that fire when a resource is created.
 *
 * Label, owner and privacy rules are evaluated exactly once: in the create hook
 * of the resource they apply to. A rule written after its resources already
 * exist therefore never reaches any of them, and short of recreating those
 * resources there was no way to close the gap. A rule run applies ONE rule to
 * the resources that already exist.
 *
 * A run is split into bounded passes so that no single API request walks a
 * whole project: the server evaluates at most RULE_RUN_RESOURCES_PER_PASS
 * resources, answers with what it did plus a cursor, and the dashboard asks for
 * the next pass. These are the shapes both sides share, kept in Types so
 * neither restates the other's field names.
 */

// What running a rule does to the resources it matches.
export enum RuleRunAction {
  AddLabels = "AddLabels",
  AddOwners = "AddOwners",
  MarkPrivate = "MarkPrivate",
  /*
   * Status page monitor rules already re-evaluate themselves whenever they are
   * saved. Running one re-syncs the page, which repairs drift.
   */
  SyncStatusPageMonitors = "SyncStatusPageMonitors",
  /*
   * SLO monitor rules also re-sync their SLO whenever they are saved. An SLO's
   * monitors are the union of what ALL its enabled rules match, not one rule's
   * own additions, so running one re-syncs the whole SLO - which is why this is
   * not SyncStatusPageMonitors, whose rules each own what they added.
   */
  SyncSloMonitors = "SyncSloMonitors",
}

/*
 * Every rule that can be run. Each value is the rule model's tableName, which
 * is how the dashboard recognises a runnable rule from the table it renders.
 */
export enum RuleRunType {
  AlertLabelRule = "AlertLabelRule",
  AlertOwnerRule = "AlertOwnerRule",
  AlertPrivacyRule = "AlertPrivacyRule",
  AlertEpisodeLabelRule = "AlertEpisodeLabelRule",
  AlertEpisodeOwnerRule = "AlertEpisodeOwnerRule",
  AlertEpisodePrivacyRule = "AlertEpisodePrivacyRule",
  CephClusterLabelRule = "CephClusterLabelRule",
  CephClusterOwnerRule = "CephClusterOwnerRule",
  CloudResourceLabelRule = "CloudResourceLabelRule",
  CloudResourceOwnerRule = "CloudResourceOwnerRule",
  DashboardLabelRule = "DashboardLabelRule",
  DashboardOwnerRule = "DashboardOwnerRule",
  DockerHostLabelRule = "DockerHostLabelRule",
  DockerHostOwnerRule = "DockerHostOwnerRule",
  DockerSwarmClusterLabelRule = "DockerSwarmClusterLabelRule",
  DockerSwarmClusterOwnerRule = "DockerSwarmClusterOwnerRule",
  HostLabelRule = "HostLabelRule",
  HostOwnerRule = "HostOwnerRule",
  IncidentLabelRule = "IncidentLabelRule",
  IncidentOwnerRule = "IncidentOwnerRule",
  IncidentPrivacyRule = "IncidentPrivacyRule",
  IncidentEpisodeLabelRule = "IncidentEpisodeLabelRule",
  IncidentEpisodeOwnerRule = "IncidentEpisodeOwnerRule",
  IncidentEpisodePrivacyRule = "IncidentEpisodePrivacyRule",
  IncomingCallPolicyLabelRule = "IncomingCallPolicyLabelRule",
  IncomingCallPolicyOwnerRule = "IncomingCallPolicyOwnerRule",
  IoTFleetLabelRule = "IoTFleetLabelRule",
  IoTFleetOwnerRule = "IoTFleetOwnerRule",
  KubernetesClusterLabelRule = "KubernetesClusterLabelRule",
  KubernetesClusterOwnerRule = "KubernetesClusterOwnerRule",
  MonitorLabelRule = "MonitorLabelRule",
  MonitorOwnerRule = "MonitorOwnerRule",
  NetworkDeviceLabelRule = "NetworkDeviceLabelRule",
  NetworkDeviceOwnerRule = "NetworkDeviceOwnerRule",
  OnCallDutyPolicyLabelRule = "OnCallDutyPolicyLabelRule",
  OnCallDutyPolicyOwnerRule = "OnCallDutyPolicyOwnerRule",
  OnCallDutyPolicyScheduleLabelRule = "OnCallDutyPolicyScheduleLabelRule",
  OnCallDutyPolicyScheduleOwnerRule = "OnCallDutyPolicyScheduleOwnerRule",
  PodmanHostLabelRule = "PodmanHostLabelRule",
  PodmanHostOwnerRule = "PodmanHostOwnerRule",
  ProxmoxClusterLabelRule = "ProxmoxClusterLabelRule",
  ProxmoxClusterOwnerRule = "ProxmoxClusterOwnerRule",
  RumApplicationLabelRule = "RumApplicationLabelRule",
  RumApplicationOwnerRule = "RumApplicationOwnerRule",
  RunbookLabelRule = "RunbookLabelRule",
  RunbookOwnerRule = "RunbookOwnerRule",
  ScheduledMaintenanceLabelRule = "ScheduledMaintenanceLabelRule",
  ScheduledMaintenanceOwnerRule = "ScheduledMaintenanceOwnerRule",
  ServerlessFunctionLabelRule = "ServerlessFunctionLabelRule",
  ServerlessFunctionOwnerRule = "ServerlessFunctionOwnerRule",
  ServiceLabelRule = "ServiceLabelRule",
  ServiceLevelObjectiveMonitorRule = "ServiceLevelObjectiveMonitorRule",
  ServiceOwnerRule = "ServiceOwnerRule",
  StatusPageLabelRule = "StatusPageLabelRule",
  StatusPageOwnerRule = "StatusPageOwnerRule",
  StatusPageMonitorRule = "StatusPageMonitorRule",
  VMwareVCenterLabelRule = "VMwareVCenterLabelRule",
  VMwareVCenterOwnerRule = "VMwareVCenterOwnerRule",
  WorkflowLabelRule = "WorkflowLabelRule",
  WorkflowOwnerRule = "WorkflowOwnerRule",
}

export interface RuleRunTypeMetadata {
  action: RuleRunAction;
  // Lower-case nouns for what the rule acts on, as they read mid-sentence.
  resourceSingular: string;
  resourcePlural: string;
}

function metadata(
  action: RuleRunAction,
  resourceSingular: string,
  resourcePlural: string,
): RuleRunTypeMetadata {
  return {
    action: action,
    resourceSingular: resourceSingular,
    resourcePlural: resourcePlural,
  };
}

const Labels: RuleRunAction = RuleRunAction.AddLabels;
const Owners: RuleRunAction = RuleRunAction.AddOwners;
const Privacy: RuleRunAction = RuleRunAction.MarkPrivate;

export const RULE_RUN_TYPE_METADATA: Readonly<
  Record<RuleRunType, RuleRunTypeMetadata>
> = {
  [RuleRunType.AlertLabelRule]: metadata(Labels, "alert", "alerts"),
  [RuleRunType.AlertOwnerRule]: metadata(Owners, "alert", "alerts"),
  [RuleRunType.AlertPrivacyRule]: metadata(Privacy, "alert", "alerts"),
  [RuleRunType.AlertEpisodeLabelRule]: metadata(
    Labels,
    "alert episode",
    "alert episodes",
  ),
  [RuleRunType.AlertEpisodeOwnerRule]: metadata(
    Owners,
    "alert episode",
    "alert episodes",
  ),
  [RuleRunType.AlertEpisodePrivacyRule]: metadata(
    Privacy,
    "alert episode",
    "alert episodes",
  ),
  [RuleRunType.CephClusterLabelRule]: metadata(
    Labels,
    "Ceph cluster",
    "Ceph clusters",
  ),
  [RuleRunType.CephClusterOwnerRule]: metadata(
    Owners,
    "Ceph cluster",
    "Ceph clusters",
  ),
  [RuleRunType.CloudResourceLabelRule]: metadata(
    Labels,
    "cloud resource",
    "cloud resources",
  ),
  [RuleRunType.CloudResourceOwnerRule]: metadata(
    Owners,
    "cloud resource",
    "cloud resources",
  ),
  [RuleRunType.DashboardLabelRule]: metadata(Labels, "dashboard", "dashboards"),
  [RuleRunType.DashboardOwnerRule]: metadata(Owners, "dashboard", "dashboards"),
  [RuleRunType.DockerHostLabelRule]: metadata(
    Labels,
    "Docker host",
    "Docker hosts",
  ),
  [RuleRunType.DockerHostOwnerRule]: metadata(
    Owners,
    "Docker host",
    "Docker hosts",
  ),
  [RuleRunType.DockerSwarmClusterLabelRule]: metadata(
    Labels,
    "Docker Swarm cluster",
    "Docker Swarm clusters",
  ),
  [RuleRunType.DockerSwarmClusterOwnerRule]: metadata(
    Owners,
    "Docker Swarm cluster",
    "Docker Swarm clusters",
  ),
  [RuleRunType.HostLabelRule]: metadata(Labels, "host", "hosts"),
  [RuleRunType.HostOwnerRule]: metadata(Owners, "host", "hosts"),
  [RuleRunType.IncidentLabelRule]: metadata(Labels, "incident", "incidents"),
  [RuleRunType.IncidentOwnerRule]: metadata(Owners, "incident", "incidents"),
  [RuleRunType.IncidentPrivacyRule]: metadata(Privacy, "incident", "incidents"),
  [RuleRunType.IncidentEpisodeLabelRule]: metadata(
    Labels,
    "incident episode",
    "incident episodes",
  ),
  [RuleRunType.IncidentEpisodeOwnerRule]: metadata(
    Owners,
    "incident episode",
    "incident episodes",
  ),
  [RuleRunType.IncidentEpisodePrivacyRule]: metadata(
    Privacy,
    "incident episode",
    "incident episodes",
  ),
  [RuleRunType.IncomingCallPolicyLabelRule]: metadata(
    Labels,
    "incoming call policy",
    "incoming call policies",
  ),
  [RuleRunType.IncomingCallPolicyOwnerRule]: metadata(
    Owners,
    "incoming call policy",
    "incoming call policies",
  ),
  [RuleRunType.IoTFleetLabelRule]: metadata(Labels, "IoT fleet", "IoT fleets"),
  [RuleRunType.IoTFleetOwnerRule]: metadata(Owners, "IoT fleet", "IoT fleets"),
  [RuleRunType.KubernetesClusterLabelRule]: metadata(
    Labels,
    "Kubernetes cluster",
    "Kubernetes clusters",
  ),
  [RuleRunType.KubernetesClusterOwnerRule]: metadata(
    Owners,
    "Kubernetes cluster",
    "Kubernetes clusters",
  ),
  [RuleRunType.MonitorLabelRule]: metadata(Labels, "monitor", "monitors"),
  [RuleRunType.MonitorOwnerRule]: metadata(Owners, "monitor", "monitors"),
  [RuleRunType.NetworkDeviceLabelRule]: metadata(
    Labels,
    "network device",
    "network devices",
  ),
  [RuleRunType.NetworkDeviceOwnerRule]: metadata(
    Owners,
    "network device",
    "network devices",
  ),
  [RuleRunType.OnCallDutyPolicyLabelRule]: metadata(
    Labels,
    "on-call policy",
    "on-call policies",
  ),
  [RuleRunType.OnCallDutyPolicyOwnerRule]: metadata(
    Owners,
    "on-call policy",
    "on-call policies",
  ),
  [RuleRunType.OnCallDutyPolicyScheduleLabelRule]: metadata(
    Labels,
    "on-call schedule",
    "on-call schedules",
  ),
  [RuleRunType.OnCallDutyPolicyScheduleOwnerRule]: metadata(
    Owners,
    "on-call schedule",
    "on-call schedules",
  ),
  [RuleRunType.PodmanHostLabelRule]: metadata(
    Labels,
    "Podman host",
    "Podman hosts",
  ),
  [RuleRunType.PodmanHostOwnerRule]: metadata(
    Owners,
    "Podman host",
    "Podman hosts",
  ),
  [RuleRunType.ProxmoxClusterLabelRule]: metadata(
    Labels,
    "Proxmox cluster",
    "Proxmox clusters",
  ),
  [RuleRunType.ProxmoxClusterOwnerRule]: metadata(
    Owners,
    "Proxmox cluster",
    "Proxmox clusters",
  ),
  [RuleRunType.RumApplicationLabelRule]: metadata(
    Labels,
    "RUM application",
    "RUM applications",
  ),
  [RuleRunType.RumApplicationOwnerRule]: metadata(
    Owners,
    "RUM application",
    "RUM applications",
  ),
  [RuleRunType.RunbookLabelRule]: metadata(Labels, "runbook", "runbooks"),
  [RuleRunType.RunbookOwnerRule]: metadata(Owners, "runbook", "runbooks"),
  [RuleRunType.ScheduledMaintenanceLabelRule]: metadata(
    Labels,
    "scheduled maintenance event",
    "scheduled maintenance events",
  ),
  [RuleRunType.ScheduledMaintenanceOwnerRule]: metadata(
    Owners,
    "scheduled maintenance event",
    "scheduled maintenance events",
  ),
  [RuleRunType.ServerlessFunctionLabelRule]: metadata(
    Labels,
    "serverless function",
    "serverless functions",
  ),
  [RuleRunType.ServerlessFunctionOwnerRule]: metadata(
    Owners,
    "serverless function",
    "serverless functions",
  ),
  [RuleRunType.ServiceLabelRule]: metadata(Labels, "service", "services"),
  [RuleRunType.ServiceLevelObjectiveMonitorRule]: metadata(
    RuleRunAction.SyncSloMonitors,
    "monitor",
    "monitors",
  ),
  [RuleRunType.ServiceOwnerRule]: metadata(Owners, "service", "services"),
  [RuleRunType.StatusPageLabelRule]: metadata(
    Labels,
    "status page",
    "status pages",
  ),
  [RuleRunType.StatusPageOwnerRule]: metadata(
    Owners,
    "status page",
    "status pages",
  ),
  [RuleRunType.StatusPageMonitorRule]: metadata(
    RuleRunAction.SyncStatusPageMonitors,
    "monitor",
    "monitors",
  ),
  [RuleRunType.VMwareVCenterLabelRule]: metadata(
    Labels,
    "VMware vCenter",
    "VMware vCenters",
  ),
  [RuleRunType.VMwareVCenterOwnerRule]: metadata(
    Owners,
    "VMware vCenter",
    "VMware vCenters",
  ),
  [RuleRunType.WorkflowLabelRule]: metadata(Labels, "workflow", "workflows"),
  [RuleRunType.WorkflowOwnerRule]: metadata(Owners, "workflow", "workflows"),
};

/*
 * How many resources one pass evaluates. Small enough that a pass over
 * incidents - which reads each incident's monitors to match - stays a short
 * request; the dashboard chains passes, so this bounds each request, not the
 * run.
 */
export const RULE_RUN_RESOURCES_PER_PASS: number = 200;

/*
 * How many passes one press of "Run Rule" chains before it stops and says so.
 * 500 passes covers 100,000 resources, which is past any ordinary project,
 * while still guaranteeing one press cannot turn into an unbounded loop.
 */
export const MAX_RULE_RUN_PASSES: number = 500;

// Counters every pass reports, and a whole run sums.
export interface RuleRunCounts {
  // Resources the run evaluated.
  resourcesEvaluated: number;
  // Of those, the ones this rule matched.
  resourcesMatched: number;
  /*
   * Matched resources this run actually changed. Lower than resourcesMatched
   * whenever a resource already had what the rule adds - running a rule again
   * is idempotent, not additive.
   */
  resourcesUpdated: number;
  // Labels attached, owners added, resources made private, or monitors added.
  itemsAdded: number;
  /*
   * Status page and SLO monitor rules only: monitors the rules no longer
   * claim.
   */
  itemsRemoved: number;
  // Matched resources whose update threw. Logged server-side, never fatal.
  resourcesFailed: number;
}

export interface RuleRunPassResult extends RuleRunCounts {
  /*
   * Where the next pass starts, or null when this pass reached the end of the
   * project. Opaque to the dashboard: it is sent back exactly as received.
   */
  nextCursor: string | null;
  // Owner rules only: whether the owners this pass added were notified.
  ownersNotified: boolean;
}

export interface RuleRunResult extends RuleRunCounts {
  passes: number;
  /*
   * True when the run stopped at MAX_RULE_RUN_PASSES with resources left to
   * evaluate.
   */
  isTruncated: boolean;
  ownersNotified: boolean;
}

/*
 * A count off the wire. An absent or non-numeric field reads as zero rather
 * than NaN: "NaN monitors" is worse than under-reporting a counter the server
 * never sent.
 */
function readCount(json: JSONObject, key: string): number {
  const value: unknown = json[key];

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.floor(value);
}

const RULE_RUN_TYPES: ReadonlySet<string> = new Set<string>(
  Object.values(RuleRunType),
);

export class RuleRunTypeUtil {
  public static isRuleRunType(value: unknown): value is RuleRunType {
    return typeof value === "string" && RULE_RUN_TYPES.has(value);
  }

  // The run type for a rule model, or null when that model cannot be run.
  public static fromTableName(
    tableName: string | undefined | null,
  ): RuleRunType | null {
    return RuleRunTypeUtil.isRuleRunType(tableName) ? tableName : null;
  }

  public static getMetadata(ruleType: RuleRunType): RuleRunTypeMetadata {
    return RULE_RUN_TYPE_METADATA[ruleType];
  }

  public static getAction(ruleType: RuleRunType): RuleRunAction {
    return RULE_RUN_TYPE_METADATA[ruleType].action;
  }
}

export class RuleRunResultUtil {
  public static emptyCounts(): RuleRunCounts {
    return {
      resourcesEvaluated: 0,
      resourcesMatched: 0,
      resourcesUpdated: 0,
      itemsAdded: 0,
      itemsRemoved: 0,
      resourcesFailed: 0,
    };
  }

  public static parsePassResult(
    json: JSONObject | undefined | null,
  ): RuleRunPassResult {
    const source: JSONObject = json || {};
    const cursor: unknown = source["nextCursor"];

    return {
      resourcesEvaluated: readCount(source, "resourcesEvaluated"),
      resourcesMatched: readCount(source, "resourcesMatched"),
      resourcesUpdated: readCount(source, "resourcesUpdated"),
      itemsAdded: readCount(source, "itemsAdded"),
      itemsRemoved: readCount(source, "itemsRemoved"),
      resourcesFailed: readCount(source, "resourcesFailed"),
      /*
       * Only a real id continues a run. Anything else ends it: a malformed
       * cursor sent back would be rejected, and treating it as "more to do"
       * would turn one bad response into a loop of failed requests.
       */
      nextCursor:
        typeof cursor === "string" && ObjectID.isValidUUID(cursor)
          ? cursor
          : null,
      ownersNotified: source["ownersNotified"] === true,
    };
  }

  /*
   * One report for a run that took several passes. Every pass evaluates a
   * different slice of the project, so unlike a capped re-run over the same
   * rows, every counter here is safely summed.
   */
  public static mergePasses(data: {
    passes: Array<RuleRunPassResult>;
    isTruncated: boolean;
  }): RuleRunResult {
    const result: RuleRunResult = {
      ...RuleRunResultUtil.emptyCounts(),
      passes: data.passes.length,
      isTruncated: data.isTruncated,
      ownersNotified: false,
    };

    for (const pass of data.passes) {
      result.resourcesEvaluated += pass.resourcesEvaluated;
      result.resourcesMatched += pass.resourcesMatched;
      result.resourcesUpdated += pass.resourcesUpdated;
      result.itemsAdded += pass.itemsAdded;
      result.itemsRemoved += pass.itemsRemoved;
      result.resourcesFailed += pass.resourcesFailed;
      result.ownersNotified = result.ownersNotified || pass.ownersNotified;
    }

    return result;
  }
}

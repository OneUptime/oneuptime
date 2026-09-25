import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";
import ObjectID from "../../../Types/ObjectID";
import { PerSeriesCriteriaMatch } from "../../../Types/Probe/ProbeApiIngestResponse";
import ScheduledMaintenanceService from "../../Services/ScheduledMaintenanceService";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import MonitorResourceContextUtil from "./MonitorResourceContext";
import MonitorStepResourceIdentity from "./MonitorStepResourceIdentity";
import SeriesResourceLabels, {
  SeriesResourceRefs,
} from "./SeriesResourceLabels";
import { SeriesResolvedResourceIds } from "./SeriesResourceLinker";

/*
 * Ids and names of one resource type that are currently inside an
 * ongoing maintenance window. Ids are OneUptime database ids; names are
 * the resource's identifier column (hostIdentifier / clusterIdentifier /
 * service name). A series matches if it references the resource by
 * either form.
 */
export interface ResourceKeySet {
  ids: Set<string>;
  names: Set<string>;
}

export interface MaintainedResourceKeys {
  hosts: ResourceKeySet;
  dockerHosts: ResourceKeySet;
  podmanHosts: ResourceKeySet;
  kubernetesClusters: ResourceKeySet;
  /*
   * Proxmox/Ceph clusters have no `oneuptime.*.id` label stamp, so only
   * the name set is ever matched; the id set exists for shape parity.
   */
  proxmoxClusters: ResourceKeySet;
  /*
   * vCenters, like Proxmox/Ceph clusters, have no `oneuptime.*.id`
   * label stamp (the VMware Agent stamps `vmware.vcenter.name` only),
   * so only the name set is ever matched; the id set exists for shape
   * parity.
   */
  vmwareVCenters: ResourceKeySet;
  cephClusters: ResourceKeySet;
  /*
   * Docker Swarm clusters, like Proxmox/Ceph clusters, have no
   * `oneuptime.*.id` label stamp, so only the name set is ever matched;
   * the id set exists for shape parity.
   */
  dockerSwarmClusters: ResourceKeySet;
  /*
   * IoT fleets, like Proxmox/Ceph clusters, have no `oneuptime.*.id`
   * label stamp, so only the name set is ever matched; the id set
   * exists for shape parity.
   */
  iotFleets: ResourceKeySet;
  services: ResourceKeySet;
  /*
   * Databases are the reverse of the name-only clusters above: a series
   * identifies one only by the `oneuptime.database.server.id` stamp (see
   * DatabaseServerIdLabelKeys), so only the id set is ever matched; the
   * name set exists for shape parity and is never filled.
   */
  databaseServers: ResourceKeySet;
}

/*
 * What scheduled maintenance silences in ONE evaluation: the breaching
 * series whose own resource is under maintenance (grouped monitors), and —
 * when the monitor's own configuration names a database — the whole
 * evaluation. See getMaintenanceSuppression.
 */
export interface MonitorMaintenanceSuppressionResult {
  suppressedSeriesFingerprints: Set<string>;
  /*
   * The databases under an ongoing maintenance window that silence every
   * incident and alert this evaluation would create. Empty unless the
   * monitor names at least one database and every resource it names is
   * under maintenance.
   */
  suppressingDatabaseServerIds: Array<string>;
}

/*
 * Per-series counterpart to the whole-monitor
 * `disableActiveMonitoringBecauseOfScheduledMaintenanceEvent` flag.
 *
 * A grouped metric monitor (group-by `host.name`, say) evaluates its
 * criteria once per series and creates one incident/alert per breaching
 * series. The whole-monitor flag is all-or-nothing: it only fires when
 * the *monitor itself* is attached to a maintenance event, and it would
 * silence every series. That leaves a gap — attaching only some of the
 * underlying resources (10 of 100 hosts) to a maintenance window did
 * nothing, because nothing maps an attached host back to the series it
 * owns.
 *
 * This util closes that gap: it returns the fingerprints of the series
 * whose resource is under an ongoing maintenance window, so the
 * incident/alert creation loops can skip exactly those series while the
 * other 90 hosts keep alerting. It covers every resource type a
 * maintenance event can attach to AND a series can identify: Host,
 * DockerHost, KubernetesCluster, ProxmoxCluster, VMwareVCenter,
 * CephCluster, DatabaseServer, and Service.
 */
export default class MonitorMaintenanceSuppression {
  /*
   * Resolve the per-series suppression set for one project. Returns an
   * empty set on the common paths — no per-series matches, or no
   * ongoing maintenance touching any resource — so callers pay at most
   * one query and nothing when there is no maintenance.
   */
  @CaptureSpan()
  public static async getSuppressedSeriesFingerprints(input: {
    projectId: ObjectID;
    matchesPerSeries?: Array<PerSeriesCriteriaMatch> | undefined;
  }): Promise<Set<string>> {
    if (!input.matchesPerSeries || input.matchesPerSeries.length === 0) {
      return new Set<string>();
    }

    const maintained: MaintainedResourceKeys =
      await this.getResourcesUnderOngoingMaintenance(input.projectId);

    if (!this.hasAnyMaintainedResource(maintained)) {
      return new Set<string>();
    }

    return this.getSuppressedFingerprintsForMaintainedResources({
      matchesPerSeries: input.matchesPerSeries,
      maintained,
    });
  }

  /*
   * Everything scheduled maintenance silences in one evaluation: the
   * per-series set above, plus the whole evaluation when the monitor's OWN
   * configuration names a database under maintenance.
   *
   * The second half exists because series labels only exist on grouped
   * criteria, and a database's monitors are not grouped: every monitor its
   * Recommendations tab creates, and every one built from a database chart,
   * is ungrouped and scoped by the `oneuptime.database.server.id` filter,
   * and a Database Health or SQL Query probe names its database by the
   * host:port it connects to. Without it, "Engine Metrics Stopped" paged
   * on-call for the very upgrade the team had put the database into
   * maintenance for.
   *
   * A monitor is silenced only while EVERY resource its configuration
   * names is under maintenance: an ungrouped monitor cannot say which of
   * two databases (or which of a database and the service calling it)
   * breached, and silencing it for one would hide an outage on the other.
   * Scoped to monitors that name a database — the resource whose monitors
   * are all ungrouped by design; monitors of other resources keep the
   * per-series behaviour.
   *
   * The caller skips CREATION only: the monitor's status timeline and the
   * resolve path for already-open incidents and alerts are untouched, the
   * same contract as the per-series set and dependency suppression.
   *
   * Costs nothing for a monitor that names no database and has no
   * per-series matches, one query (the ongoing events, shared by both
   * halves) otherwise, and the monitor's resource lookups only while a
   * database of the project is under maintenance.
   */
  @CaptureSpan()
  public static async getMaintenanceSuppression(input: {
    monitor: Monitor;
    matchesPerSeries?: Array<PerSeriesCriteriaMatch> | undefined;
  }): Promise<MonitorMaintenanceSuppressionResult> {
    const result: MonitorMaintenanceSuppressionResult = {
      suppressedSeriesFingerprints: new Set<string>(),
      suppressingDatabaseServerIds: [],
    };

    const projectId: ObjectID | undefined = input.monitor.projectId;

    if (!projectId) {
      return result;
    }

    const hasSeries: boolean = Boolean(
      input.matchesPerSeries && input.matchesPerSeries.length > 0,
    );

    const namesDatabase: boolean = this.monitorNamesDatabase(input.monitor);

    if (!hasSeries && !namesDatabase) {
      return result;
    }

    const maintained: MaintainedResourceKeys =
      await this.getResourcesUnderOngoingMaintenance(projectId);

    if (!this.hasAnyMaintainedResource(maintained)) {
      return result;
    }

    if (hasSeries) {
      result.suppressedSeriesFingerprints =
        this.getSuppressedFingerprintsForMaintainedResources({
          matchesPerSeries: input.matchesPerSeries || [],
          maintained,
        });
    }

    if (namesDatabase && maintained.databaseServers.ids.size > 0) {
      /*
       * Resolved rather than read raw: an id or endpoint that names no
       * database of THIS project (deleted, mistyped, another tenant's)
       * silences nothing. The resolver never throws — a failed lookup
       * resolves to nothing, which keeps the monitor alerting.
       */
      const resolved: SeriesResolvedResourceIds =
        await MonitorResourceContextUtil.resolveResourceContextForMonitor({
          monitor: input.monitor,
        });

      result.suppressingDatabaseServerIds =
        this.getSuppressingDatabaseServerIds({
          resolved: resolved,
          maintained: maintained,
        });
    }

    return result;
  }

  public static isMonitorSuppressed(
    result: MonitorMaintenanceSuppressionResult,
  ): boolean {
    return result.suppressingDatabaseServerIds.length > 0;
  }

  /*
   * Pure decision step of the whole-monitor half, split out so it can be
   * unit tested without a database: the databases the monitor names, when
   * it names at least one and every resource it names (of every type) is
   * under an ongoing maintenance window; otherwise none.
   */
  public static getSuppressingDatabaseServerIds(input: {
    resolved: SeriesResolvedResourceIds;
    maintained: MaintainedResourceKeys;
  }): Array<string> {
    const resolved: SeriesResolvedResourceIds = input.resolved;
    const maintained: MaintainedResourceKeys = input.maintained;

    if (resolved.databaseServerIds.length === 0) {
      return [];
    }

    const namedByType: Array<{ ids: Array<string>; keys: ResourceKeySet }> = [
      { ids: resolved.hostIds, keys: maintained.hosts },
      { ids: resolved.dockerHostIds, keys: maintained.dockerHosts },
      { ids: resolved.podmanHostIds, keys: maintained.podmanHosts },
      {
        ids: resolved.kubernetesClusterIds,
        keys: maintained.kubernetesClusters,
      },
      { ids: resolved.serviceIds, keys: maintained.services },
      { ids: resolved.proxmoxClusterIds, keys: maintained.proxmoxClusters },
      { ids: resolved.vmwareVCenterIds, keys: maintained.vmwareVCenters },
      { ids: resolved.cephClusterIds, keys: maintained.cephClusters },
      {
        ids: resolved.dockerSwarmClusterIds,
        keys: maintained.dockerSwarmClusters,
      },
      { ids: resolved.iotFleetIds, keys: maintained.iotFleets },
      { ids: resolved.databaseServerIds, keys: maintained.databaseServers },
    ];

    for (const named of namedByType) {
      for (const id of named.ids) {
        if (!named.keys.ids.has(id)) {
          return [];
        }
      }
    }

    return [...resolved.databaseServerIds];
  }

  /*
   * Record, on the monitor's evaluation summary, what one matching
   * criteria did NOT create because the monitor is silenced as a whole —
   * the counterpart of the "suppressed by scheduled maintenance" events
   * the creators record per series. Only what the criteria would have
   * created is recorded.
   */
  public static recordMonitorSuppressed(input: {
    evaluationSummary?: MonitorEvaluationSummary | undefined;
    criteriaInstance: MonitorCriteriaInstance;
    suppression: MonitorMaintenanceSuppressionResult;
  }): void {
    const databases: string =
      input.suppression.suppressingDatabaseServerIds.length === 1
        ? `the database ${input.suppression.suppressingDatabaseServerIds[0]} this monitor watches is`
        : `the databases ${input.suppression.suppressingDatabaseServerIds.join(", ")} this monitor watches are`;

    logger.debug(
      `Skipping incident and alert creation for criteria ${input.criteriaInstance.data?.id}: ${databases} under an active scheduled maintenance window.`,
    );

    if (!input.evaluationSummary) {
      return;
    }

    if (input.criteriaInstance.data?.createIncidents) {
      input.evaluationSummary.events.push({
        type: "incident-skipped",
        title: "Incident suppressed by scheduled maintenance",
        message: `Skipped creating incidents because ${databases} under an active scheduled maintenance window. This monitor's status still updates normally; open incidents still auto-resolve.`,
        relatedCriteriaId: input.criteriaInstance.data?.id,
        at: OneUptimeDate.getCurrentDate(),
      });
    }

    if (input.criteriaInstance.data?.createAlerts) {
      input.evaluationSummary.events.push({
        type: "alert-skipped",
        title: "Alert suppressed by scheduled maintenance",
        message: `Skipped creating alerts because ${databases} under an active scheduled maintenance window. This monitor's status still updates normally; open alerts still auto-resolve.`,
        relatedCriteriaId: input.criteriaInstance.data?.id,
        at: OneUptimeDate.getCurrentDate(),
      });
    }
  }

  /*
   * Whether the monitor's own configuration names a database — the pure,
   * query-free gate in front of the maintenance lookup. The step JSON is
   * not schema-checked, so an unreadable one names nothing rather than
   * throwing out of the evaluation.
   */
  private static monitorNamesDatabase(monitor: Monitor): boolean {
    try {
      const refs: SeriesResourceRefs =
        MonitorStepResourceIdentity.extractResourceRefsFromMonitor({
          monitor: monitor,
        });

      return (
        refs.databaseServerIds.length > 0 ||
        refs.databaseServerEndpoints.length > 0
      );
    } catch (err) {
      logger.error(
        `Failed to read the resources monitor ${monitor.id?.toString()} names for maintenance suppression: ${err}`,
      );
      return false;
    }
  }

  /*
   * Pure matching step, split out from the query so it can be unit
   * tested without a database. For each series, pull the resource
   * identifiers out of its labels and suppress the series if any of
   * them is under maintenance.
   */
  public static getSuppressedFingerprintsForMaintainedResources(input: {
    matchesPerSeries: Array<PerSeriesCriteriaMatch>;
    maintained: MaintainedResourceKeys;
  }): Set<string> {
    const suppressed: Set<string> = new Set<string>();

    for (const series of input.matchesPerSeries) {
      if (!series.fingerprint || !series.labels) {
        continue;
      }

      const refs: SeriesResourceRefs = SeriesResourceLabels.extractResourceRefs(
        series.labels,
      );

      const isUnderMaintenance: boolean =
        this.intersects(refs.hostIds, input.maintained.hosts.ids) ||
        this.intersects(refs.hostNames, input.maintained.hosts.names) ||
        this.intersects(refs.dockerHostIds, input.maintained.dockerHosts.ids) ||
        this.intersects(
          refs.dockerHostNames,
          input.maintained.dockerHosts.names,
        ) ||
        this.intersects(refs.podmanHostIds, input.maintained.podmanHosts.ids) ||
        this.intersects(
          refs.podmanHostNames,
          input.maintained.podmanHosts.names,
        ) ||
        this.intersects(
          refs.kubernetesClusterIds,
          input.maintained.kubernetesClusters.ids,
        ) ||
        this.intersects(
          refs.kubernetesClusterNames,
          input.maintained.kubernetesClusters.names,
        ) ||
        this.intersects(
          refs.proxmoxClusterNames,
          input.maintained.proxmoxClusters.names,
        ) ||
        this.intersects(
          refs.vmwareVCenterNames,
          input.maintained.vmwareVCenters.names,
        ) ||
        this.intersects(
          refs.cephClusterNames,
          input.maintained.cephClusters.names,
        ) ||
        this.intersects(
          refs.dockerSwarmClusterNames,
          input.maintained.dockerSwarmClusters.names,
        ) ||
        this.intersects(refs.iotFleetNames, input.maintained.iotFleets.names) ||
        this.intersects(refs.serviceIds, input.maintained.services.ids) ||
        this.intersects(refs.serviceNames, input.maintained.services.names) ||
        this.intersects(
          refs.databaseServerIds,
          input.maintained.databaseServers.ids,
        );

      if (isUnderMaintenance) {
        suppressed.add(series.fingerprint);
      }
    }

    return suppressed;
  }

  private static intersects(values: Array<string>, set: Set<string>): boolean {
    for (const value of values) {
      if (set.has(value)) {
        return true;
      }
    }
    return false;
  }

  private static hasAnyMaintainedResource(
    maintained: MaintainedResourceKeys,
  ): boolean {
    return (
      maintained.hosts.ids.size > 0 ||
      maintained.hosts.names.size > 0 ||
      maintained.dockerHosts.ids.size > 0 ||
      maintained.dockerHosts.names.size > 0 ||
      maintained.podmanHosts.ids.size > 0 ||
      maintained.podmanHosts.names.size > 0 ||
      maintained.kubernetesClusters.ids.size > 0 ||
      maintained.kubernetesClusters.names.size > 0 ||
      maintained.proxmoxClusters.ids.size > 0 ||
      maintained.proxmoxClusters.names.size > 0 ||
      maintained.vmwareVCenters.ids.size > 0 ||
      maintained.vmwareVCenters.names.size > 0 ||
      maintained.cephClusters.ids.size > 0 ||
      maintained.cephClusters.names.size > 0 ||
      maintained.dockerSwarmClusters.ids.size > 0 ||
      maintained.dockerSwarmClusters.names.size > 0 ||
      maintained.iotFleets.ids.size > 0 ||
      maintained.iotFleets.names.size > 0 ||
      maintained.services.ids.size > 0 ||
      maintained.services.names.size > 0 ||
      maintained.databaseServers.ids.size > 0
    );
  }

  /*
   * Collect the ids + identifiers of every Host / DockerHost /
   * PodmanHost / KubernetesCluster / ProxmoxCluster / VMwareVCenter /
   * CephCluster / DockerSwarmCluster / IoTFleet / Service / DatabaseServer
   * attached to an ongoing maintenance event in this project. Monitors
   * attached to the event are intentionally not collected here — those are
   * already handled upstream by the whole-monitor disable flag, which
   * short-circuits evaluation before we ever reach per-series creation.
   */
  private static async getResourcesUnderOngoingMaintenance(
    projectId: ObjectID,
  ): Promise<MaintainedResourceKeys> {
    const maintained: MaintainedResourceKeys = {
      hosts: { ids: new Set<string>(), names: new Set<string>() },
      dockerHosts: { ids: new Set<string>(), names: new Set<string>() },
      podmanHosts: { ids: new Set<string>(), names: new Set<string>() },
      kubernetesClusters: { ids: new Set<string>(), names: new Set<string>() },
      proxmoxClusters: { ids: new Set<string>(), names: new Set<string>() },
      vmwareVCenters: { ids: new Set<string>(), names: new Set<string>() },
      cephClusters: { ids: new Set<string>(), names: new Set<string>() },
      dockerSwarmClusters: {
        ids: new Set<string>(),
        names: new Set<string>(),
      },
      iotFleets: { ids: new Set<string>(), names: new Set<string>() },
      services: { ids: new Set<string>(), names: new Set<string>() },
      databaseServers: { ids: new Set<string>(), names: new Set<string>() },
    };

    const ongoingEvents: Array<ScheduledMaintenance> =
      await ScheduledMaintenanceService.findBy({
        query: {
          projectId: projectId,
          currentScheduledMaintenanceState: {
            isOngoingState: true,
          },
        },
        select: {
          _id: true,
          hosts: { _id: true, hostIdentifier: true },
          dockerHosts: { _id: true, hostIdentifier: true },
          podmanHosts: { _id: true, hostIdentifier: true },
          kubernetesClusters: { _id: true, clusterIdentifier: true },
          proxmoxClusters: { _id: true, name: true },
          vmwareVCenters: { _id: true, name: true },
          cephClusters: { _id: true, name: true },
          dockerSwarmClusters: { _id: true, name: true },
          iotFleets: { _id: true, name: true },
          services: { _id: true, name: true },
          databaseServers: { _id: true },
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    for (const event of ongoingEvents) {
      for (const host of event.hosts || []) {
        this.addKey(maintained.hosts, host._id, host.hostIdentifier);
      }
      for (const dockerHost of event.dockerHosts || []) {
        this.addKey(
          maintained.dockerHosts,
          dockerHost._id,
          dockerHost.hostIdentifier,
        );
      }
      for (const podmanHost of event.podmanHosts || []) {
        this.addKey(
          maintained.podmanHosts,
          podmanHost._id,
          podmanHost.hostIdentifier,
        );
      }
      for (const cluster of event.kubernetesClusters || []) {
        this.addKey(
          maintained.kubernetesClusters,
          cluster._id,
          cluster.clusterIdentifier,
        );
      }
      for (const proxmoxCluster of event.proxmoxClusters || []) {
        this.addKey(
          maintained.proxmoxClusters,
          proxmoxCluster._id,
          proxmoxCluster.name,
        );
      }
      for (const vmwareVCenter of event.vmwareVCenters || []) {
        this.addKey(
          maintained.vmwareVCenters,
          vmwareVCenter._id,
          vmwareVCenter.name,
        );
      }
      for (const cephCluster of event.cephClusters || []) {
        this.addKey(maintained.cephClusters, cephCluster._id, cephCluster.name);
      }
      for (const swarmCluster of event.dockerSwarmClusters || []) {
        this.addKey(
          maintained.dockerSwarmClusters,
          swarmCluster._id,
          swarmCluster.name,
        );
      }
      for (const iotFleet of event.iotFleets || []) {
        this.addKey(maintained.iotFleets, iotFleet._id, iotFleet.name);
      }
      for (const service of event.services || []) {
        this.addKey(maintained.services, service._id, service.name);
      }
      for (const databaseServer of event.databaseServers || []) {
        // Id only — the display name is not an identity (see the interface).
        this.addKey(maintained.databaseServers, databaseServer._id, undefined);
      }
    }

    return maintained;
  }

  private static addKey(
    keySet: ResourceKeySet,
    id: string | undefined,
    name: string | undefined,
  ): void {
    if (id) {
      keySet.ids.add(String(id));
    }
    if (name) {
      keySet.names.add(name);
    }
  }
}

import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";
import ObjectID from "../../../Types/ObjectID";
import { PerSeriesCriteriaMatch } from "../../../Types/Probe/ProbeApiIngestResponse";
import DataCheck from "../../../Models/DatabaseModels/DataCheck";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import { DataCheckAttribute } from "../../../Types/DataObservability/DataCheckMetric";
import { DataObservabilityAttribute } from "../../../Types/DataObservability/DataObservabilityMetric";
import { JSONObject } from "../../../Types/JSON";
import MonitorStepOpenStackMonitor from "../../../Types/Monitor/MonitorStepOpenStackMonitor";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  OpenStackMaintainedCloud,
  isOpenStackSeriesOnMaintainedPart,
} from "../../../Types/OpenStack/OpenStackMaintenancePart";
import DataCheckService from "../../Services/DataCheckService";
import DataStoreService from "../../Services/DataStoreService";
import ScheduledMaintenanceService from "../../Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../Services/ScheduledMaintenanceStateService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import MonitorResourceContextUtil from "./MonitorResourceContext";
import MonitorStepResourceIdentity from "./MonitorStepResourceIdentity";
import SeriesResourceLabels, {
  SeriesResourceRefs,
} from "./SeriesResourceLabels";
import { SeriesResolvedResourceIds } from "./SeriesResourceLinker";
import OpenStackMaintenanceParts from "../OpenStack/OpenStackMaintenanceParts";
import { getCloudEnvironmentKeyOfRow } from "../../../Types/Cloud/CloudEnvironmentTelemetryScope";

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
   * The OpenStack clouds under maintenance as a whole. An event that names some of a cloud's parts is
   * about those parts and not the cloud: see openStackParts.
   */
  openStackClouds: ResourceKeySet;
  /*
   * The hosts and zones of a cloud under maintenance, which only a monitor of that cloud can ask about,
   * because a series names its machine and not its cloud.
   */
  openStackParts?: Array<OpenStackMaintainedCloud> | undefined;
  /*
   * vCenters, like Proxmox/Ceph clusters, have no `oneuptime.*.id`
   * label stamp (the VMware Agent stamps `vmware.vcenter.name` only),
   * so only the name set is ever matched; the id set exists for shape
   * parity.
   */
  vmwareVCenters: ResourceKeySet;
  cephClusters: ResourceKeySet;
  /*
   * Storage arrays, like Proxmox/Ceph clusters, have no `oneuptime.*.id`
   * label stamp (the Storage Array Agent stamps `storage.array.name`
   * only), so only the name set is ever matched; the id set exists for
   * shape parity.
   */
  storageArrays: ResourceKeySet;
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
   * The stores Data Observability watches: named on the event, or on a
   * database server that is itself under maintenance. Ids only.
   */
  dataStoreIds?: Set<string> | undefined;
  /*
   * Databases are the reverse of the name-only clusters above: a series
   * identifies one only by the `oneuptime.database.server.id` stamp (see
   * DatabaseServerIdLabelKeys), so only the id set is ever matched; the
   * name set exists for shape parity and is never filled.
   */
  databaseServers: ResourceKeySet;
  /*
   * Cloud resources, like databases, are matched by id only: a monitor
   * names one by the event scope of its query (eventScope.cloudResourceId,
   * MonitorStepResourceIdentity), never by a name, and no cloud metric
   * carries a stamp a series could be matched by. The name set exists for
   * shape parity and is never filled.
   */
  cloudResources: ResourceKeySet;
  /*
   * The App Platforms environments under maintenance, by the key of the
   * telemetry they hold (getCloudEnvironmentKeyOfRow: platform, account and
   * Region), each to its row's id. Every one is in cloudResources too. A
   * monitor names no environment by its id: an app's monitors, and those
   * built from an environment's tabs, read its telemetry by those three
   * attributes (getSuppressingCloudEnvironmentIds). Absent while no
   * environment is held.
   */
  cloudEnvironments?: Map<string, string> | undefined;
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
   * monitor names at least one database or cloud resource and every
   * resource it names is under maintenance.
   */
  suppressingDatabaseServerIds: Array<string>;
  /*
   * The cloud resources under an ongoing maintenance window that silence
   * them, by the same rule: a cloud resource's recommended monitors, and
   * the ones built from its metrics, name it in their own configuration.
   * Absent (none) on a result built before cloud resources could be held.
   */
  suppressingCloudResourceIds?: Array<string> | undefined;
  /*
   * The App Platforms environments under maintenance that silence a monitor
   * whose every query reads nothing but their telemetry - an app's
   * recommended monitors, and those built from an app's or an environment's
   * tabs (getSuppressingCloudEnvironmentIds). Absent (none) otherwise.
   */
  suppressingCloudEnvironmentIds?: Array<string> | undefined;
  /*
   * The stores under maintenance that silence a monitor of Data Observability:
   * every store it watches is one. Empty for any other monitor.
   */
  suppressingDataStoreIds?: Array<string> | undefined;
}

// The resources that silence a monitor whole, by kind (getSuppressingResourceIds).
export interface SuppressingResourceIds {
  databaseServerIds: Array<string>;
  cloudResourceIds: Array<string>;
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
 * CephCluster, StorageArray, DatabaseServer, and Service.
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

    const namesHeldKind: boolean = this.monitorNamesSilenceableResource(
      input.monitor,
    );
    const watchesData: boolean = this.monitorWatchesData(input.monitor);
    /*
     * The environment each of its queries reads: only a monitor whose every
     * query reads one can be silenced by an environment's maintenance, so
     * only such a monitor pays for the lookup on this account.
     */
    const environmentKeys: Array<string | null> =
      this.readCloudEnvironmentKeys(input.monitor);
    const readsOnlyEnvironments: boolean =
      environmentKeys.length > 0 &&
      environmentKeys.every((key: string | null): boolean => {
        return Boolean(key);
      });

    if (!hasSeries && !namesHeldKind && !watchesData && !readsOnlyEnvironments) {
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

      for (const fingerprint of this.getOpenStackSuppressedFingerprints({
        monitor: input.monitor,
        matchesPerSeries: input.matchesPerSeries || [],
        maintained,
      })) {
        result.suppressedSeriesFingerprints.add(fingerprint);
      }
    }

    if (watchesData && maintained.dataStoreIds?.size) {
      const stores: Array<string> = await this.readDataStoresOfMonitor(
        input.monitor,
      );

      result.suppressingDataStoreIds = this.getSuppressingDataStoreIds({
        stores,
        maintained,
      });
    }

    if (
      namesHeldKind &&
      (maintained.databaseServers.ids.size > 0 ||
        maintained.cloudResources.ids.size > 0)
    ) {
      /*
       * Resolved rather than read raw: an id or endpoint that names no
       * database or cloud resource of THIS project (deleted, mistyped,
       * another tenant's) silences nothing. The resolver never throws — a
       * failed lookup resolves to nothing, which keeps the monitor
       * alerting.
       */
      const resolved: SeriesResolvedResourceIds =
        await MonitorResourceContextUtil.resolveResourceContextForMonitor({
          monitor: input.monitor,
        });

      const suppressing: SuppressingResourceIds =
        this.getSuppressingResourceIds({
          resolved: resolved,
          maintained: maintained,
        });

      result.suppressingDatabaseServerIds = suppressing.databaseServerIds;

      if (suppressing.cloudResourceIds.length > 0) {
        result.suppressingCloudResourceIds = suppressing.cloudResourceIds;
      }
    }

    if (readsOnlyEnvironments && maintained.cloudEnvironments?.size) {
      const environmentIds: Array<string> =
        this.getSuppressingCloudEnvironmentIds({
          queryEnvironmentKeys: environmentKeys,
          maintained: maintained,
        });

      if (environmentIds.length > 0) {
        result.suppressingCloudEnvironmentIds = environmentIds;
      }
    }

    return result;
  }

  public static isMonitorSuppressed(
    result: MonitorMaintenanceSuppressionResult,
  ): boolean {
    return (
      result.suppressingDatabaseServerIds.length > 0 ||
      (result.suppressingCloudResourceIds || []).length > 0 ||
      (result.suppressingCloudEnvironmentIds || []).length > 0 ||
      (result.suppressingDataStoreIds || []).length > 0
    );
  }

  /*
   * The whole-monitor decision for a monitor that reads an App Platforms
   * environment's telemetry: the environments it reads, when EVERY query it
   * makes reads nothing but one of them (each query's environment key, as
   * MonitorStepResourceIdentity.getCloudEnvironmentKeysOfQueries reads it)
   * and every one of those is under an ongoing maintenance window; otherwise
   * none. An app's recommended monitors read its environment's platform,
   * account and Region and its own attributes, so maintenance that holds the
   * environment holds every app in it - and only those: a query of another
   * environment, or one that pins less than all its environment's parts,
   * reads telemetry the maintenance does not cover, and keeps the monitor
   * alerting. Pure, so it can be tested without a database.
   */
  public static getSuppressingCloudEnvironmentIds(input: {
    queryEnvironmentKeys: Array<string | null>;
    maintained: Pick<MaintainedResourceKeys, "cloudEnvironments">;
  }): Array<string> {
    const environments: Map<string, string> | undefined =
      input.maintained.cloudEnvironments;

    if (
      !environments ||
      environments.size === 0 ||
      input.queryEnvironmentKeys.length === 0
    ) {
      return [];
    }

    const environmentIds: Array<string> = [];

    for (const key of input.queryEnvironmentKeys) {
      const environmentId: string | undefined = key
        ? environments.get(key)
        : undefined;

      if (!environmentId) {
        return [];
      }

      if (!environmentIds.includes(environmentId)) {
        environmentIds.push(environmentId);
      }
    }

    return environmentIds;
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
    return this.getSuppressingResourceIds(input).databaseServerIds;
  }

  /*
   * The same decision for both kinds a monitor's configuration names and a
   * maintenance event can hold whole: databases and cloud resources. A
   * monitor naming at least one of them is silenced only while every
   * resource it names - of every type - is under maintenance; it is then
   * silenced by the databases and cloud resources it names.
   */
  public static getSuppressingResourceIds(input: {
    resolved: SeriesResolvedResourceIds;
    maintained: MaintainedResourceKeys;
  }): SuppressingResourceIds {
    const resolved: SeriesResolvedResourceIds = input.resolved;
    const maintained: MaintainedResourceKeys = input.maintained;
    const none: SuppressingResourceIds = {
      databaseServerIds: [],
      cloudResourceIds: [],
    };

    if (
      resolved.databaseServerIds.length === 0 &&
      resolved.cloudResourceIds.length === 0
    ) {
      return none;
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
      { ids: resolved.openStackCloudIds, keys: maintained.openStackClouds },
      { ids: resolved.vmwareVCenterIds, keys: maintained.vmwareVCenters },
      { ids: resolved.cephClusterIds, keys: maintained.cephClusters },
      { ids: resolved.storageArrayIds, keys: maintained.storageArrays },
      {
        ids: resolved.dockerSwarmClusterIds,
        keys: maintained.dockerSwarmClusters,
      },
      { ids: resolved.iotFleetIds, keys: maintained.iotFleets },
      { ids: resolved.databaseServerIds, keys: maintained.databaseServers },
      { ids: resolved.cloudResourceIds, keys: maintained.cloudResources },
    ];

    for (const named of namedByType) {
      for (const id of named.ids) {
        if (!named.keys.ids.has(id)) {
          return none;
        }
      }
    }

    return {
      databaseServerIds: [...resolved.databaseServerIds],
      cloudResourceIds: [...resolved.cloudResourceIds],
    };
  }

  /*
   * The whole-monitor decision for a monitor of Data Observability: the stores
   * it watches, when it watches at least one and every one is under an ongoing
   * maintenance window. Pure, so it can be tested without a database.
   */
  public static getSuppressingDataStoreIds(input: {
    stores: Array<string>;
    maintained: Pick<MaintainedResourceKeys, "dataStoreIds">;
  }): Array<string> {
    return input.stores.length > 0 &&
      input.stores.every((id: string): boolean => {
        return Boolean(input.maintained.dataStoreIds?.has(id));
      })
      ? input.stores
      : [];
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
    const databases: string = this.describeSuppressingResources(
      input.suppression,
    );

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
   * What silenced the monitor, as the evaluation summary says it: "the
   * database <id> this monitor watches is", "the cloud resource <id> and
   * the database <id> this monitor watches are", "the environment <id>
   * this monitor watches is".
   */
  public static describeSuppressingResources(
    suppression: MonitorMaintenanceSuppressionResult,
  ): string {
    const parts: Array<string> = [];
    const cloudEnvironmentIds: Array<string> =
      suppression.suppressingCloudEnvironmentIds || [];
    const cloudResourceIds: Array<string> =
      suppression.suppressingCloudResourceIds || [];
    // A store Data Observability watches is said as a database, as it is drawn.
    const databaseServerIds: Array<string> = [
      ...suppression.suppressingDatabaseServerIds,
      ...(suppression.suppressingDataStoreIds || []),
    ];

    if (cloudEnvironmentIds.length > 0) {
      parts.push(
        cloudEnvironmentIds.length === 1
          ? `the environment ${cloudEnvironmentIds[0]}`
          : `the environments ${cloudEnvironmentIds.join(", ")}`,
      );
    }

    if (cloudResourceIds.length > 0) {
      parts.push(
        cloudResourceIds.length === 1
          ? `the cloud resource ${cloudResourceIds[0]}`
          : `the cloud resources ${cloudResourceIds.join(", ")}`,
      );
    }

    if (databaseServerIds.length > 0) {
      parts.push(
        databaseServerIds.length === 1
          ? `the database ${databaseServerIds[0]}`
          : `the databases ${databaseServerIds.join(", ")}`,
      );
    }

    const isOne: boolean =
      cloudEnvironmentIds.length +
        cloudResourceIds.length +
        databaseServerIds.length ===
      1;

    return `${parts.join(" and ")} this monitor watches ${isOne ? "is" : "are"}`;
  }

  /*
   * Whether the monitor's own configuration names a resource a maintenance
   * event silences whole - a database, or a cloud resource - the pure,
   * query-free gate in front of the maintenance lookup. The step JSON is
   * not schema-checked, so an unreadable one names nothing rather than
   * throwing out of the evaluation.
   */
  private static monitorNamesSilenceableResource(monitor: Monitor): boolean {
    try {
      const refs: SeriesResourceRefs =
        MonitorStepResourceIdentity.extractResourceRefsFromMonitor({
          monitor: monitor,
        });

      return (
        refs.databaseServerIds.length > 0 ||
        refs.databaseServerEndpoints.length > 0 ||
        refs.cloudResourceIds.length > 0
      );
    } catch (err) {
      logger.error(
        `Failed to read the resources monitor ${monitor.id?.toString()} names for maintenance suppression: ${err}`,
      );
      return false;
    }
  }

  /*
   * The environment key of each telemetry query the monitor makes
   * (MonitorStepResourceIdentity.getCloudEnvironmentKeysOfQueries), or none
   * when its steps cannot be read: query-free, as above, and never throwing
   * out of the evaluation.
   */
  private static readCloudEnvironmentKeys(
    monitor: Monitor,
  ): Array<string | null> {
    try {
      return MonitorStepResourceIdentity.getCloudEnvironmentKeysOfQueries(
        monitor,
      );
    } catch (err) {
      logger.error(
        `Failed to read the environments monitor ${monitor.id?.toString()} reads for maintenance suppression: ${err}`,
      );
      return [];
    }
  }

  /*
   * Whether a monitor reads Data Observability's metrics: scoped by a store, as
   * its recommended alerts are, or by a data check. Query-free, as above.
   */
  private static monitorWatchesData(monitor: Monitor): boolean {
    try {
      const filters: JSONObject =
        MonitorStepResourceIdentity.getMetricFilterAttributes(monitor);

      return Boolean(
        filters[DataObservabilityAttribute.DataStoreId] ||
          filters[DataCheckAttribute.CheckId],
      );
    } catch (err) {
      logger.error(
        `Failed to read the data stores monitor ${monitor.id?.toString()} watches for maintenance suppression: ${err}`,
      );
      return false;
    }
  }

  /*
   * The stores a monitor of Data Observability watches: the one it is scoped by,
   * or the one its data check reads. Asked only while a store is under
   * maintenance, and a failed read silences nothing.
   */
  private static async readDataStoresOfMonitor(
    monitor: Monitor,
  ): Promise<Array<string>> {
    try {
      const filters: JSONObject =
        MonitorStepResourceIdentity.getMetricFilterAttributes(monitor);
      const stores: Array<string> = this.readFilterValues(
        filters[DataObservabilityAttribute.DataStoreId],
      );

      if (stores.length > 0) {
        return stores;
      }

      const checkIds: Array<string> = this.readFilterValues(
        filters[DataCheckAttribute.CheckId],
      );

      if (checkIds.length === 0) {
        return [];
      }

      const checks: Array<DataCheck> = await DataCheckService.findBy({
        query: { _id: QueryHelper.any(checkIds) },
        select: { dataStoreId: true },
        skip: 0,
        limit: checkIds.length,
        props: { isRoot: true },
      });

      return Array.from(
        new Set(
          checks.map((check: DataCheck): string => {
            return check.dataStoreId?.toString() || "";
          }),
        ),
      ).filter(Boolean);
    } catch (err) {
      logger.error(
        `Failed to read the data stores of monitor ${monitor.id?.toString()}: ${err}`,
      );
      return [];
    }
  }

  private static readFilterValues(value: unknown): Array<string> {
    const values: Array<unknown> = Array.isArray(value) ? value : [value];

    return values.filter((item: unknown): item is string => {
      return typeof item === "string" && item.length > 0;
    });
  }

  /*
   * The series of a monitor of an OpenStack cloud that maintenance on that cloud covers. A template
   * groups by region, host and binary, so its series carry no cloud name for the matching below to
   * find, and the monitor's own step says which cloud they are of: the whole of it under maintenance
   * quiets all of them, and a host or a zone only what is on it. Pure, as the one below is.
   */
  public static getOpenStackSuppressedFingerprints(input: {
    monitor: Monitor;
    matchesPerSeries: Array<PerSeriesCriteriaMatch>;
    maintained: Pick<
      MaintainedResourceKeys,
      "openStackClouds" | "openStackParts"
    >;
  }): Set<string> {
    const suppressed: Set<string> = new Set<string>();

    if (input.monitor.monitorType !== MonitorType.OpenStack) {
      return suppressed;
    }

    const clouds: Array<{ name: string; id: string | undefined }> = [];

    for (const step of input.monitor.monitorSteps?.data
      ?.monitorStepsInstanceArray || []) {
      const config: MonitorStepOpenStackMonitor | undefined =
        step.data?.openstackMonitor;

      if (config?.cloudIdentifier) {
        clouds.push({
          name: config.cloudIdentifier,
          id: config.resourceId?.toString().toLowerCase(),
        });
      }
    }

    const isWholeCloudUnderMaintenance: boolean = clouds.some(
      (cloud: { name: string; id: string | undefined }): boolean => {
        return (
          input.maintained.openStackClouds.names.has(cloud.name) ||
          Boolean(
            cloud.id && input.maintained.openStackClouds.ids.has(cloud.id),
          )
        );
      },
    );

    const partsOfThisCloud: Array<OpenStackMaintainedCloud> = (
      input.maintained.openStackParts || []
    ).filter((maintainedCloud: OpenStackMaintainedCloud): boolean => {
      return clouds.some(
        (cloud: { name: string; id: string | undefined }): boolean => {
          return (
            maintainedCloud.cloudName === cloud.name ||
            maintainedCloud.cloudId === cloud.id
          );
        },
      );
    });

    for (const series of input.matchesPerSeries) {
      if (!series.fingerprint) {
        continue;
      }

      if (
        isWholeCloudUnderMaintenance ||
        partsOfThisCloud.some((cloud: OpenStackMaintainedCloud): boolean => {
          return isOpenStackSeriesOnMaintainedPart({
            labels: series.labels,
            parts: cloud.parts,
          });
        })
      ) {
        suppressed.add(series.fingerprint);
      }
    }

    return suppressed;
  }

  /*
   * Whether a monitor of an OpenStack cloud should keep the status it has. Planned work on one host
   * should not turn a whole region's row on a status page red: when everything a criteria that opens
   * incidents or alerts matched is under maintenance, there is nothing to report yet. Any series
   * outside the window speaks as it always did, and so does a criteria that says all is well. Other
   * monitors keep the contract above: their status tracks what they read, and only creation is skipped.
   */
  public static isEveryBreachUnderMaintenance(input: {
    monitor: Monitor;
    isPerSeriesEvaluation: boolean;
    criteriaInstance: MonitorCriteriaInstance | undefined;
    breachingFingerprints: ReadonlySet<string>;
    suppressedFingerprints: ReadonlySet<string>;
  }): boolean {
    if (
      input.monitor.monitorType !== MonitorType.OpenStack ||
      !input.isPerSeriesEvaluation ||
      !(
        input.criteriaInstance?.data?.createIncidents ||
        input.criteriaInstance?.data?.createAlerts
      ) ||
      input.breachingFingerprints.size === 0
    ) {
      return false;
    }

    for (const fingerprint of input.breachingFingerprints) {
      if (!input.suppressedFingerprints.has(fingerprint)) {
        return false;
      }
    }

    return true;
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
          refs.openStackCloudNames,
          input.maintained.openStackClouds.names,
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
          refs.storageArrayNames,
          input.maintained.storageArrays.names,
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
      maintained.openStackClouds.ids.size > 0 ||
      maintained.openStackClouds.names.size > 0 ||
      Boolean(maintained.openStackParts?.length) ||
      maintained.vmwareVCenters.ids.size > 0 ||
      maintained.vmwareVCenters.names.size > 0 ||
      maintained.cephClusters.ids.size > 0 ||
      maintained.cephClusters.names.size > 0 ||
      maintained.storageArrays.ids.size > 0 ||
      maintained.storageArrays.names.size > 0 ||
      maintained.dockerSwarmClusters.ids.size > 0 ||
      maintained.dockerSwarmClusters.names.size > 0 ||
      maintained.iotFleets.ids.size > 0 ||
      maintained.iotFleets.names.size > 0 ||
      maintained.services.ids.size > 0 ||
      maintained.services.names.size > 0 ||
      maintained.databaseServers.ids.size > 0 ||
      maintained.cloudResources.ids.size > 0 ||
      Boolean(maintained.cloudEnvironments?.size) ||
      Boolean(maintained.dataStoreIds?.size)
    );
  }

  /*
   * Collect the ids + identifiers of every Host / DockerHost /
   * PodmanHost / KubernetesCluster / ProxmoxCluster / VMwareVCenter /
   * CephCluster / StorageArray / DockerSwarmCluster / IoTFleet / Service /
   * DatabaseServer
   * attached to a maintenance event in progress in this project: in its
   * project's ongoing state, or in a state of the project's own placed
   * between Ongoing and Ended, such as "Verifying"
   * (Common/Utils/ScheduledMaintenanceStart). Monitors attached to the
   * event are intentionally not collected here — those are already handled
   * upstream by the whole-monitor disable flag, which short-circuits
   * evaluation before we ever reach per-series creation.
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
      openStackClouds: { ids: new Set<string>(), names: new Set<string>() },
      vmwareVCenters: { ids: new Set<string>(), names: new Set<string>() },
      cephClusters: { ids: new Set<string>(), names: new Set<string>() },
      storageArrays: { ids: new Set<string>(), names: new Set<string>() },
      dockerSwarmClusters: {
        ids: new Set<string>(),
        names: new Set<string>(),
      },
      iotFleets: { ids: new Set<string>(), names: new Set<string>() },
      services: { ids: new Set<string>(), names: new Set<string>() },
      databaseServers: { ids: new Set<string>(), names: new Set<string>() },
      cloudResources: { ids: new Set<string>(), names: new Set<string>() },
    };

    const dataStores: Set<string> = new Set<string>();
    const cloudEnvironments: Map<string, string> = new Map<string, string>();

    const inProgressStateIds: Array<ObjectID> =
      await ScheduledMaintenanceStateService.getInProgressScheduledMaintenanceStateIds(
        projectId,
      );

    if (inProgressStateIds.length === 0) {
      return maintained;
    }

    const ongoingEvents: Array<ScheduledMaintenance> =
      await ScheduledMaintenanceService.findBy({
        query: {
          projectId: projectId,
          currentScheduledMaintenanceStateId:
            QueryHelper.any(inProgressStateIds),
        },
        select: {
          _id: true,
          hosts: { _id: true, hostIdentifier: true },
          dockerHosts: { _id: true, hostIdentifier: true },
          podmanHosts: { _id: true, hostIdentifier: true },
          kubernetesClusters: { _id: true, clusterIdentifier: true },
          proxmoxClusters: { _id: true, name: true },
          openStackClouds: { _id: true, name: true },
          openStackParts: true,
          vmwareVCenters: { _id: true, name: true },
          cephClusters: { _id: true, name: true },
          storageArrays: { _id: true, name: true },
          dockerSwarmClusters: { _id: true, name: true },
          iotFleets: { _id: true, name: true },
          services: { _id: true, name: true },
          databaseServers: { _id: true },
          /*
           * An environment's kind and the three columns its telemetry is
           * keyed by: what its apps' monitors read it by.
           */
          cloudResources: {
            _id: true,
            cloudResourceKind: true,
            cloudPlatform: true,
            cloudAccountId: true,
            cloudRegion: true,
          },
          dataStoreIds: true,
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

      /*
       * An event that names a cloud's hosts or zones is about those. Linked to the cloud so it lists
       * on the cloud's page, it must not read as the whole cloud.
       */
      const cloudsWithParts: Set<string> =
        OpenStackMaintenanceParts.getCloudsWithParts(event.openStackParts);

      for (const openStackCloud of event.openStackClouds || []) {
        if (
          !cloudsWithParts.has(String(openStackCloud._id || "").toLowerCase())
        ) {
          this.addKey(
            maintained.openStackClouds,
            openStackCloud._id,
            openStackCloud.name,
          );
        }
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
      for (const storageArray of event.storageArrays || []) {
        this.addKey(
          maintained.storageArrays,
          storageArray._id,
          storageArray.name,
        );
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
      for (const cloudResource of event.cloudResources || []) {
        /*
         * Id only, lower case as a monitor's configuration names it
         * (MonitorStepResourceIdentity).
         */
        this.addKey(
          maintained.cloudResources,
          cloudResource._id
            ? String(cloudResource._id).toLowerCase()
            : undefined,
          undefined,
        );

        /*
         * An App Platforms environment holds the telemetry its apps send:
         * by the key their monitors read it by.
         */
        const environmentKey: string | null = getCloudEnvironmentKeyOfRow({
          cloudResourceKind: cloudResource.cloudResourceKind as
            | string
            | undefined,
          cloudPlatform: cloudResource.cloudPlatform as string | undefined,
          cloudAccountId: cloudResource.cloudAccountId as string | undefined,
          cloudRegion: cloudResource.cloudRegion as string | undefined,
        });

        if (environmentKey && cloudResource._id) {
          cloudEnvironments.set(
            environmentKey,
            String(cloudResource._id).toLowerCase(),
          );
        }
      }
      for (const dataStoreId of event.dataStoreIds || []) {
        dataStores.add(String(dataStoreId));
      }
    }

    // A database server under maintenance takes the stores it holds with it.
    if (maintained.databaseServers.ids.size > 0) {
      try {
        const onServers: Array<DataStore> = await DataStoreService.findBy({
          query: {
            projectId: projectId,
            databaseServerId: QueryHelper.any([
              ...maintained.databaseServers.ids,
            ]),
          },
          select: { _id: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: { isRoot: true },
        });

        for (const store of onServers) {
          if (store.id) {
            dataStores.add(store.id.toString());
          }
        }
      } catch (err) {
        logger.error(
          `Failed to read the data stores on database servers under maintenance: ${err}`,
        );
      }
    }

    if (dataStores.size > 0) {
      maintained.dataStoreIds = dataStores;
    }

    if (cloudEnvironments.size > 0) {
      maintained.cloudEnvironments = cloudEnvironments;
    }

    maintained.openStackParts =
      await OpenStackMaintenanceParts.readMaintainedClouds({
        projectId: projectId,
        events: ongoingEvents,
      });

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

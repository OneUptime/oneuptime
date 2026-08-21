import Monitor from "../../../Models/DatabaseModels/Monitor";
import { JSONObject } from "../../../Types/JSON";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsViewConfig from "../../../Types/Metrics/MetricsViewConfig";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import SeriesResourceLabels, {
  SeriesResourceRefs,
} from "./SeriesResourceLabels";

/*
 * The step-config twin of SeriesResourceLabels.
 *
 * SeriesResourceLabels answers "which resources does this BREACHING
 * SERIES point at" by reading the labels of one grouped series. That
 * only works when the criteria is grouped — an ungrouped monitor emits
 * no series labels at all, so it linked nothing, and the vast majority
 * of monitors (every shipped Host / Docker / Podman / RUM template, and
 * every Logs / Traces / Exceptions monitor, which cannot be grouped in
 * the first place) are ungrouped.
 *
 * This module answers the same question from the other, always-present
 * side: "which resources does this MONITOR'S OWN CONFIGURATION point
 * at". A host monitor names its host, a Kubernetes monitor names its
 * cluster, a log monitor names its telemetry services, and any monitor
 * with a metric query can carry resource identity in its attribute
 * filters (e.g. `oneuptime.service.name = checkout-api`). None of that
 * depends on the criteria being grouped.
 *
 * Both modules emit the SAME `SeriesResourceRefs` shape, so the single
 * nine-way resolver in SeriesResourceLinker serves both, and the two can
 * never drift into disagreeing about what identifies a resource.
 *
 * Pure: no database access, no I/O.
 */

/*
 * Which relation a monitor type's own step config speaks for. Held as an
 * exhaustive-by-construction map so a new infra monitor type is a
 * one-line addition next to its siblings rather than a new `if` branch
 * buried in the extractor.
 */
type NameRefKey = keyof Pick<
  SeriesResourceRefs,
  | "hostNames"
  | "dockerHostNames"
  | "podmanHostNames"
  | "kubernetesClusterNames"
  | "proxmoxClusterNames"
  | "cephClusterNames"
  | "dockerSwarmClusterNames"
  | "iotFleetNames"
>;

export default class MonitorStepResourceIdentity {
  /*
   * Every resource the monitor's configuration names, unioned across its
   * steps and deduped. A monitor with three host steps names three
   * hosts: the creation path does not know which step fired, and the
   * alternative — attributing nothing — is what this module exists to
   * fix.
   */
  public static extractResourceRefsFromMonitor(input: {
    monitor: Monitor;
  }): SeriesResourceRefs {
    const refs: SeriesResourceRefs = this.emptyRefs();

    const monitorType: MonitorType | undefined = input.monitor.monitorType;

    if (!monitorType) {
      return refs;
    }

    const monitorSteps: Array<MonitorStep> =
      input.monitor.monitorSteps?.data?.monitorStepsInstanceArray || [];

    for (const monitorStep of monitorSteps) {
      this.collectFromStep({
        monitorStep: monitorStep,
        monitorType: monitorType,
        refs: refs,
      });
    }

    return this.dedupeRefs(refs);
  }

  private static collectFromStep(input: {
    monitorStep: MonitorStep;
    monitorType: MonitorType;
    refs: SeriesResourceRefs;
  }): void {
    const stepData: MonitorStep["data"] = input.monitorStep.data;

    if (!stepData) {
      return;
    }

    /*
     * 1. The declared resource identifier — the field the user picked in
     *    the monitor form. Validation makes it required for each of
     *    these types (see MonitorStep's validation), so this is the
     *    strongest signal available.
     */
    const declared: { key: NameRefKey; value: string | undefined } | null =
      this.getDeclaredIdentifier({
        stepData: stepData,
        monitorType: input.monitorType,
      });

    /*
     * `typeof` rather than a truthiness check: step JSON is not
     * schema-checked, so an identifier written by the API, a seed or an
     * import can be a number or an object, and `.trim()` on those throws
     * out of the incident/alert creation path.
     */
    if (declared && typeof declared.value === "string") {
      const identifier: string = declared.value.trim();

      if (identifier.length > 0) {
        input.refs[declared.key].push(identifier);
      }
    }

    /*
     * 2. Telemetry services. Real `Service._id` values written by the
     *    monitor form's service picker — a primary key, not a name, so
     *    this is the most precise identity in the whole module. Metric
     *    monitors carry the field too (RUM recommendation monitors set
     *    it), where it is optional.
     */
    for (const serviceId of this.getTelemetryServiceIds({
      stepData: stepData,
    })) {
      input.refs.serviceIds.push(serviceId);
    }

    /*
     * 3. Metric attribute filters. A generic metric monitor names its
     *    resource nowhere else: it scopes itself with filters like
     *    `oneuptime.service.name = checkout-api`, which is exactly the
     *    key map SeriesResourceLabels already owns. Reusing that map
     *    means a filter and a group-by on the same attribute resolve to
     *    the same row.
     */
    this.collectFromMetricFilters({
      stepData: stepData,
      monitorType: input.monitorType,
      refs: input.refs,
    });
  }

  private static getDeclaredIdentifier(input: {
    stepData: NonNullable<MonitorStep["data"]>;
    monitorType: MonitorType;
  }): { key: NameRefKey; value: string | undefined } | null {
    const stepData: NonNullable<MonitorStep["data"]> = input.stepData;

    switch (input.monitorType) {
      case MonitorType.Host:
        return {
          key: "hostNames",
          value: stepData.hostMonitor?.hostIdentifier,
        };
      case MonitorType.Docker:
        return {
          key: "dockerHostNames",
          value: stepData.dockerMonitor?.hostIdentifier,
        };
      case MonitorType.Podman:
        return {
          key: "podmanHostNames",
          value: stepData.podmanMonitor?.hostIdentifier,
        };
      case MonitorType.Kubernetes:
        return {
          key: "kubernetesClusterNames",
          value: stepData.kubernetesMonitor?.clusterIdentifier,
        };
      case MonitorType.Proxmox:
        return {
          key: "proxmoxClusterNames",
          value: stepData.proxmoxMonitor?.clusterIdentifier,
        };
      case MonitorType.Ceph:
        return {
          key: "cephClusterNames",
          value: stepData.cephMonitor?.clusterIdentifier,
        };
      case MonitorType.DockerSwarm:
        return {
          key: "dockerSwarmClusterNames",
          value: stepData.dockerSwarmMonitor?.clusterIdentifier,
        };
      case MonitorType.IoTDevice:
        return {
          key: "iotFleetNames",
          value: stepData.iotMonitor?.fleetIdentifier,
        };
      default:
        return null;
    }
  }

  private static getTelemetryServiceIds(input: {
    stepData: NonNullable<MonitorStep["data"]>;
  }): Array<string> {
    const stepData: NonNullable<MonitorStep["data"]> = input.stepData;

    /*
     * Read from every telemetry sub-config present rather than switching
     * on monitorType: only one of them is ever populated for a given
     * monitor, and this way a step written by an older build (or by the
     * API, a seed, or an import) with a mismatched type still resolves.
     */
    const idLists: Array<Array<ObjectID> | undefined> = [
      stepData.logMonitor?.telemetryServiceIds,
      stepData.securityEventsMonitor?.telemetryServiceIds,
      stepData.traceMonitor?.telemetryServiceIds,
      stepData.exceptionMonitor?.telemetryServiceIds,
      stepData.profileMonitor?.telemetryServiceIds,
      stepData.metricMonitor?.telemetryServiceIds,
    ];

    const serviceIds: Array<string> = [];

    for (const idList of idLists) {
      /*
       * `Array.isArray` rather than a truthiness check: an unchecked
       * step written by the API or an import can hold an object or a
       * number here, and `for...of` on those throws out of the
       * incident/alert creation path.
       */
      if (!Array.isArray(idList) || idList.length === 0) {
        continue;
      }

      for (const id of idList) {
        /*
         * An entry can be a bare string rather than a rehydrated
         * ObjectID, for the same reason. `String()` covers both; empty
         * values are dropped so they can't widen the lookup, and a
         * non-scalar is dropped rather than stringified into a garbage
         * "[object Object]" lookup key.
         */
        if (
          id !== null &&
          typeof id === "object" &&
          !(id instanceof ObjectID)
        ) {
          continue;
        }

        const idString: string = String(id ?? "").trim();

        if (idString.length > 0) {
          serviceIds.push(idString);
        }
      }
    }

    return serviceIds;
  }

  private static collectFromMetricFilters(input: {
    stepData: NonNullable<MonitorStep["data"]>;
    monitorType: MonitorType;
    refs: SeriesResourceRefs;
  }): void {
    const filterAttributes: JSONObject = this.collectMetricFilterAttributes({
      stepData: input.stepData,
    });

    if (Object.keys(filterAttributes).length === 0) {
      return;
    }

    const filterRefs: SeriesResourceRefs =
      SeriesResourceLabels.extractResourceRefs(filterAttributes);

    /*
     * `resource.host.name` belongs to Host in the label key map, but on
     * a Docker or Podman monitor the worker writes that same attribute
     * from the step's `hostIdentifier` — which names a DockerHost /
     * PodmanHost row, not a Host row. Honouring the map here would
     * attach the wrong model and surface the event on an unrelated
     * Host's Activity tab, so the declared identifier (collected above,
     * into the right bucket) is the only host identity these two types
     * get.
     */
    const suppressHostRefs: boolean =
      input.monitorType === MonitorType.Docker ||
      input.monitorType === MonitorType.Podman;

    if (suppressHostRefs) {
      filterRefs.hostIds = [];
      filterRefs.hostNames = [];
    }

    this.mergeRefs({ target: input.refs, source: filterRefs });
  }

  /*
   * The attribute filters of every metric query on the step, merged.
   * Each infra monitor type keeps its metric view config under its own
   * key, so read them all — exactly the set MonitorStep's own
   * metric-view-config resolver knows about.
   *
   * Values accumulate into an ARRAY per key rather than overwriting: a
   * step can hold several queries, and two of them filtering
   * `oneuptime.service.name` on different services both name a real
   * resource. Last-write-wins would silently drop one of them.
   * SeriesResourceLabels.collectLabelValues already flattens
   * array-valued labels, so the multi-value shape needs nothing extra
   * downstream.
   */
  private static collectMetricFilterAttributes(input: {
    stepData: NonNullable<MonitorStep["data"]>;
  }): JSONObject {
    const stepData: NonNullable<MonitorStep["data"]> = input.stepData;

    const viewConfigs: Array<MetricsViewConfig | undefined> = [
      stepData.metricMonitor?.metricViewConfig,
      stepData.hostMonitor?.metricViewConfig,
      stepData.kubernetesMonitor?.metricViewConfig,
      stepData.dockerMonitor?.metricViewConfig,
      stepData.podmanMonitor?.metricViewConfig,
      stepData.proxmoxMonitor?.metricViewConfig,
      stepData.cephMonitor?.metricViewConfig,
      stepData.dockerSwarmMonitor?.metricViewConfig,
      stepData.iotMonitor?.metricViewConfig,
    ];

    const valuesByKey: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();

    for (const viewConfig of viewConfigs) {
      const queryConfigs: Array<MetricQueryConfigData> = Array.isArray(
        viewConfig?.queryConfigs,
      )
        ? viewConfig.queryConfigs
        : [];

      for (const queryConfig of queryConfigs) {
        const queryAttributes: unknown =
          queryConfig?.metricQueryData?.filterData?.attributes;

        if (!queryAttributes || typeof queryAttributes !== "object") {
          continue;
        }

        for (const [key, value] of Object.entries(
          queryAttributes as Record<string, unknown>,
        )) {
          /*
           * Only plain string filters identify a resource. A filter can
           * also hold a Search or Includes instance (substring / set
           * matching), and neither is an identity we can resolve to one
           * row — a `Search("prod")` filter names no specific service.
           */
          if (typeof value !== "string" || value.length === 0) {
            continue;
          }

          const existing: Array<string> = valuesByKey.get(key) || [];

          if (!existing.includes(value)) {
            existing.push(value);
          }

          valuesByKey.set(key, existing);
        }
      }
    }

    const attributes: JSONObject = {};

    for (const [key, values] of valuesByKey) {
      /*
       * A single value stays a bare string so the common case reads
       * exactly like a series label; only a genuinely multi-valued
       * filter becomes an array.
       */
      attributes[key] = values.length === 1 ? values[0]! : values;
    }

    return attributes;
  }

  private static mergeRefs(input: {
    target: SeriesResourceRefs;
    source: SeriesResourceRefs;
  }): void {
    for (const key of Object.keys(input.target) as Array<
      keyof SeriesResourceRefs
    >) {
      input.target[key].push(...input.source[key]);
    }
  }

  private static dedupeRefs(refs: SeriesResourceRefs): SeriesResourceRefs {
    for (const key of Object.keys(refs) as Array<keyof SeriesResourceRefs>) {
      refs[key] = Array.from(new Set<string>(refs[key]));
    }

    return refs;
  }

  public static emptyRefs(): SeriesResourceRefs {
    return {
      hostIds: [],
      hostNames: [],
      dockerHostIds: [],
      dockerHostNames: [],
      podmanHostIds: [],
      podmanHostNames: [],
      kubernetesClusterIds: [],
      kubernetesClusterNames: [],
      dockerSwarmClusterNames: [],
      proxmoxClusterNames: [],
      cephClusterNames: [],
      iotFleetNames: [],
      serviceIds: [],
      serviceNames: [],
    };
  }

  /*
   * True when the monitor's configuration names nothing at all — the
   * common case for the ~17 monitor types that have no resource
   * identity (Website, API, Ping, Synthetic, ...). Callers use it to
   * skip the lookup entirely so those monitors keep costing zero
   * database round-trips per evaluation.
   */
  public static isEmpty(refs: SeriesResourceRefs): boolean {
    return Object.values(refs).every((values: Array<string>): boolean => {
      return values.length === 0;
    });
  }
}

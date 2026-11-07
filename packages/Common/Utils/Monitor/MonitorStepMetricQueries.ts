import AggregationInterval from "../../Types/BaseDatabase/AggregationInterval";
import { AggregationIntervalUtil } from "../../Types/BaseDatabase/AggregationIntervalUtil";
import NotNull from "../../Types/BaseDatabase/NotNull";
import Wildcard from "../../Types/BaseDatabase/Wildcard";
import { escapeWildcards } from "../../Types/BaseDatabase/WildcardPattern";
import Dictionary from "../../Types/Dictionary";
import MetricFormulaConfigData from "../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../Types/Metrics/MetricQueryConfigData";
import MetricsViewConfig from "../../Types/Metrics/MetricsViewConfig";
import MonitorStep, { MonitorStepType } from "../../Types/Monitor/MonitorStep";
import MonitorStepCephMonitor from "../../Types/Monitor/MonitorStepCephMonitor";
import MonitorStepDockerMonitor from "../../Types/Monitor/MonitorStepDockerMonitor";
import MonitorStepDockerSwarmMonitor, {
  MonitorStepDockerSwarmMonitorUtil,
  SWARM_TASK_SERVICE_ATTRIBUTE,
} from "../../Types/Monitor/MonitorStepDockerSwarmMonitor";
import MonitorStepHostMonitor from "../../Types/Monitor/MonitorStepHostMonitor";
import MonitorStepIoTMonitor from "../../Types/Monitor/MonitorStepIoTMonitor";
import MonitorStepKubernetesMonitor, {
  MonitorStepKubernetesMonitorUtil,
} from "../../Types/Monitor/MonitorStepKubernetesMonitor";
import MonitorStepMetricMonitor, {
  MonitorStepMetricMonitorUtil,
} from "../../Types/Monitor/MonitorStepMetricMonitor";
import MonitorStepOpenStackMonitor, {
  OPENSTACK_CLOUD_RESOURCE_ATTRIBUTE,
  getOpenStackFilterAttributes,
} from "../../Types/Monitor/MonitorStepOpenStackMonitor";
import MonitorStepPodmanMonitor from "../../Types/Monitor/MonitorStepPodmanMonitor";
import MonitorStepProxmoxMonitor, {
  ProxmoxResourceScope,
} from "../../Types/Monitor/MonitorStepProxmoxMonitor";
import MonitorStepStorageArrayMonitor, {
  StorageArrayResourceFilters,
  StorageArrayResourceScope,
} from "../../Types/Monitor/MonitorStepStorageArrayMonitor";
import MonitorStepVMwareMonitor, {
  VMwareResourceFilters,
} from "../../Types/Monitor/MonitorStepVMwareMonitor";
import MonitorType from "../../Types/Monitor/MonitorType";
import { getOpenStackMetricByMetricName } from "../../Types/Monitor/OpenStackMetricCatalog";
import { getStorageArrayObjectLabel } from "../../Types/Monitor/StorageArrayMetricCatalog";
import RollingTime from "../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../Types/RollingTime/RollingTimeUtil";
import { canonicalizeEntityValue } from "../Telemetry/EntityKey";

/*
 * WHAT A METRIC-BACKED MONITOR STEP READS (issue #5759).
 *
 * A step keeps its queries as the person wrote them, but the worker
 * (MonitorTelemetryMonitor) does not read them as written: an
 * infrastructure monitor narrows every query to its host, cluster, vCenter,
 * array or fleet, and to the resource filters on the step. A chart of the
 * written queries alone would show every Proxmox cluster in the project on
 * the page of a monitor that watches one of them.
 *
 * This works out, from the step alone, the queries as the worker reads them:
 * each query with the attribute filters the worker reads it with - its own
 * and the ones the monitor adds - so a page can chart exactly what the
 * monitor evaluates. Pure and safe in the browser.
 *
 * It is a twin of the worker's own code, not a call into it (that reads the
 * database). MonitorStepMetricQueriesWorkerParity.test.ts (App) runs the
 * worker's monitor function of every type with its reads stood in for and
 * holds every query this says to what the worker says it read
 * (MetricMonitorResponse.queryAttributes), so the two cannot drift apart.
 */

/*
 * Map a VMware monitor step's resource filters onto the ClickHouse
 * attribute equalities the query runs with. The OpenTelemetry Collector
 * `vcenter` receiver stamps a vSphere object's identity as OTel RESOURCE
 * attributes (one OTLP resource per datacenter / cluster / host / VM /
 * datastore / resource pool), which OtelMetricsIngestService stores
 * `resource.`-prefixed — so, unlike pve-exporter's bare datapoint
 * labels, every key here carries the `resource.` prefix. The filters are
 * independent equalities (a host filter narrows to that ESXi host's own
 * series AND to the series of every VM it runs, because the receiver
 * stamps the parent host on VM resources; add `vmName` to target one VM).
 *
 * Read by the worker (which re-exports it for its tests) and by the
 * dashboard's charts of a monitor's metrics; the step-config identity path
 * (MonitorStepResourceIdentity) and the root-cause renderer
 * (MonitorCriteriaEvaluator.buildVMwareRootCauseContext) surface the same
 * fields, so they cannot drift apart.
 */
export const VMwareResourceFilterAttributeKeys: Record<
  keyof VMwareResourceFilters,
  string
> = {
  datacenterName: "resource.vcenter.datacenter.name",
  clusterName: "resource.vcenter.cluster.name",
  hostName: "resource.vcenter.host.name",
  vmName: "resource.vcenter.vm.name",
  datastoreName: "resource.vcenter.datastore.name",
  resourcePoolPath: "resource.vcenter.resource_pool.inventory_path",
};

export const applyVMwareResourceFilters: (input: {
  attributes: Dictionary<string>;
  resourceFilters: VMwareResourceFilters | undefined;
}) => void = (input: {
  attributes: Dictionary<string>;
  resourceFilters: VMwareResourceFilters | undefined;
}): void => {
  if (!input.resourceFilters) {
    return;
  }

  for (const filterKey of Object.keys(
    VMwareResourceFilterAttributeKeys,
  ) as Array<keyof VMwareResourceFilters>) {
    const filterValue: unknown = input.resourceFilters[filterKey];

    /*
     * `typeof` rather than truthiness: step JSON is not schema-checked,
     * so a filter written by the API or an import can be a number or an
     * object, and neither is an attribute equality ClickHouse can run.
     */
    if (typeof filterValue !== "string") {
      continue;
    }

    const trimmed: string = filterValue.trim();

    if (trimmed.length === 0) {
      continue;
    }

    input.attributes[VMwareResourceFilterAttributeKeys[filterKey]] = trimmed;
  }
};

/*
 * Map a Storage Array monitor step's resource filters onto the ClickHouse
 * attribute equalities the query runs with. Like ceph-mgr, Pure Storage
 * keeps object identity in DATAPOINT labels (stored unprefixed), and the
 * label differs per object and platform — a FlashArray volume or pod is
 * `name`, a host `host`, a hardware component `component_name`; every
 * FlashBlade object is `name` — so each filter resolves its label through
 * the catalog (getStorageArrayObjectLabel), with the query's metric name
 * for the few series that name their object differently (replica links
 * carry the pod as `local_pod`). Two filters that resolve to the same
 * label on one query cannot both hold; the later one in this map wins.
 *
 * Read by the worker (which re-exports it for its tests) and by the
 * dashboard's charts of a monitor's metrics; the root-cause renderer
 * (MonitorCriteriaEvaluator.buildStorageArrayRootCauseContext) surfaces the
 * same filters.
 */
export const StorageArrayResourceFilterScopes: Record<
  keyof StorageArrayResourceFilters,
  StorageArrayResourceScope
> = {
  volumeName: StorageArrayResourceScope.Volume,
  hostName: StorageArrayResourceScope.Host,
  podName: StorageArrayResourceScope.Pod,
  componentName: StorageArrayResourceScope.Hardware,
  fileSystemName: StorageArrayResourceScope.FileSystem,
  bucketName: StorageArrayResourceScope.Bucket,
};

export const applyStorageArrayResourceFilters: (input: {
  attributes: Dictionary<string>;
  resourceFilters: StorageArrayResourceFilters | undefined;
  storageSystem: string | undefined;
  metricName: string;
}) => void = (input: {
  attributes: Dictionary<string>;
  resourceFilters: StorageArrayResourceFilters | undefined;
  storageSystem: string | undefined;
  metricName: string;
}): void => {
  if (!input.resourceFilters || typeof input.resourceFilters !== "object") {
    return;
  }

  for (const filterKey of Object.keys(
    StorageArrayResourceFilterScopes,
  ) as Array<keyof StorageArrayResourceFilters>) {
    const filterValue: unknown = input.resourceFilters[filterKey];

    /*
     * `typeof` rather than truthiness: step JSON is not schema-checked,
     * so a filter written by the API or an import can be a number or an
     * object, and neither is an attribute equality ClickHouse can run.
     */
    if (typeof filterValue !== "string") {
      continue;
    }

    const trimmed: string = filterValue.trim();

    if (trimmed.length === 0) {
      continue;
    }

    const label: string | null = getStorageArrayObjectLabel(
      StorageArrayResourceFilterScopes[filterKey],
      input.storageSystem,
      input.metricName || undefined,
    );

    if (label) {
      input.attributes[label] = trimmed;
    }
  }
};

// The part of every metric-backed step's settings this reads.
export interface MetricMonitorStepSettings {
  metricViewConfig?: MetricsViewConfig | undefined;
  rollingTime?: RollingTime | undefined;
}

// A step's queries as its monitor reads them.
export interface MonitorStepMetricReads {
  /*
   * The step's queries, in order, each with the attribute filters the
   * worker reads it with in place of its own (none when it reads it with
   * none). Everything else about each query is as the step keeps it.
   */
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs: Array<MetricFormulaConfigData>;
  // How far back each check looks.
  rollingTime: RollingTime;
  /*
   * Each query is read as one value over its whole window
   * (MonitorStepMetricMonitor.aggregatesWholeWindow), not a value a minute.
   */
  aggregatesWholeWindow: boolean;
  /*
   * The telemetry services a Metrics step reads its metric for, by id
   * (MonitorStepMetricMonitor.telemetryServiceIds). The worker narrows by
   * the rows' service, which a metric chart's attribute filters cannot
   * say: a chart of these queries shows every service's series.
   */
  telemetryServiceIds: Array<string>;
}

interface ReadAttributesInput {
  settings: MetricMonitorStepSettings;
  queryConfig: MetricQueryConfigData;
  // The query's own attribute filters, copied: the map to add to.
  ownAttributes: Dictionary<string>;
  metricName: string;
}

type ReadAttributesFunction = (
  input: ReadAttributesInput,
) => Dictionary<unknown> | undefined;

/*
 * A query's own attribute filters, copied: what every monitor type starts
 * from. Empty when it has none, or when they are not a map.
 */
const getOwnAttributes: (
  queryConfig: MetricQueryConfigData,
) => Dictionary<string> = (
  queryConfig: MetricQueryConfigData,
): Dictionary<string> => {
  const attributes: unknown =
    queryConfig.metricQueryData?.filterData?.attributes;

  if (
    !attributes ||
    typeof attributes !== "object" ||
    Array.isArray(attributes) ||
    Object.keys(attributes).length === 0
  ) {
    return {};
  }

  return { ...(attributes as Dictionary<string>) };
};

// The map handed over as the query's attributes: none when it is empty.
const orNothing: (
  attributes: Dictionary<unknown>,
) => Dictionary<unknown> | undefined = (
  attributes: Dictionary<unknown>,
): Dictionary<unknown> | undefined => {
  return Object.keys(attributes).length > 0 ? attributes : undefined;
};

/*
 * The resource a step names, as the worker filters on it. Before every
 * evaluation the worker reads the step's resource on its current value
 * (InfrastructureResourceBinding.normalize): a host name as ingest stores
 * it, trimmed and lowercased, so a step written "Web-01" (by Terraform,
 * say) still reads "web-01"; every other name trimmed.
 */
const getHostName: (value: unknown) => string = (value: unknown): string => {
  return typeof value === "string" ? canonicalizeEntityValue(value) : "";
};

const getIdentifier: (value: unknown) => string = (value: unknown): string => {
  return typeof value === "string" ? value.trim() : "";
};

const readMetrics: ReadAttributesFunction = (
  input: ReadAttributesInput,
): Dictionary<unknown> | undefined => {
  // A Metrics monitor reads each query with its own filters, as written.
  const attributes: unknown =
    input.queryConfig.metricQueryData?.filterData?.attributes;

  return attributes &&
    typeof attributes === "object" &&
    Object.keys(attributes).length > 0
    ? (attributes as Dictionary<unknown>)
    : undefined;
};

const readKubernetes: ReadAttributesFunction = (
  input: ReadAttributesInput,
): Dictionary<unknown> | undefined => {
  const settings: MonitorStepKubernetesMonitor =
    input.settings as MonitorStepKubernetesMonitor;
  const attributes: Dictionary<string> = input.ownAttributes;

  const clusterName: string = getIdentifier(settings.clusterIdentifier);

  if (clusterName) {
    attributes["resource.k8s.cluster.name"] = clusterName;
  }

  if (settings.resourceFilters) {
    if (settings.resourceFilters.namespace) {
      attributes["resource.k8s.namespace.name"] =
        settings.resourceFilters.namespace;
    }

    if (settings.resourceFilters.nodeName) {
      attributes["resource.k8s.node.name"] = settings.resourceFilters.nodeName;
    }

    if (settings.resourceFilters.podName) {
      attributes["resource.k8s.pod.name"] = settings.resourceFilters.podName;
    }

    const workloadNameAttributeKey: string | null =
      MonitorStepKubernetesMonitorUtil.getWorkloadNameAttributeKey(
        settings.resourceFilters,
      );

    if (workloadNameAttributeKey && settings.resourceFilters.workloadName) {
      attributes[workloadNameAttributeKey] =
        settings.resourceFilters.workloadName.trim();
    }
  }

  /*
   * The worker also leaves out the pods that finished in the window
   * (KubernetesFinishedPods), a list it reads per check; a chart over
   * hours showing their history does no harm. It says it read the query
   * with the rest - even when that is nothing.
   */
  return attributes;
};

const readContainers: (
  input: ReadAttributesInput,
  runtime: string,
) => Dictionary<unknown> | undefined = (
  input: ReadAttributesInput,
  runtime: string,
): Dictionary<unknown> | undefined => {
  const settings: MonitorStepDockerMonitor | MonitorStepPodmanMonitor =
    input.settings as MonitorStepDockerMonitor | MonitorStepPodmanMonitor;
  const attributes: Dictionary<string> = input.ownAttributes;
  const hostName: string = getHostName(settings.hostIdentifier);

  if (hostName) {
    attributes["resource.host.name"] = hostName;
  }

  attributes["resource.container.runtime"] = runtime;

  if (settings.containerFilters) {
    if (settings.containerFilters.containerName) {
      attributes["resource.container.name"] =
        settings.containerFilters.containerName;
    }

    if (settings.containerFilters.containerImage) {
      attributes["resource.container.image.name"] =
        settings.containerFilters.containerImage;
    }
  }

  return orNothing(attributes);
};

const readHost: ReadAttributesFunction = (
  input: ReadAttributesInput,
): Dictionary<unknown> | undefined => {
  const settings: MonitorStepHostMonitor =
    input.settings as MonitorStepHostMonitor;
  const attributes: Dictionary<string> = input.ownAttributes;
  const hostName: string = getHostName(settings.hostIdentifier);

  // Host-level series: no container filters, unlike Docker and Podman.
  if (hostName) {
    attributes["resource.host.name"] = hostName;
  }

  return orNothing(attributes);
};

const readProxmox: ReadAttributesFunction = (
  input: ReadAttributesInput,
): Dictionary<unknown> | undefined => {
  const settings: MonitorStepProxmoxMonitor =
    input.settings as MonitorStepProxmoxMonitor;
  const attributes: Dictionary<string> = input.ownAttributes;

  const clusterName: string = getIdentifier(settings.clusterIdentifier);

  if (clusterName) {
    attributes["resource.proxmox.cluster.name"] = clusterName;
  }

  if (settings.resourceFilters) {
    const filters: MonitorStepProxmoxMonitor["resourceFilters"] =
      settings.resourceFilters;

    // An exact guest id wins; a node name scopes to the node's own series.
    if (filters.guestId) {
      attributes["id"] = filters.guestId;
    } else if (filters.nodeName) {
      attributes["pve.scope"] = ProxmoxResourceScope.Node;
      attributes["pve.id"] = filters.nodeName;
    } else {
      if (filters.scope) {
        attributes["pve.scope"] = filters.scope;
      }

      if (filters.pveId) {
        attributes["pve.id"] = filters.pveId;
      }
    }
  }

  return orNothing(attributes);
};

const readOpenStack: ReadAttributesFunction = (
  input: ReadAttributesInput,
): Dictionary<unknown> | undefined => {
  const settings: MonitorStepOpenStackMonitor =
    input.settings as MonitorStepOpenStackMonitor;
  const attributes: Dictionary<string> = input.ownAttributes;

  const cloudName: string = getIdentifier(settings.cloudIdentifier);

  if (cloudName) {
    attributes[OPENSTACK_CLOUD_RESOURCE_ATTRIBUTE] = cloudName;
  }

  // Each filter is equality on the label this series spells it with.
  Object.assign(
    attributes,
    getOpenStackFilterAttributes({
      resourceFilters: settings.resourceFilters,
      seriesLabels: getOpenStackMetricByMetricName(input.metricName)
        ?.identityAttributes,
    }),
  );

  return orNothing(attributes);
};

const readVMware: ReadAttributesFunction = (
  input: ReadAttributesInput,
): Dictionary<unknown> | undefined => {
  const settings: MonitorStepVMwareMonitor =
    input.settings as MonitorStepVMwareMonitor;
  const attributes: Dictionary<string> = input.ownAttributes;

  const vcenterName: string = getIdentifier(settings.vcenterIdentifier);

  if (vcenterName) {
    attributes["resource.vmware.vcenter.name"] = vcenterName;
  }

  applyVMwareResourceFilters({
    attributes: attributes,
    resourceFilters: settings.resourceFilters,
  });

  return orNothing(attributes);
};

const readCeph: ReadAttributesFunction = (
  input: ReadAttributesInput,
): Dictionary<unknown> | undefined => {
  const settings: MonitorStepCephMonitor =
    input.settings as MonitorStepCephMonitor;
  const attributes: Dictionary<string> = input.ownAttributes;

  const clusterName: string = getIdentifier(settings.clusterIdentifier);

  if (clusterName) {
    attributes["resource.ceph.cluster.name"] = clusterName;
  }

  if (settings.resourceFilters) {
    if (settings.resourceFilters.osdId) {
      attributes["ceph_daemon"] = settings.resourceFilters.osdId;
    }

    if (settings.resourceFilters.poolId) {
      attributes["pool_id"] = settings.resourceFilters.poolId;
    }
  }

  return orNothing(attributes);
};

const readStorageArray: ReadAttributesFunction = (
  input: ReadAttributesInput,
): Dictionary<unknown> | undefined => {
  const settings: MonitorStepStorageArrayMonitor =
    input.settings as MonitorStepStorageArrayMonitor;
  const attributes: Dictionary<string> = input.ownAttributes;

  const arrayName: string = getIdentifier(settings.arrayIdentifier);

  if (arrayName) {
    attributes["resource.storage.array.name"] = arrayName;
  }

  applyStorageArrayResourceFilters({
    attributes: attributes,
    resourceFilters: settings.resourceFilters,
    storageSystem: settings.storageSystem,
    metricName: input.metricName,
  });

  return orNothing(attributes);
};

const readIoT: ReadAttributesFunction = (
  input: ReadAttributesInput,
): Dictionary<unknown> | undefined => {
  const settings: MonitorStepIoTMonitor =
    input.settings as MonitorStepIoTMonitor;
  const attributes: Dictionary<string> = input.ownAttributes;

  const fleetIdentifier: string = getIdentifier(settings.fleetIdentifier);

  if (fleetIdentifier) {
    attributes["resource.iot.fleet.name"] = fleetIdentifier;
  }

  // A saved Resource Scope is read and ignored, as the worker does.
  if (settings.resourceFilters) {
    if (settings.resourceFilters.deviceId) {
      attributes["device.id"] = settings.resourceFilters.deviceId;
    }

    if (settings.resourceFilters.deviceType) {
      attributes["iot.device.type"] = settings.resourceFilters.deviceType;
    }
  }

  if (Object.keys(attributes).length === 0) {
    return undefined;
  }

  /*
   * The fleet matches whatever its case (a fleet is found by name case
   * aside, and its devices keep the case they publish with): a Wildcard of
   * the escaped name is a case-insensitive exact match.
   */
  const fleetName: unknown = attributes["resource.iot.fleet.name"];
  const trimmedFleetName: string =
    typeof fleetName === "string" ? fleetName.trim() : "";

  return trimmedFleetName
    ? {
        ...attributes,
        "resource.iot.fleet.name": new Wildcard<string>([
          escapeWildcards(trimmedFleetName),
        ]),
      }
    : attributes;
};

const readDockerSwarm: ReadAttributesFunction = (
  input: ReadAttributesInput,
): Dictionary<unknown> | undefined => {
  const settings: MonitorStepDockerSwarmMonitor =
    input.settings as MonitorStepDockerSwarmMonitor;
  const attributes: Dictionary<string> = input.ownAttributes;

  const clusterName: string = getIdentifier(settings.clusterIdentifier);

  if (clusterName) {
    attributes["resource.docker.swarm.cluster.name"] = clusterName;
  }

  let containerImageGlobs: Array<string> = [];

  if (settings.resourceFilters) {
    const filters: MonitorStepDockerSwarmMonitor["resourceFilters"] =
      settings.resourceFilters;

    if (filters.containerName) {
      attributes["resource.container.name"] = filters.containerName;
    }

    if (filters.containerImage) {
      containerImageGlobs =
        MonitorStepDockerSwarmMonitorUtil.getContainerImageGlobs(
          filters.containerImage,
        );

      if (containerImageGlobs.length > 0) {
        attributes["resource.container.image.name"] = filters.containerImage;
      }
    }

    if (filters.nodeName) {
      attributes["resource.docker.swarm.node.name"] = filters.nodeName;
    }

    if (filters.serviceName) {
      attributes["resource.docker.swarm.service.name"] = filters.serviceName;
    }
  }

  // Swarm tasks only, unless a service is named, which scopes to tasks.
  const isTasksOnly: boolean = Boolean(
    settings.resourceFilters?.tasksOnly &&
      !settings.resourceFilters?.serviceName,
  );

  if (Object.keys(attributes).length === 0 && !isTasksOnly) {
    return undefined;
  }

  return {
    ...attributes,
    // With or without the digest Swarm pins a task's image to.
    ...(containerImageGlobs.length > 0
      ? {
          "resource.container.image.name": new Wildcard<string>(
            containerImageGlobs,
          ),
        }
      : {}),
    ...(isTasksOnly ? { [SWARM_TASK_SERVICE_ATTRIBUTE]: new NotNull() } : {}),
  };
};

interface MetricBackedMonitorType {
  // Where the type keeps its step settings.
  stepKey: keyof MonitorStepType;
  // The twin of the attribute building in its worker function.
  read: ReadAttributesFunction;
}

/*
 * Every metric-backed monitor type, read as the worker reads it: the
 * settings under the monitor's type (not whichever key happens to be set),
 * each query with what its worker function (monitorHost, monitorDocker,
 * ...) adds to it.
 */
const METRIC_BACKED_TYPES: Partial<Record<MonitorType, MetricBackedMonitorType>> =
  {
    [MonitorType.Metrics]: { stepKey: "metricMonitor", read: readMetrics },
    [MonitorType.Kubernetes]: {
      stepKey: "kubernetesMonitor",
      read: readKubernetes,
    },
    [MonitorType.Docker]: {
      stepKey: "dockerMonitor",
      read: (input: ReadAttributesInput): Dictionary<unknown> | undefined => {
        return readContainers(input, "docker");
      },
    },
    [MonitorType.Host]: { stepKey: "hostMonitor", read: readHost },
    [MonitorType.Podman]: {
      stepKey: "podmanMonitor",
      read: (input: ReadAttributesInput): Dictionary<unknown> | undefined => {
        return readContainers(input, "podman");
      },
    },
    [MonitorType.DockerSwarm]: {
      stepKey: "dockerSwarmMonitor",
      read: readDockerSwarm,
    },
    [MonitorType.Proxmox]: { stepKey: "proxmoxMonitor", read: readProxmox },
    [MonitorType.OpenStack]: {
      stepKey: "openstackMonitor",
      read: readOpenStack,
    },
    [MonitorType.VMware]: { stepKey: "vmwareMonitor", read: readVMware },
    [MonitorType.Ceph]: { stepKey: "cephMonitor", read: readCeph },
    [MonitorType.StorageArray]: {
      stepKey: "storageArrayMonitor",
      read: readStorageArray,
    },
    [MonitorType.IoTDevice]: { stepKey: "iotMonitor", read: readIoT },
  };

export default class MonitorStepMetricQueries {
  // The monitor types this reads the steps of: every metric-backed one.
  public static getMonitorTypes(): Array<MonitorType> {
    return Object.keys(METRIC_BACKED_TYPES) as Array<MonitorType>;
  }

  // Where a monitor type keeps its step settings; null for one it cannot read.
  public static getStepKey(
    monitorType: MonitorType | undefined | null,
  ): keyof MonitorStepType | null {
    return (monitorType && METRIC_BACKED_TYPES[monitorType]?.stepKey) || null;
  }

  /*
   * The step's settings under its monitor type, or null when the step has
   * none (a step of another monitor type, or one that was never set up).
   */
  public static getSettings(input: {
    monitorType: MonitorType | undefined | null;
    monitorStep: MonitorStep | undefined | null;
  }): MetricMonitorStepSettings | null {
    const stepKey: keyof MonitorStepType | null =
      MonitorStepMetricQueries.getStepKey(input.monitorType);

    if (!stepKey) {
      return null;
    }

    const settings: unknown = (
      input.monitorStep?.data as Record<string, unknown> | undefined
    )?.[stepKey];

    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      return null;
    }

    return settings as MetricMonitorStepSettings;
  }

  /*
   * What the worker reads one of the step's queries with: the query's own
   * attribute filters and the ones its monitor type adds. Undefined when it
   * reads the query with none, which is how the worker says it too.
   */
  public static getReadAttributes(input: {
    monitorType: MonitorType | undefined | null;
    settings: MetricMonitorStepSettings;
    queryConfig: MetricQueryConfigData;
  }): Dictionary<unknown> | undefined {
    const read: ReadAttributesFunction | undefined = input.monitorType
      ? METRIC_BACKED_TYPES[input.monitorType]?.read
      : undefined;

    if (!read) {
      return undefined;
    }

    const metricName: unknown =
      input.queryConfig.metricQueryData?.filterData?.metricName;

    return read({
      settings: input.settings,
      queryConfig: input.queryConfig,
      ownAttributes: getOwnAttributes(input.queryConfig),
      metricName: typeof metricName === "string" ? metricName : "",
    });
  }

  /*
   * The step's queries as its monitor reads them, or null when the step is
   * not a metric-backed one of this monitor type.
   */
  public static getReads(input: {
    monitorType: MonitorType | undefined | null;
    monitorStep: MonitorStep | undefined | null;
  }): MonitorStepMetricReads | null {
    const settings: MetricMonitorStepSettings | null =
      MonitorStepMetricQueries.getSettings(input);

    if (!settings) {
      return null;
    }

    // Array-shaped whatever the stored JSON holds (see getMetricViewConfig).
    const metricViewConfig: MetricsViewConfig =
      MonitorStepMetricMonitorUtil.getMetricViewConfig(
        settings as MonitorStepMetricMonitor,
      );

    const queryConfigs: Array<MetricQueryConfigData> =
      metricViewConfig.queryConfigs
        .filter((queryConfig: MetricQueryConfigData): boolean => {
          return Boolean(queryConfig && typeof queryConfig === "object");
        })
        .map((queryConfig: MetricQueryConfigData): MetricQueryConfigData => {
          return MonitorStepMetricQueries.withAttributes(
            queryConfig,
            MonitorStepMetricQueries.getReadAttributes({
              monitorType: input.monitorType,
              settings: settings,
              queryConfig: queryConfig,
            }),
          );
        });

    const metricMonitor: MonitorStepMetricMonitor | undefined =
      input.monitorType === MonitorType.Metrics
        ? (settings as MonitorStepMetricMonitor)
        : undefined;

    const telemetryServiceIds: unknown = metricMonitor?.telemetryServiceIds;

    return {
      queryConfigs: queryConfigs,
      formulaConfigs: metricViewConfig.formulaConfigs.filter(
        (formulaConfig: MetricFormulaConfigData): boolean => {
          return Boolean(formulaConfig && typeof formulaConfig === "object");
        },
      ),
      rollingTime: settings.rollingTime || RollingTime.Past1Minute,
      aggregatesWholeWindow:
        MonitorStepMetricMonitorUtil.aggregatesWholeWindow(metricMonitor),
      telemetryServiceIds: (Array.isArray(telemetryServiceIds)
        ? telemetryServiceIds
        : []
      )
        .map((serviceId: unknown): string => {
          return serviceId ? String(serviceId) : "";
        })
        .filter((serviceId: string): boolean => {
          return serviceId !== "";
        }),
    };
  }

  /*
   * How long a stretch each value the monitor compares covers: the bucket
   * the worker reads its rolling window at (a minute, for a window of up to
   * three hours), or the whole window for a step that reads it as one value.
   */
  public static getEvaluationInterval(
    reads: Pick<MonitorStepMetricReads, "rollingTime" | "aggregatesWholeWindow">,
  ): AggregationInterval {
    if (reads.aggregatesWholeWindow) {
      return AggregationInterval.Total;
    }

    const windowInMs: number = RollingTimeUtil.getWindowInMs(
      reads.rollingTime || RollingTime.Past1Minute,
    );

    return AggregationIntervalUtil.getAggregationIntervalForWindow({
      startDate: new Date(0),
      endDate: new Date(windowInMs > 0 ? windowInMs : 60 * 1000),
    });
  }

  // A copy of the query that reads with these attributes, and only these.
  private static withAttributes(
    queryConfig: MetricQueryConfigData,
    attributes: Dictionary<unknown> | undefined,
  ): MetricQueryConfigData {
    const metricQueryData: MetricQueryConfigData["metricQueryData"] =
      queryConfig.metricQueryData ||
      ({ filterData: {} } as unknown as MetricQueryConfigData["metricQueryData"]);
    const filterData: Record<string, unknown> = {
      ...((metricQueryData.filterData as unknown as
        | Record<string, unknown>
        | undefined) || {}),
    };

    if (attributes && Object.keys(attributes).length > 0) {
      filterData["attributes"] = attributes;
    } else {
      delete filterData["attributes"];
    }

    return {
      ...queryConfig,
      metricQueryData: {
        ...metricQueryData,
        filterData:
          filterData as unknown as MetricQueryConfigData["metricQueryData"]["filterData"],
      },
    };
  }
}

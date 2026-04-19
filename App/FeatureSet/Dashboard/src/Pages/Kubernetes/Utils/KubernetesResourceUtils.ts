import Metric from "Common/Models/AnalyticsModels/Metric";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import OneUptimeDate from "Common/Types/Date";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Dictionary from "Common/Types/Dictionary";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import KubernetesResourceModel from "Common/Models/DatabaseModels/KubernetesResource";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";

export interface KubernetesResource {
  name: string;
  namespace: string;
  cpuUtilization: number | null;
  memoryUsageBytes: number | null;
  memoryLimitBytes: number | null;
  status: string;
  age: string;
  additionalAttributes: Record<string, string>;
}

export interface FetchResourceListOptions {
  clusterIdentifier: string;
  metricName: string;
  resourceNameAttribute: string;
  namespaceAttribute?: string;
  additionalAttributes?: Array<string>;
  filterAttributes?: Dictionary<string>;
  hoursBack?: number;
}

export default class KubernetesResourceUtils {
  public static async fetchResourceList(
    options: FetchResourceListOptions,
  ): Promise<Array<KubernetesResource>> {
    const {
      clusterIdentifier,
      metricName,
      resourceNameAttribute,
      namespaceAttribute = "resource.k8s.namespace.name",
      additionalAttributes = [],
      filterAttributes = {},
      hoursBack = 24,
    } = options;

    const endDate: Date = OneUptimeDate.getCurrentDate();
    const startDate: Date = OneUptimeDate.addRemoveHours(endDate, -hoursBack);

    const cpuResult: AggregatedResult = await AnalyticsModelAPI.aggregate({
      modelType: Metric,
      aggregateBy: {
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!,
          time: new InBetween(startDate, endDate),
          name: metricName,
          attributes: {
            "resource.k8s.cluster.name": clusterIdentifier,
            ...filterAttributes,
          } as Dictionary<string | number | boolean>,
        },
        aggregationType: MetricsAggregationType.Avg,
        aggregateColumnName: "value",
        aggregationTimestampColumnName: "time",
        startTimestamp: startDate,
        endTimestamp: endDate,
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        groupBy: {
          attributes: true,
        },
      },
    });

    const resourceMap: Map<string, KubernetesResource> = new Map();

    for (const dataPoint of cpuResult.data) {
      const attributes: Record<string, unknown> =
        (dataPoint["attributes"] as Record<string, unknown>) || {};

      const resourceName: string =
        (attributes[resourceNameAttribute] as string) || "";

      if (!resourceName) {
        continue;
      }

      const namespace: string =
        (attributes[namespaceAttribute] as string) || "";

      const key: string = `${namespace}/${resourceName}`;

      if (!resourceMap.has(key)) {
        const additionalAttrs: Record<string, string> = {};

        for (const attr of additionalAttributes) {
          additionalAttrs[attr] = (attributes[attr] as string) || "";
        }

        resourceMap.set(key, {
          name: resourceName,
          namespace: namespace,
          cpuUtilization: dataPoint.value ?? null,
          memoryUsageBytes: null,
          memoryLimitBytes: null,
          status: "",
          age: "",
          additionalAttributes: additionalAttrs,
        });
      }
    }

    return Array.from(resourceMap.values()).sort(
      (a: KubernetesResource, b: KubernetesResource) => {
        const nsCompare: number = a.namespace.localeCompare(b.namespace);
        if (nsCompare !== 0) {
          return nsCompare;
        }
        return a.name.localeCompare(b.name);
      },
    );
  }

  public static async fetchResourceListWithMemory(
    options: FetchResourceListOptions & { memoryMetricName: string },
  ): Promise<Array<KubernetesResource>> {
    const resources: Array<KubernetesResource> =
      await KubernetesResourceUtils.fetchResourceList(options);

    const endDate: Date = OneUptimeDate.getCurrentDate();
    const startDate: Date = OneUptimeDate.addRemoveHours(
      endDate,
      -(options.hoursBack || 1),
    );

    try {
      const memoryResult: AggregatedResult = await AnalyticsModelAPI.aggregate({
        modelType: Metric,
        aggregateBy: {
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            time: new InBetween(startDate, endDate),
            name: options.memoryMetricName,
            attributes: {
              "resource.k8s.cluster.name": options.clusterIdentifier,
              ...(options.filterAttributes || {}),
            } as Dictionary<string | number | boolean>,
          },
          aggregationType: MetricsAggregationType.Avg,
          aggregateColumnName: "value",
          aggregationTimestampColumnName: "time",
          startTimestamp: startDate,
          endTimestamp: endDate,
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          groupBy: {
            attributes: true,
          },
        },
      });

      const memoryMap: Map<string, number> = new Map();

      for (const dataPoint of memoryResult.data) {
        const attributes: Record<string, unknown> =
          (dataPoint["attributes"] as Record<string, unknown>) || {};
        const resourceName: string =
          (attributes[options.resourceNameAttribute] as string) || "";
        const namespace: string =
          (attributes[
            options.namespaceAttribute || "resource.k8s.namespace.name"
          ] as string) || "";
        const key: string = `${namespace}/${resourceName}`;

        if (resourceName && !memoryMap.has(key)) {
          memoryMap.set(key, dataPoint.value ?? 0);
        }
      }

      for (const resource of resources) {
        const key: string = `${resource.namespace}/${resource.name}`;
        const memValue: number | undefined = memoryMap.get(key);
        if (memValue !== undefined) {
          resource.memoryUsageBytes = memValue;
        }
      }
    } catch {
      // Memory data is optional, don't fail if not available
    }

    return resources;
  }

  public static formatAge(creationTimestamp: string | undefined): string {
    if (!creationTimestamp) {
      return "N/A";
    }
    const created: Date = new Date(creationTimestamp);
    const now: Date = new Date();
    const diffMs: number = now.getTime() - created.getTime();
    const diffSec: number = Math.floor(diffMs / 1000);

    if (diffSec < 60) {
      return `${diffSec}s`;
    }
    const diffMin: number = Math.floor(diffSec / 60);
    if (diffMin < 60) {
      return `${diffMin}m`;
    }
    const diffHours: number = Math.floor(diffMin / 60);
    if (diffHours < 24) {
      return `${diffHours}h`;
    }
    const diffDays: number = Math.floor(diffHours / 24);
    if (diffDays < 30) {
      return `${diffDays}d`;
    }
    const diffMonths: number = Math.floor(diffDays / 30);
    return `${diffMonths}mo`;
  }

  public static formatCpuValue(value: number | null): string {
    if (value === null || value === undefined) {
      return "N/A";
    }
    return `${value.toFixed(1)}%`;
  }

  public static formatMemoryValue(bytes: number | null): string {
    if (bytes === null || bytes === undefined) {
      return "N/A";
    }

    if (bytes < 1024) {
      return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }

    if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  public static formatBytesForChart(value: number): string {
    if (value === null || value === undefined) {
      return "N/A";
    }

    const absValue: number = Math.abs(value);

    if (absValue < 1024) {
      return `${value.toFixed(0)} B`;
    }

    if (absValue < 1024 * 1024) {
      return `${(value / 1024).toFixed(1)} KB`;
    }

    if (absValue < 1024 * 1024 * 1024) {
      return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    }

    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  public static formatBytesPerSecForChart(value: number): string {
    if (value === null || value === undefined) {
      return "N/A";
    }

    const absValue: number = Math.abs(value);

    if (absValue < 1024) {
      return `${value.toFixed(0)} B/s`;
    }

    if (absValue < 1024 * 1024) {
      return `${(value / 1024).toFixed(1)} KB/s`;
    }

    if (absValue < 1024 * 1024 * 1024) {
      return `${(value / (1024 * 1024)).toFixed(1)} MB/s`;
    }

    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB/s`;
  }

  /**
   * Fetch the list of Kubernetes resources of a given kind from the
   * Postgres inventory table (KubernetesResource).
   *
   * This is the authoritative source for "what exists in the cluster
   * right now" — populated by the k8sobjects snapshot stream. Use
   * this for list views so the page matches the sidebar badge.
   *
   * For CPU/memory columns, enrich the returned resources with metric
   * data via a separate call — metrics cover recent activity and
   * won't exist for every namespace/pod.
   */
  public static async fetchInventoryResources(options: {
    kubernetesClusterId: ObjectID;
    kind: string;
    transform?: (
      resource: KubernetesResource,
      row: KubernetesResourceModel,
    ) => void;
  }): Promise<Array<KubernetesResource>> {
    const result: ListResult<KubernetesResourceModel> =
      await ModelAPI.getList<KubernetesResourceModel>({
        modelType: KubernetesResourceModel,
        query: {
          kubernetesClusterId: options.kubernetesClusterId,
          kind: options.kind,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        select: {
          name: true,
          namespaceKey: true,
          phase: true,
          isReady: true,
          spec: true,
          status: true,
          ownerReferences: true,
          resourceCreationTimestamp: true,
        },
        sort: {
          namespaceKey: SortOrder.Ascending,
          name: SortOrder.Ascending,
        },
      });

    return result.data.map(
      (row: KubernetesResourceModel): KubernetesResource => {
        const statusObj: Record<string, unknown> =
          (row.status as unknown as Record<string, unknown>) || {};

        /*
         * Pick a display status by kind:
         *   - Pod: phase column (Running / Pending / ...)
         *   - Node: isReady → Ready / NotReady
         *   - Others: status.phase from the snapshot (Namespace.status.phase
         *     = "Active"; PV.status.phase = "Bound"), fallback to "".
         */
        let displayStatus: string = "";
        if (options.kind === "Pod") {
          displayStatus = row.phase || "";
        } else if (options.kind === "Node") {
          if (row.isReady === true) {
            displayStatus = "Ready";
          } else if (row.isReady === false) {
            displayStatus = "NotReady";
          }
        } else {
          const phaseVal: unknown = statusObj["phase"];
          if (typeof phaseVal === "string") {
            displayStatus = phaseVal;
          }
        }

        const creationTsIso: string | undefined = row.resourceCreationTimestamp
          ? OneUptimeDate.toString(row.resourceCreationTimestamp)
          : undefined;

        const resource: KubernetesResource = {
          name: row.name || "",
          namespace: row.namespaceKey || "",
          cpuUtilization: null,
          memoryUsageBytes: null,
          memoryLimitBytes: null,
          status: displayStatus,
          age: KubernetesResourceUtils.formatAge(creationTsIso),
          additionalAttributes: {},
        };

        if (options.transform) {
          try {
            options.transform(resource, row);
          } catch {
            // transform is best-effort enrichment; don't drop the row.
          }
        }

        return resource;
      },
    );
  }

  /**
   * Enrich a list of resources with CPU+memory values from ClickHouse
   * metrics. Rows without a recent metric stay at cpuUtilization=null
   * and memoryUsageBytes=null (rendered as "0%" / "N/A").
   *
   * resourceKey decides how a metric datapoint attaches to a row:
   *   - byName    : only match on resource.name
   *   - byNsAndName: match on `${namespace}/${name}` (default)
   */
  public static async enrichWithMetrics(options: {
    resources: Array<KubernetesResource>;
    clusterIdentifier: string;
    cpuMetricName: string;
    memoryMetricName: string;
    resourceNameAttribute: string;
    namespaceAttribute?: string;
    hoursBack?: number;
    resourceKey?: "byName" | "byNsAndName";
  }): Promise<void> {
    const {
      resources,
      clusterIdentifier,
      cpuMetricName,
      memoryMetricName,
      resourceNameAttribute,
      namespaceAttribute = "resource.k8s.namespace.name",
      hoursBack = 1,
      resourceKey = "byNsAndName",
    } = options;

    if (resources.length === 0) {
      return;
    }

    const endDate: Date = OneUptimeDate.getCurrentDate();
    const startDate: Date = OneUptimeDate.addRemoveHours(endDate, -hoursBack);

    const makeKey: (ns: string, name: string) => string = (
      ns: string,
      name: string,
    ): string => {
      return resourceKey === "byName" ? name : `${ns}/${name}`;
    };

    const fetchMap: (
      metricName: string,
    ) => Promise<Map<string, number>> = async (
      metricName: string,
    ): Promise<Map<string, number>> => {
      const map: Map<string, number> = new Map();
      try {
        const result: AggregatedResult = await AnalyticsModelAPI.aggregate({
          modelType: Metric,
          aggregateBy: {
            query: {
              projectId: ProjectUtil.getCurrentProjectId()!,
              time: new InBetween(startDate, endDate),
              name: metricName,
              attributes: {
                "resource.k8s.cluster.name": clusterIdentifier,
              } as Dictionary<string | number | boolean>,
            },
            aggregationType: MetricsAggregationType.Avg,
            aggregateColumnName: "value",
            aggregationTimestampColumnName: "time",
            startTimestamp: startDate,
            endTimestamp: endDate,
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            groupBy: {
              attributes: true,
            },
          },
        });
        for (const dp of result.data) {
          const attrs: Record<string, unknown> =
            (dp["attributes"] as Record<string, unknown>) || {};
          const name: string = (attrs[resourceNameAttribute] as string) || "";
          if (!name) {
            continue;
          }
          const ns: string = (attrs[namespaceAttribute] as string) || "";
          const key: string = makeKey(ns, name);
          if (!map.has(key)) {
            map.set(key, dp.value ?? 0);
          }
        }
      } catch {
        // Metrics are supplementary; leave the map empty on failure.
      }
      return map;
    };

    const [cpuMap, memMap]: [Map<string, number>, Map<string, number>] =
      await Promise.all([fetchMap(cpuMetricName), fetchMap(memoryMetricName)]);

    for (const resource of resources) {
      const key: string = makeKey(resource.namespace, resource.name);
      const cpu: number | undefined = cpuMap.get(key);
      if (cpu !== undefined) {
        resource.cpuUtilization = cpu;
      }
      const mem: number | undefined = memMap.get(key);
      if (mem !== undefined) {
        resource.memoryUsageBytes = mem;
      }
    }
  }
}

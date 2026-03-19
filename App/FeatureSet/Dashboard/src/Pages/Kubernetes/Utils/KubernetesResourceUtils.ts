import Metric from "Common/Models/AnalyticsModels/Metric";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import OneUptimeDate from "Common/Types/Date";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Dictionary from "Common/Types/Dictionary";

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
}

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
import URL from "Common/Types/API/URL";
import API from "Common/UI/Utils/API/API";
import { APP_API_URL } from "Common/UI/Config";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";

export interface PodMetricAggregate {
  cpuPercent: number;
  memoryBytes: number;
}

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
    /*
     * Normalize hoursBack here so both the CPU query (inside
     * fetchResourceList) and the memory query below scan the same
     * window. The previous default mismatch (24h for CPU, 1h for
     * memory) meant the two queries joined on fundamentally different
     * time ranges.
     */
    const hoursBack: number = options.hoursBack || 1;
    const endDate: Date = OneUptimeDate.getCurrentDate();
    const startDate: Date = OneUptimeDate.addRemoveHours(endDate, -hoursBack);

    /*
     * Fire CPU and memory aggregations in parallel. They're
     * independent ClickHouse queries; the old code awaited CPU before
     * starting memory, which doubled the round-trip cost.
     */
    const resourcesPromise: Promise<Array<KubernetesResource>> =
      KubernetesResourceUtils.fetchResourceList({ ...options, hoursBack });

    const memoryPromise: Promise<AggregatedResult | null> =
      (async (): Promise<AggregatedResult | null> => {
        try {
          return await AnalyticsModelAPI.aggregate({
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
        } catch {
          // Memory data is optional, don't fail if not available
          return null;
        }
      })();

    const [resources, memoryResult]: [
      Array<KubernetesResource>,
      AggregatedResult | null,
    ] = await Promise.all([resourcesPromise, memoryPromise]);

    if (memoryResult) {
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

  /*
   * Latest CPU/memory points older than this are treated as "no
   * data" by the list view so the bar chart doesn't lie about a
   * resource that's actually fallen off the metric stream.
   * Matches the cleanup worker's stale-resource cutoff.
   */
  private static readonly METRIC_STALE_MS: number = 15 * 60 * 1000;

  /**
   * Fetch the list of Kubernetes resources of a given kind from the
   * Postgres inventory table (KubernetesResource).
   *
   * This is the authoritative source for "what exists in the cluster
   * right now" — populated by the k8sobjects snapshot stream. Use
   * this for list views so the page matches the sidebar badge.
   *
   * Latest CPU and memory values are read directly off the same row
   * (latestCpuPercent / latestMemoryBytes), populated by the metric
   * ingest path. No ClickHouse round-trip needed.
   *
   * Pass `selectFullSpec: true` for pages that need spec/status
   * JSONB (e.g. Pods uses it to surface container count + waiting
   * reason). The default is a slim select.
   */
  public static async fetchInventoryResources(options: {
    kubernetesClusterId: ObjectID;
    kind: string;
    selectFullSpec?: boolean;
    transform?: (
      resource: KubernetesResource,
      row: KubernetesResourceModel,
    ) => void;
  }): Promise<Array<KubernetesResource>> {
    const select: Record<string, boolean> = {
      name: true,
      namespaceKey: true,
      phase: true,
      isReady: true,
      ownerReferences: true,
      resourceCreationTimestamp: true,
      latestCpuPercent: true,
      latestMemoryBytes: true,
      metricsUpdatedAt: true,
    };
    if (options.selectFullSpec) {
      select["spec"] = true;
      select["status"] = true;
    }

    const result: ListResult<KubernetesResourceModel> =
      await ModelAPI.getList<KubernetesResourceModel>({
        modelType: KubernetesResourceModel,
        query: {
          kubernetesClusterId: options.kubernetesClusterId,
          kind: options.kind,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        select: select,
        sort: {
          namespaceKey: SortOrder.Ascending,
          name: SortOrder.Ascending,
        },
      });

    const now: number = Date.now();
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

        // Stale-cutoff metric reads: render N/A rather than stale numbers.
        let cpu: number | null = null;
        let mem: number | null = null;
        if (row.metricsUpdatedAt) {
          const ageMs: number =
            now - new Date(row.metricsUpdatedAt as Date).getTime();
          if (ageMs <= KubernetesResourceUtils.METRIC_STALE_MS) {
            if (
              row.latestCpuPercent !== null &&
              row.latestCpuPercent !== undefined
            ) {
              cpu = Number(row.latestCpuPercent);
            }
            if (
              row.latestMemoryBytes !== null &&
              row.latestMemoryBytes !== undefined
            ) {
              mem = Number(row.latestMemoryBytes);
            }
          }
        }

        const resource: KubernetesResource = {
          name: row.name || "",
          namespace: row.namespaceKey || "",
          cpuUtilization: cpu,
          memoryUsageBytes: mem,
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
   * Fetch the per-namespace CPU/memory aggregates for the cluster.
   * Server-side computed from KubernetesResource snapshot rows
   * (kind=Pod) where metricsUpdatedAt is fresh. Drops the prior
   * ClickHouse `groupBy attributes` round-trip from the Namespaces
   * list view.
   */
  public static async fetchPodMetricsByNamespace(
    kubernetesClusterId: ObjectID,
  ): Promise<Map<string, PodMetricAggregate>> {
    const url: URL = URL.fromString(APP_API_URL.toString())
      .addRoute("/kubernetes-resource/latest-pod-metrics-by-namespace/")
      .addRoute(kubernetesClusterId.toString());
    const result: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
      {
        url,
        data: {},
        headers: { ...ModelAPI.getCommonHeaders() },
      },
    );
    return KubernetesResourceUtils.parseAggregatesResponse(result);
  }

  /**
   * Fetch CPU/memory aggregates by Pod ownerReferences[].name for a
   * given owner kind (e.g. "Deployment"). Powers the corresponding
   * list views.
   */
  public static async fetchPodMetricsByOwner(
    kubernetesClusterId: ObjectID,
    ownerKind: string,
  ): Promise<Map<string, PodMetricAggregate>> {
    const url: URL = URL.fromString(APP_API_URL.toString())
      .addRoute("/kubernetes-resource/latest-pod-metrics-by-owner/")
      .addRoute(kubernetesClusterId.toString())
      .addRoute(`/${encodeURIComponent(ownerKind)}`);
    const result: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
      {
        url,
        data: {},
        headers: { ...ModelAPI.getCommonHeaders() },
      },
    );
    return KubernetesResourceUtils.parseAggregatesResponse(result);
  }

  private static parseAggregatesResponse(
    result: HTTPResponse<JSONObject> | HTTPErrorResponse,
  ): Map<string, PodMetricAggregate> {
    const out: Map<string, PodMetricAggregate> = new Map();
    if (result instanceof HTTPErrorResponse) {
      return out;
    }
    const aggregates: Record<string, unknown> =
      (result.data?.["aggregates"] as Record<string, unknown>) || {};
    for (const key of Object.keys(aggregates)) {
      const v: Record<string, unknown> = (aggregates[key] || {}) as Record<
        string,
        unknown
      >;
      const cpu: number =
        typeof v["cpuPercent"] === "number"
          ? (v["cpuPercent"] as number)
          : parseInt((v["cpuPercent"] as string) || "0", 10) || 0;
      const memRaw: unknown = v["memoryBytes"];
      const mem: number =
        typeof memRaw === "number"
          ? memRaw
          : parseInt((memRaw as string) || "0", 10) || 0;
      out.set(key, { cpuPercent: cpu, memoryBytes: mem });
    }
    return out;
  }

  /**
   * Apply pre-aggregated CPU/memory values onto the list resources by
   * matching on resource.name. Used by Namespace/Deployment/etc. list
   * views in place of the ClickHouse `enrichWithMetrics` path.
   */
  public static applyAggregateMetrics(options: {
    resources: Array<KubernetesResource>;
    aggregates: Map<string, PodMetricAggregate>;
  }): void {
    for (const resource of options.resources) {
      const agg: PodMetricAggregate | undefined = options.aggregates.get(
        resource.name,
      );
      if (!agg) {
        continue;
      }
      resource.cpuUtilization = agg.cpuPercent;
      resource.memoryUsageBytes = agg.memoryBytes;
    }
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

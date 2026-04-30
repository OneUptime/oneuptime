import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import OTelIngestService, {
  OtelAggregationTemporality,
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import {
  MetricPointType,
  ServiceType,
} from "Common/Models/AnalyticsModels/Metric";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import TelemetryUtil, {
  AttributeType,
} from "Common/Server/Utils/Telemetry/Telemetry";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import logger, {
  getLogAttributesFromRequest,
  type RequestLike,
} from "Common/Server/Utils/Logger";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import Service from "Common/Models/DatabaseModels/Service";
import MetricsQueueService from "./Queue/MetricsQueueService";
import OtelIngestBaseService from "./OtelIngestBaseService";
import { TELEMETRY_METRIC_FLUSH_BATCH_SIZE } from "../Config";
import MetricPipelineRuleService, {
  MetricRulesForProject,
} from "./MetricPipelineRuleService";
import OneUptimeDate from "Common/Types/Date";
import MetricService from "Common/Server/Services/MetricService";
import Text from "Common/Types/Text";
import KubernetesResourceService, {
  ResourceLatestMetric,
} from "Common/Server/Services/KubernetesResourceService";
import KubernetesContainerService, {
  ContainerLatestMetric,
} from "Common/Server/Services/KubernetesContainerService";

type MetricTimestamp = {
  nano: string;
  iso: string;
  db: string;
  date: Date;
};

/*
 * ------------------------------------------------------------------
 * Kubernetes snapshot metric write-back
 * ------------------------------------------------------------------
 *
 * The Kubernetes list pages (Pods, Nodes, Namespaces, ...) need a
 * "latest CPU + memory per resource" lookup that's fast and free of
 * ClickHouse aggregation. We achieve that by mirroring the most
 * recent point of a small allow-list of metrics into Postgres, on
 * the row that already represents that resource (KubernetesResource
 * for Pods/Nodes, KubernetesContainer for individual containers).
 *
 * Snapshot writes are best-effort: failures must never affect
 * ClickHouse ingest.
 *
 * Allow-list (lowercased) of metric names whose latest point we
 * mirror. Anything else is ignored entirely, so the cost on
 * non-Kubernetes batches is one Set.has check per datapoint.
 */
const K8S_SNAPSHOT_METRIC_NAMES: ReadonlySet<string> = new Set([
  "k8s.pod.cpu.utilization",
  "k8s.pod.memory.usage",
  "k8s.node.cpu.utilization",
  "k8s.node.memory.usage",
  "container.cpu.utilization",
  "container.memory.usage",
]);

interface ResourceMetricBufferEntry {
  kind: string;
  namespaceKey: string;
  name: string;
  cpuPercent: number | null;
  memoryBytes: number | null;
  observedAt: Date;
  controllerDeploymentName: string | null;
  controllerCronJobName: string | null;
}

interface ContainerMetricBufferEntry {
  podNamespaceKey: string;
  podName: string;
  name: string;
  cpuPercent: number | null;
  memoryBytes: number | null;
  observedAt: Date;
}

export default class OtelMetricsIngestService extends OtelIngestBaseService {
  private static async flushMetricsBuffer(
    metrics: Array<JSONObject>,
    force: boolean = false,
  ): Promise<void> {
    while (
      metrics.length >= TELEMETRY_METRIC_FLUSH_BATCH_SIZE ||
      (force && metrics.length > 0)
    ) {
      const batchSize: number = Math.min(
        metrics.length,
        TELEMETRY_METRIC_FLUSH_BATCH_SIZE,
      );
      const batch: Array<JSONObject> = metrics.splice(0, batchSize);

      if (batch.length === 0) {
        continue;
      }

      await MetricService.insertJsonRows(batch);
    }
  }

  @CaptureSpan()
  public static async ingestMetrics(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!(req as TelemetryRequest).projectId) {
        throw new BadRequestException(
          "Invalid request - projectId not found in request.",
        );
      }

      req.body = req.body?.toJSON ? req.body.toJSON() : req.body;

      Response.sendEmptySuccessResponse(req, res);

      await MetricsQueueService.addMetricIngestJob(req as TelemetryRequest);

      return;
    } catch (err) {
      return next(err);
    }
  }

  @CaptureSpan()
  public static async processMetricsFromQueue(
    req: ExpressRequest,
  ): Promise<void> {
    await this.processMetricsAsync(req);
  }

  @CaptureSpan()
  private static async processMetricsAsync(req: ExpressRequest): Promise<void> {
    try {
      const resourceMetrics: JSONArray = req.body[
        "resourceMetrics"
      ] as JSONArray;

      if (!resourceMetrics || !Array.isArray(resourceMetrics)) {
        logger.error(
          "Invalid resourceMetrics format in request body",
          getLogAttributesFromRequest(req as RequestLike),
        );
        throw new BadRequestException("Invalid resourceMetrics format");
      }

      const dbMetrics: Array<JSONObject> = [];
      const serviceDictionary: Dictionary<TelemetryServiceMetadata> = {};

      const metricNameServiceNameMap: Dictionary<MetricType> = {};
      let totalMetricsProcessed: number = 0;
      const projectId: ObjectID = (req as TelemetryRequest).projectId;

      /*
       * Snapshot buffers keyed by cluster ID. Inner maps key by the
       * unique tuple of the resource being tracked so multiple
       * datapoints across a batch collapse into a single UPDATE.
       */
      const k8sResourceMetricsBuffer: Map<
        string,
        Map<string, ResourceMetricBufferEntry>
      > = new Map();
      const k8sContainerMetricsBuffer: Map<
        string,
        Map<string, ContainerMetricBufferEntry>
      > = new Map();

      // Load project + service-scoped pipeline rules once per batch (60s cached).
      let pipelineRules: MetricRulesForProject | null = null;
      try {
        pipelineRules = await MetricPipelineRuleService.loadRules(projectId);
      } catch (err) {
        logger.warn(
          `Failed to load metric pipeline rules for project ${projectId.toString()}; skipping: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        pipelineRules = null;
      }

      let resourceMetricCounter: number = 0;
      for (const resourceMetric of resourceMetrics) {
        try {
          if (resourceMetricCounter % 25 === 0) {
            await Promise.resolve();
          }
          resourceMetricCounter++;
          const resourceAttributes_raw: JSONArray =
            ((resourceMetric["resource"] as JSONObject)?.[
              "attributes"
            ] as JSONArray) || [];

          const serviceName: string = await this.getServiceNameFromAttributes(
            req,
            resourceAttributes_raw,
          );

          // Auto-discover Kubernetes cluster from resource attributes
          const kubernetesClusterId: ObjectID | null =
            await this.autoDiscoverKubernetesCluster({
              projectId,
              attributes: resourceAttributes_raw,
            });

          // Auto-discover Docker host from resource attributes
          await this.autoDiscoverDockerHost({
            projectId,
            attributes: resourceAttributes_raw,
          });

          if (!serviceDictionary[serviceName]) {
            const service: {
              serviceId: ObjectID;
              dataRententionInDays: number;
            } = await OTelIngestService.telemetryServiceFromName({
              serviceName: serviceName,
              projectId: (req as TelemetryRequest).projectId,
            });

            serviceDictionary[serviceName] = {
              serviceName: serviceName,
              serviceId: service.serviceId,
              dataRententionInDays: service.dataRententionInDays,
            };
          }

          const serviceMetadata: TelemetryServiceMetadata =
            serviceDictionary[serviceName]!;

          const resourceAttributes: Dictionary<
            AttributeType | Array<AttributeType>
          > = {
            ...TelemetryUtil.getAttributesForServiceIdAndServiceName({
              serviceId: serviceMetadata.serviceId!,
              serviceName: serviceName,
            }),
            ...TelemetryUtil.getAttributes({
              items: resourceAttributes_raw,
              prefixKeysWithString: "resource",
            }),
          };
          const scopeMetrics: JSONArray = resourceMetric[
            "scopeMetrics"
          ] as JSONArray;

          if (!scopeMetrics || !Array.isArray(scopeMetrics)) {
            logger.warn(
              "Invalid scopeMetrics format, skipping resource metric",
            );
            continue;
          }

          let scopeMetricCounter: number = 0;
          for (const scopeMetric of scopeMetrics) {
            try {
              if (scopeMetricCounter % 50 === 0) {
                await Promise.resolve();
              }
              scopeMetricCounter++;
              const metrics: JSONArray = scopeMetric["metrics"] as JSONArray;

              if (!metrics || !Array.isArray(metrics)) {
                logger.warn("Invalid metrics format, skipping scope metric");
                continue;
              }

              let metricCounter: number = 0;
              for (const metric of metrics) {
                try {
                  if (metricCounter % 100 === 0) {
                    await Promise.resolve();
                  }
                  metricCounter++;
                  const metricName: string = (metric["name"] || "")
                    .toString()
                    .toLowerCase();
                  const metricDescription: string = metric[
                    "description"
                  ] as string;
                  const metricUnit: string = metric["unit"] as string;

                  if (metricName) {
                    if (!metricNameServiceNameMap[metricName]) {
                      metricNameServiceNameMap[metricName] = new MetricType();
                      metricNameServiceNameMap[metricName]!.name = metricName;
                      metricNameServiceNameMap[metricName]!.description =
                        metricDescription;
                      metricNameServiceNameMap[metricName]!.unit = metricUnit;
                      metricNameServiceNameMap[metricName]!.services = [];
                    }

                    if (
                      metricNameServiceNameMap[metricName]!.services!.filter(
                        (service: Service) => {
                          return (
                            service.id?.toString() ===
                            serviceMetadata.serviceId!.toString()
                          );
                        },
                      ).length === 0
                    ) {
                      const newService: Service = new Service();
                      newService.id = serviceMetadata.serviceId!;
                      metricNameServiceNameMap[metricName]!.services!.push(
                        newService,
                      );
                    }
                  }

                  const metricAttributes: Dictionary<
                    AttributeType | Array<AttributeType>
                  > = {
                    ...resourceAttributes,
                    ...TelemetryUtil.getAttributes({
                      items: (metric["attributes"] as JSONArray) || [],
                      prefixKeysWithString: "",
                    }),
                  };

                  if (
                    scopeMetric["scope"] &&
                    Object.keys(scopeMetric["scope"]).length > 0
                  ) {
                    const scopeAttributes: JSONObject = scopeMetric[
                      "scope"
                    ] as JSONObject;
                    for (const key of Object.keys(scopeAttributes)) {
                      metricAttributes[`scope.${key}`] = scopeAttributes[
                        key
                      ] as AttributeType;
                    }
                  }

                  /*
                   * Detect which of the five OTLP metric data shapes this
                   * point uses. The proto's `oneof data` ensures only one
                   * of these fields is populated. Anything else (a malformed
                   * row, or a future metric type we don't yet model) falls
                   * through to the warn branch below.
                   */
                  const metricTypeWrapper: JSONObject | undefined =
                    (metric["sum"] as JSONObject | undefined) ||
                    (metric["gauge"] as JSONObject | undefined) ||
                    (metric["histogram"] as JSONObject | undefined) ||
                    (metric["exponentialHistogram"] as
                      | JSONObject
                      | undefined) ||
                    (metric["summary"] as JSONObject | undefined);

                  const dataPoints: JSONArray | undefined = metricTypeWrapper?.[
                    "dataPoints"
                  ] as JSONArray | undefined;

                  if (dataPoints && Array.isArray(dataPoints)) {
                    const aggregationTemporality: OtelAggregationTemporality =
                      metricTypeWrapper?.[
                        "aggregationTemporality"
                      ] as OtelAggregationTemporality;

                    const isMonotonic: boolean | undefined =
                      metricTypeWrapper?.["isMonotonic"] as boolean | undefined;

                    const metricPointType: MetricPointType = metric["sum"]
                      ? MetricPointType.Sum
                      : metric["gauge"]
                        ? MetricPointType.Gauge
                        : metric["histogram"]
                          ? MetricPointType.Histogram
                          : metric["exponentialHistogram"]
                            ? MetricPointType.ExponentialHistogram
                            : MetricPointType.Summary;

                    for (const datapoint of dataPoints) {
                      try {
                        /*
                         * Mirror the latest CPU / memory point of a small
                         * allow-list of metrics into the Postgres snapshot
                         * table. Cheap fast-path: a Set.has check, then a
                         * few attribute reads. Pipeline rules below don't
                         * affect this — snapshots reflect actual cluster
                         * state regardless of long-term storage choices.
                         */
                        if (
                          kubernetesClusterId &&
                          K8S_SNAPSHOT_METRIC_NAMES.has(metricName)
                        ) {
                          this.bufferKubernetesSnapshotMetric({
                            clusterIdStr: kubernetesClusterId.toString(),
                            metricName,
                            metricUnit,
                            datapoint: datapoint as JSONObject,
                            metricAttributes,
                            resourceBuffer: k8sResourceMetricsBuffer,
                            containerBuffer: k8sContainerMetricsBuffer,
                          });
                        }

                        const metricRow: JSONObject = this.buildMetricRow({
                          datapoint: datapoint as JSONObject,
                          baseAttributes: metricAttributes,
                          projectId: projectId,
                          serviceId: serviceMetadata.serviceId!,
                          serviceName: serviceName,
                          metricName: metricName,
                          metricPointType: metricPointType,
                          aggregationTemporality: aggregationTemporality,
                          dataRententionInDays:
                            serviceMetadata.dataRententionInDays,
                          ...(typeof isMonotonic === "boolean"
                            ? { isMonotonic: isMonotonic }
                            : {}),
                        });

                        /*
                         * Apply user-defined pipeline rules (filter/drop/
                         * rename/redact/sample) before buffering for insert.
                         * null from applyRules means the row was dropped.
                         */
                        const transformed: JSONObject | null = pipelineRules
                          ? MetricPipelineRuleService.applyRules(
                              metricRow,
                              serviceMetadata.serviceId,
                              pipelineRules,
                            )
                          : metricRow;

                        if (transformed === null) {
                          continue;
                        }

                        dbMetrics.push(transformed);
                        totalMetricsProcessed++;

                        if (
                          dbMetrics.length >= TELEMETRY_METRIC_FLUSH_BATCH_SIZE
                        ) {
                          await this.flushMetricsBuffer(dbMetrics);
                        }
                      } catch (datapointError) {
                        logger.warn(
                          `Error processing metric datapoint: ${datapointError instanceof Error ? datapointError.message : String(datapointError)}`,
                        );
                      }
                    }
                  } else {
                    logger.warn(
                      `Unknown metric type or missing dataPoints for metric "${metricName}" (project ${projectId.toString()}, service ${serviceName}). Recognized OTLP types: sum, gauge, histogram, exponentialHistogram, summary.`,
                    );
                    logger.warn(`Metric data: ${JSON.stringify(metric)}`);
                  }
                } catch (metricError) {
                  logger.error("Error processing individual metric:");
                  logger.error(metricError);
                  logger.error(`Metric data: ${JSON.stringify(metric)}`);
                }
              }
            } catch (scopeError) {
              logger.error("Error processing scope metric:");
              logger.error(scopeError);
              logger.error(`Scope metric data: ${JSON.stringify(scopeMetric)}`);
            }
          }
        } catch (resourceError) {
          logger.error("Error processing resource metric:");
          logger.error(resourceError);
          logger.error(
            `Resource metric data: ${JSON.stringify(resourceMetric)}`,
          );
        }
      }

      await this.flushMetricsBuffer(dbMetrics, true);

      /*
       * Drain the snapshot buffers. Failures are logged and swallowed —
       * snapshots are best-effort and must not affect ClickHouse ingest.
       */
      await this.flushKubernetesSnapshotBuffers({
        projectId,
        resourceBuffer: k8sResourceMetricsBuffer,
        containerBuffer: k8sContainerMetricsBuffer,
      });

      if (totalMetricsProcessed === 0) {
        logger.warn("No valid metrics were processed from the request");
        return;
      }

      TelemetryUtil.indexMetricNameServiceNameMap({
        metricNameServiceNameMap: metricNameServiceNameMap,
        projectId: projectId,
      }).catch((err: Error) => {
        logger.error("Error indexing metric name service name map");
        logger.error(err);
      });

      logger.debug(
        `Successfully processed ${totalMetricsProcessed} metrics for project: ${(req as TelemetryRequest).projectId}`,
      );

      try {
        dbMetrics.length = 0;

        if (req.body) {
          req.body = null;
        }
      } catch (cleanupError) {
        logger.error("Error during memory cleanup:");
        logger.error(cleanupError);
      }
    } catch (error) {
      logger.error(
        "Critical error in processMetricsAsync:",
        getLogAttributesFromRequest(req as RequestLike),
      );
      logger.error(error, getLogAttributesFromRequest(req as RequestLike));
      throw error;
    }
  }

  /*
   * Read a string attribute from the merged metric attribute map.
   * Returns "" when the attribute is missing or non-string so callers
   * can rely on a string type.
   */
  private static readSnapshotAttr(
    attrs: Dictionary<AttributeType | Array<AttributeType>>,
    key: string,
  ): string {
    const v: AttributeType | Array<AttributeType> | undefined = attrs[key];
    if (typeof v === "string") {
      return v;
    }
    return "";
  }

  /*
   * Convert a raw datapoint value to a percent. Most OTel Kubernetes
   * CPU metrics emit a unit-less ratio (0.0-1.0+); a few emit a raw
   * percent. We use the metric's `unit` field to decide:
   *   - "%"          -> already a percent, take as-is
   *   - "1" / "" / undefined / unknown -> ratio, multiply by 100
   * Sub-percent precision is preserved end-to-end; values past 100
   * are kept (200% means 2 fully utilized cores).
   */
  private static cpuValueToPercent(
    rawValue: number,
    metricUnit: string | undefined,
  ): number {
    const unit: string = (metricUnit || "").trim();
    if (unit === "%") {
      return rawValue;
    }
    return rawValue * 100;
  }

  /*
   * Match an allow-listed Kubernetes metric to its target snapshot
   * row, fold the latest CPU/memory point into the per-cluster
   * buffer. Cheap: every check is a string compare against attrs.
   */
  private static bufferKubernetesSnapshotMetric(data: {
    clusterIdStr: string;
    metricName: string;
    metricUnit: string | undefined;
    datapoint: JSONObject;
    metricAttributes: Dictionary<AttributeType | Array<AttributeType>>;
    resourceBuffer: Map<string, Map<string, ResourceMetricBufferEntry>>;
    containerBuffer: Map<string, Map<string, ContainerMetricBufferEntry>>;
  }): void {
    const valueFromInt: number | null = this.toNumberOrNull(
      data.datapoint["asInt"],
    );
    const valueFromDouble: number | null = this.toNumberOrNull(
      data.datapoint["asDouble"],
    );
    const rawValue: number | null = valueFromDouble ?? valueFromInt;
    if (rawValue === null) {
      return;
    }

    const ts: MetricTimestamp = this.safeParseUnixNano(
      data.datapoint["timeUnixNano"] as string | number | undefined,
      "k8s snapshot timeUnixNano",
    );

    const attrs: Dictionary<AttributeType | Array<AttributeType>> =
      data.metricAttributes;
    const ns: string = this.readSnapshotAttr(
      attrs,
      "resource.k8s.namespace.name",
    );

    const isCpu: boolean = data.metricName.endsWith(".cpu.utilization");
    const isMem: boolean = data.metricName.endsWith(".memory.usage");

    if (data.metricName.startsWith("container.")) {
      const podName: string = this.readSnapshotAttr(
        attrs,
        "resource.k8s.pod.name",
      );
      const containerName: string = this.readSnapshotAttr(
        attrs,
        "resource.k8s.container.name",
      );
      if (!podName || !containerName) {
        return;
      }
      this.foldContainerSnapshot({
        buffer: data.containerBuffer,
        clusterIdStr: data.clusterIdStr,
        ns,
        podName,
        containerName,
        cpuPercent: isCpu
          ? this.cpuValueToPercent(rawValue, data.metricUnit)
          : null,
        memoryBytes: isMem ? Math.max(0, Math.trunc(rawValue)) : null,
        observedAt: ts.date,
      });
      return;
    }

    if (data.metricName.startsWith("k8s.pod.")) {
      const podName: string = this.readSnapshotAttr(
        attrs,
        "resource.k8s.pod.name",
      );
      if (!podName) {
        return;
      }
      /*
       * Pull the resolved Deployment / CronJob names off the metric
       * attributes (the OTel collector walks the owner chain). These
       * are denormalized onto the Pod row so the Deployments and
       * CronJobs list views can SUM over them without inventorying
       * ReplicaSets or doing a 2-hop SQL join.
       */
      const deployName: string = this.readSnapshotAttr(
        attrs,
        "resource.k8s.deployment.name",
      );
      const cronName: string = this.readSnapshotAttr(
        attrs,
        "resource.k8s.cronjob.name",
      );
      this.foldResourceSnapshot({
        buffer: data.resourceBuffer,
        clusterIdStr: data.clusterIdStr,
        kind: "Pod",
        ns,
        name: podName,
        cpuPercent: isCpu
          ? this.cpuValueToPercent(rawValue, data.metricUnit)
          : null,
        memoryBytes: isMem ? Math.max(0, Math.trunc(rawValue)) : null,
        observedAt: ts.date,
        controllerDeploymentName: deployName || null,
        controllerCronJobName: cronName || null,
      });
      return;
    }

    if (data.metricName.startsWith("k8s.node.")) {
      const nodeName: string = this.readSnapshotAttr(
        attrs,
        "resource.k8s.node.name",
      );
      if (!nodeName) {
        return;
      }
      this.foldResourceSnapshot({
        buffer: data.resourceBuffer,
        clusterIdStr: data.clusterIdStr,
        kind: "Node",
        ns: "", // Nodes are cluster-scoped
        name: nodeName,
        cpuPercent: isCpu
          ? this.cpuValueToPercent(rawValue, data.metricUnit)
          : null,
        memoryBytes: isMem ? Math.max(0, Math.trunc(rawValue)) : null,
        observedAt: ts.date,
        controllerDeploymentName: null,
        controllerCronJobName: null,
      });
      return;
    }
  }

  private static foldResourceSnapshot(data: {
    buffer: Map<string, Map<string, ResourceMetricBufferEntry>>;
    clusterIdStr: string;
    kind: string;
    ns: string;
    name: string;
    cpuPercent: number | null;
    memoryBytes: number | null;
    observedAt: Date;
    controllerDeploymentName: string | null;
    controllerCronJobName: string | null;
  }): void {
    let perCluster: Map<string, ResourceMetricBufferEntry> | undefined =
      data.buffer.get(data.clusterIdStr);
    if (!perCluster) {
      perCluster = new Map();
      data.buffer.set(data.clusterIdStr, perCluster);
    }
    const key: string = `${data.kind}|${data.ns}|${data.name}`;
    const existing: ResourceMetricBufferEntry | undefined = perCluster.get(key);
    if (!existing) {
      perCluster.set(key, {
        kind: data.kind,
        namespaceKey: data.ns,
        name: data.name,
        cpuPercent: data.cpuPercent,
        memoryBytes: data.memoryBytes,
        observedAt: data.observedAt,
        controllerDeploymentName: data.controllerDeploymentName,
        controllerCronJobName: data.controllerCronJobName,
      });
      return;
    }
    if (data.cpuPercent !== null && data.observedAt >= existing.observedAt) {
      existing.cpuPercent = data.cpuPercent;
    }
    if (data.memoryBytes !== null && data.observedAt >= existing.observedAt) {
      existing.memoryBytes = data.memoryBytes;
    }
    if (data.observedAt > existing.observedAt) {
      existing.observedAt = data.observedAt;
    }
    /*
     * Controller names don't change for a Pod; first-non-null wins so
     * later batches missing the attribute don't blank the row.
     */
    if (
      data.controllerDeploymentName !== null &&
      existing.controllerDeploymentName === null
    ) {
      existing.controllerDeploymentName = data.controllerDeploymentName;
    }
    if (
      data.controllerCronJobName !== null &&
      existing.controllerCronJobName === null
    ) {
      existing.controllerCronJobName = data.controllerCronJobName;
    }
  }

  private static foldContainerSnapshot(data: {
    buffer: Map<string, Map<string, ContainerMetricBufferEntry>>;
    clusterIdStr: string;
    ns: string;
    podName: string;
    containerName: string;
    cpuPercent: number | null;
    memoryBytes: number | null;
    observedAt: Date;
  }): void {
    let perCluster: Map<string, ContainerMetricBufferEntry> | undefined =
      data.buffer.get(data.clusterIdStr);
    if (!perCluster) {
      perCluster = new Map();
      data.buffer.set(data.clusterIdStr, perCluster);
    }
    const key: string = `${data.ns}|${data.podName}|${data.containerName}`;
    const existing: ContainerMetricBufferEntry | undefined =
      perCluster.get(key);
    if (!existing) {
      perCluster.set(key, {
        podNamespaceKey: data.ns,
        podName: data.podName,
        name: data.containerName,
        cpuPercent: data.cpuPercent,
        memoryBytes: data.memoryBytes,
        observedAt: data.observedAt,
      });
      return;
    }
    if (data.cpuPercent !== null && data.observedAt >= existing.observedAt) {
      existing.cpuPercent = data.cpuPercent;
    }
    if (data.memoryBytes !== null && data.observedAt >= existing.observedAt) {
      existing.memoryBytes = data.memoryBytes;
    }
    if (data.observedAt > existing.observedAt) {
      existing.observedAt = data.observedAt;
    }
  }

  private static async flushKubernetesSnapshotBuffers(data: {
    projectId: ObjectID;
    resourceBuffer: Map<string, Map<string, ResourceMetricBufferEntry>>;
    containerBuffer: Map<string, Map<string, ContainerMetricBufferEntry>>;
  }): Promise<void> {
    if (data.resourceBuffer.size > 0) {
      for (const [clusterIdStr, byKey] of data.resourceBuffer.entries()) {
        if (byKey.size === 0) {
          continue;
        }
        try {
          const metrics: Array<ResourceLatestMetric> = [];
          for (const e of byKey.values()) {
            metrics.push({
              kind: e.kind,
              namespaceKey: e.namespaceKey,
              name: e.name,
              cpuPercent: e.cpuPercent,
              memoryBytes: e.memoryBytes,
              observedAt: e.observedAt,
              controllerDeploymentName: e.controllerDeploymentName,
              controllerCronJobName: e.controllerCronJobName,
            });
          }
          await KubernetesResourceService.bulkUpdateLatestMetrics({
            projectId: data.projectId,
            kubernetesClusterId: new ObjectID(clusterIdStr),
            metrics,
          });
        } catch (err) {
          logger.warn(
            `K8s snapshot writeback (resource) failed for cluster ${clusterIdStr}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    if (data.containerBuffer.size > 0) {
      for (const [clusterIdStr, byKey] of data.containerBuffer.entries()) {
        if (byKey.size === 0) {
          continue;
        }
        try {
          const metrics: Array<ContainerLatestMetric> = [];
          for (const e of byKey.values()) {
            metrics.push({
              podNamespaceKey: e.podNamespaceKey,
              podName: e.podName,
              name: e.name,
              cpuPercent: e.cpuPercent,
              memoryBytes: e.memoryBytes,
              observedAt: e.observedAt,
            });
          }
          await KubernetesContainerService.bulkUpdateLatestMetrics({
            projectId: data.projectId,
            kubernetesClusterId: new ObjectID(clusterIdStr),
            metrics,
          });
        } catch (err) {
          logger.warn(
            `K8s snapshot writeback (container) failed for cluster ${clusterIdStr}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  }

  private static buildMetricRow(data: {
    datapoint: JSONObject;
    baseAttributes: Dictionary<AttributeType | Array<AttributeType>>;
    projectId: ObjectID;
    serviceId: ObjectID;
    serviceName: string;
    metricName: string;
    metricPointType: MetricPointType;
    aggregationTemporality?: OtelAggregationTemporality;
    isMonotonic?: boolean;
    dataRententionInDays: number;
  }): JSONObject {
    const ingestionDate: Date = OneUptimeDate.getCurrentDate();
    const ingestionTimestamp: string =
      OneUptimeDate.toClickhouseDateTime(ingestionDate);

    const timeFields: MetricTimestamp = this.safeParseUnixNano(
      data.datapoint["timeUnixNano"] as string | number | undefined,
      "metric datapoint timeUnixNano",
    );

    const startTimeRaw: string | number | undefined = data.datapoint[
      "startTimeUnixNano"
    ] as string | number | undefined;

    const startTimeFields: MetricTimestamp | null = startTimeRaw
      ? this.safeParseUnixNano(
          startTimeRaw,
          "metric datapoint startTimeUnixNano",
        )
      : null;

    const attributes: Dictionary<AttributeType | Array<AttributeType>> = {
      ...data.baseAttributes,
    };

    if (data.datapoint["attributes"]) {
      Object.assign(
        attributes,
        TelemetryUtil.getAttributes({
          items: (data.datapoint["attributes"] as JSONArray) || [],
          prefixKeysWithString: "",
        }),
      );
    }

    const attributeKeys: Array<string> =
      TelemetryUtil.getAttributeKeys(attributes);

    const valueFromInt: number | null = this.toNumberOrNull(
      data.datapoint["asInt"],
    );
    const valueFromDouble: number | null = this.toNumberOrNull(
      data.datapoint["asDouble"],
    );
    const count: number | null = this.toNumberOrNull(data.datapoint["count"]);
    const sum: number | null = this.toNumberOrNull(data.datapoint["sum"]);
    const min: number | null = this.toNumberOrNull(data.datapoint["min"]);
    const max: number | null = this.toNumberOrNull(data.datapoint["max"]);

    const bucketCounts: Array<number> = Array.isArray(
      data.datapoint["bucketCounts"],
    )
      ? (data.datapoint["bucketCounts"] as Array<number | string>).map(
          (entry: number | string) => {
            const parsed: number | null = this.toNumberOrNull(entry);
            return parsed === null ? 0 : parsed;
          },
        )
      : [];

    const explicitBoundsRaw: Array<number | string> | undefined = Array.isArray(
      data.datapoint["explicitBounds"],
    )
      ? (data.datapoint["explicitBounds"] as Array<number | string>)
      : undefined;

    const explicitBounds: Array<number> = explicitBoundsRaw
      ? explicitBoundsRaw
          .map((entry: number | string) => {
            return this.toNumberOrNull(entry);
          })
          .filter((entry: number | null): entry is number => {
            return entry !== null;
          })
      : [];

    /*
     * ExponentialHistogram-specific fields. The proto carries `scale`,
     * `zeroCount`, and two `Buckets { offset, bucket_counts[] }` substructs
     * (positive/negative). For non-exponential metric types these are all
     * absent on the datapoint and we default to 0 / [] (matches the column
     * defaults in the model).
     */
    const scale: number | null = this.toNumberOrNull(data.datapoint["scale"]);
    const zeroCount: number | null = this.toNumberOrNull(
      data.datapoint["zeroCount"],
    );

    const parseBucketsField: (raw: unknown) => {
      offset: number;
      bucketCounts: Array<number>;
    } = (raw: unknown): { offset: number; bucketCounts: Array<number> } => {
      const obj: JSONObject = (raw as JSONObject) || {};
      const offsetParsed: number | null = this.toNumberOrNull(obj["offset"]);
      const bucketCountsRaw: Array<number | string> = Array.isArray(
        obj["bucketCounts"],
      )
        ? (obj["bucketCounts"] as Array<number | string>)
        : [];
      return {
        offset: offsetParsed === null ? 0 : offsetParsed,
        bucketCounts: bucketCountsRaw.map((entry: number | string) => {
          const parsed: number | null = this.toNumberOrNull(entry);
          return parsed === null ? 0 : parsed;
        }),
      };
    };

    const positiveBuckets: {
      offset: number;
      bucketCounts: Array<number>;
    } = parseBucketsField(data.datapoint["positive"]);
    const negativeBuckets: {
      offset: number;
      bucketCounts: Array<number>;
    } = parseBucketsField(data.datapoint["negative"]);

    /*
     * Summary-specific fields. The proto carries
     * `quantile_values: repeated { quantile: double, value: double }`.
     * We split into two parallel Float64 arrays keyed by index, matching the
     * bucketCounts/explicitBounds convention used by histograms. Any entries
     * that fail to parse (NaN, +/-Inf, missing) are dropped together so the
     * two arrays stay length-aligned.
     */
    const quantileEntriesRaw: JSONArray = Array.isArray(
      data.datapoint["quantileValues"],
    )
      ? (data.datapoint["quantileValues"] as JSONArray)
      : [];
    const summaryQuantiles: Array<number> = [];
    const summaryValues: Array<number> = [];
    for (const entryUnknown of quantileEntriesRaw) {
      const entry: JSONObject = (entryUnknown as JSONObject) || {};
      const q: number | null = this.toNumberOrNull(entry["quantile"]);
      const v: number | null = this.toNumberOrNull(entry["value"]);
      if (q === null || v === null) {
        continue;
      }
      summaryQuantiles.push(q);
      summaryValues.push(v);
    }

    // Extract exemplar trace/span IDs from the first exemplar that has a traceId
    const exemplarTraceAndSpanIds: {
      traceId: string | null;
      spanId: string | null;
    } = this.extractExemplarIds(data.datapoint["exemplars"] as JSONArray);

    const retentionDate: Date = OneUptimeDate.addRemoveDays(
      ingestionDate,
      data.dataRententionInDays || 15,
    );

    const row: JSONObject = {
      _id: ObjectID.generate().toString(),
      createdAt: ingestionTimestamp,
      updatedAt: ingestionTimestamp,
      projectId: data.projectId.toString(),
      serviceId: data.serviceId.toString(),
      serviceType: ServiceType.OpenTelemetry,
      name: data.metricName,
      time: timeFields.db,
      timeUnixNano: timeFields.nano,
      metricPointType: data.metricPointType,
      aggregationTemporality: this.mapAggregationTemporality(
        data.aggregationTemporality,
      ),
      isMonotonic:
        data.isMonotonic === undefined ? null : Boolean(data.isMonotonic),
      attributes: attributes,
      attributeKeys: attributeKeys,
      value:
        valueFromInt !== null
          ? valueFromInt
          : valueFromDouble !== null
            ? valueFromDouble
            : sum,
      count: count,
      sum: sum,
      min: min,
      max: max,
      bucketCounts: bucketCounts,
      explicitBounds: explicitBounds,
      // ExponentialHistogram fields - 0/[] for other metric types.
      scale: scale === null ? 0 : scale,
      zeroCount: zeroCount === null ? 0 : zeroCount,
      positiveOffset: positiveBuckets.offset,
      positiveBucketCounts: positiveBuckets.bucketCounts,
      negativeOffset: negativeBuckets.offset,
      negativeBucketCounts: negativeBuckets.bucketCounts,
      // Summary fields - empty arrays for other metric types.
      summaryQuantiles: summaryQuantiles,
      summaryValues: summaryValues,
      traceId: exemplarTraceAndSpanIds.traceId,
      spanId: exemplarTraceAndSpanIds.spanId,
      retentionDate: OneUptimeDate.toClickhouseDateTime(retentionDate),
    };

    if (startTimeFields) {
      row["startTime"] = startTimeFields.db;
      row["startTimeUnixNano"] = startTimeFields.nano;
    } else {
      row["startTime"] = null;
      row["startTimeUnixNano"] = null;
    }

    return row;
  }

  private static safeParseUnixNano(
    value: string | number | undefined,
    context: string,
  ): MetricTimestamp {
    let numericValue: number = OneUptimeDate.getCurrentDateAsUnixNano();

    if (value !== undefined && value !== null) {
      try {
        if (typeof value === "string") {
          const parsed: number = Number.parseFloat(value);
          if (isNaN(parsed)) {
            throw new Error(`Invalid timestamp string: ${value}`);
          }
          numericValue = parsed;
        } else if (typeof value === "number") {
          if (!Number.isFinite(value)) {
            throw new Error(`Invalid timestamp number: ${value}`);
          }
          numericValue = value;
        }
      } catch (error) {
        logger.warn(
          `Error processing ${context}: ${error instanceof Error ? error.message : String(error)}, using current time`,
        );
        numericValue = OneUptimeDate.getCurrentDateAsUnixNano();
      }
    }

    const date: Date = OneUptimeDate.fromUnixNano(numericValue);
    const iso: string = OneUptimeDate.toString(date);
    const db: string = OneUptimeDate.toClickhouseDateTime(date);

    return {
      nano: Math.trunc(numericValue).toString(),
      iso: iso,
      db: db,
      date: date,
    };
  }

  private static toNumberOrNull(value: unknown): number | null {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }

    if (typeof value === "string") {
      const parsed: number = Number.parseFloat(value);
      /*
       * `Number.isFinite` is stricter than `!isNaN`: it rejects both NaN
       * and +/-Infinity. OTLP histograms routinely contain "+Inf" as the
       * trailing explicitBound value when the histogram has an unbounded
       * final bucket; `parseFloat("Infinity")` returns `Infinity`, which
       * `isNaN` would accept and which then fails to serialize into the
       * ClickHouse JSONEachRow format with:
       *   Cannot read array from text, expected comma or end of array,
       *   found 'e': (while reading the value of key explicitBounds)
       * dropping the entire metrics batch. Filter non-finite values here
       * so they are coerced to null and then dropped by the caller's
       * `.filter(entry !== null)` step.
       */
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  private static mapAggregationTemporality(
    temporality?: OtelAggregationTemporality,
  ): string | null {
    if (!temporality) {
      return null;
    }

    if (temporality === OtelAggregationTemporality.Cumulative) {
      return "Cumulative";
    }

    if (temporality === OtelAggregationTemporality.Delta) {
      return "Delta";
    }

    return null;
  }

  /**
   * Extract trace and span IDs from OTLP exemplars.
   * Takes the first exemplar that has a traceId.
   * OTLP sends trace_id and span_id as base64-encoded bytes.
   */
  private static extractExemplarIds(exemplars: JSONArray | undefined): {
    traceId: string | null;
    spanId: string | null;
  } {
    if (!exemplars || !Array.isArray(exemplars) || exemplars.length === 0) {
      return { traceId: null, spanId: null };
    }

    for (const exemplar of exemplars) {
      const exemplarObj: JSONObject = exemplar as JSONObject;
      const rawTraceId: string | undefined = exemplarObj["traceId"] as
        | string
        | undefined;

      if (!rawTraceId) {
        continue;
      }

      const traceId: string = this.convertBase64ToHexSafe(rawTraceId);

      if (!traceId) {
        continue;
      }

      const rawSpanId: string | undefined = exemplarObj["spanId"] as
        | string
        | undefined;
      const spanId: string = rawSpanId
        ? this.convertBase64ToHexSafe(rawSpanId)
        : "";

      return {
        traceId: traceId || null,
        spanId: spanId || null,
      };
    }

    return { traceId: null, spanId: null };
  }

  private static convertBase64ToHexSafe(value: string | undefined): string {
    if (!value) {
      return "";
    }
    try {
      return Text.convertBase64ToHex(value);
    } catch {
      return "";
    }
  }
}

import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import {
  OtelAggregationTemporality,
  TelemetryServiceMetadata,
  getScalarEntityKeyColumns,
} from "Common/Server/Services/OpenTelemetryIngestService";
import { ResourceEntityRef } from "Common/Server/Utils/Telemetry/TelemetryEntity";
import OtelPayloadDecoder from "../Utils/OtelPayloadDecoder";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import { MetricPointType } from "Common/Models/AnalyticsModels/Metric";
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
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { TELEMETRY_METRIC_FLUSH_BATCH_SIZE } from "../Config";
import MetricPipelineRuleService, {
  MetricRulesForProject,
} from "./MetricPipelineRuleService";
import OneUptimeDate from "Common/Types/Date";
import { resolveTelemetryRetentionInDays } from "Common/Types/Telemetry/TelemetryRetentionConfig";
import MetricService from "Common/Server/Services/MetricService";
import Text from "Common/Types/Text";
import KubernetesResourceService, {
  ResourceLatestMetric,
} from "Common/Server/Services/KubernetesResourceService";
import KubernetesContainerService, {
  ContainerLatestMetric,
} from "Common/Server/Services/KubernetesContainerService";
import DockerResourceService, {
  ParsedDockerContainer,
} from "Common/Server/Services/DockerResourceService";
import CloudResourceInstanceService from "Common/Server/Services/CloudResourceInstanceService";
import HostService from "Common/Server/Services/HostService";
import LabelService from "Common/Server/Services/LabelService";
import Host from "Common/Models/DatabaseModels/Host";
import { extractOneuptimeLabelNames } from "Common/Server/Utils/Telemetry/OneuptimeLabel";
import { HEARTBEAT_MAX_BACKDATE_MS } from "Common/Utils/Telemetry/HeartbeatAvailability";

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
/*
 * The k8s_cluster receiver's per-node allocatable CPU (cores). Not a
 * displayed metric — its latest value is cached per node and used as
 * the denominator that turns the cores-valued `*.cpu.utilization`
 * metrics into a true "% of node allocatable CPU".
 */
const K8S_NODE_ALLOCATABLE_CPU_METRIC: string = "k8s.node.allocatable_cpu";

/*
 * The k8s_cluster receiver's per-node allocatable memory (bytes). Like
 * allocatable CPU, not a displayed metric — its latest value is cached
 * per node and used as the denominator that turns the bytes-valued
 * `*.memory.usage` metrics into a true "% of node allocatable memory".
 */
const K8S_NODE_ALLOCATABLE_MEMORY_METRIC: string =
  "k8s.node.allocatable_memory";

const K8S_SNAPSHOT_METRIC_NAMES: ReadonlySet<string> = new Set([
  "k8s.pod.cpu.utilization",
  "k8s.pod.memory.usage",
  "k8s.node.cpu.utilization",
  "k8s.node.memory.usage",
  "container.cpu.utilization",
  "container.memory.usage",
  K8S_NODE_ALLOCATABLE_CPU_METRIC,
  K8S_NODE_ALLOCATABLE_MEMORY_METRIC,
]);

/*
 * Docker snapshot metrics — emitted by the docker_stats receiver
 * with container.id / container.name / container.image.name as
 * resource attributes. Container row inventory is upserted from
 * these in the same pass as the ClickHouse insert.
 */
const DOCKER_SNAPSHOT_METRIC_NAMES: ReadonlySet<string> = new Set([
  "container.cpu.utilization",
  "container.memory.usage.total",
]);

/*
 * Cloud managed-compute snapshot metrics — ECS/Fargate, Cloud Run, etc.
 * emit container.cpu.utilization / container.memory.usage with
 * service.instance.id identifying the running task / instance. The latest
 * point is mirrored onto the matching CloudResourceInstance row.
 */
const CLOUD_SNAPSHOT_METRIC_NAMES: ReadonlySet<string> = new Set([
  "container.cpu.utilization",
  "container.memory.usage",
  "container.memory.usage.total",
]);

interface ResourceMetricBufferEntry {
  kind: string;
  namespaceKey: string;
  name: string;
  cpuPercent: number | null;
  memoryBytes: number | null;
  memoryPercent: number | null;
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

interface DockerContainerMetricBufferEntry {
  containerName: string;
  containerId: string | null;
  imageName: string | null;
  cpuPercent: number | null;
  memoryBytes: number | null;
  observedAt: Date;
}

interface CloudResourceInstanceMetricBufferEntry {
  instanceName: string;
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

      /*
       * Send 200 first, then enqueue the raw bytes. Protobuf decode
       * now happens in the worker — see TelemetryQueueService.
       */
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

  /*
   * Walk an entire metrics batch once and apply Host metadata + cached
   * stats per unique host.name in a single UPDATE per host. The per-
   * resource enrichment in the main for-loop only sees one scraper's
   * data at a time, so cpuCores / totalMemoryBytes / processCount
   * couldn't be merged with osType / hostArch (which live on every
   * resource). On macOS-sized batches with 600+ process resources,
   * the per-resource path also doesn't reliably reach the cpu / memory
   * / processes scraper resources, leaving those columns null. This
   * batch-level pass collapses every resourceMetric for the same host
   * into one merged write.
   */
  @CaptureSpan()
  private static async runBatchHostEnrichment(data: {
    projectId: ObjectID;
    resourceMetrics: JSONArray;
  }): Promise<void> {
    interface HostEnrichmentEntry {
      osType: string | null;
      osVersion: string | null;
      hostId: string | null;
      hostArch: string | null;
      hostType: string | null;
      hostIpAddresses: string | null;
      cpuCores: number | null;
      totalMemoryBytes: number | null;
      processCount: number | null;
      containerRuntime: string | null;
      hasInfraSignal: boolean;
      labelNames: Set<string>;
    }

    const aggregator: Map<string, HostEnrichmentEntry> = new Map();

    for (const resourceMetric of data.resourceMetrics) {
      const rm: JSONObject = resourceMetric as JSONObject;
      const ras: JSONArray =
        ((rm["resource"] as JSONObject)?.["attributes"] as JSONArray) || [];

      /*
       * Mirror the phantom-host gate from `autoDiscoverHost`: require
       * explicit host.name and reject k8s/Docker telemetry. Application
       * SDKs inside pods set host.name to the pod's container hostname
       * (the pod name) and os.type=linux, which used to slip into the
       * Host table from this batch-enrichment pass even after
       * autoDiscoverHost rejected the same batch. k8s pods/nodes belong
       * in KubernetesResource (kind=Pod / kind=Node), and Docker hosts
       * belong in the DockerHost table — neither should land here.
       */
      const hostName: string | null = OtelIngestBaseService.getStringAttribute(
        ras,
        "host.name",
      );
      if (!hostName) {
        continue;
      }

      const k8sPodName: string | null =
        OtelIngestBaseService.getStringAttribute(ras, "k8s.pod.name");
      const k8sNodeName: string | null =
        OtelIngestBaseService.getStringAttribute(ras, "k8s.node.name");
      const k8sClusterName: string | null =
        OtelIngestBaseService.getStringAttribute(ras, "k8s.cluster.name");
      if (k8sPodName || k8sNodeName || k8sClusterName) {
        continue;
      }

      if (OtelIngestBaseService.isDockerRuntime(ras)) {
        continue;
      }

      let entry: HostEnrichmentEntry | undefined = aggregator.get(hostName);
      if (!entry) {
        entry = {
          osType: null,
          osVersion: null,
          hostId: null,
          hostArch: null,
          hostType: null,
          hostIpAddresses: null,
          cpuCores: null,
          totalMemoryBytes: null,
          processCount: null,
          containerRuntime: null,
          hasInfraSignal: false,
          labelNames: new Set<string>(),
        };
        aggregator.set(hostName, entry);
      }

      const labelNamesForResource: Array<string> =
        extractOneuptimeLabelNames(ras);
      for (const labelName of labelNamesForResource) {
        entry.labelNames.add(labelName);
      }

      if (!entry.osType) {
        entry.osType = OtelIngestBaseService.getStringAttribute(ras, "os.type");
      }
      if (!entry.osVersion) {
        entry.osVersion =
          OtelIngestBaseService.getStringAttribute(ras, "os.description") ||
          OtelIngestBaseService.getStringAttribute(ras, "os.version");
      }
      if (!entry.hostId) {
        entry.hostId = OtelIngestBaseService.getStringAttribute(ras, "host.id");
      }
      if (!entry.hostArch) {
        entry.hostArch = OtelIngestBaseService.getStringAttribute(
          ras,
          "host.arch",
        );
      }
      if (!entry.hostType) {
        entry.hostType = OtelIngestBaseService.getStringAttribute(
          ras,
          "host.type",
        );
      }
      if (!entry.hostIpAddresses) {
        const ips: Array<string> =
          OtelIngestBaseService.getStringArrayAttribute(ras, "host.ip");
        entry.hostIpAddresses = ips.length > 0 ? ips.join(", ") : null;
      }
      if (!entry.containerRuntime) {
        entry.containerRuntime = OtelIngestBaseService.getStringAttribute(
          ras,
          "container.runtime",
        );
      }

      const sms: JSONArray = (rm["scopeMetrics"] as JSONArray) || [];
      const stats: {
        hasInfraSignal: boolean;
        cpuCores?: number;
        totalMemoryBytes?: number;
        processCount?: number;
      } = OtelIngestBaseService.scanHostInfraStatsFromMetrics(sms);

      if (stats.hasInfraSignal) {
        entry.hasInfraSignal = true;
      }
      if (stats.cpuCores !== undefined && entry.cpuCores === null) {
        entry.cpuCores = stats.cpuCores;
      }
      if (
        stats.totalMemoryBytes !== undefined &&
        entry.totalMemoryBytes === null
      ) {
        entry.totalMemoryBytes = stats.totalMemoryBytes;
      }
      if (stats.processCount !== undefined && entry.processCount === null) {
        entry.processCount = stats.processCount;
      }
    }

    for (const [hostName, entry] of aggregator) {
      /*
       * Phantom-host gate: only touch the row if we have at least one
       * real host signal (an OS, a container runtime, or any system./
       * process. metric in this batch).
       */
      const hasResourceSignal: boolean = Boolean(
        entry.osType || entry.containerRuntime,
      );
      if (!hasResourceSignal && !entry.hasInfraSignal) {
        continue;
      }

      try {
        const host: Host = await HostService.findOrCreateByHostIdentifier({
          projectId: data.projectId,
          hostIdentifier: hostName,
        });

        if (!host._id) {
          continue;
        }

        await HostService.updateLastSeen(new ObjectID(host._id.toString()), {
          osType: entry.osType ?? undefined,
          osVersion: entry.osVersion ?? undefined,
          hostId: entry.hostId ?? undefined,
          hostArch: entry.hostArch ?? undefined,
          hostType: entry.hostType ?? undefined,
          hostIpAddresses: entry.hostIpAddresses ?? undefined,
          cpuCores: entry.cpuCores ?? undefined,
          totalMemoryBytes: entry.totalMemoryBytes ?? undefined,
          processCount: entry.processCount ?? undefined,
          containerRuntime: entry.containerRuntime ?? undefined,
        });

        if (entry.labelNames.size > 0) {
          const labelIds: Array<ObjectID> =
            await LabelService.findOrCreateLabelsByNames({
              projectId: data.projectId,
              labelNames: Array.from(entry.labelNames),
            });
          if (labelIds.length > 0) {
            await HostService.attachLabels({
              hostId: new ObjectID(host._id.toString()),
              labelIds,
            });
          }
        }
      } catch (hostError) {
        logger.warn(
          `Batch host enrichment write for "${hostName}" failed: ${hostError instanceof Error ? hostError.message : String(hostError)}`,
        );
      }
    }
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

      /*
       * Canonicalize host.name casing before host enrichment and the main
       * loop both read it — so the resolved hostIdentifier and the stored
       * resource.host.name attribute share one casing and the host-detail
       * pages keep matching via the fast query path.
       */
      OtelIngestBaseService.normalizeHostNameAttributesInPlace(resourceMetrics);

      const dbMetrics: Array<JSONObject> = [];
      const serviceDictionary: Dictionary<TelemetryServiceMetadata> = {};

      const metricNameServiceNameMap: Dictionary<MetricType> = {};
      let totalMetricsProcessed: number = 0;
      const projectId: ObjectID = (req as TelemetryRequest).projectId;

      /*
       * Hosts already heartbeated in this batch. The hostmetrics receiver
       * emits one ResourceMetrics per scraper, all carrying the same
       * host.name — without this set we'd write a heartbeat row per
       * scraper instead of one per host per ingest call.
       */
      const hostHeartbeatHostNames: Set<string> = new Set<string>();

      /*
       * Per-host newest datapoint timestamp across the WHOLE payload,
       * collected up-front because the heartbeat for a host is emitted
       * on the first resource that carries its host.name (see the
       * dedup set above) — but the hostmetrics receiver spreads a
       * host's datapoints across many resources, and a collector
       * retry/backoff can even merge several scrape cycles into one
       * export. Scanning only the first resource would stamp the
       * heartbeat with whichever scraper iterates first instead of the
       * newest scrape the payload proves.
       */
      const hostMaxDatapointTimeNano: Map<string, number> = new Map<
        string,
        number
      >();
      let heartbeatScanCounter: number = 0;
      for (const rm of resourceMetrics) {
        /*
         * This scan runs OUTSIDE the per-resource try/catch of the
         * main loop, so a malformed resource (null entry, non-array
         * attributes / scopeMetrics — all reachable via the OTLP/JSON
         * path) must be skipped here, not thrown: a throw would fail
         * the whole batch instead of the one bad resource.
         */
        if (heartbeatScanCounter % 25 === 0) {
          await Promise.resolve();
        }
        heartbeatScanCounter++;
        const resourceForScan: JSONObject | undefined = (
          rm as JSONObject | null
        )?.["resource"] as JSONObject | undefined;
        const attributesForScan: unknown = resourceForScan?.["attributes"];
        const hostNameForScan: string | null = Array.isArray(attributesForScan)
          ? OtelIngestBaseService.getHostNameFromAttributes(
              attributesForScan as JSONArray,
            )
          : null;
        if (!hostNameForScan) {
          continue;
        }
        const scopeMetricsForMax: unknown = (rm as JSONObject)["scopeMetrics"];
        const resourceMax: number | null = Array.isArray(scopeMetricsForMax)
          ? this.getMaxDatapointTimeUnixNano(scopeMetricsForMax as JSONArray)
          : null;
        if (
          resourceMax !== null &&
          resourceMax > (hostMaxDatapointTimeNano.get(hostNameForScan) ?? 0)
        ) {
          hostMaxDatapointTimeNano.set(hostNameForScan, resourceMax);
        }
      }

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
      const dockerContainerMetricsBuffer: Map<
        string,
        Map<string, DockerContainerMetricBufferEntry>
      > = new Map();
      const cloudResourceInstanceMetricsBuffer: Map<
        string,
        Map<string, CloudResourceInstanceMetricBufferEntry>
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

      /*
       * Single-pass host enrichment across the entire batch.
       *
       * The OTel hostmetrics receiver emits one ResourceMetrics per scraper
       * (cpu, memory, processes, ...) plus one ResourceMetrics per process.
       * The per-resource enrichment that runs inside the main for-loop only
       * sees one scraper's metrics at a time, so memory/process counts can't
       * be combined with osType/hostArch (which live on every resource) into
       * a single coherent UPDATE — and on macOS-sized batches (600+ process
       * resources) we observed the per-resource enrichment failing to reach
       * the cpu/memory/processes scrapers' resources at all.
       *
       * Walk the entire batch once up-front: collect resource attributes
       * from any resource carrying host.name, and collect cached metric
       * stats (cpuCores, totalMemoryBytes, processCount) from whichever
       * scraper's resource exposes them. Then upsert the Host row + write
       * the merged stats in a single DB UPDATE per host.
       */
      try {
        await this.runBatchHostEnrichment({
          projectId,
          resourceMetrics,
        });
      } catch (enrichmentError) {
        logger.warn(
          `Batch host enrichment failed (best-effort): ${enrichmentError instanceof Error ? enrichmentError.message : String(enrichmentError)}`,
        );
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

          // Producer-declared entities (authoritative when present).
          const resourceEntityRefs: Array<ResourceEntityRef> =
            OtelPayloadDecoder.getEntityRefsFromResource(
              resourceMetric["resource"] as JSONObject | undefined,
            );

          /*
           * Auto-discover Kubernetes cluster and Docker host from
           * resource attributes. The two lookups are independent —
           * they read different attributes and don't share state —
           * so issue them concurrently to collapse per-resource
           * latency. autoDiscoverHost still has to wait below
           * because it consumes both ids.
           */
          const [kubernetesClusterId, dockerHostId]: [
            ObjectID | null,
            ObjectID | null,
          ] = await Promise.all([
            this.autoDiscoverKubernetesCluster({
              projectId,
              attributes: resourceAttributes_raw,
            }),
            this.autoDiscoverDockerHost({
              projectId,
              attributes: resourceAttributes_raw,
            }),
          ]);

          /*
           * Generic Host auto-discovery. Pre-scan the resource's
           * scopeMetrics to detect host-level signal (system.* /
           * process.*) and capture cached stats (cpuCores,
           * totalMemoryBytes, processCount) — collapses everything
           * into a single Host upsert per resource batch.
           */
          const scopeMetricsForScan: JSONArray =
            (resourceMetric["scopeMetrics"] as JSONArray) || [];

          const hostInfraStats: {
            hasInfraSignal: boolean;
            cpuCores?: number;
            totalMemoryBytes?: number;
            processCount?: number;
          } = this.scanHostInfraStatsFromMetrics(scopeMetricsForScan);

          const hostId: ObjectID | null = await this.autoDiscoverHost({
            projectId,
            attributes: resourceAttributes_raw,
            hasInfraSignal: hostInfraStats.hasInfraSignal,
            dockerHostId,
            kubernetesClusterId,
            cpuCores: hostInfraStats.cpuCores,
            totalMemoryBytes: hostInfraStats.totalMemoryBytes,
            processCount: hostInfraStats.processCount,
          });

          const serverlessFunctionId: ObjectID | null =
            await this.autoDiscoverServerless({
              projectId,
              attributes: resourceAttributes_raw,
            });

          const cloudResourceId: ObjectID | null =
            await this.autoDiscoverCloudResource({
              projectId,
              attributes: resourceAttributes_raw,
            });

          const rumApplicationId: ObjectID | null = await this.autoDiscoverRum({
            projectId,
            attributes: resourceAttributes_raw,
          });

          const serviceMetadata: TelemetryServiceMetadata =
            await this.resolveTelemetryResource({
              req,
              attributes: resourceAttributes_raw,
              projectId,
              hostId,
              dockerHostId,
              kubernetesClusterId,
              serverlessFunctionId,
              cloudResourceId,
              rumApplicationId,
              entityRefs: resourceEntityRefs,
            });
          const serviceName: string = serviceMetadata.serviceName;

          serviceDictionary[serviceName] = serviceMetadata;

          const stampHostName: string | null =
            OtelIngestBaseService.getStringAttribute(
              resourceAttributes_raw,
              "host.name",
            );
          const stampClusterName: string | null =
            OtelIngestBaseService.getClusterNameFromAttributes(
              resourceAttributes_raw,
            );

          const resourceAttributes: Dictionary<
            AttributeType | Array<AttributeType>
          > = {
            ...(serviceMetadata.primaryEntityType === ServiceType.OpenTelemetry
              ? TelemetryUtil.getAttributesForServiceIdAndServiceName({
                  serviceId: serviceMetadata.primaryEntityId!,
                  serviceName: serviceName,
                })
              : {}),
            ...(hostId && stampHostName
              ? TelemetryUtil.getAttributesForHostIdAndHostName({
                  hostId,
                  hostName: stampHostName,
                })
              : {}),
            ...(dockerHostId && stampHostName
              ? TelemetryUtil.getAttributesForDockerHostIdAndHostName({
                  dockerHostId,
                  hostName: stampHostName,
                })
              : {}),
            ...(kubernetesClusterId && stampClusterName
              ? TelemetryUtil.getAttributesForKubernetesClusterIdAndName({
                  kubernetesClusterId,
                  clusterName: stampClusterName,
                })
              : {}),
            ...TelemetryUtil.getAttributes({
              items: resourceAttributes_raw,
              prefixKeysWithString: "resource",
            }),
          };

          /*
           * Synthetic per-host heartbeat. Lets users alert on "host went
           * silent" by querying `count(oneuptime.host.heartbeat) > 0`
           * over a window instead of relying on the presence of a
           * specific scraper metric. Dedup per host within this batch
           * (hostmetrics emits one ResourceMetrics per scraper) — the
           * agent's scrape interval (typically 30-60s) naturally rate-
           * limits subsequent batches.
           */
          const heartbeatHostName: string | null =
            OtelIngestBaseService.getHostNameFromAttributes(
              resourceAttributes_raw,
            );
          if (
            heartbeatHostName &&
            !hostHeartbeatHostNames.has(heartbeatHostName)
          ) {
            hostHeartbeatHostNames.add(heartbeatHostName);
            const heartbeatMetricName: string = "oneuptime.host.heartbeat";
            if (!metricNameServiceNameMap[heartbeatMetricName]) {
              const heartbeatMetricType: MetricType = new MetricType();
              heartbeatMetricType.name = heartbeatMetricName;
              heartbeatMetricType.description =
                "Synthetic heartbeat emitted by OneUptime each time the host's OTel collector ships a metric batch. Use `count > 0` over a window to detect host up/down.";
              heartbeatMetricType.unit = "1";
              heartbeatMetricType.services = [];
              metricNameServiceNameMap[heartbeatMetricName] =
                heartbeatMetricType;
            }
            /*
             * Only associate a real Service row (OpenTelemetry type).
             * The host heartbeat's primaryEntityId is a Host/DockerHost/
             * KubernetesCluster id, which has no matching Service row,
             * so pushing it would fail the MetricType.services FK. The
             * heartbeat MetricType is still cataloged above without a
             * service link.
             */
            if (
              serviceMetadata.primaryEntityType === ServiceType.OpenTelemetry &&
              metricNameServiceNameMap[heartbeatMetricName]!.services!.filter(
                (svc: Service) => {
                  return (
                    svc.id?.toString() ===
                    serviceMetadata.primaryEntityId!.toString()
                  );
                },
              ).length === 0
            ) {
              const heartbeatService: Service = new Service();
              heartbeatService.id = serviceMetadata.primaryEntityId!;
              metricNameServiceNameMap[heartbeatMetricName]!.services!.push(
                heartbeatService,
              );
            }
            /*
             * Stamp the heartbeat with the host's newest datapoint
             * timestamp in this payload, not the ingest wall clock.
             * Ingestion is queued (HTTP -> Redis -> worker), so
             * wall-clock stamping shifts heartbeats into whatever
             * minute the worker happened to drain the job in — two
             * batches draining in one minute leave the previous minute
             * empty, which the availability charts render as phantom
             * downtime while every real metric (which keeps its scrape
             * timestamp) looks perfectly continuous. Using the scrape
             * time keeps the heartbeat on the same timeline as the
             * metrics it vouches for.
             *
             * Clamped on both sides by the ingest clock: a batch
             * cannot have been scraped after it arrived (future-skewed
             * host clocks, batches with no datapoints), and backdating
             * is floored at HEARTBEAT_MAX_BACKDATE_MS — normal queue
             * lag is seconds, so anything older means a behind-skewed
             * host clock or a backlog replay, and an unbounded
             * backdate would paint a permanent false "down" tail on
             * the charts (the trailing buckets would never receive a
             * heartbeat). A floored stamp lands in the newest
             * evaluable Minute bucket, proving it up; the single
             * bucket between it and the chart's unevaluable trailing
             * shadow is rescued by the Minute-grid bridge — see the
             * invariant documented on HEARTBEAT_MAX_BACKDATE_MS.
             */
            const nowUnixNano: number =
              OneUptimeDate.getCurrentDateAsUnixNano();
            const maxBackdateNano: number =
              HEARTBEAT_MAX_BACKDATE_MS * 1_000_000;
            const maxDatapointTimeUnixNano: number | null =
              hostMaxDatapointTimeNano.get(heartbeatHostName) ?? null;
            const heartbeatTimeNano: string = Math.trunc(
              maxDatapointTimeUnixNano !== null
                ? Math.max(
                    Math.min(maxDatapointTimeUnixNano, nowUnixNano),
                    nowUnixNano - maxBackdateNano,
                  )
                : nowUnixNano,
            ).toString();
            const heartbeatRow: JSONObject = this.buildMetricRow({
              datapoint: {
                timeUnixNano: heartbeatTimeNano,
                asInt: 1,
              },
              baseAttributes: resourceAttributes,
              projectId: projectId,
              primaryEntityId: serviceMetadata.primaryEntityId!,
              serviceName: serviceName,
              metricName: heartbeatMetricName,
              metricPointType: MetricPointType.Gauge,
              serviceMetadata: serviceMetadata,
            });
            dbMetrics.push(heartbeatRow);
            totalMetricsProcessed++;
          }

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

                    /*
                     * MetricType.services is a ManyToMany to the
                     * Service table (join keyed on primaryEntityId). Only
                     * OpenTelemetry-type telemetry has a real Service
                     * row; associating Host / DockerHost /
                     * KubernetesCluster / Unknown telemetry here would
                     * insert a join row whose primaryEntityId has no matching
                     * Service and fail the FK. The metric name itself is
                     * still cataloged above (just without a service
                     * link), and the datapoints carry the primaryEntityId in
                     * ClickHouse regardless.
                     */
                    if (
                      serviceMetadata.primaryEntityType ===
                        ServiceType.OpenTelemetry &&
                      metricNameServiceNameMap[metricName]!.services!.filter(
                        (service: Service) => {
                          return (
                            service.id?.toString() ===
                            serviceMetadata.primaryEntityId!.toString()
                          );
                        },
                      ).length === 0
                    ) {
                      const newService: Service = new Service();
                      newService.id = serviceMetadata.primaryEntityId!;
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

                        if (
                          dockerHostId &&
                          DOCKER_SNAPSHOT_METRIC_NAMES.has(metricName)
                        ) {
                          this.bufferDockerSnapshotMetric({
                            hostIdStr: dockerHostId.toString(),
                            metricName,
                            metricUnit,
                            datapoint: datapoint as JSONObject,
                            metricAttributes,
                            buffer: dockerContainerMetricsBuffer,
                          });
                        }

                        if (
                          cloudResourceId &&
                          CLOUD_SNAPSHOT_METRIC_NAMES.has(metricName)
                        ) {
                          this.bufferCloudResourceSnapshotMetric({
                            cloudResourceIdStr: cloudResourceId.toString(),
                            metricName,
                            metricUnit,
                            datapoint: datapoint as JSONObject,
                            metricAttributes,
                            buffer: cloudResourceInstanceMetricsBuffer,
                          });
                        }

                        const metricRow: JSONObject = this.buildMetricRow({
                          datapoint: datapoint as JSONObject,
                          baseAttributes: metricAttributes,
                          projectId: projectId,
                          primaryEntityId: serviceMetadata.primaryEntityId!,
                          serviceName: serviceName,
                          metricName: metricName,
                          metricPointType: metricPointType,
                          aggregationTemporality: aggregationTemporality,
                          serviceMetadata: serviceMetadata,
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
                              serviceMetadata.primaryEntityId,
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

      await this.flushDockerSnapshotBuffer({
        projectId,
        buffer: dockerContainerMetricsBuffer,
      });

      await this.flushCloudResourceSnapshotBuffer({
        projectId,
        buffer: cloudResourceInstanceMetricsBuffer,
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
   * Docker-stats CPU → percent. The docker_stats receiver emits
   * `container.cpu.utilization` as a [0, 1] ratio (unit "1") or a raw
   * percent (unit "%"); scale accordingly. Kubernetes CPU uses
   * `cpuCoresToPercent` below, which divides cores by node allocatable.
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
   * Per-(cluster, node) allocatable CPU cores, learned from the
   * `k8s.node.allocatable_cpu` metric (k8s_cluster receiver). This is
   * the denominator that turns cores-valued `*.cpu.utilization` metrics
   * into a true percentage. In-memory and best-effort: it warms within
   * one collection interval and is shared across this worker's batches.
   */
  private static readonly NODE_ALLOCATABLE_TTL_MS: number = 30 * 60 * 1000;
  private static nodeAllocatableCpuByCluster: Map<
    string,
    Map<string, { cores: number; at: number }>
  > = new Map();

  private static updateNodeAllocatableCpu(
    clusterIdStr: string,
    nodeName: string,
    cores: number,
    atMs: number,
  ): void {
    if (!nodeName || !Number.isFinite(cores) || cores <= 0) {
      return;
    }
    let byNode: Map<string, { cores: number; at: number }> | undefined =
      this.nodeAllocatableCpuByCluster.get(clusterIdStr);
    if (!byNode) {
      byNode = new Map();
      this.nodeAllocatableCpuByCluster.set(clusterIdStr, byNode);
    }
    byNode.set(nodeName, { cores: cores, at: atMs });
  }

  /*
   * Resolve the allocatable CPU cores to divide by. Prefers the exact
   * node; falls back to the cluster's average node size when the node
   * hasn't been seen yet (e.g. a pod metric arriving before its node's
   * allocatable). Returns 0 when nothing is known, signalling the caller
   * to leave the stored CPU% untouched.
   */
  private static lookupNodeAllocatableCpu(
    clusterIdStr: string,
    nodeName: string,
    nowMs: number,
  ): number {
    const byNode: Map<string, { cores: number; at: number }> | undefined =
      this.nodeAllocatableCpuByCluster.get(clusterIdStr);
    if (!byNode || byNode.size === 0) {
      return 0;
    }
    const exact: { cores: number; at: number } | undefined = nodeName
      ? byNode.get(nodeName)
      : undefined;
    if (exact && nowMs - exact.at <= this.NODE_ALLOCATABLE_TTL_MS) {
      return exact.cores;
    }
    let sum: number = 0;
    let count: number = 0;
    for (const entry of byNode.values()) {
      if (nowMs - entry.at <= this.NODE_ALLOCATABLE_TTL_MS) {
        sum += entry.cores;
        count++;
      }
    }
    return count > 0 ? sum / count : 0;
  }

  /*
   * Convert a raw Kubernetes CPU datapoint to "% of the node's
   * allocatable CPU". The kubeletstats `*.cpu.utilization` metrics are
   * CPU *cores in use* (not a 0-1 ratio), so we divide by the node's
   * allocatable cores rather than multiplying by 100 — the old
   * behaviour produced numbers like 711% for a busy multi-core node. A
   * "%"-unit datapoint is taken as-is. Returns null when allocatable is
   * unknown so the snapshot keeps its previous CPU value instead of
   * writing a wrong one.
   */
  private static cpuCoresToPercent(
    rawValue: number,
    metricUnit: string | undefined,
    clusterIdStr: string,
    nodeName: string,
    nowMs: number,
  ): number | null {
    const unit: string = (metricUnit || "").trim();
    if (unit === "%") {
      return rawValue;
    }
    const allocatableCores: number = this.lookupNodeAllocatableCpu(
      clusterIdStr,
      nodeName,
      nowMs,
    );
    if (allocatableCores <= 0) {
      return null;
    }
    return (rawValue / allocatableCores) * 100;
  }

  /*
   * Per-(cluster, node) allocatable memory (bytes), learned from the
   * `k8s.node.allocatable_memory` metric (k8s_cluster receiver). The
   * memory analogue of the allocatable-CPU cache above: the denominator
   * that turns bytes-valued `*.memory.usage` metrics into a true
   * percentage. In-memory, best-effort, shared across this worker's
   * batches.
   */
  private static nodeAllocatableMemoryByCluster: Map<
    string,
    Map<string, { bytes: number; at: number }>
  > = new Map();

  private static updateNodeAllocatableMemory(
    clusterIdStr: string,
    nodeName: string,
    bytes: number,
    atMs: number,
  ): void {
    if (!nodeName || !Number.isFinite(bytes) || bytes <= 0) {
      return;
    }
    let byNode: Map<string, { bytes: number; at: number }> | undefined =
      this.nodeAllocatableMemoryByCluster.get(clusterIdStr);
    if (!byNode) {
      byNode = new Map();
      this.nodeAllocatableMemoryByCluster.set(clusterIdStr, byNode);
    }
    byNode.set(nodeName, { bytes: bytes, at: atMs });
  }

  /*
   * Resolve the allocatable memory bytes to divide by. Prefers the
   * exact node; falls back to the cluster's average node size when the
   * node hasn't been seen yet. Returns 0 when nothing is known,
   * signalling the caller to leave the stored memory% untouched.
   */
  private static lookupNodeAllocatableMemory(
    clusterIdStr: string,
    nodeName: string,
    nowMs: number,
  ): number {
    const byNode: Map<string, { bytes: number; at: number }> | undefined =
      this.nodeAllocatableMemoryByCluster.get(clusterIdStr);
    if (!byNode || byNode.size === 0) {
      return 0;
    }
    const exact: { bytes: number; at: number } | undefined = nodeName
      ? byNode.get(nodeName)
      : undefined;
    if (exact && nowMs - exact.at <= this.NODE_ALLOCATABLE_TTL_MS) {
      return exact.bytes;
    }
    let sum: number = 0;
    let count: number = 0;
    for (const entry of byNode.values()) {
      if (nowMs - entry.at <= this.NODE_ALLOCATABLE_TTL_MS) {
        sum += entry.bytes;
        count++;
      }
    }
    return count > 0 ? sum / count : 0;
  }

  /*
   * Convert a raw Kubernetes memory-usage datapoint (bytes) to "% of the
   * node's allocatable memory". Mirrors `cpuCoresToPercent`. Returns
   * null when allocatable memory is unknown so the snapshot keeps its
   * previous memory% instead of writing a wrong one.
   */
  private static memoryBytesToPercent(
    rawValue: number,
    clusterIdStr: string,
    nodeName: string,
    nowMs: number,
  ): number | null {
    const allocatableBytes: number = this.lookupNodeAllocatableMemory(
      clusterIdStr,
      nodeName,
      nowMs,
    );
    if (allocatableBytes <= 0) {
      return null;
    }
    return (rawValue / allocatableBytes) * 100;
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

    const nowMs: number = Date.now();

    /*
     * `k8s.node.allocatable_cpu` isn't a displayed snapshot metric — it
     * is the CPU% denominator. Cache its latest value per node and stop;
     * never fold it as a Node row.
     */
    if (data.metricName === K8S_NODE_ALLOCATABLE_CPU_METRIC) {
      this.updateNodeAllocatableCpu(
        data.clusterIdStr,
        this.readSnapshotAttr(attrs, "resource.k8s.node.name"),
        rawValue,
        nowMs,
      );
      return;
    }

    /*
     * `k8s.node.allocatable_memory` is the memory% denominator, not a
     * displayed Node row. Cache its latest value per node and stop.
     */
    if (data.metricName === K8S_NODE_ALLOCATABLE_MEMORY_METRIC) {
      this.updateNodeAllocatableMemory(
        data.clusterIdStr,
        this.readSnapshotAttr(attrs, "resource.k8s.node.name"),
        rawValue,
        nowMs,
      );
      return;
    }

    /*
     * The node a pod/container/node metric belongs to — the key for its
     * allocatable CPU denominator.
     */
    const nodeName: string = this.readSnapshotAttr(
      attrs,
      "resource.k8s.node.name",
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
          ? this.cpuCoresToPercent(
              rawValue,
              data.metricUnit,
              data.clusterIdStr,
              nodeName,
              nowMs,
            )
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
          ? this.cpuCoresToPercent(
              rawValue,
              data.metricUnit,
              data.clusterIdStr,
              nodeName,
              nowMs,
            )
          : null,
        memoryBytes: isMem ? Math.max(0, Math.trunc(rawValue)) : null,
        memoryPercent:
          isMem && rawValue >= 0
            ? this.memoryBytesToPercent(
                rawValue,
                data.clusterIdStr,
                nodeName,
                nowMs,
              )
            : null,
        observedAt: ts.date,
        controllerDeploymentName: deployName || null,
        controllerCronJobName: cronName || null,
      });
      return;
    }

    if (data.metricName.startsWith("k8s.node.")) {
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
          ? this.cpuCoresToPercent(
              rawValue,
              data.metricUnit,
              data.clusterIdStr,
              nodeName,
              nowMs,
            )
          : null,
        memoryBytes: isMem ? Math.max(0, Math.trunc(rawValue)) : null,
        memoryPercent:
          isMem && rawValue >= 0
            ? this.memoryBytesToPercent(
                rawValue,
                data.clusterIdStr,
                nodeName,
                nowMs,
              )
            : null,
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
    memoryPercent: number | null;
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
        memoryPercent: data.memoryPercent,
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
    if (data.memoryPercent !== null && data.observedAt >= existing.observedAt) {
      existing.memoryPercent = data.memoryPercent;
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
              memoryPercent: e.memoryPercent,
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

  /*
   * Match a Docker container metric to its row, fold the latest CPU
   * or memory point into the per-host buffer. Identical pattern to
   * the K8s buffering, but Docker has no separate inventory snapshot
   * stream — every metric flush both creates and updates rows in
   * one ON-CONFLICT statement.
   */
  private static bufferDockerSnapshotMetric(data: {
    hostIdStr: string;
    metricName: string;
    metricUnit: string | undefined;
    datapoint: JSONObject;
    metricAttributes: Dictionary<AttributeType | Array<AttributeType>>;
    buffer: Map<string, Map<string, DockerContainerMetricBufferEntry>>;
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
      "docker snapshot timeUnixNano",
    );

    const attrs: Dictionary<AttributeType | Array<AttributeType>> =
      data.metricAttributes;
    const containerName: string = this.readSnapshotAttr(
      attrs,
      "resource.container.name",
    );
    if (!containerName) {
      return;
    }
    const containerId: string =
      this.readSnapshotAttr(attrs, "resource.container.id") ||
      this.readSnapshotAttr(attrs, "container.id");
    const imageName: string =
      this.readSnapshotAttr(attrs, "resource.container.image.name") ||
      this.readSnapshotAttr(attrs, "container.image.name");

    const isCpu: boolean = data.metricName === "container.cpu.utilization";
    const isMem: boolean = data.metricName === "container.memory.usage.total";

    this.foldDockerContainerSnapshot({
      buffer: data.buffer,
      hostIdStr: data.hostIdStr,
      containerName,
      containerId: containerId || null,
      imageName: imageName || null,
      cpuPercent: isCpu
        ? this.cpuValueToPercent(rawValue, data.metricUnit)
        : null,
      memoryBytes: isMem ? Math.max(0, Math.trunc(rawValue)) : null,
      observedAt: ts.date,
    });
  }

  private static foldDockerContainerSnapshot(data: {
    buffer: Map<string, Map<string, DockerContainerMetricBufferEntry>>;
    hostIdStr: string;
    containerName: string;
    containerId: string | null;
    imageName: string | null;
    cpuPercent: number | null;
    memoryBytes: number | null;
    observedAt: Date;
  }): void {
    let perHost: Map<string, DockerContainerMetricBufferEntry> | undefined =
      data.buffer.get(data.hostIdStr);
    if (!perHost) {
      perHost = new Map();
      data.buffer.set(data.hostIdStr, perHost);
    }
    const key: string = data.containerName;
    const existing: DockerContainerMetricBufferEntry | undefined =
      perHost.get(key);
    if (!existing) {
      perHost.set(key, {
        containerName: data.containerName,
        containerId: data.containerId,
        imageName: data.imageName,
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
    /*
     * Container ID and image name don't change for the lifetime of a
     * container; first-non-null wins so later metrics missing the
     * attribute don't blank the row.
     */
    if (data.containerId && !existing.containerId) {
      existing.containerId = data.containerId;
    }
    if (data.imageName && !existing.imageName) {
      existing.imageName = data.imageName;
    }
  }

  private static async flushDockerSnapshotBuffer(data: {
    projectId: ObjectID;
    buffer: Map<string, Map<string, DockerContainerMetricBufferEntry>>;
  }): Promise<void> {
    if (data.buffer.size === 0) {
      return;
    }
    for (const [hostIdStr, byKey] of data.buffer.entries()) {
      if (byKey.size === 0) {
        continue;
      }
      try {
        const containers: Array<ParsedDockerContainer> = [];
        for (const e of byKey.values()) {
          containers.push({
            containerName: e.containerName,
            containerId: e.containerId,
            imageName: e.imageName,
            state: "running",
            cpuPercent: e.cpuPercent,
            memoryBytes: e.memoryBytes,
            observedAt: e.observedAt,
          });
        }
        await DockerResourceService.bulkUpsertContainers({
          projectId: data.projectId,
          dockerHostId: new ObjectID(hostIdStr),
          containers,
        });
      } catch (err) {
        logger.warn(
          `Docker snapshot writeback failed for host ${hostIdStr}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /*
   * Buffer the latest CPU / memory point for a managed-compute instance
   * (service.instance.id) so multiple datapoints across a batch collapse
   * into a single CloudResourceInstance upsert. Best-effort — anything
   * unparseable is skipped without affecting ClickHouse ingest.
   */
  private static bufferCloudResourceSnapshotMetric(data: {
    cloudResourceIdStr: string;
    metricName: string;
    metricUnit: string | undefined;
    datapoint: JSONObject;
    metricAttributes: Dictionary<AttributeType | Array<AttributeType>>;
    buffer: Map<string, Map<string, CloudResourceInstanceMetricBufferEntry>>;
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
      "cloud snapshot timeUnixNano",
    );

    const instanceName: string = this.readSnapshotAttr(
      data.metricAttributes,
      "resource.service.instance.id",
    );
    if (!instanceName) {
      return;
    }

    const isCpu: boolean = data.metricName === "container.cpu.utilization";
    const isMem: boolean =
      data.metricName === "container.memory.usage" ||
      data.metricName === "container.memory.usage.total";

    let perResource:
      | Map<string, CloudResourceInstanceMetricBufferEntry>
      | undefined = data.buffer.get(data.cloudResourceIdStr);
    if (!perResource) {
      perResource = new Map();
      data.buffer.set(data.cloudResourceIdStr, perResource);
    }

    const cpuPercent: number | null = isCpu
      ? this.cpuValueToPercent(rawValue, data.metricUnit)
      : null;
    const memoryBytes: number | null = isMem
      ? Math.max(0, Math.trunc(rawValue))
      : null;

    const existing: CloudResourceInstanceMetricBufferEntry | undefined =
      perResource.get(instanceName);
    if (!existing) {
      perResource.set(instanceName, {
        instanceName,
        cpuPercent,
        memoryBytes,
        observedAt: ts.date,
      });
      return;
    }
    if (cpuPercent !== null && ts.date >= existing.observedAt) {
      existing.cpuPercent = cpuPercent;
    }
    if (memoryBytes !== null && ts.date >= existing.observedAt) {
      existing.memoryBytes = memoryBytes;
    }
    if (ts.date > existing.observedAt) {
      existing.observedAt = ts.date;
    }
  }

  private static async flushCloudResourceSnapshotBuffer(data: {
    projectId: ObjectID;
    buffer: Map<string, Map<string, CloudResourceInstanceMetricBufferEntry>>;
  }): Promise<void> {
    if (data.buffer.size === 0) {
      return;
    }
    for (const [cloudResourceIdStr, byInstance] of data.buffer.entries()) {
      if (byInstance.size === 0) {
        continue;
      }
      try {
        const cloudResourceId: ObjectID = new ObjectID(cloudResourceIdStr);
        for (const e of byInstance.values()) {
          await CloudResourceInstanceService.recordInstance({
            projectId: data.projectId,
            cloudResourceId,
            instanceName: e.instanceName,
            cpuPercent: e.cpuPercent ?? undefined,
            memoryBytes: e.memoryBytes ?? undefined,
          });
        }
      } catch (err) {
        logger.warn(
          `Cloud resource instance snapshot writeback failed for ${cloudResourceIdStr}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private static buildMetricRow(data: {
    datapoint: JSONObject;
    baseAttributes: Dictionary<AttributeType | Array<AttributeType>>;
    projectId: ObjectID;
    primaryEntityId: ObjectID;
    serviceName: string;
    metricName: string;
    metricPointType: MetricPointType;
    aggregationTemporality?: OtelAggregationTemporality;
    isMonotonic?: boolean;
    serviceMetadata: TelemetryServiceMetadata;
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

    const retentionDays: number = resolveTelemetryRetentionInDays({
      pillar: "metrics",
      serviceConfig: data.serviceMetadata.serviceRetentionConfig,
      serviceRetentionInDays: data.serviceMetadata.serviceRetentionInDays,
      projectConfig: data.serviceMetadata.projectRetentionConfig,
      projectRetentionInDays: data.serviceMetadata.projectRetentionInDays,
    });
    const retentionDate: Date = OneUptimeDate.addRemoveDays(
      ingestionDate,
      retentionDays,
    );

    const row: JSONObject = {
      _id: ObjectID.generateTimeOrdered().toString(),
      createdAt: ingestionTimestamp,
      projectId: data.projectId.toString(),
      primaryEntityId: data.primaryEntityId.toString(),
      primaryEntityType: data.serviceMetadata.primaryEntityType,
      entityKeys: data.serviceMetadata.entityKeys || [],
      ...getScalarEntityKeyColumns(data.serviceMetadata),
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

  /*
   * Newest datapoint timestamp across a resource's scopeMetrics, used
   * to stamp the synthetic host heartbeat with the batch's own scrape
   * time instead of the ingest wall clock. Walks every OTLP data shape
   * (the proto's `oneof data`) but reads only `timeUnixNano`, so the
   * extra pass is cheap relative to the full ingest transform. Returns
   * null when the batch carries no parseable datapoint timestamps.
   */
  private static getMaxDatapointTimeUnixNano(
    scopeMetrics: JSONArray,
  ): number | null {
    if (!Array.isArray(scopeMetrics)) {
      return null;
    }
    let max: number | null = null;
    for (const scopeMetric of scopeMetrics) {
      const metrics: JSONArray | undefined = (scopeMetric as JSONObject)?.[
        "metrics"
      ] as JSONArray | undefined;
      if (!metrics || !Array.isArray(metrics)) {
        continue;
      }
      for (const metric of metrics) {
        const metricObject: JSONObject | null = metric as JSONObject | null;
        if (!metricObject) {
          continue;
        }
        const metricTypeWrapper: JSONObject | undefined =
          (metricObject["sum"] as JSONObject | undefined) ||
          (metricObject["gauge"] as JSONObject | undefined) ||
          (metricObject["histogram"] as JSONObject | undefined) ||
          (metricObject["exponentialHistogram"] as JSONObject | undefined) ||
          (metricObject["summary"] as JSONObject | undefined);
        const dataPoints: JSONArray | undefined = metricTypeWrapper?.[
          "dataPoints"
        ] as JSONArray | undefined;
        if (!dataPoints || !Array.isArray(dataPoints)) {
          continue;
        }
        for (const datapoint of dataPoints) {
          const raw: string | number | undefined = (datapoint as JSONObject)?.[
            "timeUnixNano"
          ] as string | number | undefined;
          let value: number | null = null;
          if (typeof raw === "number") {
            value = raw;
          } else if (typeof raw === "string") {
            value = Number.parseFloat(raw);
          }
          if (
            value !== null &&
            Number.isFinite(value) &&
            value > 0 &&
            (max === null || value > max)
          ) {
            max = value;
          }
        }
      }
    }
    return max;
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

  /*
   * OTLP/JSON sends exemplar trace/span ids as 16/32-char hex,
   * OTLP/protobuf as base64 — Text.convertOtlpIdToHex tells them apart
   * so hex ids are never base64-decoded into garbage, which would break
   * metric→trace exemplar navigation.
   */
  private static convertBase64ToHexSafe(value: string | undefined): string {
    return Text.convertOtlpIdToHex(value);
  }
}

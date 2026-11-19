import { KubernetesCostIngestJobData } from "./Queue/TelemetryQueueService";
import KubernetesClusterService from "Common/Server/Services/KubernetesClusterService";
import KubernetesCostAllocationService from "Common/Server/Services/KubernetesCostAllocationService";
import OpenTelemetryIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import TelemetryFanInWriter, {
  FanInSubmitResult,
  pushObservedAck,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { keyForKubernetesCluster } from "Common/Utils/Telemetry/EntityKey";
import {
  KubernetesCostAllocationIngestRow,
  KubernetesCostIngestPayload,
} from "Common/Types/Kubernetes/KubernetesCostIngest";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import { JSONObject } from "Common/Types/JSON";
import Dictionary from "Common/Types/Dictionary";
import logger from "Common/Server/Utils/Logger";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import MetricService from "Common/Server/Services/MetricService";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import {
  AggregationTemporality,
  MetricPointType,
} from "Common/Models/AnalyticsModels/Metric";
import { resolveTelemetryRetentionInDays } from "Common/Types/Telemetry/TelemetryRetentionConfig";
import {
  KUBERNETES_COST_METRICS,
  KubernetesCostMetricPoint,
  KubernetesCostMetricSourceRow,
  buildKubernetesCostMetricPoints,
  getKubernetesCostMetricDescription,
  getKubernetesCostMetricUnit,
  isKubernetesCostMoneyMetric,
} from "Common/Types/Kubernetes/KubernetesCostMetrics";
import { writeOwnValue } from "Common/Utils/LookupTable";
import {
  KubernetesCostEfficiencyRow,
  getKubernetesCostEfficiencyWeight,
  getKubernetesCostWeightedEfficiency,
} from "Common/Types/Kubernetes/KubernetesCostEfficiency";

/** Rows per fan-in submission — same order of magnitude as exceptions. */
const KUBERNETES_COST_FLUSH_BATCH_SIZE: number = 500;

/** Defensive caps so one malformed payload can't bloat a row. */
const MAX_STRING_LENGTH: number = 512;
const MAX_LABELS_PER_ROW: number = 100;

export class KubernetesCostStorageFlushError extends Error {
  public constructor(cause: Error) {
    super(
      `Kubernetes cost ingest failed to flush rows to storage: ${cause.message}`,
    );
    this.name = "KubernetesCostStorageFlushError";
  }
}

interface BuiltCostRow {
  row: JSONObject;
  metricSource: KubernetesCostMetricSourceRow;
}

export default class KubernetesCostIngestService {
  /*
   * (project, unit) pairs this process has put the cost metrics in the
   * metric catalog for, so a busy cluster registers them once, not on every
   * window.
   */
  private static registeredCatalogs: Set<string> = new Set<string>();

  // Tests: forget which catalogs this process has registered.
  public static resetCatalogRegistrationsForTests(): void {
    this.registeredCatalogs.clear();
  }

  private static sanitizeString(value: unknown): string {
    if (typeof value !== "string") {
      return "";
    }
    return value.slice(0, MAX_STRING_LENGTH);
  }

  private static sanitizeNumber(value: unknown): number {
    const num: number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(num)) {
      return 0;
    }
    return num;
  }

  /*
   * OneUptimeDate.fromString THROWS on unparseable input. One malformed
   * row must only drop that row — never fail the whole job into a BullMQ
   * retry loop — so window parsing goes through this null-on-invalid
   * wrapper.
   */
  private static parseDate(value: unknown): Date | null {
    if (!value || typeof value !== "string") {
      return null;
    }
    try {
      const date: Date = OneUptimeDate.fromString(value);
      if (isNaN(date.getTime())) {
        return null;
      }
      return date;
    } catch {
      return null;
    }
  }

  private static sanitizeLabels(value: unknown): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }

    const labels: Record<string, string> = {};
    let count: number = 0;

    /*
     * A label is the workload's, named as Kubernetes allows: written as the
     * map's own key, so one named "__proto__" is stored like any other (an
     * assignment dropped it, though it still counted toward the cap).
     */
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (count >= MAX_LABELS_PER_ROW) {
        break;
      }
      if (!key) {
        continue;
      }
      writeOwnValue(
        labels,
        key.slice(0, MAX_STRING_LENGTH),
        typeof raw === "string"
          ? raw.slice(0, MAX_STRING_LENGTH)
          : String(raw ?? "").slice(0, MAX_STRING_LENGTH),
      );
      count++;
    }

    return labels;
  }

  @CaptureSpan()
  public static async processFromQueue(
    jobData: KubernetesCostIngestJobData,
  ): Promise<void> {
    const projectId: ObjectID = new ObjectID(jobData.projectId);
    const payload: KubernetesCostIngestPayload =
      jobData.costPayload as unknown as KubernetesCostIngestPayload;

    const clusterName: string = (payload.clusterName || "").trim();

    if (!clusterName || !Array.isArray(payload.allocations)) {
      logger.warn(
        "KubernetesCostIngestService: dropping malformed cost payload (missing clusterName or allocations).",
      );
      return;
    }

    const cluster: KubernetesCluster =
      await KubernetesClusterService.findOrCreateByClusterIdentifier({
        projectId,
        clusterIdentifier: clusterName,
      });

    if (!cluster.id) {
      throw new Error(
        `KubernetesCostIngestService: could not resolve cluster "${clusterName}" for project ${projectId.toString()}`,
      );
    }

    await KubernetesClusterService.updateLastSeen(cluster.id);

    /*
     * Retention mirrors every other telemetry pillar: the cluster's own
     * retainTelemetryDataForDays when set, else the project default.
     */
    const serviceMetadata: TelemetryServiceMetadata =
      await OpenTelemetryIngestService.buildResourceMetadataForNonService({
        serviceName: clusterName,
        resourceId: cluster.id,
        primaryEntityType: ServiceType.KubernetesCluster,
        projectId,
      });

    const retentionDays: number = serviceMetadata.dataRententionInDays;

    const clusterIdentifier: string = cluster.clusterIdentifier || clusterName;
    const k8sClusterEntityKey: string = keyForKubernetesCluster(
      projectId.toString(),
      clusterIdentifier,
    );

    const currency: string = this.sanitizeString(payload.currency);

    const ingestionDate: Date = OneUptimeDate.getCurrentDate();
    const ingestionTimestamp: string =
      OneUptimeDate.toClickhouseDateTime(ingestionDate);

    /*
     * Restart idempotency: the poller's checkpoint is in-memory, so after a
     * restart it re-ships its lookback windows. A window a PREVIOUS shipment
     * already delivered must not be re-inserted or spend double-counts.
     *
     * "Previous shipment", not "already has rows": a window wider than the
     * agent's batch size is delivered as several requests, each its own job,
     * so the plain has-rows test dropped every chunk after the first and left
     * large clusters permanently short of most of every hour. The agent
     * stamps each request with a content hash of the window (identical
     * across restarts) plus the request's index within that delivery, which
     * separates the two cases. BullMQ retries of THIS job remain covered by
     * the insert-dedup tokens (see ProcessTelemetry).
     */
    const shipmentId: string = this.sanitizeString(payload.shipmentId);
    const shipmentChunk: number = this.sanitizeNumber(payload.shipmentChunk);

    const alreadyIngestedWindows: Set<string> = new Set<string>();
    const distinctWindowStarts: Map<string, Date> = new Map<string, Date>();

    for (const allocation of payload.allocations) {
      if (!allocation || typeof allocation !== "object") {
        continue;
      }
      const windowStart: Date | null = this.parseDate(allocation.windowStart);
      if (!windowStart) {
        continue;
      }
      distinctWindowStarts.set(
        OneUptimeDate.toClickhouseDateTime(windowStart),
        windowStart,
      );
    }

    for (const [windowKey, windowStart] of distinctWindowStarts) {
      const alreadyIngested: boolean = await this.isWindowAlreadyIngested({
        projectId: projectId,
        kubernetesClusterId: cluster.id,
        windowStart: windowStart,
        shipmentId: shipmentId,
        shipmentChunk: shipmentChunk,
      });

      if (alreadyIngested) {
        alreadyIngestedWindows.add(windowKey);
        logger.debug(
          `KubernetesCostIngestService: window ${windowKey} for cluster "${clusterName}" was already ingested by another shipment — skipping its rows.`,
        );
      }
    }

    const rows: Array<JSONObject> = [];
    const metricSourceRows: Array<KubernetesCostMetricSourceRow> = [];

    for (const allocation of payload.allocations) {
      const built: BuiltCostRow | null = this.buildRow({
        allocation,
        projectId,
        kubernetesClusterId: cluster.id,
        clusterName: clusterIdentifier,
        k8sClusterEntityKey,
        currency,
        shipmentId,
        shipmentChunk,
        retentionDays,
        ingestionTimestamp,
        alreadyIngestedWindows,
      });

      if (built) {
        rows.push(built.row);
        metricSourceRows.push(built.metricSource);
      }
    }

    if (rows.length === 0) {
      return;
    }

    /*
     * Ack-after-flush, same contract as the OTel ingest services: the job
     * only succeeds once every batch containing its rows durably landed,
     * so a failed insert fails the job and BullMQ re-processes the
     * payload (insert-dedup tokens make the retry idempotent).
     */
    const pendingAcks: Array<Promise<void>> = [];

    while (rows.length > 0) {
      const batch: Array<JSONObject> = rows.splice(
        0,
        Math.min(rows.length, KUBERNETES_COST_FLUSH_BATCH_SIZE),
      );

      const submission: FanInSubmitResult = await TelemetryFanInWriter.submit(
        KubernetesCostAllocationService,
        batch,
      );
      pushObservedAck(pendingAcks, submission.flushed, (error: Error) => {
        return new KubernetesCostStorageFlushError(error);
      });
    }

    await Promise.all(pendingAcks);

    /*
     * The cost metrics (Common/Types/Kubernetes/KubernetesCostMetrics), only
     * once the rows they are worked out from have landed, and only from
     * those rows: a window another shipment already delivered made its
     * metrics then.
     *
     * Best effort, never the job's failure. A retry would find this chunk
     * stored and skip it, metrics and all, so failing the job here could
     * not write them - it would only put the allocation rows through a
     * retry they do not need. A lost write costs a chart and a monitor one
     * window of one batch; a write made twice would double the cost they
     * read, which is why the metrics follow the rows rather than lead them.
     */
    await this.writeCostMetrics({
      projectId: projectId,
      kubernetesClusterId: cluster.id,
      clusterName: clusterIdentifier,
      k8sClusterEntityKey: k8sClusterEntityKey,
      currency: currency,
      serviceMetadata: serviceMetadata,
      ingestionTimestamp: ingestionTimestamp,
      sourceRows: metricSourceRows,
    });
  }

  /*
   * One metric row per point: a Delta Sum for a cost, a Gauge for
   * efficiency, stamped at its window's start (its window's end is when the
   * cost stopped accruing), under the cluster, with the cluster's entity key
   * so the cluster's Metrics page and every entity-scoped query find it.
   */
  public static buildMetricRows(data: {
    points: Array<KubernetesCostMetricPoint>;
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    k8sClusterEntityKey: string;
    retentionDays: number;
    ingestionTimestamp: string;
  }): Array<JSONObject> {
    return data.points.map((point: KubernetesCostMetricPoint): JSONObject => {
      const isCost: boolean = isKubernetesCostMoneyMetric(point.metric);
      const time: string = OneUptimeDate.toClickhouseDateTime(
        point.windowStart,
      );
      const timeUnixNano: string = OneUptimeDate.toUnixNano(
        point.windowStart,
      ).toString();

      return {
        _id: ObjectID.generateTimeOrdered().toString(),
        createdAt: data.ingestionTimestamp,
        projectId: data.projectId.toString(),
        primaryEntityId: data.kubernetesClusterId.toString(),
        primaryEntityType: ServiceType.KubernetesCluster,
        entityKeys: [data.k8sClusterEntityKey],
        k8sClusterEntityKey: data.k8sClusterEntityKey,
        name: point.metric,
        aggregationTemporality: isCost ? AggregationTemporality.Delta : null,
        metricPointType: isCost ? MetricPointType.Sum : MetricPointType.Gauge,
        time: time,
        startTime: time,
        timeUnixNano: timeUnixNano,
        startTimeUnixNano: timeUnixNano,
        attributes: point.attributes,
        attributeKeys: TelemetryUtil.getAttributeKeys(point.attributes),
        // A refund or a reconciliation can bring a window's cost down.
        isMonotonic: isCost ? false : null,
        count: null,
        sum: null,
        min: null,
        max: null,
        bucketCounts: [],
        explicitBounds: [],
        value: point.value,
        retentionDate: OneUptimeDate.toClickhouseDateTime(
          OneUptimeDate.addRemoveDurationInDays(
            point.windowStart,
            data.retentionDays,
          ),
        ),
      } as JSONObject;
    });
  }

  private static async writeCostMetrics(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    clusterName: string;
    k8sClusterEntityKey: string;
    currency: string;
    serviceMetadata: TelemetryServiceMetadata;
    ingestionTimestamp: string;
    sourceRows: Array<KubernetesCostMetricSourceRow>;
  }): Promise<void> {
    try {
      const points: Array<KubernetesCostMetricPoint> =
        buildKubernetesCostMetricPoints({
          clusterName: data.clusterName,
          rows: data.sourceRows,
        });

      if (points.length === 0) {
        return;
      }

      // Kept as long as the cluster's other metrics.
      const retentionDays: number = resolveTelemetryRetentionInDays({
        pillar: "metrics",
        serviceConfig: data.serviceMetadata.serviceRetentionConfig,
        serviceRetentionInDays: data.serviceMetadata.serviceRetentionInDays,
        projectConfig: data.serviceMetadata.projectRetentionConfig,
        projectRetentionInDays: data.serviceMetadata.projectRetentionInDays,
      });

      await MetricService.insertJsonRows(
        this.buildMetricRows({
          points: points,
          projectId: data.projectId,
          kubernetesClusterId: data.kubernetesClusterId,
          k8sClusterEntityKey: data.k8sClusterEntityKey,
          retentionDays: retentionDays,
          ingestionTimestamp: data.ingestionTimestamp,
        }),
      );

      await this.registerCostMetrics({
        projectId: data.projectId,
        currency: data.currency,
      });
    } catch (err) {
      logger.error(
        `KubernetesCostIngestService: could not write the cost metrics of cluster "${data.clusterName}" for project ${data.projectId.toString()}.`,
      );
      logger.error(err);
    }
  }

  /*
   * Put the cost metrics in the project's metric catalog, with what each
   * one is and its unit, so the Metrics explorer, dashboards and monitors
   * list them by name. Once a process for each project and currency.
   */
  private static async registerCostMetrics(data: {
    projectId: ObjectID;
    currency: string;
  }): Promise<void> {
    const key: string = JSON.stringify([
      data.projectId.toString(),
      data.currency,
    ]);

    if (this.registeredCatalogs.has(key)) {
      return;
    }

    const map: Dictionary<MetricType> = {};

    for (const metric of KUBERNETES_COST_METRICS) {
      const metricType: MetricType = new MetricType();
      metricType.name = metric;
      metricType.description = getKubernetesCostMetricDescription(metric);
      metricType.unit = getKubernetesCostMetricUnit({
        metric: metric,
        currency: data.currency,
      });

      if (isKubernetesCostMoneyMetric(metric)) {
        metricType.aggregationTemporality = AggregationTemporality.Delta;
        metricType.isMonotonic = false;
      }

      map[metric] = metricType;
    }

    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: data.projectId,
      metricNameServiceNameMap: map,
    });

    this.registeredCatalogs.add(key);
  }

  /**
   * Whether this window's rows have already been ingested by a DIFFERENT
   * shipment, or this exact chunk of the current one has already landed.
   */
  private static async isWindowAlreadyIngested(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    windowStart: Date;
    shipmentId: string;
    shipmentChunk: number;
  }): Promise<boolean> {
    if (!data.shipmentId) {
      /*
       * An agent older than the shipment contract cannot say which delivery
       * this is, so fall back to the original whole-window guard: correct
       * against double-counting, and no worse than what that agent got
       * before. Such an agent still loses rows past its first chunk on a
       * window wider than its batch size — that half of the fix ships in the
       * agent, so both sides have to be upgraded to get it.
       */
      return await KubernetesCostAllocationService.existsBy({
        query: {
          projectId: data.projectId,
          kubernetesClusterId: data.kubernetesClusterId,
          windowStart: data.windowStart,
        },
        props: { isRoot: true },
      });
    }

    /*
     * A row from a different shipment means an earlier delivery already
     * covered this window — the poller only advances its checkpoint once a
     * whole window has shipped, so anything it re-sends is a restart's
     * lookback, not a continuation. Re-inserting would double-count spend.
     */
    const fromAnotherShipment: boolean =
      await KubernetesCostAllocationService.existsBy({
        query: {
          projectId: data.projectId,
          kubernetesClusterId: data.kubernetesClusterId,
          windowStart: data.windowStart,
          shipmentId: new NotEqual<string>(data.shipmentId),
        },
        props: { isRoot: true },
      });

    if (fromAnotherShipment) {
      return true;
    }

    /*
     * Same shipment, so this is another chunk of a delivery in progress —
     * accept it unless this exact chunk already landed, which is what a
     * re-ship of a window whose later chunks failed looks like.
     */
    return await KubernetesCostAllocationService.existsBy({
      query: {
        projectId: data.projectId,
        kubernetesClusterId: data.kubernetesClusterId,
        windowStart: data.windowStart,
        shipmentId: data.shipmentId,
        shipmentChunk: data.shipmentChunk,
      },
      props: { isRoot: true },
    });
  }

  private static buildRow(data: {
    allocation: KubernetesCostAllocationIngestRow;
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    clusterName: string;
    k8sClusterEntityKey: string;
    currency: string;
    shipmentId: string;
    shipmentChunk: number;
    retentionDays: number;
    ingestionTimestamp: string;
    alreadyIngestedWindows: Set<string>;
  }): BuiltCostRow | null {
    const allocation: KubernetesCostAllocationIngestRow = data.allocation;

    if (!allocation || typeof allocation !== "object") {
      return null;
    }

    const windowStart: Date | null = this.parseDate(allocation.windowStart);
    const windowEnd: Date | null = this.parseDate(allocation.windowEnd);

    if (!windowStart || !windowEnd) {
      // A row without a valid window can't be charted — drop it.
      return null;
    }

    const windowKey: string = OneUptimeDate.toClickhouseDateTime(windowStart);
    if (data.alreadyIngestedWindows.has(windowKey)) {
      return null;
    }

    const labels: Record<string, string> = this.sanitizeLabels(
      allocation.labels,
    );

    const retentionDate: Date = OneUptimeDate.addRemoveDurationInDays(
      windowStart,
      data.retentionDays,
    );

    const row: JSONObject = {
      _id: ObjectID.generateTimeOrdered().toString(),
      createdAt: data.ingestionTimestamp,
      projectId: data.projectId.toString(),
      kubernetesClusterId: data.kubernetesClusterId.toString(),
      clusterName: data.clusterName,
      k8sClusterEntityKey: data.k8sClusterEntityKey,
      windowStart: OneUptimeDate.toClickhouseDateTime(windowStart),
      windowEnd: OneUptimeDate.toClickhouseDateTime(windowEnd),
      namespace: this.sanitizeString(allocation.namespace),
      controllerKind: this.sanitizeString(
        allocation.controllerKind,
      ).toLowerCase(),
      controllerName: this.sanitizeString(allocation.controllerName),
      podName: this.sanitizeString(allocation.podName),
      containerName: this.sanitizeString(allocation.containerName),
      nodeName: this.sanitizeString(allocation.nodeName),
      providerId: this.sanitizeString(allocation.providerId),
      labels: labels,
      labelKeys: Object.keys(labels),
      cpuCoreHours: this.sanitizeNumber(allocation.cpuCoreHours),
      cpuCoreRequestAverage: this.sanitizeNumber(
        allocation.cpuCoreRequestAverage,
      ),
      cpuCoreUsageAverage: this.sanitizeNumber(allocation.cpuCoreUsageAverage),
      cpuCoreLimitAverage: this.sanitizeNumber(allocation.cpuCoreLimitAverage),
      cpuCost: this.sanitizeNumber(allocation.cpuCost),
      gpuHours: this.sanitizeNumber(allocation.gpuHours),
      gpuCost: this.sanitizeNumber(allocation.gpuCost),
      ramByteHours: this.sanitizeNumber(allocation.ramByteHours),
      ramBytesRequestAverage: this.sanitizeNumber(
        allocation.ramBytesRequestAverage,
      ),
      ramBytesUsageAverage: this.sanitizeNumber(
        allocation.ramBytesUsageAverage,
      ),
      ramBytesLimitAverage: this.sanitizeNumber(
        allocation.ramBytesLimitAverage,
      ),
      ramBytesUsageMax: this.sanitizeNumber(allocation.ramBytesUsageMax),
      ramCost: this.sanitizeNumber(allocation.ramCost),
      pvByteHours: this.sanitizeNumber(allocation.pvByteHours),
      pvCost: this.sanitizeNumber(allocation.pvCost),
      networkCost: this.sanitizeNumber(allocation.networkCost),
      loadBalancerCost: this.sanitizeNumber(allocation.loadBalancerCost),
      sharedCost: this.sanitizeNumber(allocation.sharedCost),
      externalCost: this.sanitizeNumber(allocation.externalCost),
      totalCost: this.sanitizeNumber(allocation.totalCost),
      cpuEfficiency: this.sanitizeNumber(allocation.cpuEfficiency),
      ramEfficiency: this.sanitizeNumber(allocation.ramEfficiency),
      totalEfficiency: this.sanitizeNumber(allocation.totalEfficiency),
      currency: data.currency,
      shipmentId: data.shipmentId,
      shipmentChunk: data.shipmentChunk,
      retentionDate: OneUptimeDate.toClickhouseDateTime(retentionDate),
    };

    /*
     * What the row counts for in every cost-weighted efficiency, worked out
     * from the values as stored (Common/Types/Kubernetes/
     * KubernetesCostEfficiency): the same figures the columns' DEFAULT
     * expressions give a row stored before them.
     */
    const efficiencySource: KubernetesCostEfficiencyRow = {
      namespace: row["namespace"] as string,
      cpuCost: row["cpuCost"] as number,
      ramCost: row["ramCost"] as number,
      totalEfficiency: row["totalEfficiency"] as number,
    };
    row["efficiencyWeight"] =
      getKubernetesCostEfficiencyWeight(efficiencySource);
    row["weightedEfficiency"] =
      getKubernetesCostWeightedEfficiency(efficiencySource);

    // What the cost metrics read of it, as stored.
    const metricSource: KubernetesCostMetricSourceRow = {
      windowStart: windowStart,
      windowEnd: windowEnd,
      namespace: row["namespace"] as string,
      controllerKind: row["controllerKind"] as string,
      controllerName: row["controllerName"] as string,
      podName: row["podName"] as string,
      totalCost: row["totalCost"] as number,
      cpuCost: row["cpuCost"] as number,
      ramCost: row["ramCost"] as number,
      totalEfficiency: row["totalEfficiency"] as number,
    };

    return { row: row, metricSource: metricSource };
  }
}

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
import { JSONObject } from "Common/Types/JSON";
import PositiveNumber from "Common/Types/PositiveNumber";
import logger from "Common/Server/Utils/Logger";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";

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

export default class KubernetesCostIngestService {
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

    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (count >= MAX_LABELS_PER_ROW) {
        break;
      }
      if (!key) {
        continue;
      }
      labels[key.slice(0, MAX_STRING_LENGTH)] =
        typeof raw === "string"
          ? raw.slice(0, MAX_STRING_LENGTH)
          : String(raw ?? "").slice(0, MAX_STRING_LENGTH);
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
     * restart it re-ships its lookback windows. A window that already has
     * rows for this cluster was fully shipped before (the poller ships whole
     * windows and only advances its checkpoint on success) — re-inserting it
     * would double-count spend, so drop those allocations here. BullMQ
     * retries of THIS job are covered separately by the insert-dedup tokens
     * (see ProcessTelemetry), which make re-inserts of the same batch no-ops.
     */
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
      const existing: PositiveNumber =
        await KubernetesCostAllocationService.countBy({
          query: {
            projectId: projectId,
            kubernetesClusterId: cluster.id,
            windowStart: windowStart,
          } as JSONObject,
          props: { isRoot: true },
        });

      if (existing.toNumber() > 0) {
        alreadyIngestedWindows.add(windowKey);
        logger.debug(
          `KubernetesCostIngestService: window ${windowKey} for cluster "${clusterName}" already ingested — skipping ${existing.toNumber()} pre-existing rows' window.`,
        );
      }
    }

    const rows: Array<JSONObject> = [];

    for (const allocation of payload.allocations) {
      const row: JSONObject | null = this.buildRow({
        allocation,
        projectId,
        kubernetesClusterId: cluster.id,
        clusterName: clusterIdentifier,
        k8sClusterEntityKey,
        currency,
        retentionDays,
        ingestionTimestamp,
        alreadyIngestedWindows,
      });

      if (row) {
        rows.push(row);
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
  }

  private static buildRow(data: {
    allocation: KubernetesCostAllocationIngestRow;
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    clusterName: string;
    k8sClusterEntityKey: string;
    currency: string;
    retentionDays: number;
    ingestionTimestamp: string;
    alreadyIngestedWindows: Set<string>;
  }): JSONObject | null {
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

    const retentionDate: Date = OneUptimeDate.addRemoveDays(
      windowStart,
      data.retentionDays,
    );

    return {
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
      retentionDate: OneUptimeDate.toClickhouseDateTime(retentionDate),
    };
  }
}

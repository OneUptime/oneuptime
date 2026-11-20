import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import { getTelemetryIngestionBudgetSignalForSurface } from "Common/Server/Utils/Telemetry/TelemetryIngestionBudgetHttp";
import logger, {
  getLogAttributesFromRequest,
  type RequestLike,
} from "Common/Server/Utils/Logger";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import { TelemetryIngestionBudgetSignal } from "Common/Types/Telemetry/TelemetryIngestionBudget";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import { CompatibleQueueUnavailableError } from "../Utils/Compatible/CompatibleIngestFailure";
import TelemetryQueueService from "./Queue/TelemetryQueueService";

/*
 * QUEUEING WHAT A COMPATIBLE ENDPOINT WAS SENT.
 *
 * Each compatible endpoint (Prometheus remote write, Loki, Splunk HEC,
 * Datadog, Sentry) turns its request into up to three OTLP export requests
 * in OTLP's JSON encoding - logs, metrics, traces - and hands them here.
 * Each non-empty one is queued as its own job, exactly as an OTLP/HTTP
 * export of that signal is (TelemetryQueueService), so the worker cannot
 * tell them apart from what an OpenTelemetry SDK sends.
 *
 * INGESTION BUDGETS
 *
 * A surface that only ever carries one signal (remote write: metrics;
 * Loki: logs) is checked against that signal's budget at the door
 * (TelemetryIngestionBudgetHttp's DEFERRED_BODY_SURFACES), and its job
 * carries the pending charge the queue settles at the size it stores. A
 * surface that can carry several (a HEC batch of logs and metric events, a
 * Sentry envelope of an error and its logs) is not: each job is counted
 * against its own signal's budget as it is queued, and one over a used-up
 * budget is dropped there. A job of another signal than the door checked
 * never takes the door's charge.
 *
 * A budget counts a request at the size of its body decompressed, as it
 * counts an OTLP export - not at the size of the OTLP JSON it becomes,
 * which can be several times larger. An endpoint hands that size in
 * (ingestBytes): the request's, which the signals it is queued as share in
 * proportion to the records each became (a request of one signal is
 * counted at all of it), or each signal's own, where the endpoint knows
 * which bytes became what (a Sentry envelope's items). Each job is counted
 * at its share - the door's charge settled at it, or its own budget
 * checked with it - and carries it for the worker to share out over the
 * batch's services, teams and labels (TelemetryIngestAttribution), so every
 * budget counts the same bytes, and a request is counted once in all.
 */

export interface CompatibleOtlpBatch {
  // An ExportLogsServiceRequest: { resourceLogs: [...] }.
  logs?: JSONObject | null | undefined;
  // An ExportMetricsServiceRequest: { resourceMetrics: [...] }.
  metrics?: JSONObject | null | undefined;
  // An ExportTraceServiceRequest: { resourceSpans: [...] }.
  traces?: JSONObject | null | undefined;
}

export interface CompatibleEnqueueResult {
  queuedLogs: boolean;
  queuedMetrics: boolean;
  queuedTraces: boolean;
}

// Each signal's own bytes of a request, decompressed.
export interface CompatibleSignalBytes {
  logs?: number | undefined;
  metrics?: number | undefined;
  traces?: number | undefined;
}

/*
 * The size of a request's body decompressed, to be shared out over the
 * signals it is queued as - or each signal's own.
 */
export type CompatibleIngestBytes = number | CompatibleSignalBytes;

type CompatibleSignal = keyof CompatibleSignalBytes;

type ResourceKey = "resourceLogs" | "resourceMetrics" | "resourceSpans";

interface SignalJob {
  signal: CompatibleSignal;
  payload: JSONObject;
  productType: ProductType;
  enqueue: (req: TelemetryRequest) => Promise<void>;
}

const RESOURCE_KEYS: Record<CompatibleSignal, ResourceKey> = {
  logs: "resourceLogs",
  metrics: "resourceMetrics",
  traces: "resourceSpans",
};

// The datapoints of every shape an OTLP metric can carry them in.
const METRIC_SHAPES: ReadonlyArray<string> = [
  "gauge",
  "sum",
  "histogram",
  "exponentialHistogram",
  "summary",
];

export default class CompatibleIngestService {
  // Whether an export request holds anything: a non-empty resource list.
  public static hasContent(
    payload: JSONObject | null | undefined,
    resourceKey: "resourceLogs" | "resourceMetrics" | "resourceSpans",
  ): payload is JSONObject {
    if (!payload) {
      return false;
    }

    const resources: unknown = payload[resourceKey];

    return Array.isArray(resources) && (resources as JSONArray).length > 0;
  }

  /*
   * How many records an export request holds: log records, metric
   * datapoints or spans. Only array lengths are read.
   */
  public static recordCount(
    payload: JSONObject,
    resourceKey: ResourceKey,
  ): number {
    let count: number = 0;

    for (const resource of CompatibleIngestService.objectsOf(
      payload[resourceKey],
    )) {
      if (resourceKey === "resourceLogs") {
        for (const scope of CompatibleIngestService.objectsOf(
          resource["scopeLogs"],
        )) {
          count += CompatibleIngestService.lengthOf(scope["logRecords"]);
        }
      } else if (resourceKey === "resourceSpans") {
        for (const scope of CompatibleIngestService.objectsOf(
          resource["scopeSpans"],
        )) {
          count += CompatibleIngestService.lengthOf(scope["spans"]);
        }
      } else {
        for (const scope of CompatibleIngestService.objectsOf(
          resource["scopeMetrics"],
        )) {
          for (const metric of CompatibleIngestService.objectsOf(
            scope["metrics"],
          )) {
            for (const shape of METRIC_SHAPES) {
              const data: unknown = metric[shape];

              if (data && typeof data === "object") {
                count += CompatibleIngestService.lengthOf(
                  (data as JSONObject)["dataPoints"],
                );
              }
            }
          }
        }
      }
    }

    return count;
  }

  /*
   * Each job's share of the request's bytes, in the jobs' order. Given the
   * request's size, it is shared in proportion to their records - at least
   * one each, so no job is counted at nothing - the remainder going to the
   * largest fractions, so the shares add up to the size exactly. Given each
   * signal's own, each job takes its signal's. undefined where a job has
   * none: it is counted at the OTLP JSON it is queued as.
   */
  public static shareIngestBytes(
    jobs: ReadonlyArray<{ signal: CompatibleSignal; records: number }>,
    ingestBytes: CompatibleIngestBytes | undefined,
  ): Array<number | undefined> {
    if (ingestBytes && typeof ingestBytes === "object") {
      return jobs.map(
        (job: { signal: CompatibleSignal }): number | undefined => {
          const bytes: number | undefined = ingestBytes[job.signal];

          return CompatibleIngestService.isSize(bytes)
            ? Math.floor(bytes)
            : undefined;
        },
      );
    }

    if (!CompatibleIngestService.isSize(ingestBytes)) {
      return jobs.map((): undefined => {
        return undefined;
      });
    }

    const total: number = Math.floor(ingestBytes);
    const weights: Array<number> = jobs.map(
      (job: { records: number }): number => {
        return Math.max(1, job.records);
      },
    );
    const weightSum: number = weights.reduce(
      (sum: number, weight: number): number => {
        return sum + weight;
      },
      0,
    );
    const exact: Array<number> = weights.map((weight: number): number => {
      return (total * weight) / weightSum;
    });
    const shares: Array<number> = exact.map((share: number): number => {
      return Math.floor(share);
    });
    let remainder: number =
      total -
      shares.reduce((sum: number, share: number): number => {
        return sum + share;
      }, 0);

    // Largest fractions first; a tie goes to the earlier job.
    const order: Array<number> = shares
      .map((_share: number, index: number): number => {
        return index;
      })
      .sort((a: number, b: number): number => {
        return exact[b]! - shares[b]! - (exact[a]! - shares[a]!) || a - b;
      });

    for (const index of order) {
      if (remainder <= 0) {
        break;
      }

      shares[index] = shares[index]! + 1;
      remainder--;
    }

    return shares;
  }

  /*
   * Queues each signal the batch holds. Throws
   * CompatibleQueueUnavailableError when the queue cannot take one, for the
   * endpoint to answer as its protocol says a sender should retry (a 503).
   */
  public static async enqueue(data: {
    req: TelemetryRequest;
    surface: TelemetryIngestSurface;
    batch: CompatibleOtlpBatch;
    /*
     * The request's body decompressed, in bytes - shared out over its jobs
     * by their records - or each signal's own: what each job is counted at.
     * Absent, a job is counted at the size of the OTLP JSON it is queued as.
     */
    ingestBytes?: CompatibleIngestBytes | undefined;
  }): Promise<CompatibleEnqueueResult> {
    const req: TelemetryRequest = data.req;
    const doorSignal: TelemetryIngestionBudgetSignal | null =
      getTelemetryIngestionBudgetSignalForSurface(data.surface);

    const result: CompatibleEnqueueResult = {
      queuedLogs: false,
      queuedMetrics: false,
      queuedTraces: false,
    };

    const jobs: Array<SignalJob> = [];

    if (CompatibleIngestService.hasContent(data.batch.logs, "resourceLogs")) {
      jobs.push({
        signal: "logs",
        payload: data.batch.logs,
        productType: ProductType.Logs,
        enqueue: (request: TelemetryRequest): Promise<void> => {
          return TelemetryQueueService.addLogIngestJob(request);
        },
      });
    }

    if (
      CompatibleIngestService.hasContent(data.batch.metrics, "resourceMetrics")
    ) {
      jobs.push({
        signal: "metrics",
        payload: data.batch.metrics,
        productType: ProductType.Metrics,
        enqueue: (request: TelemetryRequest): Promise<void> => {
          return TelemetryQueueService.addMetricIngestJob(request);
        },
      });
    }

    if (
      CompatibleIngestService.hasContent(data.batch.traces, "resourceSpans")
    ) {
      jobs.push({
        signal: "traces",
        payload: data.batch.traces,
        productType: ProductType.Traces,
        enqueue: (request: TelemetryRequest): Promise<void> => {
          return TelemetryQueueService.addTraceIngestJob(request);
        },
      });
    }

    const doorCharge: TelemetryRequest["telemetryIngestionBudgetCharge"] =
      req.telemetryIngestionBudgetCharge;
    let isDoorChargeTaken: boolean = false;

    // Records are counted only when a size is to be shared between jobs.
    const isShared: boolean =
      typeof data.ingestBytes === "number" && jobs.length > 1;
    const shares: Array<number | undefined> =
      CompatibleIngestService.shareIngestBytes(
        jobs.map(
          (
            job: SignalJob,
          ): {
            signal: CompatibleSignal;
            records: number;
          } => {
            return {
              signal: job.signal,
              records: isShared
                ? CompatibleIngestService.recordCount(
                    job.payload,
                    RESOURCE_KEYS[job.signal],
                  )
                : 0,
            };
          },
        ),
        data.ingestBytes,
      );

    // The body is queued as OTLP JSON, with no coding left to undo.
    req.headers["content-type"] = "application/json";
    delete req.headers["content-encoding"];

    for (const [index, job] of jobs.entries()) {
      const takesDoorCharge: boolean =
        !isDoorChargeTaken &&
        doorSignal !== null &&
        (job.productType as string) === (doorSignal as string);

      /*
       * Absent, not null: null tells the queue a gate already decided this
       * job and counted nothing, absent that none did - so a job the door
       * did not check is counted against its own signal now.
       */
      if (takesDoorCharge && doorCharge !== undefined) {
        req.telemetryIngestionBudgetCharge = doorCharge;
      } else {
        delete req.telemetryIngestionBudgetCharge;
      }

      const share: number | undefined = shares[index];

      if (share !== undefined) {
        req.telemetryIngestBytes = share;
      } else {
        delete req.telemetryIngestBytes;
      }

      if (takesDoorCharge) {
        isDoorChargeTaken = true;
      }

      req.body = job.payload;
      req.productType = job.productType;

      try {
        await job.enqueue(req);
      } catch (error) {
        logger.error(
          `Compatible ingest (${data.surface}): could not queue ${job.productType}`,
          getLogAttributesFromRequest(req as RequestLike),
        );
        logger.error(error, getLogAttributesFromRequest(req as RequestLike));
        throw new CompatibleQueueUnavailableError();
      }

      if (job.productType === ProductType.Logs) {
        result.queuedLogs = true;
      } else if (job.productType === ProductType.Metrics) {
        result.queuedMetrics = true;
      } else {
        result.queuedTraces = true;
      }
    }

    req.body = null;
    delete req.telemetryIngestBytes;

    return result;
  }

  private static isSize(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
  }

  private static objectsOf(value: unknown): Array<JSONObject> {
    if (!Array.isArray(value)) {
      return [];
    }

    return (value as Array<unknown>).filter(
      (item: unknown): item is JSONObject => {
        return Boolean(item) && typeof item === "object";
      },
    );
  }

  private static lengthOf(value: unknown): number {
    return Array.isArray(value) ? value.length : 0;
  }
}

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

interface SignalJob {
  payload: JSONObject;
  productType: ProductType;
  enqueue: (req: TelemetryRequest) => Promise<void>;
}

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
   * Queues each signal the batch holds. Throws
   * CompatibleQueueUnavailableError when the queue cannot take one, for the
   * endpoint to answer as its protocol says a sender should retry (a 503).
   */
  public static async enqueue(data: {
    req: TelemetryRequest;
    surface: TelemetryIngestSurface;
    batch: CompatibleOtlpBatch;
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

    // The body is queued as OTLP JSON, with no coding left to undo.
    req.headers["content-type"] = "application/json";
    delete req.headers["content-encoding"];

    for (const job of jobs) {
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

    return result;
  }
}

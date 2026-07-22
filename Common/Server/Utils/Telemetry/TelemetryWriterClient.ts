import ClusterKeyAuthorization from "../../Middleware/ClusterKeyAuthorization";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import API from "../../../Utils/API";
import {
  FanInInsertTarget,
  FanInInsertTransport,
  TransientInsertError,
} from "./TelemetryFanInWriter";
import { type ClickHouseSettings } from "@clickhouse/client";

/*
 * Worker-side client for the telemetry-writer tier.
 *
 * When TELEMETRY_WRITER_URL is set on a pod, its fan-in writer delivers
 * every token group as one HTTP POST to the writer tier instead of
 * inserting into ClickHouse itself. This decouples worker replica count
 * from ClickHouse INSERT concurrency: telemetry insert load on ClickHouse
 * is (writerReplicas × TELEMETRY_FANIN_MAX_CONCURRENT_INSERTS) regardless
 * of how far the worker fleet scales out. (Reads and low-volume direct
 * inserts that never go through the fan-in writer still use this pod's own
 * ClickHouse pools.)
 *
 * Failure classification maps onto the fan-in writer's retry semantics:
 * every payload carries a dedup token that is byte-identical across
 * retries, so any AMBIGUOUS outcome (network error, timeout, writer pod
 * dying mid-request) is safe to classify transient — a retry of a payload
 * that actually landed is dropped server-side by ClickHouse. Only a
 * definitive verdict from the writer (2xx success, 4xx/500 permanent
 * failure) is treated as final.
 */

export const TELEMETRY_WRITER_INSERT_ROUTE: string = "/telemetry-writer/insert";

export function getTelemetryWriterUrl(): string | null {
  const raw: string | undefined = process.env["TELEMETRY_WRITER_URL"];
  const trimmed: string = (raw || "").trim();
  if (!trimmed) {
    return null;
  }
  // Normalize away a trailing slash so route concatenation is predictable.
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

export function isTelemetryWriterForwardingEnabled(): boolean {
  return getTelemetryWriterUrl() !== null;
}

export function getTelemetryWriterRequestTimeoutMs(): number {
  const raw: string | undefined =
    process.env["TELEMETRY_WRITER_REQUEST_TIMEOUT_MS"];
  const parsed: number = parseInt(raw || "", 10);
  /*
   * Generous default: the writer holds the request until ClickHouse accepts
   * the rows (durable flush when TELEMETRY_WAIT_FOR_ASYNC_INSERT=true),
   * which under load includes its own batching wait and retry/backoff loop.
   */
  return !isNaN(parsed) && parsed > 0 ? parsed : 120_000;
}

export interface WriterPostResult {
  statusCode: number;
  errorMessage?: string | undefined;
}

export type WriterPostFn = (args: {
  url: string;
  body: JSONObject;
  timeoutMs: number;
}) => Promise<WriterPostResult>;

const defaultPost: WriterPostFn = async (args: {
  url: string;
  body: JSONObject;
  timeoutMs: number;
}): Promise<WriterPostResult> => {
  let response: HTTPResponse<JSONObject> | HTTPErrorResponse;
  try {
    response = await API.post<JSONObject>({
      url: URL.fromString(args.url),
      data: args.body,
      headers: {
        ...ClusterKeyAuthorization.getClusterKeyHeaders(),
      },
      options: {
        timeout: args.timeoutMs,
        skipAuthRefresh: true,
      },
    });
  } catch (err) {
    /*
     * API.post throws (APIException) when no HTTP response exists at all —
     * connection refused, reset, DNS, timeout. Outcome unknown; statusCode 0
     * classifies it transient.
     */
    return {
      statusCode: 0,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }

  if (response instanceof HTTPErrorResponse) {
    return {
      statusCode: response.statusCode,
      errorMessage: response.message,
    };
  }

  return { statusCode: response.statusCode };
};

/*
 * Writer-tier verdicts that mean "retry with the same token": overload
 * shedding (429) and gateway/unavailability statuses where the request may
 * or may not have been processed.
 */
const TRANSIENT_HTTP_STATUSES: Set<number> = new Set([429, 502, 503, 504]);

function isDefinitiveStatus(statusCode: number): boolean {
  /*
   * Anything outside real HTTP semantics (0, -1, undefined coerced) is a
   * network-level failure with an unknown outcome — transient by the dedup
   * token argument above.
   */
  return statusCode >= 100 && statusCode < 600;
}

export function createTelemetryWriterTransport(
  postFn?: WriterPostFn,
): FanInInsertTransport {
  const post: WriterPostFn = postFn ?? defaultPost;

  return async (
    target: FanInInsertTarget,
    rows: Array<JSONObject>,
    options: {
      dedupToken: string;
      clickhouseSettings: ClickHouseSettings | undefined;
    },
  ): Promise<void> => {
    const baseUrl: string | null = getTelemetryWriterUrl();
    if (!baseUrl) {
      /*
       * The transport is only installed when the URL is configured; losing
       * it mid-flight (env mutation in tests) is a permanent config error,
       * not something a same-token retry can fix.
       */
      throw new Error(
        "TelemetryWriterClient: TELEMETRY_WRITER_URL is not configured.",
      );
    }

    const tableName: string = target.model.tableName;
    const body: JSONObject = {
      tableName: tableName,
      rows: rows,
      dedupToken: options.dedupToken,
      ...(options.clickhouseSettings
        ? { clickhouseSettings: options.clickhouseSettings as JSONObject }
        : {}),
    };

    const result: WriterPostResult = await post({
      url: `${baseUrl}${TELEMETRY_WRITER_INSERT_ROUTE}`,
      body: body,
      timeoutMs: getTelemetryWriterRequestTimeoutMs(),
    });

    if (result.statusCode >= 200 && result.statusCode < 300) {
      return;
    }

    const detail: string = `telemetry-writer insert into ${tableName} (${rows.length} rows) returned status ${result.statusCode}${result.errorMessage ? `: ${result.errorMessage}` : ""}`;

    if (
      TRANSIENT_HTTP_STATUSES.has(result.statusCode) ||
      !isDefinitiveStatus(result.statusCode)
    ) {
      throw new TransientInsertError(detail);
    }

    throw new Error(detail);
  };
}

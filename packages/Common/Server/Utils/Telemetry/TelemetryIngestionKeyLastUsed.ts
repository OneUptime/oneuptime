import TelemetryIngestionKeyService from "../../Services/TelemetryIngestionKeyService";
import TelemetryIngestionKeyPolicy from "../../../Types/Telemetry/TelemetryIngestionKeyPolicy";
import logger from "../Logger";

/*
 * What stampWhenAccepted reads of an HTTP response: the status it was
 * answered with, and the "finish" event Node emits once that answer has been
 * handed to the connection. An Express response is one.
 */
export interface AnsweredHttpResponse {
  statusCode: number;
  once(event: "finish", listener: () => void): unknown;
}

/*
 * A success: what an ingest route answers once it has taken the data (200,
 * 202 or 204, by protocol). Anything else is a refusal or a failure - a 4xx
 * the sender has to fix, a 503 while the queue cannot take the data, a 500 -
 * and marks nothing.
 */
export const isAcceptedHttpStatus: (statusCode: number) => boolean = (
  statusCode: number,
): boolean => {
  return statusCode >= 200 && statusCode < 300;
};

/*
 * MARKS THE INGESTION KEY THAT SENT ACCEPTED TELEMETRY AS USED.
 *
 * A key's lastUsedAt is what the Dashboard reads to say the key is in use:
 * "Last Used At" on the key's page and in the keys list, and the telemetry
 * guides' "Wait for the first data" step. Every ingest path that accepts data
 * with a key stamps it through this one function, at the same moment - once
 * the data is accepted, never before:
 *
 *   - the HTTP ingest middleware (TelemetryIngest), through
 *     stampWhenAccepted below: once the route has answered the request with
 *     a success, which every ingest route does only once it has taken the
 *     data - a queued route once the queue has it (issue #8021);
 *   - the OTLP gRPC server (GrpcServer), once the queue has taken the export;
 *   - the MQTT broker (MqttServer), once the queue has taken a publish from a
 *     client that connected with a project-wide ingestion key.
 *
 * One function, so the paths cannot stamp differently, and a new ingest path
 * has one call to make. Until the gRPC server made it (issue #7887), a key
 * used only over OTLP/gRPC - the OpenTelemetry Collector's default exporter -
 * read "never used" however much data it sent; until the MQTT broker made it
 * (issue #8020), so did a key a gateway sent only over MQTT. Until the HTTP
 * middleware waited for the route's answer (issue #8021), it stamped a key
 * the moment the request passed the guard, before the route had queued
 * anything, so an export the queue then refused still marked its key used.
 *
 * Call it only for accepted telemetry. A refused key (disabled, expired, the
 * wrong type for the surface, over its limit or budget) is not "used", and
 * neither is a request that failed: the sender retries it, and the retry
 * stamps.
 *
 * Fire and forget: lastUsedAt is bookkeeping for the dashboard, and the
 * service already throttles the write (once per key per five minutes per
 * process, shared by every path) and swallows its own errors. Awaiting it
 * would put a database write on the hot path of every ingested payload for a
 * column nobody reads in real time. The .catch is belt and braces so a
 * rejection can never surface as an unhandled rejection.
 */
export default class TelemetryIngestionKeyLastUsed {
  public static stamp(policy: TelemetryIngestionKeyPolicy): void {
    TelemetryIngestionKeyService.markUsed(policy.ingestionKeyId).catch(
      (err: unknown) => {
        logger.warn(
          `TelemetryIngest: failed to record last used for ingestion key ${policy.ingestionKeyId.toString()}`,
        );
        logger.warn(err);
      },
    );
  }

  /*
   * HTTP: stamp the key once the route has accepted what the request sent.
   *
   * The ingest middleware admits a request before its route has done
   * anything with it, so the stamp waits for the answer: it is taken when the
   * response finishes with a success, and never for a refusal or a failure -
   * the same moment the gRPC server stamps at, the export already in the
   * queue. A request whose client went away before the answer was sent marks
   * nothing either: the sender saw no answer, retries, and the retry stamps.
   *
   * Read through a runtime check because the response is not always a real
   * one - unit tests hand the middleware a bare object - and a response that
   * cannot be watched is one whose answer cannot be known, so it stamps
   * nothing rather than guessing.
   */
  public static stampWhenAccepted(
    policy: TelemetryIngestionKeyPolicy,
    res: AnsweredHttpResponse,
  ): void {
    const once: unknown = (res as unknown as Record<string, unknown>)["once"];

    if (typeof once !== "function") {
      return;
    }

    (once as AnsweredHttpResponse["once"]).call(res, "finish", (): void => {
      if (isAcceptedHttpStatus(res.statusCode)) {
        TelemetryIngestionKeyLastUsed.stamp(policy);
      }
    });
  }
}

import TelemetryIngestionKeyService from "../../Services/TelemetryIngestionKeyService";
import TelemetryIngestionKeyPolicy from "../../../Types/Telemetry/TelemetryIngestionKeyPolicy";
import logger from "../Logger";

/*
 * MARKS THE INGESTION KEY THAT SENT ACCEPTED TELEMETRY AS USED.
 *
 * A key's lastUsedAt is what the Dashboard reads to say the key is in use:
 * "Last Used At" on the key's page and in the keys list, and the telemetry
 * guides' "Wait for the first data" step. Every ingest path that accepts data
 * with a key stamps it through this one function:
 *
 *   - the HTTP ingest middleware (TelemetryIngest), once a request has passed
 *     every check and is handed on to its route;
 *   - the OTLP gRPC server (GrpcServer), once the queue has taken the export.
 *
 * One function, so the paths cannot stamp differently, and a new ingest path
 * has one call to make. Until the gRPC server made it (issue #7887), a key
 * used only over OTLP/gRPC - the OpenTelemetry Collector's default exporter -
 * read "never used" however much data it sent.
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
}

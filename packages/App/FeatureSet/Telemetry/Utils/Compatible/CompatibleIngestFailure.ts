import { CompatibleBodyError } from "./CompatibleIngestBody";

/*
 * Why a compatible endpoint could not take a request, as the status code
 * its client should be answered with - each endpoint words the body in its
 * own protocol's shape (plain text for Prometheus and Loki, HEC's
 * {"text", "code"}, Datadog's {"errors"}, Sentry's {"detail"}).
 *
 *   - 400, 413, 415: the request itself is wrong, and sending it again
 *     will not help. Every one of these clients drops the batch and logs
 *     the reason, rather than retrying it forever.
 *   - 503: the queue could not take it. Every one of them retries a 503.
 *
 * Anything else is a fault of ours, left to the error handler.
 */

export interface CompatibleIngestFailure {
  statusCode: number;
  message: string;
}

// The queue could not take a translated batch (CompatibleIngestService).
export class CompatibleQueueUnavailableError extends Error {
  public constructor() {
    super("Telemetry queue unavailable. Please retry.");
    this.name = "CompatibleQueueUnavailableError";
  }
}

// An error a translator throws for a body it cannot read (always a 400).
export interface CompatibleTranslatorError extends Error {
  statusCode?: number | undefined;
}

export default class CompatibleIngestFailureMapper {
  public static fromError(
    error: unknown,
    translatorErrors: ReadonlyArray<new (...args: Array<never>) => Error>,
  ): CompatibleIngestFailure | null {
    if (error instanceof CompatibleQueueUnavailableError) {
      return { statusCode: 503, message: error.message };
    }

    if (error instanceof CompatibleBodyError) {
      return { statusCode: error.statusCode, message: error.message };
    }

    for (const translatorError of translatorErrors) {
      if (error instanceof translatorError) {
        const statusCode: unknown = (error as CompatibleTranslatorError)
          .statusCode;

        return {
          statusCode:
            typeof statusCode === "number" &&
            statusCode >= 400 &&
            statusCode < 500
              ? statusCode
              : 400,
          message: error.message,
        };
      }
    }

    return null;
  }
}

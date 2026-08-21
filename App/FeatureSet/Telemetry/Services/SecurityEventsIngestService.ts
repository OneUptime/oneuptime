import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import EventLoop from "Common/Server/Utils/EventLoop";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import ObjectID from "Common/Types/ObjectID";
import { resolveTelemetryRetentionInDays } from "Common/Types/Telemetry/TelemetryRetentionConfig";
import { buildSecurityEventDbRow } from "Common/Server/Utils/SecurityEvent/SecurityEventRow";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import logger, {
  getLogAttributesFromRequest,
  type RequestLike,
} from "Common/Server/Utils/Logger";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import SecurityEventService from "Common/Server/Services/SecurityEventService";
import NormalizedSecurityEvent from "Common/Types/SecurityEvent/NormalizedSecurityEvent";
import SecurityEventFormat from "Common/Types/SecurityEvent/SecurityEventFormat";
import SecurityEventNormalizer from "Common/Utils/SecurityEvent/SecurityEventNormalizer";
import OtelIngestBaseService from "./OtelIngestBaseService";
import SecurityEventsQueueService from "./Queue/SecurityEventsQueueService";
import { TELEMETRY_LOG_FLUSH_BATCH_SIZE } from "../Config";
import TelemetryFanInWriter, {
  FanInSubmitResult,
  pushObservedAck,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";

class SecurityEventStorageFlushError extends Error {
  public constructor(error: unknown) {
    const message: string =
      error instanceof Error ? error.message : String(error);
    super(`Failed to flush security events to ClickHouse: ${message}`);
    this.name = "SecurityEventStorageFlushError";

    if (error instanceof Error && error.stack) {
      this.stack = `${this.stack}\nCaused by: ${error.stack}`;
    }
  }
}

/*
 * Security events ingest: HTTPS JSON in any supported dialect (OCSF,
 * Google SecOps UDM, SecOps detection alerts, generic security JSON),
 * normalized to OCSF and written to the SecurityEvent ClickHouse table.
 *
 * Pipeline shape mirrors FluentLogsIngestService: the HTTP handler
 * validates, responds 200, and enqueues; the queue worker normalizes and
 * batch-writes through the fan-in writer with ack-after-flush.
 */
export default class SecurityEventsIngestService extends OtelIngestBaseService {
  private static readonly DEFAULT_SERVICE_NAME: string = "Security Events";

  @CaptureSpan()
  public static async ingestSecurityEvents(
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

      const entries: Array<JSONObject> = this.extractEventsFromBody(req.body);

      if (entries.length === 0) {
        throw new BadRequestException(
          "No security events found in request. Send a JSON object, an array of objects, or { \"events\": [...] }.",
        );
      }

      const format: SecurityEventFormat | null = this.getRequestedFormat(req);

      req.body = {
        events: entries,
        ...(format ? { format } : {}),
      } satisfies JSONObject;

      Response.sendEmptySuccessResponse(req, res);

      await SecurityEventsQueueService.addSecurityEventsIngestJob(
        req as TelemetryRequest,
      );

      return;
    } catch (error) {
      return next(error);
    }
  }

  @CaptureSpan()
  public static async processSecurityEventsFromQueue(
    req: ExpressRequest,
  ): Promise<void> {
    const pendingAcks: Array<Promise<void>> = [];

    try {
      const projectId: ObjectID = (req as TelemetryRequest).projectId;
      const body: JSONObject = (req.body || {}) as JSONObject;
      const entries: Array<JSONObject> = this.extractEventsFromBody(
        body["events"],
      );

      if (entries.length === 0) {
        logger.warn("Security events ingest: no events to process.");
        return;
      }

      const format: SecurityEventFormat | null =
        SecurityEventNormalizer.parseFormat((body["format"] as string) || "");

      /*
       * Normalize first: the batch's service attribution (which security
       * "source" service these events belong to) comes from the payload
       * when no explicit service-name header was sent.
       */
      const normalizedEvents: Array<NormalizedSecurityEvent> = [];
      let entryCounter: number = 0;

      for (const entry of entries) {
        if (entryCounter % 500 === 0) {
          await EventLoop.yieldToEventLoop();
        }
        entryCounter++;

        try {
          const normalized: NormalizedSecurityEvent | null =
            SecurityEventNormalizer.normalize(entry, format || undefined);

          if (normalized) {
            normalizedEvents.push(normalized);
          }
        } catch (normalizeError) {
          logger.error("Security events ingest: error normalizing event");
          logger.error(normalizeError);
        }
      }

      if (normalizedEvents.length === 0) {
        logger.warn("Security events ingest: no valid events after normalization");
        return;
      }

      const serviceName: string = this.getServiceNameFromHeaders(
        req,
        normalizedEvents[0]!.productName ||
          normalizedEvents[0]!.vendorName ||
          this.DEFAULT_SERVICE_NAME,
      );

      const serviceMetadata: TelemetryServiceMetadata =
        await OTelIngestService.telemetryServiceFromName({
          serviceName,
          projectId,
        });

      const retentionDays: number = resolveTelemetryRetentionInDays({
        pillar: "securityEvents",
        serviceConfig: serviceMetadata.serviceRetentionConfig,
        serviceRetentionInDays: serviceMetadata.serviceRetentionInDays,
        projectConfig: serviceMetadata.projectRetentionConfig,
        projectRetentionInDays: serviceMetadata.projectRetentionInDays,
      });

      const dbRows: Array<JSONObject> = [];
      let processed: number = 0;

      for (const normalized of normalizedEvents) {
        try {
          if (processed % 500 === 0) {
            await EventLoop.yieldToEventLoop();
          }

          dbRows.push(
            this.toDbRow({
              normalized,
              projectId,
              serviceMetadata,
              retentionDays,
            }),
          );
          processed++;

          if (dbRows.length >= TELEMETRY_LOG_FLUSH_BATCH_SIZE) {
            await this.submitEventsBuffer(dbRows, pendingAcks);
          }
        } catch (processingError) {
          if (processingError instanceof SecurityEventStorageFlushError) {
            throw processingError;
          }

          logger.error("Security events ingest: error processing event");
          logger.error(processingError);
        }
      }

      await this.submitEventsBuffer(dbRows, pendingAcks, true);

      await Promise.all(pendingAcks);

      logger.debug(
        `Security events ingest: processed ${processed} events for project ${projectId.toString()}`,
      );

      dbRows.length = 0;

      try {
        if (req.body) {
          req.body = null;
        }
      } catch (cleanupError) {
        logger.error("Security events ingest: error during memory cleanup");
        logger.error(cleanupError);
      }
    } catch (error) {
      await Promise.allSettled(pendingAcks);

      logger.error(
        "Security events ingest: critical error",
        getLogAttributesFromRequest(req as RequestLike),
      );
      logger.error(error, getLogAttributesFromRequest(req as RequestLike));
      throw error;
    }
  }

  /*
   * Build the ClickHouse row for one normalized event. Delegates to the
   * shared builder in Common so the detection engine's Detection Finding
   * rows can never drift from ingest's shape.
   */
  public static toDbRow(data: {
    normalized: NormalizedSecurityEvent;
    projectId: ObjectID;
    serviceMetadata: TelemetryServiceMetadata;
    retentionDays: number;
  }): JSONObject {
    return buildSecurityEventDbRow(data);
  }

  /*
   * Accept the shapes clients actually send: a bare object (one event),
   * a bare array, { events: [...] }, { entries: [...] }, or
   * { logs: [...] } (some forwarders hardcode that key).
   */
  private static extractEventsFromBody(body: unknown): Array<JSONObject> {
    if (!body) {
      return [];
    }

    if (Array.isArray(body)) {
      return (body as JSONArray).filter((item: unknown): boolean => {
        return (
          typeof item === "object" && item !== null && !Array.isArray(item)
        );
      }) as Array<JSONObject>;
    }

    if (typeof body !== "object") {
      return [];
    }

    const asObject: JSONObject = body as JSONObject;

    for (const key of ["events", "entries", "logs"]) {
      const nested: unknown = asObject[key];
      if (Array.isArray(nested)) {
        return this.extractEventsFromBody(nested);
      }
    }

    if (Object.keys(asObject).length > 0) {
      return [asObject];
    }

    return [];
  }

  private static getRequestedFormat(
    req: ExpressRequest,
  ): SecurityEventFormat | null {
    const fromQuery: string = String(req.query?.["format"] || "");
    const fromHeader: string = String(
      req.headers["x-oneuptime-security-event-format"] || "",
    );

    return SecurityEventNormalizer.parseFormat(fromQuery || fromHeader);
  }

  private static async submitEventsBuffer(
    rows: Array<JSONObject>,
    pendingAcks: Array<Promise<void>>,
    force: boolean = false,
  ): Promise<void> {
    while (
      rows.length >= TELEMETRY_LOG_FLUSH_BATCH_SIZE ||
      (force && rows.length > 0)
    ) {
      const batch: Array<JSONObject> = rows.splice(
        0,
        Math.min(rows.length, TELEMETRY_LOG_FLUSH_BATCH_SIZE),
      );

      if (batch.length === 0) {
        continue;
      }

      const submission: FanInSubmitResult = await TelemetryFanInWriter.submit(
        SecurityEventService,
        batch,
      );
      pushObservedAck(pendingAcks, submission.flushed, (error: Error) => {
        return new SecurityEventStorageFlushError(error);
      });
    }
  }
}

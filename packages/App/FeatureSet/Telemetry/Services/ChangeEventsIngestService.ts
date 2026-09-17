import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import ObjectID from "Common/Types/ObjectID";
import { resolveTelemetryRetentionInDays } from "Common/Types/Telemetry/TelemetryRetentionConfig";
import {
  DEFAULT_CHANGE_EVENT_RETENTION_IN_DAYS,
  MAX_CHANGE_EVENTS_PER_REQUEST,
  ParsedChangeEventEntry,
  buildChangeEventDbRow,
  extractChangeEventEntries,
  parseChangeEventIngestEntry,
} from "../../../../Common/Server/Utils/Telemetry/ChangeEventRow";
import { JSONObject } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
/*
 * Sibling-relative on purpose — see the note in BaseAPI/Index.ts: the
 * `Common` specifier can resolve a checkout that predates these modules.
 */
import ChangeEventService from "../../../../Common/Server/Services/ChangeEventService";
import OtelIngestBaseService from "./OtelIngestBaseService";
import TelemetryFanInWriter, {
  FanInSubmitResult,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";

/*
 * Change-events ingest: a small, synchronous JSON endpoint meant to be
 * called from CI/CD pipelines ("we just deployed v2.31 of checkout").
 *
 * Unlike the log/trace firehoses there is no queue hop: a deploy step
 * wants a definitive 2xx/4xx before it moves on, volumes are tiny (a
 * handful of rows per deploy), and rows go through the same fan-in
 * writer the other telemetry pillars use.
 *
 *   POST /telemetry/change-events/v1/ingest
 *   x-oneuptime-token: <telemetry ingestion key>
 *   { "events": [ { "title": "Deploy v2.31.0",
 *                   "eventType": "deployment",
 *                   "time": "2026-08-24T12:03:00Z",
 *                   "serviceName": "checkout",
 *                   "attributes": { "version": "2.31.0", "sha": "..." } } ] }
 */
export default class ChangeEventsIngestService extends OtelIngestBaseService {
  @CaptureSpan()
  public static async ingestChangeEvents(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const projectId: ObjectID | undefined = (req as TelemetryRequest)
        .projectId;

      if (!projectId) {
        throw new BadRequestException(
          "Invalid request - projectId not found in request.",
        );
      }

      const entries: Array<JSONObject> = extractChangeEventEntries(
        req.body,
      ).slice(0, MAX_CHANGE_EVENTS_PER_REQUEST);

      if (entries.length === 0) {
        throw new BadRequestException(
          'No change events found in request body. Send { "events": [ { "title": "..." } ] }.',
        );
      }

      const rows: Array<JSONObject> = [];
      let skipped: number = 0;

      /*
       * Service metadata is resolved once per distinct serviceName in the
       * batch (deploys usually name one service). Serviceless events are
       * project-wide markers with the flat default retention.
       */
      const serviceMetadataByName: Map<string, TelemetryServiceMetadata> =
        new Map<string, TelemetryServiceMetadata>();

      const headerServiceName: string = this.getServiceNameFromHeaders(req, "");

      for (const entry of entries) {
        const parsed: ParsedChangeEventEntry | null =
          parseChangeEventIngestEntry(entry);

        if (!parsed) {
          skipped++;
          continue;
        }

        const serviceName: string =
          typeof entry["serviceName"] === "string" &&
          (entry["serviceName"] as string).trim() !== ""
            ? (entry["serviceName"] as string).trim()
            : headerServiceName;

        let serviceMetadata: TelemetryServiceMetadata | null = null;
        let retentionDays: number = DEFAULT_CHANGE_EVENT_RETENTION_IN_DAYS;

        if (serviceName) {
          serviceMetadata =
            serviceMetadataByName.get(serviceName) ||
            (await OTelIngestService.telemetryServiceFromName({
              serviceName,
              projectId,
            }));
          serviceMetadataByName.set(serviceName, serviceMetadata);

          /*
           * Change markers live alongside metric charts, so they follow
           * the metrics retention ladder of the service they annotate.
           */
          retentionDays = resolveTelemetryRetentionInDays({
            pillar: "metrics",
            serviceConfig: serviceMetadata.serviceRetentionConfig,
            serviceRetentionInDays: serviceMetadata.serviceRetentionInDays,
            projectConfig: serviceMetadata.projectRetentionConfig,
            projectRetentionInDays: serviceMetadata.projectRetentionInDays,
          });
        }

        rows.push(
          buildChangeEventDbRow({
            parsed,
            projectId,
            serviceMetadata,
            retentionDays,
          }),
        );
      }

      if (rows.length === 0) {
        throw new BadRequestException(
          "No valid change events in request body — every entry needs a non-empty title.",
        );
      }

      const submission: FanInSubmitResult = await TelemetryFanInWriter.submit(
        ChangeEventService,
        rows,
      );
      await submission.flushed;

      logger.debug(
        `Change events ingest: stored ${rows.length} events for project ${projectId.toString()}`,
      );

      return Response.sendJsonObjectResponse(req, res, {
        ingested: rows.length,
        skipped: skipped,
      });
    } catch (error) {
      return next(error);
    }
  }
}

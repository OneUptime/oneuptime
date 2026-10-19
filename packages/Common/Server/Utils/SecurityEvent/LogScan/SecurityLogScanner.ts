import SecurityLogSource from "../../../../Models/DatabaseModels/SecurityLogSource";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { resolveTelemetryRetentionInDays } from "../../../../Types/Telemetry/TelemetryRetentionConfig";
import { readClickhouseDate } from "../../../../Utils/SecurityEvent/Destinations/SecurityEventRecord";
import SecurityLogParser from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import { SECURITY_LOG_FORMAT_ATTRIBUTE } from "../../../../Types/SecurityEvent/SecurityLogFormat";
import LogService from "../../../Services/LogService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../Services/OpenTelemetryIngestService";
import SecurityEventService from "../../../Services/SecurityEventService";
import SecurityLogSourceService from "../../../Services/SecurityLogSourceService";
import Semaphore, { SemaphoreMutex } from "../../../Infrastructure/Semaphore";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import ConnectorErrorMessage from "../ConnectorErrorMessage";
import { buildSecurityEventDbRow } from "../SecurityEventRow";
import ThreatIntelEnricher from "../ThreatIntel/ThreatIntelEnricher";

/*
 * "Your logs" (SecurityLogSource): every minute, for each project that
 * turned it on, read the logs that arrived since the last scan, keep the
 * lines that hold a security record (SecurityLogParser) and store each
 * record as a security event - so the detection rules run on data the
 * project already sends.
 *
 * Logs are read by when they ARRIVED (createdAt), a window at a time, so a
 * log that was written a while before it reached OneUptime is still read
 * once; the window waits LOG_SCAN_SETTLE_IN_SECONDS so the logs of its last
 * seconds have landed. Only lines that hold a security record's words
 * leave the database (SECURITY_LOG_PREFILTER), and only so many per window:
 * the scan is bounded however many logs a project sends.
 *
 * The events keep the time the log line was written. They are attributed
 * to one "OneUptime Logs" service per project - as detections are to
 * "OneUptime Detections" - and each names the log record it came from.
 */

export const SECURITY_LOGS_SERVICE_NAME: string = "OneUptime Logs";

// Logs younger than this wait for the next scan, so a window is complete.
export const LOG_SCAN_SETTLE_IN_SECONDS: number = 15;
// The longest window one read covers.
export const LOG_SCAN_WINDOW_IN_SECONDS: number = 5 * 60;
// Windows one scan of one project reads before it lets the next project go.
export const LOG_SCAN_MAX_WINDOWS_PER_RUN: number = 12;
// The most candidate lines one window reads; past it the window is cut.
export const LOG_SCAN_MAX_LINES_PER_WINDOW: number = 5000;
export const LOG_SCAN_PAGE_SIZE: number = 1000;
// A scan that fell further behind than this starts again from here.
export const LOG_SCAN_MAX_BACKLOG_IN_MINUTES: number = 60;
// Logs written this long before they arrived are not read.
export const LOG_SCAN_LATE_LOG_WINDOW_IN_MINUTES: number = 60;

export interface SecurityLogScanResult {
  logsRead: number;
  eventsFound: number;
  // Events found, by SecurityLogFormat.
  byFormat: Record<string, number>;
  windows: number;
  // A window held more candidate lines than one scan reads.
  truncated: boolean;
  // The scan had fallen too far behind and skipped ahead.
  skippedBacklog: boolean;
  scannedFrom: string;
  scannedTo: string;
}

function readCursor(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date: Date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function readAttributes(value: JSONValue | undefined): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

export default class SecurityLogScanner {
  @CaptureSpan()
  public static async scanAllEnabled(): Promise<void> {
    const sources: Array<SecurityLogSource> =
      await SecurityLogSourceService.findBy({
        query: { isEnabled: true },
        select: {
          _id: true,
          projectId: true,
          cursor: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });

    for (const source of sources) {
      await this.scanWithLock(source);
    }
  }

  // One scan of a project at a time, across every worker.
  private static async scanWithLock(source: SecurityLogSource): Promise<void> {
    if (!source.projectId || !source.id) {
      return;
    }

    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        namespace: "SecurityLogScan",
        key: source.projectId.toString(),
        lockTimeout: 5 * 60 * 1000,
        acquireAttemptsLimit: 1,
      });
    } catch {
      // Another worker is scanning this project's logs right now.
      return;
    }

    try {
      await this.scanSource(source);
    } catch (error) {
      logger.error(
        `SecurityLogScanner: scan of project ${source.projectId.toString()} failed:`,
      );
      logger.error(error);

      const sourceId: ObjectID = source.id;

      await ConnectorErrorMessage.recordFailure({
        label: `SecurityLogScanner: project ${source.projectId.toString()}`,
        write: async (): Promise<void> => {
          await SecurityLogSourceService.updateOneById({
            id: sourceId,
            data: {
              lastScannedAt: OneUptimeDate.getCurrentDate(),
              lastError: ConnectorErrorMessage.toMessage(error),
            },
            props: { isRoot: true },
          });
        },
      });
    } finally {
      if (mutex) {
        await Semaphore.release(mutex).catch((): void => {
          // The lock runs out on its own.
        });
      }
    }
  }

  // Read the windows since the cursor, store what they hold, move the cursor.
  @CaptureSpan()
  public static async scanSource(
    source: SecurityLogSource,
  ): Promise<SecurityLogScanResult> {
    const projectId: ObjectID = source.projectId!;
    const now: Date = OneUptimeDate.getCurrentDate();
    const until: Date = OneUptimeDate.addRemoveSeconds(
      now,
      -LOG_SCAN_SETTLE_IN_SECONDS,
    );
    const oldestAllowed: Date = OneUptimeDate.addRemoveMinutes(
      now,
      -LOG_SCAN_MAX_BACKLOG_IN_MINUTES,
    );

    let cursor: Date = readCursor(source.cursor) || until;
    let skippedBacklog: boolean = false;

    if (OneUptimeDate.isBefore(cursor, oldestAllowed)) {
      cursor = oldestAllowed;
      skippedBacklog = true;
    }

    const result: SecurityLogScanResult = {
      logsRead: 0,
      eventsFound: 0,
      byFormat: {},
      windows: 0,
      truncated: false,
      skippedBacklog,
      scannedFrom: cursor.toISOString(),
      scannedTo: cursor.toISOString(),
    };

    let serviceMetadata: TelemetryServiceMetadata | null = null;
    let lastEventFoundAt: Date | null = null;

    while (
      OneUptimeDate.isBefore(cursor, until) &&
      result.windows < LOG_SCAN_MAX_WINDOWS_PER_RUN
    ) {
      const windowEnd: Date = OneUptimeDate.isBefore(
        OneUptimeDate.addRemoveSeconds(cursor, LOG_SCAN_WINDOW_IN_SECONDS),
        until,
      )
        ? OneUptimeDate.addRemoveSeconds(cursor, LOG_SCAN_WINDOW_IN_SECONDS)
        : until;

      const events: Array<NormalizedSecurityEvent> = [];
      let offset: number = 0;

      while (offset < LOG_SCAN_MAX_LINES_PER_WINDOW) {
        const rows: Array<JSONObject> =
          await LogService.findSecurityLogCandidates({
            projectId,
            arrivedAfter: cursor,
            arrivedUntil: windowEnd,
            happenedAfter: OneUptimeDate.addRemoveMinutes(
              cursor,
              -LOG_SCAN_LATE_LOG_WINDOW_IN_MINUTES,
            ),
            limit: Math.min(
              LOG_SCAN_PAGE_SIZE,
              LOG_SCAN_MAX_LINES_PER_WINDOW - offset,
            ),
            offset,
          });

        result.logsRead += rows.length;

        for (const row of rows) {
          events.push(
            ...SecurityLogParser.parse({
              body: typeof row["body"] === "string" ? row["body"] : "",
              attributes: readAttributes(row["attributes"]),
              time: readClickhouseDate(row["time"]) || now,
              logId: typeof row["_id"] === "string" ? row["_id"] : undefined,
            }),
          );
        }

        if (rows.length < LOG_SCAN_PAGE_SIZE) {
          break;
        }

        offset += rows.length;

        if (offset >= LOG_SCAN_MAX_LINES_PER_WINDOW) {
          result.truncated = true;
        }
      }

      if (events.length > 0) {
        serviceMetadata =
          serviceMetadata ||
          (await OTelIngestService.telemetryServiceFromName({
            serviceName: SECURITY_LOGS_SERVICE_NAME,
            projectId,
          }));

        await this.storeEvents({
          projectId,
          events,
          serviceMetadata,
        });

        for (const event of events) {
          const format: string = String(
            event.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE] || "",
          );
          result.byFormat[format] = (result.byFormat[format] || 0) + 1;
        }

        result.eventsFound += events.length;
        lastEventFoundAt = now;
      }

      cursor = windowEnd;
      result.windows += 1;
      result.scannedTo = cursor.toISOString();
    }

    await SecurityLogSourceService.updateOneById({
      id: source.id!,
      data: {
        cursor: cursor.toISOString(),
        lastScannedAt: now,
        lastError: null as unknown as string,
        lastScanResult: { ...result } as never,
        ...(lastEventFoundAt ? { lastEventFoundAt } : {}),
      },
      props: { isRoot: true },
    });

    return result;
  }

  private static async storeEvents(data: {
    projectId: ObjectID;
    events: Array<NormalizedSecurityEvent>;
    serviceMetadata: TelemetryServiceMetadata;
  }): Promise<void> {
    // Threat intel stamps its matches before the rows are built, as ingest does.
    await ThreatIntelEnricher.enrichNormalizedEvents({
      projectId: data.projectId,
      events: data.events,
    });

    const retentionDays: number = resolveTelemetryRetentionInDays({
      pillar: "securityEvents",
      serviceConfig: data.serviceMetadata.serviceRetentionConfig,
      serviceRetentionInDays: data.serviceMetadata.serviceRetentionInDays,
      projectConfig: data.serviceMetadata.projectRetentionConfig,
      projectRetentionInDays: data.serviceMetadata.projectRetentionInDays,
    });

    const rows: Array<JSONObject> = data.events.map(
      (normalized: NormalizedSecurityEvent): JSONObject => {
        return buildSecurityEventDbRow({
          normalized,
          projectId: data.projectId,
          serviceMetadata: data.serviceMetadata,
          retentionDays,
        });
      },
    );

    await SecurityEventService.insertJsonRows(rows);
  }
}

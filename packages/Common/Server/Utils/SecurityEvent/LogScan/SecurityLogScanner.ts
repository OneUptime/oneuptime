import SecurityLogSource from "../../../../Models/DatabaseModels/SecurityLogSource";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { resolveTelemetryRetentionInDays } from "../../../../Types/Telemetry/TelemetryRetentionConfig";
import { readClickhouseDate } from "../../../../Utils/SecurityEvent/Destinations/SecurityEventRecord";
import SecurityLogParser from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import SecurityLogFormat, {
  SECURITY_LOG_FORMAT_ATTRIBUTE,
  readLastFoundAtByFormat,
} from "../../../../Types/SecurityEvent/SecurityLogFormat";
import LogService from "../../../Services/LogService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../Services/OpenTelemetryIngestService";
import SecurityEventService from "../../../Services/SecurityEventService";
import SecurityLogSourceService from "../../../Services/SecurityLogSourceService";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import ConnectorErrorMessage from "../ConnectorErrorMessage";
import { buildSecurityEventDbRow } from "../SecurityEventRow";
import SecurityProjectWork, {
  SecurityProjectWorkDefinition,
  SecurityProjectWorkLease,
  UNLIMITED_SECURITY_PROJECT_WORK_LEASE,
} from "../SecurityProjectWork";
import ThreatIntelEnricher from "../ThreatIntel/ThreatIntelEnricher";
import SecurityRequestTrace from "../RequestTrace/SecurityRequestTrace";

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
 * seconds have landed, and is read in a fixed order, so the same window
 * reads the same way again. Only lines that hold a security record's words
 * leave the database (SECURITY_LOG_PREFILTER).
 *
 * Every candidate line is read. A scan reads at most
 * LOG_SCAN_MAX_LINES_PER_RUN of them, for as long as its turn has time:
 * one that stops part way through a window keeps its place there - the
 * window, and how many of its lines it had read - and the next scan goes on
 * from the line after. A project that fell more than
 * LOG_SCAN_MAX_BACKLOG_IN_HOURS behind (the scan was off, the workers were
 * down) starts again from there, and its result says which logs it skipped.
 *
 * The events keep the time the log line was written. They are attributed
 * to one "OneUptime Logs" service per project - as detections are to
 * "OneUptime Detections" - and each names the log record it came from and,
 * when the line was written inside a traced request, that request's trace,
 * span and session - followed into the trace before the event is stored
 * (RequestTrace/SecurityRequestTrace.ts), so it is stored knowing what the
 * app answered and how far an attack got.
 *
 * The work is spread by project (SecurityProjectWork): the cron queues one
 * turn for each project that turned the scan on.
 */

export const SECURITY_LOGS_SERVICE_NAME: string = "OneUptime Logs";

export const SECURITY_LOG_SCAN_PROJECT_WORK: SecurityProjectWorkDefinition = {
  jobName: "SecurityEvents:ScanProjectLogs",
  key: "security-log-scan",
  maxConcurrentProjects: 8,
};

// Logs younger than this wait for the next scan, so a window is complete.
export const LOG_SCAN_SETTLE_IN_SECONDS: number = 15;
// The longest window one read covers.
export const LOG_SCAN_WINDOW_IN_SECONDS: number = 5 * 60;
// Candidate lines one query reads.
export const LOG_SCAN_PAGE_SIZE: number = 1000;
/*
 * The most candidate lines one scan reads. A scan that reaches it part way
 * through a window stops there, and the next goes on from the line after.
 */
export const LOG_SCAN_MAX_LINES_PER_RUN: number = 50000;
/*
 * A scan that fell further behind than this starts again from here, and its
 * result names the logs it skipped.
 */
export const LOG_SCAN_MAX_BACKLOG_IN_HOURS: number = 24;
// Logs written this long before they arrived are not read.
export const LOG_SCAN_LATE_LOG_WINDOW_IN_MINUTES: number = 60;

export interface SecurityLogScanResult {
  logsRead: number;
  eventsFound: number;
  // Events found, by SecurityLogFormat.
  byFormat: Record<string, number>;
  /*
   * When a security event of each kind was last found, this scan or an
   * earlier one (format -> ISO time): what Connections shows each kind's
   * health by - found lately, found before, or never.
   */
  lastFoundAtByFormat: Record<string, string>;
  windows: number;
  /*
   * The scan had fallen too far behind and skipped ahead: the logs that
   * arrived between skippedFrom and skippedTo were not read.
   */
  skippedBacklog: boolean;
  skippedFrom: string;
  skippedTo: string;
  /*
   * The window the scan stopped in, and how many of its candidate lines it
   * had read: the next scan goes on from the line after. Empty when the scan
   * reached the present.
   */
  partialWindowStart: string;
  partialWindowProcessed: number;
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

function readText(value: JSONValue | undefined): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function readNumber(value: JSONValue | undefined): number {
  const number: number = typeof value === "number" ? value : Number(value);

  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

export default class SecurityLogScanner {
  /*
   * The cron's half: every enabled source in the instance, page by page, and
   * one turn queued for each project that has one. Returns how many
   * projects were queued.
   */
  @CaptureSpan()
  public static async enqueueProjectsWithEnabledSources(): Promise<number> {
    const sources: Array<SecurityLogSource> =
      await SecurityLogSourceService.findAllBy({
        query: { isEnabled: true },
        select: {
          _id: true,
          projectId: true,
        },
        sort: { _id: SortOrder.Ascending },
        props: { isRoot: true },
      });

    return SecurityProjectWork.enqueueProjects(
      SECURITY_LOG_SCAN_PROJECT_WORK,
      sources.map((source: SecurityLogSource): ObjectID | undefined => {
        return source.projectId;
      }),
    );
  }

  // One project's turn: a scan of each of its enabled sources.
  @CaptureSpan()
  public static async scanProject(
    projectId: ObjectID,
    lease: SecurityProjectWorkLease = UNLIMITED_SECURITY_PROJECT_WORK_LEASE,
  ): Promise<void> {
    const sources: Array<SecurityLogSource> =
      await SecurityLogSourceService.findAllBy({
        query: { projectId, isEnabled: true },
        select: {
          _id: true,
          projectId: true,
          cursor: true,
          lastScanResult: true,
        },
        sort: { _id: SortOrder.Ascending },
        props: { isRoot: true },
      });

    for (const source of sources) {
      if (!lease.hasTimeLeft()) {
        return;
      }

      await this.scanSourceRecordingFailure(source, lease);

      if (!(await lease.keep())) {
        return;
      }
    }
  }

  // scanSource, with a failure recorded on the source rather than thrown.
  private static async scanSourceRecordingFailure(
    source: SecurityLogSource,
    lease: SecurityProjectWorkLease,
  ): Promise<void> {
    if (!source.projectId || !source.id) {
      return;
    }

    try {
      await this.scanSource(source, lease);
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
    }
  }

  // Read the windows since the cursor, store what they hold, move the cursor.
  @CaptureSpan()
  public static async scanSource(
    source: SecurityLogSource,
    lease: SecurityProjectWorkLease = UNLIMITED_SECURITY_PROJECT_WORK_LEASE,
  ): Promise<SecurityLogScanResult> {
    const projectId: ObjectID = source.projectId!;
    const now: Date = OneUptimeDate.getCurrentDate();
    const until: Date = OneUptimeDate.addRemoveSeconds(
      now,
      -LOG_SCAN_SETTLE_IN_SECONDS,
    );
    const oldestAllowed: Date = OneUptimeDate.addRemoveHours(
      now,
      -LOG_SCAN_MAX_BACKLOG_IN_HOURS,
    );

    let cursor: Date = readCursor(source.cursor) || until;

    /*
     * A scan that stopped part way through a window goes on from the line
     * after the last one it read.
     */
    const previous: JSONObject = source.lastScanResult || {};
    let skipInWindow: number =
      previous["partialWindowStart"] === cursor.toISOString()
        ? readNumber(previous["partialWindowProcessed"])
        : 0;

    let skippedFrom: string = "";
    let skippedTo: string = "";

    if (OneUptimeDate.isBefore(cursor, oldestAllowed)) {
      skippedFrom = cursor.toISOString();
      skippedTo = oldestAllowed.toISOString();
      cursor = oldestAllowed;
      skipInWindow = 0;
    }

    // When each kind was last found, carried from the scans before.
    const lastFoundAtByFormat: Record<string, string> = {};
    const previousFoundAt: Partial<Record<SecurityLogFormat, Date>> =
      readLastFoundAtByFormat(previous);

    for (const format of Object.keys(
      previousFoundAt,
    ) as Array<SecurityLogFormat>) {
      lastFoundAtByFormat[format] = previousFoundAt[format]!.toISOString();
    }

    const result: SecurityLogScanResult = {
      logsRead: 0,
      eventsFound: 0,
      byFormat: {},
      lastFoundAtByFormat,
      windows: 0,
      skippedBacklog: Boolean(skippedFrom),
      skippedFrom,
      skippedTo,
      partialWindowStart: "",
      partialWindowProcessed: 0,
      scannedFrom: cursor.toISOString(),
      scannedTo: cursor.toISOString(),
    };

    let serviceMetadata: TelemetryServiceMetadata | null = null;
    let lastEventFoundAt: Date | null = null;
    let stopped: boolean = false;

    while (OneUptimeDate.isBefore(cursor, until)) {
      const windowEnd: Date = OneUptimeDate.isBefore(
        OneUptimeDate.addRemoveSeconds(cursor, LOG_SCAN_WINDOW_IN_SECONDS),
        until,
      )
        ? OneUptimeDate.addRemoveSeconds(cursor, LOG_SCAN_WINDOW_IN_SECONDS)
        : until;

      let offset: number = skipInWindow;

      for (;;) {
        if (
          result.logsRead >= LOG_SCAN_MAX_LINES_PER_RUN ||
          !lease.hasTimeLeft()
        ) {
          // Out of this scan's budget: the next goes on from this line.
          result.partialWindowStart = cursor.toISOString();
          result.partialWindowProcessed = offset;
          stopped = true;
          break;
        }

        const rows: Array<JSONObject> =
          await LogService.findSecurityLogCandidates({
            projectId,
            arrivedAfter: cursor,
            arrivedUntil: windowEnd,
            happenedAfter: OneUptimeDate.addRemoveMinutes(
              cursor,
              -LOG_SCAN_LATE_LOG_WINDOW_IN_MINUTES,
            ),
            limit: LOG_SCAN_PAGE_SIZE,
            offset,
          });

        result.logsRead += rows.length;

        const events: Array<NormalizedSecurityEvent> = [];

        for (const row of rows) {
          events.push(
            ...SecurityLogParser.parse({
              body: typeof row["body"] === "string" ? row["body"] : "",
              attributes: readAttributes(row["attributes"]),
              time: readClickhouseDate(row["time"]) || now,
              logId: typeof row["_id"] === "string" ? row["_id"] : undefined,
              /*
               * The record the log was sent under (a Service, a Host, a
               * Kubernetes cluster...), so each event is connected to it
               * exactly, whatever names it carries.
               */
              resourceId:
                typeof row["primaryEntityId"] === "string"
                  ? row["primaryEntityId"]
                  : undefined,
              resourceType:
                typeof row["primaryEntityType"] === "string"
                  ? row["primaryEntityType"]
                  : undefined,
              /*
               * The request the line was written in, so each event links
               * to its trace, its exception and its session - and can be
               * followed (storeEvents).
               */
              traceId: readText(row["traceId"]),
              spanId: readText(row["spanId"]),
              sessionId: readText(row["sessionId"]),
            }),
          );
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
            result.lastFoundAtByFormat[format] = now.toISOString();
          }

          result.eventsFound += events.length;
          lastEventFoundAt = now;
        }

        offset += rows.length;

        if (rows.length < LOG_SCAN_PAGE_SIZE) {
          // The window is read to its end.
          break;
        }

        if (!(await lease.keep())) {
          // Another scan may have the project now: stop at this line.
          result.partialWindowStart = cursor.toISOString();
          result.partialWindowProcessed = offset;
          stopped = true;
          break;
        }
      }

      if (stopped) {
        break;
      }

      cursor = windowEnd;
      skipInWindow = 0;
      result.windows += 1;
      result.scannedTo = cursor.toISOString();
    }

    if (result.skippedBacklog) {
      logger.warn(
        `SecurityLogScanner: project ${projectId.toString()} fell more than ${LOG_SCAN_MAX_BACKLOG_IN_HOURS} hours behind; the logs that arrived between ${skippedFrom} and ${skippedTo} were not read.`,
      );
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
    /*
     * Each event made from a line written inside a traced request is
     * followed into that request first: the trace says who sent it, what
     * the app answered and how far an attack got - and an address found
     * there is then matched against threat intel like any other.
     */
    await SecurityRequestTrace.followEvents({
      projectId: data.projectId,
      events: data.events,
    });

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

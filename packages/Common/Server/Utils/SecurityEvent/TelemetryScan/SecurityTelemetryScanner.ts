import SecurityTelemetrySource from "../../../../Models/DatabaseModels/SecurityTelemetrySource";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  SECURITY_TELEMETRY_SIGNAL_ATTRIBUTE,
  SecurityTelemetrySourceDefinition,
  SecurityTelemetrySourceKind,
  getSecurityTelemetrySourceDefinition,
  isSecurityTelemetrySourceKind,
} from "../../../../Types/SecurityEvent/SecurityTelemetrySource";
import { resolveTelemetryRetentionInDays } from "../../../../Types/Telemetry/TelemetryRetentionConfig";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../Services/OpenTelemetryIngestService";
import SecurityEventService from "../../../Services/SecurityEventService";
import RealTimeDetections from "../RealTime/RealTimeDetections";
import SecurityTelemetrySourceService from "../../../Services/SecurityTelemetrySourceService";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import ConnectorErrorMessage from "../ConnectorErrorMessage";
import SecurityEventDedupe from "../SecurityEventDedupe";
import { buildSecurityEventDbRow } from "../SecurityEventRow";
import SecurityProjectWork, {
  SecurityProjectWorkDefinition,
  SecurityProjectWorkLease,
  UNLIMITED_SECURITY_PROJECT_WORK_LEASE,
} from "../SecurityProjectWork";
import ThreatIntelEnricher from "../ThreatIntel/ThreatIntelEnricher";
import AuditLogSecurityScan from "./AuditLogSecurityScan";
import FlowSecurityScan from "./FlowSecurityScan";
import RumSecurityScan from "./RumSecurityScan";
import { TelemetryScanWindow } from "./TelemetryScanStatements";
import { TelemetryWindowRead } from "./TelemetryScanTypes";
import TraceSecurityScan from "./TraceSecurityScan";

/*
 * "Your OneUptime data" (SecurityTelemetrySource): every minute, for each
 * project that turned one on, read what arrived of that kind of telemetry
 * since the last scan - traces, network flows, the audit log, session
 * replays - for what an attack leaves in it, and store each finding as a
 * security event, so the detection rules run on data the project already
 * sends. The counterpart of "Your logs" (LogScan/SecurityLogScanner.ts),
 * and built the same way:
 *
 *   - Data is read by when it ARRIVED, a window at a time, so a record that
 *     was written a while before it reached OneUptime is still read once;
 *     a window waits its kind's settle time so its last seconds have
 *     landed, and is read in a fixed order, so the same window reads the
 *     same way again.
 *   - The kinds that read rows (traces, the audit log) read a window a page
 *     at a time; a scan that runs out of its budget part way keeps its
 *     place - the window and the rows of it read - and the next goes on from
 *     there. The kinds that sum (network flows, session replays) read only
 *     whole windows, so a threshold always counts a whole window.
 *   - A source that fell more than TELEMETRY_SCAN_MAX_BACKLOG_IN_HOURS
 *     behind starts again from there, and its result says what it skipped.
 *   - An event is stored once: its id says what it is about, and an id the
 *     project already has is not stored again (SecurityEventDedupe) - a
 *     window read twice after a failure, a user seen in two countries all
 *     afternoon.
 *
 * Each kind's events are attributed to its own "OneUptime ..." service, as
 * the log scan's are to "OneUptime Logs". The work is spread by project
 * (SecurityProjectWork): the cron queues one turn for each project that
 * turned a source on, and the turn scans each of its sources.
 */

export const SECURITY_TELEMETRY_SCAN_PROJECT_WORK: SecurityProjectWorkDefinition =
  {
    jobName: "SecurityEvents:ScanProjectTelemetry",
    key: "security-telemetry-scan",
    maxConcurrentProjects: 8,
  };

export interface TelemetryScanPlan {
  // Data younger than this waits for the next scan, so a window is complete.
  settleInSeconds: number;
  // The longest window one read covers.
  windowInSeconds: number;
  // How long before it arrived a record may have happened and still be read.
  lateInMinutes: number;
  // Read only whole windows: a summed threshold counts a whole window.
  wholeWindowsOnly: boolean;
}

/*
 * Traces settle longer than logs (LOG_SCAN_SETTLE_IN_SECONDS): the log scan
 * reports a request whose attack the app logged first, and the trace scan
 * leaves that request to it.
 */
export const TELEMETRY_SCAN_PLANS: Record<
  SecurityTelemetrySourceKind,
  TelemetryScanPlan
> = {
  [SecurityTelemetrySourceKind.Traces]: {
    settleInSeconds: 60,
    windowInSeconds: 5 * 60,
    lateInMinutes: 60,
    wholeWindowsOnly: false,
  },
  [SecurityTelemetrySourceKind.NetworkFlows]: {
    settleInSeconds: 60,
    windowInSeconds: 5 * 60,
    lateInMinutes: 60,
    wholeWindowsOnly: true,
  },
  [SecurityTelemetrySourceKind.AuditLog]: {
    settleInSeconds: 15,
    windowInSeconds: 5 * 60,
    lateInMinutes: 0,
    wholeWindowsOnly: true,
  },
  [SecurityTelemetrySourceKind.RumSessions]: {
    settleInSeconds: 2 * 60,
    windowInSeconds: 5 * 60,
    lateInMinutes: 0,
    wholeWindowsOnly: true,
  },
};

// Rows one paged read returns.
export const TELEMETRY_SCAN_PAGE_SIZE: number = 1000;

/*
 * The most rows one scan of a source reads. A scan that reaches it part way
 * through a window stops there, and the next goes on from the row after.
 */
export const TELEMETRY_SCAN_MAX_RECORDS_PER_RUN: number = 20000;

/*
 * A scan that fell further behind than this starts again from here, and its
 * result names what it skipped.
 */
export const TELEMETRY_SCAN_MAX_BACKLOG_IN_HOURS: number = 24;

export interface SecurityTelemetryScanResult {
  recordsRead: number;
  eventsFound: number;
  // Events found, by signal (SecurityTelemetrySignal).
  bySignal: Record<string, number>;
  windows: number;
  /*
   * The scan had fallen too far behind and skipped ahead: what arrived
   * between skippedFrom and skippedTo was not read.
   */
  skippedBacklog: boolean;
  skippedFrom: string;
  skippedTo: string;
  /*
   * The window the scan stopped in, and how many of its rows it had read:
   * the next scan goes on from the row after. Empty when the scan reached
   * the present.
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

function readNumber(value: JSONValue | undefined): number {
  const number: number = typeof value === "number" ? value : Number(value);

  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

function addSeconds(date: Date, seconds: number): Date {
  return OneUptimeDate.addRemoveSeconds(date, seconds);
}

export default class SecurityTelemetryScanner {
  /*
   * The cron's half: every enabled source in the instance, and one turn
   * queued for each project that has one. Returns how many were queued.
   */
  @CaptureSpan()
  public static async enqueueProjectsWithEnabledSources(): Promise<number> {
    const sources: Array<SecurityTelemetrySource> =
      await SecurityTelemetrySourceService.findAllBy({
        query: { isEnabled: true },
        select: {
          _id: true,
          projectId: true,
        },
        sort: { _id: SortOrder.Ascending },
        props: { isRoot: true },
      });

    return SecurityProjectWork.enqueueProjects(
      SECURITY_TELEMETRY_SCAN_PROJECT_WORK,
      sources.map((source: SecurityTelemetrySource): ObjectID | undefined => {
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
    const sources: Array<SecurityTelemetrySource> =
      await SecurityTelemetrySourceService.findAllBy({
        query: { projectId, isEnabled: true },
        select: {
          _id: true,
          projectId: true,
          kind: true,
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
    source: SecurityTelemetrySource,
    lease: SecurityProjectWorkLease,
  ): Promise<void> {
    if (!source.projectId || !source.id) {
      return;
    }

    try {
      await this.scanSource(source, lease);
    } catch (error) {
      logger.error(
        `SecurityTelemetryScanner: scan of project ${source.projectId.toString()}'s ${String(
          source.kind,
        )} failed:`,
      );
      logger.error(error);

      const sourceId: ObjectID = source.id;

      await ConnectorErrorMessage.recordFailure({
        label: `SecurityTelemetryScanner: project ${source.projectId.toString()} ${String(
          source.kind,
        )}`,
        write: async (): Promise<void> => {
          await SecurityTelemetrySourceService.updateOneById({
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

  // One window's read of a kind: a page of it, or the whole of it.
  public static async readWindow(data: {
    kind: SecurityTelemetrySourceKind;
    window: TelemetryScanWindow;
    offset: number;
    pageSize: number;
  }): Promise<TelemetryWindowRead> {
    switch (data.kind) {
      case SecurityTelemetrySourceKind.Traces:
        return TraceSecurityScan.readWindow(data);
      case SecurityTelemetrySourceKind.NetworkFlows:
        return FlowSecurityScan.readWindow(data);
      case SecurityTelemetrySourceKind.AuditLog:
        return AuditLogSecurityScan.readWindow(data);
      case SecurityTelemetrySourceKind.RumSessions:
        return RumSecurityScan.readWindow(data);
    }
  }

  // Read the windows since the cursor, store what they hold, move the cursor.
  @CaptureSpan()
  public static async scanSource(
    source: SecurityTelemetrySource,
    lease: SecurityProjectWorkLease = UNLIMITED_SECURITY_PROJECT_WORK_LEASE,
  ): Promise<SecurityTelemetryScanResult> {
    const projectId: ObjectID = source.projectId!;
    const kind: unknown = source.kind;

    if (!isSecurityTelemetrySourceKind(kind)) {
      throw new Error(`Unknown telemetry source kind "${String(kind)}".`);
    }

    const plan: TelemetryScanPlan = TELEMETRY_SCAN_PLANS[kind];
    const now: Date = OneUptimeDate.getCurrentDate();
    const until: Date = addSeconds(now, -plan.settleInSeconds);
    const oldestAllowed: Date = OneUptimeDate.addRemoveHours(
      now,
      -TELEMETRY_SCAN_MAX_BACKLOG_IN_HOURS,
    );

    let cursor: Date = readCursor(source.cursor) || until;

    /*
     * A scan that stopped part way through a window goes on from the row
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

    const result: SecurityTelemetryScanResult = {
      recordsRead: 0,
      eventsFound: 0,
      bySignal: {},
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

    const hasWindowToRead: () => boolean = (): boolean => {
      return plan.wholeWindowsOnly
        ? !OneUptimeDate.isAfter(
            addSeconds(cursor, plan.windowInSeconds),
            until,
          )
        : OneUptimeDate.isBefore(cursor, until);
    };

    while (hasWindowToRead()) {
      const fullEnd: Date = addSeconds(cursor, plan.windowInSeconds);
      const windowEnd: Date = OneUptimeDate.isBefore(fullEnd, until)
        ? fullEnd
        : until;

      let offset: number = skipInWindow;

      for (;;) {
        if (
          result.recordsRead >= TELEMETRY_SCAN_MAX_RECORDS_PER_RUN ||
          !lease.hasTimeLeft()
        ) {
          // Out of this scan's budget: the next goes on from this row.
          result.partialWindowStart = cursor.toISOString();
          result.partialWindowProcessed = offset;
          stopped = true;
          break;
        }

        const read: TelemetryWindowRead = await this.readWindow({
          kind,
          window: {
            projectId,
            arrivedAfter: cursor,
            arrivedUntil: windowEnd,
            happenedAfter: OneUptimeDate.addRemoveMinutes(
              cursor,
              -plan.lateInMinutes,
            ),
          },
          offset,
          pageSize: TELEMETRY_SCAN_PAGE_SIZE,
        });

        result.recordsRead += read.recordsRead;

        if (read.events.length > 0) {
          serviceMetadata =
            serviceMetadata ||
            (await OTelIngestService.telemetryServiceFromName({
              serviceName:
                getSecurityTelemetrySourceDefinition(kind).serviceName,
              projectId,
            }));

          const stored: Array<NormalizedSecurityEvent> = await this.storeEvents(
            {
              projectId,
              kind,
              events: read.events,
              serviceMetadata,
            },
          );

          for (const event of stored) {
            const signal: string = String(
              event.attributes[SECURITY_TELEMETRY_SIGNAL_ATTRIBUTE] || "",
            );
            result.bySignal[signal] = (result.bySignal[signal] || 0) + 1;
          }

          result.eventsFound += stored.length;

          if (stored.length > 0) {
            lastEventFoundAt = now;
          }
        }

        offset += read.pageRows;

        if (!read.hasMore) {
          // The window is read to its end.
          break;
        }

        if (!(await lease.keep())) {
          // Another scan may have the project now: stop at this row.
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
        `SecurityTelemetryScanner: project ${projectId.toString()}'s ${kind} fell more than ${TELEMETRY_SCAN_MAX_BACKLOG_IN_HOURS} hours behind; what arrived between ${skippedFrom} and ${skippedTo} was not read.`,
      );
    }

    await SecurityTelemetrySourceService.updateOneById({
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

  /*
   * Store a read's events: prepared (a trace's are followed), each id once
   * - in the read, and against what the project already holds - enriched
   * with threat intel, then inserted. Returns the events stored.
   */
  public static async storeEvents(data: {
    projectId: ObjectID;
    kind: SecurityTelemetrySourceKind;
    events: Array<NormalizedSecurityEvent>;
    serviceMetadata: TelemetryServiceMetadata;
  }): Promise<Array<NormalizedSecurityEvent>> {
    let events: Array<NormalizedSecurityEvent> = data.events;

    if (data.kind === SecurityTelemetrySourceKind.Traces) {
      events = await TraceSecurityScan.prepareEvents({
        projectId: data.projectId,
        events,
      });
    }

    const seen: Set<string> = new Set();

    events = events.filter((event: NormalizedSecurityEvent): boolean => {
      if (!event.eventUid || seen.has(event.eventUid)) {
        return false;
      }

      seen.add(event.eventUid);
      return true;
    });

    if (events.length === 0) {
      return [];
    }

    const definition: SecurityTelemetrySourceDefinition =
      getSecurityTelemetrySourceDefinition(data.kind);

    const existing: Set<string> =
      await SecurityEventDedupe.findExistingEventUids({
        projectId: data.projectId,
        vendorName: definition.vendorName,
        productName: definition.productName,
        ids: events.map((event: NormalizedSecurityEvent): string => {
          return event.eventUid;
        }),
      });

    events = events.filter((event: NormalizedSecurityEvent): boolean => {
      return !existing.has(event.eventUid);
    });

    if (events.length === 0) {
      return [];
    }

    // Threat intel stamps its matches before the rows are built, as ingest does.
    await ThreatIntelEnricher.enrichNormalizedEvents({
      projectId: data.projectId,
      events,
    });

    const retentionDays: number = resolveTelemetryRetentionInDays({
      pillar: "securityEvents",
      serviceConfig: data.serviceMetadata.serviceRetentionConfig,
      serviceRetentionInDays: data.serviceMetadata.serviceRetentionInDays,
      projectConfig: data.serviceMetadata.projectRetentionConfig,
      projectRetentionInDays: data.serviceMetadata.projectRetentionInDays,
    });

    const rows: Array<JSONObject> = events.map(
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

    // Checked against the project's real-time detection rules as they land.
    await RealTimeDetections.screen({ projectId: data.projectId, rows });

    return events;
  }
}

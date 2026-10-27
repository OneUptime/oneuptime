import { ResponseJSON } from "@clickhouse/client";
import SecurityEvent from "../../../../Models/AnalyticsModels/SecurityEvent";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import Includes from "../../../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  SECURITY_TELEMETRY_SIGNAL_ATTRIBUTE,
  SecurityTelemetrySignal,
  SecurityTelemetrySourceKind,
  getSecurityTelemetrySourceDefinition,
} from "../../../../Types/SecurityEvent/SecurityTelemetrySource";
import {
  TRACE_SCAN_ATTRIBUTES_READ,
  TraceScanSpan,
  buildTraceSecurityEvents,
  markSsrfFetched,
  readMetadataCallOf,
} from "../../../../Utils/SecurityEvent/TelemetryScan/TraceSignals";
import { Results } from "../../../Services/AnalyticsDatabaseService";
import SecurityEventService from "../../../Services/SecurityEventService";
import SpanService from "../../../Services/SpanService";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import SecurityRequestTrace from "../RequestTrace/SecurityRequestTrace";
import {
  TelemetryScanWindow,
  buildTraceCandidatesStatement,
} from "./TelemetryScanStatements";
import {
  readRowBoolean,
  readRowDate,
  readRowMap,
  readRowNumber,
  readRowText,
} from "./TelemetryScanRows";
import { TelemetryWindowRead } from "./TelemetryScanTypes";

/*
 * "Your OneUptime data" - traces: a window of arrived spans read for the
 * attacks they record (Utils/SecurityEvent/TelemetryScan/TraceSignals.ts),
 * a page at a time.
 *
 * Before the events of a page are stored (prepareEvents):
 *
 *   - a request "Your logs" already reported - the app logged the attack,
 *     and the log scan, which settles sooner, made it an event - is left to
 *     that event, so one request is one event;
 *   - a forgery toward cloud metadata is told whether the app then called
 *     that address, from the client spans of its trace;
 *   - each request is followed into its trace (RequestTrace/
 *     SecurityRequestTrace.ts), so it is stored knowing whether it reached
 *     the database, threw, or was turned away.
 *
 * Each of those reads is bounded and failure-tolerant: one that fails is
 * logged and the events are stored as the spans said them.
 */

// How far around a page's spans its follow-up reads look.
export const TRACE_FOLLOW_UP_WINDOW_IN_MINUTES: number = 60;

// The most traces one page's follow-up reads ask about.
export const MAX_TRACES_CHECKED_PER_PAGE: number = 500;

// The most spans of one trace the forgery check reads.
export const MAX_SPANS_READ_PER_FORGERY: number = 100;

export function toTraceScanSpan(row: JSONObject): TraceScanSpan {
  return {
    traceId: readRowText(row["traceId"]),
    spanId: readRowText(row["spanId"]),
    parentSpanId: readRowText(row["parentSpanId"]),
    sessionId: readRowText(row["sessionId"]),
    name: readRowText(row["name"]),
    kind: readRowText(row["kind"]),
    // Stored in nanoseconds, read as a quoted 64-bit integer.
    durationMs: readRowNumber(row["durationUnixNano"]) / 1_000_000,
    startTime: readRowDate(row["startTime"]) || new Date(0),
    serviceId: readRowText(row["primaryEntityId"]),
    serviceType: readRowText(row["primaryEntityType"]),
    isLlmSpan: readRowBoolean(row["isLlmSpan"]),
    llmUserMessagePreview: readRowText(row["llmUserMessagePreview"]),
    llmUserId: readRowText(row["llmUserId"]),
    llmSystem: readRowText(row["llmSystem"]),
    llmRequestModel: readRowText(row["llmRequestModel"]),
    llmOperation: readRowText(row["llmOperation"]),
    attributes: readRowMap(row["attributes"]),
  };
}

function signalOf(event: NormalizedSecurityEvent): string {
  return String(event.attributes[SECURITY_TELEMETRY_SIGNAL_ATTRIBUTE] || "");
}

function uniqueTraceIds(
  events: Array<NormalizedSecurityEvent>,
  limit: number,
): Array<string> {
  const ids: Array<string> = [];

  for (const event of events) {
    const id: string = (event.traceId || "").trim();

    if (id && !ids.includes(id)) {
      ids.push(id);
    }

    if (ids.length >= limit) {
      break;
    }
  }

  return ids;
}

function timeRangeOf(
  events: Array<NormalizedSecurityEvent>,
  marginInMinutes: number,
): { from: Date; to: Date } | null {
  const times: Array<number> = events
    .map((event: NormalizedSecurityEvent): number => {
      return event.time instanceof Date ? event.time.getTime() : NaN;
    })
    .filter((time: number): boolean => {
      return Number.isFinite(time);
    });

  if (times.length === 0) {
    return null;
  }

  const margin: number = marginInMinutes * 60 * 1000;

  return {
    from: new Date(Math.min(...times) - margin),
    to: new Date(Math.max(...times) + margin),
  };
}

export default class TraceSecurityScan {
  @CaptureSpan()
  public static async readWindow(data: {
    window: TelemetryScanWindow;
    offset: number;
    pageSize: number;
  }): Promise<TelemetryWindowRead> {
    const result: Results = await SpanService.executeQuery(
      buildTraceCandidatesStatement({
        ...data.window,
        limit: data.pageSize,
        offset: data.offset,
      }),
    );
    const response: ResponseJSON<JSONObject> = await result.json<JSONObject>();
    const rows: Array<JSONObject> = (response.data || []) as Array<JSONObject>;

    const events: Array<NormalizedSecurityEvent> = [];

    for (const row of rows) {
      events.push(...buildTraceSecurityEvents(toTraceScanSpan(row)));
    }

    return {
      events,
      recordsRead: rows.length,
      pageRows: rows.length,
      hasMore: rows.length >= data.pageSize,
    };
  }

  @CaptureSpan()
  public static async prepareEvents(data: {
    projectId: ObjectID;
    events: Array<NormalizedSecurityEvent>;
  }): Promise<Array<NormalizedSecurityEvent>> {
    const events: Array<NormalizedSecurityEvent> =
      await this.leaveRequestsToTheirLogs(data);

    await this.markFetchedForgeries({ projectId: data.projectId, events });

    await SecurityRequestTrace.followEvents({
      projectId: data.projectId,
      events: events.filter((event: NormalizedSecurityEvent): boolean => {
        return signalOf(event) === SecurityTelemetrySignal.WebAttack;
      }),
    });

    return events;
  }

  /*
   * The attacks whose request "Your logs" already made an event of: one
   * request is one event, and the log's says what the app wrote about it.
   */
  public static async leaveRequestsToTheirLogs(data: {
    projectId: ObjectID;
    events: Array<NormalizedSecurityEvent>;
  }): Promise<Array<NormalizedSecurityEvent>> {
    const attacks: Array<NormalizedSecurityEvent> = data.events.filter(
      (event: NormalizedSecurityEvent): boolean => {
        return (
          signalOf(event) === SecurityTelemetrySignal.WebAttack &&
          Boolean(event.traceId)
        );
      },
    );

    const range: { from: Date; to: Date } | null = timeRangeOf(
      attacks,
      TRACE_FOLLOW_UP_WINDOW_IN_MINUTES,
    );

    if (attacks.length === 0 || !range) {
      return data.events;
    }

    const tracesProduct: string = getSecurityTelemetrySourceDefinition(
      SecurityTelemetrySourceKind.Traces,
    ).productName;

    let reported: Array<SecurityEvent>;

    try {
      reported = await SecurityEventService.findBy({
        query: {
          projectId: data.projectId,
          traceId: new Includes(
            uniqueTraceIds(attacks, MAX_TRACES_CHECKED_PER_PAGE),
          ),
          time: new InBetween(range.from, range.to),
        },
        select: { traceId: true, className: true, productName: true },
        skip: 0,
        limit: MAX_TRACES_CHECKED_PER_PAGE * 4,
        props: { isRoot: true },
      });
    } catch (error) {
      logger.warn(
        `TraceSecurityScan: could not check which requests of project ${data.projectId.toString()} its logs already reported; each is stored from its span.`,
      );
      logger.warn(error);
      return data.events;
    }

    const covered: Set<string> = new Set();

    for (const event of reported) {
      if (
        event.traceId &&
        event.className === "HTTP Activity" &&
        event.productName !== tracesProduct
      ) {
        covered.add(event.traceId);
      }
    }

    return data.events.filter((event: NormalizedSecurityEvent): boolean => {
      return !(
        signalOf(event) === SecurityTelemetrySignal.WebAttack &&
        covered.has(event.traceId || "")
      );
    });
  }

  // Each forgery whose trace shows the app calling a metadata address worked.
  public static async markFetchedForgeries(data: {
    projectId: ObjectID;
    events: Array<NormalizedSecurityEvent>;
  }): Promise<void> {
    const forgeries: Array<NormalizedSecurityEvent> = data.events.filter(
      (event: NormalizedSecurityEvent): boolean => {
        return (
          signalOf(event) === SecurityTelemetrySignal.ServerSideRequestForgery &&
          Boolean(event.traceId)
        );
      },
    );

    const range: { from: Date; to: Date } | null = timeRangeOf(
      forgeries,
      TRACE_FOLLOW_UP_WINDOW_IN_MINUTES,
    );

    if (forgeries.length === 0 || !range) {
      return;
    }

    const traceIds: Array<string> = uniqueTraceIds(
      forgeries,
      MAX_TRACES_CHECKED_PER_PAGE,
    );

    let rows: Array<JSONObject>;

    try {
      rows = await SpanService.findSpansOfTraces({
        projectId: data.projectId,
        traceIds,
        startedAfter: range.from,
        startedBefore: range.to,
        attributeKeys: [...TRACE_SCAN_ATTRIBUTES_READ],
        limitPerTrace: MAX_SPANS_READ_PER_FORGERY,
        limit: MAX_SPANS_READ_PER_FORGERY * traceIds.length,
      });
    } catch (error) {
      logger.warn(
        `TraceSecurityScan: could not read the traces of project ${data.projectId.toString()}'s forgery attempts; each is stored as attempted.`,
      );
      logger.warn(error);
      return;
    }

    const calls: Map<string, string> = new Map();

    for (const row of rows) {
      const span: TraceScanSpan = toTraceScanSpan(row);
      const called: string = readMetadataCallOf(span);

      if (called && span.traceId && !calls.has(span.traceId)) {
        calls.set(span.traceId, called);
      }
    }

    for (const event of forgeries) {
      const called: string | undefined = calls.get(event.traceId || "");

      if (called) {
        markSsrfFetched(event, called);
      }
    }
  }
}

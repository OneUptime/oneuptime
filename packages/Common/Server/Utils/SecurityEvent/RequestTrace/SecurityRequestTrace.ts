import { JSONObject, JSONValue } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { getSqlInjectionMarkers } from "../../../../Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import { applyRequestAssessment } from "../../../../Utils/SecurityEvent/RequestFollowUp";
import {
  REQUEST_SPAN_ATTRIBUTES_READ,
  RequestTraceAssessment,
  RequestTraceException,
  RequestTraceSpan,
  assessRequestTrace,
} from "../../../../Utils/SecurityEvent/RequestOutcome";
import ExceptionInstanceService from "../../../Services/ExceptionInstanceService";
import SpanService from "../../../Services/SpanService";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * FOLLOWING A SECURITY EVENT INTO ITS REQUEST.
 *
 * A log line written inside a traced request carries the trace's id
 * (SecurityLogLine.traceId), and OneUptime holds that trace: the span that
 * answered the request and every span under it, and the exceptions they
 * recorded. Reading them says what the line alone cannot - the status the
 * app answered, the client that sent it, the user it was signed in as, the
 * exception it threw, the query it ran - and so how far an attack got
 * (Utils/SecurityEvent/RequestOutcome.ts).
 *
 * The log scan follows the events it found before it stores them
 * (followEvents), so each is stored knowing what happened next; the event's
 * panel reads the same trace again when it is opened (readTraces), so an
 * event whose spans arrived after the scan is still told right.
 *
 * Bounded at every step: at most MAX_TRACES_FOLLOWED traces a call, read
 * in one query for their spans and one for their exceptions, in a window
 * of TRACE_WINDOW_IN_MINUTES around the events, at most
 * MAX_SPANS_PER_TRACE spans of each. A trace that is not there (not sampled,
 * kept less long than security events) leaves its event as it was. A read
 * that fails is logged and the events are stored anyway: following is
 * worth having, never worth losing an event over.
 */

export const MAX_TRACES_FOLLOWED: number = 200;
export const MAX_SPANS_PER_TRACE: number = 100;
export const MAX_EXCEPTIONS_PER_TRACE: number = 5;
// Spans start before the line inside them is written, and end after.
export const TRACE_WINDOW_IN_MINUTES: number = 15;

export interface SecurityRequestTraceRows {
  spans: Array<RequestTraceSpan>;
  exceptions: Array<RequestTraceException & { serviceId: string }>;
}

function readText(value: JSONValue | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  return typeof value === "string" ? value : String(value);
}

function readNumber(value: JSONValue | undefined): number {
  const number: number = typeof value === "number" ? value : Number(value);

  return Number.isFinite(number) ? number : 0;
}

function readStringMap(value: JSONValue | undefined): Record<string, string> {
  const map: Record<string, string> = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return map;
  }

  for (const [key, entry] of Object.entries(value as JSONObject)) {
    if (entry !== null && entry !== undefined) {
      map[key] = typeof entry === "string" ? entry : String(entry);
    }
  }

  return map;
}

export function toRequestTraceSpan(row: JSONObject): RequestTraceSpan {
  return {
    spanId: readText(row["spanId"]),
    parentSpanId: readText(row["parentSpanId"]),
    name: readText(row["name"]),
    kind: readText(row["kind"]),
    statusCode: readNumber(row["statusCode"]),
    // Stored in nanoseconds, read as a quoted 64-bit integer.
    durationMs: readNumber(row["durationUnixNano"]) / 1_000_000,
    attributes: readStringMap(row["attributes"]),
  };
}

export function toRequestTraceException(
  row: JSONObject,
): RequestTraceException & { serviceId: string } {
  return {
    spanId: readText(row["spanId"]),
    fingerprint: readText(row["fingerprint"]),
    exceptionType: readText(row["exceptionType"]),
    message: readText(row["message"]),
    serviceId: readText(row["primaryEntityId"]),
  };
}

// The traces' distinct ids, at most MAX_TRACES_FOLLOWED of them.
export function readTraceIds(
  events: ReadonlyArray<{ traceId?: string | undefined }>,
): Array<string> {
  const ids: Array<string> = [];

  for (const event of events) {
    const id: string = (event.traceId || "").trim();

    if (id && !ids.includes(id)) {
      ids.push(id);
    }

    if (ids.length >= MAX_TRACES_FOLLOWED) {
      break;
    }
  }

  return ids;
}

export default class SecurityRequestTrace {
  // The spans and exceptions of the given traces, by trace id.
  @CaptureSpan()
  public static async readTraces(data: {
    projectId: ObjectID;
    traceIds: Array<string>;
    from: Date;
    to: Date;
  }): Promise<Map<string, SecurityRequestTraceRows>> {
    const traces: Map<string, SecurityRequestTraceRows> = new Map();
    const traceIds: Array<string> = data.traceIds.slice(0, MAX_TRACES_FOLLOWED);

    if (traceIds.length === 0) {
      return traces;
    }

    const from: Date = new Date(
      data.from.getTime() - TRACE_WINDOW_IN_MINUTES * 60 * 1000,
    );
    const to: Date = new Date(
      data.to.getTime() + TRACE_WINDOW_IN_MINUTES * 60 * 1000,
    );

    const [spanRows, exceptionRows] = await Promise.all([
      SpanService.findSpansOfTraces({
        projectId: data.projectId,
        traceIds,
        startedAfter: from,
        startedBefore: to,
        attributeKeys: [...REQUEST_SPAN_ATTRIBUTES_READ],
        limitPerTrace: MAX_SPANS_PER_TRACE,
        limit: MAX_SPANS_PER_TRACE * traceIds.length,
      }),
      ExceptionInstanceService.findExceptionsOfTraces({
        projectId: data.projectId,
        traceIds,
        after: from,
        before: to,
        limitPerTrace: MAX_EXCEPTIONS_PER_TRACE,
        limit: MAX_EXCEPTIONS_PER_TRACE * traceIds.length,
      }),
    ]);

    const rowsOf: (traceId: string) => SecurityRequestTraceRows = (
      traceId: string,
    ): SecurityRequestTraceRows => {
      let rows: SecurityRequestTraceRows | undefined = traces.get(traceId);

      if (!rows) {
        rows = { spans: [], exceptions: [] };
        traces.set(traceId, rows);
      }

      return rows;
    };

    for (const row of spanRows) {
      const traceId: string = readText(row["traceId"]);

      if (traceId) {
        rowsOf(traceId).spans.push(toRequestTraceSpan(row));
      }
    }

    for (const row of exceptionRows) {
      const traceId: string = readText(row["traceId"]);

      if (traceId) {
        rowsOf(traceId).exceptions.push(toRequestTraceException(row));
      }
    }

    return traces;
  }

  // What one event's trace says, or null when OneUptime holds none of it.
  public static assess(data: {
    event: {
      spanId?: string | undefined;
      targetResource?: string | undefined;
    };
    rows: SecurityRequestTraceRows | undefined;
  }): RequestTraceAssessment | null {
    if (
      !data.rows ||
      (data.rows.spans.length === 0 && data.rows.exceptions.length === 0)
    ) {
      return null;
    }

    return assessRequestTrace({
      spans: data.rows.spans,
      exceptions: data.rows.exceptions,
      eventSpanId: data.event.spanId || "",
      sqlMarkers: getSqlInjectionMarkers(),
      requestText: data.event.targetResource || "",
    });
  }

  /*
   * Follow every event that names a trace, and write what each trace says
   * onto its event (applyRequestAssessment). Returns how many events were
   * followed; never throws.
   */
  @CaptureSpan()
  public static async followEvents(data: {
    projectId: ObjectID;
    events: Array<NormalizedSecurityEvent>;
  }): Promise<number> {
    const toFollow: Array<NormalizedSecurityEvent> = data.events.filter(
      (event: NormalizedSecurityEvent): boolean => {
        return Boolean((event.traceId || "").trim());
      },
    );

    if (toFollow.length === 0) {
      return 0;
    }

    const traceIds: Array<string> = readTraceIds(toFollow);
    const times: Array<number> = toFollow
      .map((event: NormalizedSecurityEvent): number => {
        return event.time instanceof Date ? event.time.getTime() : NaN;
      })
      .filter((time: number): boolean => {
        return Number.isFinite(time);
      });

    if (times.length === 0) {
      return 0;
    }

    let traces: Map<string, SecurityRequestTraceRows>;

    try {
      traces = await this.readTraces({
        projectId: data.projectId,
        traceIds,
        from: new Date(Math.min(...times)),
        to: new Date(Math.max(...times)),
      });
    } catch (error) {
      logger.warn(
        `SecurityRequestTrace: could not read the traces of project ${data.projectId.toString()}'s security events; they are stored as the log lines said them.`,
      );
      logger.warn(error);
      return 0;
    }

    let followed: number = 0;

    for (const event of toFollow) {
      const assessment: RequestTraceAssessment | null = this.assess({
        event,
        rows: traces.get((event.traceId || "").trim()),
      });

      if (!assessment) {
        continue;
      }

      applyRequestAssessment(event, assessment);
      followed++;
    }

    return followed;
  }
}

import { useEffect, useMemo, useState } from "react";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import Span from "Common/Models/AnalyticsModels/Span";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  REQUEST_SPAN_ATTRIBUTES_READ,
  RequestTraceAssessment,
  RequestTraceException,
  RequestTraceSpan,
  assessRequestTrace,
} from "Common/Utils/SecurityEvent/RequestOutcome";
import { getSqlInjectionMarkers } from "Common/Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  SecurityEventRequestFacts,
  mergeAssessment,
  readSecurityEventRequestFacts,
} from "./SecurityEventRequestStory";

/*
 * What happened next to the request behind a security event.
 *
 * The event says what the log scan learned when it stored it
 * (Server/Utils/SecurityEvent/RequestTrace). When the event names a trace
 * but says nothing of its outcome - its spans reached OneUptime after the
 * scan, or it came from a source that does not follow - the panel reads the
 * trace itself, with the reader's own permissions, and judges it the way
 * the scan would have (assessRequestTrace). A reader who may not read
 * traces gets what the event said, and nothing breaks.
 */

// The most spans and exceptions of one trace the panel reads.
export const PANEL_TRACE_SPAN_LIMIT: number = 100;
export const PANEL_TRACE_EXCEPTION_LIMIT: number = 5;
// Spans start before the line inside them is written, and end after.
export const PANEL_TRACE_WINDOW_IN_MINUTES: number = 15;

export interface SecurityEventRequestStory {
  facts: SecurityEventRequestFacts;
  hasTrace: boolean;
  isReadingTrace: boolean;
}

function toAttributeMap(value: unknown): Record<string, string> {
  const map: Record<string, string> = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return map;
  }

  for (const key of REQUEST_SPAN_ATTRIBUTES_READ) {
    const entry: unknown = (value as JSONObject)[key];

    if (entry !== undefined && entry !== null) {
      map[key] = String(entry);
    }
  }

  return map;
}

export function toPanelTraceSpan(span: Span): RequestTraceSpan {
  return {
    spanId: span.spanId || "",
    parentSpanId: span.parentSpanId || "",
    name: span.name || "",
    kind: String(span.kind || ""),
    statusCode: Number(span.statusCode) || 0,
    durationMs: (Number(span.durationUnixNano) || 0) / 1_000_000,
    attributes: toAttributeMap(span.attributes),
  };
}

export function toPanelTraceException(
  exception: ExceptionInstance,
): RequestTraceException {
  return {
    spanId: exception.spanId || "",
    fingerprint: exception.fingerprint || "",
    exceptionType: exception.exceptionType || "",
    message: exception.message || "",
  };
}

async function readTrace(data: {
  traceId: string;
  time: Date;
}): Promise<{
  spans: Array<RequestTraceSpan>;
  exceptions: Array<RequestTraceException>;
}> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const window: InBetween<Date> = new InBetween<Date>(
    new Date(
      data.time.getTime() - PANEL_TRACE_WINDOW_IN_MINUTES * 60 * 1000,
    ),
    new Date(
      data.time.getTime() + PANEL_TRACE_WINDOW_IN_MINUTES * 60 * 1000,
    ),
  );

  const [spans, exceptions] = await Promise.all([
    AnalyticsModelAPI.getList<Span>({
      modelType: Span,
      query: {
        ...(projectId ? { projectId } : {}),
        traceId: data.traceId,
        startTime: window,
      } as Query<Span>,
      limit: PANEL_TRACE_SPAN_LIMIT,
      skip: 0,
      select: {
        spanId: true,
        parentSpanId: true,
        name: true,
        kind: true,
        statusCode: true,
        durationUnixNano: true,
        attributes: true,
      } as Select<Span>,
      sort: { startTime: SortOrder.Ascending } as Record<string, SortOrder>,
      requestOptions: {},
    }),
    /*
     * A reader who may read spans but not exceptions still gets the
     * verdict the spans give.
     */
    AnalyticsModelAPI.getList<ExceptionInstance>({
      modelType: ExceptionInstance,
      query: {
        ...(projectId ? { projectId } : {}),
        traceId: data.traceId,
        time: window,
      } as Query<ExceptionInstance>,
      limit: PANEL_TRACE_EXCEPTION_LIMIT,
      skip: 0,
      select: {
        spanId: true,
        fingerprint: true,
        exceptionType: true,
        message: true,
      } as Select<ExceptionInstance>,
      sort: { time: SortOrder.Ascending } as Record<string, SortOrder>,
      requestOptions: {},
    }).catch((): ListResult<ExceptionInstance> => {
      return { data: [], count: 0, skip: 0, limit: 0 };
    }),
  ]);

  return {
    spans: spans.data.map(toPanelTraceSpan),
    exceptions: exceptions.data.map(toPanelTraceException),
  };
}

export default function useSecurityEventRequestStory(
  event: SecurityEvent,
): SecurityEventRequestStory {
  const storedFacts: SecurityEventRequestFacts = useMemo(() => {
    return readSecurityEventRequestFacts(event);
  }, [event]);

  const traceId: string = (event.traceId || "").trim();
  const time: Date | null = event.time ? new Date(event.time) : null;
  const timeKey: number = time ? time.getTime() : NaN;
  const shouldReadTrace: boolean =
    Boolean(traceId) && !storedFacts.outcome && Number.isFinite(timeKey);

  const [assessment, setAssessment] = useState<RequestTraceAssessment | null>(
    null,
  );
  const [isReadingTrace, setIsReadingTrace] = useState<boolean>(false);

  useEffect(() => {
    setAssessment(null);

    if (!shouldReadTrace) {
      setIsReadingTrace(false);
      return;
    }

    let isCurrent: boolean = true;
    setIsReadingTrace(true);

    readTrace({ traceId, time: new Date(timeKey) })
      .then(
        (trace: {
          spans: Array<RequestTraceSpan>;
          exceptions: Array<RequestTraceException>;
        }): void => {
          if (!isCurrent) {
            return;
          }

          setAssessment(
            trace.spans.length > 0 || trace.exceptions.length > 0
              ? assessRequestTrace({
                  spans: trace.spans,
                  exceptions: trace.exceptions,
                  eventSpanId: (event.spanId || "").trim(),
                  sqlMarkers: getSqlInjectionMarkers(),
                  requestText: event.targetResource || "",
                })
              : null,
          );
        },
      )
      .catch((): void => {
        // The reader may not read traces, or the read failed: say what the event says.
      })
      .finally((): void => {
        if (isCurrent) {
          setIsReadingTrace(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [shouldReadTrace, traceId, timeKey, event.spanId, event.targetResource]);

  const facts: SecurityEventRequestFacts = useMemo(() => {
    return mergeAssessment(storedFacts, assessment);
  }, [storedFacts, assessment]);

  return {
    facts,
    hasTrace: Boolean(traceId),
    isReadingTrace,
  };
}

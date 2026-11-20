import {
  SecurityCaseMatchedDetectionJson,
  SecurityCaseMatchedEventJson,
} from "../../../Types/SecurityCase/SecurityCaseMatches";
import {
  RESPONSE_LINK_MAX_TRACES,
  ResponseEventsLink,
  ResponseLinkKind,
  ResponseTracesLink,
} from "../../../Types/SecurityCase/SecurityCaseResponseLink";
import SecurityEventRequestOutcome from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";

/*
 * The links a case's Response Plan carries, as descriptors
 * (Types/SecurityCase/SecurityCaseResponseLink): what a step's button
 * opens, worked out from the case alone, with no app's routes in it.
 */

// The most traces a step's link carries.
export const RESPONSE_MAX_TRACES: number = RESPONSE_LINK_MAX_TRACES;

// Padding either side of a detection's window for the events it opens.
export const RESPONSE_EVENTS_PADDING_IN_MINUTES: number = 5;

/*
 * The traces of the matched requests that got past the app's checks - or
 * of them all - over the detection's window. Null when none was traced.
 */
export function getRequestTracesLink(data: {
  detection: SecurityCaseMatchedDetectionJson;
  onlyThrough: boolean;
}): ResponseTracesLink | null {
  const traceIds: Array<string> = Array.from(
    new Set(
      data.detection.events
        .filter((event: SecurityCaseMatchedEventJson): boolean => {
          return (
            !data.onlyThrough ||
            (Boolean(event.requestOutcome) &&
              event.requestOutcome !== SecurityEventRequestOutcome.Rejected)
          );
        })
        .map((event: SecurityCaseMatchedEventJson): string => {
          return event.traceId.trim();
        })
        .filter(Boolean),
    ),
  ).slice(0, RESPONSE_MAX_TRACES);

  if (traceIds.length === 0) {
    return null;
  }

  const start: Date | null = data.detection.windowStart
    ? new Date(data.detection.windowStart)
    : null;
  const end: Date | null = data.detection.windowEnd
    ? new Date(data.detection.windowEnd)
    : null;
  const hasWindow: boolean = Boolean(
    start &&
      end &&
      !Number.isNaN(start.getTime()) &&
      !Number.isNaN(end.getTime()),
  );

  return {
    kind: ResponseLinkKind.OpenTraces,
    traceIds,
    ...(hasWindow
      ? { startTime: start!.toISOString(), endTime: end!.toISOString() }
      : {}),
  };
}

/*
 * A detection's window, padded either side: its own window, else when it
 * was first and last seen. Null when it has neither.
 */
export function getDetectionWindow(
  detection: Pick<
    SecurityCaseMatchedDetectionJson,
    "windowStart" | "windowEnd" | "firstSeenAt" | "lastSeenAt"
  >,
  paddingInMinutes: number = RESPONSE_EVENTS_PADDING_IN_MINUTES,
): { start: Date; end: Date } | null {
  const first: string | null = detection.windowStart || detection.firstSeenAt;
  const last: string | null = detection.windowEnd || detection.lastSeenAt;

  if (!first || !last) {
    return null;
  }

  const padding: number = paddingInMinutes * 60 * 1000;
  const start: Date = new Date(new Date(first).getTime() - padding);
  const end: Date = new Date(new Date(last).getTime() + padding);

  return Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())
    ? null
    : { start, end };
}

// The security events on what a detection is about, over its window.
export function getDetectionEventsLink(
  detection: SecurityCaseMatchedDetectionJson,
): ResponseEventsLink | null {
  const value: string = detection.groupValue.trim();
  const range: { start: Date; end: Date } | null =
    getDetectionWindow(detection);

  if (!value || !range) {
    return null;
  }

  return {
    kind: ResponseLinkKind.OpenEvents,
    observable: value,
    startTime: range.start.toISOString(),
    endTime: range.end.toISOString(),
  };
}

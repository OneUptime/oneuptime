import { JSONObject } from "Common/Types/JSON";
import { SECURITY_LOG_SOURCE_ATTRIBUTE } from "Common/Types/SecurityEvent/SecurityLogFormat";
import { SecurityTelemetrySourceKind } from "Common/Types/SecurityEvent/SecurityTelemetrySource";

/*
 * The kind of record a security event was read from (#10909): a trace's
 * span, or a log line. The panel says a hashed user is "in your logs" or
 * "in your traces" by it, and searches that signal for the token. Kept
 * apart from the explorer links so the panel's fields read it without
 * loading the Dashboard's routes.
 */
export enum HashedUserSignal {
  Log = "log",
  Trace = "trace",
}

// Which kind of record an event was read from: a trace's, or a log line's.
export function getSecurityEventSignal(event: {
  attributes?: unknown;
}): HashedUserSignal {
  const attributes: JSONObject = (
    event.attributes && typeof event.attributes === "object"
      ? event.attributes
      : {}
  ) as JSONObject;

  return attributes[SECURITY_LOG_SOURCE_ATTRIBUTE] ===
    SecurityTelemetrySourceKind.Traces
    ? HashedUserSignal.Trace
    : HashedUserSignal.Log;
}

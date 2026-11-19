import { DataSecurityScrubSignal } from "./DataSecurityApiTypes";
import { DataStoreKind } from "./DataStoreKind";

/*
 * WHICH RULE OF INGEST REACHES A TELEMETRY FINDING'S PLACE.
 *
 * A finding in telemetry names a data type and a location: body,
 * attributes.user.email, events.login.token, message, a prompt's key, a
 * metric's attribute or name. Ingest hides data before it is stored with
 * rules of three kinds: log scrub rules (logs, and a RUM application's
 * logs), trace scrub rules (spans, exceptions - each a copy of its span's
 * exception event - and AI calls), and metric pipeline rules, which redact
 * a metric attribute's value by its key. This says which kind reaches a
 * location, and which part of the record the location is - or why none
 * does:
 *
 *  - a session's own details (sessions.*) are written by session replay
 *    ingest, which runs no rule;
 *  - a metric's name is set where the code creates the metric: a pipeline
 *    rule renames a metric whole, and cannot take the data out of a name.
 *
 * Here, beside the store kinds, so Scrub It's server
 * (Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage) and the
 * pages that offer it decide alike: a page asks for the permission of the
 * rule it would make, and says why a finding cannot be scrubbed instead
 * of offering a button that is refused.
 */

export type ScrubRuleSignal = DataSecurityScrubSignal;

// Where in a record a finding sits, as scrub rules name the parts.
export enum ScrubbedField {
  Body = "body",
  Attributes = "attributes",
  Events = "events",
  Name = "name",
}

// The rules that reach a finding, and the part of the record it sits in.
export interface ScrubTarget {
  signal: ScrubRuleSignal;
  field: ScrubbedField;
  /*
   * For a value under a key - an attribute, an event's attribute - the key a
   * sensitive-keys rule reads, or a metric pipeline rule redacts. For an
   * event's attribute, the last part of the location: the key is at least
   * that, so a match on it is a match on the whole key.
   */
  key?: string | undefined;
}

// Why no rule of ingest reaches a telemetry finding's place.
export enum TelemetryScrubUnavailableReason {
  // A session's own details (sessions.*): session replay ingest runs no rule.
  SessionDetails = "SessionDetails",
  // A metric's name: set by the code that creates the metric.
  MetricName = "MetricName",
  // A place no rule names, or a store that is not telemetry.
  NoRule = "NoRule",
}

export const ATTRIBUTES_PREFIX: string = "attributes.";
export const EVENTS_PREFIX: string = "events.";
export const RUM_LOGS_PREFIX: string = "logs.attributes.";
export const RUM_SPANS_PREFIX: string = "spans.attributes.";
export const RUM_SESSIONS_PREFIX: string = "sessions.";

// A metric's own name, as a finding names it.
export const METRIC_NAME_LOCATION: string = "name";

function keyAfter(location: string, prefix: string): string | null {
  const key: string = location.slice(prefix.length);

  return location.startsWith(prefix) && key.length > 0 ? key : null;
}

function eventTarget(location: string): ScrubTarget | null {
  const rest: string | null = keyAfter(location, EVENTS_PREFIX);

  if (rest === null) {
    return null;
  }

  const dot: number = rest.lastIndexOf(".");

  return {
    signal: "trace",
    field: ScrubbedField.Events,
    key: dot > 0 && dot < rest.length - 1 ? rest.slice(dot + 1) : undefined,
  };
}

function attributeTarget(
  location: string,
  prefix: string,
  signal: ScrubRuleSignal,
  field: ScrubbedField,
): ScrubTarget | null {
  const key: string | null = keyAfter(location, prefix);

  return key === null ? null : { signal, field, key };
}

/*
 * Which rules reach a location of a telemetry store, and which part of the
 * record it is - or null when no rule does (getScrubUnavailableReason says
 * why).
 */
export function getScrubTarget(
  kind: DataStoreKind | string | null | undefined,
  location: string,
): ScrubTarget | null {
  switch (kind) {
    case DataStoreKind.TelemetryLogs:
      if (location === "body") {
        return { signal: "log", field: ScrubbedField.Body };
      }

      return attributeTarget(
        location,
        ATTRIBUTES_PREFIX,
        "log",
        ScrubbedField.Attributes,
      );
    case DataStoreKind.TelemetryTraces:
      if (location === "name") {
        return { signal: "trace", field: ScrubbedField.Name };
      }

      return (
        attributeTarget(
          location,
          ATTRIBUTES_PREFIX,
          "trace",
          ScrubbedField.Attributes,
        ) || eventTarget(location)
      );
    case DataStoreKind.TelemetryExceptions:
      // An exception is its span's exception event: the events' rules scrub it.
      if (location === "message" || location === "stackTrace") {
        return { signal: "trace", field: ScrubbedField.Events };
      }

      return attributeTarget(
        location,
        ATTRIBUTES_PREFIX,
        "trace",
        ScrubbedField.Events,
      );
    case DataStoreKind.TelemetryAiConversations: {
      if (location.startsWith(EVENTS_PREFIX)) {
        return eventTarget(location);
      }

      const attribute: ScrubTarget | null = attributeTarget(
        location,
        ATTRIBUTES_PREFIX,
        "trace",
        ScrubbedField.Attributes,
      );

      if (attribute) {
        return attribute;
      }

      // A prompt or answer, named for the span attribute it is in.
      return location.length > 0
        ? { signal: "trace", field: ScrubbedField.Attributes, key: location }
        : null;
    }
    case DataStoreKind.TelemetrySessionReplays:
      return (
        attributeTarget(
          location,
          RUM_LOGS_PREFIX,
          "log",
          ScrubbedField.Attributes,
        ) ||
        attributeTarget(
          location,
          RUM_SPANS_PREFIX,
          "trace",
          ScrubbedField.Attributes,
        )
      );
    case DataStoreKind.TelemetryMetrics:
      // A data point's or its resource's attribute: redacted by its key.
      return attributeTarget(
        location,
        ATTRIBUTES_PREFIX,
        "metric",
        ScrubbedField.Attributes,
      );
    default:
      return null;
  }
}

/*
 * Why no rule reaches a finding's place, or null when one does: what a page
 * says instead of offering Scrub It.
 */
export function getScrubUnavailableReason(
  kind: DataStoreKind | string | null | undefined,
  location: string | null | undefined,
): TelemetryScrubUnavailableReason | null {
  const at: string = (location || "").trim();

  if (getScrubTarget(kind, at)) {
    return null;
  }

  if (
    kind === DataStoreKind.TelemetrySessionReplays &&
    at.startsWith(RUM_SESSIONS_PREFIX)
  ) {
    return TelemetryScrubUnavailableReason.SessionDetails;
  }

  if (kind === DataStoreKind.TelemetryMetrics && at === METRIC_NAME_LOCATION) {
    return TelemetryScrubUnavailableReason.MetricName;
  }

  return TelemetryScrubUnavailableReason.NoRule;
}

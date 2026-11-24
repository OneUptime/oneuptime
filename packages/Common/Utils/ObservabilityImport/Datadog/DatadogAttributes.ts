/*
 * WHERE ONEUPTIME KEEPS WHAT A DATADOG QUERY FILTERS ON (issues #7697,
 * #10324).
 *
 * OneUptime's Datadog intake (App/FeatureSet/Telemetry/Utils/Compatible/
 * DatadogIntake) keeps each tag `key:value` as the attribute key = value,
 * and every other field of a log as an attribute of its own name, a nested
 * one under its dotted path (`@http.status_code` is http.status_code). What
 * it reads as one of Datadog's reserved attributes is kept elsewhere:
 *
 *   - the host: the Agent sends a series' or a log's host beside its tags,
 *     not as one. It names the resource, kept as resource.host.name, which
 *     a host tag also sets. Read as `host`, a filter on it matched only the
 *     series someone had tagged host:..., never the Agent's own;
 *   - the service: a log's own service field names the resource and is no
 *     attribute, and a series' service tag names it too. Read from the
 *     resource's service.name (resource.service.name), a filter or a
 *     dashboard variable on the service finds a service's metrics and its
 *     logs alike, as the project's Services list names them;
 *   - a log's source (ddsource): datadog.source;
 *   - a log's status: its severity, which is no attribute;
 *   - a log's message: its body; its trace_id: its trace.
 *
 * The intake reads each under the names Datadog's log preprocessing reads
 * it from (status, severity, level...), so a search on any of them reads
 * what the intake made of it. The keys here are the stored attributes';
 * PromQL names one with toPromQLLabelName (resource_host_name).
 */

// The resource attribute a series' or a log's host is kept in.
export const DATADOG_HOST_ATTRIBUTE: string = "resource.host.name";

// The resource attribute a log's or a series' service is kept in.
export const DATADOG_SERVICE_ATTRIBUTE: string = "resource.service.name";

// The attribute a log's source (ddsource) is kept in.
export const DATADOG_LOG_SOURCE_ATTRIBUTE: string = "datadog.source";

// The attribute keyless tags are kept in, comma-joined.
export const DATADOG_KEYLESS_TAGS_ATTRIBUTE: string = "datadog.tags";

// The fields the intake reads a log's reserved attributes from.
const LOG_SEVERITY_FIELDS: ReadonlySet<string> = new Set<string>([
  "status",
  "severity",
  "level",
  "syslog.severity",
]);
const LOG_HOST_FIELDS: ReadonlySet<string> = new Set<string>([
  "host",
  "hostname",
  "syslog.hostname",
]);
const LOG_SERVICE_FIELDS: ReadonlySet<string> = new Set<string>([
  "service",
  "syslog.appname",
  "dd.service",
]);
const LOG_SOURCE_FIELDS: ReadonlySet<string> = new Set<string>([
  "source",
  "ddsource",
]);
const LOG_MESSAGE_FIELDS: ReadonlySet<string> = new Set<string>([
  "message",
  "msg",
]);
const LOG_TRACE_FIELDS: ReadonlySet<string> = new Set<string>([
  "trace_id",
  "dd.trace_id",
  "span_id",
  "dd.span_id",
]);

/*
 * A metric's tag key as the attribute OneUptime keeps it in. A template
 * variable's prefix may name a log facet (@auth.client_token), kept under
 * its path.
 */
export const toDatadogMetricAttributeKey: (tagKey: string) => string = (
  tagKey: string,
): string => {
  const key: string = tagKey.startsWith("@") ? tagKey.slice(1) : tagKey;

  if (key === "host") {
    return DATADOG_HOST_ATTRIBUTE;
  }

  if (key === "service") {
    return DATADOG_SERVICE_ATTRIBUTE;
  }

  return key;
};

// What a log search names, as OneUptime keeps it.
export enum DatadogLogField {
  // An attribute, by the key attributeKey names.
  Attribute = "Attribute",
  // The log's severity: Datadog's status.
  Severity = "Severity",
  // The log's body: Datadog's message.
  Message = "Message",
  // The log's trace or span, which no attribute keeps.
  Trace = "Trace",
}

export interface DatadogLogFieldTarget {
  field: DatadogLogField;
  attributeKey?: string | undefined;
}

/*
 * A key a log search names - a reserved attribute, a tag, or an `@`
 * attribute - as what OneUptime keeps it in.
 */
export const readDatadogLogField: (key: string) => DatadogLogFieldTarget = (
  key: string,
): DatadogLogFieldTarget => {
  if (LOG_SEVERITY_FIELDS.has(key)) {
    return { field: DatadogLogField.Severity };
  }

  if (LOG_MESSAGE_FIELDS.has(key)) {
    return { field: DatadogLogField.Message };
  }

  if (LOG_TRACE_FIELDS.has(key)) {
    return { field: DatadogLogField.Trace };
  }

  if (LOG_HOST_FIELDS.has(key)) {
    return {
      field: DatadogLogField.Attribute,
      attributeKey: DATADOG_HOST_ATTRIBUTE,
    };
  }

  if (LOG_SERVICE_FIELDS.has(key)) {
    return {
      field: DatadogLogField.Attribute,
      attributeKey: DATADOG_SERVICE_ATTRIBUTE,
    };
  }

  if (LOG_SOURCE_FIELDS.has(key)) {
    return {
      field: DatadogLogField.Attribute,
      attributeKey: DATADOG_LOG_SOURCE_ATTRIBUTE,
    };
  }

  return { field: DatadogLogField.Attribute, attributeKey: key };
};

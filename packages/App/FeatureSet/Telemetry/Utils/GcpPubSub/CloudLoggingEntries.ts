import { CLOUD_CONNECTION_ID_ATTRIBUTE } from "Common/Server/Utils/CloudConnection/CloudMetricPayload";
import { CLOUD_RESOURCE_ID_ATTRIBUTE } from "Common/Types/Cloud/CloudLogGroups";
import {
  CloudMonitoredResource,
  getRegionFromGcpLocation,
  resolveCloudMonitoredResource,
} from "Common/Types/Cloud/CloudMonitoredResource";
import {
  CloudProvider,
  FaasCloudPlatform,
} from "Common/Types/Cloud/CloudPlatform";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";

/*
 * A CLOUD LOGGING ENTRY, AS PUB/SUB PUSHES IT, AS ONE OTLP LOG RECORD.
 *
 * A log sink whose destination is a Pub/Sub topic publishes each entry as
 * one message, its data the entry's JSON (Cloud Logging's LogEntry,
 * "Route log entries to Pub/Sub"):
 *
 *   { "logName": "projects/acme/logs/run.googleapis.com%2Frequests",
 *     "resource": { "type": "cloud_run_revision",
 *                   "labels": { "project_id": "acme", "service_name": "checkout",
 *                               "revision_name": "...", "location": "us-central1", ... } },
 *     "timestamp": "2026-11-06T10:00:00.123456789Z",
 *     "receiveTimestamp": "...", "severity": "ERROR", "insertId": "...",
 *     "textPayload": "..." | "jsonPayload": {...} | "protoPayload": {...},
 *     "httpRequest": {...}, "labels": {...}, "trace": "projects/acme/traces/<32 hex>",
 *     "spanId": "<16 hex>", "operation": {...}, "sourceLocation": {...} }
 *
 * Each entry becomes one OTLP resource and record. The resource is the
 * connection's telemetry service and id, the project (cloud.account.id),
 * the region its location says (cloud.region), and the monitored resource
 * as the googlecloudmonitoring receiver writes it on a metric - its type
 * (gcp.resource_type) and its labels - so when the catalog knows the type
 * (CloudMonitoredResource), the resource its metrics land on is found from
 * the very same labels and named on the log as cloud.resource_id: a VM's,
 * a Cloud SQL instance's, a bucket's logs and metrics are one resource, and
 * its page's Logs tab reads them. A Cloud Functions function's logs also
 * carry cloud.platform and faas.name, so they are the function's in
 * Serverless; Cloud Run's and App Engine's carry no platform, as an app
 * named after the connection would be made up from them.
 *
 * The record keeps the entry's time to the nanosecond, its severity in
 * OpenTelemetry's numbers, its message as the body - the text, a JSON
 * payload's message (its other fields as attributes) or the payload whole,
 * an audit log's method and resource - its trace and span, and its HTTP
 * request in the semantic conventions' names.
 *
 * No regular expression reads an entry; every value it keeps is bounded.
 */

export const PUBSUB_SCOPE_NAME: string = "oneuptime-gcp-pubsub";

/*
 * Monitored resource types Cloud Logging writes logs under that Cloud
 * Monitoring calls otherwise: an HTTP(S) load balancer's request logs are
 * http_load_balancer's, its metrics https_lb_rule's - the same URL map, so
 * the same resource.
 */
export const LOG_RESOURCE_TYPE_ALIASES: Readonly<Record<string, string>> = {
  http_load_balancer: "https_lb_rule",
};

export const GCP_LOG_NAME_ATTRIBUTE: string = "gcp.log.name";
export const GCP_LOG_ID_ATTRIBUTE: string = "gcp.log.id";
export const GCP_INSERT_ID_ATTRIBUTE: string = "gcp.log.insert_id";
export const GCP_RESOURCE_TYPE_ATTRIBUTE: string = "gcp.resource_type";
export const GCP_JSON_PAYLOAD_PREFIX: string = "gcp.json_payload.";
export const GCP_LABEL_PREFIX: string = "gcp.label.";

// Bounds on what one entry keeps.
const MAX_VALUE_LENGTH: number = 1024;
const MAX_BODY_LENGTH: number = 64 * 1024;
const MAX_FIELDS: number = 50;

export interface OtlpAttribute {
  key: string;
  value: JSONObject;
}

export interface CloudLoggingEntry {
  logName: string;
  // The log's id, decoded: run.googleapis.com/requests.
  logId: string;
  resourceType: string;
  resourceLabels: Record<string, string>;
  timeUnixNano: string;
  observedTimeUnixNano: string;
  severity: string;
  insertId: string;
  textPayload: string | null;
  jsonPayload: JSONObject | null;
  protoPayload: JSONObject | null;
  httpRequest: JSONObject | null;
  labels: Record<string, string>;
  trace: string;
  spanId: string;
  operation: JSONObject | null;
  sourceLocation: JSONObject | null;
}

function readObject(value: unknown): JSONObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : null;
}

function readText(
  value: unknown,
  maxLength: number = MAX_VALUE_LENGTH,
): string {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

// A flat object's string-like values, bounded: labels of a resource or an entry.
function readLabels(value: unknown): Record<string, string> {
  const object: JSONObject | null = readObject(value);
  const labels: Record<string, string> = {};

  if (!object) {
    return labels;
  }

  for (const key of Object.keys(object).slice(0, MAX_FIELDS)) {
    const item: unknown = object[key];

    if (
      key.length === 0 ||
      key.length > 256 ||
      key === "__proto__" ||
      key === "constructor"
    ) {
      continue;
    }

    if (typeof item === "string") {
      labels[key] = item.slice(0, MAX_VALUE_LENGTH);
    } else if (typeof item === "number" || typeof item === "boolean") {
      labels[key] = String(item);
    }
  }

  return labels;
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

/*
 * An RFC 3339 time as OTLP's nanoseconds since the epoch, exactly - its
 * fraction kept to the nanosecond - or null for anything that is not one.
 */
export function rfc3339ToUnixNano(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) {
    return null;
  }

  const dot: number = value.indexOf(".");
  let fraction: string = "";
  let whole: string = value;

  if (dot > 0) {
    let end: number = dot + 1;

    while (isDigit(value[end])) {
      end++;
    }

    fraction = value.slice(dot + 1, end);
    whole = `${value.slice(0, dot)}${value.slice(end)}`;
  }

  const milliseconds: number = Date.parse(whole);

  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return null;
  }

  const seconds: number = Math.floor(milliseconds / 1000);
  const nanos: string = `${fraction}000000000`.slice(0, 9);

  return seconds === 0 ? String(Number(nanos)) : `${seconds}${nanos}`;
}

/*
 * The log's id from its name: projects/<p>/logs/<id>, the id URL-encoded
 * (run.googleapis.com%2Frequests) - or, for an organization's, a folder's or
 * a billing account's log, the same after their own prefix.
 */
export function readLogId(logName: string): string {
  const marker: string = "/logs/";
  const at: number = logName.indexOf(marker);

  if (at < 0) {
    return "";
  }

  const encoded: string = logName.slice(at + marker.length);

  try {
    return decodeURIComponent(encoded).slice(0, MAX_VALUE_LENGTH);
  } catch {
    return encoded.slice(0, MAX_VALUE_LENGTH);
  }
}

// The project of a log's name: projects/<p>/logs/... -> <p>; "" for any other.
export function readLogProject(logName: string): string {
  const prefix: string = "projects/";

  if (!logName.startsWith(prefix)) {
    return "";
  }

  const end: number = logName.indexOf("/", prefix.length);

  return end > prefix.length ? logName.slice(prefix.length, end) : "";
}

/*
 * A message's data read as a log entry - or null when it is not one: an
 * entry has a log name, and a resource or a payload.
 */
export function readCloudLoggingEntry(
  value: unknown,
): CloudLoggingEntry | null {
  const entry: JSONObject | null = readObject(value);

  if (!entry) {
    return null;
  }

  const logName: string = readText(entry["logName"]);
  const resource: JSONObject | null = readObject(entry["resource"]);
  const textPayload: string | null =
    typeof entry["textPayload"] === "string"
      ? (entry["textPayload"] as string).slice(0, MAX_BODY_LENGTH)
      : null;
  const jsonPayload: JSONObject | null = readObject(entry["jsonPayload"]);
  const protoPayload: JSONObject | null = readObject(entry["protoPayload"]);

  if (
    !logName ||
    (!resource && textPayload === null && !jsonPayload && !protoPayload)
  ) {
    return null;
  }

  const timeUnixNano: string | null = rfc3339ToUnixNano(entry["timestamp"]);
  const observedTimeUnixNano: string | null = rfc3339ToUnixNano(
    entry["receiveTimestamp"],
  );

  return {
    logName,
    logId: readLogId(logName),
    resourceType: readText(resource?.["type"], 256),
    resourceLabels: readLabels(resource?.["labels"]),
    timeUnixNano: timeUnixNano || observedTimeUnixNano || "",
    observedTimeUnixNano: observedTimeUnixNano || timeUnixNano || "",
    severity: readText(entry["severity"], 32).toUpperCase(),
    insertId: readText(entry["insertId"], 256),
    textPayload,
    jsonPayload,
    protoPayload,
    httpRequest: readObject(entry["httpRequest"]),
    labels: readLabels(entry["labels"]),
    trace: readText(entry["trace"], 256),
    spanId: readText(entry["spanId"], 64),
    operation: readObject(entry["operation"]),
    sourceLocation: readObject(entry["sourceLocation"]),
  };
}

/*
 * Cloud Logging's severities in OpenTelemetry's numbers and OneUptime's
 * words, as the OpenTelemetry Collector's Google Cloud exporter maps them
 * the other way: NOTICE is INFO2, CRITICAL ERROR2, ALERT FATAL, EMERGENCY
 * FATAL2. DEFAULT says nothing.
 */
export const CLOUD_LOGGING_SEVERITIES: ReadonlyMap<
  string,
  { number: number; text: string }
> = new Map<string, { number: number; text: string }>([
  ["DEBUG", { number: 5, text: "DEBUG" }],
  ["INFO", { number: 9, text: "INFO" }],
  ["NOTICE", { number: 10, text: "INFO" }],
  ["WARNING", { number: 13, text: "WARN" }],
  ["ERROR", { number: 17, text: "ERROR" }],
  ["CRITICAL", { number: 18, text: "ERROR" }],
  ["ALERT", { number: 21, text: "FATAL" }],
  ["EMERGENCY", { number: 22, text: "FATAL" }],
]);

function stringAttribute(key: string, value: string): OtlpAttribute {
  return { key, value: { stringValue: value } };
}

function scalarAttribute(key: string, value: unknown): OtlpAttribute | null {
  if (typeof value === "string" && value.length > 0) {
    return stringAttribute(key, value.slice(0, MAX_VALUE_LENGTH));
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value)
      ? { key, value: { intValue: String(value) } }
      : { key, value: { doubleValue: value } };
  }

  if (typeof value === "boolean") {
    return { key, value: { boolValue: value } };
  }

  return null;
}

function isHex(value: string, length: number): boolean {
  if (value.length !== length) {
    return false;
  }

  for (const character of value) {
    const isAllowed: boolean =
      (character >= "0" && character <= "9") ||
      (character >= "a" && character <= "f") ||
      (character >= "A" && character <= "F");

    if (!isAllowed) {
      return false;
    }
  }

  return true;
}

// The trace's id from "projects/<p>/traces/<32 hex>", or "".
export function readTraceId(trace: string): string {
  const marker: string = "/traces/";
  const at: number = trace.lastIndexOf(marker);
  const id: string = at >= 0 ? trace.slice(at + marker.length) : trace;

  return isHex(id, 32) ? id.toLowerCase() : "";
}

/*
 * The message a JSON payload states, and whether it stated one: the
 * message or msg loggers write, else the payload itself.
 */
function readJsonBody(payload: JSONObject): { body: string; key: string } {
  for (const key of ["message", "msg"]) {
    const value: JSONValue | undefined = payload[key];

    if (typeof value === "string") {
      return { body: value.slice(0, MAX_BODY_LENGTH), key };
    }
  }

  let text: string = "";

  try {
    text = JSON.stringify(payload);
  } catch {
    text = "";
  }

  return { body: text.slice(0, MAX_BODY_LENGTH), key: "" };
}

// An audit log entry's one line: its method, on what, by whom, and how it went.
function readAuditBody(payload: JSONObject): string {
  const method: string = readText(payload["methodName"]);
  const resource: string = readText(payload["resourceName"]);
  const status: JSONObject | null = readObject(payload["status"]);
  const statusMessage: string = readText(status?.["message"]);

  return [method || readText(payload["serviceName"]), resource]
    .filter(Boolean)
    .join(" ")
    .concat(statusMessage ? `: ${statusMessage}` : "")
    .slice(0, MAX_BODY_LENGTH);
}

function readSeconds(latency: unknown): number | null {
  if (typeof latency !== "string" || !latency.endsWith("s")) {
    return null;
  }

  const seconds: number = Number(latency.slice(0, -1));

  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export interface CloudLoggingFacts {
  projectId: string;
  region: string;
  logId: string;
  // The resource the entry is filed under, when the catalog knows its type.
  resource: CloudMonitoredResource | null;
}

/*
 * One entry as an OTLP resource with one record, and where it came from.
 */
export function buildCloudLoggingResourceLogs(data: {
  entry: CloudLoggingEntry;
  serviceName: string;
  connectionId: string;
  observedAtMs: number;
}): { resourceLogs: JSONObject; facts: CloudLoggingFacts } {
  const entry: CloudLoggingEntry = data.entry;
  const labels: Record<string, string> = entry.resourceLabels;
  const projectId: string =
    labels["project_id"] || readLogProject(entry.logName);
  const location: string =
    labels["location"] || labels["zone"] || labels["region"] || "";
  const region: string = location ? getRegionFromGcpLocation(location) : "";

  // The monitored resource, as the receiver stores a metric's: its type and labels.
  const stored: Record<string, string> = {};

  if (entry.resourceType) {
    stored[`resource.${GCP_RESOURCE_TYPE_ATTRIBUTE}`] =
      LOG_RESOURCE_TYPE_ALIASES[entry.resourceType] || entry.resourceType;
  }

  for (const key of Object.keys(labels)) {
    stored[`resource.${key}`] = labels[key]!;
  }

  if (projectId && !labels["project_id"]) {
    stored["resource.project_id"] = projectId;
  }

  const resource: CloudMonitoredResource | null = entry.resourceType
    ? resolveCloudMonitoredResource({
        metricName: `logging.googleapis.com/${entry.resourceType}`,
        attributes: stored,
      })
    : null;
  const filed: CloudMonitoredResource | null =
    resource && resource.provider === CloudProvider.GCP ? resource : null;

  const resourceAttributes: Array<OtlpAttribute> = [
    stringAttribute("service.name", data.serviceName),
    stringAttribute("cloud.provider", CloudProvider.GCP),
    stringAttribute(CLOUD_CONNECTION_ID_ATTRIBUTE, data.connectionId),
    ...(projectId ? [stringAttribute("cloud.account.id", projectId)] : []),
    ...(region ? [stringAttribute("cloud.region", region)] : []),
    ...(entry.resourceType
      ? [stringAttribute(GCP_RESOURCE_TYPE_ATTRIBUTE, entry.resourceType)]
      : []),
    ...Object.keys(labels)
      .filter((key: string): boolean => {
        // The keys the resource already carries in its own words.
        return ![
          "service.name",
          "cloud.provider",
          "cloud.account.id",
          "cloud.region",
        ].includes(key);
      })
      .map((key: string): OtlpAttribute => {
        return stringAttribute(key, labels[key]!);
      }),
    ...(filed
      ? [stringAttribute(CLOUD_RESOURCE_ID_ATTRIBUTE, filed.providerResourceId)]
      : []),
    ...(entry.resourceType === "cloud_function" && labels["function_name"]
      ? [
          stringAttribute(
            "cloud.platform",
            FaasCloudPlatform.GcpCloudFunctions,
          ),
          stringAttribute("faas.name", labels["function_name"]),
        ]
      : []),
  ];

  const attributes: Array<OtlpAttribute> = [
    stringAttribute(GCP_LOG_NAME_ATTRIBUTE, entry.logName),
    ...(entry.logId
      ? [stringAttribute(GCP_LOG_ID_ATTRIBUTE, entry.logId)]
      : []),
    ...(entry.insertId
      ? [stringAttribute(GCP_INSERT_ID_ATTRIBUTE, entry.insertId)]
      : []),
  ];

  const add: (key: string, value: unknown) => void = (
    key: string,
    value: unknown,
  ): void => {
    const attribute: OtlpAttribute | null = scalarAttribute(key, value);

    if (attribute && attributes.length < MAX_FIELDS * 2) {
      attributes.push(attribute);
    }
  };

  for (const key of Object.keys(entry.labels)) {
    add(`${GCP_LABEL_PREFIX}${key}`, entry.labels[key]);
  }

  let body: string = "";

  if (entry.textPayload !== null) {
    body = entry.textPayload;
  } else if (entry.jsonPayload) {
    const read: { body: string; key: string } = readJsonBody(entry.jsonPayload);
    body = read.body;

    // A stated message's other fields, beside it.
    if (read.key) {
      for (const key of Object.keys(entry.jsonPayload).slice(0, MAX_FIELDS)) {
        if (key !== read.key && key !== "__proto__") {
          add(`${GCP_JSON_PAYLOAD_PREFIX}${key}`, entry.jsonPayload[key]);
        }
      }
    }
  } else if (entry.protoPayload) {
    body = readAuditBody(entry.protoPayload);

    const authentication: JSONObject | null = readObject(
      entry.protoPayload["authenticationInfo"],
    );
    const request: JSONObject | null = readObject(
      entry.protoPayload["requestMetadata"],
    );

    add("gcp.audit.service_name", entry.protoPayload["serviceName"]);
    add("gcp.audit.method_name", entry.protoPayload["methodName"]);
    add("gcp.audit.resource_name", entry.protoPayload["resourceName"]);
    add("enduser.id", authentication?.["principalEmail"]);
    add("client.address", request?.["callerIp"]);
    add(
      "gcp.audit.status_code",
      readObject(entry.protoPayload["status"])?.["code"],
    );
  }

  if (entry.httpRequest) {
    const http: JSONObject = entry.httpRequest;
    const latency: number | null = readSeconds(http["latency"]);

    add("http.request.method", http["requestMethod"]);
    add("url.full", http["requestUrl"]);
    add("http.response.status_code", http["status"]);
    add("user_agent.original", http["userAgent"]);
    add("client.address", http["remoteIp"]);
    add("network.protocol.name", http["protocol"]);
    add(
      "http.response.body.size",
      typeof http["responseSize"] === "string"
        ? Number(http["responseSize"])
        : http["responseSize"],
    );

    if (latency !== null) {
      add("http.server.request.duration", latency);
    }
  }

  if (entry.operation) {
    add("gcp.operation.id", entry.operation["id"]);
    add("gcp.operation.producer", entry.operation["producer"]);
  }

  if (entry.sourceLocation) {
    add("code.filepath", entry.sourceLocation["file"]);
    add(
      "code.lineno",
      typeof entry.sourceLocation["line"] === "string"
        ? Number(entry.sourceLocation["line"])
        : entry.sourceLocation["line"],
    );
    add("code.function", entry.sourceLocation["function"]);
  }

  const severity: { number: number; text: string } | undefined =
    CLOUD_LOGGING_SEVERITIES.get(entry.severity);
  const traceId: string = readTraceId(entry.trace);
  const spanId: string = isHex(entry.spanId, 16)
    ? entry.spanId.toLowerCase()
    : "";
  const observed: string =
    entry.observedTimeUnixNano || `${Math.trunc(data.observedAtMs)}000000`;

  const record: JSONObject = {
    timeUnixNano: entry.timeUnixNano || observed,
    observedTimeUnixNano: observed,
    severityNumber: severity ? severity.number : 0,
    severityText: severity ? severity.text : "",
    body: { stringValue: body },
    attributes: attributes as unknown as JSONArray,
    ...(traceId ? { traceId } : {}),
    ...(traceId && spanId ? { spanId } : {}),
  };

  return {
    resourceLogs: {
      resource: { attributes: resourceAttributes as unknown as JSONArray },
      scopeLogs: [
        {
          scope: { name: PUBSUB_SCOPE_NAME },
          logRecords: [record],
        },
      ] as unknown as JSONArray,
    },
    facts: {
      projectId,
      region,
      logId: entry.logId,
      resource: filed,
    },
  };
}

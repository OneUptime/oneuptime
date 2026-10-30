import { JSONObject, JSONValue } from "../../../Types/JSON";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import SecurityLogFormat from "../../../Types/SecurityEvent/SecurityLogFormat";
import { flattenPayload, parseEventTime, readValue } from "../NormalizerHelpers";
import { SecurityRecordReading } from "../SecurityRecordReading";
import {
  MAX_JSON_LINE_LENGTH,
  SecurityLogLine,
  boundAttributes,
  buildLogSecurityEvent,
  readAttribute,
  readRemoteIpAddress,
} from "./SecurityLogLine";

/*
 * Google Cloud's audit logs, as a log line: a LogEntry whose protoPayload
 * is an AuditLog - what a log sink exports to Pub/Sub, a bucket or BigQuery,
 * and an OpenTelemetry Collector or a shipper forwards from there - or the
 * AuditLog payload alone, as some collectors keep it.
 * https://cloud.google.com/logging/docs/audit
 *
 * Google writes four audit logs, and which one an entry is in decides
 * whether it is an event:
 *
 *   - Admin Activity: every call that changed a resource or who may reach
 *     it. Always an event.
 *   - Policy Denied: what a VPC Service Controls perimeter or an
 *     organization policy refused. Always an event.
 *   - Data Access: every read of every resource, the bulk of the volume.
 *     Only a call Google refused (PERMISSION_DENIED, UNAUTHENTICATED) is an
 *     event - and Google Workspace's sign-ins, which Workspace shares with
 *     Google Cloud in this log.
 *   - System Event: what Google did on its own (a VM moved, an autoscaler
 *     step). Only a refusal is an event.
 *
 * The event keeps the entry's fields under their own names
 * (protoPayload.methodName, protoPayload.authenticationInfo.principalEmail),
 * so a rule reads them as Google's documentation names them.
 */

const AUTHENTICATION: number = 3002;
const API_ACTIVITY: number = 6003;

export const GOOGLE_CLOUD_AUDIT_PRODUCT_NAME: string =
  "Google Cloud Audit Logs";

// How an AuditLog payload names its type.
export const AUDIT_LOG_TYPE_MARKER: string = "google.cloud.audit.auditlog";

export enum GoogleCloudAuditLog {
  Activity = "activity",
  DataAccess = "data_access",
  SystemEvent = "system_event",
  Policy = "policy",
  // A payload with no logName beside it.
  Unknown = "unknown",
}

/*
 * The text that lets a line naming the Data Access or System Event log be
 * read, as it is in the line: a refusal's status code, an authorization
 * not granted, Workspace's sign-in service - and a change to where audit
 * logs go, whose request names those logs too (a sink re-routed, a log
 * deleted). Lowercase.
 */
export const GOOGLE_AUDIT_REFUSAL_MARKERS: ReadonlyArray<string> = [
  '"code":7,',
  '"code":7}',
  '"code": 7,',
  '"code": 7}',
  '"code":16,',
  '"code":16}',
  '"code": 16,',
  '"code": 16}',
  '"granted":false',
  '"granted": false',
  "loginservice",
  "google.logging.v2.configservicev2",
  "google.logging.v2.loggingservicev2.deletelog",
];

/*
 * The logs whose entries are events only with one of the markers above,
 * as a line names them. A line that names one of them anywhere is read
 * only with such a marker - exactly as the database's prefilter reads it.
 */
export const GOOGLE_AUDIT_FILTERED_LOG_MARKERS: ReadonlyArray<string> = [
  "cloudaudit.googleapis.com%2fdata_access",
  "cloudaudit.googleapis.com/data_access",
  "cloudaudit.googleapis.com%2fsystem_event",
  "cloudaudit.googleapis.com/system_event",
];

// Method names that only read, for a payload whose log is not named.
const READ_METHOD_PREFIXES: ReadonlyArray<string> = [
  "get",
  "list",
  "search",
  "lookup",
  "read",
  "check",
  "test",
  "query",
  "batchget",
  "watch",
  "describe",
];

const PERMISSION_DENIED: number = 7;
const UNAUTHENTICATED: number = 16;

function text(value: JSONValue | undefined): string {
  if (value === null || value === undefined || typeof value === "object") {
    return "";
  }

  return String(value).trim();
}

function asObject(value: unknown): JSONObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : null;
}

// Which of the four logs a logName names (".../logs/cloudaudit.googleapis.com%2Factivity").
export function readGoogleAuditLog(logName: string): GoogleCloudAuditLog {
  const name: string = logName.toLowerCase().split("%2f").join("/");
  const marker: string = "cloudaudit.googleapis.com/";
  const at: number = name.indexOf(marker);

  if (at === -1) {
    return GoogleCloudAuditLog.Unknown;
  }

  const kind: string = name.slice(at + marker.length);

  for (const log of [
    GoogleCloudAuditLog.Activity,
    GoogleCloudAuditLog.DataAccess,
    GoogleCloudAuditLog.SystemEvent,
    GoogleCloudAuditLog.Policy,
  ]) {
    if (kind === log) {
      return log;
    }
  }

  return GoogleCloudAuditLog.Unknown;
}

// "projects/acme-prod/logs/..." -> "acme-prod"; "" for anything else.
function projectOfLogName(logName: string): string {
  const marker: string = "projects/";

  if (!logName.startsWith(marker)) {
    return "";
  }

  const end: number = logName.indexOf("/", marker.length);

  return logName.slice(marker.length, end === -1 ? undefined : end);
}

// The last segment of a method name: "google.iam.admin.v1.CreateServiceAccountKey" -> "CreateServiceAccountKey".
export function shortMethodName(methodName: string): string {
  const dot: number = methodName.lastIndexOf(".");

  return dot === -1 ? methodName : methodName.slice(dot + 1);
}

function isReadMethod(methodName: string): boolean {
  const short: string = shortMethodName(methodName).toLowerCase();

  return READ_METHOD_PREFIXES.some((prefix: string): boolean => {
    return short.startsWith(prefix);
  });
}

interface AuditEntry {
  entry: JSONObject;
  payload: JSONObject;
  logName: string;
}

// The entry a line holds, or null.
function readAuditEntry(line: SecurityLogLine): AuditEntry | null {
  const body: string = (line.body || "").trim();

  if (
    !body.startsWith("{") ||
    body.length > MAX_JSON_LINE_LENGTH ||
    body.toLowerCase().indexOf(AUDIT_LOG_TYPE_MARKER) === -1
  ) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  const document: JSONObject | null = asObject(parsed);

  if (!document) {
    return null;
  }

  const protoPayload: JSONObject | null = asObject(document["protoPayload"]);
  const payload: JSONObject = protoPayload || document;

  if (!text(payload["@type"]).toLowerCase().endsWith(AUDIT_LOG_TYPE_MARKER)) {
    return null;
  }

  return {
    entry: protoPayload ? document : { protoPayload: document },
    payload,
    logName:
      text(document["logName"]) ||
      readAttribute(line.attributes, ["gcp.log_name", "logName", "log.name"]),
  };
}

function statusCode(payload: JSONObject): number {
  const value: JSONValue = readValue(payload, "status.code");
  const code: number = typeof value === "number" ? value : Number(value);

  return Number.isFinite(code) ? Math.trunc(code) : 0;
}

function isRefusal(payload: JSONObject): boolean {
  const code: number = statusCode(payload);

  if (code === PERMISSION_DENIED || code === UNAUTHENTICATED) {
    return true;
  }

  const authorizations: JSONValue | undefined = payload["authorizationInfo"];

  return (
    Array.isArray(authorizations) &&
    authorizations.some((item: JSONValue): boolean => {
      return asObject(item)?.["granted"] === false;
    })
  );
}

function isLoginService(payload: JSONObject): boolean {
  return (
    text(payload["serviceName"]).toLowerCase() === "login.googleapis.com" ||
    text(payload["methodName"]).toLowerCase().indexOf("loginservice") !== -1
  );
}

/*
 * One audit entry as a reading, or null for one that is not an event. The
 * line's own text is passed so an entry kept for a refusal is one whose
 * line shows it - what the database's prefilter reads.
 */
export function readGoogleCloudAuditEntry(
  audit: AuditEntry,
  lowerLine: string,
): SecurityRecordReading | null {
  const payload: JSONObject = audit.payload;
  const methodName: string = text(payload["methodName"]);
  const serviceName: string = text(payload["serviceName"]);

  if (!methodName || methodName.startsWith("google.longrunning")) {
    return null;
  }

  const log: GoogleCloudAuditLog = readGoogleAuditLog(audit.logName);
  const refused: boolean = isRefusal(payload);
  const login: boolean = isLoginService(payload);
  const namesFilteredLog: boolean = GOOGLE_AUDIT_FILTERED_LOG_MARKERS.some(
    (marker: string): boolean => {
      return lowerLine.indexOf(marker) !== -1;
    },
  );
  const showsException: boolean = GOOGLE_AUDIT_REFUSAL_MARKERS.some(
    (marker: string): boolean => {
      return lowerLine.indexOf(marker) !== -1;
    },
  );

  // As the database's prefilter reads the line, first.
  if (namesFilteredLog && !showsException) {
    return null;
  }

  if (
    (log === GoogleCloudAuditLog.DataAccess ||
      log === GoogleCloudAuditLog.SystemEvent) &&
    !refused &&
    !login
  ) {
    return null;
  }

  if (
    log === GoogleCloudAuditLog.Unknown &&
    isReadMethod(methodName) &&
    !refused &&
    !login
  ) {
    return null;
  }

  const principal: string =
    text(readValue(payload, "authenticationInfo.principalEmail")) ||
    text(readValue(payload, "authenticationInfo.principalSubject"));
  const callerIp: string = text(readValue(payload, "requestMetadata.callerIp"));
  const resourceName: string = text(payload["resourceName"]);
  const project: string =
    text(readValue(audit.entry, "resource.labels.project_id")) ||
    projectOfLogName(audit.logName);
  const code: number = statusCode(payload);
  const failed: boolean = code !== 0 || refused;
  const statusMessage: string = text(readValue(payload, "status.message"));
  const insertId: string = text(audit.entry["insertId"]);
  const time: Date | null = parseEventTime(
    audit.entry["timestamp"] ?? audit.entry["receiveTimestamp"] ?? null,
  );
  const shortMethod: string = shortMethodName(methodName);
  const attributes: JSONObject = boundAttributes(flattenPayload(audit.entry));

  if (login) {
    const lower: string = shortMethod.toLowerCase();

    // A sign-out is not a sign-in; Workspace logs them beside each other.
    if (lower === "logout") {
      return null;
    }

    const loginFailed: boolean = lower.indexOf("failure") !== -1 || failed;

    return {
      time,
      eventUid: insertId ? `gcp-audit:${insertId}` : "",
      classUid: AUTHENTICATION,
      activityName: "Logon",
      statusName: loginFailed ? "Failure" : "Success",
      severity: loginFailed ? OcsfSeverity.Low : OcsfSeverity.Informational,
      message: `${loginFailed ? "Failed Google sign-in" : "Google sign-in"}${principal ? ` for ${principal}` : ""}${readRemoteIpAddress(callerIp) ? ` from ${readRemoteIpAddress(callerIp)}` : ""}`,
      principalUser: principal,
      principalIp: readRemoteIpAddress(callerIp),
      targetResource: serviceName,
      attributes,
    };
  }

  return {
    time,
    eventUid: insertId ? `gcp-audit:${insertId}` : "",
    classUid: API_ACTIVITY,
    activityName: shortMethod,
    statusName: failed ? "Failure" : "Success",
    severity:
      failed || log === GoogleCloudAuditLog.Policy
        ? OcsfSeverity.Low
        : OcsfSeverity.Informational,
    message: `${principal || "Someone"} called ${shortMethod} on ${serviceName || "Google Cloud"}${resourceName ? ` (${resourceName})` : ""}${failed ? `: ${statusMessage || "refused"}` : ""}`,
    principalUser: principal,
    // A call from inside Google names a network ("private"), not an address.
    principalIp: readRemoteIpAddress(callerIp),
    targetHost: project,
    targetResource: resourceName || `${serviceName} ${shortMethod}`.trim(),
    attributes,
  };
}

export default class GoogleCloudAuditLogParser {
  public static parse(line: SecurityLogLine): Array<NormalizedSecurityEvent> {
    const audit: AuditEntry | null = readAuditEntry(line);

    if (!audit) {
      return [];
    }

    const reading: SecurityRecordReading | null = readGoogleCloudAuditEntry(
      audit,
      (line.body || "").toLowerCase(),
    );

    if (!reading) {
      return [];
    }

    return [
      buildLogSecurityEvent({
        line,
        format: SecurityLogFormat.GoogleCloudAudit,
        classUid: reading.classUid,
        activityName: reading.activityName,
        statusName: reading.statusName,
        severity: reading.severity,
        message: reading.message,
        time: reading.time || undefined,
        eventUid: reading.eventUid || undefined,
        principalUser: reading.principalUser,
        principalIp: reading.principalIp,
        targetHost: reading.targetHost,
        targetResource: reading.targetResource,
        attributes: reading.attributes,
      }),
    ];
  }
}

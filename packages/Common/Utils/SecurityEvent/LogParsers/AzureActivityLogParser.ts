import { JSONObject, JSONValue } from "../../../Types/JSON";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import SecurityLogFormat from "../../../Types/SecurityEvent/SecurityLogFormat";
import {
  ENTRA_ID_PRODUCT_NAME,
  ENTRA_ID_VENDOR_NAME,
  EntraLog,
  readEntraDirectoryAudit,
  readEntraRisk,
  readEntraSignIn,
  readSignInErrorCode,
} from "../Connectors/EntraIdNormalizer";
import {
  flattenPayload,
  parseEventTime,
  readValue,
} from "../NormalizerHelpers";
import { SecurityRecordReading } from "../SecurityRecordReading";
import {
  MAX_JSON_LINE_LENGTH,
  SecurityLogLine,
  boundAttributes,
  buildLogSecurityEvent,
  readRemoteIpAddress,
} from "./SecurityLogLine";

/*
 * What Azure's diagnostic settings export to an Event Hub or a storage
 * account - and so what an OpenTelemetry Collector or a log shipper
 * forwards from there - as a log line: one record, or Azure's own batch
 * {"records": [...]}. Two families share the shape:
 *
 *   - the Azure Activity Log: each change made in a subscription
 *     (Administrative), Microsoft Defender for Cloud's alerts (Security),
 *     and what Azure Policy refused (Policy). An operation is logged as it
 *     starts, is accepted and ends; only its end is an event, never a
 *     service's health or an autoscale step.
 *   - Microsoft Entra ID's logs: sign-ins, directory changes and Identity
 *     Protection's risks, read by the same normalizer as the Microsoft
 *     Entra ID connection (EntraIdNormalizer), so a sign-in reads the same
 *     either way. A person's interactive sign-ins are kept whatever their
 *     outcome; the background sign-ins apps make for them, and apps' own,
 *     only when they failed - successful ones are most of the volume.
 *
 * A record from the Activity Log's REST API (category: { value }, status:
 * { value }, caller, eventTimestamp) is read too, so a script that copies
 * the API's records into logs is covered.
 */

const API_ACTIVITY: number = 6003;
const DETECTION_FINDING: number = 2004;

export const AZURE_ACTIVITY_PRODUCT_NAME: string = "Azure Activity Log";

// The most records one line is read for.
const MAX_RECORDS_PER_LINE: number = 500;

// The Activity Log's categories read, lowercase.
export const AZURE_ACTIVITY_CATEGORIES: ReadonlyArray<string> = [
  "administrative",
  "security",
  "policy",
];

// Entra ID's categories read in full, lowercase.
export const ENTRA_ALL_CATEGORIES: ReadonlyArray<string> = [
  "signinlogs",
  "auditlogs",
  "userriskevents",
  "riskyusers",
];

// Entra ID's categories read only for their failures, lowercase.
export const ENTRA_FAILURE_CATEGORIES: ReadonlyArray<string> = [
  "noninteractiveusersigninlogs",
  "serviceprincipalsigninlogs",
];

/*
 * How a record names its category in the line: as the export writes it
 * ("category":"SignInLogs", with or without a space) and as the REST API
 * does ("category":{"value":"Administrative"...). A record is read only
 * when the line names its category one of these ways - what the log scan
 * asks the database for - so the two always agree. Lowercase.
 */
export function azureCategoryMarkers(category: string): Array<string> {
  const value: string = category.toLowerCase();

  return [
    `"category":"${value}"`,
    `"category": "${value}"`,
    `"category":{"value":"${value}"`,
    `"category": {"value": "${value}"`,
  ];
}

// Every category this parser reads, as the prefilter's words.
export const AZURE_PREFILTER_WORDS: ReadonlyArray<string> = [
  ...AZURE_ACTIVITY_CATEGORIES,
  ...ENTRA_ALL_CATEGORIES,
  ...ENTRA_FAILURE_CATEGORIES,
].flatMap((category: string): Array<string> => {
  return azureCategoryMarkers(category);
});

// The end of an operation, as the export and the REST API say it.
const ENDED_STATUSES: ReadonlyArray<string> = [
  "success",
  "succeeded",
  "failure",
  "failed",
];

const FAILED_STATUSES: ReadonlyArray<string> = ["failure", "failed"];

const DEFENDER_SEVERITIES: Record<string, OcsfSeverity> = {
  high: OcsfSeverity.High,
  medium: OcsfSeverity.Medium,
  low: OcsfSeverity.Low,
  informational: OcsfSeverity.Informational,
};

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

// A field that is text in the export and { value, localizedValue } in the API.
function valueOf(field: JSONValue | undefined): string {
  const object: JSONObject | null = asObject(field);

  return object ? text(object["value"]) : text(field);
}

// Who made a call: the caller, else the claims Azure kept of their token.
function callerOf(record: JSONObject): string {
  const claims: JSONObject =
    asObject(readValue(record, "identity.claims")) ||
    asObject(record["claims"]) ||
    {};

  return (
    text(record["caller"]) ||
    text(claims["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn"]) ||
    text(
      claims["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"],
    ) ||
    text(claims["name"]) ||
    text(claims["appid"])
  );
}

// "/subscriptions/{id}/..." -> the subscription id, else "".
export function subscriptionOf(resourceId: string): string {
  const lower: string = resourceId.toLowerCase();
  const marker: string = "/subscriptions/";
  const at: number = lower.indexOf(marker);

  if (at === -1) {
    return "";
  }

  const start: number = at + marker.length;
  const end: number = resourceId.indexOf("/", start);

  return resourceId.slice(start, end === -1 ? undefined : end);
}

export function readAzureRecords(body: string): Array<JSONObject> {
  const text: string = (body || "").trim();

  if (
    !text.startsWith("{") ||
    text.length > MAX_JSON_LINE_LENGTH ||
    (text.indexOf('"category"') === -1 && text.indexOf('"records"') === -1)
  ) {
    return [];
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }

  const document: JSONObject | null = asObject(parsed);

  if (!document) {
    return [];
  }

  const records: JSONValue | undefined = document["records"];

  if (Array.isArray(records)) {
    return records
      .slice(0, MAX_RECORDS_PER_LINE)
      .map((record: JSONValue): JSONObject | null => {
        return asObject(record);
      })
      .filter((record: JSONObject | null): boolean => {
        return record !== null;
      }) as Array<JSONObject>;
  }

  return [document];
}

/*
 * One Activity Log record as a reading, or null for one that is not an
 * event: an operation that has not ended, a category not read, a policy
 * that only audited.
 */
export function readAzureActivityRecord(
  record: JSONObject,
): SecurityRecordReading | null {
  const category: string = valueOf(record["category"]).toLowerCase();

  if (!AZURE_ACTIVITY_CATEGORIES.includes(category)) {
    return null;
  }

  const operation: string = valueOf(record["operationName"]);
  const status: string = (
    text(record["resultType"]) || valueOf(record["status"])
  ).toLowerCase();
  const resourceId: string = text(record["resourceId"]);
  const caller: string = callerOf(record);
  const ip: string = readRemoteIpAddress(
    text(record["callerIpAddress"]) ||
      text(readValue(record, "httpRequest.clientIpAddress")),
  );
  const time: Date | null = parseEventTime(
    record["time"] ?? record["eventTimestamp"] ?? null,
  );
  const subscription: string = subscriptionOf(resourceId);
  const eventDataId: string = text(record["eventDataId"]);

  if (!operation) {
    return null;
  }

  if (category === "security") {
    const properties: JSONObject = asObject(record["properties"]) || {};
    const alertName: string =
      text(properties["alertName"]) ||
      text(properties["AlertDisplayName"]) ||
      text(properties["alertDisplayName"]) ||
      operation;
    const severityWord: string = (
      text(properties["severity"]) || text(properties["Severity"])
    ).toLowerCase();

    return {
      time,
      eventUid: eventDataId ? `azure-activity:${eventDataId}` : "",
      classUid: DETECTION_FINDING,
      activityName: "Create",
      statusName: "Detected",
      severity: DEFENDER_SEVERITIES[severityWord] || OcsfSeverity.Medium,
      message: `Microsoft Defender for Cloud: ${alertName}${resourceId ? ` on ${resourceId}` : ""}`,
      ruleName: alertName,
      principalUser: caller,
      principalIp: ip,
      targetHost: subscription,
      targetResource: resourceId,
      attributes: boundAttributes(flattenPayload(record)),
    };
  }

  if (category === "policy") {
    // Azure Policy refusing a request is an event; an audit is not.
    if (!operation.toLowerCase().includes("/deny/")) {
      return null;
    }

    return {
      time,
      eventUid: eventDataId ? `azure-activity:${eventDataId}` : "",
      classUid: API_ACTIVITY,
      activityName: operation,
      statusName: "Failure",
      severity: OcsfSeverity.Low,
      message: `Azure Policy refused a request${caller ? ` from ${caller}` : ""}${resourceId ? ` on ${resourceId}` : ""}`,
      principalUser: caller,
      principalIp: ip,
      targetHost: subscription,
      targetResource: resourceId,
      attributes: boundAttributes(flattenPayload(record)),
    };
  }

  // Administrative: only the end of an operation.
  if (!ENDED_STATUSES.includes(status)) {
    return null;
  }

  const failed: boolean = FAILED_STATUSES.includes(status);

  return {
    time,
    eventUid: eventDataId ? `azure-activity:${eventDataId}` : "",
    classUid: API_ACTIVITY,
    activityName: operation,
    statusName: failed ? "Failure" : "Success",
    severity: failed ? OcsfSeverity.Low : OcsfSeverity.Informational,
    message: `${caller || "Someone"} called ${operation}${resourceId ? ` on ${resourceId}` : ""}${failed ? " (failed)" : ""}`,
    principalUser: caller,
    principalIp: ip,
    targetHost: subscription,
    targetResource: resourceId,
    attributes: boundAttributes(flattenPayload(record)),
  };
}

/*
 * One Entra ID record of an export as a reading, from its properties -
 * the object Microsoft Graph returns - or null.
 */
export function readEntraExportRecord(
  record: JSONObject,
): SecurityRecordReading | null {
  const category: string = text(record["category"]).toLowerCase();
  const properties: JSONObject | null = asObject(record["properties"]);

  if (!properties) {
    return null;
  }

  if (category === "signinlogs") {
    return readEntraSignIn(properties, EntraLog.SignInLogs);
  }

  if (ENTRA_FAILURE_CATEGORIES.includes(category)) {
    // The export says how a sign-in ended twice: resultType, and the status.
    const resultType: string = text(record["resultType"]);

    if (resultType === "0" || readSignInErrorCode(properties) === 0) {
      return null;
    }

    return readEntraSignIn(
      properties,
      category === "serviceprincipalsigninlogs"
        ? EntraLog.ServicePrincipalSignInLogs
        : EntraLog.NonInteractiveUserSignInLogs,
    );
  }

  if (category === "auditlogs") {
    return readEntraDirectoryAudit(properties);
  }

  if (category === "userriskevents") {
    return readEntraRisk(properties, EntraLog.UserRiskEvents);
  }

  if (category === "riskyusers") {
    return readEntraRisk(properties, EntraLog.RiskyUsers);
  }

  return null;
}

export default class AzureActivityLogParser {
  public static parse(line: SecurityLogLine): Array<NormalizedSecurityEvent> {
    const events: Array<NormalizedSecurityEvent> = [];
    const lowerBody: string = (line.body || "").toLowerCase();

    readAzureRecords(line.body).forEach(
      (record: JSONObject, index: number): void => {
        const category: string = valueOf(record["category"]).toLowerCase();
        const isEntra: boolean =
          ENTRA_ALL_CATEGORIES.includes(category) ||
          ENTRA_FAILURE_CATEGORIES.includes(category);
        const namesCategory: boolean = azureCategoryMarkers(category).some(
          (marker: string): boolean => {
            return lowerBody.indexOf(marker) !== -1;
          },
        );

        if (!namesCategory) {
          return;
        }
        const reading: SecurityRecordReading | null = isEntra
          ? readEntraExportRecord(record)
          : readAzureActivityRecord(record);

        if (!reading) {
          return;
        }

        events.push(
          buildLogSecurityEvent({
            line,
            format: SecurityLogFormat.AzureActivity,
            classUid: reading.classUid,
            className: reading.className,
            activityName: reading.activityName,
            statusName: reading.statusName,
            severity: reading.severity,
            message: reading.message,
            time: reading.time || undefined,
            vendorName: isEntra ? ENTRA_ID_VENDOR_NAME : "Microsoft",
            productName: isEntra
              ? ENTRA_ID_PRODUCT_NAME
              : AZURE_ACTIVITY_PRODUCT_NAME,
            ruleId: reading.ruleId,
            ruleName: reading.ruleName,
            eventUid: reading.eventUid || undefined,
            recordIndex: index,
            principalUser: reading.principalUser,
            principalHost: reading.principalHost,
            principalIp: reading.principalIp,
            targetUser: reading.targetUser,
            targetHost: reading.targetHost,
            targetIp: reading.targetIp,
            targetPort: reading.targetPort,
            targetResource: reading.targetResource,
            attributes: reading.attributes,
            mitreTactics: reading.mitreTactics,
            mitreTechniques: reading.mitreTechniques,
          }),
        );
      },
    );

    return events;
  }
}

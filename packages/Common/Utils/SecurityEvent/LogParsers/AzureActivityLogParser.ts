import { JSONObject, JSONValue } from "../../../Types/JSON";
import lookupTable from "../../LookupTable";
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
import Crypto from "../../Crypto";
import {
  flattenPayload,
  parseEventTime,
  readValue,
} from "../NormalizerHelpers";
import { getAzureResourceIdKey } from "../../SecurityCase/SecurityConnectionMatch";
import { SecurityRecordReading } from "../SecurityRecordReading";
import { readAzureActivityResourceIds } from "./CloudAuditResources";
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
 * Whether a diagnostic record's category is one this parser reads: the
 * Activity Log's and Microsoft Entra ID's. A cloud stream keeps such a
 * record whole, as its log line's body (#10032), so it is read here as a
 * pipeline's would be; any other category's record stays a one-line log.
 */
export function isAzureSecurityRecordCategory(category: string): boolean {
  const value: string = (category || "").trim().toLowerCase();

  return (
    AZURE_ACTIVITY_CATEGORIES.includes(value) ||
    ENTRA_ALL_CATEGORIES.includes(value) ||
    ENTRA_FAILURE_CATEGORIES.includes(value)
  );
}

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

const DEFENDER_SEVERITIES: ReadonlyMap<string, OcsfSeverity> = lookupTable({
  high: OcsfSeverity.High,
  medium: OcsfSeverity.Medium,
  low: OcsfSeverity.Low,
  informational: OcsfSeverity.Informational,
});

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

/*
 * How an operation ended, as both shapes say it: the export's resultType
 * ("Success", "Failure", "Start") and the REST API's status ("Succeeded",
 * "Failed", "Started") are one word each.
 */
const OUTCOME_WORDS: ReadonlyMap<string, string> = lookupTable({
  success: "succeeded",
  succeeded: "succeeded",
  failure: "failed",
  failed: "failed",
  start: "started",
  started: "started",
  accept: "accepted",
  accepted: "accepted",
});

/*
 * AN ACTIVITY LOG RECORD'S ID, THE SAME HOWEVER IT REACHED ONEUPTIME
 * (#10032). The REST API - what Cloud audit logs reads - gives each record
 * its eventDataId; a diagnostic setting's export to an Event Hub - what a
 * cloud stream or a raw pipeline delivers - follows the resource logs
 * schema, which has no eventDataId at all (Azure Activity Log event
 * schema, "Schema from storage account and event hubs"). So one record
 * read both ways would be two events.
 *
 * Both shapes do say the same five things of a record, in their own words
 * and cases: its category, its operation's correlation id, the operation,
 * the resource and how it ended, and the moment it was logged (the
 * export's `time` is the REST API's `eventTimestamp`). The record's id is
 * made of those - folded, the resource by its key - so either shape gives
 * it, and the store finds a record that came the other way first
 * (SecurityEventStoreOnce). "" when the record says too little to tell it
 * from another: it is then stored as the line it came in.
 */
export function getAzureActivityRecordUid(record: JSONObject): string {
  const category: string = valueOf(record["category"]).toLowerCase();
  const correlationId: string = text(record["correlationId"]).toLowerCase();
  const operation: string = valueOf(record["operationName"]).toLowerCase();
  const resultWord: string = (
    text(record["resultType"]) || valueOf(record["status"])
  ).toLowerCase();
  const time: Date | null = parseEventTime(
    record["time"] ?? record["eventTimestamp"] ?? null,
  );
  const resourceId: string = text(record["resourceId"]);

  if (!category || !correlationId || !operation || !time) {
    return "";
  }

  const identity: string = JSON.stringify([
    category,
    correlationId,
    operation,
    getAzureResourceIdKey(resourceId) || resourceId.toLowerCase(),
    OUTCOME_WORDS.get(resultWord) || resultWord,
    time.toISOString(),
  ]);

  return `azure-activity:${Crypto.getSha256Hash(identity).slice(0, 40)}`;
}

/*
 * The ids a record may have been stored under before its id was made of
 * what it says (#10032): its eventDataId, which Cloud audit logs stored
 * the REST API's records by. Looked up beside its id, so a record read
 * again after the change is not stored twice.
 */
export function getAzureActivityRecordUidAliases(
  record: JSONObject,
): Array<string> {
  const eventDataId: string = text(record["eventDataId"]);

  return eventDataId ? [`azure-activity:${eventDataId}`] : [];
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
  /*
   * Its id, the same in the export and the REST API (#10032), and the one
   * it was stored under before: the REST API's eventDataId. A record that
   * says too little to make one keeps its eventDataId, when it has one.
   */
  const madeUid: string = getAzureActivityRecordUid(record);
  const storedUids: Array<string> = getAzureActivityRecordUidAliases(record);
  const eventUid: string = madeUid || storedUids[0] || "";
  const eventUidAliases: Array<string> = madeUid ? storedUids : [];

  if (!operation) {
    return null;
  }

  // The resource it was on, and the one that is a part of, by their IDs (#9779).
  const resourceIds: Array<string> = readAzureActivityResourceIds(record);

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
      eventUid,
      eventUidAliases,
      classUid: DETECTION_FINDING,
      activityName: "Create",
      statusName: "Detected",
      severity: DEFENDER_SEVERITIES.get(severityWord) || OcsfSeverity.Medium,
      message: `Microsoft Defender for Cloud: ${alertName}${resourceId ? ` on ${resourceId}` : ""}`,
      ruleName: alertName,
      principalUser: caller,
      principalIp: ip,
      targetHost: subscription,
      targetResource: resourceId,
      resourceIds,
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
      eventUid,
      eventUidAliases,
      classUid: API_ACTIVITY,
      activityName: operation,
      statusName: "Failure",
      severity: OcsfSeverity.Low,
      message: `Azure Policy refused a request${caller ? ` from ${caller}` : ""}${resourceId ? ` on ${resourceId}` : ""}`,
      principalUser: caller,
      principalIp: ip,
      targetHost: subscription,
      targetResource: resourceId,
      resourceIds,
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
    eventUid,
    eventUidAliases,
    classUid: API_ACTIVITY,
    activityName: operation,
    statusName: failed ? "Failure" : "Success",
    severity: failed ? OcsfSeverity.Low : OcsfSeverity.Informational,
    message: `${caller || "Someone"} called ${operation}${resourceId ? ` on ${resourceId}` : ""}${failed ? " (failed)" : ""}`,
    principalUser: caller,
    principalIp: ip,
    targetHost: subscription,
    targetResource: resourceId,
    resourceIds,
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
            eventUidAliases: reading.eventUidAliases,
            recordIndex: index,
            principalUser: reading.principalUser,
            principalHost: reading.principalHost,
            principalIp: reading.principalIp,
            targetUser: reading.targetUser,
            targetHost: reading.targetHost,
            targetIp: reading.targetIp,
            targetPort: reading.targetPort,
            targetResource: reading.targetResource,
            resourceIds: reading.resourceIds,
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

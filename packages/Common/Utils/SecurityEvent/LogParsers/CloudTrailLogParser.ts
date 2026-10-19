import { JSONObject, JSONValue } from "../../../Types/JSON";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import SecurityLogFormat from "../../../Types/SecurityEvent/SecurityLogFormat";
import {
  flattenPayload,
  parseEventTime,
  readString,
  readValue,
} from "../NormalizerHelpers";
import {
  MAX_JSON_LINE_LENGTH,
  SecurityLogLine,
  buildLogSecurityEvent,
  readIpAddress,
} from "./SecurityLogLine";

/*
 * AWS CloudTrail records, as a log line: one record, or a CloudTrail log
 * file's {"Records": [...]} when a shipper forwards the file whole.
 *
 * Most of what CloudTrail records is AWS reading its own configuration, so
 * only what a security team looks at becomes a security event:
 *
 *   - every call AWS refused (an errorCode such as AccessDenied);
 *   - every console sign-in, and everything the root user does;
 *   - every change a person or a workload made (readOnly false), but not
 *     what an AWS service did on its own behalf, and not data events (S3
 *     object reads and writes) that succeeded. A record that does not say
 *     whether it changed anything is left out.
 *
 * The event keeps the record as attributes, so the rule library's
 * CloudTrail rules (eventName, errorCode, userIdentity.type,
 * additionalEventData.MFAUsed...) read it as they would from the source.
 */

export const CLOUDTRAIL_AUTHENTICATION_CLASS_UID: number = 3002;
export const CLOUDTRAIL_API_ACTIVITY_CLASS_UID: number = 6003;

// The most records one line is read for.
const MAX_RECORDS_PER_LINE: number = 500;
const MAX_CLOUDTRAIL_ATTRIBUTES: number = 300;
const MAX_CLOUDTRAIL_ATTRIBUTE_VALUE_LENGTH: number = 1000;

export function isCloudTrailRecord(record: JSONObject): boolean {
  return (
    readString(record, "eventSource").length > 0 &&
    readString(record, "eventName").length > 0 &&
    (readValue(record, "userIdentity") !== null ||
      readString(record, "awsRegion").length > 0)
  );
}

function isFalse(value: JSONValue): boolean {
  return value === false || value === "false";
}

export function isSecurityRelevantCloudTrailRecord(
  record: JSONObject,
): boolean {
  const errorCode: string = readString(record, "errorCode");

  if (errorCode) {
    return true;
  }

  if (readString(record, "eventName") === "ConsoleLogin") {
    return true;
  }

  if (readString(record, "userIdentity.type") === "Root") {
    return true;
  }

  if (readString(record, "eventCategory") === "Data") {
    return false;
  }

  // Only a call CloudTrail marks as a change; a record that does not say is left out.
  if (!isFalse(readValue(record, "readOnly"))) {
    return false;
  }

  // A call an AWS service made on its own behalf.
  if (
    readString(record, "userIdentity.type") === "AWSService" ||
    readString(record, "userIdentity.invokedBy").length > 0
  ) {
    return false;
  }

  return true;
}

// Who made the call, the way a person would name them.
export function readCloudTrailActor(record: JSONObject): string {
  return (
    readString(record, "userIdentity.arn") ||
    readString(record, "userIdentity.userName") ||
    readString(record, "userIdentity.sessionContext.sessionIssuer.userName") ||
    readString(record, "userIdentity.principalId")
  );
}

export function readCloudTrailRecords(
  line: SecurityLogLine,
): Array<JSONObject> {
  const body: string = (line.body || "").trim();

  if (
    !body.startsWith("{") ||
    body.length > MAX_JSON_LINE_LENGTH ||
    !body.includes("eventSource")
  ) {
    return [];
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }

  const document: JSONObject = parsed as JSONObject;
  const records: JSONValue = document["Records"] as JSONValue;
  const candidates: Array<JSONValue> = Array.isArray(records)
    ? records.slice(0, MAX_RECORDS_PER_LINE)
    : [document];

  return candidates.filter((candidate: JSONValue): boolean => {
    return (
      Boolean(candidate) &&
      typeof candidate === "object" &&
      !Array.isArray(candidate) &&
      isCloudTrailRecord(candidate as JSONObject)
    );
  }) as Array<JSONObject>;
}

function boundedAttributes(record: JSONObject): JSONObject {
  const flattened: JSONObject = flattenPayload(record);
  const bounded: JSONObject = {};
  let count: number = 0;

  for (const key of Object.keys(flattened)) {
    if (count >= MAX_CLOUDTRAIL_ATTRIBUTES) {
      break;
    }

    const value: string = String(flattened[key]);
    bounded[key] =
      value.length > MAX_CLOUDTRAIL_ATTRIBUTE_VALUE_LENGTH
        ? value.slice(0, MAX_CLOUDTRAIL_ATTRIBUTE_VALUE_LENGTH)
        : value;
    count++;
  }

  return bounded;
}

export default class CloudTrailLogParser {
  public static parse(line: SecurityLogLine): Array<NormalizedSecurityEvent> {
    const records: Array<JSONObject> = readCloudTrailRecords(line);
    const events: Array<NormalizedSecurityEvent> = [];

    records.forEach((record: JSONObject, index: number): void => {
      if (!isSecurityRelevantCloudTrailRecord(record)) {
        return;
      }

      const eventName: string = readString(record, "eventName");
      const eventSource: string = readString(record, "eventSource");
      const errorCode: string = readString(record, "errorCode");
      const actor: string = readCloudTrailActor(record);
      const sourceAddress: string = readString(record, "sourceIPAddress");
      const sourceIp: string = readIpAddress(sourceAddress);
      const account: string = readString(record, "recipientAccountId");
      const eventId: string = readString(record, "eventID");
      const isConsoleLogin: boolean = eventName === "ConsoleLogin";
      const loginResult: string = readString(
        record,
        "responseElements.ConsoleLogin",
      );
      const isFailure: boolean =
        Boolean(errorCode) || (isConsoleLogin && loginResult === "Failure");
      const isRoot: boolean =
        readString(record, "userIdentity.type") === "Root";

      let severity: OcsfSeverity = OcsfSeverity.Informational;

      if (isRoot || isFailure) {
        severity = OcsfSeverity.Low;
      }

      const who: string = actor || "Someone";
      const message: string = isConsoleLogin
        ? `${isFailure ? "Failed AWS console sign-in" : "AWS console sign-in"} for ${who}${sourceIp ? ` from ${sourceIp}` : ""}`
        : `${who} called ${eventName} on ${eventSource}${errorCode ? ` (${errorCode})` : ""}`;

      events.push(
        buildLogSecurityEvent({
          line,
          format: SecurityLogFormat.AwsCloudTrail,
          classUid: isConsoleLogin
            ? CLOUDTRAIL_AUTHENTICATION_CLASS_UID
            : CLOUDTRAIL_API_ACTIVITY_CLASS_UID,
          activityName: isConsoleLogin ? "Logon" : eventName,
          statusName: isFailure ? "Failure" : "Success",
          severity,
          message,
          time: parseEventTime(readValue(record, "eventTime")) || undefined,
          recordIndex: index,
          eventUid: eventId ? `cloudtrail:${eventId}` : undefined,
          principalUser: actor,
          principalIp: sourceIp,
          // A call from inside AWS names the service instead of an address.
          principalHost: sourceIp ? "" : sourceAddress.slice(0, 255),
          targetHost: account,
          targetResource: `${eventSource} ${eventName}`,
          attributes: boundedAttributes(record),
        }),
      );
    });

    return events;
  }
}

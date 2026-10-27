import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { TelemetryServiceMetadata } from "../../Services/OpenTelemetryIngestService";
import TelemetryUtil, { AttributeType } from "../Telemetry/Telemetry";

/*
 * Events whose source timestamp is outside this window are stamped with
 * the ingestion time instead (original preserved in attributes). The
 * table partitions by toYYYYMMDD(time), so a forged or garbage timestamp
 * must not be allowed to create arbitrary partitions.
 */
export const MAX_SECURITY_EVENT_AGE_IN_DAYS: number = 366;
export const MAX_SECURITY_EVENT_FUTURE_SKEW_IN_MINUTES: number = 60;

/*
 * A W3C trace id is 32 characters and a span id 16; other sources use
 * UUIDs and the like. Anything longer than this is not an id, and is not
 * kept.
 */
export const MAX_SECURITY_EVENT_TELEMETRY_ID_LENGTH: number = 128;

// A trace, span or session id as the row keeps it: trimmed, '' when absent.
export function readSecurityEventTelemetryId(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const id: string = value.trim();

  return id.length > MAX_SECURITY_EVENT_TELEMETRY_ID_LENGTH ? "" : id;
}

/*
 * NormalizedSecurityEvent -> SecurityEvent ClickHouse row. Shared by the
 * ingest pipeline and the detection engine (which writes Detection
 * Finding rows through the same shape), so the two can never drift.
 */
export function buildSecurityEventDbRow(data: {
  normalized: NormalizedSecurityEvent;
  projectId: ObjectID;
  serviceMetadata: TelemetryServiceMetadata;
  retentionDays: number;
}): JSONObject {
  const { normalized, projectId, serviceMetadata, retentionDays } = data;

  const ingestionDate: Date = OneUptimeDate.getCurrentDate();

  let eventTime: Date = normalized.time;
  let attributes: Dictionary<AttributeType | Array<AttributeType>> = {
    ...(normalized.attributes as Dictionary<
      AttributeType | Array<AttributeType>
    >),
  };

  const ageInDays: number = OneUptimeDate.getNumberOfDaysBetweenDates(
    eventTime,
    ingestionDate,
  );
  const futureSkewInMinutes: number =
    (eventTime.getTime() - ingestionDate.getTime()) / (60 * 1000);

  if (
    Number.isNaN(eventTime.getTime()) ||
    ageInDays > MAX_SECURITY_EVENT_AGE_IN_DAYS ||
    futureSkewInMinutes > MAX_SECURITY_EVENT_FUTURE_SKEW_IN_MINUTES
  ) {
    attributes = {
      ...attributes,
      "oneuptime.original_time": String(normalized.time),
    };
    eventTime = ingestionDate;
  }

  const retentionDate: Date = OneUptimeDate.addRemoveDays(
    ingestionDate,
    retentionDays,
  );

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(ingestionDate),
    projectId: projectId.toString(),
    primaryEntityId: serviceMetadata.primaryEntityId.toString(),
    primaryEntityType: serviceMetadata.primaryEntityType,
    time: OneUptimeDate.toClickhouseDateTime64(eventTime),
    eventUid: normalized.eventUid,
    categoryUid: normalized.categoryUid,
    categoryName: normalized.categoryName,
    classUid: normalized.classUid,
    className: normalized.className,
    activityName: normalized.activityName,
    severityId: normalized.severityId,
    severityName: normalized.severityName,
    statusName: normalized.statusName,
    message: normalized.message,
    vendorName: normalized.vendorName,
    productName: normalized.productName,
    ruleId: normalized.ruleId,
    ruleName: normalized.ruleName,
    mitreTactics: normalized.mitreTactics,
    mitreTechniques: normalized.mitreTechniques,
    principalUser: normalized.principalUser,
    principalHost: normalized.principalHost,
    principalIp: normalized.principalIp,
    principalProcess: normalized.principalProcess,
    processName: normalized.processName,
    processPath: normalized.processPath,
    processCommandLine: normalized.processCommandLine,
    parentProcessName: normalized.parentProcessName,
    parentProcessPath: normalized.parentProcessPath,
    parentProcessCommandLine: normalized.parentProcessCommandLine,
    targetUser: normalized.targetUser,
    targetHost: normalized.targetHost,
    targetIp: normalized.targetIp,
    targetPort: normalized.targetPort,
    targetResource: normalized.targetResource,
    observables: normalized.observables,
    traceId: readSecurityEventTelemetryId(normalized.traceId),
    spanId: readSecurityEventTelemetryId(normalized.spanId),
    sessionId: readSecurityEventTelemetryId(normalized.sessionId),
    requestOutcome: normalized.requestOutcome || "",
    attributes,
    attributeKeys: TelemetryUtil.getAttributeKeys(attributes),
    retentionDate: OneUptimeDate.toClickhouseDateTime(retentionDate),
  } satisfies JSONObject;
}

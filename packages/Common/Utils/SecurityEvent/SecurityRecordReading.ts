import { JSONObject } from "../../Types/JSON";
import NormalizedSecurityEvent from "../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  ocsfCategoryForClassUid,
  ocsfEventClassByUid,
} from "../../Types/SecurityEvent/OcsfEventClass";
import OcsfSeverity, {
  OcsfSeverityId,
} from "../../Types/SecurityEvent/OcsfSeverity";
import { buildObservables, contentHashEventUid } from "./NormalizerHelpers";

/*
 * What one source record says, before it is an event: who did what to
 * what, when, how it ended and how much it matters.
 *
 * A record can reach OneUptime two ways - a connection reading the
 * source's API, and the project's own logs holding the same record (an
 * Entra ID sign-in polled from Microsoft Graph, or exported by Azure to an
 * Event Hub and collected as a log). Its normalizer reads it once, into a
 * reading; the connection turns the reading into an event
 * (toNormalizedSecurityEvent), and the log scan into an event that also
 * names the log it came from (buildLogSecurityEvent). The same record then
 * becomes the same event, with the same id, either way.
 */
export interface SecurityRecordReading {
  time: Date | null;
  // The source's own id for the record; "" when it has none.
  eventUid: string;
  classUid: number;
  // For a record no OCSF class fits (class 0): what the source calls it.
  className?: string | undefined;
  activityName: string;
  statusName: string;
  severity: OcsfSeverity;
  message: string;
  ruleId?: string | undefined;
  ruleName?: string | undefined;
  principalUser?: string | undefined;
  principalHost?: string | undefined;
  principalIp?: string | undefined;
  targetUser?: string | undefined;
  targetHost?: string | undefined;
  targetIp?: string | undefined;
  targetPort?: number | undefined;
  targetResource?: string | undefined;
  mitreTactics?: Array<string> | undefined;
  mitreTechniques?: Array<string> | undefined;
  attributes: JSONObject;
}

// The longest message an event made from a record keeps.
const MAX_MESSAGE_LENGTH: number = 1000;
// An entity's value is never longer than this.
const MAX_ENTITY_LENGTH: number = 255;

function clean(value: string | undefined, limit: number): string {
  const text: string = (value || "").trim();

  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/*
 * A reading as the event a connection stores: stamped with the product
 * that made it, its id (a hash of the record when the source gave none).
 */
export function toNormalizedSecurityEvent(data: {
  reading: SecurityRecordReading;
  vendorName: string;
  productName: string;
  raw: JSONObject;
}): NormalizedSecurityEvent {
  const reading: SecurityRecordReading = data.reading;
  const category: { categoryUid: number; categoryName: string } =
    ocsfCategoryForClassUid(reading.classUid);
  const principalUser: string = clean(reading.principalUser, MAX_ENTITY_LENGTH);
  const principalHost: string = clean(reading.principalHost, MAX_ENTITY_LENGTH);
  const principalIp: string = clean(reading.principalIp, MAX_ENTITY_LENGTH);
  const targetUser: string = clean(reading.targetUser, MAX_ENTITY_LENGTH);
  const targetHost: string = clean(reading.targetHost, MAX_ENTITY_LENGTH);
  const targetIp: string = clean(reading.targetIp, MAX_ENTITY_LENGTH);

  return {
    time: reading.time || new Date(),
    eventUid: reading.eventUid || contentHashEventUid(data.raw),
    categoryUid: category.categoryUid,
    categoryName: category.categoryName,
    classUid: reading.classUid,
    // A record no OCSF class fits (class 0) keeps the name its source gives it.
    className:
      (reading.classUid === 0
        ? clean(reading.className, MAX_ENTITY_LENGTH)
        : "") ||
      ocsfEventClassByUid(reading.classUid)?.name ||
      "Base Event",
    activityName: clean(reading.activityName, MAX_ENTITY_LENGTH),
    severityId: OcsfSeverityId[reading.severity],
    severityName: reading.severity,
    statusName: clean(reading.statusName, MAX_ENTITY_LENGTH),
    message: clean(reading.message, MAX_MESSAGE_LENGTH),
    vendorName: data.vendorName,
    productName: data.productName,
    ruleId: clean(reading.ruleId, MAX_ENTITY_LENGTH),
    ruleName: clean(reading.ruleName, MAX_ENTITY_LENGTH),
    mitreTactics: reading.mitreTactics || [],
    mitreTechniques: reading.mitreTechniques || [],
    principalUser,
    principalHost,
    principalIp,
    principalProcess: "",
    processName: "",
    processPath: "",
    processCommandLine: "",
    parentProcessName: "",
    parentProcessPath: "",
    parentProcessCommandLine: "",
    targetUser,
    targetHost,
    targetIp,
    targetPort: reading.targetPort || 0,
    // An Azure resource id or a Google resource name runs long.
    targetResource: clean(reading.targetResource, MAX_MESSAGE_LENGTH),
    observables: buildObservables([
      principalUser,
      targetUser,
      principalHost,
      targetHost,
      principalIp,
      targetIp,
    ]),
    attributes: reading.attributes,
  };
}

import { JSONObject, JSONValue } from "../../Types/JSON";
import NormalizedSecurityEvent from "../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity, {
  OcsfSeverityId,
  normalizeOcsfSeverity,
} from "../../Types/SecurityEvent/OcsfSeverity";
import { ocsfCategoryForClassUid } from "../../Types/SecurityEvent/OcsfEventClass";
import UdmNormalizer from "./UdmNormalizer";
import {
  buildObservables,
  contentHashEventUid,
  flattenPayload,
  parseEventTime,
  readString,
  readValue,
} from "./NormalizerHelpers";

/*
 * Google SecOps (Chronicle) detection/alert payload -> a Detection Finding
 * (OCSF class 2004).
 *
 * This is the shape a SecOps SOAR playbook webhook or the detections
 * stream (legacyStreamDetectionAlerts) delivers: rule metadata in a
 * `detection` array plus the matched UDM events in `collectionElements`.
 * The matched sample events are run through the UDM entity extraction so
 * the finding row inherits their observables — that is what makes a
 * detection joinable to the hosts/users it fired on.
 */

const DETECTION_FINDING_CLASS_UID: number = 2004;

/*
 * How many sample events to mine for observables. Detections can carry
 * hundreds of matched events; a handful is enough to identify the
 * entities involved without turning one finding row into a megabyte.
 */
const MAX_SAMPLE_EVENTS: number = 25;

function collectSampleEvents(payload: JSONObject): Array<JSONObject> {
  const events: Array<JSONObject> = [];

  const collectionElements: JSONValue =
    readValue(payload, "collectionElements") ??
    readValue(payload, "collection_elements");

  if (!Array.isArray(collectionElements)) {
    return events;
  }

  for (const element of collectionElements) {
    if (typeof element !== "object" || element === null) {
      continue;
    }

    const references: JSONValue = readValue(
      element as JSONObject,
      "references",
    );

    if (!Array.isArray(references)) {
      continue;
    }

    for (const reference of references) {
      if (events.length >= MAX_SAMPLE_EVENTS) {
        return events;
      }

      if (typeof reference !== "object" || reference === null) {
        continue;
      }

      const event: JSONValue = readValue(reference as JSONObject, "event");

      if (event && typeof event === "object" && !Array.isArray(event)) {
        events.push(event as JSONObject);
      }
    }
  }

  return events;
}

function readDetectionEntry(payload: JSONObject): JSONObject | null {
  const detection: JSONValue = readValue(payload, "detection");

  if (Array.isArray(detection)) {
    const first: JSONValue = detection[0] as JSONValue;
    if (first && typeof first === "object" && !Array.isArray(first)) {
      return first as JSONObject;
    }
    return null;
  }

  if (detection && typeof detection === "object") {
    return detection as JSONObject;
  }

  return null;
}

export default class GoogleSecOpsAlertNormalizer {
  public static isGoogleSecOpsAlert(payload: JSONObject): boolean {
    const type: string = readString(payload, "type").toUpperCase();

    return Boolean(
      readDetectionEntry(payload) ||
        type.includes("RULE_DETECTION") ||
        readValue(payload, "collectionElements") ||
        readValue(payload, "collection_elements"),
    );
  }

  public static normalize(payload: JSONObject): NormalizedSecurityEvent {
    const detection: JSONObject | null = readDetectionEntry(payload);

    const ruleName: string = detection
      ? readString(detection, "ruleName") || readString(detection, "rule_name")
      : "";

    const ruleId: string = detection
      ? readString(detection, "ruleId") ||
        readString(detection, "rule_id") ||
        readString(detection, "ruleVersionId") ||
        readString(detection, "rule_version_id")
      : "";

    const severityName: OcsfSeverity =
      (detection &&
        normalizeOcsfSeverity(readString(detection, "severity"))) ||
      normalizeOcsfSeverity(readString(payload, "severity")) ||
      OcsfSeverity.Unknown;

    const time: Date | null = parseEventTime(
      readValue(payload, "detectionTime") ??
        readValue(payload, "detection_time") ??
        readValue(payload, "createdTime") ??
        readValue(payload, "created_time"),
    );

    /*
     * Mine the matched UDM sample events for entities. The detection row's
     * observables become the union across samples, and the first sample
     * supplies the principal/target columns so the finding points at a
     * concrete actor instead of nothing.
     */
    const sampleEvents: Array<JSONObject> = collectSampleEvents(payload);
    const sampleObservables: Array<string> = [];
    let firstSample: NormalizedSecurityEvent | null = null;

    for (const sampleEvent of sampleEvents) {
      const normalized: NormalizedSecurityEvent =
        UdmNormalizer.normalize(sampleEvent);

      if (!firstSample) {
        firstSample = normalized;
      }

      sampleObservables.push(...normalized.observables);
    }

    const { categoryUid, categoryName } = ocsfCategoryForClassUid(
      DETECTION_FINDING_CLASS_UID,
    );

    const description: string = detection
      ? readString(detection, "description")
      : "";

    const message: string =
      ruleName || description || "Google SecOps detection";

    return {
      time: time || new Date(),
      eventUid: readString(payload, "id") || contentHashEventUid(payload),
      categoryUid,
      categoryName,
      classUid: DETECTION_FINDING_CLASS_UID,
      className: "Detection Finding",
      activityName: "Create",
      severityId: OcsfSeverityId[severityName],
      severityName,
      statusName: readString(payload, "detection.alertState") || "",
      message,
      vendorName: "Google",
      productName: "Google SecOps",
      ruleId,
      ruleName,
      mitreTactics: firstSample ? firstSample.mitreTactics : [],
      mitreTechniques: firstSample ? firstSample.mitreTechniques : [],
      principalUser: firstSample ? firstSample.principalUser : "",
      principalHost: firstSample ? firstSample.principalHost : "",
      principalIp: firstSample ? firstSample.principalIp : "",
      principalProcess: firstSample ? firstSample.principalProcess : "",
      targetUser: firstSample ? firstSample.targetUser : "",
      targetHost: firstSample ? firstSample.targetHost : "",
      targetIp: firstSample ? firstSample.targetIp : "",
      targetPort: firstSample ? firstSample.targetPort : 0,
      targetResource: firstSample ? firstSample.targetResource : "",
      observables: buildObservables(sampleObservables),
      attributes: flattenPayload(payload),
    };
  }
}

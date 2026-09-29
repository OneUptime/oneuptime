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
 * This is the shape a SecOps SOAR playbook webhook, the detections stream
 * (legacyStreamDetectionAlerts), the alerts view (legacyFetchAlertsView)
 * and the detections search (legacySearchDetections) all deliver: a
 * Collection with rule metadata in a `detection` array plus the matched
 * UDM events in `collectionElements`. The matched sample events are run
 * through the UDM entity extraction so the finding row inherits their
 * observables — that is what makes a detection joinable to the hosts/users
 * it fired on.
 *
 * Not every Collection is a rule detection. Google documents six types
 * (https://docs.cloud.google.com/chronicle/docs/reference/rest/v1alpha/Collection):
 * RULE_DETECTION, GCTI_FINDING, TELEMETRY_ALERT, UPPERCASE_ALERT,
 * MACHINE_INTELLIGENCE_ALERT and SOAR_ALERT. Only the first carries rule
 * metadata; the others still have an id, timestamps, tags and (for SOAR)
 * the originating system, which is enough for a finding row.
 */

export const DETECTION_FINDING_CLASS_UID: number = 2004;

// The source every row this normalizer writes is attributed to.
export const GOOGLE_SECOPS_VENDOR_NAME: string = "Google";
export const GOOGLE_SECOPS_PRODUCT_NAME: string = "Google SecOps";

/*
 * How many sample events to mine for observables. Detections can carry
 * hundreds of matched events; a handful is enough to identify the
 * entities involved without turning one finding row into a megabyte.
 */
const MAX_SAMPLE_EVENTS: number = 25;

/*
 * Every documented Collection.type. A payload carrying one of these and a
 * string id is a Google SecOps record even when it has no `detection`
 * entry — telemetry alerts and SOAR alerts never do.
 */
const COLLECTION_TYPES: Array<string> = [
  "RULE_DETECTION",
  "GCTI_FINDING",
  "TELEMETRY_ALERT",
  "UPPERCASE_ALERT",
  "MACHINE_INTELLIGENCE_ALERT",
  "SOAR_ALERT",
];

/*
 * Google's recommended risk_score ranges for custom detections, highest
 * band first (https://docs.cloud.google.com/chronicle/docs/yara-l/outcome-syntax):
 * 90-100 critical, 80-89 high, 50-79 medium, 20-49 low, 1-19 observations.
 * A score grades into the first band whose minimum it reaches; a score of
 * zero or less grades nothing.
 */
export const GOOGLE_SECOPS_RISK_SCORE_BANDS: ReadonlyArray<{
  minimum: number;
  severity: OcsfSeverity;
}> = [
  { minimum: 90, severity: OcsfSeverity.Critical },
  { minimum: 80, severity: OcsfSeverity.High },
  { minimum: 50, severity: OcsfSeverity.Medium },
  { minimum: 20, severity: OcsfSeverity.Low },
  { minimum: 0, severity: OcsfSeverity.Informational },
];

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

/*
 * Every value stored under one key of a Google key/value list. ruleLabels
 * and outcomes both arrive as [{ key, value }]; a plain object map is
 * accepted too, the shape a hand-built webhook body may use. Keys compare
 * trimmed and case-insensitively because YARA-L meta keys are free text.
 */
function readKeyedValues(list: JSONValue, key: string): Array<JSONValue> {
  const wanted: string = key.toLowerCase();
  const values: Array<JSONValue> = [];

  if (Array.isArray(list)) {
    for (const entry of list) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }

      const entryKey: JSONValue = (entry as JSONObject)["key"] as JSONValue;

      if (
        typeof entryKey === "string" &&
        entryKey.trim().toLowerCase() === wanted
      ) {
        values.push((entry as JSONObject)["value"] as JSONValue);
      }
    }

    return values;
  }

  if (list && typeof list === "object") {
    for (const entryKey of Object.keys(list as JSONObject)) {
      if (entryKey.trim().toLowerCase() === wanted) {
        values.push((list as JSONObject)[entryKey] as JSONValue);
      }
    }
  }

  return values;
}

/*
 * A severity only when the text names one. "Unknown" is the absence of a
 * grade, not a grade, so it does not stop the search for a real one.
 */
function gradeSeverityText(value: JSONValue): OcsfSeverity | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const severity: OcsfSeverity | null = normalizeOcsfSeverity(String(value));

  return severity === OcsfSeverity.Unknown ? null : severity;
}

function gradeRiskScore(value: JSONValue): OcsfSeverity | null {
  let score: number = Number.NaN;

  if (typeof value === "number") {
    score = value;
  } else if (typeof value === "string" && value.trim() !== "") {
    score = Number(value);
  }

  if (!Number.isFinite(score) || score <= 0) {
    return null;
  }

  for (const band of GOOGLE_SECOPS_RISK_SCORE_BANDS) {
    if (score >= band.minimum) {
      return band.severity;
    }
  }

  return null;
}

function firstGrade(
  values: Array<JSONValue>,
  grade: (value: JSONValue) => OcsfSeverity | null,
): OcsfSeverity | null {
  for (const value of values) {
    const severity: OcsfSeverity | null = grade(value);

    if (severity) {
      return severity;
    }
  }

  return null;
}

/*
 * Where a detection's severity lives depends on who wrote the rule.
 *
 *   1. detection[].severity — Google grades its own curated rules (Applied
 *      Threat Intelligence, the curated rule sets) here.
 *   2. The Collection's own severity — SOAR alerts and webhook bodies.
 *   3. detection[].ruleLabels "severity" — a custom YARA-L rule's
 *      `meta: severity = "High"`. Google leaves detection[].severity empty
 *      for these and returns the meta section as ruleLabels; it is the value
 *      the SecOps rules dashboard shows as the rule's severity.
 *   4. detection[].outcomes "risk_score" — a rule that sets no severity but
 *      scores its detections with $risk_score, graded with Google's
 *      published bands. Only the outcome counts: the bare riskScore field
 *      is filled with a default (40 when alerting, 15 when not) for rules
 *      that set no score, and grading that would invent a severity.
 *
 * The first two are the only places read before, and they are read first,
 * so a detection that already graded grades exactly as it did.
 */
function resolveSeverity(
  payload: JSONObject,
  detection: JSONObject | null,
): OcsfSeverity {
  const ruleLabels: JSONValue = detection
    ? readValue(detection, "ruleLabels") ?? readValue(detection, "rule_labels")
    : null;

  const outcomes: JSONValue = detection
    ? readValue(detection, "outcomes")
    : null;

  return (
    (detection && gradeSeverityText(readString(detection, "severity"))) ||
    gradeSeverityText(readString(payload, "severity")) ||
    firstGrade(readKeyedValues(ruleLabels, "severity"), gradeSeverityText) ||
    firstGrade(readKeyedValues(outcomes, "risk_score"), gradeRiskScore) ||
    OcsfSeverity.Unknown
  );
}

function readCollectionType(payload: JSONObject): string {
  return readString(payload, "type").toUpperCase();
}

function readTags(payload: JSONObject): Array<string> {
  const tags: JSONValue = readValue(payload, "tags");

  if (!Array.isArray(tags)) {
    return [];
  }

  return tags.filter((tag: JSONValue): boolean => {
    return typeof tag === "string" && tag.trim() !== "";
  }) as Array<string>;
}

/*
 * A readable label for a Collection that carries no rule name: the SOAR
 * source rule or system, then the tags Google set on the finding, then
 * the type itself ("Google SecOps telemetry alert").
 */
function describeNonRuleCollection(payload: JSONObject): string {
  const sourceRule: string =
    readString(payload, "soarAlertMetadata.sourceRule") ||
    readString(payload, "soar_alert_metadata.source_rule");

  if (sourceRule) {
    return sourceRule;
  }

  const sourceSystem: string = [
    readString(payload, "soarAlertMetadata.vendor") ||
      readString(payload, "soar_alert_metadata.vendor"),
    readString(payload, "soarAlertMetadata.product") ||
      readString(payload, "soar_alert_metadata.product"),
    readString(payload, "soarAlertMetadata.sourceSystem") ||
      readString(payload, "soar_alert_metadata.source_system"),
  ]
    .filter((part: string): boolean => {
      return part !== "";
    })
    .join(" ");

  if (sourceSystem) {
    return `${sourceSystem} alert`;
  }

  const tags: Array<string> = readTags(payload);

  if (tags.length > 0) {
    return tags.join(", ");
  }

  const type: string = readCollectionType(payload);

  /*
   * A rule detection with no rule detail keeps the generic label the
   * ingest path has always produced; only the other types get named.
   */
  if (type && !type.includes("RULE_DETECTION")) {
    return `Google SecOps ${type.toLowerCase().split("_").join(" ")}`;
  }

  return "";
}

export default class GoogleSecOpsAlertNormalizer {
  public static isGoogleSecOpsAlert(payload: JSONObject): boolean {
    const type: string = readCollectionType(payload);

    /*
     * The markers a rule detection carries. These are accepted with or
     * without an id because the ingest endpoint's dialect detection has
     * always recognized webhook bodies this way.
     */
    if (
      readDetectionEntry(payload) ||
      type.includes("RULE_DETECTION") ||
      readValue(payload, "collectionElements") ||
      readValue(payload, "collection_elements")
    ) {
      return true;
    }

    /*
     * The other documented Collection types have no detection entry. A
     * string id is required alongside the type so an unrelated object that
     * happens to carry a `type` key is still rejected.
     */
    const id: JSONValue = readValue(payload, "id");

    return (
      typeof id === "string" &&
      id.trim() !== "" &&
      COLLECTION_TYPES.includes(type)
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

    const severityName: OcsfSeverity = resolveSeverity(payload, detection);

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
      ruleName ||
      description ||
      describeNonRuleCollection(payload) ||
      "Google SecOps detection";

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
      statusName:
        readString(payload, "detection.alertState") ||
        readString(payload, "detection.alert_state") ||
        "",
      message,
      vendorName: GOOGLE_SECOPS_VENDOR_NAME,
      productName: GOOGLE_SECOPS_PRODUCT_NAME,
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

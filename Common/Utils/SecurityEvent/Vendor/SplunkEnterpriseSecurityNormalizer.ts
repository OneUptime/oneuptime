import { JSONObject, JSONValue } from "../../../Types/JSON";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity, {
  OcsfSeverityId,
  normalizeOcsfSeverity,
} from "../../../Types/SecurityEvent/OcsfSeverity";
import { ocsfCategoryForClassUid } from "../../../Types/SecurityEvent/OcsfEventClass";
import {
  buildObservables,
  contentHashEventUid,
  flattenPayload,
  parseEventTime,
  readValue,
} from "../NormalizerHelpers";
import {
  MitreReferences,
  collectScalarStrings,
  extractMitreReferences,
  isIpAddress,
  prettifyToken,
  readAllStrings,
  readFirstNumber,
  readFirstString,
} from "./VendorNormalizerHelpers";

function eventUid(payload: JSONObject): string {
  const explicitId: string = readFirstString(payload, [
    "event_id",
    "notable_event_id",
    "detection_id",
    "id",
  ]);
  if (explicitId) {
    return explicitId;
  }

  const rawDataAddress: string = readFirstString(payload, ["_cd"]);
  if (rawDataAddress) {
    const bucket: string = readFirstString(payload, ["_bkt"]);
    if (bucket) {
      return `${bucket}|${rawDataAddress}`;
    }
    const index: string = readFirstString(payload, ["index"]);
    const splunkServer: string = readFirstString(payload, ["splunk_server"]);
    if (index || splunkServer) {
      return `${index}|${splunkServer}|${rawDataAddress}`;
    }
  }
  return contentHashEventUid(payload);
}

const DETECTION_FINDING_CLASS_UID: number = 2004;

function isRiskEvent(payload: JSONObject): boolean {
  return Boolean(
    readFirstString(payload, ["risk_object", "riskObject"]) &&
      readFirstNumber(payload, ["risk_score", "riskScore"]) !== null,
  );
}

function severityFromRiskScore(score: number | null): OcsfSeverity | null {
  if (score === null || score <= 0) {
    return null;
  }

  if (score >= 100) {
    return OcsfSeverity.Critical;
  }

  if (score >= 80) {
    return OcsfSeverity.High;
  }

  if (score >= 60) {
    return OcsfSeverity.Medium;
  }

  if (score >= 40) {
    return OcsfSeverity.Low;
  }

  return OcsfSeverity.Informational;
}

function statusName(payload: JSONObject): string {
  const status: string = readFirstString(payload, [
    "status_label",
    "statusLabel",
    "status",
    "notable_status",
  ]);
  const statusCodes: Record<string, string> = {
    "0": "Unassigned",
    "1": "New",
    "2": "In Progress",
    "3": "Pending",
    "4": "Resolved",
    "5": "Closed",
  };

  return statusCodes[status] || prettifyToken(status);
}

function parseAnnotations(payload: JSONObject): Array<string> {
  const value: JSONValue = readValue(payload, "annotations");

  if (typeof value === "string") {
    try {
      return collectScalarStrings(JSON.parse(value) as JSONValue);
    } catch {
      return [value];
    }
  }

  return collectScalarStrings(value);
}

function summarizeMitre(payload: JSONObject): MitreReferences {
  const values: Array<string> = parseAnnotations(payload);

  for (const path of [
    "mitre_tactic_id",
    "mitre_tactic",
    "mitre_technique_id",
    "mitre_technique",
    "mitre_attack_id",
  ]) {
    values.push(...readAllStrings(payload, path));
  }

  return extractMitreReferences(values);
}

function eventTime(payload: JSONObject): Date | null {
  for (const path of [
    "_time",
    "time",
    "timestamp",
    "orig_time",
    "info_min_time",
  ]) {
    const parsed: Date | null = parseEventTime(readValue(payload, path));
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

export default class SplunkEnterpriseSecurityNormalizer {
  public static isSplunkEnterpriseSecurityEvent(payload: JSONObject): boolean {
    return Boolean(
      isRiskEvent(payload) ||
        readFirstString(payload, ["event_id", "notable_event_id"]) ||
        (readFirstString(payload, ["rule_name", "search_name"]) &&
          readFirstString(payload, ["urgency", "status", "owner"])),
    );
  }

  public static isSplunkNotableOrRiskEvent(payload: JSONObject): boolean {
    return this.isSplunkEnterpriseSecurityEvent(payload);
  }

  public static normalize(payload: JSONObject): NormalizedSecurityEvent {
    const riskEvent: boolean = isRiskEvent(payload);
    const riskScore: number | null = readFirstNumber(payload, [
      "risk_score",
      "riskScore",
      "calculated_risk_score",
    ]);
    const severityName: OcsfSeverity =
      normalizeOcsfSeverity(
        readFirstString(payload, ["urgency", "severity", "priority"]),
      ) ||
      severityFromRiskScore(riskScore) ||
      OcsfSeverity.Unknown;
    const { categoryUid, categoryName } = ocsfCategoryForClassUid(
      DETECTION_FINDING_CLASS_UID,
    );
    const riskObject: string = readFirstString(payload, [
      "risk_object",
      "riskObject",
    ]);
    const riskObjectType: string = readFirstString(payload, [
      "risk_object_type",
      "riskObjectType",
    ]).toLowerCase();
    const principalUser: string = readFirstString(payload, [
      "src_user",
      "user",
      "user_name",
    ]);
    const source: string = readFirstString(payload, [
      "src_ip",
      "src",
      "source_ip",
      "host",
    ]);
    const destination: string = readFirstString(payload, [
      "dest_ip",
      "dest",
      "destination_ip",
    ]);
    const targetUser: string =
      readFirstString(payload, ["dest_user", "target_user"]) ||
      (riskObjectType === "user" ? riskObject : "");
    const targetHost: string =
      readFirstString(payload, ["dest", "destination", "target_host"]) ||
      (riskObjectType === "system" ? riskObject : "");
    const targetIp: string = isIpAddress(destination) ? destination : "";
    const principalIp: string = isIpAddress(source) ? source : "";
    const principalHost: string = principalIp ? "" : source;
    const ruleName: string = readFirstString(payload, [
      "rule_name",
      "search_name",
      "detection_name",
      "source",
    ]);
    const description: string = readFirstString(payload, [
      "description",
      "message",
      "notable_title",
    ]);
    const mitre: MitreReferences = summarizeMitre(payload);

    const observables: Array<string> = [
      principalUser,
      principalHost,
      principalIp,
      targetUser,
      targetHost,
      targetIp,
      riskObject,
    ];

    for (const path of [
      "src",
      "src_ip",
      "dest",
      "dest_ip",
      "user",
      "src_user",
      "dest_user",
      "risk_object",
      "file_hash",
      "md5",
      "sha1",
      "sha256",
      "url",
      "domain",
    ]) {
      observables.push(...readAllStrings(payload, path));
    }

    return {
      time: eventTime(payload) || new Date(),
      eventUid: eventUid(payload),
      categoryUid,
      categoryName,
      classUid: DETECTION_FINDING_CLASS_UID,
      className: "Detection Finding",
      activityName: riskEvent ? "Update" : "Create",
      severityId: OcsfSeverityId[severityName],
      severityName,
      statusName: riskEvent ? "" : statusName(payload),
      message:
        description ||
        ruleName ||
        (riskObject
          ? `Risk modifier for ${riskObject}`
          : "Splunk notable event"),
      vendorName: "Splunk",
      productName: "Enterprise Security",
      ruleId: readFirstString(payload, [
        "rule_id",
        "correlation_search_id",
        "savedsearch_id",
        "detection_id",
      ]),
      ruleName,
      mitreTactics: mitre.tactics,
      mitreTechniques: mitre.techniques,
      principalUser,
      principalHost,
      principalIp,
      principalProcess: readFirstString(payload, [
        "process",
        "process_name",
        "process_path",
        "cmd_line",
      ]),
      targetUser,
      targetHost,
      targetIp,
      targetPort:
        readFirstNumber(payload, ["dest_port", "destination_port", "port"]) ||
        0,
      targetResource: riskObject,
      observables: buildObservables(observables),
      attributes: flattenPayload(payload),
    };
  }
}

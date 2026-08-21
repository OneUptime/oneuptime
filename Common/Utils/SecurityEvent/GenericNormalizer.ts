import { JSONObject } from "../../Types/JSON";
import NormalizedSecurityEvent from "../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity, {
  OcsfSeverityId,
  normalizeOcsfSeverity,
} from "../../Types/SecurityEvent/OcsfSeverity";
import {
  buildObservables,
  contentHashEventUid,
  flattenPayload,
  parseEventTime,
  readString,
  readValue,
} from "./NormalizerHelpers";
import { prettifyUdmEventType } from "./UdmNormalizer";

/*
 * Best-effort normalizer for security events that are neither OCSF nor
 * UDM — arbitrary vendor JSON forwarded from a SIEM, a webhook, or a
 * custom script. Field lookup walks common aliases; anything not
 * recognized still lands in `attributes`, so nothing is lost.
 */

const MESSAGE_FIELDS: Array<string> = [
  "message",
  "msg",
  "summary",
  "description",
  "title",
  "alert_name",
  "alertName",
  "name",
];

const SEVERITY_FIELDS: Array<string> = [
  "severity",
  "severity_name",
  "level",
  "priority",
  "risk_level",
  "riskLevel",
];

const TIME_FIELDS: Array<string> = [
  "timestamp",
  "time",
  "@timestamp",
  "event_time",
  "eventTime",
  "created_at",
  "createdAt",
  "date",
  "detected_at",
  "detectedAt",
];

const USER_FIELDS: Array<string> = [
  "user",
  "username",
  "user_name",
  "userName",
  "account",
  "principal",
  "actor",
];

const HOST_FIELDS: Array<string> = [
  "host",
  "hostname",
  "host_name",
  "computer",
  "computer_name",
  "device",
  "device_name",
  "machine",
];

const SOURCE_IP_FIELDS: Array<string> = [
  "source_ip",
  "src_ip",
  "sourceIp",
  "srcIp",
  "client_ip",
  "clientIp",
  "ip",
  "ip_address",
  "ipAddress",
];

const TARGET_IP_FIELDS: Array<string> = [
  "destination_ip",
  "dest_ip",
  "dst_ip",
  "destinationIp",
  "target_ip",
  "targetIp",
  "server_ip",
];

const TYPE_FIELDS: Array<string> = [
  "event_type",
  "eventType",
  "category",
  "type",
  "action",
];

const VENDOR_FIELDS: Array<string> = ["vendor", "vendor_name", "vendorName"];

const PRODUCT_FIELDS: Array<string> = [
  "product",
  "product_name",
  "productName",
  "source",
  "log_source",
  "logSource",
];

const RULE_NAME_FIELDS: Array<string> = [
  "rule",
  "rule_name",
  "ruleName",
  "signature",
  "detection",
];

const ID_FIELDS: Array<string> = [
  "id",
  "uid",
  "uuid",
  "event_id",
  "eventId",
  "alert_id",
  "alertId",
];

function readFirst(payload: JSONObject, fields: Array<string>): string {
  for (const field of fields) {
    const value: string = readString(payload, field);
    if (value) {
      return value;
    }
  }

  return "";
}

export default class GenericNormalizer {
  public static normalize(payload: JSONObject): NormalizedSecurityEvent {
    const severityName: OcsfSeverity =
      normalizeOcsfSeverity(readFirst(payload, SEVERITY_FIELDS)) ||
      OcsfSeverity.Unknown;

    let time: Date | null = null;
    for (const field of TIME_FIELDS) {
      time = parseEventTime(readValue(payload, field));
      if (time) {
        break;
      }
    }

    const typeText: string = readFirst(payload, TYPE_FIELDS);
    const className: string = typeText
      ? prettifyUdmEventType(typeText.replace(/[\s.-]+/g, "_"))
      : "Base Event";

    const principalUser: string = readFirst(payload, USER_FIELDS);
    const principalHost: string = readFirst(payload, HOST_FIELDS);
    const principalIp: string = readFirst(payload, SOURCE_IP_FIELDS);
    const targetIp: string = readFirst(payload, TARGET_IP_FIELDS);

    return {
      time: time || new Date(),
      eventUid:
        readFirst(payload, ID_FIELDS) || contentHashEventUid(payload),
      categoryUid: 0,
      categoryName: "Uncategorized",
      classUid: 0,
      className,
      activityName: "",
      severityId: OcsfSeverityId[severityName],
      severityName,
      statusName: readString(payload, "status"),
      message: readFirst(payload, MESSAGE_FIELDS) || "Security event",
      vendorName: readFirst(payload, VENDOR_FIELDS),
      productName: readFirst(payload, PRODUCT_FIELDS),
      ruleId: readString(payload, "rule_id") || readString(payload, "ruleId"),
      ruleName: readFirst(payload, RULE_NAME_FIELDS),
      mitreTactics: [],
      mitreTechniques: [],
      principalUser,
      principalHost,
      principalIp,
      principalProcess: readString(payload, "process"),
      targetUser: readString(payload, "target_user"),
      targetHost: readString(payload, "target_host"),
      targetIp,
      targetPort: 0,
      targetResource: readString(payload, "target"),
      observables: buildObservables([
        principalUser,
        principalHost,
        principalIp,
        targetIp,
      ]),
      attributes: flattenPayload(payload),
    };
  }
}

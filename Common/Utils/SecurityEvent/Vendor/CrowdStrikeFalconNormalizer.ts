import { JSONObject } from "../../../Types/JSON";
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
  extractMitreReferences,
  readAllStrings,
  readFirstNumber,
  readFirstString,
  readObjects,
  uniqueStrings,
} from "./VendorNormalizerHelpers";

const DETECTION_FINDING_CLASS_UID: number = 2004;

function severityFromScore(score: number | null): OcsfSeverity | null {
  if (score === null || score <= 0) {
    return null;
  }

  if (score < 20) {
    return OcsfSeverity.Informational;
  }

  if (score < 40) {
    return OcsfSeverity.Low;
  }

  if (score < 60) {
    return OcsfSeverity.Medium;
  }

  if (score < 80) {
    return OcsfSeverity.High;
  }

  return OcsfSeverity.Critical;
}

function readSeverity(payload: JSONObject): OcsfSeverity {
  const severityText: string = readFirstString(payload, [
    "severity_name",
    "severity_display_name",
    "max_severity_displayname",
    "max_severity_name",
  ]);

  return (
    normalizeOcsfSeverity(severityText) ||
    severityFromScore(
      readFirstNumber(payload, ["severity", "max_severity", "severity_score"]),
    ) ||
    OcsfSeverity.Unknown
  );
}

interface FalconEntitySummary {
  user: string;
  host: string;
  localIp: string;
  process: string;
  targetResource: string;
  observables: Array<string>;
  mitre: MitreReferences;
}

function summarizeEntities(payload: JSONObject): FalconEntitySummary {
  const behaviors: Array<JSONObject> = readObjects(payload, "behaviors");
  const users: Array<string> = [
    readFirstString(payload, [
      "user_name",
      "username",
      "user.id",
      "user.name",
      "device.last_logged_on_user",
    ]),
  ];
  const hosts: Array<string> = [
    readFirstString(payload, [
      "device.hostname",
      "hostname",
      "host_name",
      "computer_name",
    ]),
  ];
  const localIps: Array<string> = [
    readFirstString(payload, [
      "device.local_ip",
      "local_ip",
      "host.local_ip",
      "source_ip",
    ]),
  ];
  const processes: Array<string> = [
    readFirstString(payload, [
      "command_line",
      "cmdline",
      "process.command_line",
      "filename",
    ]),
  ];
  const resources: Array<string> = [
    readFirstString(payload, [
      "device.device_id",
      "device.id",
      "agent_id",
      "aggregate_id",
    ]),
  ];
  const observableValues: Array<string> = [];
  const mitreValues: Array<string> = [];

  for (const path of [
    "tactic_id",
    "technique_id",
    "mitre_tactic_id",
    "mitre_technique_id",
  ]) {
    mitreValues.push(...readAllStrings(payload, path));
  }

  for (const path of [
    "domain_name",
    "remote_ip",
    "external_ip",
    "sha256",
    "sha1",
    "md5",
    "file_path",
  ]) {
    observableValues.push(...readAllStrings(payload, path));
  }

  for (const behavior of behaviors) {
    users.push(readFirstString(behavior, ["user_name", "username"]));
    hosts.push(readFirstString(behavior, ["hostname", "device.hostname"]));
    localIps.push(readFirstString(behavior, ["local_ip", "source_ip"]));
    processes.push(
      readFirstString(behavior, ["cmdline", "command_line", "filename"]),
    );

    for (const path of ["tactic_id", "technique_id"]) {
      mitreValues.push(...readAllStrings(behavior, path));
    }

    for (const path of [
      "domain_name",
      "remote_ip",
      "sha256",
      "sha1",
      "md5",
      "filename",
      "filepath",
    ]) {
      observableValues.push(...readAllStrings(behavior, path));
    }
  }

  const user: string = uniqueStrings(users)[0] || "";
  const host: string = uniqueStrings(hosts)[0] || "";
  const localIp: string = uniqueStrings(localIps)[0] || "";
  const process: string = uniqueStrings(processes)[0] || "";
  const targetResource: string = uniqueStrings(resources)[0] || "";

  return {
    user,
    host,
    localIp,
    process,
    targetResource,
    observables: buildObservables([
      ...users,
      ...hosts,
      ...localIps,
      ...observableValues,
    ]),
    mitre: extractMitreReferences(mitreValues),
  };
}

function firstBehaviorDescription(payload: JSONObject): string {
  const behaviors: Array<JSONObject> = readObjects(payload, "behaviors");
  return behaviors.length > 0
    ? readFirstString(behaviors[0] as JSONObject, [
        "description",
        "display_name",
        "scenario",
      ])
    : "";
}

export default class CrowdStrikeFalconNormalizer {
  public static isCrowdStrikeFalconEvent(payload: JSONObject): boolean {
    const vendor: string = readFirstString(payload, [
      "vendor",
      "vendor_name",
      "metadata.vendor_name",
    ]).toLowerCase();
    const product: string = readFirstString(payload, [
      "product",
      "product_name",
    ]).toLowerCase();

    return Boolean(
      readFirstString(payload, [
        "composite_id",
        "detection_id",
        "aggregate_id",
      ]) ||
        readValue(payload, "behaviors") ||
        vendor.includes("crowdstrike") ||
        product.includes("falcon"),
    );
  }

  public static isCrowdStrikeFalconAlert(payload: JSONObject): boolean {
    return this.isCrowdStrikeFalconEvent(payload);
  }

  public static normalize(payload: JSONObject): NormalizedSecurityEvent {
    const severityName: OcsfSeverity = readSeverity(payload);
    const entities: FalconEntitySummary = summarizeEntities(payload);
    const time: Date | null = parseEventTime(
      readValue(payload, "timestamp") ??
        readValue(payload, "created_timestamp") ??
        readValue(payload, "first_behavior") ??
        readValue(payload, "first_behavior_time") ??
        readValue(payload, "last_behavior"),
    );
    const { categoryUid, categoryName } = ocsfCategoryForClassUid(
      DETECTION_FINDING_CLASS_UID,
    );

    const displayName: string = readFirstString(payload, [
      "display_name",
      "name",
      "scenario",
      "description",
    ]);
    const ruleName: string = readFirstString(payload, [
      "aggregation_rule_name",
      "rule_name",
      "pattern_name",
      "scenario",
      "display_name",
    ]);

    return {
      time: time || new Date(),
      eventUid:
        readFirstString(payload, [
          "composite_id",
          "id",
          "detection_id",
          "aggregate_id",
        ]) || contentHashEventUid(payload),
      categoryUid,
      categoryName,
      classUid: DETECTION_FINDING_CLASS_UID,
      className: "Detection Finding",
      activityName: "Create",
      severityId: OcsfSeverityId[severityName],
      severityName,
      statusName: readFirstString(payload, [
        "status",
        "state",
        "disposition_name",
      ]),
      message:
        displayName ||
        firstBehaviorDescription(payload) ||
        "CrowdStrike Falcon alert",
      vendorName: "CrowdStrike",
      productName: "Falcon",
      ruleId: readFirstString(payload, [
        "aggregation_rule_id",
        "rule_id",
        "pattern_id",
        "cms_rule_id",
      ]),
      ruleName,
      mitreTactics: entities.mitre.tactics,
      mitreTechniques: entities.mitre.techniques,
      principalUser: entities.user,
      principalHost: "",
      principalIp: "",
      principalProcess: entities.process,
      targetUser: "",
      targetHost: entities.host,
      targetIp: entities.localIp,
      targetPort: 0,
      targetResource: entities.targetResource,
      observables: entities.observables,
      attributes: flattenPayload(payload),
    };
  }
}

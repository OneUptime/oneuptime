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
  prettifyToken,
  readAllStrings,
  readFirstString,
  readObject,
  readObjects,
  uniqueStrings,
} from "./VendorNormalizerHelpers";

const DETECTION_FINDING_CLASS_UID: number = 2004;
const VULNERABILITY_FINDING_CLASS_UID: number = 2002;
const COMPLIANCE_FINDING_CLASS_UID: number = 2003;

const SCC_TACTIC_IDS: Record<string, string> = {
  RECONNAISSANCE: "TA0043",
  RESOURCE_DEVELOPMENT: "TA0042",
  INITIAL_ACCESS: "TA0001",
  EXECUTION: "TA0002",
  PERSISTENCE: "TA0003",
  PRIVILEGE_ESCALATION: "TA0004",
  DEFENSE_EVASION: "TA0005",
  CREDENTIAL_ACCESS: "TA0006",
  DISCOVERY: "TA0007",
  LATERAL_MOVEMENT: "TA0008",
  COLLECTION: "TA0009",
  COMMAND_AND_CONTROL: "TA0011",
  EXFILTRATION: "TA0010",
  IMPACT: "TA0040",
};

interface SccPayload {
  finding: JSONObject;
  resource: JSONObject | null;
  stateChange: string;
}

function unwrapPayload(payload: JSONObject): SccPayload {
  const finding: JSONObject | null = readObject(payload, "finding");

  return {
    finding: finding || payload,
    resource: readObject(payload, "resource"),
    stateChange: readFirstString(payload, ["stateChange", "state_change"]),
  };
}

function classUidForFinding(finding: JSONObject): number {
  const findingClass: string = readFirstString(finding, [
    "findingClass",
    "finding_class",
  ]).toUpperCase();

  if (findingClass === "VULNERABILITY") {
    return VULNERABILITY_FINDING_CLASS_UID;
  }

  if (
    findingClass === "MISCONFIGURATION" ||
    findingClass === "POSTURE_VIOLATION"
  ) {
    return COMPLIANCE_FINDING_CLASS_UID;
  }

  return DETECTION_FINDING_CLASS_UID;
}

function classNameForUid(classUid: number): string {
  if (classUid === VULNERABILITY_FINDING_CLASS_UID) {
    return "Vulnerability Finding";
  }

  if (classUid === COMPLIANCE_FINDING_CLASS_UID) {
    return "Compliance Finding";
  }

  return "Detection Finding";
}

function activityForFinding(state: string, stateChange: string): string {
  switch (stateChange.toUpperCase()) {
    case "ADDED":
      return "Create";
    case "CHANGED":
      return "Update";
    case "REMOVED":
      return "Close";
    default:
      return state.toUpperCase() === "INACTIVE" ? "Close" : "Create";
  }
}

function summarizeMitre(finding: JSONObject): MitreReferences {
  const mitreAttack: JSONValue =
    readValue(finding, "mitreAttack") ?? readValue(finding, "mitre_attack");
  const values: Array<string> = collectScalarStrings(mitreAttack);

  for (const path of [
    "sourceProperties.mitre_tactic_id",
    "sourceProperties.mitre_technique_id",
    "sourceProperties.mitre_attack",
  ]) {
    values.push(...readAllStrings(finding, path));
  }

  const extracted: MitreReferences = extractMitreReferences(values);
  const tactics: Array<string> = [...extracted.tactics];

  for (const value of values) {
    const mapped: string | undefined =
      SCC_TACTIC_IDS[
        value
          .trim()
          .toUpperCase()
          .replace(/[\s-]+/g, "_")
      ];

    if (mapped) {
      tactics.push(mapped);
    }
  }

  return {
    tactics: uniqueStrings(tactics),
    techniques: extracted.techniques,
  };
}

interface SccEntities {
  principalUser: string;
  principalIp: string;
  targetHost: string;
  targetIp: string;
  targetResource: string;
  observables: Array<string>;
}

function summarizeEntities(
  finding: JSONObject,
  resource: JSONObject | null,
): SccEntities {
  const principalUser: string = readFirstString(finding, [
    "access.principalEmail",
    "access.principal_email",
    "sourceProperties.principalEmail",
    "sourceProperties.principal_email",
  ]);
  const principalIp: string = readFirstString(finding, [
    "access.callerIp",
    "access.caller_ip",
    "sourceProperties.sourceIp",
    "sourceProperties.source_ip",
  ]);
  const targetResource: string =
    readFirstString(finding, ["resourceName", "resource_name"]) ||
    (resource ? readFirstString(resource, ["name"]) : "");
  const targetHost: string = resource
    ? readFirstString(resource, [
        "displayName",
        "display_name",
        "gcpMetadata.projectDisplayName",
        "gcp_metadata.project_display_name",
      ])
    : "";

  const values: Array<string> = [
    principalUser,
    principalIp,
    targetHost,
    targetResource,
  ];

  for (const path of [
    "indicator.ipAddresses",
    "indicator.ip_addresses",
    "indicator.domains",
    "indicator.uris",
    "sourceProperties.sourceIp",
    "sourceProperties.destinationIp",
    "sourceProperties.source_ip",
    "sourceProperties.destination_ip",
  ]) {
    values.push(...readAllStrings(finding, path));
  }

  for (const path of ["connections", "files", "exfiltration.sources"]) {
    for (const entry of readObjects(finding, path)) {
      values.push(...collectScalarStrings(entry));
    }
  }

  const targetIp: string =
    readFirstString(finding, [
      "connections.destinationIp",
      "connections.destination_ip",
      "indicator.ipAddresses",
      "indicator.ip_addresses",
    ]) || "";

  return {
    principalUser,
    principalIp,
    targetHost,
    targetIp,
    targetResource,
    observables: buildObservables(values),
  };
}

export default class GoogleSecurityCommandCenterNormalizer {
  public static isGoogleSecurityCommandCenterEvent(
    payload: JSONObject,
  ): boolean {
    const unwrapped: SccPayload = unwrapPayload(payload);
    const finding: JSONObject = unwrapped.finding;
    const canonicalName: string = readFirstString(finding, [
      "canonicalName",
      "canonical_name",
      "name",
    ]);

    return Boolean(
      (canonicalName.includes("/sources/") &&
        canonicalName.includes("/findings/")) ||
        (readFirstString(finding, ["resourceName", "resource_name"]) &&
          readFirstString(finding, ["category"]) &&
          readFirstString(finding, ["state"])),
    );
  }

  public static isGoogleSecurityCommandCenterFinding(
    payload: JSONObject,
  ): boolean {
    return this.isGoogleSecurityCommandCenterEvent(payload);
  }

  public static normalize(payload: JSONObject): NormalizedSecurityEvent {
    const unwrapped: SccPayload = unwrapPayload(payload);
    const finding: JSONObject = unwrapped.finding;
    const classUid: number = classUidForFinding(finding);
    const { categoryUid, categoryName } = ocsfCategoryForClassUid(classUid);
    const severityName: OcsfSeverity =
      normalizeOcsfSeverity(
        readFirstString(finding, ["severity"]).replace(
          /_?SEVERITY_UNSPECIFIED/i,
          "UNKNOWN",
        ),
      ) || OcsfSeverity.Unknown;
    const time: Date | null = parseEventTime(
      readValue(finding, "eventTime") ??
        readValue(finding, "event_time") ??
        readValue(finding, "createTime") ??
        readValue(finding, "create_time"),
    );
    const state: string = readFirstString(finding, ["state"]);
    const category: string = readFirstString(finding, ["category"]);
    const name: string = readFirstString(finding, [
      "canonicalName",
      "canonical_name",
      "name",
    ]);
    const description: string = readFirstString(finding, [
      "description",
      "sourceProperties.description",
      "sourceProperties.Description",
      "sourceProperties.explanation",
      "sourceProperties.Explanation",
    ]);
    const entities: SccEntities = summarizeEntities(
      finding,
      unwrapped.resource,
    );
    const mitre: MitreReferences = summarizeMitre(finding);

    return {
      time: time || new Date(),
      eventUid: name || contentHashEventUid(payload),
      categoryUid,
      categoryName,
      classUid,
      className: classNameForUid(classUid),
      activityName: activityForFinding(state, unwrapped.stateChange),
      severityId: OcsfSeverityId[severityName],
      severityName,
      statusName: state,
      message:
        description ||
        prettifyToken(category) ||
        "Security Command Center finding",
      vendorName: "Google",
      productName: "Security Command Center",
      ruleId:
        readFirstString(finding, [
          "sourceProperties.ruleId",
          "sourceProperties.rule_id",
        ]) || category,
      ruleName: prettifyToken(category),
      mitreTactics: mitre.tactics,
      mitreTechniques: mitre.techniques,
      principalUser: entities.principalUser,
      principalHost: "",
      principalIp: entities.principalIp,
      principalProcess: "",
      targetUser: "",
      targetHost: entities.targetHost,
      targetIp: entities.targetIp,
      targetPort: 0,
      targetResource: entities.targetResource,
      observables: entities.observables,
      attributes: flattenPayload(payload),
    };
  }
}

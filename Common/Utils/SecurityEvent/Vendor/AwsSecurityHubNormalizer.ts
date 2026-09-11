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
  readNumber,
  readString,
  readValue,
} from "../NormalizerHelpers";

const VULNERABILITY_FINDING_CLASS_UID: number = 2002;
const COMPLIANCE_FINDING_CLASS_UID: number = 2003;
const DETECTION_FINDING_CLASS_UID: number = 2004;

function objectValue(value: JSONValue): JSONObject | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JSONObject;
  }

  return null;
}

function objectArray(value: JSONValue): Array<JSONObject> {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: Array<JSONObject> = [];
  for (const item of value) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      result.push(item as JSONObject);
    }
  }
  return result;
}

/*
 * EventBridge delivers ASFF records under detail.findings, while polling
 * integrations normally hand the normalizer a finding directly. Accept both
 * shapes so callers do not have to know how the finding reached OneUptime.
 */
function unwrapFinding(payload: JSONObject): JSONObject {
  const detail: JSONObject | null = objectValue(readValue(payload, "detail"));

  if (detail) {
    const detailFindings: Array<JSONObject> = objectArray(
      readValue(detail, "findings"),
    );

    if (detailFindings[0]) {
      return detailFindings[0];
    }

    if (readString(detail, "SchemaVersion")) {
      return detail;
    }
  }

  const findings: Array<JSONObject> = objectArray(
    readValue(payload, "Findings") ?? readValue(payload, "findings"),
  );

  return findings[0] || payload;
}

function awsSeverityFromScore(score: number | null): OcsfSeverity | null {
  if (score === null || score < 0 || score > 100) {
    return null;
  }

  if (score >= 90) {
    return OcsfSeverity.Critical;
  }

  if (score >= 70) {
    return OcsfSeverity.High;
  }

  if (score >= 40) {
    return OcsfSeverity.Medium;
  }

  if (score >= 1) {
    return OcsfSeverity.Low;
  }

  return OcsfSeverity.Informational;
}

function readSeverity(finding: JSONObject): OcsfSeverity {
  const textCandidates: Array<string> = [
    readString(finding, "Severity.Label"),
    readString(finding, "FindingProviderFields.Severity.Label"),
    readString(finding, "Severity.Original"),
    readString(finding, "FindingProviderFields.Severity.Original"),
  ];

  for (const candidate of textCandidates) {
    const severity: OcsfSeverity | null = normalizeOcsfSeverity(candidate);

    if (severity) {
      return severity;
    }
  }

  return (
    awsSeverityFromScore(readNumber(finding, "Severity.Normalized")) ||
    awsSeverityFromScore(
      readNumber(finding, "FindingProviderFields.Severity.Normalized"),
    ) ||
    OcsfSeverity.Unknown
  );
}

function findingClass(finding: JSONObject): {
  classUid: number;
  className: string;
} {
  if (readString(finding, "Compliance.Status")) {
    return {
      classUid: COMPLIANCE_FINDING_CLASS_UID,
      className: "Compliance Finding",
    };
  }

  if (objectArray(readValue(finding, "Vulnerabilities")).length > 0) {
    return {
      classUid: VULNERABILITY_FINDING_CLASS_UID,
      className: "Vulnerability Finding",
    };
  }

  return {
    classUid: DETECTION_FINDING_CLASS_UID,
    className: "Detection Finding",
  };
}

function productName(finding: JSONObject): string {
  const explicit: string = readString(finding, "ProductName");

  if (explicit) {
    return explicit;
  }

  const productArn: string = readString(finding, "ProductArn").toLowerCase();

  if (productArn.includes("/guardduty")) {
    return "Amazon GuardDuty";
  }

  return "AWS Security Hub";
}

function firstResource(
  resources: Array<JSONObject>,
  role: "actor" | "target",
): JSONObject | null {
  return (
    resources.find((resource: JSONObject): boolean => {
      return readString(resource, "ResourceRole").toLowerCase() === role;
    }) || null
  );
}

function firstAffectedResource(finding: JSONObject): string {
  const affected: JSONObject | null = objectValue(
    readValue(finding, "Action.AwsApiCallAction.AffectedResources"),
  );

  if (!affected) {
    return "";
  }

  return Object.keys(affected)[0] || "";
}

function extractMitreIds(
  attributes: JSONObject,
  kind: "tactic" | "technique",
): Array<string> {
  const ids: Array<string> = [];
  const pattern: RegExp =
    kind === "tactic" ? /\bTA\d{4}\b/gi : /\bT\d{4}(?:\.\d{3})?\b/gi;

  for (const [key, rawValue] of Object.entries(attributes)) {
    if (!key.toLowerCase().includes(kind)) {
      continue;
    }

    const matches: RegExpMatchArray | null = String(rawValue).match(pattern);

    if (matches) {
      ids.push(
        ...matches.map((match: string): string => {
          return match.toUpperCase();
        }),
      );
    }
  }

  return buildObservables(ids);
}

function collectThreatObservables(finding: JSONObject): Array<string> {
  const result: Array<string> = [];

  for (const indicator of objectArray(
    readValue(finding, "ThreatIntelIndicators"),
  )) {
    result.push(readString(indicator, "Value"));
  }

  for (const threat of objectArray(readValue(finding, "Threats"))) {
    result.push(readString(threat, "Name"));

    for (const filePath of objectArray(readValue(threat, "FilePaths"))) {
      result.push(
        readString(filePath, "Hash"),
        readString(filePath, "FileName"),
        readString(filePath, "ResourceId"),
      );
    }
  }

  return result;
}

export default class AwsSecurityHubNormalizer {
  public static isAwsSecurityHubFinding(payload: JSONObject): boolean {
    const finding: JSONObject = unwrapFinding(payload);
    const detailType: string = readString(payload, "detail-type").toLowerCase();
    const productArn: string = readString(finding, "ProductArn").toLowerCase();

    return Boolean(
      detailType.includes("security hub findings") ||
        (readString(finding, "SchemaVersion") &&
          readString(finding, "Id") &&
          (productArn.includes(":securityhub:") ||
            (readString(finding, "AwsAccountId") &&
              readString(finding, "GeneratorId")))),
    );
  }

  public static normalize(payload: JSONObject): NormalizedSecurityEvent {
    const finding: JSONObject = unwrapFinding(payload);
    const resources: Array<JSONObject> = objectArray(
      readValue(finding, "Resources"),
    );
    const actorResource: JSONObject | null = firstResource(resources, "actor");
    const targetResourceObject: JSONObject | null =
      firstResource(resources, "target") || resources[0] || null;

    const principalUser: string =
      readString(finding, "Resource.Details.AwsIamAccessKey.PrincipalName") ||
      readString(finding, "Resource.Details.AwsIamAccessKey.UserName") ||
      (actorResource ? readString(actorResource, "Id") : "");
    const principalHost: string =
      readString(finding, "Network.SourceDomain") ||
      readString(
        finding,
        "Action.NetworkConnectionAction.RemoteIpDetails.Organization.AsnOrg",
      ) ||
      "";
    const principalIp: string =
      readString(finding, "Network.SourceIpV4") ||
      readString(finding, "Network.SourceIpV6") ||
      readString(
        finding,
        "Action.NetworkConnectionAction.RemoteIpDetails.IpAddressV4",
      ) ||
      readString(
        finding,
        "Action.PortProbeAction.PortProbeDetails.RemoteIpDetails.IpAddressV4",
      );
    const targetHost: string =
      readString(finding, "Network.DestinationDomain") || "";
    const targetIp: string =
      readString(finding, "Network.DestinationIpV4") ||
      readString(finding, "Network.DestinationIpV6") ||
      readString(
        finding,
        "Action.NetworkConnectionAction.LocalIpDetails.IpAddressV4",
      );
    const targetPort: number =
      readNumber(finding, "Network.DestinationPort") ||
      readNumber(
        finding,
        "Action.NetworkConnectionAction.LocalPortDetails.Port",
      ) ||
      readNumber(
        finding,
        "Action.PortProbeAction.PortProbeDetails.LocalPortDetails.Port",
      ) ||
      0;
    const targetResource: string =
      (targetResourceObject ? readString(targetResourceObject, "Id") : "") ||
      firstAffectedResource(finding);

    const severityName: OcsfSeverity = readSeverity(finding);
    const classification: { classUid: number; className: string } =
      findingClass(finding);
    const { categoryUid, categoryName } = ocsfCategoryForClassUid(
      classification.classUid,
    );
    const attributes: JSONObject = flattenPayload(payload);
    const time: Date | null = parseEventTime(
      readValue(finding, "LastObservedAt") ??
        readValue(finding, "UpdatedAt") ??
        readValue(finding, "CreatedAt") ??
        readValue(finding, "FirstObservedAt"),
    );
    const findingId: string = readString(finding, "Id");
    const productArn: string = readString(finding, "ProductArn");

    return {
      time: time || new Date(),
      eventUid:
        findingId && productArn
          ? `${productArn}|${findingId}`
          : findingId || contentHashEventUid(payload),
      categoryUid,
      categoryName,
      classUid: classification.classUid,
      className: classification.className,
      activityName: "Create",
      severityId: OcsfSeverityId[severityName],
      severityName,
      statusName:
        readString(finding, "Workflow.Status") ||
        readString(finding, "Compliance.Status") ||
        readString(finding, "RecordState"),
      message:
        readString(finding, "Title") ||
        readString(finding, "Description") ||
        "AWS Security Hub finding",
      vendorName: readString(finding, "CompanyName") || "Amazon Web Services",
      productName: productName(finding),
      ruleId: readString(finding, "GeneratorId"),
      ruleName:
        readString(finding, "Title") ||
        readString(finding, "FindingProviderFields.Types") ||
        readString(finding, "Types"),
      mitreTactics: extractMitreIds(attributes, "tactic"),
      mitreTechniques: extractMitreIds(attributes, "technique"),
      principalUser,
      principalHost,
      principalIp,
      principalProcess:
        readString(finding, "Process.Name") ||
        readString(finding, "Process.Path"),
      targetUser: "",
      targetHost,
      targetIp,
      targetPort,
      targetResource,
      observables: buildObservables([
        principalUser,
        principalHost,
        principalIp,
        targetHost,
        targetIp,
        targetResource,
        ...resources.map((resource: JSONObject): string => {
          return readString(resource, "Id");
        }),
        ...collectThreatObservables(finding),
      ]),
      attributes,
    };
  }
}

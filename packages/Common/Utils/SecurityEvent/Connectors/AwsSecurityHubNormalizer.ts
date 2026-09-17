import { JSONObject, JSONValue } from "../../../Types/JSON";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity, {
  OcsfSeverityId,
  normalizeOcsfSeverity,
} from "../../../Types/SecurityEvent/OcsfSeverity";
import { ocsfCategoryForClassUid } from "../../../Types/SecurityEvent/OcsfEventClass";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import {
  buildObservables,
  contentHashEventUid,
  flattenPayload,
  parseEventTime,
  readNumber,
  readString,
  readStringArray,
  readValue,
} from "../NormalizerHelpers";

/*
 * AWS Security Hub finding (AWS Security Finding Format, ASFF) -> OCSF
 * Compliance Finding (class 2003) when the finding carries a Compliance
 * object (a control check), otherwise Detection Finding (class 2004).
 *
 * The payload shape is the AwsSecurityFinding object returned by
 * GetFindings, i.e. ASFF:
 * https://docs.aws.amazon.com/securityhub/latest/userguide/securityhub-findings-format-syntax.html
 * Fields read here, with their documented values:
 *  - Id (product-specific finding id, an ARN for AWS-generated findings),
 *    GeneratorId, ProductArn, ProductName, CompanyName, AwsAccountId, Region
 *  - CreatedAt / UpdatedAt / FirstObservedAt / LastObservedAt (ISO 8601)
 *  - Severity.Label: INFORMATIONAL | LOW | MEDIUM | HIGH | CRITICAL;
 *    Severity.Normalized 0..100 maps to those labels as 0, 1-39, 40-69,
 *    70-89, 90-100 (API reference, Severity)
 *  - Types[]: "{namespace}/{category}/{classifier}"; the TTPs namespace's
 *    categories align with the MITRE ATT&CK enterprise tactics
 *    (asff-required-attributes, Types)
 *  - Compliance.Status: PASSED | WARNING | FAILED | NOT_AVAILABLE
 *  - Workflow.Status: NEW | NOTIFIED | RESOLVED | SUPPRESSED; the retired
 *    WorkflowState is read as a fallback
 *  - Resources[]: Type, Id, Region, Tags, Details
 *  - Network (retired but still delivered): SourceIpV4/V6,
 *    DestinationIpV4/V6, DestinationPort, Source/DestinationDomain
 *  - Process: Name, Path; Malware[]: Name, Path; ThreatIntelIndicators[]:
 *    Type, Value; UserDefinedFields
 *
 * Pure and isomorphic on purpose — this file imports only from
 * Common/Types and Common/Utils so it runs unchanged in the server, in
 * tests and in the browser if the dashboard ever previews raw findings.
 */

export const AWS_SECURITY_HUB_DETECTION_CLASS_UID: number = 2004;
export const AWS_SECURITY_HUB_DETECTION_CLASS_NAME: string =
  "Detection Finding";
export const AWS_SECURITY_HUB_COMPLIANCE_CLASS_UID: number = 2003;
export const AWS_SECURITY_HUB_COMPLIANCE_CLASS_NAME: string =
  "Compliance Finding";

/*
 * ASFF's TTPs categories are MITRE ATT&CK enterprise tactic names;
 * NormalizedSecurityEvent.mitreTactics stores ATT&CK ids ("TA0001") so
 * rows from every source join on the same key. Keyed by the name with
 * everything but letters removed, lowercased.
 */
export const AWS_SECURITY_HUB_TACTIC_IDS: Record<string, string> = {
  reconnaissance: "TA0043",
  resourcedevelopment: "TA0042",
  initialaccess: "TA0001",
  execution: "TA0002",
  persistence: "TA0003",
  privilegeescalation: "TA0004",
  defenseevasion: "TA0005",
  credentialaccess: "TA0006",
  discovery: "TA0007",
  lateralmovement: "TA0008",
  collection: "TA0009",
  exfiltration: "TA0010",
  commandandcontrol: "TA0011",
  impact: "TA0040",
};

const TTPS_NAMESPACE: string = "TTPs";

function definition(): SecurityEventConnectorDefinition {
  const found: SecurityEventConnectorDefinition | undefined =
    getSecurityEventConnectorDefinition(
      SecurityEventConnectorProvider.AwsSecurityHub,
    );

  if (!found) {
    /*
     * The catalog is a static list that always carries this provider; the
     * throw only exists so a future catalog edit cannot silently attribute
     * events to an empty vendor and break the dedupe scope.
     */
    throw new Error(
      "AWS Security Hub is missing from SecurityEventConnectorCatalog.",
    );
  }

  return found;
}

function isObject(value: JSONValue): value is JSONObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function objectArray(value: JSONValue): Array<JSONObject> {
  if (!Array.isArray(value)) {
    return [];
  }

  return (value as Array<JSONValue>).filter(isObject);
}

function uniqueNonEmpty(values: Array<string>): Array<string> {
  const seen: Set<string> = new Set<string>();
  const result: Array<string> = [];

  for (const value of values) {
    const trimmed: string = value.trim();

    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

function mapTactic(name: string): string {
  const key: string = name.replace(/[^A-Za-z]/g, "").toLowerCase();

  return AWS_SECURITY_HUB_TACTIC_IDS[key] || name.trim();
}

/*
 * Severity from Label, then from the deprecated Normalized score using
 * the documented ranges, then Unknown. Label is what Security Hub itself
 * populates on every finding, so the score path only serves partner
 * products that sent a score alone.
 */
function severityOf(raw: JSONObject): OcsfSeverity {
  const fromLabel: OcsfSeverity | null = normalizeOcsfSeverity(
    readString(raw, "Severity.Label"),
  );

  if (fromLabel) {
    return fromLabel;
  }

  const normalized: number | null = readNumber(raw, "Severity.Normalized");

  if (normalized === null || normalized < 0) {
    return OcsfSeverity.Unknown;
  }

  if (normalized === 0) {
    return OcsfSeverity.Informational;
  }

  if (normalized < 40) {
    return OcsfSeverity.Low;
  }

  if (normalized < 70) {
    return OcsfSeverity.Medium;
  }

  if (normalized < 90) {
    return OcsfSeverity.High;
  }

  return OcsfSeverity.Critical;
}

interface MitreReferences {
  tactics: Array<string>;
  techniques: Array<string>;
}

/*
 * Types entries under the TTPs namespace: "TTPs/{tactic}/{classifier}".
 * The tactic maps to its ATT&CK id. The classifier is the product's own
 * technique-level label (GuardDuty's "UnauthorizedAccess:EC2-SSHBruteForce",
 * for example) rather than an ATT&CK technique id — ASFF defines no
 * classifiers under TTPs — so it is kept verbatim: it is still the most
 * specific "what happened" the finding offers, and it is searchable.
 */
function mitreOf(types: Array<string>): MitreReferences {
  const tactics: Array<string> = [];
  const techniques: Array<string> = [];

  for (const type of types) {
    const segments: Array<string> = type.split("/").map((segment: string) => {
      return segment.trim();
    });

    if (segments[0] !== TTPS_NAMESPACE) {
      continue;
    }

    if (segments[1]) {
      tactics.push(mapTactic(segments[1]));
    }

    if (segments[2]) {
      techniques.push(segments.slice(2).join("/"));
    }
  }

  return {
    tactics: uniqueNonEmpty(tactics),
    techniques: uniqueNonEmpty(techniques),
  };
}

interface PrincipalIdentity {
  user: string;
  host: string;
}

/*
 * The identity behind a finding lives inside Resources[].Details: IAM
 * findings carry AwsIamAccessKey (PrincipalName / UserName) or AwsIamUser
 * (UserName), EC2 findings carry the instance id as the resource Id. The
 * first match wins; most findings name one resource.
 */
function principalOf(resources: Array<JSONObject>): PrincipalIdentity {
  let user: string = "";
  let host: string = "";

  for (const resource of resources) {
    if (!user) {
      user =
        readString(resource, "Details.AwsIamAccessKey.PrincipalName") ||
        readString(resource, "Details.AwsIamAccessKey.UserName") ||
        readString(resource, "Details.AwsIamUser.UserName");
    }

    if (!host && readString(resource, "Type") === "AwsEc2Instance") {
      const id: string = readString(resource, "Id");
      const index: number = id.lastIndexOf("/");

      host = index === -1 ? id : id.substring(index + 1);
    }
  }

  return { user, host };
}

export default class AwsSecurityHubNormalizer {
  /*
   * A record is an ASFF finding when it carries a finding Id together
   * with at least one of the other required top-level attributes
   * (ProductArn, AwsAccountId, CreatedAt). Anything else — an error
   * envelope that slipped into a page, a bare string — is rejected rather
   * than turned into a meaningless row.
   */
  public static isRecognized(raw: JSONObject): boolean {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return false;
    }

    if (!readString(raw, "Id")) {
      return false;
    }

    return Boolean(
      readString(raw, "ProductArn") ||
        readString(raw, "AwsAccountId") ||
        readString(raw, "CreatedAt"),
    );
  }

  public static isComplianceFinding(raw: JSONObject): boolean {
    const compliance: JSONValue = readValue(raw, "Compliance");

    return isObject(compliance) && Object.keys(compliance).length > 0;
  }

  public static normalize(raw: JSONObject): NormalizedSecurityEvent {
    const catalog: SecurityEventConnectorDefinition = definition();

    const title: string = readString(raw, "Title");
    const description: string = readString(raw, "Description");

    /*
     * Creation time is the poll basis, so it is also the row's time: the
     * finding's own observation window (FirstObservedAt) can be hours or
     * days earlier and is kept in attributes for anyone who needs it.
     */
    const time: Date | null =
      parseEventTime(readValue(raw, "CreatedAt")) ||
      parseEventTime(readValue(raw, "UpdatedAt")) ||
      parseEventTime(readValue(raw, "FirstObservedAt"));

    // Id is stable across every GetFindings call, so it is the dedupe key.
    const eventUid: string = readString(raw, "Id") || contentHashEventUid(raw);

    const isCompliance: boolean =
      AwsSecurityHubNormalizer.isComplianceFinding(raw);
    const classUid: number = isCompliance
      ? AWS_SECURITY_HUB_COMPLIANCE_CLASS_UID
      : AWS_SECURITY_HUB_DETECTION_CLASS_UID;
    const className: string = isCompliance
      ? AWS_SECURITY_HUB_COMPLIANCE_CLASS_NAME
      : AWS_SECURITY_HUB_DETECTION_CLASS_NAME;
    const { categoryUid, categoryName } = ocsfCategoryForClassUid(classUid);

    const severityName: OcsfSeverity = severityOf(raw);

    const mitre: MitreReferences = mitreOf(readStringArray(raw, "Types"));

    const resources: Array<JSONObject> = objectArray(
      readValue(raw, "Resources"),
    );
    const resourceIds: Array<string> = resources.map(
      (resource: JSONObject): string => {
        return readString(resource, "Id");
      },
    );
    const principal: PrincipalIdentity = principalOf(resources);

    const sourceIp: string =
      readString(raw, "Network.SourceIpV4") ||
      readString(raw, "Network.SourceIpV6");
    const destinationIp: string =
      readString(raw, "Network.DestinationIpV4") ||
      readString(raw, "Network.DestinationIpV6");
    const destinationPort: number | null = readNumber(
      raw,
      "Network.DestinationPort",
    );
    const sourceDomain: string = readString(raw, "Network.SourceDomain");
    const destinationDomain: string = readString(
      raw,
      "Network.DestinationDomain",
    );

    const processName: string = readString(raw, "Process.Name");
    const processPath: string = readString(raw, "Process.Path");

    const malwareNames: Array<string> = objectArray(
      readValue(raw, "Malware"),
    ).map((malware: JSONObject): string => {
      return readString(malware, "Name") || readString(malware, "Path");
    });

    const indicatorValues: Array<string> = objectArray(
      readValue(raw, "ThreatIntelIndicators"),
    ).map((indicator: JSONObject): string => {
      return readString(indicator, "Value");
    });

    const accountId: string = readString(raw, "AwsAccountId");

    /*
     * Workflow.Status is the investigation state a person manages;
     * the retired WorkflowState is read when a partner product still
     * sends only that. RecordState (ACTIVE/ARCHIVED) is not a status of
     * the activity and stays in attributes.
     */
    const statusName: string =
      readString(raw, "Workflow.Status") || readString(raw, "WorkflowState");

    const message: string =
      title ||
      description ||
      (isCompliance
        ? "AWS Security Hub control finding"
        : "AWS Security Hub finding");

    return {
      time: time || new Date(),
      eventUid,
      categoryUid,
      categoryName,
      classUid,
      className,
      activityName: "Create",
      severityId: OcsfSeverityId[severityName],
      severityName,
      statusName,
      message,
      vendorName: catalog.vendorName,
      productName: catalog.productName,
      ruleId: readString(raw, "GeneratorId"),
      ruleName: title,
      mitreTactics: mitre.tactics,
      mitreTechniques: mitre.techniques,
      principalUser: principal.user,
      principalHost: "",
      principalIp: sourceIp,
      principalProcess: processName || processPath,
      targetUser: "",
      targetHost: principal.host,
      targetIp: destinationIp,
      targetPort:
        destinationPort !== null && destinationPort > 0
          ? Math.floor(destinationPort)
          : 0,
      targetResource: resourceIds[0] || "",
      observables: buildObservables([
        principal.user,
        principal.host,
        sourceIp,
        destinationIp,
        sourceDomain,
        destinationDomain,
        ...resourceIds,
        accountId,
        processName,
        ...malwareNames,
        ...indicatorValues,
      ]),
      attributes: flattenPayload(raw),
    };
  }
}

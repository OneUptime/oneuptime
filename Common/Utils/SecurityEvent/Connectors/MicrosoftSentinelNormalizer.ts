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
  readString,
  readStringArray,
  readValue,
} from "../NormalizerHelpers";

/*
 * Microsoft Sentinel incident (Azure Resource Manager
 * Microsoft.SecurityInsights/incidents resource) -> OCSF Incident Finding
 * (class 2005).
 *
 * The payload shape is the `Incident` object of the Sentinel REST API:
 * https://learn.microsoft.com/en-us/rest/api/securityinsights/incidents/list
 * (api-version 2024-03-01). Everything the connector needs is under
 * `properties`: title, severity (High/Medium/Low/Informational), status
 * (New/Active/Closed), createdTimeUtc, owner and additionalData.tactics.
 *
 * Pure and isomorphic on purpose — this file imports only from
 * Common/Types and Common/Utils so it runs unchanged in the server, in
 * tests and in the browser if the dashboard ever previews raw incidents.
 */

export const MICROSOFT_SENTINEL_INCIDENT_CLASS_UID: number = 2005;
export const MICROSOFT_SENTINEL_INCIDENT_CLASS_NAME: string =
  "Incident Finding";
export const MICROSOFT_SENTINEL_INCIDENT_RESOURCE_TYPE: string =
  "Microsoft.SecurityInsights/incidents";

/*
 * Sentinel reports tactics by their ATT&CK name (the `AttackTactic` enum
 * on the incidents API), while NormalizedSecurityEvent.mitreTactics
 * stores ATT&CK ids ("TA0003") so rows from every source join on the same
 * key. Enterprise ATT&CK ids for the fourteen enterprise tactics; the two
 * ICS tactics carry their ICS ids; PreAttack has no id in the current
 * matrix and keeps its name, which is still searchable.
 */
export const MICROSOFT_SENTINEL_TACTIC_IDS: Record<string, string> = {
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
  impairprocesscontrol: "TA0106",
  inhibitresponsefunction: "TA0107",
};

function definition(): SecurityEventConnectorDefinition {
  const found: SecurityEventConnectorDefinition | undefined =
    getSecurityEventConnectorDefinition(
      SecurityEventConnectorProvider.MicrosoftSentinel,
    );

  if (!found) {
    /*
     * The catalog is a static list that always carries this provider; the
     * throw only exists so a future catalog edit cannot silently attribute
     * events to an empty vendor and break the dedupe scope.
     */
    throw new Error(
      "Microsoft Sentinel is missing from SecurityEventConnectorCatalog.",
    );
  }

  return found;
}

/*
 * Analytic rule ids arrive as full ARM resource ids
 * (".../alertRules/{guid}"). The trailing segment is the rule's own id and
 * is what a person recognizes from the Sentinel UI.
 */
function lastPathSegment(value: string): string {
  const trimmed: string = value.trim().replace(/\/+$/, "");
  const index: number = trimmed.lastIndexOf("/");

  return index === -1 ? trimmed : trimmed.substring(index + 1);
}

function mapTactic(name: string): string {
  const key: string = name.replace(/[^A-Za-z]/g, "").toLowerCase();

  return MICROSOFT_SENTINEL_TACTIC_IDS[key] || name.trim();
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

export default class MicrosoftSentinelNormalizer {
  /*
   * A record is a Sentinel incident when it says so (`type`) or when it has
   * the incident property bag: a `properties` object carrying the
   * creation time and a title or incident number. Anything else — an ARM
   * error envelope that slipped into a page, a bare string — is rejected
   * rather than turned into a meaningless row.
   */
  public static isRecognized(raw: JSONObject): boolean {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return false;
    }

    const type: string = readString(raw, "type");

    if (
      type.toLowerCase() ===
      MICROSOFT_SENTINEL_INCIDENT_RESOURCE_TYPE.toLowerCase()
    ) {
      return true;
    }

    const properties: JSONValue = readValue(raw, "properties");

    if (
      !properties ||
      typeof properties !== "object" ||
      Array.isArray(properties)
    ) {
      return false;
    }

    const hasCreatedTime: boolean = Boolean(
      readString(raw, "properties.createdTimeUtc"),
    );
    const hasIdentity: boolean = Boolean(
      readString(raw, "properties.title") ||
        readString(raw, "properties.incidentNumber"),
    );

    return hasCreatedTime && hasIdentity;
  }

  public static normalize(raw: JSONObject): NormalizedSecurityEvent {
    const catalog: SecurityEventConnectorDefinition = definition();

    const title: string = readString(raw, "properties.title");
    const description: string = readString(raw, "properties.description");
    const incidentNumber: string = readString(raw, "properties.incidentNumber");

    /*
     * Creation time is the poll basis, so it is also the row's time: the
     * incident's own activity window (firstActivityTimeUtc) can be hours
     * or days earlier and is kept in attributes for anyone who needs it.
     */
    const time: Date | null =
      parseEventTime(readValue(raw, "properties.createdTimeUtc")) ||
      parseEventTime(readValue(raw, "properties.lastModifiedTimeUtc"));

    /*
     * `name` is the incident GUID and is stable across every list call, so
     * it is the dedupe key. The ARM `id` ends in the same GUID and is the
     * fallback; a payload with neither gets a content hash.
     */
    const eventUid: string =
      readString(raw, "name") ||
      lastPathSegment(readString(raw, "id")) ||
      contentHashEventUid(raw);

    const severityName: OcsfSeverity =
      normalizeOcsfSeverity(readString(raw, "properties.severity")) ||
      OcsfSeverity.Unknown;

    const { categoryUid, categoryName } = ocsfCategoryForClassUid(
      MICROSOFT_SENTINEL_INCIDENT_CLASS_UID,
    );

    const relatedRuleIds: Array<string> = readStringArray(
      raw,
      "properties.relatedAnalyticRuleIds",
    );

    const tactics: Array<string> = uniqueNonEmpty(
      readStringArray(raw, "properties.additionalData.tactics").map(
        (tactic: string): string => {
          return mapTactic(tactic);
        },
      ),
    );

    /*
     * IncidentAdditionalData documents only `tactics` for api-version
     * 2024-03-01 (and the 2025-09-01 reference lists no `techniques`
     * either). The key is still read defensively: it costs nothing, and an
     * api-version that adds ATT&CK technique ids would then flow through
     * instead of being flattened to tactics alone. Absent, it stays empty.
     */
    const techniques: Array<string> = uniqueNonEmpty(
      readStringArray(raw, "properties.additionalData.techniques"),
    );

    const ownerUpn: string = readString(
      raw,
      "properties.owner.userPrincipalName",
    );
    const ownerEmail: string = readString(raw, "properties.owner.email");
    const ownerObjectId: string = readString(raw, "properties.owner.objectId");

    const labelNames: Array<string> = [];
    const labels: JSONValue = readValue(raw, "properties.labels");

    if (Array.isArray(labels)) {
      for (const label of labels as Array<JSONValue>) {
        if (label && typeof label === "object" && !Array.isArray(label)) {
          const labelName: string = readString(
            label as JSONObject,
            "labelName",
          );

          if (labelName) {
            labelNames.push(labelName);
          }
        } else if (typeof label === "string") {
          labelNames.push(label);
        }
      }
    }

    const message: string =
      title ||
      description ||
      (incidentNumber
        ? `Microsoft Sentinel incident ${incidentNumber}`
        : "Microsoft Sentinel incident");

    return {
      time: time || new Date(),
      eventUid,
      categoryUid,
      categoryName,
      classUid: MICROSOFT_SENTINEL_INCIDENT_CLASS_UID,
      className: MICROSOFT_SENTINEL_INCIDENT_CLASS_NAME,
      activityName: "Create",
      severityId: OcsfSeverityId[severityName],
      severityName,
      statusName: readString(raw, "properties.status"),
      message,
      vendorName: catalog.vendorName,
      productName: catalog.productName,
      ruleId: relatedRuleIds[0] ? lastPathSegment(relatedRuleIds[0]) : "",
      ruleName: title,
      mitreTactics: tactics,
      mitreTechniques: techniques,
      principalUser: ownerUpn || ownerEmail,
      principalHost: "",
      principalIp: "",
      principalProcess: "",
      targetUser: "",
      targetHost: "",
      targetIp: "",
      targetPort: 0,
      targetResource: readString(raw, "properties.incidentUrl"),
      observables: buildObservables([
        ownerUpn,
        ownerEmail,
        ownerObjectId,
        ...labelNames,
      ]),
      attributes: flattenPayload(raw),
    };
  }
}

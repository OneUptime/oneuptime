import { JSONObject } from "../../../Types/JSON";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity, {
  OcsfSeverityId,
  normalizeOcsfSeverity,
} from "../../../Types/SecurityEvent/OcsfSeverity";
import { ocsfCategoryForClassUid } from "../../../Types/SecurityEvent/OcsfEventClass";
import {
  DETECTION_FINDING_CLASS_NAME,
  DETECTION_FINDING_CLASS_UID,
} from "../../../Types/SecurityEvent/DetectionFindingConstants";
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
  readValue,
} from "../NormalizerHelpers";

/*
 * CrowdStrike Falcon alert (Alerts API, PostEntitiesAlertsV2 resource)
 * -> OCSF Detection Finding (class 2004).
 *
 * The payload shape is the `resources[]` element of
 * POST /alerts/entities/alerts/v2 (PostEntitiesAlertsV2 on
 * https://developer.crowdstrike.com/api-reference/collections/alerts/).
 * Field names follow the alert entity schema on that page and the sample
 * event in Elastic's CrowdStrike integration (crowdstrike.alert data
 * stream, https://www.elastic.co/docs/reference/integrations/crowdstrike):
 * composite_id, id, display_name/name, description, severity (0-100) +
 * severity_name, status, tactic/tactic_id, technique/technique_id,
 * created_timestamp, timestamp, updated_timestamp, product, type,
 * device.{hostname, local_ip, external_ip, platform_name}, user_name,
 * user_id, filename, cmdline, sha256, falcon_host_link, pattern_id.
 *
 * Pure and isomorphic: only Common/Types and Common/Utils imports, so the
 * same code is unit-testable without a server and reusable from the UI.
 */

/*
 * Vendor/product attribution is read from the catalog rather than retyped:
 * the poller dedupes on exactly these two values, and a typo here would
 * silently split one connection's events into two dedupe scopes.
 */
const DEFINITION: SecurityEventConnectorDefinition | undefined =
  getSecurityEventConnectorDefinition(
    SecurityEventConnectorProvider.CrowdStrikeFalcon,
  );

const VENDOR_NAME: string = DEFINITION?.vendorName || "CrowdStrike";
const PRODUCT_NAME: string = DEFINITION?.productName || "Falcon";

/*
 * Falcon's numeric severity is 0-100 and its severity_name is derived from
 * it in 20-point bands (the Elastic sample carries severity 30 with
 * severity_name "low"). severity_name is authoritative when present; the
 * bands are only the fallback for a payload that carries the number alone.
 */
function severityFromNumeric(severity: number | null): OcsfSeverity | null {
  if (severity === null) {
    return null;
  }

  if (severity < 20) {
    return OcsfSeverity.Informational;
  }

  if (severity < 40) {
    return OcsfSeverity.Low;
  }

  if (severity < 60) {
    return OcsfSeverity.Medium;
  }

  if (severity < 80) {
    return OcsfSeverity.High;
  }

  return OcsfSeverity.Critical;
}

export default class CrowdStrikeFalconNormalizer {
  public static readonly vendorName: string = VENDOR_NAME;
  public static readonly productName: string = PRODUCT_NAME;

  /*
   * A Falcon alert always carries composite_id (the Alerts API's primary
   * key). Older shapes carry `id` plus at least one alert-specific marker;
   * anything else is not an alert and must be counted as rejected rather
   * than stored as an empty finding.
   */
  public static isRecognized(raw: JSONObject): boolean {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return false;
    }

    if (readString(raw, "composite_id")) {
      return true;
    }

    if (!readString(raw, "id")) {
      return false;
    }

    return Boolean(
      readString(raw, "created_timestamp") ||
        readString(raw, "severity_name") ||
        readString(raw, "tactic") ||
        readString(raw, "pattern_id"),
    );
  }

  public static normalize(raw: JSONObject): NormalizedSecurityEvent {
    const severityName: OcsfSeverity =
      normalizeOcsfSeverity(readString(raw, "severity_name")) ||
      severityFromNumeric(readNumber(raw, "severity")) ||
      OcsfSeverity.Unknown;

    /*
     * Time is the alert's CREATION time on purpose: the poll window is on
     * created_timestamp, and a finding row dated by the underlying
     * activity (`timestamp`) can be hours older than the window that
     * imported it. The activity time stays queryable in attributes.
     */
    const time: Date | null =
      parseEventTime(readValue(raw, "created_timestamp")) ||
      parseEventTime(readValue(raw, "timestamp")) ||
      parseEventTime(readValue(raw, "updated_timestamp"));

    const displayName: string = readString(raw, "display_name");
    const name: string = readString(raw, "name");
    const description: string = readString(raw, "description");
    const ruleName: string = displayName || name;

    const hostname: string = readString(raw, "device.hostname");
    const localIp: string = readString(raw, "device.local_ip");
    const externalIp: string = readString(raw, "device.external_ip");
    const userName: string = readString(raw, "user_name");
    const filename: string = readString(raw, "filename");
    const cmdline: string = readString(raw, "cmdline");
    const sha256: string = readString(raw, "sha256");
    const tacticId: string = readString(raw, "tactic_id");
    const techniqueId: string = readString(raw, "technique_id");

    const { categoryUid, categoryName } = ocsfCategoryForClassUid(
      DETECTION_FINDING_CLASS_UID,
    );

    return {
      time: time || new Date(),
      eventUid:
        readString(raw, "composite_id") ||
        readString(raw, "id") ||
        contentHashEventUid(raw),
      categoryUid,
      categoryName,
      classUid: DETECTION_FINDING_CLASS_UID,
      className: DETECTION_FINDING_CLASS_NAME,
      activityName: "Create",
      severityId: OcsfSeverityId[severityName],
      severityName,
      statusName: readString(raw, "status"),
      message: description || ruleName || "CrowdStrike Falcon alert",
      vendorName: VENDOR_NAME,
      productName: PRODUCT_NAME,
      ruleId: readString(raw, "pattern_id"),
      ruleName,
      mitreTactics: tacticId ? [tacticId] : [],
      mitreTechniques: techniqueId ? [techniqueId] : [],
      principalUser: userName,
      principalHost: hostname,
      principalIp: localIp,
      principalProcess: filename || cmdline,
      targetUser: "",
      targetHost: "",
      targetIp: "",
      targetPort: 0,
      targetResource: "",
      observables: buildObservables([
        hostname,
        localIp,
        externalIp,
        userName,
        sha256,
      ]),
      attributes: flattenPayload(raw),
    };
  }
}

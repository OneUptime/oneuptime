import { JSONObject, JSONValue } from "../../../Types/JSON";
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
} from "../NormalizerHelpers";

/*
 * Splunk Enterprise Security notable event (one `result` row of a JSON
 * export over index=notable) -> OCSF Detection Finding (class 2004).
 *
 * Field contract, from Splunk's developer documentation on notable events
 * (https://dev.splunk.com/enterprise/docs/devtools/enterprisesecurity/notableeventsplunkes/usingnotableeventsinsearch):
 * every indexed notable carries `_time`, `host`, `source`, `sourcetype`
 * plus the correlation search fields `rule_name` and `severity`; the
 * stash fields `orig_sid` / `orig_rid` identify the search run; and
 * `event_id` is "Assigned at search time by the `notable` macro" — so a
 * plain index=notable read may not carry it, which is why the uid falls
 * back to Splunk's own bucket/offset identity and then to a content hash.
 * `urgency` is one of informational, low, medium, high, critical
 * (https://help.splunk.com/en/splunk-enterprise-security-7/user-guide/7.3/incident-review/how-urgency-is-assigned-to-notable-events-in-splunk-enterprise-security);
 * `status_label` is "The short form description of the notable event
 * status". `rule_title` / `rule_description` are the notable's title and
 * description; `src`, `dest`, `user`, `src_user`, `dest_user` are the CIM
 * entity fields correlation searches populate; MITRE annotations arrive
 * as `annotations.mitre_attack` (technique ids such as T1078) and the
 * expanded `annotations.mitre_attack.mitre_technique_id` /
 * `annotations.mitre_attack.mitre_tactic` fields
 * (https://help.splunk.com/en/splunk-enterprise-security-7/risk-based-alerting/7.3/identify-threat/how-risk-annotations-provide-additional-context-in-splunk-enterprise-security).
 *
 * Splunk keys are flat strings that may themselves contain dots
 * ("annotations.mitre_attack" is one field, not a nested object), and a
 * multivalue field is exported as a JSON array. Fields are therefore read
 * by exact key, never by dot path.
 *
 * Pure and isomorphic: no server imports.
 */

const MAX_OBSERVABLES: number = 200;

/*
 * Default Splunk ES review statuses (reviewstatuses.conf ships these
 * numeric ids). Used only when the export carries the numeric `status`
 * but not the label the `notable` macro would have added.
 */
const STATUS_LABEL_BY_ID: Record<string, string> = {
  "0": "Unassigned",
  "1": "New",
  "2": "In Progress",
  "3": "Pending",
  "4": "Resolved",
  "5": "Closed",
};

/*
 * MITRE ATT&CK enterprise tactics by name, for annotations that carry the
 * tactic as prose ("Initial Access") rather than its id.
 * https://attack.mitre.org/tactics/enterprise/
 */
const TACTIC_ID_BY_NAME: Record<string, string> = {
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
  commandandcontrol: "TA0011",
  exfiltration: "TA0010",
  impact: "TA0040",
};

const TECHNIQUE_ID_REGEX: RegExp = /^T\d{4}(?:\.\d{3})?$/;
const TACTIC_ID_REGEX: RegExp = /^TA\d{4}$/;

const IPV4_REGEX: RegExp =
  /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
// Loose IPv6: hex groups and colons, at least two colons; enough to tell an address from a hostname.
const IPV6_REGEX: RegExp = /^[0-9a-fA-F:]*:[0-9a-fA-F:]*:[0-9a-fA-F:.]*$/;

function isObject(value: unknown): value is JSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/*
 * Read a Splunk field by its exact key. A multivalue field is a JSON
 * array; the first scalar wins for single-valued columns.
 */
function field(payload: JSONObject, key: string): string {
  const value: JSONValue = payload[key] as JSONValue;

  if (value === null || value === undefined) {
    return "";
  }

  if (Array.isArray(value)) {
    const first: JSONValue | undefined = value.find(
      (item: JSONValue): boolean => {
        return item !== null && item !== undefined && typeof item !== "object";
      },
    );
    return first === undefined ? "" : String(first).trim();
  }

  if (typeof value === "object") {
    return "";
  }

  return String(value).trim();
}

/*
 * Every scalar of a field, splitting comma-joined strings too: ES
 * annotations are stored as JSON in savedsearches.conf and surface as
 * either an array or a single joined string depending on the search.
 */
function fieldValues(payload: JSONObject, key: string): Array<string> {
  const value: JSONValue = payload[key] as JSONValue;

  if (value === null || value === undefined) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .filter((item: JSONValue): boolean => {
        return item !== null && item !== undefined && typeof item !== "object";
      })
      .map((item: JSONValue): string => {
        return String(item).trim();
      })
      .filter((item: string): boolean => {
        return item.length > 0;
      });
  }

  if (typeof value === "object") {
    return [];
  }

  return String(value)
    .split(",")
    .map((item: string): string => {
      return item.trim();
    })
    .filter((item: string): boolean => {
      return item.length > 0;
    });
}

function firstField(payload: JSONObject, keys: Array<string>): string {
  for (const key of keys) {
    const value: string = field(payload, key);

    if (value) {
      return value;
    }
  }

  return "";
}

export function isIpAddress(value: string): boolean {
  const trimmed: string = (value || "").trim();

  if (!trimmed) {
    return false;
  }

  return IPV4_REGEX.test(trimmed) || IPV6_REGEX.test(trimmed);
}

interface Endpoint {
  ip: string;
  host: string;
}

/*
 * CIM `src` / `dest` hold "the host, IP or name"; `src_ip` / `dest_ip`
 * are always addresses. The address column gets the explicit IP field,
 * else `src`/`dest` when it looks like one; the host column gets
 * `src_host`/`dest_host`, else `src`/`dest` when it does not.
 */
function pickEndpoint(
  payload: JSONObject,
  generic: string,
  ipKey: string,
  hostKeys: Array<string>,
): Endpoint {
  const genericValue: string = field(payload, generic);
  const explicitIp: string = field(payload, ipKey);
  const explicitHost: string = firstField(payload, hostKeys);

  let ip: string = explicitIp;
  let host: string = explicitHost;

  if (genericValue) {
    if (isIpAddress(genericValue)) {
      ip = ip || genericValue;
    } else {
      host = host || genericValue;
    }
  }

  return { ip, host };
}

function mapTechniques(payload: JSONObject): Array<string> {
  const candidates: Array<string> = [
    ...fieldValues(payload, "annotations.mitre_attack"),
    ...fieldValues(payload, "annotations.mitre_attack.mitre_technique_id"),
    ...fieldValues(payload, "mitre_technique_id"),
    ...fieldValues(payload, "mitre_technique"),
  ];
  const techniques: Array<string> = [];

  for (const candidate of candidates) {
    const id: string = candidate.toUpperCase();

    if (TECHNIQUE_ID_REGEX.test(id) && !techniques.includes(id)) {
      techniques.push(id);
    }
  }

  return techniques;
}

function mapTactics(payload: JSONObject): Array<string> {
  const candidates: Array<string> = [
    ...fieldValues(payload, "annotations.mitre_attack.mitre_tactic_id"),
    ...fieldValues(payload, "annotations.mitre_attack.mitre_tactic"),
    ...fieldValues(payload, "mitre_tactic_id"),
    ...fieldValues(payload, "mitre_tactic"),
    // The technique list may carry tactic ids too; harmless to scan.
    ...fieldValues(payload, "annotations.mitre_attack"),
  ];
  const tactics: Array<string> = [];

  for (const candidate of candidates) {
    const upper: string = candidate.toUpperCase();
    let id: string = "";

    if (TACTIC_ID_REGEX.test(upper)) {
      id = upper;
    } else {
      const key: string = candidate.toLowerCase().replace(/[^a-z]/g, "");
      id = TACTIC_ID_BY_NAME[key] || "";
    }

    if (id && !tactics.includes(id)) {
      tactics.push(id);
    }
  }

  return tactics;
}

/*
 * The notable's own identity. `event_id` when the `notable` macro (or
 * the correlation search's eval) supplied it; else Splunk's bucket +
 * offset pair, which uniquely names an indexed event and survives
 * re-reads of the same window; else a hash of the row.
 */
function eventUid(payload: JSONObject): string {
  const eventId: string = field(payload, "event_id");

  if (eventId) {
    return eventId;
  }

  const bucket: string = field(payload, "_bkt");
  const offset: string = field(payload, "_cd");

  if (bucket && offset) {
    return `splunk:${bucket}:${offset}`;
  }

  return contentHashEventUid(payload);
}

function statusName(payload: JSONObject): string {
  const label: string = firstField(payload, [
    "status_label",
    "status_description",
  ]);

  if (label) {
    return label;
  }

  const status: string = field(payload, "status");

  return STATUS_LABEL_BY_ID[status] || status;
}

export default class SplunkNormalizer {
  /*
   * A row from a Splunk export always carries `_time`; a notable also
   * names its correlation search. Anything without either is not an
   * event Splunk produced, so it is rejected rather than hashed into a
   * row with nothing in it.
   */
  public static isRecognized(payload: JSONObject): boolean {
    if (!isObject(payload)) {
      return false;
    }

    return Boolean(
      field(payload, "_time") ||
        field(payload, "event_id") ||
        field(payload, "rule_name") ||
        field(payload, "search_name"),
    );
  }

  public static normalize(payload: JSONObject): NormalizedSecurityEvent {
    const definition: SecurityEventConnectorDefinition | undefined =
      getSecurityEventConnectorDefinition(
        SecurityEventConnectorProvider.SplunkEnterpriseSecurity,
      );

    /*
     * Urgency is what Incident Review shows and already folds in asset
     * and identity priority; the raw correlation-search severity is the
     * fallback. "unknown" maps to Unknown rather than to null.
     */
    const severityName: OcsfSeverity =
      normalizeOcsfSeverity(field(payload, "urgency")) ||
      normalizeOcsfSeverity(field(payload, "severity")) ||
      OcsfSeverity.Unknown;

    /*
     * `_time` of a notable is when the correlation search created it; the
     * export renders it as ISO 8601 with offset, an epoch string appears
     * when a search reformats it. Both parse.
     */
    const time: Date | null = parseEventTime(payload["_time"] as JSONValue);

    const ruleName: string = firstField(payload, [
      "rule_name",
      "search_name",
      "source",
    ]);

    const source: Endpoint = pickEndpoint(payload, "src", "src_ip", [
      "src_host",
      "src_nt_host",
    ]);
    const destination: Endpoint = pickEndpoint(payload, "dest", "dest_ip", [
      "dest_host",
      "dest_nt_host",
    ]);

    const principalUser: string = firstField(payload, ["user", "src_user"]);
    const targetUser: string = field(payload, "dest_user");
    const principalProcess: string = firstField(payload, [
      "process",
      "process_name",
      "parent_process",
    ]);
    const targetPort: number = Number(field(payload, "dest_port"));

    const { categoryUid, categoryName } = ocsfCategoryForClassUid(
      DETECTION_FINDING_CLASS_UID,
    );

    return {
      time: time || new Date(),
      eventUid: eventUid(payload),
      categoryUid,
      categoryName,
      classUid: DETECTION_FINDING_CLASS_UID,
      className: DETECTION_FINDING_CLASS_NAME,
      activityName: "Create",
      severityId: OcsfSeverityId[severityName],
      severityName,
      statusName: statusName(payload),
      message:
        firstField(payload, ["rule_title", "rule_description"]) ||
        ruleName ||
        "Splunk Enterprise Security notable event",
      vendorName: definition?.vendorName || "Splunk",
      productName: definition?.productName || "Splunk Enterprise Security",
      // The correlation search name is the stable rule identity in Splunk.
      ruleId: firstField(payload, ["search_name", "source", "rule_name"]),
      ruleName,
      mitreTactics: mapTactics(payload),
      mitreTechniques: mapTechniques(payload),
      principalUser,
      principalHost: source.host,
      principalIp: source.ip,
      principalProcess,
      targetUser,
      targetHost: destination.host,
      targetIp: destination.ip,
      targetPort:
        Number.isFinite(targetPort) && targetPort > 0 ? targetPort : 0,
      targetResource: firstField(payload, ["file_path", "url", "risk_object"]),
      observables: buildObservables([
        principalUser,
        field(payload, "src_user"),
        targetUser,
        source.host,
        destination.host,
        source.ip,
        destination.ip,
        field(payload, "dvc"),
        field(payload, "host"),
        field(payload, "file_hash"),
        field(payload, "file_name"),
        field(payload, "url"),
        field(payload, "domain"),
        field(payload, "query"),
        field(payload, "risk_object"),
      ]).slice(0, MAX_OBSERVABLES),
      attributes: flattenPayload(payload),
    };
  }
}

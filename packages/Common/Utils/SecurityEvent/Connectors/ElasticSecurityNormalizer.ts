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
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  buildObservables,
  contentHashEventUid,
  flattenPayload,
  parseEventTime,
} from "../NormalizerHelpers";

/*
 * Elastic Security detection alert -> OCSF Detection Finding (2004).
 *
 * The input is one hit of the Elasticsearch search response that
 * POST /api/detection_engine/signals/search returns: `{ _id, _index,
 * _source }`. A bare alert document (the `_source` alone, as a Kibana
 * connector action or a forwarder would deliver it) is accepted too; it
 * just has no `_id` to use as the event uid.
 *
 * Alert documents carry two field spellings at once and both must be
 * read. Kibana's rule registry writes its own fields with DOTTED KEYS at
 * the top level of `_source` (`"kibana.alert.rule.name": "..."`), while
 * the ECS fields copied from the matched source event arrive as NESTED
 * objects (`host: { name: "..." }`) or, depending on the shipper, dotted as
 * well — and a dotted prefix can hold a nested object
 * (`"kibana.alert.rule.parameters": { threat: [...] }`). Every read below
 * therefore resolves a path against any mix of the two spellings. Field
 * names follow the published alert schema:
 * https://www.elastic.co/guide/en/security/current/alert-schema.html
 *
 * Pure and isomorphic: imports only from Common/Types and Common/Utils.
 */

const ELASTIC_DEFINITION: SecurityEventConnectorDefinition | undefined =
  getSecurityEventConnectorDefinition(
    SecurityEventConnectorProvider.ElasticSecurity,
  );

/*
 * The vendor/product pair is the dedupe scope in the event store and the
 * label the dashboard groups by, so it is read from the catalog rather
 * than retyped here: a rename in one place must not orphan stored rows.
 */
export const ELASTIC_SECURITY_VENDOR_NAME: string =
  ELASTIC_DEFINITION?.vendorName || "Elastic";
export const ELASTIC_SECURITY_PRODUCT_NAME: string =
  ELASTIC_DEFINITION?.productName || "Elastic Security";

/*
 * Rule risk_score bands, matching the severity defaults the rule editor
 * assigns (low 21, medium 47, high 73, critical 99). Used only when
 * `kibana.alert.severity` is missing, which happens on alerts written by
 * older rule types.
 */
function severityFromRiskScore(riskScore: number | null): OcsfSeverity | null {
  if (riskScore === null) {
    return null;
  }

  if (riskScore >= 74) {
    return OcsfSeverity.Critical;
  }

  if (riskScore >= 48) {
    return OcsfSeverity.High;
  }

  if (riskScore >= 22) {
    return OcsfSeverity.Medium;
  }

  return OcsfSeverity.Low;
}

function isJsonObject(
  value: JSONValue | undefined | null,
): value is JSONObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstObject(value: JSONValue | undefined | null): JSONObject | null {
  if (isJsonObject(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    const found: unknown = (value as Array<unknown>).find(
      (item: unknown): boolean => {
        return isJsonObject(item as JSONValue);
      },
    );

    return found ? (found as JSONObject) : null;
  }

  return null;
}

/*
 * Resolve a dot path against a document whose keys may be dotted, nested
 * or any mix of the two. At every level the longest dotted key present
 * wins, so "kibana.alert.rule.parameters.threat" finds both
 * `{"kibana.alert.rule.parameters": {threat}}` and `{kibana: {alert: ...}}`.
 * Arrays along the way contribute their first object (readValue's rule).
 */
function resolvePath(
  payload: JSONObject,
  segments: Array<string>,
  start: number,
): JSONValue | null {
  for (let length: number = segments.length - start; length >= 1; length--) {
    const key: string = segments.slice(start, start + length).join(".");

    if (!Object.prototype.hasOwnProperty.call(payload, key)) {
      continue;
    }

    const value: JSONValue = payload[key];

    if (value === null || value === undefined) {
      continue;
    }

    if (start + length === segments.length) {
      return value;
    }

    const child: JSONObject | null = firstObject(value);

    if (child) {
      const nested: JSONValue | null = resolvePath(
        child,
        segments,
        start + length,
      );

      if (nested !== null) {
        return nested;
      }
    }
  }

  return null;
}

function readField(payload: JSONObject, path: string): JSONValue | null {
  return resolvePath(payload, path.split("."), 0);
}

function readFieldString(payload: JSONObject, path: string): string {
  const value: JSONValue | null = readField(payload, path);

  if (value === null || value === undefined) {
    return "";
  }

  if (Array.isArray(value)) {
    const first: unknown = (value as Array<unknown>).find(
      (item: unknown): boolean => {
        return item !== null && item !== undefined && typeof item !== "object";
      },
    );
    return first === undefined ? "" : String(first);
  }

  if (typeof value === "object") {
    return "";
  }

  return String(value);
}

function readFieldStrings(payload: JSONObject, path: string): Array<string> {
  const value: JSONValue | null = readField(payload, path);

  if (value === null || value === undefined) {
    return [];
  }

  if (Array.isArray(value)) {
    return (value as Array<unknown>)
      .filter((item: unknown): boolean => {
        return item !== null && item !== undefined && typeof item !== "object";
      })
      .map((item: unknown): string => {
        return String(item);
      });
  }

  if (typeof value === "object") {
    return [];
  }

  return [String(value)];
}

function readFieldNumber(payload: JSONObject, path: string): number | null {
  const text: string = readFieldString(payload, path);

  if (text.trim() === "") {
    return null;
  }

  const parsed: number = Number(text);

  return Number.isFinite(parsed) ? parsed : null;
}

function readFieldObjects(
  payload: JSONObject,
  path: string,
): Array<JSONObject> {
  const value: JSONValue | null = readField(payload, path);

  if (Array.isArray(value)) {
    return (value as Array<unknown>).filter((item: unknown): boolean => {
      return isJsonObject(item as JSONValue);
    }) as Array<JSONObject>;
  }

  if (isJsonObject(value)) {
    return [value];
  }

  return [];
}

interface MitreReferences {
  tactics: Array<string>;
  techniques: Array<string>;
}

/*
 * `kibana.alert.rule.threat[]` follows the rule schema's Threat object:
 * { framework, tactic: { id, name, reference }, technique: [{ id, name,
 * reference, subtechnique: [{ id, name, reference }] }] }. Only ids are
 * kept — they are the stable join key across products. Sub-technique ids
 * (T1078.004) are listed alongside their parent technique.
 */
function collectMitre(threats: Array<JSONObject>): MitreReferences {
  const tactics: Array<string> = [];
  const techniques: Array<string> = [];

  for (const threat of threats) {
    const tacticId: string = readFieldString(threat, "tactic.id");

    if (tacticId) {
      tactics.push(tacticId);
    }

    for (const technique of readFieldObjects(threat, "technique")) {
      const techniqueId: string = readFieldString(technique, "id");

      if (techniqueId) {
        techniques.push(techniqueId);
      }

      for (const subtechnique of readFieldObjects(technique, "subtechnique")) {
        const subtechniqueId: string = readFieldString(subtechnique, "id");

        if (subtechniqueId) {
          techniques.push(subtechniqueId);
        }
      }
    }
  }

  return {
    tactics: buildObservables(tactics),
    techniques: buildObservables(techniques),
  };
}

interface AlertParts {
  id: string;
  index: string;
  source: JSONObject;
}

/*
 * Accept either a search hit ({ _id, _index, _source }) or a bare alert
 * document.
 */
function splitHit(raw: JSONObject): AlertParts {
  const source: JSONValue | undefined = raw["_source"];

  if (isJsonObject(source)) {
    return {
      id: readFieldString(raw, "_id"),
      index: readFieldString(raw, "_index"),
      source: source,
    };
  }

  return {
    id: "",
    index: readFieldString(raw, "_index"),
    source: raw,
  };
}

export default class ElasticSecurityNormalizer {
  /*
   * A document is an Elastic Security alert when it carries the rule
   * registry's alert fields or is marked event.kind "signal" (which the
   * alert schema guarantees for every alert document).
   */
  public static isRecognized(raw: JSONObject): boolean {
    if (!isJsonObject(raw)) {
      return false;
    }

    const { source } = splitHit(raw);

    return Boolean(
      readFieldString(source, "kibana.alert.rule.uuid") ||
        readFieldString(source, "kibana.alert.uuid") ||
        readFieldString(source, "kibana.alert.rule.name") ||
        readFieldString(source, "event.kind").toLowerCase() === "signal",
    );
  }

  public static normalize(raw: JSONObject): NormalizedSecurityEvent {
    const { id, index, source } = splitHit(raw);

    const ruleName: string = readFieldString(source, "kibana.alert.rule.name");
    const ruleId: string =
      readFieldString(source, "kibana.alert.rule.uuid") ||
      readFieldString(source, "kibana.alert.rule.rule_id");
    const description: string = readFieldString(
      source,
      "kibana.alert.rule.description",
    );
    const reason: string = readFieldString(source, "kibana.alert.reason");

    const severityName: OcsfSeverity =
      normalizeOcsfSeverity(readFieldString(source, "kibana.alert.severity")) ||
      severityFromRiskScore(
        readFieldNumber(source, "kibana.alert.risk_score"),
      ) ||
      OcsfSeverity.Unknown;

    /*
     * Event time is the time of the ACTIVITY the alert describes:
     * original_time is the matched source event's @timestamp; start is the
     * alerting framework's first-detected time; the alert's own @timestamp
     * (rule execution time) is the last resort. The connector pages on
     * @timestamp separately, so this choice never affects polling.
     */
    const time: Date | null =
      parseEventTime(readField(source, "kibana.alert.original_time")) ||
      parseEventTime(readField(source, "kibana.alert.start")) ||
      parseEventTime(readField(source, "@timestamp"));

    const threats: Array<JSONObject> = readFieldObjects(
      source,
      "kibana.alert.rule.threat",
    );
    const mitre: MitreReferences = collectMitre(
      threats.length > 0
        ? threats
        : readFieldObjects(source, "kibana.alert.rule.parameters.threat"),
    );

    const hostName: string = readFieldString(source, "host.name");
    const hostIps: Array<string> = readFieldStrings(source, "host.ip");
    const userName: string = readFieldString(source, "user.name");
    const targetUserName: string = readFieldString(source, "user.target.name");
    const sourceIp: string = readFieldString(source, "source.ip");
    const destinationIp: string = readFieldString(source, "destination.ip");
    const destinationDomain: string = readFieldString(
      source,
      "destination.domain",
    );
    const processName: string =
      readFieldString(source, "process.name") ||
      readFieldString(source, "process.executable");
    const filePath: string = readFieldString(source, "file.path");

    const { categoryUid, categoryName } = ocsfCategoryForClassUid(
      DETECTION_FINDING_CLASS_UID,
    );

    const attributes: JSONObject = flattenPayload(source);

    if (index) {
      attributes["_index"] = index;
    }

    if (id) {
      attributes["_id"] = id;
    }

    return {
      time: time || new Date(),
      /*
       * The search hit's _id is the alert's stable identifier (it equals
       * kibana.alert.uuid for detection alerts); a bare document falls
       * back to that field, then to a content hash.
       */
      eventUid:
        id ||
        readFieldString(source, "kibana.alert.uuid") ||
        contentHashEventUid(raw),
      categoryUid,
      categoryName,
      classUid: DETECTION_FINDING_CLASS_UID,
      className: DETECTION_FINDING_CLASS_NAME,
      activityName: "Create",
      severityId: OcsfSeverityId[severityName],
      severityName,
      statusName: readFieldString(source, "kibana.alert.workflow_status"),
      message: reason || ruleName || description || "Elastic Security alert",
      vendorName: ELASTIC_SECURITY_VENDOR_NAME,
      productName: ELASTIC_SECURITY_PRODUCT_NAME,
      ruleId,
      ruleName,
      mitreTactics: mitre.tactics,
      mitreTechniques: mitre.techniques,
      principalUser: userName,
      principalHost: hostName,
      principalIp: sourceIp || hostIps[0] || "",
      principalProcess: processName,
      targetUser: targetUserName,
      targetHost: destinationDomain,
      targetIp: destinationIp,
      targetPort: readFieldNumber(source, "destination.port") || 0,
      targetResource: filePath,
      observables: buildObservables([
        userName,
        targetUserName,
        ...readFieldStrings(source, "related.user"),
        hostName,
        ...readFieldStrings(source, "related.hosts"),
        ...hostIps,
        sourceIp,
        destinationIp,
        ...readFieldStrings(source, "related.ip"),
        destinationDomain,
        readFieldString(source, "dns.question.name"),
        readFieldString(source, "url.domain"),
        processName,
        readFieldString(source, "file.hash.sha256"),
        readFieldString(source, "file.hash.sha1"),
        readFieldString(source, "file.hash.md5"),
        ...readFieldStrings(source, "related.hash"),
      ]),
      attributes,
    };
  }
}

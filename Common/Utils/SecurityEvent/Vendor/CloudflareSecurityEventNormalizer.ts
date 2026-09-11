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

const DETECTION_FINDING_CLASS_UID: number = 2004;
const HTTP_URL_PATTERN: RegExp = /^https?:\/\//i;

const SECURITY_SOURCES: Set<string> = new Set<string>([
  "asn",
  "country",
  "ip",
  "iprange",
  "securitylevel",
  "zonelockdown",
  "waf",
  "firewallrules",
  "uablock",
  "ratelimit",
  "bic",
  "l7ddos",
  "validation",
  "botfight",
  "apishield",
  "botmanagement",
  "dlp",
  "firewallmanaged",
  "firewallcustom",
  "apishieldschemavalidation",
  "apishieldtokenvalidation",
  "apishieldsequencemitigation",
]);

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
 * Covers Logpush/export records, REST result arrays, and the two common
 * zone/account GraphQL Analytics response paths.
 */
function unwrapEvent(payload: JSONObject): JSONObject {
  const candidates: Array<JSONValue> = [
    readValue(payload, "result"),
    readValue(payload, "data.viewer.zones.firewallEventsAdaptive"),
    readValue(payload, "data.viewer.accounts.firewallEventsAdaptive"),
    readValue(payload, "firewallEventsAdaptive"),
  ];

  let event: JSONObject = payload;

  for (const candidate of candidates) {
    const first: JSONObject | undefined = objectArray(candidate)[0];
    if (first) {
      event = first;
      break;
    }
  }

  return objectValue(readValue(event, "dimensions")) || event;
}

function readAny(payload: JSONObject, paths: Array<string>): string {
  for (const path of paths) {
    const value: string = readString(payload, path);
    if (value) {
      return value;
    }
  }

  return "";
}

function prettyAction(action: string): string {
  if (!action) {
    return "";
  }

  return action
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character: string): string => {
      return character.toUpperCase();
    });
}

function statusForAction(action: string): string {
  const normalized: string = action.toLowerCase().replace(/[_-]+/g, "");

  if (
    normalized === "block" ||
    normalized === "connectionclose" ||
    normalized === "forceconnectionclose"
  ) {
    return "Blocked";
  }

  if (
    normalized === "allow" ||
    normalized === "bypass" ||
    normalized.includes("solved") ||
    normalized.includes("bypassed")
  ) {
    return "Allowed";
  }

  if (normalized.includes("challenge")) {
    return "Challenge";
  }

  if (normalized === "log") {
    return "Logged";
  }

  return prettyAction(action);
}

function productForSource(source: string): string {
  const products: Record<string, string> = {
    waf: "Cloudflare WAF",
    firewallmanaged: "Cloudflare WAF",
    firewallcustom: "Cloudflare WAF",
    firewallrules: "Cloudflare WAF",
    ratelimit: "Cloudflare Rate Limiting",
    l7ddos: "Cloudflare DDoS Protection",
    botfight: "Cloudflare Bot Management",
    botmanagement: "Cloudflare Bot Management",
    apishield: "Cloudflare API Shield",
    apishieldschemavalidation: "Cloudflare API Shield",
    apishieldtokenvalidation: "Cloudflare API Shield",
    apishieldsequencemitigation: "Cloudflare API Shield",
    dlp: "Cloudflare Data Loss Prevention",
    bic: "Cloudflare Browser Integrity Check",
  };

  return products[source.toLowerCase()] || "Cloudflare Security Events";
}

function targetResourceFor(event: JSONObject): string {
  const uri: string = readAny(event, [
    "ClientRequestURI",
    "clientRequestURI",
    "uri",
  ]);

  if (HTTP_URL_PATTERN.test(uri)) {
    return uri;
  }

  const host: string = readAny(event, [
    "ClientRequestHost",
    "clientRequestHTTPHost",
    "clientRequestHost",
    "host",
    "ZoneName",
  ]);
  const path: string =
    uri || readAny(event, ["ClientRequestPath", "clientRequestPath", "path"]);
  const query: string = readAny(event, [
    "ClientRequestQuery",
    "clientRequestQuery",
  ]);

  if (!host) {
    return path;
  }

  const scheme: string =
    readAny(event, ["ClientRequestScheme", "clientRequestScheme"]) || "https";
  const normalizedPath: string = path
    ? path.startsWith("/")
      ? path
      : `/${path}`
    : "";

  return `${scheme}://${host}${normalizedPath}${query ? `?${query}` : ""}`;
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

function eventUid(
  event: JSONObject,
  payload: JSONObject,
  source: string,
  action: string,
  ruleId: string,
): string {
  const explicitId: string = readAny(event, ["id", "eventId", "EventID"]);

  if (explicitId) {
    return explicitId;
  }

  const rayId: string = readAny(event, ["RayID", "rayName", "ray_id"]);

  if (rayId && ruleId) {
    return `${rayId}:${ruleId}:${source}:${action}`;
  }

  return rayId || contentHashEventUid(payload);
}

export default class CloudflareSecurityEventNormalizer {
  public static isCloudflareSecurityEvent(payload: JSONObject): boolean {
    const event: JSONObject = unwrapEvent(payload);
    const source: string = readAny(event, ["Source", "source"]).toLowerCase();
    const rayId: string = readAny(event, ["RayID", "rayName", "ray_id"]);
    const action: string = readAny(event, ["Action", "action"]);

    return Boolean(
      SECURITY_SOURCES.has(source) ||
        (rayId &&
          action &&
          readAny(event, ["ClientIP", "clientIP", "client_ip"])),
    );
  }

  public static normalize(payload: JSONObject): NormalizedSecurityEvent {
    const event: JSONObject = unwrapEvent(payload);
    const action: string = readAny(event, ["Action", "action"]);
    const source: string = readAny(event, ["Source", "source"]);
    const ruleId: string = readAny(event, [
      "RuleID",
      "ruleId",
      "rule_id",
      "Ref",
      "ref",
    ]);
    const ruleName: string = readAny(event, [
      "Description",
      "description",
      "RuleName",
      "ruleName",
    ]);
    const principalIp: string = readAny(event, [
      "ClientIP",
      "clientIP",
      "client_ip",
    ]);
    const targetHost: string = readAny(event, [
      "ClientRequestHost",
      "clientRequestHTTPHost",
      "clientRequestHost",
      "host",
      "ZoneName",
    ]);
    const targetIp: string = readAny(event, ["OriginIP", "originIP"]);
    const targetResource: string = targetResourceFor(event);
    const severityName: OcsfSeverity =
      normalizeOcsfSeverity(
        readAny(event, [
          "Severity",
          "severity",
          "RuleSeverity",
          "ruleSeverity",
          "Metadata.severity",
          "metadata.severity",
        ]),
      ) || OcsfSeverity.Unknown;
    const attributes: JSONObject = flattenPayload(payload);
    const time: Date | null = parseEventTime(
      readValue(event, "Datetime") ??
        readValue(event, "datetime") ??
        readValue(event, "EdgeStartTimestamp") ??
        readValue(event, "timestamp"),
    );
    const { categoryUid, categoryName } = ocsfCategoryForClassUid(
      DETECTION_FINDING_CLASS_UID,
    );

    return {
      time: time || new Date(),
      eventUid: eventUid(event, payload, source, action, ruleId),
      categoryUid,
      categoryName,
      classUid: DETECTION_FINDING_CLASS_UID,
      className: "Detection Finding",
      activityName: prettyAction(action),
      severityId: OcsfSeverityId[severityName],
      severityName,
      statusName: statusForAction(action),
      message:
        ruleName ||
        (action && principalIp
          ? `${prettyAction(action)} request from ${principalIp}`
          : "Cloudflare security event"),
      vendorName: "Cloudflare",
      productName: productForSource(source),
      ruleId,
      ruleName,
      mitreTactics: extractMitreIds(attributes, "tactic"),
      mitreTechniques: extractMitreIds(attributes, "technique"),
      principalUser: readAny(event, ["FraudUserID", "fraudUserId"]),
      principalHost: "",
      principalIp,
      principalProcess: "",
      targetUser: "",
      targetHost,
      targetIp,
      targetPort:
        readNumber(event, "OriginPort") || readNumber(event, "originPort") || 0,
      targetResource,
      observables: buildObservables([
        principalIp,
        targetHost,
        targetIp,
        targetResource,
      ]),
      attributes,
    };
  }
}

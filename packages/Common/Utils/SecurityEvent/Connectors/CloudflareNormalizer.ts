import { JSONObject, JSONValue } from "../../../Types/JSON";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity, {
  OcsfSeverityId,
} from "../../../Types/SecurityEvent/OcsfSeverity";
import { ocsfCategoryForClassUid } from "../../../Types/SecurityEvent/OcsfEventClass";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import EdgeAction, {
  EDGE_ACTIONS_STOPPED_AT_THE_EDGE,
  EDGE_ACTION_ATTRIBUTE,
  EDGE_SAMPLE_INTERVAL_ATTRIBUTE,
  readEdgeSampleInterval,
} from "../../../Types/SecurityEvent/EdgeAction";
import SecurityEventRequestOutcome, {
  SECURITY_REQUEST_ATTRIBUTES,
} from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import lookupTable from "../../LookupTable";
import {
  buildObservables,
  contentHashEventUid,
  parseEventTime,
  readString,
  readValue,
} from "../NormalizerHelpers";
import { requestOutcomeFromStatusCode } from "../RequestOutcome";
import {
  WEB_ATTACK_KIND_ATTRIBUTE,
  WEB_HTTP_ACTIVITY_CLASS_UID,
  WebAttackKind,
  readWebAttackKind,
} from "../LogParsers/WebAttackLogParser";

/*
 * Cloudflare firewall event (one row of the GraphQL Analytics API's
 * firewallEventsAdaptive dataset,
 * https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-firewall-events/)
 * -> OCSF HTTP Activity.
 *
 * A row is one rule acting on one request at Cloudflare's edge: the request
 * (clientIP, clientRequestHTTPHost, clientRequestPath, clientRequestQuery,
 * clientRequestHTTPMethodName, userAgent), what acted on it (`source`: WAF
 * managed or custom rules, rate limiting, IP Access rules, bot management,
 * HTTP DDoS protection ...; `ruleId`, `description`) and what it did
 * (`action`: block, managed_challenge, jschallenge, log, skip ...), with the
 * request's Ray ID (`rayName`), the rule's place in the chain
 * (`matchIndex`), the visitor's country and ASN, and `sampleInterval`: the
 * dataset is adaptively sampled, so a row stands for that many requests
 * like it when the edge was busy.
 *
 * Cloudflare spells its actions and sources three ways - snake_case in the
 * dashboard's filters (managed_challenge), camelCase in its field reference
 * (managedChallenge) and all lowercase in Logpush (managedchallenge) - so
 * every value is read without regard to case or separators, and stored in
 * the camelCase its field reference uses
 * (https://developers.cloudflare.com/logs/reference/security-fields/).
 *
 * The event says what the edge did in OneUptime's own vocabulary too
 * (EdgeAction under oneuptime.edge.action), and how far the request got
 * (requestOutcome): a request the edge blocked or challenged never reached
 * the app (Rejected); one it logged, or let through on a rule of the
 * customer's own, reached the origin, and the status the origin answered
 * says how it went there. A challenge passed says only that the visitor
 * passed it, so it carries no outcome.
 *
 * Pure and isomorphic: imports only Common/Types and Common/Utils.
 */

export const CLOUDFLARE_HTTP_ACTIVITY_CLASS_NAME: string = "HTTP Activity";

// The attribute keys a Cloudflare event carries, beside the OpenTelemetry request attributes.
export const CLOUDFLARE_ATTRIBUTES: {
  rayId: string;
  zoneId: string;
  zoneName: string;
  action: string;
  source: string;
  ruleId: string;
  rulesetId: string;
  ruleRef: string;
  ruleDescription: string;
  matchIndex: string;
  sampleInterval: string;
  originatorRayId: string;
  country: string;
  asn: string;
  asnName: string;
  colo: string;
  edgeStatusCode: string;
  originStatusCode: string;
  scheme: string;
  protocol: string;
  wafAttackScoreClass: string;
  botScore: string;
} = {
  rayId: "cloudflare.ray_id",
  zoneId: "cloudflare.zone.id",
  zoneName: "cloudflare.zone.name",
  action: "cloudflare.action",
  source: "cloudflare.source",
  ruleId: "cloudflare.rule.id",
  rulesetId: "cloudflare.ruleset.id",
  ruleRef: "cloudflare.rule.ref",
  ruleDescription: "cloudflare.rule.description",
  matchIndex: "cloudflare.match_index",
  sampleInterval: "cloudflare.sample_interval",
  originatorRayId: "cloudflare.originator_ray_id",
  country: "cloudflare.client.country",
  asn: "cloudflare.client.asn",
  asnName: "cloudflare.client.asn_name",
  colo: "cloudflare.edge.colo",
  edgeStatusCode: "cloudflare.edge.status_code",
  originStatusCode: "cloudflare.origin.status_code",
  scheme: "cloudflare.request.scheme",
  protocol: "cloudflare.request.protocol",
  wafAttackScoreClass: "cloudflare.waf.attack_score_class",
  botScore: "cloudflare.bot.score",
};

// Where a firewall event was read from: the zone the query named.
export interface CloudflareZoneContext {
  zoneTag: string;
  zoneName: string;
}

/*
 * Each action as Cloudflare's field reference spells it, by its key: the
 * action lowercased, with its separators removed.
 */
const CANONICAL_ACTIONS: ReadonlyMap<string, string> = lookupTable<string>({
  unknown: "unknown",
  allow: "allow",
  block: "block",
  challenge: "challenge",
  jschallenge: "jschallenge",
  managedchallenge: "managedChallenge",
  log: "log",
  skip: "skip",
  bypass: "bypass",
  drop: "drop",
  connectionclose: "connectionClose",
  forceconnectionclose: "forceConnectionClose",
  challengesolved: "challengeSolved",
  challengefailed: "challengeFailed",
  challengebypassed: "challengeBypassed",
  jschallengesolved: "jschallengeSolved",
  jschallengefailed: "jschallengeFailed",
  jschallengebypassed: "jschallengeBypassed",
  managedchallengenoninteractivesolved: "managedChallengeNonInteractiveSolved",
  managedchallengeinteractivesolved: "managedChallengeInteractiveSolved",
  managedchallengebypassed: "managedChallengeBypassed",
  managedchallengeskipped: "managedChallengeSkipped",
  managedchallengefailed: "managedChallengeFailed",
  precursorinterstitialpageissued: "precursorInterstitialPageIssued",
  precursorinterstitialpagebypassed: "precursorInterstitialPageBypassed",
  precursorinterstitialpagesolved: "precursorInterstitialPageSolved",
  precursorinterstitialpageissuancewithheld:
    "precursorInterstitialPageIssuanceWithheld",
});

// What each action did, in OneUptime's own words (EdgeAction), by its key.
const EDGE_ACTIONS: ReadonlyMap<string, EdgeAction> = lookupTable<EdgeAction>({
  block: EdgeAction.Blocked,
  drop: EdgeAction.Blocked,
  connectionclose: EdgeAction.Blocked,
  forceconnectionclose: EdgeAction.Blocked,
  challengefailed: EdgeAction.Blocked,
  jschallengefailed: EdgeAction.Blocked,
  managedchallengefailed: EdgeAction.Blocked,
  challenge: EdgeAction.Challenged,
  jschallenge: EdgeAction.Challenged,
  managedchallenge: EdgeAction.Challenged,
  precursorinterstitialpageissued: EdgeAction.Challenged,
  challengesolved: EdgeAction.PassedChallenge,
  challengebypassed: EdgeAction.PassedChallenge,
  jschallengesolved: EdgeAction.PassedChallenge,
  jschallengebypassed: EdgeAction.PassedChallenge,
  managedchallengenoninteractivesolved: EdgeAction.PassedChallenge,
  managedchallengeinteractivesolved: EdgeAction.PassedChallenge,
  managedchallengebypassed: EdgeAction.PassedChallenge,
  managedchallengeskipped: EdgeAction.PassedChallenge,
  precursorinterstitialpagesolved: EdgeAction.PassedChallenge,
  precursorinterstitialpagebypassed: EdgeAction.PassedChallenge,
  log: EdgeAction.Logged,
  skip: EdgeAction.LetThrough,
  allow: EdgeAction.LetThrough,
  bypass: EdgeAction.LetThrough,
});

/*
 * OCSF's disposition for each edge action (disposition_id: 1 Allowed,
 * 2 Blocked, 6 Dropped, 17 Logged, 23 Challenge, 99 Other), stored as the
 * event's status: what the firewall decided.
 */
interface Disposition {
  id: number;
  name: string;
}

const DISPOSITIONS: Record<EdgeAction, Disposition> = {
  [EdgeAction.Blocked]: { id: 2, name: "Blocked" },
  [EdgeAction.Challenged]: { id: 23, name: "Challenge" },
  [EdgeAction.PassedChallenge]: { id: 1, name: "Allowed" },
  [EdgeAction.Logged]: { id: 17, name: "Logged" },
  [EdgeAction.LetThrough]: { id: 1, name: "Allowed" },
  [EdgeAction.Other]: { id: 99, name: "Other" },
};

// A closed connection is dropped, not answered with a block page.
const DROPPED_ACTION_KEYS: ReadonlyArray<string> = [
  "drop",
  "connectionclose",
  "forceconnectionclose",
];

/*
 * Each source as Cloudflare's field reference spells it, with the name of
 * the product it stands for, by its key.
 */
interface CloudflareSource {
  value: string;
  label: string;
}

const SOURCES: ReadonlyMap<string, CloudflareSource> =
  lookupTable<CloudflareSource>({
    unknown: { value: "unknown", label: "Cloudflare" },
    asn: { value: "asn", label: "IP Access rules (ASN)" },
    country: { value: "country", label: "IP Access rules (country)" },
    ip: { value: "ip", label: "IP Access rules" },
    iprange: { value: "ipRange", label: "IP Access rules (IP range)" },
    securitylevel: { value: "securityLevel", label: "Security Level" },
    zonelockdown: { value: "zoneLockdown", label: "Zone Lockdown" },
    waf: { value: "waf", label: "WAF (legacy)" },
    firewallrules: { value: "firewallRules", label: "Firewall Rules" },
    uablock: { value: "uaBlock", label: "User Agent Blocking" },
    ratelimit: { value: "rateLimit", label: "Rate limiting rules" },
    bic: { value: "bic", label: "Browser Integrity Check" },
    hot: { value: "hot", label: "Hotlink Protection" },
    l7ddos: { value: "l7ddos", label: "HTTP DDoS protection" },
    validation: { value: "validation", label: "Request validation" },
    botfight: { value: "botFight", label: "Bot Fight Mode" },
    apishield: { value: "apiShield", label: "API Shield" },
    botmanagement: { value: "botManagement", label: "Bot Management" },
    dlp: { value: "dlp", label: "Data Loss Prevention" },
    firewallmanaged: { value: "firewallManaged", label: "WAF managed rules" },
    firewallcustom: { value: "firewallCustom", label: "WAF custom rules" },
    apishieldschemavalidation: {
      value: "apiShieldSchemaValidation",
      label: "API Shield schema validation",
    },
    apishieldtokenvalidation: {
      value: "apiShieldTokenValidation",
      label: "API Shield token validation",
    },
    apishieldsequencemitigation: {
      value: "apiShieldSequenceMitigation",
      label: "API Shield sequence mitigation",
    },
  });

/*
 * The sources whose rules look for attacks in what a request carries: a hit
 * is an exploit attempt (ATT&CK T1190) whatever its target says.
 */
const EXPLOIT_SOURCES: ReadonlyArray<string> = ["firewallManaged", "waf"];

// What WAF attack scoring calls a request it believes carries an attack.
const ATTACK_SCORE_CLASSES: ReadonlyArray<string> = ["attack", "likelyattack"];

// How the message names each edge action.
const ACTION_PHRASES: Record<EdgeAction, string> = {
  [EdgeAction.Blocked]: "Cloudflare blocked",
  [EdgeAction.Challenged]: "Cloudflare challenged",
  [EdgeAction.PassedChallenge]: "Passed a Cloudflare challenge",
  [EdgeAction.Logged]: "Cloudflare logged",
  [EdgeAction.LetThrough]: "Cloudflare let through",
  [EdgeAction.Other]: "Cloudflare acted on",
};

const MAX_TARGET_LENGTH: number = 2000;
const MAX_MESSAGE_TARGET_LENGTH: number = 300;
const MAX_ATTRIBUTE_LENGTH: number = 1000;

function readText(raw: JSONObject, key: string): string {
  return readString(raw, key).trim();
}

function readWholeNumber(raw: JSONObject, key: string): number {
  const value: JSONValue = readValue(raw, key);
  const number: number =
    typeof value === "number" ? value : Number(String(value ?? "").trim());

  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function cut(text: string, length: number): string {
  return text.length > length ? text.slice(0, length) : text;
}

// The key an action or a source is looked up by: lowercased, its separators removed.
export function cloudflareValueKey(value: string): string {
  let key: string = "";

  for (const character of value.toLowerCase()) {
    if (
      (character >= "a" && character <= "z") ||
      (character >= "0" && character <= "9")
    ) {
      key += character;
    }
  }

  return key;
}

export default class CloudflareNormalizer {
  private static getDefinition(): SecurityEventConnectorDefinition {
    const definition: SecurityEventConnectorDefinition | undefined =
      getSecurityEventConnectorDefinition(
        SecurityEventConnectorProvider.Cloudflare,
      );

    if (!definition) {
      throw new Error("Cloudflare is missing from the connector catalog.");
    }

    return definition;
  }

  // An action as Cloudflare's field reference spells it; an unknown one as it came.
  public static canonicalAction(action: string): string {
    const trimmed: string = (action || "").trim();

    return CANONICAL_ACTIONS.get(cloudflareValueKey(trimmed)) || trimmed;
  }

  // A source as Cloudflare's field reference spells it; an unknown one as it came.
  public static canonicalSource(source: string): string {
    const trimmed: string = (source || "").trim();

    return SOURCES.get(cloudflareValueKey(trimmed))?.value || trimmed;
  }

  // The product a source stands for, as the event's message names it.
  public static sourceLabel(source: string): string {
    const trimmed: string = (source || "").trim();

    return (
      SOURCES.get(cloudflareValueKey(trimmed))?.label || trimmed || "Cloudflare"
    );
  }

  public static edgeActionFor(action: string): EdgeAction {
    return EDGE_ACTIONS.get(cloudflareValueKey(action || "")) || EdgeAction.Other;
  }

  /*
   * A firewall event: it says when, and names the request (its Ray ID or
   * its client address) and what the edge did. Anything else the API might
   * hand back - an error object in the list, a row of another dataset - is
   * rejected rather than imported as an event about nothing.
   */
  public static isRecognized(raw: JSONObject): boolean {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return false;
    }

    return (
      parseEventTime(readValue(raw, "datetime")) !== null &&
      Boolean(readText(raw, "rayName") || readText(raw, "clientIP")) &&
      Boolean(readText(raw, "action"))
    );
  }

  // The attack a request carries in its target or its user agent, or null.
  public static readAttackKind(raw: JSONObject): WebAttackKind | null {
    const target: string = CloudflareNormalizer.readTarget(raw);

    return (
      (target ? readWebAttackKind(target) : null) ||
      readWebAttackKind(readText(raw, "userAgent")) ||
      null
    );
  }

  /*
   * Whether the event belongs among the project's security events. A
   * request a rule of the customer's own let through (skip, allow) is one
   * only when it carries an attack: in what it asked for, or in Cloudflare's
   * own scoring of it. The rest is the traffic the customer allowlisted -
   * their monitors, their partners' APIs - and imported, every one of those
   * requests would be a "campaign" of its own.
   */
  public static isSecurityRelevant(raw: JSONObject): boolean {
    if (
      CloudflareNormalizer.edgeActionFor(readText(raw, "action")) !==
      EdgeAction.LetThrough
    ) {
      return true;
    }

    if (CloudflareNormalizer.readAttackKind(raw)) {
      return true;
    }

    return ATTACK_SCORE_CLASSES.includes(
      cloudflareValueKey(readText(raw, "wafAttackScoreClass")),
    );
  }

  /*
   * The event's identity, stable across the reads that overlap: the zone,
   * the request's Ray ID and the rule's place in the chain (one request can
   * meet several rules: a managed rule that logs, then a custom rule that
   * blocks), with what acted and how, so two rows of one request never
   * collapse into one. A row with no Ray ID is identified by its content.
   */
  public static eventUid(raw: JSONObject, zone: CloudflareZoneContext): string {
    const rayName: string = readText(raw, "rayName");

    if (!rayName) {
      return contentHashEventUid(raw);
    }

    return [
      "cloudflare",
      zone.zoneTag,
      rayName,
      String(readWholeNumber(raw, "matchIndex")),
      CloudflareNormalizer.canonicalSource(readText(raw, "source")),
      readText(raw, "ruleId"),
      CloudflareNormalizer.canonicalAction(readText(raw, "action")),
    ].join(":");
  }

  // What the request asked for: its path and query, as an access log line records it.
  public static readTarget(raw: JSONObject): string {
    const path: string = readText(raw, "clientRequestPath");
    const query: string = readText(raw, "clientRequestQuery");

    if (!query) {
      return path;
    }

    return `${path}${query.startsWith("?") ? "" : "?"}${query}`;
  }

  /*
   * How far the request got. The edge blocked or challenged it: it never
   * reached the app. The edge logged it, or a rule let it through: the
   * origin's answer says how it went there, when Cloudflare saw one (a
   * cached answer has none). A challenge passed, or anything else, says
   * nothing about the request.
   */
  public static requestOutcomeFor(
    raw: JSONObject,
  ): SecurityEventRequestOutcome | undefined {
    const action: EdgeAction = CloudflareNormalizer.edgeActionFor(
      readText(raw, "action"),
    );

    if (EDGE_ACTIONS_STOPPED_AT_THE_EDGE.includes(action)) {
      return SecurityEventRequestOutcome.Rejected;
    }

    if (action === EdgeAction.Logged || action === EdgeAction.LetThrough) {
      return requestOutcomeFromStatusCode(
        readWholeNumber(raw, "originResponseStatus") || Number.NaN,
      );
    }

    return undefined;
  }

  /*
   * How serious the event is, by what the edge did and how far the request
   * got: a request stopped at the edge is the firewall doing its job; one
   * it let through and the app failed on is somebody's evening. Log4Shell
   * runs when a vulnerable logger writes the string, whatever the edge did
   * after logging it.
   */
  public static severityFor(
    action: EdgeAction,
    outcome: SecurityEventRequestOutcome | undefined,
    attackKind: WebAttackKind | null,
  ): OcsfSeverity {
    if (action === EdgeAction.PassedChallenge) {
      return OcsfSeverity.Informational;
    }

    if (EDGE_ACTIONS_STOPPED_AT_THE_EDGE.includes(action)) {
      return OcsfSeverity.Low;
    }

    if (action === EdgeAction.Logged || action === EdgeAction.LetThrough) {
      if (attackKind === WebAttackKind.Log4Shell) {
        return OcsfSeverity.High;
      }

      switch (outcome) {
        case SecurityEventRequestOutcome.Errored:
          return OcsfSeverity.High;
        case SecurityEventRequestOutcome.Rejected:
          return OcsfSeverity.Low;
        default:
          return OcsfSeverity.Medium;
      }
    }

    return OcsfSeverity.Low;
  }

  public static normalize(
    raw: JSONObject,
    zone: CloudflareZoneContext,
  ): NormalizedSecurityEvent {
    const catalog: SecurityEventConnectorDefinition =
      CloudflareNormalizer.getDefinition();

    const rawAction: string = readText(raw, "action");
    const actionKey: string = cloudflareValueKey(rawAction);
    const action: string = CloudflareNormalizer.canonicalAction(rawAction);
    const edgeAction: EdgeAction = CloudflareNormalizer.edgeActionFor(rawAction);
    const source: string = CloudflareNormalizer.canonicalSource(
      readText(raw, "source"),
    );
    const sourceLabel: string = CloudflareNormalizer.sourceLabel(
      readText(raw, "source"),
    );
    const disposition: Disposition = DROPPED_ACTION_KEYS.includes(actionKey)
      ? { id: 6, name: "Dropped" }
      : actionKey === "unknown" || !actionKey
        ? { id: 0, name: "Unknown" }
        : DISPOSITIONS[edgeAction];

    const rayName: string = readText(raw, "rayName");
    const clientIp: string = readText(raw, "clientIP");
    const host: string = readText(raw, "clientRequestHTTPHost");
    const method: string = readText(
      raw,
      "clientRequestHTTPMethodName",
    ).toUpperCase();
    const target: string = cut(
      CloudflareNormalizer.readTarget(raw),
      MAX_TARGET_LENGTH,
    );
    const userAgent: string = readText(raw, "userAgent");
    const scheme: string = readText(raw, "clientRequestScheme").toLowerCase();
    const ruleId: string = readText(raw, "ruleId");
    const ruleDescription: string = readText(raw, "description");
    const edgeStatus: number = readWholeNumber(raw, "edgeResponseStatus");
    const originStatus: number = readWholeNumber(raw, "originResponseStatus");
    const sampleInterval: number = readEdgeSampleInterval(
      readValue(raw, "sampleInterval"),
    );

    const attackKind: WebAttackKind | null =
      CloudflareNormalizer.readAttackKind(raw);
    const outcome: SecurityEventRequestOutcome | undefined =
      CloudflareNormalizer.requestOutcomeFor(raw);
    const severityName: OcsfSeverity = CloudflareNormalizer.severityFor(
      edgeAction,
      outcome,
      attackKind,
    );

    const { categoryUid, categoryName } = ocsfCategoryForClassUid(
      WEB_HTTP_ACTIVITY_CLASS_UID,
    );

    const isExploitAttempt: boolean =
      Boolean(attackKind) || EXPLOIT_SOURCES.includes(source);
    const isFlood: boolean = source === "l7ddos";

    const attributes: JSONObject = {
      disposition: disposition.name,
      disposition_id: String(disposition.id),
      [EDGE_ACTION_ATTRIBUTE]: edgeAction,
      [EDGE_SAMPLE_INTERVAL_ATTRIBUTE]: String(sampleInterval),
      [CLOUDFLARE_ATTRIBUTES.zoneId]: zone.zoneTag,
      [CLOUDFLARE_ATTRIBUTES.action]: action,
      [CLOUDFLARE_ATTRIBUTES.source]: source,
      [CLOUDFLARE_ATTRIBUTES.sampleInterval]: String(sampleInterval),
      [CLOUDFLARE_ATTRIBUTES.matchIndex]: String(
        readWholeNumber(raw, "matchIndex"),
      ),
    };

    const setText: (key: string, value: string) => void = (
      key: string,
      value: string,
    ): void => {
      if (value) {
        attributes[key] = cut(value, MAX_ATTRIBUTE_LENGTH);
      }
    };

    setText(CLOUDFLARE_ATTRIBUTES.zoneName, zone.zoneName);
    setText(CLOUDFLARE_ATTRIBUTES.rayId, rayName);
    setText(CLOUDFLARE_ATTRIBUTES.ruleId, ruleId);
    setText(CLOUDFLARE_ATTRIBUTES.rulesetId, readText(raw, "rulesetId"));
    setText(CLOUDFLARE_ATTRIBUTES.ruleRef, readText(raw, "ref"));
    setText(CLOUDFLARE_ATTRIBUTES.ruleDescription, ruleDescription);
    // "00" is how Cloudflare writes "no challenged request before this one".
    const originatorRayName: string = readText(raw, "originatorRayName");
    setText(
      CLOUDFLARE_ATTRIBUTES.originatorRayId,
      /^0+$/.test(originatorRayName) ? "" : originatorRayName,
    );
    setText(CLOUDFLARE_ATTRIBUTES.country, readText(raw, "clientCountryName"));
    setText(CLOUDFLARE_ATTRIBUTES.asn, readText(raw, "clientAsn"));
    setText(CLOUDFLARE_ATTRIBUTES.asnName, readText(raw, "clientASNDescription"));
    setText(CLOUDFLARE_ATTRIBUTES.colo, readText(raw, "edgeColoName"));
    setText(CLOUDFLARE_ATTRIBUTES.scheme, scheme);
    setText(
      CLOUDFLARE_ATTRIBUTES.protocol,
      readText(raw, "clientRequestHTTPProtocol"),
    );
    setText(
      CLOUDFLARE_ATTRIBUTES.wafAttackScoreClass,
      readText(raw, "wafAttackScoreClass"),
    );
    setText(CLOUDFLARE_ATTRIBUTES.botScore, readText(raw, "botScore"));

    if (edgeStatus) {
      attributes[CLOUDFLARE_ATTRIBUTES.edgeStatusCode] = String(edgeStatus);
      attributes[SECURITY_REQUEST_ATTRIBUTES.statusCode] = String(edgeStatus);
    }

    if (originStatus) {
      attributes[CLOUDFLARE_ATTRIBUTES.originStatusCode] = String(originStatus);
    }

    setText(SECURITY_REQUEST_ATTRIBUTES.method, method);
    setText(SECURITY_REQUEST_ATTRIBUTES.clientAddress, clientIp);
    setText(SECURITY_REQUEST_ATTRIBUTES.userAgent, userAgent);

    if (host || target) {
      attributes[SECURITY_REQUEST_ATTRIBUTES.url] = cut(
        `${host ? `${scheme || "https"}://${host}` : ""}${target}`,
        MAX_TARGET_LENGTH,
      );
    }

    if (attackKind) {
      attributes[WEB_ATTACK_KIND_ATTRIBUTE] = attackKind;
    }

    const request: string = [
      method,
      cut(`${host}${target}`, MAX_MESSAGE_TARGET_LENGTH),
    ]
      .filter((part: string): boolean => {
        return Boolean(part);
      })
      .join(" ");
    const rule: string = ruleDescription
      ? `${sourceLabel}: ${ruleDescription}`
      : sourceLabel;
    const message: string = `${ACTION_PHRASES[edgeAction]}${
      request ? ` ${request}` : " a request"
    }${clientIp ? ` from ${clientIp}` : ""} (${rule})`;

    const time: Date | null = parseEventTime(readValue(raw, "datetime"));

    const event: NormalizedSecurityEvent = {
      time: time || new Date(),
      eventUid: CloudflareNormalizer.eventUid(raw, zone),
      categoryUid,
      categoryName,
      classUid: WEB_HTTP_ACTIVITY_CLASS_UID,
      className: CLOUDFLARE_HTTP_ACTIVITY_CLASS_NAME,
      activityName: method,
      severityId: OcsfSeverityId[severityName],
      severityName,
      statusName: disposition.name,
      message,
      vendorName: catalog.vendorName,
      productName: catalog.productName,
      ruleId,
      ruleName: ruleDescription || sourceLabel,
      mitreTactics: isExploitAttempt ? ["TA0001"] : isFlood ? ["TA0040"] : [],
      mitreTechniques: isExploitAttempt
        ? ["T1190"]
        : isFlood
          ? ["T1499"]
          : [],
      principalUser: "",
      principalHost: "",
      principalIp: clientIp,
      principalProcess: "",
      processName: "",
      processPath: "",
      processCommandLine: "",
      parentProcessName: "",
      parentProcessPath: "",
      parentProcessCommandLine: "",
      targetUser: "",
      targetHost: host,
      targetIp: "",
      targetPort: 0,
      targetResource: target,
      observables: buildObservables([clientIp, host]),
      attributes,
    };

    if (outcome) {
      event.requestOutcome = outcome;
    }

    return event;
  }
}

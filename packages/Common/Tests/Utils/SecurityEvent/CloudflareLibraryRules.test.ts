import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import {
  DetectionRuleDataKind,
  isDetectionRuleDataKindSeen,
} from "../../../Types/SecurityEvent/DetectionRuleDataKind";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryCategory,
  DetectionRuleLibraryEntry,
} from "../../../Types/SecurityEvent/DetectionRuleLibrary";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  DetectionRuleDefinition,
  SigmaCorrelationStep,
  SigmaCorrelationType,
} from "../../../Types/SecurityEvent/SigmaCorrelation";
import SigmaRule from "../../../Types/SecurityEvent/SigmaRule";
import SecurityEventRequestOutcome from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import CloudflareNormalizer from "../../../Utils/SecurityEvent/Connectors/CloudflareNormalizer";
import SecurityLogParser from "../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import SigmaRuleParser from "../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import SigmaRuleSetParser from "../../../Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import {
  ATTACKER_IP,
  CLOUDFLARE_ZONE,
  CUSTOM_RULE_MANAGED_CHALLENGE,
  HTTP_DDOS_DROP,
  MANAGED_CHALLENGE_PASSED,
  MANAGED_RULE_BLOCK,
  MANAGED_RULE_LOG,
  RATE_LIMIT_BLOCK,
  SECURITY_LEVEL_JS_CHALLENGE,
  SKIP_WITH_PATH_TRAVERSAL,
} from "./Connectors/CloudflareFixtures";
import { logLine } from "./LogParsers/LogParserFixtures";
import { sigmaRuleMatchesEvent } from "./LogParsers/SigmaTestMatcher";

/*
 * The Rule Library's Cloudflare rules against what Cloudflare's connection
 * imports (CloudflareNormalizer over recorded firewall events) and what the
 * app's own access logs make: each fires on what it is about, and stays
 * quiet on the firewall's everyday work and on the app's own requests.
 */

const MANY_MANAGED_RULE_HITS: string =
  "Many Cloudflare managed rule hits from one address";
const PASSED_CHALLENGE_THEN_ATTACKS: string =
  "An address passed a Cloudflare challenge, then sent attacks";
const LET_THROUGH_REACHED_APP: string =
  "An attack Cloudflare let through reached your app";

function entry(title: string): DetectionRuleLibraryEntry {
  const found: DetectionRuleLibraryEntry | undefined =
    DETECTION_RULE_LIBRARY.find(
      (candidate: DetectionRuleLibraryEntry): boolean => {
        return candidate.title === title;
      },
    );

  if (!found) {
    throw new Error(`No library rule titled ${title}`);
  }

  return found;
}

function cloudflare(raw: JSONObject): NormalizedSecurityEvent {
  return CloudflareNormalizer.normalize(raw, CLOUDFLARE_ZONE);
}

// A request the app's own access log recorded, from the attacker's address.
function fromAccessLog(
  target: string,
  status: number,
): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = SecurityLogParser.parse(
    logLine(
      `${ATTACKER_IP} - - [20/Nov/2026:10:45:00 +0000] "GET ${target} HTTP/1.1" ${status} 512 "-" "sqlmap/1.7"`,
    ),
  );

  expect(events).toHaveLength(1);

  return events[0]!;
}

function steps(title: string): Array<SigmaCorrelationStep> {
  const definition: DetectionRuleDefinition = SigmaRuleSetParser.parse(
    entry(title).sigmaRuleYaml,
  );

  if (definition.kind !== "correlation") {
    throw new Error(`${title} is not a correlation`);
  }

  return definition.steps;
}

function stepRule(title: string, index: number): SigmaRule {
  const rule: SigmaRule | undefined = steps(title)[index]?.rule;

  if (!rule) {
    throw new Error(`${title} has no rule at step ${index}`);
  }

  return rule;
}

describe("Cloudflare library rules - their place in the library", () => {
  test.each([
    MANY_MANAGED_RULE_HITS,
    PASSED_CHALLENGE_THEN_ATTACKS,
    LET_THROUGH_REACHED_APP,
  ])("%s reads Cloudflare's firewall events, in Web", (title: string) => {
    expect(entry(title)).toMatchObject({
      category: DetectionRuleLibraryCategory.Web,
      dataKind: DetectionRuleDataKind.Cloudflare,
    });
  });

  test("the Rule Library says they have something to read once Cloudflare's events arrive", () => {
    expect(
      isDetectionRuleDataKindSeen(DetectionRuleDataKind.Cloudflare, {
        classNames: ["HTTP Activity"],
        vendorNames: ["Cloudflare"],
        productNames: ["Cloudflare WAF"],
      }),
    ).toBe(true);
    // The app's own web requests are web requests, not Cloudflare's.
    expect(
      isDetectionRuleDataKindSeen(DetectionRuleDataKind.Cloudflare, {
        classNames: ["HTTP Activity"],
        vendorNames: ["OneUptime"],
        productNames: ["OneUptime Web Attack Detection"],
      }),
    ).toBe(false);
    // Cloudflare's events are web requests too: the library's web rules read them.
    expect(
      isDetectionRuleDataKindSeen(DetectionRuleDataKind.WebRequests, {
        classNames: ["HTTP Activity"],
        vendorNames: ["Cloudflare"],
        productNames: ["Cloudflare WAF"],
      }),
    ).toBe(true);
  });
});

describe(MANY_MANAGED_RULE_HITS, () => {
  const rule: SigmaRule = SigmaRuleParser.parse(
    entry(MANY_MANAGED_RULE_HITS).sigmaRuleYaml,
  );

  test("counts twenty managed rule hits from one address in ten minutes", () => {
    expect(entry(MANY_MANAGED_RULE_HITS)).toMatchObject({
      groupByField: "principalIp",
      matchCountThreshold: 20,
      evaluationIntervalInMinutes: 10,
    });
  });

  test("fires on a managed rule's block and on its log, and on the legacy WAF's", () => {
    expect(sigmaRuleMatchesEvent(rule, cloudflare(MANAGED_RULE_BLOCK))).toBe(
      true,
    );
    expect(sigmaRuleMatchesEvent(rule, cloudflare(MANAGED_RULE_LOG))).toBe(
      true,
    );
    expect(
      sigmaRuleMatchesEvent(
        rule,
        cloudflare({ ...MANAGED_RULE_BLOCK, source: "waf" }),
      ),
    ).toBe(true);
  });

  test("is quiet on what else the firewall does, and on the app's own requests", () => {
    for (const raw of [
      CUSTOM_RULE_MANAGED_CHALLENGE,
      MANAGED_CHALLENGE_PASSED,
      RATE_LIMIT_BLOCK,
      HTTP_DDOS_DROP,
      SECURITY_LEVEL_JS_CHALLENGE,
      SKIP_WITH_PATH_TRAVERSAL,
    ]) {
      expect(sigmaRuleMatchesEvent(rule, cloudflare(raw))).toBe(false);
    }

    expect(
      sigmaRuleMatchesEvent(
        rule,
        fromAccessLog("/products?id=1%27%20or%201%3D1--", 200),
      ),
    ).toBe(false);
  });
});

describe(PASSED_CHALLENGE_THEN_ATTACKS, () => {
  test("is a challenge passed, then an attack from the same address, within thirty minutes", () => {
    const definition: DetectionRuleDefinition = SigmaRuleSetParser.parse(
      entry(PASSED_CHALLENGE_THEN_ATTACKS).sigmaRuleYaml,
    );

    expect(definition.kind).toBe("correlation");

    if (definition.kind === "correlation") {
      expect(definition.correlation).toMatchObject({
        type: SigmaCorrelationType.TemporalOrdered,
        groupBy: ["principalIp"],
        timespanInSeconds: 1800,
      });
      expect(definition.unresolvedReferences).toEqual([]);
      expect(definition.steps).toHaveLength(2);
    }
  });

  test("its first step is a challenge passed, and nothing else", () => {
    const passed: SigmaRule = stepRule(PASSED_CHALLENGE_THEN_ATTACKS, 0);

    expect(
      sigmaRuleMatchesEvent(passed, cloudflare(MANAGED_CHALLENGE_PASSED)),
    ).toBe(true);

    for (const raw of [
      CUSTOM_RULE_MANAGED_CHALLENGE,
      MANAGED_RULE_BLOCK,
      MANAGED_RULE_LOG,
      SECURITY_LEVEL_JS_CHALLENGE,
    ]) {
      expect(sigmaRuleMatchesEvent(passed, cloudflare(raw))).toBe(false);
    }
  });

  test("its second step is an attack, at Cloudflare or in the app's own logs", () => {
    const attack: SigmaRule = stepRule(PASSED_CHALLENGE_THEN_ATTACKS, 1);

    expect(sigmaRuleMatchesEvent(attack, cloudflare(MANAGED_RULE_BLOCK))).toBe(
      true,
    );
    expect(
      sigmaRuleMatchesEvent(attack, cloudflare(SKIP_WITH_PATH_TRAVERSAL)),
    ).toBe(true);
    expect(
      sigmaRuleMatchesEvent(
        attack,
        fromAccessLog("/products?id=1%27%20or%201%3D1--", 404),
      ),
    ).toBe(true);
  });

  test("its second step is quiet on a challenge and on requests with no attack in them", () => {
    const attack: SigmaRule = stepRule(PASSED_CHALLENGE_THEN_ATTACKS, 1);

    for (const raw of [
      CUSTOM_RULE_MANAGED_CHALLENGE,
      MANAGED_CHALLENGE_PASSED,
      { ...RATE_LIMIT_BLOCK, clientRequestQuery: "" },
      HTTP_DDOS_DROP,
    ]) {
      expect(sigmaRuleMatchesEvent(attack, cloudflare(raw))).toBe(false);
    }
  });
});

describe(LET_THROUGH_REACHED_APP, () => {
  test("is Cloudflare letting an attack through and the app seeing the address, within fifteen minutes", () => {
    const definition: DetectionRuleDefinition = SigmaRuleSetParser.parse(
      entry(LET_THROUGH_REACHED_APP).sigmaRuleYaml,
    );

    expect(definition.kind).toBe("correlation");

    if (definition.kind === "correlation") {
      expect(definition.correlation).toMatchObject({
        type: SigmaCorrelationType.Temporal,
        groupBy: ["principalIp"],
        timespanInSeconds: 900,
      });
      expect(definition.unresolvedReferences).toEqual([]);
    }
  });

  test("its Cloudflare step is an attack logged or let through, never one stopped", () => {
    const letThrough: SigmaRule = stepRule(LET_THROUGH_REACHED_APP, 0);

    expect(
      sigmaRuleMatchesEvent(letThrough, cloudflare(MANAGED_RULE_LOG)),
    ).toBe(true);
    expect(
      sigmaRuleMatchesEvent(letThrough, cloudflare(SKIP_WITH_PATH_TRAVERSAL)),
    ).toBe(true);

    for (const raw of [
      MANAGED_RULE_BLOCK,
      CUSTOM_RULE_MANAGED_CHALLENGE,
      MANAGED_CHALLENGE_PASSED,
      HTTP_DDOS_DROP,
    ]) {
      expect(sigmaRuleMatchesEvent(letThrough, cloudflare(raw))).toBe(false);
    }
  });

  test("its app step is the app's own request that got past its front door, never Cloudflare's view of it", () => {
    const reached: SigmaRule = stepRule(LET_THROUGH_REACHED_APP, 1);
    const reachedApp: NormalizedSecurityEvent = fromAccessLog(
      "/products?id=1%27%20or%201%3D1--",
      200,
    );
    const errored: NormalizedSecurityEvent = fromAccessLog(
      "/files/../../etc/passwd",
      500,
    );
    const rejected: NormalizedSecurityEvent = fromAccessLog(
      "/products?id=1%27%20or%201%3D1--",
      403,
    );

    expect(reachedApp.requestOutcome).toBe(
      SecurityEventRequestOutcome.ReachedApp,
    );
    expect(sigmaRuleMatchesEvent(reached, reachedApp)).toBe(true);
    expect(sigmaRuleMatchesEvent(reached, errored)).toBe(true);
    expect(sigmaRuleMatchesEvent(reached, rejected)).toBe(false);

    // Cloudflare's own event says the origin answered 200: not the app's own evidence.
    const cloudflareSaysReached: NormalizedSecurityEvent =
      cloudflare(MANAGED_RULE_LOG);
    expect(cloudflareSaysReached.requestOutcome).toBe(
      SecurityEventRequestOutcome.ReachedApp,
    );
    expect(sigmaRuleMatchesEvent(reached, cloudflareSaysReached)).toBe(false);
  });
});

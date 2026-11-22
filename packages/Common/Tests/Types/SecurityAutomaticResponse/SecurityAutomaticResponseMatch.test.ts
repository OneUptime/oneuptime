import {
  SecurityAutomaticResponseMatch,
  SecurityAutomaticResponsePolicyKind,
  getReadySecurityAutomaticResponsePolicy,
} from "../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import {
  SecurityAutomaticResponseDetectionFacts,
  SecurityAutomaticResponseMatchResult,
  SecurityAutomaticResponseMismatch,
  doesSecurityTechniqueMatch,
  getSecurityAutomaticResponseAddress,
  isListedByThreatIntelDetection,
  matchSecurityAutomaticResponseDetection,
  wasEveryRequestTurnedAway,
} from "../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponseMatch";
import SecurityDetectionSource from "../../../Types/SecurityCase/SecurityDetectionSource";
import SecurityEventRequestOutcome from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import { describe, expect, test } from "@jest/globals";

/*
 * Which detections each ready policy acts on (#10350), and on which
 * address: Scanners on web scanning and exploit attempts every request of
 * which was turned away, Password Guessing on brute force and password
 * spraying, Known-Bad Addresses on any detection about an address threat
 * intel lists - always a public address the detection is about, never a
 * setup test, never an address the requests only claimed.
 */

const ATTACKER: string = "35.205.11.131";

function matchOf(
  kind: SecurityAutomaticResponsePolicyKind,
): SecurityAutomaticResponseMatch {
  return getReadySecurityAutomaticResponsePolicy(kind)!.match;
}

function facts(
  overrides: Partial<SecurityAutomaticResponseDetectionFacts> = {},
): SecurityAutomaticResponseDetectionFacts {
  return {
    source: SecurityDetectionSource.DetectionRule,
    detectionRuleId: "rule-1",
    mitreTechniques: [],
    groupValue: ATTACKER,
    outcomes: { [SecurityEventRequestOutcome.Rejected]: 12 },
    isThreatIntelListed: false,
    principalAddresses: [ATTACKER],
    ...overrides,
  };
}

function reasonOf(result: SecurityAutomaticResponseMatchResult): string {
  return result.matches ? "matches" : result.reason;
}

describe("Scanners", () => {
  const scanners: SecurityAutomaticResponseMatch = matchOf(
    SecurityAutomaticResponsePolicyKind.Scanners,
  );

  test("acts on a SQL injection, path traversal or Log4Shell attempt (T1190), every request turned away", () => {
    expect(
      matchSecurityAutomaticResponseDetection({
        match: scanners,
        facts: facts({ mitreTechniques: ["T1190"] }),
      }),
    ).toEqual({ matches: true, address: ATTACKER });
  });

  test("acts on vulnerability and wordlist scanning (T1595 and its sub-techniques)", () => {
    for (const technique of ["T1595", "T1595.002", "T1595.003"]) {
      expect(
        matchSecurityAutomaticResponseDetection({
          match: scanners,
          facts: facts({ mitreTechniques: ["T1059", technique] }),
        }).matches,
      ).toBe(true);
    }
  });

  test("leaves a request that reached a handler, broke the app or reached the database to a person", () => {
    for (const outcome of [
      SecurityEventRequestOutcome.ReachedApp,
      SecurityEventRequestOutcome.Errored,
      SecurityEventRequestOutcome.ReachedDatabase,
    ]) {
      expect(
        reasonOf(
          matchSecurityAutomaticResponseDetection({
            match: scanners,
            facts: facts({
              mitreTechniques: ["T1190"],
              outcomes: {
                [SecurityEventRequestOutcome.Rejected]: 30,
                [outcome]: 1,
              },
            }),
          }),
        ),
      ).toBe(SecurityAutomaticResponseMismatch.RequestsGotThrough);
    }
  });

  test("does not take a request whose outcome OneUptime could not follow as turned away", () => {
    expect(
      reasonOf(
        matchSecurityAutomaticResponseDetection({
          match: scanners,
          facts: facts({
            mitreTechniques: ["T1190"],
            outcomes: { [SecurityEventRequestOutcome.Rejected]: 4, "": 1 },
          }),
        }),
      ),
    ).toBe(SecurityAutomaticResponseMismatch.OutcomesUnknown);
    expect(
      reasonOf(
        matchSecurityAutomaticResponseDetection({
          match: scanners,
          facts: facts({ mitreTechniques: ["T1190"], outcomes: undefined }),
        }),
      ),
    ).toBe(SecurityAutomaticResponseMismatch.OutcomesUnknown);
  });

  test("is no brute force policy", () => {
    expect(
      reasonOf(
        matchSecurityAutomaticResponseDetection({
          match: scanners,
          facts: facts({ mitreTechniques: ["T1110.001"] }),
        }),
      ),
    ).toBe(SecurityAutomaticResponseMismatch.NotItsDetection);
  });
});

describe("Password Guessing", () => {
  const guessing: SecurityAutomaticResponseMatch = matchOf(
    SecurityAutomaticResponsePolicyKind.PasswordGuessing,
  );

  test("acts on brute force (T1110.001) and password spraying (T1110.003), whatever its requests did", () => {
    for (const technique of ["T1110", "T1110.001", "T1110.003"]) {
      expect(
        matchSecurityAutomaticResponseDetection({
          match: guessing,
          facts: facts({
            mitreTechniques: [technique],
            outcomes: { [SecurityEventRequestOutcome.ReachedApp]: 40 },
          }),
        }),
      ).toEqual({ matches: true, address: ATTACKER });
    }
  });

  test("never acts on a detection grouped on a user: there is no address to block", () => {
    expect(
      reasonOf(
        matchSecurityAutomaticResponseDetection({
          match: guessing,
          facts: facts({
            mitreTechniques: ["T1110"],
            groupValue: "jane@example.com",
          }),
        }),
      ),
    ).toBe(SecurityAutomaticResponseMismatch.NoAddress);
  });

  test("never acts on a technique whose id only starts the same", () => {
    expect(
      doesSecurityTechniqueMatch({
        policyTechniques: ["T1110"],
        detectionTechniques: ["T11100"],
      }),
    ).toBe(false);
  });
});

describe("Known-Bad Addresses", () => {
  const knownBad: SecurityAutomaticResponseMatch = matchOf(
    SecurityAutomaticResponsePolicyKind.KnownBadAddresses,
  );

  test("acts on a threat intel detection about the address", () => {
    expect(
      matchSecurityAutomaticResponseDetection({
        match: knownBad,
        facts: facts({
          source: SecurityDetectionSource.ThreatIntel,
          detectionRuleId: undefined,
          isThreatIntelListed: isListedByThreatIntelDetection({
            source: SecurityDetectionSource.ThreatIntel,
          }),
          // A feed matches any observable: the address can be one the app connected to.
          principalAddresses: ["10.0.0.4"],
        }),
      }),
    ).toEqual({ matches: true, address: ATTACKER });
  });

  test("acts on any detection about an address the project's feeds list", () => {
    expect(
      matchSecurityAutomaticResponseDetection({
        match: knownBad,
        facts: facts({ mitreTechniques: ["T1046"], isThreatIntelListed: true }),
      }).matches,
    ).toBe(true);
  });

  test("leaves an address no feed lists", () => {
    expect(
      reasonOf(
        matchSecurityAutomaticResponseDetection({
          match: knownBad,
          facts: facts({ isThreatIntelListed: false }),
        }),
      ),
    ).toBe(SecurityAutomaticResponseMismatch.NotListed);
  });

  test("is screened as a detection is recorded, before the feeds are read", () => {
    expect(
      matchSecurityAutomaticResponseDetection({
        match: knownBad,
        facts: facts({ isThreatIntelListed: null }),
      }).matches,
    ).toBe(true);
  });
});

describe("every policy", () => {
  const guessing: SecurityAutomaticResponseMatch = matchOf(
    SecurityAutomaticResponsePolicyKind.PasswordGuessing,
  );

  test("acts only on a public address", () => {
    for (const groupValue of [
      "10.0.0.4",
      "192.168.1.20",
      "127.0.0.1",
      "169.254.10.1",
      "fd00::1",
    ]) {
      expect(
        reasonOf(
          matchSecurityAutomaticResponseDetection({
            match: guessing,
            facts: facts({
              mitreTechniques: ["T1110"],
              groupValue,
              principalAddresses: [groupValue],
            }),
          }),
        ),
      ).toBe(SecurityAutomaticResponseMismatch.NotPublic);
    }
  });

  test("acts on one address, never a range or several values", () => {
    for (const groupValue of ["35.205.11.0/24", `${ATTACKER}|jane`, ""]) {
      expect(
        reasonOf(
          matchSecurityAutomaticResponseDetection({
            match: guessing,
            facts: facts({ mitreTechniques: ["T1110"], groupValue }),
          }),
        ),
      ).toBe(SecurityAutomaticResponseMismatch.NoAddress);
    }
  });

  test("writes the address as blocks are written", () => {
    expect(getSecurityAutomaticResponseAddress("2001:DB8::0:7")).toEqual({
      address: "2001:db8::7",
    });
  });

  test("never acts on an address the requests only claimed", () => {
    expect(
      reasonOf(
        matchSecurityAutomaticResponseDetection({
          match: guessing,
          facts: facts({
            mitreTechniques: ["T1110"],
            principalAddresses: ["203.0.113.9"],
          }),
        }),
      ),
    ).toBe(SecurityAutomaticResponseMismatch.OnlyClaimed);
  });

  test("acts when no event was kept to say whose address it is", () => {
    expect(
      matchSecurityAutomaticResponseDetection({
        match: guessing,
        facts: facts({ mitreTechniques: ["T1110"], principalAddresses: [] }),
      }).matches,
    ).toBe(true);
  });

  test("never acts on a setup test", () => {
    expect(
      reasonOf(
        matchSecurityAutomaticResponseDetection({
          match: guessing,
          facts: facts({ mitreTechniques: ["T1110"], isSetupTest: true }),
        }),
      ),
    ).toBe(SecurityAutomaticResponseMismatch.SetupTest);
  });

  test("a project's own policy acts on the detection rules it names", () => {
    const match: SecurityAutomaticResponseMatch = {
      mitreTechniques: [],
      detectionRuleIds: ["rule-7"],
      requiresThreatIntel: false,
      requiresEveryRequestTurnedAway: false,
    };

    expect(
      matchSecurityAutomaticResponseDetection({
        match,
        facts: facts({ detectionRuleId: "rule-7" }),
      }).matches,
    ).toBe(true);
    expect(
      reasonOf(
        matchSecurityAutomaticResponseDetection({
          match,
          facts: facts({ detectionRuleId: "rule-8" }),
        }),
      ),
    ).toBe(SecurityAutomaticResponseMismatch.NotItsDetection);
  });

  test("a policy that names nothing acts on nothing", () => {
    expect(
      reasonOf(
        matchSecurityAutomaticResponseDetection({
          match: {
            mitreTechniques: [],
            detectionRuleIds: [],
            requiresThreatIntel: false,
            requiresEveryRequestTurnedAway: false,
          },
          facts: facts({ mitreTechniques: ["T1110"] }),
        }),
      ),
    ).toBe(SecurityAutomaticResponseMismatch.NotItsDetection);
  });
});

describe("wasEveryRequestTurnedAway", () => {
  test("true only when every request has an outcome and every outcome is Rejected", () => {
    expect(
      wasEveryRequestTurnedAway({ [SecurityEventRequestOutcome.Rejected]: 3 }),
    ).toBe(true);
    expect(
      wasEveryRequestTurnedAway({
        [SecurityEventRequestOutcome.Rejected]: 3,
        [SecurityEventRequestOutcome.ReachedApp]: 0,
      }),
    ).toBe(true);
    expect(wasEveryRequestTurnedAway({})).toBeNull();
    expect(wasEveryRequestTurnedAway(null)).toBeNull();
    expect(
      wasEveryRequestTurnedAway({ [SecurityEventRequestOutcome.Errored]: 1 }),
    ).toBe(false);
  });
});

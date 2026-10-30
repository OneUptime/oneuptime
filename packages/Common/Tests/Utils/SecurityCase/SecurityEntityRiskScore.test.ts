import { securityCaseGroupingKey } from "../../../Server/Utils/SecurityCase/SecurityCaseIngest";
import Crypto from "../../../Utils/Crypto";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import SecurityDetectionSource from "../../../Types/SecurityCase/SecurityDetectionSource";
import {
  SecurityEntity,
  SecurityEntityType,
} from "../../../Types/SecurityCase/SecurityEntity";
import {
  DEFAULT_ENTITY_RISK_CASE_THRESHOLD,
  ENTITY_RISK_CASE_THRESHOLD_MAX,
  ENTITY_RISK_CASE_THRESHOLD_MIN,
  ENTITY_RISK_CONTRIBUTION_LIMIT,
  ENTITY_RISK_HISTORY_IN_DAYS,
  ENTITY_RISK_POINTS_BY_SEVERITY,
  ENTITY_RISK_WINDOW_IN_DAYS,
  RISK_ENTITY_TYPES,
  SecurityEntityCriticality,
  SecurityEntityRiskContribution,
  SecurityEntityRiskHistoryPoint,
  SecurityEntityRiskLevel,
} from "../../../Types/SecurityCase/SecurityEntityRisk";
import {
  ENTITY_RISK_KEY_VALUE_LIMIT,
  ENTITY_RISK_WINDOW_IN_MS,
  SecurityEntityCriticalityRule,
  SecurityEntityRiskObservation,
  SecurityEntityRiskSummary,
  addRiskObservation,
  computeEntityRisk,
  findEntityCriticalityRule,
  getCriticalityWeight,
  getEntityCaseGroupingKey,
  getEntityRiskKey,
  getEntityRiskLevel,
  getRiskDetectionSeverity,
  getRiskEntities,
  getRiskHistorySeries,
  getRiskPointsForSeverity,
  getRiskSinceLastCase,
  isRiskContributionInWindow,
  isRiskEntityType,
  isSecurityEntityCriticality,
  pruneRiskContributions,
  readRiskCaseThreshold,
  readRiskContributions,
  readRiskHistory,
  readRiskPointsSetting,
  resolveRiskPoints,
  shouldRaiseRiskCase,
  updateRiskHistory,
  weightRiskScore,
} from "../../../Utils/SecurityCase/SecurityEntityRiskScore";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * Entity risk, worked out: what a finding adds, how one source counts once
 * in the week however often it fires, how a source that went quiet stops
 * counting and starts afresh, how criticality weighs a score, the levels
 * against the project's threshold, when risk opens a case and why the same
 * findings never open a second one, the history the entity's page draws,
 * and which criticality entry names an entity.
 */

const NOW: Date = new Date("2026-10-14T12:00:00.000Z");
const HOUR_IN_MS: number = 60 * 60 * 1000;
const DAY_IN_MS: number = 24 * HOUR_IN_MS;

function ago(milliseconds: number): Date {
  return new Date(NOW.getTime() - milliseconds);
}

function observation(
  overrides: Partial<SecurityEntityRiskObservation> = {},
): SecurityEntityRiskObservation {
  return {
    sourceKey: "rule:brute-force",
    source: SecurityDetectionSource.DetectionRule,
    sourceName: "Brute force",
    severity: OcsfSeverity.High,
    points: 50,
    seenAt: ago(HOUR_IN_MS),
    mitreTactics: ["TA0006"],
    mitreTechniques: ["T1110"],
    ...overrides,
  };
}

function contribution(
  overrides: Partial<SecurityEntityRiskContribution> = {},
): SecurityEntityRiskContribution {
  return {
    sourceKey: "rule:brute-force",
    source: SecurityDetectionSource.DetectionRule,
    sourceName: "Brute force",
    severity: OcsfSeverity.High,
    points: 50,
    hits: 1,
    firstSeenAt: ago(2 * HOUR_IN_MS).toISOString(),
    lastSeenAt: ago(HOUR_IN_MS).toISOString(),
    mitreTactics: [],
    mitreTechniques: [],
    ...overrides,
  };
}

describe("an entity's risk key", () => {
  test("is its value trimmed and case folded", () => {
    expect(getEntityRiskKey("  Alice@Corp.Example ")).toBe(
      "alice@corp.example",
    );
    expect(getEntityRiskKey("WEB-01")).toBe("web-01");
    expect(getEntityRiskKey("")).toBe("");
  });

  test("hashes a value too long to index whole", () => {
    const long: string = `${"A".repeat(ENTITY_RISK_KEY_VALUE_LIMIT)}b`;

    expect(getEntityRiskKey(long)).toBe(
      `sha256:${Crypto.getSha256Hash(long.toLowerCase())}`,
    );
    // At the limit it is kept as it is.
    expect(getEntityRiskKey("x".repeat(ENTITY_RISK_KEY_VALUE_LIMIT))).toBe(
      "x".repeat(ENTITY_RISK_KEY_VALUE_LIMIT),
    );
  });

  test("names the open case about the entity exactly as the case ingest groups it", () => {
    for (const value of [
      "203.0.113.7",
      " Alice@Corp.Example ",
      `arn:aws:iam::123456789012:user/${"x".repeat(250)}`,
    ]) {
      expect(getEntityCaseGroupingKey(value)).toBe(
        securityCaseGroupingKey({ groupValue: value, fingerprint: "f" }),
      );
    }
  });
});

describe("which entities carry risk", () => {
  test("users, hosts, addresses and data stores do; indicators and processes do not", () => {
    expect([...RISK_ENTITY_TYPES]).toEqual([
      SecurityEntityType.User,
      SecurityEntityType.Host,
      SecurityEntityType.IpAddress,
      SecurityEntityType.DataStore,
    ]);

    for (const type of Object.values(SecurityEntityType)) {
      expect(isRiskEntityType(type)).toBe(RISK_ENTITY_TYPES.includes(type));
    }

    expect(isRiskEntityType("user")).toBe(false);
    expect(isRiskEntityType(undefined)).toBe(false);
  });

  test("a finding's entities are kept once each, trimmed, without the rest", () => {
    const entities: Array<SecurityEntity> = getRiskEntities([
      { type: SecurityEntityType.User, value: " Alice " },
      { type: SecurityEntityType.User, value: "alice" },
      { type: SecurityEntityType.Host, value: "web-01" },
      {
        type: SecurityEntityType.FileHash,
        value: "d41d8cd98f00b204e9800998ecf8427e",
      },
      { type: SecurityEntityType.Domain, value: "evil.example" },
      { type: SecurityEntityType.IpAddress, value: "   " },
      { type: SecurityEntityType.IpAddress, value: "203.0.113.7" },
    ]);

    expect(entities).toEqual([
      { type: SecurityEntityType.User, value: "Alice" },
      { type: SecurityEntityType.Host, value: "web-01" },
      { type: SecurityEntityType.IpAddress, value: "203.0.113.7" },
    ]);
  });
});

describe("what a finding adds", () => {
  test("by its severity: informational nothing, unknown as medium", () => {
    expect(ENTITY_RISK_POINTS_BY_SEVERITY).toEqual({
      [OcsfSeverity.Unknown]: 25,
      [OcsfSeverity.Informational]: 0,
      [OcsfSeverity.Low]: 10,
      [OcsfSeverity.Medium]: 25,
      [OcsfSeverity.High]: 50,
      [OcsfSeverity.Critical]: 75,
      [OcsfSeverity.Fatal]: 100,
      [OcsfSeverity.Other]: 25,
    });

    expect(getRiskPointsForSeverity(OcsfSeverity.Critical)).toBe(75);
    expect(getRiskPointsForSeverity("Severe-ish")).toBe(25);
    expect(getRiskPointsForSeverity(undefined)).toBe(25);
    expect(getRiskPointsForSeverity("constructor")).toBe(25);
  });

  test("a rule's own Risk Points win, 0 included, read as a whole number from 0 to 100", () => {
    expect(readRiskPointsSetting(undefined)).toBeNull();
    expect(readRiskPointsSetting(null)).toBeNull();
    expect(readRiskPointsSetting("")).toBeNull();
    expect(readRiskPointsSetting("not a number")).toBeNull();
    expect(readRiskPointsSetting(Number.NaN)).toBeNull();
    expect(readRiskPointsSetting("40")).toBe(40);
    expect(readRiskPointsSetting(33.6)).toBe(34);
    expect(readRiskPointsSetting(-5)).toBe(0);
    expect(readRiskPointsSetting(250)).toBe(100);

    expect(
      resolveRiskPoints({ severity: OcsfSeverity.High, riskPoints: 0 }),
    ).toBe(0);
    expect(
      resolveRiskPoints({ severity: OcsfSeverity.Low, riskPoints: 90 }),
    ).toBe(90);
    expect(
      resolveRiskPoints({ severity: OcsfSeverity.Critical, riskPoints: null }),
    ).toBe(75);
    expect(resolveRiskPoints({ severity: OcsfSeverity.Medium })).toBe(25);
  });
});

describe("a source's place in the window", () => {
  test("counts until it has said nothing for the whole week", () => {
    expect(ENTITY_RISK_WINDOW_IN_DAYS).toBe(7);
    expect(ENTITY_RISK_WINDOW_IN_MS).toBe(7 * DAY_IN_MS);

    expect(
      isRiskContributionInWindow(
        contribution({ lastSeenAt: ago(7 * DAY_IN_MS).toISOString() }),
        NOW,
      ),
    ).toBe(true);
    expect(
      isRiskContributionInWindow(
        contribution({ lastSeenAt: ago(7 * DAY_IN_MS + 1).toISOString() }),
        NOW,
      ),
    ).toBe(false);
    expect(
      isRiskContributionInWindow(
        contribution({ lastSeenAt: "not a date" }),
        NOW,
      ),
    ).toBe(false);
  });
});

describe("taking a finding in", () => {
  test("a new source joins with what the finding adds", () => {
    const contributions: Array<SecurityEntityRiskContribution> =
      addRiskObservation(
        [],
        observation({
          detectionRuleId: "11111111-1111-4111-8111-111111111111",
        }),
        NOW,
      );

    expect(contributions).toEqual([
      {
        sourceKey: "rule:brute-force",
        source: SecurityDetectionSource.DetectionRule,
        sourceName: "Brute force",
        severity: OcsfSeverity.High,
        points: 50,
        hits: 1,
        firstSeenAt: ago(HOUR_IN_MS).toISOString(),
        lastSeenAt: ago(HOUR_IN_MS).toISOString(),
        mitreTactics: ["TA0006"],
        mitreTechniques: ["T1110"],
        detectionRuleId: "11111111-1111-4111-8111-111111111111",
      },
    ]);
  });

  test("the same source counts once: the most it added, its worst severity, one more hit", () => {
    let contributions: Array<SecurityEntityRiskContribution> =
      addRiskObservation(
        [],
        observation({
          points: 25,
          severity: OcsfSeverity.Medium,
          seenAt: ago(3 * DAY_IN_MS),
          mitreTechniques: ["T1110.001"],
        }),
        NOW,
      );

    contributions = addRiskObservation(
      contributions,
      observation({
        points: 50,
        severity: OcsfSeverity.High,
        seenAt: ago(HOUR_IN_MS),
        sourceName: "Brute force (renamed)",
      }),
      NOW,
    );

    contributions = addRiskObservation(
      contributions,
      observation({
        points: 10,
        severity: OcsfSeverity.Low,
        seenAt: ago(2 * DAY_IN_MS),
      }),
      NOW,
    );

    expect(contributions).toHaveLength(1);
    expect(contributions[0]).toMatchObject({
      sourceName: "Brute force (renamed)",
      points: 50,
      severity: OcsfSeverity.High,
      hits: 3,
      firstSeenAt: ago(3 * DAY_IN_MS).toISOString(),
      // An earlier finding taken in late does not move it back.
      lastSeenAt: ago(HOUR_IN_MS).toISOString(),
      mitreTactics: ["TA0006"],
      mitreTechniques: ["T1110.001", "T1110"],
    });
  });

  test("a source quiet for the whole week starts afresh, at what it adds now", () => {
    const quiet: Array<SecurityEntityRiskContribution> = [
      contribution({
        points: 75,
        severity: OcsfSeverity.Critical,
        hits: 9,
        firstSeenAt: ago(20 * DAY_IN_MS).toISOString(),
        lastSeenAt: ago(8 * DAY_IN_MS).toISOString(),
      }),
    ];

    const contributions: Array<SecurityEntityRiskContribution> =
      addRiskObservation(
        quiet,
        observation({
          points: 10,
          severity: OcsfSeverity.Low,
          seenAt: ago(HOUR_IN_MS),
        }),
        NOW,
      );

    expect(contributions).toHaveLength(1);
    expect(contributions[0]).toMatchObject({
      points: 10,
      severity: OcsfSeverity.Low,
      hits: 1,
      firstSeenAt: ago(HOUR_IN_MS).toISOString(),
      lastSeenAt: ago(HOUR_IN_MS).toISOString(),
    });
  });

  test("sources that stopped counting are let go, and past the limit the ones that add least", () => {
    const many: Array<SecurityEntityRiskContribution> = [];

    for (
      let index: number = 0;
      index < ENTITY_RISK_CONTRIBUTION_LIMIT;
      index++
    ) {
      many.push(
        contribution({
          sourceKey: `rule:${index}`,
          points: index === 0 ? 5 : 10,
        }),
      );
    }

    many.push(
      contribution({
        sourceKey: "rule:gone",
        lastSeenAt: ago(9 * DAY_IN_MS).toISOString(),
      }),
    );

    const contributions: Array<SecurityEntityRiskContribution> =
      addRiskObservation(
        many,
        observation({ sourceKey: "rule:new", points: 40 }),
        NOW,
      );

    expect(contributions).toHaveLength(ENTITY_RISK_CONTRIBUTION_LIMIT);

    const keys: Array<string> = contributions.map(
      (item: SecurityEntityRiskContribution): string => {
        return item.sourceKey;
      },
    );

    expect(keys[0]).toBe("rule:new");
    expect(keys).not.toContain("rule:gone");
    // The one that added least gave way.
    expect(keys).not.toContain("rule:0");
  });

  test("an overlong source name is cut, never grows the row", () => {
    const contributions: Array<SecurityEntityRiskContribution> =
      addRiskObservation(
        [],
        observation({ sourceName: "N".repeat(5000) }),
        NOW,
      );

    expect(contributions[0]!.sourceName.length).toBe(200);
    expect(contributions[0]!.sourceName.endsWith("…")).toBe(true);
  });
});

describe("reading the sources a row stores", () => {
  test("keeps the ones it understands, read as they should be", () => {
    const read: Array<SecurityEntityRiskContribution> = readRiskContributions([
      {
        sourceKey: "intel:feed",
        source: SecurityDetectionSource.ThreatIntel,
        sourceName: "Feodo",
        severity: OcsfSeverity.High,
        points: "50",
        hits: 0,
        firstSeenAt: "2026-10-13T10:00:00Z",
        lastSeenAt: "2026-10-14T10:00:00Z",
        mitreTactics: ["TA0011", 7, ""],
        mitreTechniques: "T1071",
        threatIntelFeedId: "22222222-2222-4222-8222-222222222222",
      },
      { sourceKey: "", source: SecurityDetectionSource.ThreatIntel },
      {
        sourceKey: "rule:x",
        source: "Somebody",
        firstSeenAt: "2026-10-13T10:00:00Z",
        lastSeenAt: "2026-10-14T10:00:00Z",
      },
      {
        sourceKey: "rule:y",
        source: SecurityDetectionSource.DetectionRule,
        firstSeenAt: "yesterday",
        lastSeenAt: "2026-10-14T10:00:00Z",
      },
      {
        sourceKey: "rule:z",
        source: SecurityDetectionSource.DetectionRule,
        severity: "Spicy",
        points: 900,
        firstSeenAt: "2026-10-13T10:00:00Z",
        lastSeenAt: "2026-10-14T10:00:00Z",
      },
      null,
      ["not", "an", "entry"],
      "text",
    ]);

    expect(read).toEqual([
      {
        sourceKey: "intel:feed",
        source: SecurityDetectionSource.ThreatIntel,
        sourceName: "Feodo",
        severity: OcsfSeverity.High,
        points: 50,
        hits: 1,
        firstSeenAt: "2026-10-13T10:00:00.000Z",
        lastSeenAt: "2026-10-14T10:00:00.000Z",
        mitreTactics: ["TA0011"],
        mitreTechniques: [],
        detectionRuleId: undefined,
        threatIntelFeedId: "22222222-2222-4222-8222-222222222222",
        securityEventConnectionId: undefined,
      },
      {
        sourceKey: "rule:z",
        source: SecurityDetectionSource.DetectionRule,
        sourceName: "",
        severity: OcsfSeverity.Unknown,
        points: 100,
        hits: 1,
        firstSeenAt: "2026-10-13T10:00:00.000Z",
        lastSeenAt: "2026-10-14T10:00:00.000Z",
        mitreTactics: [],
        mitreTechniques: [],
        detectionRuleId: undefined,
        threatIntelFeedId: undefined,
        securityEventConnectionId: undefined,
      },
    ]);

    expect(readRiskContributions(undefined)).toEqual([]);
    expect(readRiskContributions({ sourceKey: "x" })).toEqual([]);
  });
});

describe("an entity's score", () => {
  test("adds up the sources that count, each once", () => {
    const summary: SecurityEntityRiskSummary = computeEntityRisk({
      contributions: [
        contribution({
          sourceKey: "rule:a",
          points: 50,
          firstSeenAt: ago(3 * DAY_IN_MS).toISOString(),
          lastSeenAt: ago(2 * DAY_IN_MS).toISOString(),
          mitreTactics: ["TA0006"],
        }),
        contribution({
          sourceKey: "rule:b",
          points: 25,
          firstSeenAt: ago(5 * HOUR_IN_MS).toISOString(),
          lastSeenAt: ago(HOUR_IN_MS).toISOString(),
          mitreTactics: ["TA0004", "TA0006"],
        }),
        contribution({
          sourceKey: "rule:quiet",
          points: 75,
          lastSeenAt: ago(8 * DAY_IN_MS).toISOString(),
        }),
      ],
      now: NOW,
    });

    expect(summary.baseScore).toBe(75);
    expect(summary.score).toBe(75);
    expect(summary.contributors).toHaveLength(2);
    expect(summary.mitreTactics).toEqual(["TA0006", "TA0004"]);
    expect(summary.firstRiskAt).toEqual(ago(3 * DAY_IN_MS));
    expect(summary.lastRiskAt).toEqual(ago(HOUR_IN_MS));
    // The score next falls when the first of them has been quiet a week.
    expect(summary.expiresAt).toEqual(
      new Date(ago(2 * DAY_IN_MS).getTime() + ENTITY_RISK_WINDOW_IN_MS),
    );
  });

  test("is weighed by how much the entity matters", () => {
    const contributions: Array<SecurityEntityRiskContribution> = [
      contribution({ sourceKey: "rule:a", points: 50 }),
      contribution({ sourceKey: "rule:b", points: 25 }),
    ];

    const scoreFor: (
      criticality: SecurityEntityCriticality | null,
    ) => number = (criticality: SecurityEntityCriticality | null): number => {
      return computeEntityRisk({ contributions, criticality, now: NOW }).score;
    };

    expect(scoreFor(null)).toBe(75);
    expect(scoreFor(SecurityEntityCriticality.Low)).toBe(38);
    expect(scoreFor(SecurityEntityCriticality.High)).toBe(113);
    expect(scoreFor(SecurityEntityCriticality.Extreme)).toBe(150);

    expect(weightRiskScore(75, "Unheard of")).toBe(75);
    expect(getCriticalityWeight(undefined)).toBe(1);
    expect(isSecurityEntityCriticality(SecurityEntityCriticality.High)).toBe(
      true,
    );
    expect(isSecurityEntityCriticality("Medium")).toBe(false);
  });

  test("is nothing, with no times, when no source counts", () => {
    const summary: SecurityEntityRiskSummary = computeEntityRisk({
      contributions: [
        contribution({ lastSeenAt: ago(10 * DAY_IN_MS).toISOString() }),
      ],
      now: NOW,
    });

    expect(summary).toEqual({
      baseScore: 0,
      score: 0,
      contributors: [],
      mitreTactics: [],
      mitreTechniques: [],
      firstRiskAt: null,
      lastRiskAt: null,
      expiresAt: null,
    });
  });

  test("a source that adds nothing never sets when the score falls", () => {
    const summary: SecurityEntityRiskSummary = computeEntityRisk({
      contributions: [
        contribution({
          sourceKey: "rule:zero",
          points: 0,
          lastSeenAt: ago(6 * DAY_IN_MS).toISOString(),
        }),
        contribution({ sourceKey: "rule:a", points: 10 }),
      ],
      now: NOW,
    });

    expect(summary.expiresAt).toEqual(
      new Date(ago(HOUR_IN_MS).getTime() + ENTITY_RISK_WINDOW_IN_MS),
    );
  });

  test("a hundred random weeks of findings: the score is the sum of each source's most, once each", () => {
    const random: SeededRandom = seededRandom(5243);

    for (let round: number = 0; round < 100; round++) {
      const observations: Array<SecurityEntityRiskObservation> = [];
      const sourceCount: number = 1 + random(6);

      for (let index: number = 0; index < 1 + random(30); index++) {
        observations.push(
          observation({
            sourceKey: `rule:${random(sourceCount)}`,
            points: random(101),
            // Within the last six days, so every one counts.
            seenAt: ago(random(6 * DAY_IN_MS)),
          }),
        );
      }

      const expectedMost: Map<string, number> = new Map();

      for (const item of observations) {
        expectedMost.set(
          item.sourceKey,
          Math.max(expectedMost.get(item.sourceKey) || 0, item.points),
        );
      }

      let expected: number = 0;

      for (const points of expectedMost.values()) {
        expected += points;
      }

      // Whatever order they arrive in.
      for (const order of [observations, shuffled(observations, random)]) {
        let contributions: Array<SecurityEntityRiskContribution> = [];

        for (const item of order) {
          contributions = addRiskObservation(contributions, item, NOW);
        }

        const summary: SecurityEntityRiskSummary = computeEntityRisk({
          contributions,
          now: NOW,
        });

        expect(summary.score).toBe(expected);
        expect(summary.contributors).toHaveLength(expectedMost.size);
        expect(summary.score).toBeGreaterThanOrEqual(0);

        // Taking the same finding in again changes nothing but its hits.
        const again: SecurityEntityRiskSummary = computeEntityRisk({
          contributions: addRiskObservation(contributions, order[0]!, NOW),
          now: NOW,
        });

        expect(again.score).toBe(expected);
      }
    }
  });
});

describe("levels against the threshold", () => {
  test("with a new project's threshold of 100", () => {
    expect(DEFAULT_ENTITY_RISK_CASE_THRESHOLD).toBe(100);

    const cases: Array<[number, SecurityEntityRiskLevel]> = [
      [0, SecurityEntityRiskLevel.None],
      [-3, SecurityEntityRiskLevel.None],
      [Number.NaN, SecurityEntityRiskLevel.None],
      [1, SecurityEntityRiskLevel.Low],
      [49, SecurityEntityRiskLevel.Low],
      [50, SecurityEntityRiskLevel.Medium],
      [99, SecurityEntityRiskLevel.Medium],
      [100, SecurityEntityRiskLevel.High],
      [199, SecurityEntityRiskLevel.High],
      [200, SecurityEntityRiskLevel.Critical],
      [5000, SecurityEntityRiskLevel.Critical],
    ];

    for (const [score, level] of cases) {
      expect(getEntityRiskLevel(score, 100)).toBe(level);
    }
  });

  test("move with the project's own threshold", () => {
    expect(getEntityRiskLevel(124, 250)).toBe(SecurityEntityRiskLevel.Low);
    expect(getEntityRiskLevel(125, 250)).toBe(SecurityEntityRiskLevel.Medium);
    expect(getEntityRiskLevel(250, 250)).toBe(SecurityEntityRiskLevel.High);
    expect(getEntityRiskLevel(500, 250)).toBe(SecurityEntityRiskLevel.Critical);
    // A threshold that is not one reads as the default.
    expect(getEntityRiskLevel(100, Number.NaN)).toBe(
      SecurityEntityRiskLevel.High,
    );
  });

  test("the threshold is a whole number from 10 to 10000", () => {
    expect(readRiskCaseThreshold(undefined)).toBe(100);
    expect(readRiskCaseThreshold(null)).toBe(100);
    expect(readRiskCaseThreshold("abc")).toBe(100);
    expect(readRiskCaseThreshold("150")).toBe(150);
    expect(readRiskCaseThreshold(149.5)).toBe(150);
    expect(readRiskCaseThreshold(1)).toBe(ENTITY_RISK_CASE_THRESHOLD_MIN);
    expect(readRiskCaseThreshold(10 ** 9)).toBe(ENTITY_RISK_CASE_THRESHOLD_MAX);
  });

  test("a risk detection is High at the threshold and Critical at twice it", () => {
    expect(getRiskDetectionSeverity(100, 100)).toBe(OcsfSeverity.High);
    expect(getRiskDetectionSeverity(199, 100)).toBe(OcsfSeverity.High);
    expect(getRiskDetectionSeverity(200, 100)).toBe(OcsfSeverity.Critical);
  });
});

describe("when risk opens a case", () => {
  const sources: Array<SecurityEntityRiskContribution> = [
    contribution({
      sourceKey: "rule:a",
      points: 50,
      firstSeenAt: ago(4 * DAY_IN_MS).toISOString(),
      lastSeenAt: ago(HOUR_IN_MS).toISOString(),
    }),
    contribution({
      sourceKey: "rule:b",
      points: 50,
      firstSeenAt: ago(2 * DAY_IN_MS).toISOString(),
      lastSeenAt: ago(HOUR_IN_MS).toISOString(),
    }),
    contribution({
      sourceKey: "rule:c",
      points: 25,
      firstSeenAt: ago(2 * HOUR_IN_MS).toISOString(),
      lastSeenAt: ago(HOUR_IN_MS).toISOString(),
    }),
  ];

  test("before any risk case, every source that counts counts", () => {
    expect(
      getRiskSinceLastCase({
        contributions: sources,
        riskCaseAt: null,
        now: NOW,
      }),
    ).toBe(125);
  });

  test("after one, only the sources that began counting since", () => {
    expect(
      getRiskSinceLastCase({
        contributions: sources,
        riskCaseAt: ago(3 * DAY_IN_MS),
        now: NOW,
      }),
    ).toBe(75);
    expect(
      getRiskSinceLastCase({
        contributions: sources,
        riskCaseAt: ago(HOUR_IN_MS),
        now: NOW,
      }),
    ).toBe(0);
    expect(
      getRiskSinceLastCase({
        contributions: sources,
        riskCaseAt: ago(3 * DAY_IN_MS),
        criticality: SecurityEntityCriticality.Extreme,
        now: NOW,
      }),
    ).toBe(150);
  });

  test("a source that went quiet and came back counts afresh", () => {
    const restarted: Array<SecurityEntityRiskContribution> = addRiskObservation(
      [
        contribution({
          sourceKey: "rule:a",
          points: 100,
          firstSeenAt: ago(20 * DAY_IN_MS).toISOString(),
          lastSeenAt: ago(9 * DAY_IN_MS).toISOString(),
        }),
      ],
      observation({
        sourceKey: "rule:a",
        points: 100,
        seenAt: ago(HOUR_IN_MS),
      }),
      NOW,
    );

    expect(
      getRiskSinceLastCase({
        contributions: restarted,
        riskCaseAt: ago(10 * DAY_IN_MS),
        now: NOW,
      }),
    ).toBe(100);
  });

  test("only while the project opens cases from risk, and at its threshold", () => {
    expect(
      shouldRaiseRiskCase({
        isEnabled: false,
        threshold: 100,
        riskSinceLastCase: 500,
      }),
    ).toBe(false);
    expect(
      shouldRaiseRiskCase({
        isEnabled: true,
        threshold: 100,
        riskSinceLastCase: 99,
      }),
    ).toBe(false);
    expect(
      shouldRaiseRiskCase({
        isEnabled: true,
        threshold: 100,
        riskSinceLastCase: 100,
      }),
    ).toBe(true);
    expect(
      shouldRaiseRiskCase({
        isEnabled: true,
        threshold: 250,
        riskSinceLastCase: 200,
      }),
    ).toBe(false);
  });
});

describe("an entity's history", () => {
  test("a point a day: today's is the latest score, a month is kept", () => {
    expect(ENTITY_RISK_HISTORY_IN_DAYS).toBe(30);

    let history: Array<SecurityEntityRiskHistoryPoint> = [];

    history = updateRiskHistory(history, 40, ago(40 * DAY_IN_MS));
    history = updateRiskHistory(history, 60, ago(29 * DAY_IN_MS));
    history = updateRiskHistory(history, 75, ago(2 * DAY_IN_MS));
    history = updateRiskHistory(history, 90, ago(3 * HOUR_IN_MS));
    history = updateRiskHistory(history, 125.4, NOW);

    expect(history).toEqual([
      { day: "2026-09-15", score: 60 },
      { day: "2026-10-12", score: 75 },
      { day: "2026-10-14", score: 125 },
    ]);
  });

  test("is read defensively, in day order", () => {
    expect(
      readRiskHistory([
        { day: "2026-10-12", score: 5 },
        { day: "2026-10-10", score: "7" },
        { day: "12/10/2026", score: 1 },
        { day: "2026-10-11", score: -1 },
        { day: "2026-10-11", score: "x" },
        { day: "2026-10-12", score: 9 },
        null,
        "2026-10-13",
      ]),
    ).toEqual([
      { day: "2026-10-10", score: 7 },
      { day: "2026-10-12", score: 9 },
    ]);

    expect(readRiskHistory(undefined)).toEqual([]);
  });

  test("a series for each day: a quiet day carries the day before, days before it began are 0", () => {
    const series: Array<SecurityEntityRiskHistoryPoint> = getRiskHistorySeries({
      history: [
        { day: "2026-10-09", score: 50 },
        { day: "2026-10-12", score: 125 },
        { day: "2026-10-13", score: 0 },
      ],
      now: NOW,
      days: 7,
    });

    expect(series).toEqual([
      { day: "2026-10-08", score: 0 },
      { day: "2026-10-09", score: 50 },
      { day: "2026-10-10", score: 50 },
      { day: "2026-10-11", score: 50 },
      { day: "2026-10-12", score: 125 },
      { day: "2026-10-13", score: 0 },
      { day: "2026-10-14", score: 0 },
    ]);

    expect(
      getRiskHistorySeries({ history: [], now: NOW, days: 0 }),
    ).toHaveLength(1);
  });

  test("pruning keeps only what counts, the most first", () => {
    const pruned: Array<SecurityEntityRiskContribution> =
      pruneRiskContributions(
        [
          contribution({
            sourceKey: "a",
            points: 10,
            lastSeenAt: ago(HOUR_IN_MS).toISOString(),
          }),
          contribution({
            sourceKey: "b",
            points: 50,
            lastSeenAt: ago(2 * HOUR_IN_MS).toISOString(),
          }),
          contribution({
            sourceKey: "c",
            points: 50,
            lastSeenAt: ago(HOUR_IN_MS).toISOString(),
          }),
          contribution({
            sourceKey: "d",
            points: 75,
            lastSeenAt: ago(8 * DAY_IN_MS).toISOString(),
          }),
        ],
        NOW,
      );

    expect(
      pruned.map((item: SecurityEntityRiskContribution): string => {
        return item.sourceKey;
      }),
    ).toEqual(["c", "b", "a"]);
  });
});

describe("which criticality names an entity", () => {
  const alice: SecurityEntity = {
    type: SecurityEntityType.User,
    value: "Alice@Corp.Example",
  };
  const dc: SecurityEntity = {
    type: SecurityEntityType.Host,
    value: "DC-01.corp.example",
  };

  test("a value written out, whatever its case, of any kind or the entity's", () => {
    const rules: Array<SecurityEntityCriticalityRule> = [
      {
        value: "alice@corp.example",
        criticality: SecurityEntityCriticality.Extreme,
      },
      {
        value: "dc-01.corp.example",
        entityType: SecurityEntityType.User,
        criticality: SecurityEntityCriticality.Low,
      },
    ];

    expect(
      findEntityCriticalityRule({ entity: alice, rules })?.criticality,
    ).toBe(SecurityEntityCriticality.Extreme);
    // The entry is for users; DC-01 is a host.
    expect(findEntityCriticalityRule({ entity: dc, rules })).toBeUndefined();
  });

  test("the most specific entry wins: written out, then the longer pattern, then the heavier", () => {
    const rules: Array<SecurityEntityCriticalityRule> = [
      { value: "*", criticality: SecurityEntityCriticality.Low },
      { value: "dc-*", criticality: SecurityEntityCriticality.High },
      {
        value: "dc-*.corp.example",
        criticality: SecurityEntityCriticality.Extreme,
      },
      { value: "*.corp.example", criticality: SecurityEntityCriticality.Low },
    ];

    expect(findEntityCriticalityRule({ entity: dc, rules })?.value).toBe(
      "dc-*.corp.example",
    );

    expect(
      findEntityCriticalityRule({
        entity: dc,
        rules: [
          ...rules,
          {
            value: "DC-01.CORP.EXAMPLE",
            criticality: SecurityEntityCriticality.Low,
          },
        ],
      })?.criticality,
    ).toBe(SecurityEntityCriticality.Low);

    expect(
      findEntityCriticalityRule({
        entity: { type: SecurityEntityType.Host, value: "web-01" },
        rules: [
          // As much written out in each: the heavier one wins.
          { value: "web*", criticality: SecurityEntityCriticality.Low },
          { value: "*-01", criticality: SecurityEntityCriticality.High },
        ],
      })?.criticality,
    ).toBe(SecurityEntityCriticality.High);

    expect(
      findEntityCriticalityRule({
        entity: { type: SecurityEntityType.Host, value: "web-01" },
        rules: [
          // More written out wins, however light.
          { value: "web-*", criticality: SecurityEntityCriticality.Low },
          { value: "*-01", criticality: SecurityEntityCriticality.Extreme },
        ],
      })?.criticality,
    ).toBe(SecurityEntityCriticality.Low);
  });

  test("an entry with no criticality it knows, or matching nothing, names nobody", () => {
    expect(
      findEntityCriticalityRule({
        entity: alice,
        rules: [
          {
            value: "alice@corp.example",
            criticality: "Medium" as SecurityEntityCriticality,
          },
          { value: "bob@*", criticality: SecurityEntityCriticality.High },
        ],
      }),
    ).toBeUndefined();

    expect(
      findEntityCriticalityRule({ entity: alice, rules: [] }),
    ).toBeUndefined();
  });
});

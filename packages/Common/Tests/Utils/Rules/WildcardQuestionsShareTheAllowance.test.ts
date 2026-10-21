import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaFilter,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import CidrMatchUtil from "../../../Utils/NetworkSite/CidrMatchUtil";
import AutoImportRuleMatcher, {
  AutoImportHostEvaluation,
  AutoImportRuleCandidate,
} from "../../../Utils/NetworkDiscovery/AutoImportRuleMatcher";
import { DiscoveredNetworkDevice } from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import RulePatternMatchUtil from "../../../Utils/Rules/RulePatternMatchUtil";
import {
  PatternWorkAllowance,
  providePatternWorkAllowance,
  QUESTION_WORK,
  RULE_EVALUATION_WORK,
  WORK_PER_TEXT_CHARACTER,
} from "../../../Utils/LinearRegExp/PatternWork";
import { clearLinearRegExpCache } from "../../../Utils/LinearRegExp/PatternCache";
import { clearKeptAutomata } from "../../../Utils/LinearRegExp/Matcher";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { afterEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A WILDCARD IS A PATTERN QUESTION LIKE ANY OTHER.
 *
 * A rule's pattern is read as a regular expression first and, when it
 * carries a '*', as a wildcard too (RulePatternMatchUtil.matches); site
 * assignment and auto-import rules read wildcards of their own
 * (CidrMatchUtil.hostnameMatchesWildcard). The wildcard question does not
 * run on the matcher, so it was not counted: thousands of wildcard rules
 * over a long text took seconds of one evaluation after its allowance was
 * spent. These hold that a wildcard question counts what it does against
 * the allowance of the evaluation under way (LinearRegExp/PatternWork.ts),
 * has no answer once it is spent, and that a negated condition does not
 * hold on a question with no answer - and that every answered question
 * means what it meant.
 * ---------------------------------------------------------------------------
 */

function installed(allowance: PatternWorkAllowance | undefined): void {
  providePatternWorkAllowance((): PatternWorkAllowance | undefined => {
    return allowance;
  });
}

function spentAllowance(): PatternWorkAllowance {
  const allowance: PatternWorkAllowance = new PatternWorkAllowance({
    pool: 0,
  });

  allowance.charge(1);

  return allowance;
}

function largeAllowance(): PatternWorkAllowance {
  return new PatternWorkAllowance({ pool: 1_000_000_000_000 });
}

function criteria(filters: Array<RuleCriteriaFilter>): Record<string, unknown> {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: FilterCondition.All,
    filters: filters,
  };
}

function host(
  overrides: Partial<DiscoveredNetworkDevice> = {},
): DiscoveredNetworkDevice {
  return {
    ipAddress: "10.0.0.5",
    sysName: "switch-WB1678-01",
    sysDescr: "Cisco IOS Software, C2960X",
    sysObjectId: "1.3.6.1.4.1.2636.1.1.1.2.137",
    ...overrides,
  };
}

afterEach(() => {
  installed(undefined);
});

describe("a wildcard question inside a rule evaluation", () => {
  it("counts its steps, and trimming and lowering the text, against the allowance", () => {
    const allowance: PatternWorkAllowance =
      PatternWorkAllowance.forRuleEvaluation();
    const text: string = "a".repeat(100_000);

    installed(allowance);

    expect(CidrMatchUtil.hostnameMatchesWildcard(text, "*zz*")).toBe(false);

    // The text adds its share, as a text a regular expression reads does.
    expect(allowance.allowedWork).toBe(
      RULE_EVALUATION_WORK + WORK_PER_TEXT_CHARACTER * text.length,
    );
    // A step for each character at least, the lowering and the question.
    expect(allowance.usedWork).toBeGreaterThanOrEqual(
      text.length + text.length / 4 + QUESTION_WORK,
    );
    expect(allowance.stoppedQuestions).toBe(0);
  });

  it("has no answer once the allowance is spent: false, counted as stopped, nothing read", () => {
    const allowance: PatternWorkAllowance = spentAllowance();
    const usedBefore: number = allowance.usedWork;

    installed(allowance);

    expect(CidrMatchUtil.hostnameMatchesWildcard("core-sw-01", "core-*")).toBe(
      false,
    );
    expect(allowance.stoppedQuestions).toBe(1);
    expect(allowance.usedWork).toBe(usedBefore);
  });

  it("stops partway through a long text when what is left runs out", () => {
    const allowance: PatternWorkAllowance = new PatternWorkAllowance({
      pool: 500_000,
    });
    /*
     * '*b*' takes a step for each character: 600,000 steps and the
     * lowering, more than the pool holds.
     */
    const text: string = "a".repeat(600_000);

    installed(allowance);

    expect(CidrMatchUtil.hostnameMatchesWildcard(text, "*b*")).toBe(false);
    expect(allowance.stoppedQuestions).toBe(1);
    // Counted as it went: stopped within one count of the allowance.
    expect(allowance.usedWork).toBeGreaterThan(500_000);
    expect(allowance.usedWork).toBeLessThan(500_000 + 65_536 + 1_000);
  });

  it("answers as before, inside an allowance and outside any", () => {
    const random: SeededRandom = seededRandom(2_026_10_20);
    const alphabet: string = "ab.-*";
    let compared: number = 0;

    for (let index: number = 0; index < 4_000; index++) {
      let text: string = "";
      let glob: string = "";

      for (let at: number = random(24); at > 0; at--) {
        text += "aAbB.-"[random(6)];
      }

      for (let at: number = 1 + random(10); at > 0; at--) {
        glob += alphabet[random(alphabet.length)];
      }

      installed(undefined);
      const outside: boolean = CidrMatchUtil.hostnameMatchesWildcard(
        text,
        glob,
      );

      const allowance: PatternWorkAllowance = largeAllowance();
      installed(allowance);
      const inside: boolean = CidrMatchUtil.hostnameMatchesWildcard(text, glob);

      expect({ text, glob, inside }).toEqual({ text, glob, inside: outside });
      expect(allowance.stoppedQuestions).toBe(0);
      compared++;
    }

    expect(compared).toBe(4_000);

    installed(largeAllowance());
    expect(
      CidrMatchUtil.hostnameMatchesWildcard("Core-SW-01.corp", "core-*"),
    ).toBe(true);
    expect(
      CidrMatchUtil.hostnameMatchesWildcard("edge-01", "*.corp.example.com"),
    ).toBe(false);
    expect(
      CidrMatchUtil.hostnameMatchesWildcard(
        "db.corp.example.com",
        "*.corp.example.com",
      ),
    ).toBe(true);
  });
});

describe("a rule pattern read as a wildcard", () => {
  jest.setTimeout(120_000);

  it("thousands of wildcard rules over a long text end within the evaluation's allowance", () => {
    const text: string = "x".repeat(100_000);
    const patterns: Array<string> = [];

    for (let index: number = 0; index < 10_000; index++) {
      patterns.push(`*x${index}*`);
    }

    let allowance: PatternWorkAllowance =
      PatternWorkAllowance.forRuleEvaluation();

    const run: FastestRun<number> = fastestRun({
      run: (): number => {
        clearLinearRegExpCache();
        clearKeptAutomata();
        allowance = PatternWorkAllowance.forRuleEvaluation();
        installed(allowance);

        let matched: number = 0;

        for (const pattern of patterns) {
          if (RulePatternMatchUtil.matches(text, pattern)) {
            matched++;
          }
        }

        return matched;
      },
      limitInMs: 3000,
    });

    expect(run.result).toBe(0);
    expect(run.inMs).toBeLessThan(3000);
    // The wildcards' work was counted, and the rest stopped at once.
    expect(allowance.isSpent).toBe(true);
    expect(allowance.stoppedQuestions).toBeGreaterThan(0);
    expect(allowance.usedWork).toBeLessThan(
      allowance.allowedWork + 65_536 + 100_000,
    );
  });

  it("has no answer once the allowance is spent, though as a wildcard it would match", () => {
    const allowance: PatternWorkAllowance = spentAllowance();

    installed(allowance);

    expect(RulePatternMatchUtil.matches("core-sw-01", "core-*")).toBe(false);
    // One question with no answer: not a regular expression, then a wildcard.
    expect(allowance.stoppedQuestions).toBe(1);
  });

  it("answered wildcard and regular expression rules mean what they meant", () => {
    for (const allowance of [undefined, largeAllowance()]) {
      installed(allowance);

      expect(RulePatternMatchUtil.matches("core-sw-01", "core-*")).toBe(true);
      expect(RulePatternMatchUtil.matches("core-sw-01", "^core-sw")).toBe(true);
      expect(RulePatternMatchUtil.matches("edge-01", "core-*")).toBe(false);
      expect(RulePatternMatchUtil.matches("edge-01", "")).toBe(true);
      expect(allowance?.stoppedQuestions ?? 0).toBe(0);
    }
  });
});

describe("a negated wildcard condition with no answer does not hold", () => {
  const doesNotMatchCore: Record<string, unknown> = criteria([
    {
      field: "hostnamePattern",
      operator: RuleCriteriaOperator.DoesNotMatchPattern,
      value: "core-*",
    },
  ]);

  it("in a site assignment rule", () => {
    const target: { hostname: string } = { hostname: "edge-01" };

    installed(undefined);
    expect(
      CidrMatchUtil.ruleMatches({ criteria: doesNotMatchCore }, target),
    ).toBe(true);

    installed(largeAllowance());
    expect(
      CidrMatchUtil.ruleMatches({ criteria: doesNotMatchCore }, target),
    ).toBe(true);

    const spent: PatternWorkAllowance = spentAllowance();
    installed(spent);
    expect(
      CidrMatchUtil.ruleMatches({ criteria: doesNotMatchCore }, target),
    ).toBe(false);
    expect(spent.stoppedQuestions).toBeGreaterThan(0);

    // An answered one that matches still keeps the rule from matching.
    installed(largeAllowance());
    expect(
      CidrMatchUtil.ruleMatches(
        { criteria: doesNotMatchCore },
        { hostname: "core-sw-01" },
      ),
    ).toBe(false);
  });

  it.each([
    ["sysNamePattern", "core-*"],
    ["sysDescrPattern", "*Juniper*"],
    ["sysObjectIdPattern", "1.3.6.1.4.1.9.*"],
  ])(
    "in an auto-import rule's %s condition",
    (field: string, pattern: string) => {
      const rule: AutoImportRuleCandidate = {
        criteria: criteria([
          {
            field: field,
            operator: RuleCriteriaOperator.DoesNotMatchPattern,
            value: pattern,
          },
        ]),
      };

      installed(undefined);
      expect(AutoImportRuleMatcher.ruleMatchesHost(rule, host())).toBe(true);

      installed(largeAllowance());
      expect(AutoImportRuleMatcher.ruleMatchesHost(rule, host())).toBe(true);

      const spent: PatternWorkAllowance = spentAllowance();
      installed(spent);
      expect(AutoImportRuleMatcher.ruleMatchesHost(rule, host())).toBe(false);
      expect(spent.stoppedQuestions).toBeGreaterThan(0);
    },
  );

  it("so an exclusion with no answer vetoes nothing, and an import rule with none imports nothing", () => {
    const exclusion: AutoImportRuleCandidate = {
      isExclusion: true,
      criteria: criteria([
        {
          field: "sysNamePattern",
          operator: RuleCriteriaOperator.DoesNotMatchPattern,
          value: "switch-*",
        },
      ]),
    };
    const importRule: AutoImportRuleCandidate = {
      criteria: criteria([
        {
          field: "sysDescrPattern",
          operator: RuleCriteriaOperator.DoesNotMatchPattern,
          value: "*Juniper*",
        },
      ]),
    };
    // An address condition is no pattern question.
    const byIp: AutoImportRuleCandidate = { ipMatchTarget: "10.0.0.0/24" };

    installed(spentAllowance());

    const evaluation: AutoImportHostEvaluation =
      AutoImportRuleMatcher.evaluateHost([exclusion, importRule, byIp], host());

    // The address rule is answered, and it imports the host.
    expect(evaluation.excludedByRule).toBeUndefined();
    expect(evaluation.shouldImport).toBe(true);
    expect(evaluation.matchedRules).toEqual([byIp]);

    installed(spentAllowance());
    expect(
      AutoImportRuleMatcher.evaluateHost([importRule], host()).shouldImport,
    ).toBe(false);

    installed(largeAllowance());
    expect(
      AutoImportRuleMatcher.evaluateHost([importRule], host()).shouldImport,
    ).toBe(true);
  });
});

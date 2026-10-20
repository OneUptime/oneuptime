import FilterCondition from "../../../Types/Filter/FilterCondition";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaFilter,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import RuleCriteriaMatcher from "../../../Utils/Rules/RuleCriteriaMatcher";
import RulePatternMatchUtil from "../../../Utils/Rules/RulePatternMatchUtil";
import {
  PatternWorkAllowance,
  providePatternWorkAllowance,
} from "../../../Utils/LinearRegExp/PatternWork";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { afterEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A CONDITION WITH NO ANSWER DOES NOT HOLD, NEGATED OR NOT.
 *
 * A pattern question that needs more work than it may take - on its own,
 * or together with the rest of the rule evaluation (LinearRegExp/
 * PatternWork.ts) - has no answer, and the rule engines read it as "does not
 * match". A negated condition (does not equal, does not contain, does not
 * match) would then hold on a text nobody read to the end: a label rule
 * "title does not match X" would label every resource whose title is long
 * enough to stop the question. These hold that an unanswered condition does
 * not hold either way, and that every answered one means what it meant.
 * ---------------------------------------------------------------------------
 */

class TextRule {
  public criteria?: unknown;
  public namePattern?: string;
}

const LEGACY_FIELDS: Array<"namePattern"> = ["namePattern"];

// Written to need many steps per character on a's and b's (LinearRegExp.test.ts).
const EXPLODING: string = "(?:[ab]*a[ab]{14}|[ab]{0,2000})Q";

function randomAb(length: number): string {
  const random: SeededRandom = seededRandom(1020);
  let text: string = "";

  for (let index: number = 0; index < length; index++) {
    text += random(2) === 0 ? "a" : "b";
  }

  return text;
}

// A text the exploding pattern cannot answer within its own limit.
const UNANSWERABLE_TEXT: string = randomAb(60_000);

function criteria(
  filters: Array<RuleCriteriaFilter>,
  condition: FilterCondition = FilterCondition.All,
): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: condition,
    filters: filters,
  };
}

function ruleWith(filters: Array<RuleCriteriaFilter>, any?: boolean): TextRule {
  const rule: TextRule = new TextRule();
  rule.criteria = criteria(
    filters,
    any ? FilterCondition.Any : FilterCondition.All,
  );
  return rule;
}

// As every rule engine reads a legacy pattern: through RulePatternMatchUtil.
function engineMatcher(value: string): (rule: TextRule) => boolean {
  return (rule: TextRule): boolean => {
    return rule.namePattern
      ? RulePatternMatchUtil.testRegex(rule.namePattern, value)
      : true;
  };
}

function matchesSync(rule: TextRule, value: string): boolean {
  return RuleCriteriaMatcher.matchesWithLegacySync({
    rule: rule,
    legacyFields: LEGACY_FIELDS,
    emptyResult: false,
    matchesLegacyRule: engineMatcher(value),
  });
}

async function matchesAsync(rule: TextRule, value: string): Promise<boolean> {
  return await RuleCriteriaMatcher.matchesWithLegacy({
    rule: rule,
    legacyFields: LEGACY_FIELDS,
    emptyResult: false,
    matchesLegacyRule: async (legacyRule: TextRule): Promise<boolean> => {
      await Promise.resolve();
      return engineMatcher(value)(legacyRule);
    },
  });
}

function spentAllowance(): PatternWorkAllowance {
  const allowance: PatternWorkAllowance = new PatternWorkAllowance({
    pool: 0,
  });

  allowance.charge(1);

  return allowance;
}

function installed(allowance: PatternWorkAllowance | undefined): void {
  providePatternWorkAllowance((): PatternWorkAllowance | undefined => {
    return allowance;
  });
}

afterEach(() => {
  installed(undefined);
});

const NEGATED: ReadonlyArray<RuleCriteriaOperator> = [
  RuleCriteriaOperator.NotEquals,
  RuleCriteriaOperator.DoesNotContain,
  RuleCriteriaOperator.DoesNotMatchPattern,
];

const POSITIVE: ReadonlyArray<RuleCriteriaOperator> = [
  RuleCriteriaOperator.Equals,
  RuleCriteriaOperator.Contains,
  RuleCriteriaOperator.StartsWith,
  RuleCriteriaOperator.EndsWith,
  RuleCriteriaOperator.MatchesPattern,
];

describe("when the rule evaluation's allowance is spent", () => {
  it.each(NEGATED)(
    "a negated condition (%s) does not hold on a value it could not read",
    (operator: RuleCriteriaOperator) => {
      installed(spentAllowance());

      expect(
        matchesSync(
          ruleWith([{ field: "namePattern", operator, value: "zzz" }]),
          "payments-api",
        ),
      ).toBe(false);
    },
  );

  it.each(NEGATED)(
    "nor when the engine reads it asynchronously (%s)",
    async (operator: RuleCriteriaOperator) => {
      installed(spentAllowance());

      await expect(
        matchesAsync(
          ruleWith([{ field: "namePattern", operator, value: "zzz" }]),
          "payments-api",
        ),
      ).resolves.toBe(false);
    },
  );

  it.each(POSITIVE)(
    "a positive condition (%s) does not hold either",
    (operator: RuleCriteriaOperator) => {
      installed(spentAllowance());

      expect(
        matchesSync(
          ruleWith([{ field: "namePattern", operator, value: "payments" }]),
          "payments",
        ),
      ).toBe(false);
    },
  );

  it("the engine helper says no, and counts the question as one with no answer", () => {
    const allowance: PatternWorkAllowance = spentAllowance();

    installed(allowance);

    expect(RulePatternMatchUtil.testRegex("^api", "api-1")).toBe(false);
    expect(allowance.stoppedQuestions).toBe(1);
  });
});

describe("a question that stops at its own limit", () => {
  it("leaves a negated pattern condition not holding, with no allowance under way", () => {
    expect(
      matchesSync(
        ruleWith([
          {
            field: "namePattern",
            operator: RuleCriteriaOperator.DoesNotMatchPattern,
            value: EXPLODING,
          },
        ]),
        UNANSWERABLE_TEXT,
      ),
    ).toBe(false);
  });

  it("and inside a rule evaluation's allowance", () => {
    const allowance: PatternWorkAllowance =
      PatternWorkAllowance.forRuleEvaluation();

    installed(allowance);

    expect(
      matchesSync(
        ruleWith([
          {
            field: "namePattern",
            operator: RuleCriteriaOperator.DoesNotMatchPattern,
            value: EXPLODING,
          },
        ]),
        UNANSWERABLE_TEXT,
      ),
    ).toBe(false);
    expect(allowance.stoppedQuestions).toBe(1);
  });

  it("under Match any, another condition that holds still makes the rule match", () => {
    installed(PatternWorkAllowance.forRuleEvaluation());

    expect(
      matchesSync(
        ruleWith(
          [
            {
              field: "namePattern",
              operator: RuleCriteriaOperator.DoesNotMatchPattern,
              value: EXPLODING,
            },
            {
              field: "namePattern",
              operator: RuleCriteriaOperator.StartsWith,
              value: UNANSWERABLE_TEXT.slice(0, 20),
            },
          ],
          true,
        ),
        UNANSWERABLE_TEXT,
      ),
    ).toBe(true);
  });

  it("under Match all, the unanswered condition keeps the rule from matching", () => {
    installed(PatternWorkAllowance.forRuleEvaluation());

    expect(
      matchesSync(
        ruleWith([
          {
            field: "namePattern",
            operator: RuleCriteriaOperator.StartsWith,
            value: UNANSWERABLE_TEXT.slice(0, 20),
          },
          {
            field: "namePattern",
            operator: RuleCriteriaOperator.DoesNotMatchPattern,
            value: EXPLODING,
          },
        ]),
        UNANSWERABLE_TEXT,
      ),
    ).toBe(false);
  });
});

describe("answered conditions mean what they meant", () => {
  const cases: ReadonlyArray<{
    operator: RuleCriteriaOperator;
    value: string;
    text: string;
    expected: boolean;
  }> = [
    {
      operator: RuleCriteriaOperator.NotEquals,
      value: "web",
      text: "api",
      expected: true,
    },
    {
      operator: RuleCriteriaOperator.NotEquals,
      value: "api",
      text: "API",
      expected: false,
    },
    {
      operator: RuleCriteriaOperator.DoesNotContain,
      value: "prod",
      text: "staging-db",
      expected: true,
    },
    {
      operator: RuleCriteriaOperator.DoesNotContain,
      value: "prod",
      text: "prod-db",
      expected: false,
    },
    {
      operator: RuleCriteriaOperator.DoesNotMatchPattern,
      value: "^prod-(?!test)",
      text: "prod-test-db",
      expected: true,
    },
    {
      operator: RuleCriteriaOperator.DoesNotMatchPattern,
      value: "^prod-(?!test)",
      text: "prod-payments-db",
      expected: false,
    },
    {
      operator: RuleCriteriaOperator.MatchesPattern,
      value: "(?<=db-)0\\d",
      text: "db-03",
      expected: true,
    },
    {
      operator: RuleCriteriaOperator.Contains,
      value: "api",
      text: "payments-api",
      expected: true,
    },
  ];

  it.each(cases)(
    "$operator $value on $text: $expected, inside an allowance and without one",
    async (data: {
      operator: RuleCriteriaOperator;
      value: string;
      text: string;
      expected: boolean;
    }) => {
      const rule: TextRule = ruleWith([
        { field: "namePattern", operator: data.operator, value: data.value },
      ]);

      expect(matchesSync(rule, data.text)).toBe(data.expected);

      installed(PatternWorkAllowance.forRuleEvaluation());

      expect(matchesSync(rule, data.text)).toBe(data.expected);
      await expect(matchesAsync(rule, data.text)).resolves.toBe(data.expected);
    },
  );
});

describe("a condition over related items", () => {
  interface Candidate {
    name: string;
  }

  function matchesWithCandidates(
    rule: TextRule,
    candidates: Array<Candidate>,
  ): Promise<boolean> {
    return RuleCriteriaMatcher.matchesWithLegacy<TextRule, Candidate>({
      rule: rule,
      legacyFields: LEGACY_FIELDS,
      emptyResult: false,
      matchesLegacyRule: (): boolean => {
        return false;
      },
      correlation: {
        fields: ["namePattern"],
        getCandidates: (): Array<Candidate> => {
          return candidates;
        },
        matchesLegacyRuleForCandidate: (
          legacyRule: TextRule,
          candidate: Candidate,
        ): boolean => {
          return engineMatcher(candidate.name)(legacyRule);
        },
      },
    });
  }

  it("matches when one item answers yes, though another could not be read", async () => {
    installed(PatternWorkAllowance.forRuleEvaluation());

    const rule: TextRule = ruleWith([
      {
        field: "namePattern",
        operator: RuleCriteriaOperator.MatchesPattern,
        value: `${EXPLODING}|^checkout`,
      },
    ]);

    await expect(
      matchesWithCandidates(rule, [
        { name: UNANSWERABLE_TEXT },
        { name: "checkout-api" },
      ]),
    ).resolves.toBe(true);
  });

  it("does not match when the only item could not be read", async () => {
    installed(PatternWorkAllowance.forRuleEvaluation());

    const rule: TextRule = ruleWith([
      {
        field: "namePattern",
        operator: RuleCriteriaOperator.MatchesPattern,
        value: EXPLODING,
      },
    ]);

    await expect(
      matchesWithCandidates(rule, [{ name: UNANSWERABLE_TEXT }]),
    ).resolves.toBe(false);
  });
});

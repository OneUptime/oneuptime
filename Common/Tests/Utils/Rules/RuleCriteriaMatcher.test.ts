import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaFilter,
  RuleCriteriaOperator,
  RuleCriteriaValue,
} from "../../../Types/Rules/RuleCriteria";
import RuleCriteriaMatcher, {
  RULE_CRITERIA_MAX_FILTERS,
  RULE_CRITERIA_MAX_RELATION_VALUES,
  RULE_CRITERIA_MAX_STRING_LENGTH,
  getRuleCriteriaFilterValidationError,
  getRuleCriteriaValidationError,
  isRuleCriteriaOperator,
  isRuleCriteriaValue,
  isValidRuleCriteria,
} from "../../../Utils/Rules/RuleCriteriaMatcher";
import RulePatternMatchUtil from "../../../Utils/Rules/RulePatternMatchUtil";
import { describe, expect, it, jest } from "@jest/globals";

interface RelatedItem {
  _id?: string;
  id?: ObjectID;
}

interface CorrelationCandidate {
  name: string;
  description: string;
  labelIds: Array<string>;
}

type RuleFilterMatcher = (filter: RuleCriteriaFilter) => boolean;
type SyncRuleMatcher = (rule: ExampleRule) => boolean;
type AsyncRuleMatcher = (rule: ExampleRule) => Promise<boolean>;
type CorrelationCandidateGetter = () => Array<CorrelationCandidate>;
type CorrelationCandidateMatcher = (
  rule: ExampleRule,
  candidate: CorrelationCandidate,
) => boolean;

const LABEL_A_ID: string = "11111111-1111-4111-8111-111111111111";
const LABEL_B_ID: string = "22222222-2222-4222-8222-222222222222";
const LABEL_C_ID: string = "33333333-3333-4333-8333-333333333333";
const ROOT_LABEL_ID: string = "44444444-4444-4444-8444-444444444444";
const MISSING_LABEL_ID: string = "99999999-9999-4999-8999-999999999999";

class ExampleRule {
  public criteria?: unknown;
  public namePattern?: string;
  public descriptionPattern?: string;
  public labels?: Array<RelatedItem>;
  public untouched: { enabled: boolean } = { enabled: true };

  public getKind(): string {
    return "example";
  }
}

function makeFilter(
  field: string,
  operator: RuleCriteriaOperator,
  value: RuleCriteriaValue,
): RuleCriteriaFilter {
  return {
    field: field,
    operator: operator,
    value: value,
  };
}

function makeCriteria(
  filters: Array<RuleCriteriaFilter>,
  filterCondition: FilterCondition = FilterCondition.All,
): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: filterCondition,
    filters: filters,
  };
}

function makeRule(criteria: RuleCriteria | null | undefined): ExampleRule {
  const rule: ExampleRule = new ExampleRule();
  rule.criteria = criteria;
  rule.namePattern = "legacy-name";
  rule.descriptionPattern = "legacy-description";
  rule.labels = [{ id: new ObjectID("legacy-label") }];
  return rule;
}

function textLegacyMatcher(
  actualValue: string,
): (rule: ExampleRule) => boolean {
  return (rule: ExampleRule): boolean => {
    if (rule.namePattern) {
      return RulePatternMatchUtil.matches(actualValue, rule.namePattern);
    }

    if (rule.descriptionPattern) {
      return RulePatternMatchUtil.matches(actualValue, rule.descriptionPattern);
    }

    return false;
  };
}

function relationLegacyMatcher(
  actualIds: Array<string>,
): (rule: ExampleRule) => boolean {
  const actualIdSet: Set<string> = new Set(actualIds);

  return (rule: ExampleRule): boolean => {
    return Boolean(
      rule.labels?.some((item: RelatedItem): boolean => {
        const id: string = item.id?.toString() || item._id || "";
        return actualIdSet.has(id);
      }),
    );
  };
}

function correlationCandidateLegacyMatcher(
  candidate: CorrelationCandidate,
): (rule: ExampleRule) => boolean {
  return (rule: ExampleRule): boolean => {
    if (
      rule.namePattern &&
      !RulePatternMatchUtil.matches(candidate.name, rule.namePattern)
    ) {
      return false;
    }

    if (
      rule.descriptionPattern &&
      !RulePatternMatchUtil.matches(
        candidate.description,
        rule.descriptionPattern,
      )
    ) {
      return false;
    }

    if (rule.labels && !relationLegacyMatcher(candidate.labelIds)(rule)) {
      return false;
    }

    return true;
  };
}

describe("RuleCriteria validation", () => {
  it("accepts the versioned structure and every supported operator", () => {
    const filters: Array<RuleCriteriaFilter> = [
      makeFilter("namePattern", RuleCriteriaOperator.Equals, "api"),
      makeFilter("namePattern", RuleCriteriaOperator.NotEquals, 42),
      makeFilter("namePattern", RuleCriteriaOperator.Contains, true),
      makeFilter("namePattern", RuleCriteriaOperator.DoesNotContain, "dev"),
      makeFilter("namePattern", RuleCriteriaOperator.StartsWith, "prod"),
      makeFilter("namePattern", RuleCriteriaOperator.EndsWith, "worker"),
      makeFilter("namePattern", RuleCriteriaOperator.MatchesPattern, "^api"),
      makeFilter(
        "namePattern",
        RuleCriteriaOperator.DoesNotMatchPattern,
        "test$",
      ),
      makeFilter("labels", RuleCriteriaOperator.HasAnyOf, [LABEL_A_ID]),
      makeFilter("labels", RuleCriteriaOperator.HasAllOf, [
        LABEL_A_ID,
        LABEL_B_ID,
      ]),
      makeFilter("labels", RuleCriteriaOperator.HasNoneOf, [LABEL_C_ID]),
    ];
    const criteria: RuleCriteria = makeCriteria(filters, FilterCondition.Any);

    expect(getRuleCriteriaValidationError(criteria)).toBeNull();
    expect(isValidRuleCriteria(criteria)).toBe(true);
  });

  it("enforces the filter count limit while accepting exactly the limit", () => {
    const filters: Array<RuleCriteriaFilter> = Array.from(
      { length: RULE_CRITERIA_MAX_FILTERS },
      (): RuleCriteriaFilter => {
        return makeFilter("namePattern", RuleCriteriaOperator.Equals, "api");
      },
    );

    expect(getRuleCriteriaValidationError(makeCriteria(filters))).toBeNull();
    expect(
      getRuleCriteriaValidationError(
        makeCriteria([
          ...filters,
          makeFilter("namePattern", RuleCriteriaOperator.Equals, "extra"),
        ]),
      ),
    ).toContain(`${RULE_CRITERIA_MAX_FILTERS}`);
  });

  it("rejects unknown container and filter keys without traversing oversized nested values", () => {
    const oversizedValue: string = "x".repeat(
      RULE_CRITERIA_MAX_STRING_LENGTH * 10_000,
    );
    const criteriaWithExtraKey: Record<string, unknown> = {
      ...makeCriteria([]),
      metadata: oversizedValue,
    };
    const filterWithNestedExtra: Record<string, unknown> = {
      ...makeFilter("namePattern", RuleCriteriaOperator.Equals, "api"),
      metadata: {
        payload: oversizedValue,
      },
    };

    expect(getRuleCriteriaValidationError(criteriaWithExtraKey)).toContain(
      "may only contain",
    );
    expect(
      getRuleCriteriaFilterValidationError(filterWithNestedExtra),
    ).toContain("may only contain");

    const matchesFilter = jest.fn<RuleFilterMatcher>((): boolean => {
      return true;
    });
    expect(
      RuleCriteriaMatcher.matchesSync({
        criteria: {
          ...makeCriteria([]),
          filters: [filterWithNestedExtra],
        },
        emptyResult: true,
        matchesFilter: matchesFilter,
      }),
    ).toBe(false);
    expect(matchesFilter).not.toHaveBeenCalled();
  });

  it("accepts a boolean rolling-deploy enabled state and rejects other types", () => {
    expect(
      getRuleCriteriaValidationError({
        ...makeCriteria([]),
        isEnabled: true,
      }),
    ).toBeNull();
    expect(
      getRuleCriteriaValidationError({
        ...makeCriteria([]),
        isEnabled: "true",
      }),
    ).toContain("must be a boolean");
  });

  it.each([
    [null, "must be an object"],
    [[], "must be an object"],
    [{}, "schemaVersion"],
    [
      {
        schemaVersion: 2,
        filterCondition: FilterCondition.All,
        filters: [],
      },
      "schemaVersion",
    ],
    [
      { schemaVersion: 1, filterCondition: "Neither", filters: [] },
      "filterCondition",
    ],
    [
      {
        schemaVersion: 1,
        filterCondition: FilterCondition.All,
        filters: {},
      },
      "filters must be an array",
    ],
  ])(
    "rejects a malformed criteria container %#",
    (value: unknown, message: string) => {
      expect(getRuleCriteriaValidationError(value)).toContain(message);
      expect(isValidRuleCriteria(value)).toBe(false);
    },
  );

  it.each([
    [null, "must be an object"],
    [
      { field: 1, operator: RuleCriteriaOperator.Equals, value: "api" },
      "field must be a string",
    ],
    [
      { field: "   ", operator: RuleCriteriaOperator.Equals, value: "api" },
      "cannot be blank",
    ],
    [
      { field: "namePattern", operator: "Unknown", value: "api" },
      "unsupported operator",
    ],
    [
      {
        field: "namePattern",
        operator: RuleCriteriaOperator.Equals,
        value: Number.NaN,
      },
      "finite number",
    ],
    [
      {
        field: "namePattern",
        operator: RuleCriteriaOperator.Equals,
        value: ["api"],
      },
      "requires a scalar",
    ],
    [
      {
        field: "labels",
        operator: RuleCriteriaOperator.HasAnyOf,
        value: "label-id",
      },
      "requires an array",
    ],
  ])("rejects a malformed filter %#", (value: unknown, message: string) => {
    expect(getRuleCriteriaFilterValidationError(value)).toContain(message);
  });

  it("limits field names, scalar strings, and every relation ID", () => {
    const tooLong: string = "x".repeat(RULE_CRITERIA_MAX_STRING_LENGTH + 1);

    expect(
      getRuleCriteriaFilterValidationError(
        makeFilter(tooLong, RuleCriteriaOperator.Equals, "api"),
      ),
    ).toContain("field cannot exceed");
    expect(
      getRuleCriteriaFilterValidationError(
        makeFilter("namePattern", RuleCriteriaOperator.Equals, tooLong),
      ),
    ).toContain("value must be");
    expect(
      getRuleCriteriaFilterValidationError(
        makeFilter("labels", RuleCriteriaOperator.HasAnyOf, [tooLong]),
      ),
    ).toContain("value must be");

    const maximumLength: string = "x".repeat(RULE_CRITERIA_MAX_STRING_LENGTH);
    expect(
      getRuleCriteriaFilterValidationError(
        makeFilter(maximumLength, RuleCriteriaOperator.Equals, maximumLength),
      ),
    ).toBeNull();
  });

  it("caps relation selections while accepting exactly the limit", () => {
    const idsAtLimit: Array<string> = Array.from(
      { length: RULE_CRITERIA_MAX_RELATION_VALUES },
      (_value: unknown, index: number): string => {
        return `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
      },
    );

    expect(
      getRuleCriteriaFilterValidationError(
        makeFilter("labels", RuleCriteriaOperator.HasAnyOf, idsAtLimit),
      ),
    ).toBeNull();
    expect(
      getRuleCriteriaFilterValidationError(
        makeFilter("labels", RuleCriteriaOperator.HasAnyOf, [
          ...idsAtLimit,
          "00000000-0000-4000-8000-999999999999",
        ]),
      ),
    ).toContain(`${RULE_CRITERIA_MAX_RELATION_VALUES}`);
  });

  it.each([
    RuleCriteriaOperator.MatchesPattern,
    RuleCriteriaOperator.DoesNotMatchPattern,
  ])("rejects unsupported values for %s", (operator: RuleCriteriaOperator) => {
    expect(
      getRuleCriteriaFilterValidationError(
        makeFilter("namePattern", operator, "switch-(01"),
      ),
    ).toContain("valid regular expression or wildcard");
    expect(
      getRuleCriteriaFilterValidationError(
        makeFilter("namePattern", operator, 42),
      ),
    ).toContain("valid regular expression or wildcard");
  });

  it("exports narrow operator and value guards", () => {
    expect(isRuleCriteriaOperator(RuleCriteriaOperator.HasAllOf)).toBe(true);
    expect(isRuleCriteriaOperator("Unknown")).toBe(false);
    expect(isRuleCriteriaValue("text")).toBe(true);
    expect(isRuleCriteriaValue(0)).toBe(true);
    expect(isRuleCriteriaValue(false)).toBe(true);
    expect(isRuleCriteriaValue(["one", "two"])).toBe(true);
    expect(isRuleCriteriaValue("")).toBe(false);
    expect(isRuleCriteriaValue("   ")).toBe(false);
    expect(isRuleCriteriaValue([])).toBe(false);
    expect(isRuleCriteriaValue([""])).toBe(false);
    expect(isRuleCriteriaValue(["one", 2])).toBe(false);
    expect(isRuleCriteriaValue(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isRuleCriteriaValue({})).toBe(false);
  });
});

describe("RuleCriteriaMatcher combiners", () => {
  it("short-circuits All at the first false filter", () => {
    const filters: Array<RuleCriteriaFilter> = [
      makeFilter("first", RuleCriteriaOperator.Equals, "pass"),
      makeFilter("second", RuleCriteriaOperator.Equals, "fail"),
      makeFilter("third", RuleCriteriaOperator.Equals, "pass"),
    ];
    const matchesFilter = jest.fn<RuleFilterMatcher>(
      (filter: RuleCriteriaFilter): boolean => {
        return filter.value === "pass";
      },
    );

    expect(
      RuleCriteriaMatcher.matchesSync({
        criteria: makeCriteria(filters),
        emptyResult: false,
        matchesFilter: matchesFilter,
      }),
    ).toBe(false);
    expect(matchesFilter).toHaveBeenCalledTimes(2);
    expect(matchesFilter).not.toHaveBeenCalledWith(filters[2]);
  });

  it("short-circuits Any at the first true filter", () => {
    const filters: Array<RuleCriteriaFilter> = [
      makeFilter("first", RuleCriteriaOperator.Equals, "fail"),
      makeFilter("second", RuleCriteriaOperator.Equals, "pass"),
      makeFilter("third", RuleCriteriaOperator.Equals, "fail"),
    ];
    const matchesFilter = jest.fn<RuleFilterMatcher>(
      (filter: RuleCriteriaFilter): boolean => {
        return filter.value === "pass";
      },
    );

    expect(
      RuleCriteriaMatcher.matchesSync({
        criteria: makeCriteria(filters, FilterCondition.Any),
        emptyResult: false,
        matchesFilter: matchesFilter,
      }),
    ).toBe(true);
    expect(matchesFilter).toHaveBeenCalledTimes(2);
    expect(matchesFilter).not.toHaveBeenCalledWith(filters[2]);
  });

  it("evaluates duplicate fields as distinct filters without overwriting", () => {
    const filters: Array<RuleCriteriaFilter> = [
      makeFilter("namePattern", RuleCriteriaOperator.Contains, "api"),
      makeFilter("namePattern", RuleCriteriaOperator.EndsWith, "prod"),
    ];

    expect(
      RuleCriteriaMatcher.matchesWithLegacySync({
        rule: makeRule(makeCriteria(filters)),
        legacyFields: ["namePattern", "descriptionPattern", "labels"],
        emptyResult: false,
        matchesLegacyRule: textLegacyMatcher("api-prod"),
      }),
    ).toBe(true);
    expect(
      RuleCriteriaMatcher.matchesWithLegacySync({
        rule: makeRule(makeCriteria(filters)),
        legacyFields: ["namePattern", "descriptionPattern", "labels"],
        emptyResult: false,
        matchesLegacyRule: textLegacyMatcher("api-staging"),
      }),
    ).toBe(false);
  });

  it.each([true, false])(
    "returns configured emptyResult=%s without invoking a matcher",
    (emptyResult: boolean) => {
      const matchesFilter = jest.fn<RuleFilterMatcher>((): boolean => {
        return !emptyResult;
      });

      expect(
        RuleCriteriaMatcher.matchesSync({
          criteria: makeCriteria([]),
          emptyResult: emptyResult,
          matchesFilter: matchesFilter,
        }),
      ).toBe(emptyResult);
      expect(matchesFilter).not.toHaveBeenCalled();
    },
  );

  it("fails closed on configured malformed criteria", () => {
    const matchesFilter = jest.fn<RuleFilterMatcher>((): boolean => {
      return true;
    });

    expect(
      RuleCriteriaMatcher.matchesSync({
        criteria: {
          schemaVersion: 99,
          filterCondition: FilterCondition.Any,
          filters: [],
        },
        emptyResult: true,
        matchesFilter: matchesFilter,
      }),
    ).toBe(false);
    expect(matchesFilter).not.toHaveBeenCalled();
  });

  it("awaits filters sequentially and preserves async short-circuiting", async () => {
    const visited: Array<string> = [];

    const result: boolean = await RuleCriteriaMatcher.matches({
      criteria: makeCriteria(
        [
          makeFilter("first", RuleCriteriaOperator.Equals, "no"),
          makeFilter("second", RuleCriteriaOperator.Equals, "yes"),
          makeFilter("third", RuleCriteriaOperator.Equals, "no"),
        ],
        FilterCondition.Any,
      ),
      emptyResult: false,
      matchesFilter: async (filter: RuleCriteriaFilter): Promise<boolean> => {
        visited.push(filter.field);
        return filter.value === "yes";
      },
    });

    expect(result).toBe(true);
    expect(visited).toEqual(["first", "second"]);
  });
});

describe("RuleCriteriaMatcher correlated async legacy adapter", () => {
  const splitCandidates: Array<CorrelationCandidate> = [
    {
      name: "production-api",
      description: "internal service",
      labelIds: [LABEL_A_ID],
    },
    {
      name: "background-worker",
      description: "customer checkout",
      labelIds: [LABEL_B_ID],
    },
  ];

  function matchesAnyCandidate(rule: ExampleRule): boolean {
    return splitCandidates.some((candidate: CorrelationCandidate): boolean => {
      return correlationCandidateLegacyMatcher(candidate)(rule);
    });
  }

  it("does not let two different children satisfy grouped Match All filters", async () => {
    await expect(
      RuleCriteriaMatcher.matchesWithLegacy({
        rule: makeRule(
          makeCriteria([
            makeFilter("namePattern", RuleCriteriaOperator.Contains, "api"),
            makeFilter(
              "descriptionPattern",
              RuleCriteriaOperator.Contains,
              "customer",
            ),
          ]),
        ),
        legacyFields: ["namePattern", "descriptionPattern", "labels"],
        emptyResult: false,
        matchesLegacyRule: async (rule: ExampleRule): Promise<boolean> => {
          return matchesAnyCandidate(rule);
        },
        correlation: {
          fields: ["namePattern", "descriptionPattern"],
          getCandidates: (): Array<CorrelationCandidate> => {
            return splitCandidates;
          },
          matchesLegacyRuleForCandidate: async (
            rule: ExampleRule,
            candidate: CorrelationCandidate,
          ): Promise<boolean> => {
            return correlationCandidateLegacyMatcher(candidate)(rule);
          },
        },
      }),
    ).resolves.toBe(false);
  });

  it("allows one child to satisfy all grouped filters while evaluating non-group filters independently", async () => {
    const candidates: Array<CorrelationCandidate> = [
      ...splitCandidates,
      {
        name: "checkout-api",
        description: "customer checkout",
        labelIds: [],
      },
    ];
    const matchesLegacyRule = jest.fn<AsyncRuleMatcher>(
      async (rule: ExampleRule): Promise<boolean> => {
        if (rule.labels) {
          return relationLegacyMatcher([ROOT_LABEL_ID])(rule);
        }

        return candidates.some((candidate: CorrelationCandidate): boolean => {
          return correlationCandidateLegacyMatcher(candidate)(rule);
        });
      },
    );

    await expect(
      RuleCriteriaMatcher.matchesWithLegacy({
        rule: makeRule(
          makeCriteria([
            makeFilter("namePattern", RuleCriteriaOperator.Contains, "api"),
            makeFilter(
              "descriptionPattern",
              RuleCriteriaOperator.Contains,
              "customer",
            ),
            makeFilter("labels", RuleCriteriaOperator.HasAnyOf, [
              ROOT_LABEL_ID,
            ]),
          ]),
        ),
        legacyFields: ["namePattern", "descriptionPattern", "labels"],
        emptyResult: false,
        matchesLegacyRule: matchesLegacyRule,
        correlation: {
          fields: ["namePattern", "descriptionPattern"],
          getCandidates: (): Array<CorrelationCandidate> => {
            return candidates;
          },
          matchesLegacyRuleForCandidate: (
            rule: ExampleRule,
            candidate: CorrelationCandidate,
          ): boolean => {
            return correlationCandidateLegacyMatcher(candidate)(rule);
          },
        },
      }),
    ).resolves.toBe(true);
    expect(matchesLegacyRule).toHaveBeenCalledTimes(1);
    expect(matchesLegacyRule.mock.calls[0]?.[0].labels).toBeDefined();
  });

  it.each([FilterCondition.All, FilterCondition.Any])(
    "keeps every HasAllOf value on the same correlated child for %s",
    async (filterCondition: FilterCondition) => {
      await expect(
        RuleCriteriaMatcher.matchesWithLegacy({
          rule: makeRule(
            makeCriteria(
              [
                makeFilter("labels", RuleCriteriaOperator.HasAllOf, [
                  LABEL_A_ID,
                  LABEL_B_ID,
                ]),
              ],
              filterCondition,
            ),
          ),
          legacyFields: ["namePattern", "descriptionPattern", "labels"],
          emptyResult: false,
          matchesLegacyRule: matchesAnyCandidate,
          correlation: {
            fields: ["labels"],
            getCandidates: (): Array<CorrelationCandidate> => {
              return splitCandidates;
            },
            matchesLegacyRuleForCandidate: (
              rule: ExampleRule,
              candidate: CorrelationCandidate,
            ): boolean => {
              return correlationCandidateLegacyMatcher(candidate)(rule);
            },
          },
        }),
      ).resolves.toBe(false);
    },
  );

  it.each([FilterCondition.All, FilterCondition.Any])(
    "keeps a positive one-filter result invariant for %s",
    async (filterCondition: FilterCondition) => {
      const getCandidates = jest.fn<CorrelationCandidateGetter>(
        (): Array<CorrelationCandidate> => {
          return splitCandidates;
        },
      );
      const matchesLegacyRuleForCandidate =
        jest.fn<CorrelationCandidateMatcher>(
          (rule: ExampleRule, candidate: CorrelationCandidate): boolean => {
            return correlationCandidateLegacyMatcher(candidate)(rule);
          },
        );

      await expect(
        RuleCriteriaMatcher.matchesWithLegacy({
          rule: makeRule(
            makeCriteria(
              [
                makeFilter(
                  "descriptionPattern",
                  RuleCriteriaOperator.Contains,
                  "customer",
                ),
              ],
              filterCondition,
            ),
          ),
          legacyFields: ["namePattern", "descriptionPattern", "labels"],
          emptyResult: false,
          matchesLegacyRule: matchesAnyCandidate,
          correlation: {
            fields: ["namePattern", "descriptionPattern"],
            getCandidates: getCandidates,
            matchesLegacyRuleForCandidate: matchesLegacyRuleForCandidate,
          },
        }),
      ).resolves.toBe(true);
      expect(getCandidates).toHaveBeenCalledTimes(1);
      expect(matchesLegacyRuleForCandidate).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    [
      FilterCondition.All,
      RuleCriteriaOperator.NotEquals,
      "production-api",
      false,
    ],
    [
      FilterCondition.Any,
      RuleCriteriaOperator.NotEquals,
      "production-api",
      false,
    ],
    [FilterCondition.All, RuleCriteriaOperator.DoesNotContain, "api", false],
    [FilterCondition.Any, RuleCriteriaOperator.DoesNotContain, "api", false],
    [
      FilterCondition.All,
      RuleCriteriaOperator.DoesNotMatchPattern,
      "api",
      false,
    ],
    [
      FilterCondition.Any,
      RuleCriteriaOperator.DoesNotMatchPattern,
      "api",
      false,
    ],
    [FilterCondition.All, RuleCriteriaOperator.DoesNotContain, "missing", true],
    [FilterCondition.Any, RuleCriteriaOperator.DoesNotContain, "missing", true],
    [FilterCondition.All, RuleCriteriaOperator.HasNoneOf, [LABEL_A_ID], false],
    [FilterCondition.Any, RuleCriteriaOperator.HasNoneOf, [LABEL_A_ID], false],
    [
      FilterCondition.All,
      RuleCriteriaOperator.HasNoneOf,
      [MISSING_LABEL_ID],
      true,
    ],
    [
      FilterCondition.Any,
      RuleCriteriaOperator.HasNoneOf,
      [MISSING_LABEL_ID],
      true,
    ],
  ])(
    "evaluates a globally negated correlated filter invariantly for %s / %s",
    async (
      filterCondition: FilterCondition,
      operator: RuleCriteriaOperator,
      value: string | Array<string>,
      expected: boolean,
    ) => {
      const getCandidates = jest.fn<CorrelationCandidateGetter>(
        (): Array<CorrelationCandidate> => {
          return splitCandidates;
        },
      );
      const field: string = Array.isArray(value) ? "labels" : "namePattern";

      await expect(
        RuleCriteriaMatcher.matchesWithLegacy({
          rule: makeRule(
            makeCriteria([makeFilter(field, operator, value)], filterCondition),
          ),
          legacyFields: ["namePattern", "descriptionPattern", "labels"],
          emptyResult: false,
          matchesLegacyRule: matchesAnyCandidate,
          correlation: {
            fields: ["namePattern", "labels"],
            getCandidates: getCandidates,
            matchesLegacyRuleForCandidate: (): boolean => {
              throw new Error(
                "Global negation must not be evaluated per child.",
              );
            },
          },
        }),
      ).resolves.toBe(expected);
      expect(getCandidates).not.toHaveBeenCalled();
    },
  );

  it("loads correlation candidates once across Match Any filters", async () => {
    const getCandidates = jest.fn<CorrelationCandidateGetter>(
      (): Array<CorrelationCandidate> => {
        return splitCandidates;
      },
    );

    await expect(
      RuleCriteriaMatcher.matchesWithLegacy({
        rule: makeRule(
          makeCriteria(
            [
              makeFilter("namePattern", RuleCriteriaOperator.Contains, "none"),
              makeFilter(
                "descriptionPattern",
                RuleCriteriaOperator.Contains,
                "missing",
              ),
            ],
            FilterCondition.Any,
          ),
        ),
        legacyFields: ["namePattern", "descriptionPattern", "labels"],
        emptyResult: false,
        matchesLegacyRule: matchesAnyCandidate,
        correlation: {
          fields: ["namePattern", "descriptionPattern"],
          getCandidates: getCandidates,
          matchesLegacyRuleForCandidate: (
            rule: ExampleRule,
            candidate: CorrelationCandidate,
          ): boolean => {
            return correlationCandidateLegacyMatcher(candidate)(rule);
          },
        },
      }),
    ).resolves.toBe(false);
    expect(getCandidates).toHaveBeenCalledTimes(1);
  });

  it("preserves absent-criteria fallback without consulting correlation candidates", async () => {
    const rule: ExampleRule = makeRule(undefined);
    const matchesLegacyRule = jest.fn<AsyncRuleMatcher>(
      async (receivedRule: ExampleRule): Promise<boolean> => {
        expect(receivedRule).toBe(rule);
        return true;
      },
    );
    const getCandidates = jest.fn<CorrelationCandidateGetter>(
      (): Array<CorrelationCandidate> => {
        return splitCandidates;
      },
    );

    await expect(
      RuleCriteriaMatcher.matchesWithLegacy({
        rule: rule,
        legacyFields: ["namePattern", "descriptionPattern", "labels"],
        emptyResult: false,
        matchesLegacyRule: matchesLegacyRule,
        correlation: {
          fields: ["namePattern", "descriptionPattern"],
          getCandidates: getCandidates,
          matchesLegacyRuleForCandidate: (): boolean => {
            return false;
          },
        },
      }),
    ).resolves.toBe(true);
    expect(matchesLegacyRule).toHaveBeenCalledTimes(1);
    expect(getCandidates).not.toHaveBeenCalled();
  });
});

describe("RuleCriteriaMatcher text legacy adapter", () => {
  it.each([
    [RuleCriteriaOperator.Equals, "api.v1+", "api.v1+", true],
    [RuleCriteriaOperator.Equals, "api.v1+", "apiXv111", false],
    [RuleCriteriaOperator.NotEquals, "api", "worker", true],
    [RuleCriteriaOperator.NotEquals, "api", "api", false],
    [RuleCriteriaOperator.Contains, "api.v1+", "prod-api.v1+-worker", true],
    [RuleCriteriaOperator.Contains, "api.v1+", "prod-apiXv111", false],
    [RuleCriteriaOperator.DoesNotContain, "dev", "api-prod", true],
    [RuleCriteriaOperator.DoesNotContain, "dev", "api-dev", false],
    [RuleCriteriaOperator.StartsWith, "api.", "api.worker", true],
    [RuleCriteriaOperator.StartsWith, "api.", "my-api.worker", false],
    [RuleCriteriaOperator.EndsWith, ".prod", "api.prod", true],
    [RuleCriteriaOperator.EndsWith, ".prod", "api.production", false],
    [RuleCriteriaOperator.MatchesPattern, "^api-[0-9]+$", "api-42", true],
    [RuleCriteriaOperator.MatchesPattern, "^api-[0-9]+$", "api-worker", false],
    [
      RuleCriteriaOperator.DoesNotMatchPattern,
      "^api-[0-9]+$",
      "worker-42",
      true,
    ],
    [RuleCriteriaOperator.DoesNotMatchPattern, "^api-[0-9]+$", "api-42", false],
  ])(
    "%s maps %p to the intended legacy regex semantics against %p",
    (
      operator: RuleCriteriaOperator,
      value: string,
      actualValue: string,
      expected: boolean,
    ) => {
      const rule: ExampleRule = makeRule(
        makeCriteria([makeFilter("namePattern", operator, value)]),
      );

      expect(
        RuleCriteriaMatcher.matchesWithLegacySync({
          rule: rule,
          legacyFields: ["namePattern", "descriptionPattern", "labels"],
          emptyResult: false,
          matchesLegacyRule: textLegacyMatcher(actualValue),
        }),
      ).toBe(expected);
    },
  );

  it("avoids catastrophic backtracking in multi-wildcard legacy regexes", () => {
    const adversarialWildcard: string = `${"*a".repeat(8)}*b`;
    const matchesLegacyRule: (rule: ExampleRule) => boolean = (
      rule: ExampleRule,
    ): boolean => {
      return new RegExp(rule.namePattern || "(?!)", "i").test("a".repeat(40));
    };

    expect(
      RuleCriteriaMatcher.matchesWithLegacySync({
        rule: makeRule(
          makeCriteria([
            makeFilter(
              "namePattern",
              RuleCriteriaOperator.MatchesPattern,
              adversarialWildcard,
            ),
          ]),
        ),
        legacyFields: ["namePattern", "descriptionPattern", "labels"],
        emptyResult: false,
        matchesLegacyRule: matchesLegacyRule,
      }),
    ).toBe(false);
  });

  it.each([
    [RuleCriteriaOperator.MatchesPattern, "prod-api-worker", true],
    [RuleCriteriaOperator.MatchesPattern, "prod-worker", false],
    [RuleCriteriaOperator.DoesNotMatchPattern, "prod-api-worker", false],
    [RuleCriteriaOperator.DoesNotMatchPattern, "prod-worker", true],
  ])(
    "converts wildcard patterns for direct-regex legacy engines with %s",
    (
      operator: RuleCriteriaOperator,
      actualValue: string,
      expected: boolean,
    ) => {
      const matchesLegacyRule: (rule: ExampleRule) => boolean = (
        rule: ExampleRule,
      ): boolean => {
        return new RegExp(rule.namePattern || "(?!)", "i").test(actualValue);
      };

      expect(
        RuleCriteriaMatcher.matchesWithLegacySync({
          rule: makeRule(
            makeCriteria([makeFilter("namePattern", operator, "*api*")]),
          ),
          legacyFields: ["namePattern", "descriptionPattern", "labels"],
          emptyResult: false,
          matchesLegacyRule: matchesLegacyRule,
        }),
      ).toBe(expected);
    },
  );

  it.each([
    ["*api*worker*", "prod-api-background-worker-1", true],
    ["*api*worker", "prod-api-worker", true],
    ["*api*worker", "prod-api-worker-1", false],
    ["*api.v1+*", "prod-api.v1+-worker", true],
    ["*api.v1+*", "prod-apiXv111-worker", false],
    ["*a*a*b", "prefix-aaab", true],
    ["*a*a*b", "prefix-aaac", false],
  ])(
    "preserves ordered, anchored, literal glob semantics for %p",
    (wildcard: string, actualValue: string, expected: boolean) => {
      expect(
        RuleCriteriaMatcher.matchesWithLegacySync({
          rule: makeRule(
            makeCriteria([
              makeFilter(
                "namePattern",
                RuleCriteriaOperator.MatchesPattern,
                wildcard,
              ),
            ]),
          ),
          legacyFields: ["namePattern", "descriptionPattern", "labels"],
          emptyResult: false,
          matchesLegacyRule: (rule: ExampleRule): boolean => {
            return new RegExp(rule.namePattern || "(?!)", "i").test(
              actualValue,
            );
          },
        }),
      ).toBe(expected);
    },
  );

  it("fails closed before evaluating an invalid negative pattern", () => {
    const matchesLegacyRule = jest.fn<SyncRuleMatcher>((): boolean => {
      return false;
    });

    expect(
      RuleCriteriaMatcher.matchesWithLegacySync({
        rule: makeRule(
          makeCriteria([
            makeFilter(
              "namePattern",
              RuleCriteriaOperator.DoesNotMatchPattern,
              "(",
            ),
          ]),
        ),
        legacyFields: ["namePattern", "descriptionPattern", "labels"],
        emptyResult: true,
        matchesLegacyRule: matchesLegacyRule,
      }),
    ).toBe(false);
    expect(matchesLegacyRule).not.toHaveBeenCalled();
  });

  it.each([
    [42, "42", true],
    [42, "forty-two", false],
    [true, "true", true],
    [false, "false", true],
  ])(
    "supports the scalar value %p through a safe exact pattern",
    (value: number | boolean, actualValue: string, expected: boolean) => {
      expect(
        RuleCriteriaMatcher.matchesWithLegacySync({
          rule: makeRule(
            makeCriteria([
              makeFilter("namePattern", RuleCriteriaOperator.Equals, value),
            ]),
          ),
          legacyFields: ["namePattern", "descriptionPattern", "labels"],
          emptyResult: false,
          matchesLegacyRule: textLegacyMatcher(actualValue),
        }),
      ).toBe(expected);
    },
  );

  it("escapes every regex metacharacter for literal text operators", () => {
    const literal: string = ".*+?^${}()|[]\\";

    expect(
      RuleCriteriaMatcher.matchesWithLegacySync({
        rule: makeRule(
          makeCriteria([
            makeFilter("namePattern", RuleCriteriaOperator.Equals, literal),
          ]),
        ),
        legacyFields: ["namePattern", "descriptionPattern", "labels"],
        emptyResult: false,
        matchesLegacyRule: textLegacyMatcher(literal),
      }),
    ).toBe(true);
    expect(
      RuleCriteriaMatcher.matchesWithLegacySync({
        rule: makeRule(
          makeCriteria([
            makeFilter("namePattern", RuleCriteriaOperator.Equals, literal),
          ]),
        ),
        legacyFields: ["namePattern", "descriptionPattern", "labels"],
        emptyResult: false,
        matchesLegacyRule: textLegacyMatcher("anything"),
      }),
    ).toBe(false);
  });

  it("does not evaluate a configured field outside the caller allowlist", () => {
    const matchesLegacyRule = jest.fn<SyncRuleMatcher>((): boolean => {
      return true;
    });

    expect(
      RuleCriteriaMatcher.matchesWithLegacySync({
        rule: makeRule(
          makeCriteria([
            makeFilter("unrecognizedField", RuleCriteriaOperator.Equals, "api"),
          ]),
        ),
        legacyFields: ["namePattern", "descriptionPattern", "labels"],
        emptyResult: true,
        matchesLegacyRule: matchesLegacyRule,
      }),
    ).toBe(false);
    expect(matchesLegacyRule).not.toHaveBeenCalled();
  });

  it("fails closed when a text operator is incompatible with a legacy relation field", () => {
    const rule: ExampleRule = makeRule(
      makeCriteria([
        makeFilter("labels", RuleCriteriaOperator.DoesNotContain, "label-a"),
      ]),
    );

    expect(
      RuleCriteriaMatcher.matchesWithLegacySync({
        rule: rule,
        legacyFields: ["namePattern", "descriptionPattern", "labels"],
        emptyResult: true,
        matchesLegacyRule: (clone: ExampleRule): boolean => {
          return Boolean(
            clone.labels?.map((item: RelatedItem): string => {
              return item.id?.toString() || item._id || "";
            }).length,
          );
        },
      }),
    ).toBe(false);
  });

  it("fails closed when an async legacy matcher rejects an incompatible filter", async () => {
    const rule: ExampleRule = makeRule(
      makeCriteria([
        makeFilter("labels", RuleCriteriaOperator.DoesNotContain, "label-a"),
      ]),
    );

    await expect(
      RuleCriteriaMatcher.matchesWithLegacy({
        rule: rule,
        legacyFields: ["namePattern", "descriptionPattern", "labels"],
        emptyResult: true,
        matchesLegacyRule: async (clone: ExampleRule): Promise<boolean> => {
          await Promise.resolve();
          return Boolean(
            clone.labels?.map((item: RelatedItem): string => {
              return item.id?.toString() || item._id || "";
            }).length,
          );
        },
      }),
    ).resolves.toBe(false);
  });
});

describe("RuleCriteriaMatcher relation legacy adapter", () => {
  it("matches HasAnyOf with all ID-bearing stubs in one legacy call", () => {
    const seenRules: Array<ExampleRule> = [];
    const matchesLegacyRule: (rule: ExampleRule) => boolean = (
      rule: ExampleRule,
    ): boolean => {
      seenRules.push(rule);
      return relationLegacyMatcher([LABEL_B_ID])(rule);
    };

    expect(
      RuleCriteriaMatcher.matchesWithLegacySync({
        rule: makeRule(
          makeCriteria([
            makeFilter("labels", RuleCriteriaOperator.HasAnyOf, [
              LABEL_A_ID,
              LABEL_B_ID,
            ]),
          ]),
        ),
        legacyFields: ["namePattern", "descriptionPattern", "labels"],
        emptyResult: false,
        matchesLegacyRule: matchesLegacyRule,
      }),
    ).toBe(true);
    expect(seenRules).toHaveLength(1);
    expect(seenRules[0]?.labels).toHaveLength(2);
    expect(seenRules[0]?.labels?.[0]?.id).toBeInstanceOf(ObjectID);
    expect(seenRules[0]?.labels?.[0]?._id).toBe(LABEL_A_ID);
  });

  it.each([
    [[LABEL_A_ID, LABEL_B_ID], [LABEL_A_ID, LABEL_B_ID], true],
    [[LABEL_A_ID], [LABEL_A_ID, LABEL_B_ID], false],
  ])(
    "implements HasAllOf for actual=%p requested=%p",
    (
      actualIds: Array<string>,
      requestedIds: Array<string>,
      expected: boolean,
    ) => {
      expect(
        RuleCriteriaMatcher.matchesWithLegacySync({
          rule: makeRule(
            makeCriteria([
              makeFilter("labels", RuleCriteriaOperator.HasAllOf, requestedIds),
            ]),
          ),
          legacyFields: ["namePattern", "descriptionPattern", "labels"],
          emptyResult: false,
          matchesLegacyRule: relationLegacyMatcher(actualIds),
        }),
      ).toBe(expected);
    },
  );

  it.each([
    [[LABEL_A_ID], [LABEL_B_ID, LABEL_C_ID], true],
    [[LABEL_A_ID, LABEL_B_ID], [LABEL_B_ID, LABEL_C_ID], false],
  ])(
    "implements HasNoneOf for actual=%p forbidden=%p",
    (
      actualIds: Array<string>,
      forbiddenIds: Array<string>,
      expected: boolean,
    ) => {
      expect(
        RuleCriteriaMatcher.matchesWithLegacySync({
          rule: makeRule(
            makeCriteria([
              makeFilter(
                "labels",
                RuleCriteriaOperator.HasNoneOf,
                forbiddenIds,
              ),
            ]),
          ),
          legacyFields: ["namePattern", "descriptionPattern", "labels"],
          emptyResult: false,
          matchesLegacyRule: relationLegacyMatcher(actualIds),
        }),
      ).toBe(expected);
    },
  );

  it("rejects an empty relation value without a legacy call", () => {
    const matchesLegacyRule = jest.fn<SyncRuleMatcher>((): boolean => {
      return true;
    });

    expect(
      RuleCriteriaMatcher.matchesWithLegacySync({
        rule: makeRule(
          makeCriteria([
            makeFilter("labels", RuleCriteriaOperator.HasAnyOf, []),
          ]),
        ),
        legacyFields: ["namePattern", "descriptionPattern", "labels"],
        emptyResult: true,
        matchesLegacyRule: matchesLegacyRule,
      }),
    ).toBe(false);
    expect(matchesLegacyRule).not.toHaveBeenCalled();
  });
});

describe("RuleCriteriaMatcher legacy fallback and mutation safety", () => {
  it.each([undefined, null])(
    "calls the legacy matcher exactly once for absent criteria=%p",
    (criteria: undefined | null) => {
      const rule: ExampleRule = makeRule(criteria);
      const matchesLegacyRule = jest.fn<SyncRuleMatcher>(
        (receivedRule: ExampleRule): boolean => {
          expect(receivedRule).toBe(rule);
          return true;
        },
      );

      expect(
        RuleCriteriaMatcher.matchesWithLegacySync({
          rule: rule,
          legacyFields: ["namePattern", "descriptionPattern", "labels"],
          emptyResult: false,
          matchesLegacyRule: matchesLegacyRule,
        }),
      ).toBe(true);
      expect(matchesLegacyRule).toHaveBeenCalledTimes(1);
    },
  );

  it("does not fall back to legacy fields for configured empty criteria", () => {
    const matchesLegacyRule = jest.fn<SyncRuleMatcher>((): boolean => {
      return true;
    });

    expect(
      RuleCriteriaMatcher.matchesWithLegacySync({
        rule: makeRule(makeCriteria([])),
        legacyFields: ["namePattern", "descriptionPattern", "labels"],
        emptyResult: false,
        matchesLegacyRule: matchesLegacyRule,
      }),
    ).toBe(false);
    expect(matchesLegacyRule).not.toHaveBeenCalled();
  });

  it("does not fall back to legacy fields for malformed configured criteria", () => {
    const rule: ExampleRule = makeRule(undefined);
    rule.criteria = { schemaVersion: 1, filters: [] };
    const matchesLegacyRule = jest.fn<SyncRuleMatcher>((): boolean => {
      return true;
    });

    expect(
      RuleCriteriaMatcher.matchesWithLegacySync({
        rule: rule,
        legacyFields: ["namePattern", "descriptionPattern", "labels"],
        emptyResult: true,
        matchesLegacyRule: matchesLegacyRule,
      }),
    ).toBe(false);
    expect(matchesLegacyRule).not.toHaveBeenCalled();
  });

  it("preserves the original rule while clearing every legacy field on a prototype-preserving clone", () => {
    const criteria: RuleCriteria = makeCriteria([
      makeFilter("namePattern", RuleCriteriaOperator.Contains, "api"),
    ]);
    const rule: ExampleRule = makeRule(criteria);
    const originalLabels: Array<RelatedItem> | undefined = rule.labels;
    const originalUntouched: { enabled: boolean } = rule.untouched;

    expect(
      RuleCriteriaMatcher.matchesWithLegacySync({
        rule: rule,
        legacyFields: ["namePattern", "descriptionPattern", "labels"],
        emptyResult: false,
        matchesLegacyRule: (clone: ExampleRule): boolean => {
          expect(clone).not.toBe(rule);
          expect(clone).toBeInstanceOf(ExampleRule);
          expect(clone.getKind()).toBe("example");
          expect(clone.criteria).toBeUndefined();
          expect(clone.namePattern).toBe("api");
          expect(clone.descriptionPattern).toBeUndefined();
          expect(clone.labels).toBeUndefined();
          expect(clone.untouched).toBe(originalUntouched);
          return true;
        },
      }),
    ).toBe(true);

    expect(rule.criteria).toBe(criteria);
    expect(rule.namePattern).toBe("legacy-name");
    expect(rule.descriptionPattern).toBe("legacy-description");
    expect(rule.labels).toBe(originalLabels);
    expect(rule.untouched).toBe(originalUntouched);
  });

  it("supports an asynchronous legacy matcher and awaits relation checks", async () => {
    const visitedIds: Array<string> = [];

    const result: boolean = await RuleCriteriaMatcher.matchesWithLegacy({
      rule: makeRule(
        makeCriteria([
          makeFilter("labels", RuleCriteriaOperator.HasAllOf, [
            LABEL_A_ID,
            LABEL_B_ID,
            LABEL_C_ID,
          ]),
        ]),
      ),
      legacyFields: ["namePattern", "descriptionPattern", "labels"],
      emptyResult: false,
      matchesLegacyRule: async (clone: ExampleRule): Promise<boolean> => {
        const id: string = clone.labels?.[0]?.id?.toString() || "";
        visitedIds.push(id);
        return id !== LABEL_B_ID;
      },
    });

    expect(result).toBe(false);
    expect(visitedIds).toEqual([LABEL_A_ID, LABEL_B_ID]);
  });

  it("calls an asynchronous legacy fallback exactly once", async () => {
    const rule: ExampleRule = makeRule(undefined);
    const matchesLegacyRule = jest.fn<AsyncRuleMatcher>(
      async (receivedRule: ExampleRule): Promise<boolean> => {
        expect(receivedRule).toBe(rule);
        return true;
      },
    );

    await expect(
      RuleCriteriaMatcher.matchesWithLegacy({
        rule: rule,
        legacyFields: ["namePattern", "descriptionPattern", "labels"],
        emptyResult: false,
        matchesLegacyRule: matchesLegacyRule,
      }),
    ).resolves.toBe(true);
    expect(matchesLegacyRule).toHaveBeenCalledTimes(1);
  });
});

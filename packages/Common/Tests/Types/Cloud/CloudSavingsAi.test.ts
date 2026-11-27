import { describe, expect, test } from "@jest/globals";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CLOUD_NON_PRODUCTION_WORDS,
  CloudResourceEnvironment,
  getCloudResourceEnvironment,
  getUnattendedCloudResourceEnvironment,
} from "../../../Types/Cloud/CloudResourceEnvironment";
import {
  CloudSavingsActionGroup,
  CloudSavingsActionKind,
  CloudSavingsActionUndo,
} from "../../../Types/Cloud/CloudSavingsAction";
import {
  CLOUD_SAVINGS_AI_AUTONOMY_LABELS,
  CLOUD_SAVINGS_AI_CHANGES_WITHOUT_ASKING_PER_HOUR,
  CLOUD_SAVINGS_AI_DEFAULT_MONTHLY_LIMIT,
  CLOUD_SAVINGS_AI_MAX_MONTHLY_LIMIT,
  CLOUD_SAVINGS_AI_REASON_SENTENCES,
  CLOUD_SAVINGS_AI_RULE_NEVER_ACTS_MESSAGE,
  CloudSavingsAiAutonomy,
  CloudSavingsAiDecision,
  CloudSavingsAiReason,
  CloudSavingsAiRuleFacts,
  CloudSavingsAiSaving,
  decideCloudSavingsAi,
  doesCloudSavingsAiRuleMatch,
  getCloudSavingsAiEnvironmentReason,
  getCloudSavingsAiRuleAutonomy,
  getCloudSavingsAiRuleGroups,
  getCloudSavingsAiRuleLimit,
  getCloudSavingsAiRuleLists,
  getCloudSavingsAiRuleProblem,
} from "../../../Types/Cloud/CloudSavingsAi";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaFilter,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";

/*
 * AI RULES FOR SAVINGS (#11010): what OneUptime AI does with a saving it
 * could make - leave it, propose it to the resource's owner, or make it
 * without asking - from the project's savings rules. The careful answer
 * wins between rules; production, an environment nothing says and a change
 * that cannot be undone always wait for a person; a rule's monthly limit
 * and the hourly circuit breaker hold what is made without asking.
 */

/*
 * An idle non-production AWS instance, worth 40 a month: the plainest
 * saving. What a change made without asking reads of its environment is
 * what every sign says, unless a test says otherwise: a resource its tags
 * or its account call non-production.
 */
function saving(
  overrides: Partial<CloudSavingsAiSaving> = {},
): CloudSavingsAiSaving {
  const environment: CloudResourceEnvironment | string =
    overrides.environment ?? CloudResourceEnvironment.NonProduction;

  return {
    provider: CloudProvider.AWS,
    kind: CloudSavingsActionKind.StopInstance,
    monthlySavings: 40,
    undo: CloudSavingsActionUndo.Undoable,
    ...overrides,
    environment,
    unattendedEnvironment: overrides.unattendedEnvironment ?? environment,
  };
}

function rule(
  name: string,
  overrides: Partial<CloudSavingsAiRuleFacts> = {},
): CloudSavingsAiRuleFacts {
  return {
    _id: `rule-${name}`,
    name,
    cloudSavingAutonomy: CloudSavingsAiAutonomy.WithoutAsking,
    cloudSavingActionGroups: [],
    cloudSavingEnvironments: [],
    cloudSavingProviders: [],
    cloudSavingMonthlyLimit: 500,
    ...overrides,
  };
}

function decide(
  rules: Array<CloudSavingsAiRuleFacts>,
  facts: Partial<CloudSavingsAiSaving> = {},
  changesWithoutAskingThisHour: number = 0,
): CloudSavingsAiDecision {
  return decideCloudSavingsAi({
    rules,
    saving: saving(facts),
    changesWithoutAskingThisHour,
  });
}

// Conditions as the form's builder and the API write them: every one, or any.
function criteriaOf(
  filters: Array<RuleCriteriaFilter>,
  filterCondition: FilterCondition = FilterCondition.All,
): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition,
    filters,
  };
}

function hasAnyOf(field: string, value: Array<string>): RuleCriteriaFilter {
  return { field, operator: RuleCriteriaOperator.HasAnyOf, value };
}

describe("decideCloudSavingsAi: with no savings rule", () => {
  test("proposes every saving, and says the project's defaults decided", () => {
    expect(decide([])).toEqual({
      autonomy: CloudSavingsAiAutonomy.Suggest,
      reason: CloudSavingsAiReason.Defaults,
      fromDefaults: true,
    });
  });

  test("proposes production, unknown and irreversible savings alike: a person decides each", () => {
    for (const facts of [
      { environment: CloudResourceEnvironment.Production },
      { environment: CloudResourceEnvironment.Unknown },
      {
        kind: CloudSavingsActionKind.ReleaseAddress,
        undo: CloudSavingsActionUndo.Never,
      },
      { monthlySavings: 1000000 },
    ]) {
      const decision: CloudSavingsAiDecision = decide([], facts);

      expect(decision.autonomy).toBe(CloudSavingsAiAutonomy.Suggest);
      expect(decision.reason).toBe(CloudSavingsAiReason.Defaults);
    }
  });

  test("never makes a change without asking, however many changes this hour", () => {
    expect(decide([], {}, 0).autonomy).not.toBe(
      CloudSavingsAiAutonomy.WithoutAsking,
    );
  });
});

describe("decideCloudSavingsAi: which rules match", () => {
  test("a project with rules, none of which covers the saving, leaves it", () => {
    const decision: CloudSavingsAiDecision = decide(
      [rule("Azure only", { cloudSavingProviders: [CloudProvider.Azure] })],
      { provider: CloudProvider.AWS },
    );

    expect(decision).toEqual({
      autonomy: CloudSavingsAiAutonomy.Off,
      reason: CloudSavingsAiReason.NoMatchingRule,
      fromDefaults: false,
    });
  });

  test("a rule matches by cloud, without minding case", () => {
    const aws: CloudSavingsAiRuleFacts = rule("AWS", {
      cloudSavingProviders: ["AWS"],
    });

    expect(doesCloudSavingsAiRuleMatch(aws, saving({ provider: "aws" }))).toBe(
      true,
    );
    expect(
      doesCloudSavingsAiRuleMatch(aws, saving({ provider: CloudProvider.GCP })),
    ).toBe(false);
  });

  test("a rule matches by environment", () => {
    const nonProduction: CloudSavingsAiRuleFacts = rule("Dev", {
      cloudSavingEnvironments: [CloudResourceEnvironment.NonProduction],
    });

    expect(doesCloudSavingsAiRuleMatch(nonProduction, saving())).toBe(true);
    expect(
      doesCloudSavingsAiRuleMatch(
        nonProduction,
        saving({ environment: CloudResourceEnvironment.Production }),
      ),
    ).toBe(false);
    expect(
      doesCloudSavingsAiRuleMatch(
        nonProduction,
        saving({ environment: CloudResourceEnvironment.Unknown }),
      ),
    ).toBe(false);
  });

  test("a rule matches by the kind of change, through its group", () => {
    const stops: CloudSavingsAiRuleFacts = rule("Stops", {
      cloudSavingActionGroups: [CloudSavingsActionGroup.Stop],
    });

    expect(
      doesCloudSavingsAiRuleMatch(
        stops,
        saving({ kind: CloudSavingsActionKind.StopDatabase }),
      ),
    ).toBe(true);
    expect(
      doesCloudSavingsAiRuleMatch(
        stops,
        saving({ kind: CloudSavingsActionKind.ResizeInstance }),
      ),
    ).toBe(false);
  });

  test("a change in no group - one that cannot be undone - matches only a rule that names no group", () => {
    const release: CloudSavingsAiSaving = saving({
      kind: CloudSavingsActionKind.ReleaseAddress,
      undo: CloudSavingsActionUndo.Never,
    });

    expect(doesCloudSavingsAiRuleMatch(rule("Every change"), release)).toBe(
      true,
    );
    expect(
      doesCloudSavingsAiRuleMatch(
        rule("Every group", {
          cloudSavingActionGroups: [
            CloudSavingsActionGroup.Stop,
            CloudSavingsActionGroup.ChangeVolumeType,
            CloudSavingsActionGroup.Resize,
            CloudSavingsActionGroup.DeleteVolume,
          ],
        }),
        release,
      ),
    ).toBe(false);
  });

  test("names a group no build wrote: read as no group at all", () => {
    expect(
      getCloudSavingsAiRuleGroups(
        rule("Odd", { cloudSavingActionGroups: ["Teleport", 7, null] }),
      ),
    ).toEqual([]);
    expect(
      getCloudSavingsAiRuleGroups(
        rule("Mixed", {
          cloudSavingActionGroups: [CloudSavingsActionGroup.Stop, "Teleport"],
        }),
      ),
    ).toEqual([CloudSavingsActionGroup.Stop]);
  });
});

describe("decideCloudSavingsAi: the careful answer wins", () => {
  test("Off beats Suggest and Without asking, whatever order the rules come in", () => {
    const rules: Array<CloudSavingsAiRuleFacts> = [
      rule("A acts"),
      rule("B proposes", {
        cloudSavingAutonomy: CloudSavingsAiAutonomy.Suggest,
      }),
      rule("C leaves", { cloudSavingAutonomy: CloudSavingsAiAutonomy.Off }),
    ];

    for (const order of [rules, [...rules].reverse()]) {
      const decision: CloudSavingsAiDecision = decide(order);

      expect(decision.autonomy).toBe(CloudSavingsAiAutonomy.Off);
      expect(decision.reason).toBe(CloudSavingsAiReason.RuleSaysOff);
      expect(decision.ruleName).toBe("C leaves");
      expect(decision.ruleId).toBe("rule-C leaves");
    }
  });

  test("Suggest beats Without asking", () => {
    const decision: CloudSavingsAiDecision = decide([
      rule("Acts"),
      rule("Proposes", {
        cloudSavingAutonomy: CloudSavingsAiAutonomy.Suggest,
      }),
    ]);

    expect(decision.autonomy).toBe(CloudSavingsAiAutonomy.Suggest);
    expect(decision.reason).toBe(CloudSavingsAiReason.RuleSaysSuggest);
    expect(decision.ruleName).toBe("Proposes");
  });

  test("between rules of one answer, the first by name is the one a line names", () => {
    const decision: CloudSavingsAiDecision = decide([
      rule("Zeta"),
      rule("Alpha"),
      rule("Mu"),
    ]);

    expect(decision.autonomy).toBe(CloudSavingsAiAutonomy.WithoutAsking);
    expect(decision.ruleName).toBe("Alpha");
  });

  test("a rule whose answer no build wrote reads as the default, Suggest", () => {
    expect(
      getCloudSavingsAiRuleAutonomy(
        rule("Odd", { cloudSavingAutonomy: "Yolo" }),
      ),
    ).toBe(CloudSavingsAiAutonomy.Suggest);
    expect(
      decide([rule("Odd", { cloudSavingAutonomy: undefined })]).autonomy,
    ).toBe(CloudSavingsAiAutonomy.Suggest);
  });
});

describe("decideCloudSavingsAi: what is never made without asking", () => {
  const acts: Array<CloudSavingsAiRuleFacts> = [rule("Acts on everything")];

  test("production waits for a person", () => {
    const decision: CloudSavingsAiDecision = decide(acts, {
      environment: CloudResourceEnvironment.Production,
    });

    expect(decision.autonomy).toBe(CloudSavingsAiAutonomy.Suggest);
    expect(decision.reason).toBe(CloudSavingsAiReason.Production);
    expect(decision.ruleName).toBe("Acts on everything");
  });

  test("a resource nothing says is not production waits for a person", () => {
    for (const environment of [
      CloudResourceEnvironment.Unknown,
      "",
      "staging?",
    ]) {
      const decision: CloudSavingsAiDecision = decide(acts, { environment });

      expect(decision.autonomy).toBe(CloudSavingsAiAutonomy.Suggest);
      expect(decision.reason).toBe(CloudSavingsAiReason.EnvironmentNotKnown);
    }
  });

  test("a change that cannot be undone waits for a person", () => {
    for (const kind of [
      CloudSavingsActionKind.ReleaseAddress,
      CloudSavingsActionKind.DeleteSnapshot,
      CloudSavingsActionKind.DeleteImage,
    ]) {
      const decision: CloudSavingsAiDecision = decide(acts, {
        kind,
        undo: CloudSavingsActionUndo.Never,
      });

      expect(decision.autonomy).toBe(CloudSavingsAiAutonomy.Suggest);
      expect(decision.reason).toBe(CloudSavingsAiReason.CannotBeUndone);
    }
  });

  test("a volume deleted with no snapshot to restore waits for a person", () => {
    const decision: CloudSavingsAiDecision = decide(acts, {
      kind: CloudSavingsActionKind.DeleteVolume,
      undo: CloudSavingsActionUndo.Never,
    });

    expect(decision.reason).toBe(CloudSavingsAiReason.CannotBeUndone);
  });

  test("a volume deleted after a final snapshot may be made: it is restored from it", () => {
    const decision: CloudSavingsAiDecision = decide(acts, {
      kind: CloudSavingsActionKind.DeleteVolume,
      undo: CloudSavingsActionUndo.FromSnapshot,
    });

    expect(decision.autonomy).toBe(CloudSavingsAiAutonomy.WithoutAsking);
    expect(decision.reason).toBe(CloudSavingsAiReason.RuleAllows);
  });
});

/*
 * #11347: a resource's environment was one reading, labels' names
 * included, so renaming a label to "dev" let a rule act without asking on
 * every resource that carried it. A change made without asking now reads
 * non-production only from the cloud's tags and the account's setting.
 */
describe("decideCloudSavingsAi: what only a label calls non-production (#11347)", () => {
  const acts: Array<CloudSavingsAiRuleFacts> = [rule("Acts on everything")];

  // A resource with no environment tag, in an account nothing is said of.
  function labelled(labelNames: Array<string>): Partial<CloudSavingsAiSaving> {
    const signs: { labelNames: Array<string> } = { labelNames };

    return {
      environment: getCloudResourceEnvironment(signs).environment,
      unattendedEnvironment:
        getUnattendedCloudResourceEnvironment(signs).environment,
    };
  }

  test("the gap: read with every sign as one, a label renamed to dev was made without asking", () => {
    const signs: { labelNames: Array<string> } = { labelNames: ["dev"] };
    // Before #11347, the decision read every sign's environment for both.
    const asBefore: string = getCloudResourceEnvironment(signs).environment;

    expect(
      decide(acts, {
        environment: asBefore,
        unattendedEnvironment: asBefore,
      }).autonomy,
    ).toBe(CloudSavingsAiAutonomy.WithoutAsking);
    // Now the same label is proposed: only its name said non-production.
    expect(decide(acts, labelled(["dev"]))).toMatchObject({
      autonomy: CloudSavingsAiAutonomy.Suggest,
      reason: CloudSavingsAiReason.OnlyLabelsSayNonProduction,
      ruleName: "Acts on everything",
    });
  });

  test("whatever a resource's labels are named, a rule never makes a change to it without asking on them alone", () => {
    for (const name of [
      ...CLOUD_NON_PRODUCTION_WORDS,
      "Staging",
      "env: dev",
      "environment=qa",
      "stage: sandbox",
      "deployment.environment: test",
      "team-a",
      "",
    ]) {
      const decision: CloudSavingsAiDecision = decide(acts, labelled([name]));

      expect({ name, autonomy: decision.autonomy }).toEqual({
        name,
        autonomy: CloudSavingsAiAutonomy.Suggest,
      });
      expect([
        CloudSavingsAiReason.OnlyLabelsSayNonProduction,
        CloudSavingsAiReason.EnvironmentNotKnown,
      ]).toContain(decision.reason);
    }
  });

  test("a label that says production still says it: the change waits as production", () => {
    for (const name of ["Production", "prod", "env: live", "environment=prd"]) {
      expect(decide(acts, labelled([name, "dev"])).reason).toBe(
        CloudSavingsAiReason.Production,
      );
    }
  });

  test("a rule for non-production still covers what only a label calls so: it is proposed, not left", () => {
    const decision: CloudSavingsAiDecision = decide(
      [
        rule("Stop non-production", {
          cloudSavingEnvironments: [CloudResourceEnvironment.NonProduction],
        }),
        rule("Leave production", {
          cloudSavingEnvironments: [CloudResourceEnvironment.Production],
          cloudSavingAutonomy: CloudSavingsAiAutonomy.Off,
        }),
      ],
      labelled(["Staging"]),
    );

    expect(decision).toMatchObject({
      autonomy: CloudSavingsAiAutonomy.Suggest,
      reason: CloudSavingsAiReason.OnlyLabelsSayNonProduction,
      ruleName: "Stop non-production",
    });
  });

  test("what the tags or the account say is non-production is made without asking, as before", () => {
    for (const signs of [
      { tags: { environment: "dev" } },
      { accountEnvironment: CloudResourceEnvironment.NonProduction },
      { tags: { env: "staging" }, labelNames: ["team-a"] },
      { accountEnvironment: "NonProduction", labelNames: ["QA"] },
    ]) {
      expect(
        decide(acts, {
          environment: getCloudResourceEnvironment(signs).environment,
          unattendedEnvironment:
            getUnattendedCloudResourceEnvironment(signs).environment,
        }),
      ).toMatchObject({
        autonomy: CloudSavingsAiAutonomy.WithoutAsking,
        reason: CloudSavingsAiReason.RuleAllows,
      });
    }
  });

  test("is made without asking exactly when both readings say non-production, whatever either says", () => {
    const values: Array<string> = [
      CloudResourceEnvironment.Production,
      CloudResourceEnvironment.NonProduction,
      CloudResourceEnvironment.Unknown,
      "",
      "nonproduction",
    ];

    for (const environment of values) {
      for (const unattendedEnvironment of values) {
        const decision: CloudSavingsAiDecision = decide(acts, {
          environment,
          unattendedEnvironment,
        });
        const both: boolean =
          environment === CloudResourceEnvironment.NonProduction &&
          unattendedEnvironment === CloudResourceEnvironment.NonProduction;

        expect({
          environment,
          unattendedEnvironment,
          made: decision.autonomy === CloudSavingsAiAutonomy.WithoutAsking,
        }).toEqual({ environment, unattendedEnvironment, made: both });

        if (
          environment === CloudResourceEnvironment.Production ||
          unattendedEnvironment === CloudResourceEnvironment.Production
        ) {
          expect(decision.reason).toBe(CloudSavingsAiReason.Production);
        }
      }
    }
  });

  test("a rule that says Off or Suggest answers before the environment is read", () => {
    expect(
      decide(
        [rule("Leave it", { cloudSavingAutonomy: CloudSavingsAiAutonomy.Off })],
        labelled(["dev"]),
      ).reason,
    ).toBe(CloudSavingsAiReason.RuleSaysOff);
    expect(
      decide(
        [
          rule("Ask", {
            cloudSavingAutonomy: CloudSavingsAiAutonomy.Suggest,
          }),
        ],
        labelled(["dev"]),
      ).reason,
    ).toBe(CloudSavingsAiReason.RuleSaysSuggest);
  });

  test("the environment is read before the limit and the breaker", () => {
    expect(
      decide(
        acts,
        { ...labelled(["dev"]), monthlySavings: 1000000 },
        CLOUD_SAVINGS_AI_CHANGES_WITHOUT_ASKING_PER_HOUR,
      ).reason,
    ).toBe(CloudSavingsAiReason.OnlyLabelsSayNonProduction);
  });

  test("with no rule, a resource only labels call non-production is proposed by the defaults, as every saving is", () => {
    expect(decide([], labelled(["dev"]))).toEqual({
      autonomy: CloudSavingsAiAutonomy.Suggest,
      reason: CloudSavingsAiReason.Defaults,
      fromDefaults: true,
    });
  });
});

describe("getCloudSavingsAiEnvironmentReason", () => {
  test("production on either reading", () => {
    for (const [environment, unattendedEnvironment] of [
      [
        CloudResourceEnvironment.Production,
        CloudResourceEnvironment.Production,
      ],
      [
        CloudResourceEnvironment.NonProduction,
        CloudResourceEnvironment.Production,
      ],
      [CloudResourceEnvironment.Production, CloudResourceEnvironment.Unknown],
    ] as Array<[string, string]>) {
      expect(
        getCloudSavingsAiEnvironmentReason({
          environment,
          unattendedEnvironment,
        }),
      ).toBe(CloudSavingsAiReason.Production);
    }
  });

  test("non-production on both: nothing keeps it from being made", () => {
    expect(
      getCloudSavingsAiEnvironmentReason({
        environment: CloudResourceEnvironment.NonProduction,
        unattendedEnvironment: CloudResourceEnvironment.NonProduction,
      }),
    ).toBeNull();
  });

  test("non-production on every sign's alone: only its labels say so", () => {
    expect(
      getCloudSavingsAiEnvironmentReason({
        environment: CloudResourceEnvironment.NonProduction,
        unattendedEnvironment: CloudResourceEnvironment.Unknown,
      }),
    ).toBe(CloudSavingsAiReason.OnlyLabelsSayNonProduction);
  });

  test("anything else is not known: never taken for non-production", () => {
    for (const [environment, unattendedEnvironment] of [
      [CloudResourceEnvironment.Unknown, CloudResourceEnvironment.Unknown],
      [
        CloudResourceEnvironment.Unknown,
        CloudResourceEnvironment.NonProduction,
      ],
      ["", ""],
      ["NonProduction ", CloudResourceEnvironment.NonProduction],
    ] as Array<[string, string]>) {
      expect(
        getCloudSavingsAiEnvironmentReason({
          environment,
          unattendedEnvironment,
        }),
      ).toBe(CloudSavingsAiReason.EnvironmentNotKnown);
    }
  });

  test("its reasons are each one a person always approves, with a sentence that says why", () => {
    expect(
      CLOUD_SAVINGS_AI_REASON_SENTENCES[
        CloudSavingsAiReason.OnlyLabelsSayNonProduction
      ],
    ).toBe(
      "Proposed: only its OneUptime labels say the resource is not production, so a person approves.",
    );
  });
});

describe("decideCloudSavingsAi: limits", () => {
  test("a saving at the rule's limit is made; one over it is proposed", () => {
    const capped: Array<CloudSavingsAiRuleFacts> = [
      rule("Up to 100", { cloudSavingMonthlyLimit: 100 }),
    ];

    expect(decide(capped, { monthlySavings: 100 }).autonomy).toBe(
      CloudSavingsAiAutonomy.WithoutAsking,
    );

    const over: CloudSavingsAiDecision = decide(capped, {
      monthlySavings: 100.01,
    });

    expect(over.autonomy).toBe(CloudSavingsAiAutonomy.Suggest);
    expect(over.reason).toBe(CloudSavingsAiReason.OverLimit);
    expect(over.ruleName).toBe("Up to 100");
  });

  test("the smallest limit of the matching rules holds", () => {
    const rules: Array<CloudSavingsAiRuleFacts> = [
      rule("Generous", { cloudSavingMonthlyLimit: 1000 }),
      rule("Careful", { cloudSavingMonthlyLimit: 30 }),
    ];

    expect(decide(rules, { monthlySavings: 31 }).reason).toBe(
      CloudSavingsAiReason.OverLimit,
    );
    expect(decide(rules, { monthlySavings: 30 }).reason).toBe(
      CloudSavingsAiReason.RuleAllows,
    );
  });

  test("a rule that does not match the saving does not lend it its limit", () => {
    const rules: Array<CloudSavingsAiRuleFacts> = [
      rule("AWS", { cloudSavingMonthlyLimit: 1000 }),
      rule("Azure, careful", {
        cloudSavingMonthlyLimit: 10,
        cloudSavingProviders: [CloudProvider.Azure],
      }),
    ];

    expect(decide(rules, { monthlySavings: 200 }).reason).toBe(
      CloudSavingsAiReason.RuleAllows,
    );
  });

  test("a rule with no limit holds to the default, never to no limit at all", () => {
    for (const limit of [undefined, null, "", "lots", -5]) {
      const rules: Array<CloudSavingsAiRuleFacts> = [
        rule("No limit", { cloudSavingMonthlyLimit: limit }),
      ];

      expect(
        decide(rules, {
          monthlySavings: CLOUD_SAVINGS_AI_DEFAULT_MONTHLY_LIMIT,
        }).reason,
      ).toBe(CloudSavingsAiReason.RuleAllows);
      expect(
        decide(rules, {
          monthlySavings: CLOUD_SAVINGS_AI_DEFAULT_MONTHLY_LIMIT + 1,
        }).reason,
      ).toBe(CloudSavingsAiReason.OverLimit);
    }
  });

  test("a limit of 0 makes nothing that saves anything without asking", () => {
    expect(
      decide([rule("Zero", { cloudSavingMonthlyLimit: 0 })], {
        monthlySavings: 0.01,
      }).reason,
    ).toBe(CloudSavingsAiReason.OverLimit);
  });

  test("a limit stored as text (a decimal column) is read as its number", () => {
    expect(
      getCloudSavingsAiRuleLimit(
        rule("Text", { cloudSavingMonthlyLimit: "250.50" }),
      ),
    ).toBe(250.5);
    expect(
      decide([rule("Text", { cloudSavingMonthlyLimit: "250.50" })], {
        monthlySavings: 251,
      }).reason,
    ).toBe(CloudSavingsAiReason.OverLimit);
  });

  test(`the circuit breaker: after ${CLOUD_SAVINGS_AI_CHANGES_WITHOUT_ASKING_PER_HOUR} changes made without asking this hour, the next is proposed`, () => {
    const acts: Array<CloudSavingsAiRuleFacts> = [rule("Acts")];

    expect(
      decide(acts, {}, CLOUD_SAVINGS_AI_CHANGES_WITHOUT_ASKING_PER_HOUR - 1)
        .autonomy,
    ).toBe(CloudSavingsAiAutonomy.WithoutAsking);

    for (const made of [
      CLOUD_SAVINGS_AI_CHANGES_WITHOUT_ASKING_PER_HOUR,
      CLOUD_SAVINGS_AI_CHANGES_WITHOUT_ASKING_PER_HOUR + 40,
    ]) {
      const decision: CloudSavingsAiDecision = decide(acts, {}, made);

      expect(decision.autonomy).toBe(CloudSavingsAiAutonomy.Suggest);
      expect(decision.reason).toBe(CloudSavingsAiReason.CircuitBreaker);
    }
  });

  test("production is refused before the limit and the breaker are read", () => {
    const decision: CloudSavingsAiDecision = decide(
      [rule("Acts", { cloudSavingMonthlyLimit: 1 })],
      { environment: CloudResourceEnvironment.Production, monthlySavings: 99 },
      CLOUD_SAVINGS_AI_CHANGES_WITHOUT_ASKING_PER_HOUR,
    );

    expect(decision.reason).toBe(CloudSavingsAiReason.Production);
  });
});

describe("getCloudSavingsAiRuleProblem", () => {
  test("a rule as the form writes it can be saved", () => {
    expect(
      getCloudSavingsAiRuleProblem({
        cloudSavingAutonomy: CloudSavingsAiAutonomy.WithoutAsking,
        cloudSavingActionGroups: [CloudSavingsActionGroup.Stop],
        cloudSavingEnvironments: [CloudResourceEnvironment.NonProduction],
        cloudSavingProviders: [CloudProvider.AWS, CloudProvider.Azure],
        cloudSavingMonthlyLimit: 500,
      }),
    ).toBeNull();
    expect(getCloudSavingsAiRuleProblem({})).toBeNull();
  });

  test("refuses an answer no build knows", () => {
    expect(
      getCloudSavingsAiRuleProblem({ cloudSavingAutonomy: "Always" }),
    ).toContain("Autonomy must be one of Off, Suggest, WithoutAsking");
  });

  test("refuses lists that are not lists of known values", () => {
    expect(
      getCloudSavingsAiRuleProblem({ cloudSavingActionGroups: "Stop" }),
    ).toContain("Cloud Saving: Changes must be a list of");
    expect(
      getCloudSavingsAiRuleProblem({ cloudSavingEnvironments: ["Prod"] }),
    ).toContain("Cloud Saving: Environments must be a list of");
    expect(
      getCloudSavingsAiRuleProblem({ cloudSavingProviders: ["oracle"] }),
    ).toContain("Cloud Saving: Clouds must be a list of");
    expect(
      getCloudSavingsAiRuleProblem({
        cloudSavingProviders: new Array(21).fill(CloudProvider.AWS),
      }),
    ).toContain("Cloud Saving: Clouds must be a list of");
  });

  test("refuses a limit that is not a number from 0 to the most", () => {
    for (const limit of [-1, "ten", CLOUD_SAVINGS_AI_MAX_MONTHLY_LIMIT + 1]) {
      expect(
        getCloudSavingsAiRuleProblem({ cloudSavingMonthlyLimit: limit }),
      ).toBe(
        `Cloud Saving: Monthly Limit must be a number from 0 to ${CLOUD_SAVINGS_AI_MAX_MONTHLY_LIMIT}.`,
      );
    }

    expect(
      getCloudSavingsAiRuleProblem({ cloudSavingMonthlyLimit: 0 }),
    ).toBeNull();
  });

  test("refuses a rule that would act without asking only where it never acts", () => {
    expect(
      getCloudSavingsAiRuleProblem({
        cloudSavingAutonomy: CloudSavingsAiAutonomy.WithoutAsking,
        cloudSavingEnvironments: [CloudResourceEnvironment.Production],
      }),
    ).toBe(CLOUD_SAVINGS_AI_RULE_NEVER_ACTS_MESSAGE);
    expect(
      getCloudSavingsAiRuleProblem({
        cloudSavingAutonomy: CloudSavingsAiAutonomy.WithoutAsking,
        cloudSavingEnvironments: [
          CloudResourceEnvironment.Production,
          CloudResourceEnvironment.NonProduction,
        ],
      }),
    ).toBeNull();
    // Proposing production is what a person wants: it is allowed.
    expect(
      getCloudSavingsAiRuleProblem({
        cloudSavingAutonomy: CloudSavingsAiAutonomy.Suggest,
        cloudSavingEnvironments: [CloudResourceEnvironment.Production],
      }),
    ).toBeNull();
  });
});

/*
 * A rule's versioned conditions (criteria): the form's conditions builder
 * writes them, as the API and Terraform may, and they are read through the
 * criteria matcher every rule uses. A rule saved before it had any keeps
 * working from its columns.
 */
describe("a savings rule's conditions", () => {
  const stopsInNonProduction: RuleCriteria = criteriaOf([
    hasAnyOf("cloudSavingActionGroups", [CloudSavingsActionGroup.Stop]),
    hasAnyOf("cloudSavingEnvironments", [
      CloudResourceEnvironment.NonProduction,
    ]),
  ]);

  test("every condition must hold: a non-production stop, never a resize or production", () => {
    const covering: CloudSavingsAiRuleFacts = rule("Conditions", {
      criteria: stopsInNonProduction,
    });

    expect(doesCloudSavingsAiRuleMatch(covering, saving())).toBe(true);
    expect(
      doesCloudSavingsAiRuleMatch(
        covering,
        saving({ kind: CloudSavingsActionKind.ResizeInstance }),
      ),
    ).toBe(false);
    expect(
      doesCloudSavingsAiRuleMatch(
        covering,
        saving({ environment: CloudResourceEnvironment.Production }),
      ),
    ).toBe(false);
  });

  test("they win over the columns a rule still holds", () => {
    const covering: CloudSavingsAiRuleFacts = rule("Conditions", {
      criteria: stopsInNonProduction,
      // Columns an older save left: read only while the rule has no conditions.
      cloudSavingActionGroups: [CloudSavingsActionGroup.Resize],
    });

    expect(doesCloudSavingsAiRuleMatch(covering, saving())).toBe(true);
    expect(
      doesCloudSavingsAiRuleMatch(
        covering,
        saving({ kind: CloudSavingsActionKind.ResizeInstance }),
      ),
    ).toBe(false);
  });

  test("any condition may hold, when the rule says any", () => {
    const either: CloudSavingsAiRuleFacts = rule("Either", {
      criteria: criteriaOf(
        [
          hasAnyOf("cloudSavingActionGroups", [
            CloudSavingsActionGroup.ChangeVolumeType,
          ]),
          hasAnyOf("cloudSavingProviders", [CloudProvider.GCP]),
        ],
        FilterCondition.Any,
      ),
    });

    expect(
      doesCloudSavingsAiRuleMatch(
        either,
        saving({ kind: CloudSavingsActionKind.ChangeVolumeType }),
      ),
    ).toBe(true);
    expect(
      doesCloudSavingsAiRuleMatch(
        either,
        saving({ provider: CloudProvider.GCP }),
      ),
    ).toBe(true);
    expect(doesCloudSavingsAiRuleMatch(either, saving())).toBe(false);
  });

  test("has none of: every environment but the ones named", () => {
    const notProduction: CloudSavingsAiRuleFacts = rule("Not production", {
      criteria: criteriaOf([
        {
          field: "cloudSavingEnvironments",
          operator: RuleCriteriaOperator.HasNoneOf,
          value: [CloudResourceEnvironment.Production],
        },
      ]),
    });

    expect(doesCloudSavingsAiRuleMatch(notProduction, saving())).toBe(true);
    expect(
      doesCloudSavingsAiRuleMatch(
        notProduction,
        saving({ environment: CloudResourceEnvironment.Production }),
      ),
    ).toBe(false);
  });

  test("no condition: every saving, as a rule with empty columns", () => {
    expect(
      doesCloudSavingsAiRuleMatch(
        rule("Everything", { criteria: criteriaOf([]) }),
        saving({ kind: CloudSavingsActionKind.ReleaseAddress }),
      ),
    ).toBe(true);
  });

  test("a condition on a field no savings rule has matches nothing", () => {
    expect(
      doesCloudSavingsAiRuleMatch(
        rule("Monitors", {
          criteria: criteriaOf([hasAnyOf("monitors", ["anything"])]),
        }),
        saving(),
      ),
    ).toBe(false);
  });

  test("they decide what is made, under the same limits", () => {
    const rules: Array<CloudSavingsAiRuleFacts> = [
      rule("Conditions", {
        criteria: stopsInNonProduction,
        cloudSavingMonthlyLimit: 100,
      }),
    ];

    expect(decide(rules).autonomy).toBe(CloudSavingsAiAutonomy.WithoutAsking);
    expect(decide(rules, { monthlySavings: 150 })).toMatchObject({
      autonomy: CloudSavingsAiAutonomy.Suggest,
      reason: CloudSavingsAiReason.OverLimit,
    });
    // A resize is no saving the rule covers: with rules, nothing is done.
    expect(
      decide(rules, { kind: CloudSavingsActionKind.ResizeInstance }),
    ).toMatchObject({
      autonomy: CloudSavingsAiAutonomy.Off,
      reason: CloudSavingsAiReason.NoMatchingRule,
    });
  });

  test("a row reads the lists its conditions or its columns hold", () => {
    expect(
      getCloudSavingsAiRuleLists(
        rule("Columns", {
          cloudSavingActionGroups: [CloudSavingsActionGroup.Stop],
          cloudSavingProviders: [CloudProvider.Azure],
        }),
      ),
    ).toEqual({
      groups: [CloudSavingsActionGroup.Stop],
      environments: [],
      providers: [CloudProvider.Azure],
    });
    expect(
      getCloudSavingsAiRuleLists(
        rule("Conditions", { criteria: stopsInNonProduction }),
      ),
    ).toEqual({
      groups: [CloudSavingsActionGroup.Stop],
      environments: [CloudResourceEnvironment.NonProduction],
      providers: [],
    });
    // Two conditions on one field: the savings both cover.
    expect(
      getCloudSavingsAiRuleLists(
        rule("Twice", {
          criteria: criteriaOf([
            hasAnyOf("cloudSavingProviders", [
              CloudProvider.AWS,
              CloudProvider.GCP,
            ]),
            hasAnyOf("cloudSavingProviders", [CloudProvider.GCP]),
          ]),
        }),
      )?.providers,
    ).toEqual([CloudProvider.GCP]);
  });

  test("conditions lists cannot say are left to the builder's words", () => {
    expect(
      getCloudSavingsAiRuleLists(
        rule("Either", {
          criteria: criteriaOf(
            [hasAnyOf("cloudSavingProviders", [CloudProvider.GCP])],
            FilterCondition.Any,
          ),
        }),
      ),
    ).toBeNull();
    expect(
      getCloudSavingsAiRuleLists(
        rule("Not production", {
          criteria: criteriaOf([
            {
              field: "cloudSavingEnvironments",
              operator: RuleCriteriaOperator.HasNoneOf,
              value: [CloudResourceEnvironment.Production],
            },
          ]),
        }),
      ),
    ).toBeNull();
  });

  test("a rule's conditions are held to known values, as its columns are", () => {
    expect(
      getCloudSavingsAiRuleProblem({
        criteria: stopsInNonProduction,
        cloudSavingAutonomy: CloudSavingsAiAutonomy.WithoutAsking,
      }),
    ).toBeNull();
    expect(
      getCloudSavingsAiRuleProblem({
        criteria: criteriaOf([hasAnyOf("cloudSavingActionGroups", ["Reboot"])]),
      }),
    ).toMatch(/^Cloud Saving: Changes must be a list of: /);
    expect(
      getCloudSavingsAiRuleProblem({
        criteria: criteriaOf([
          {
            field: "cloudSavingProviders",
            operator: RuleCriteriaOperator.Contains,
            value: "aws",
          },
        ]),
      }),
    ).toMatch(/^Cloud Saving: Clouds must be a list of: /);
  });

  test("a rule that acts without asking must leave non-production in its conditions", () => {
    for (const environments of [
      criteriaOf([
        hasAnyOf("cloudSavingEnvironments", [
          CloudResourceEnvironment.Production,
        ]),
      ]),
      criteriaOf([
        {
          field: "cloudSavingEnvironments",
          operator: RuleCriteriaOperator.HasNoneOf,
          value: [CloudResourceEnvironment.NonProduction],
        },
      ]),
    ]) {
      expect(
        getCloudSavingsAiRuleProblem({
          criteria: environments,
          cloudSavingAutonomy: CloudSavingsAiAutonomy.WithoutAsking,
        }),
      ).toBe(CLOUD_SAVINGS_AI_RULE_NEVER_ACTS_MESSAGE);
      // Proposing them is fine: a person decides each.
      expect(
        getCloudSavingsAiRuleProblem({
          criteria: environments,
          cloudSavingAutonomy: CloudSavingsAiAutonomy.Suggest,
        }),
      ).toBeNull();
    }
  });
});

describe("the words a timeline and a form say", () => {
  test("every answer has a label and every reason a sentence", () => {
    for (const autonomy of Object.values(CloudSavingsAiAutonomy)) {
      expect(CLOUD_SAVINGS_AI_AUTONOMY_LABELS[autonomy]).toBeTruthy();
    }

    for (const reason of Object.values(CloudSavingsAiReason)) {
      expect(CLOUD_SAVINGS_AI_REASON_SENTENCES[reason]).toMatch(/\.$/);
    }
  });
});

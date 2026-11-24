import { describe, expect, test } from "@jest/globals";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { CloudResourceEnvironment } from "../../../Types/Cloud/CloudResourceEnvironment";
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
  getCloudSavingsAiRuleAutonomy,
  getCloudSavingsAiRuleGroups,
  getCloudSavingsAiRuleLimit,
  getCloudSavingsAiRuleProblem,
} from "../../../Types/Cloud/CloudSavingsAi";

/*
 * AI RULES FOR SAVINGS (#11010): what OneUptime AI does with a saving it
 * could make - leave it, propose it to the resource's owner, or make it
 * without asking - from the project's savings rules. The careful answer
 * wins between rules; production, an environment nothing says and a change
 * that cannot be undone always wait for a person; a rule's monthly limit
 * and the hourly circuit breaker hold what is made without asking.
 */

// An idle non-production AWS instance, worth 40 a month: the plainest saving.
function saving(
  overrides: Partial<CloudSavingsAiSaving> = {},
): CloudSavingsAiSaving {
  return {
    provider: CloudProvider.AWS,
    kind: CloudSavingsActionKind.StopInstance,
    environment: CloudResourceEnvironment.NonProduction,
    monthlySavings: 40,
    undo: CloudSavingsActionUndo.Undoable,
    ...overrides,
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

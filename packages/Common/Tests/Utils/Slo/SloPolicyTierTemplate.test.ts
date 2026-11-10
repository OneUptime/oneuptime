import { describe, expect, test } from "@jest/globals";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";
import {
  TemplateVariable,
  TemplateVariableGroup,
} from "../../../Types/Template/TemplateVariable";
import {
  DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE,
  DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE,
  DEFAULT_SLO_POLICY_TIER_DESCRIPTION_TEMPLATE,
  DEFAULT_SLO_POLICY_TIER_TITLE_TEMPLATE,
  SLO_BURN_RATE_TEMPLATE_VARIABLES,
  SLO_BURN_RATE_TEMPLATE_VARIABLE_GROUPS,
  SLO_POLICY_TIER_NONE_TEXT,
  SLO_POLICY_TIER_TEMPLATE_VARIABLES,
  SLO_POLICY_TIER_TEMPLATE_VARIABLE_GROUPS,
  SloBurnRateTemplateContext,
  SloBurnRateTemplateVariable,
  SloBurnRateTemplateVariableDefinition,
  SloBurnRateTemplateVariables,
  SloPolicyTierTemplateContext,
  buildSloBurnRateTemplateVariables,
  buildSloPolicyTierTemplateVariables,
  renderSloBurnRateTemplate,
} from "../../../Utils/Slo/SloBurnRateTemplate";

/*
 * The error budget policy's template variables: {{policyTier}} and its two
 * siblings, offered to burn rate rules and policy tiers alike, and the
 * catalog and default text a tier's records use. The burn rate side of the
 * contract is pinned in SloBurnRateTemplate.test.ts; this holds the tier side
 * to the same standard - every variable a catalog offers is one the map
 * fills in.
 */

const POLICY_TIER_KEYS: Array<SloBurnRateTemplateVariable> = [
  SloBurnRateTemplateVariable.PolicyTier,
  SloBurnRateTemplateVariable.PolicyTierThresholdPercentage,
  SloBurnRateTemplateVariable.PolicyTierWhatWeDo,
];

// The rule's own variables, which a tier has nothing to say for.
const RULE_KEYS: Array<SloBurnRateTemplateVariable> = [
  SloBurnRateTemplateVariable.RuleName,
  SloBurnRateTemplateVariable.BurnRateThreshold,
  SloBurnRateTemplateVariable.LongWindowBurnRate,
  SloBurnRateTemplateVariable.ShortWindowBurnRate,
  SloBurnRateTemplateVariable.LongWindowInMinutes,
  SloBurnRateTemplateVariable.ShortWindowInMinutes,
];

const RELIABILITY_FIRST: {
  name: string;
  thresholdPercentage: number;
  whatWeDo: string;
} = {
  name: "Reliability first",
  thresholdPercentage: 25,
  whatWeDo: "Only **reliability** work ships.\n\nNo new features.",
};

function tierContext(
  overrides: Partial<SloPolicyTierTemplateContext> = {},
): SloPolicyTierTemplateContext {
  return {
    sloId: "slo-1",
    sloName: "Checkout availability",
    sloLink: "https://oneuptime.com/dashboard/project-1/slos/slo-1",
    sloStatus: "At Risk",
    targetPercentage: 99.9,
    currentSliPercentage: 99.87321,
    errorBudgetRemainingPercentage: 18.4567,
    errorBudgetRemainingSeconds: 478.3,
    windowType: SloWindowType.Rolling,
    windowDays: 30,
    timezone: undefined,
    policyTier: RELIABILITY_FIRST,
    ...overrides,
  };
}

function burnRateContext(
  overrides: Partial<SloBurnRateTemplateContext> = {},
): SloBurnRateTemplateContext {
  return {
    ...tierContext(),
    ruleName: "Fast burn",
    burnRateThreshold: 14.4,
    longWindowBurnRate: 21.456,
    shortWindowBurnRate: 36,
    longWindowInMinutes: 60,
    shortWindowInMinutes: 5,
    ...overrides,
  };
}

function keysOf(
  definitions: ReadonlyArray<SloBurnRateTemplateVariableDefinition>,
): Array<string> {
  return definitions.map(
    (definition: SloBurnRateTemplateVariableDefinition): string => {
      return definition.key;
    },
  );
}

describe("the policy tier variables", () => {
  test("are named the way the docs and the issue name them", () => {
    expect(POLICY_TIER_KEYS).toEqual([
      "policyTier",
      "policyTierThresholdPercentage",
      "policyTierWhatWeDo",
    ]);
  });

  test("burn rate rules are offered them, each with a description and an example", () => {
    const burnRateKeys: Array<string> = keysOf(
      SLO_BURN_RATE_TEMPLATE_VARIABLES,
    );

    for (const key of POLICY_TIER_KEYS) {
      expect(burnRateKeys).toContain(key);
    }

    for (const definition of SLO_BURN_RATE_TEMPLATE_VARIABLES.filter(
      (candidate: SloBurnRateTemplateVariableDefinition): boolean => {
        return POLICY_TIER_KEYS.includes(candidate.key);
      },
    )) {
      expect(definition.description.trim()).not.toBe("");
      expect(definition.example.trim()).not.toBe("");
      // The help table is Markdown: no angle brackets in the examples.
      expect(definition.example).not.toMatch(/[<>]/);
    }
  });

  test("{{policyTier}} says what it shows when the SLO is in no tier", () => {
    const definition: SloBurnRateTemplateVariableDefinition | undefined =
      SLO_BURN_RATE_TEMPLATE_VARIABLES.find(
        (candidate: SloBurnRateTemplateVariableDefinition): boolean => {
          return candidate.key === SloBurnRateTemplateVariable.PolicyTier;
        },
      );

    expect(SLO_POLICY_TIER_NONE_TEXT).toBe("None");
    expect(definition?.description).toContain(`"${SLO_POLICY_TIER_NONE_TEXT}"`);
  });

  test("fill in from the tier the SLO is in", () => {
    const variables: SloBurnRateTemplateVariables =
      buildSloBurnRateTemplateVariables(burnRateContext());

    expect(variables[SloBurnRateTemplateVariable.PolicyTier]).toBe(
      "Reliability first",
    );
    expect(
      variables[SloBurnRateTemplateVariable.PolicyTierThresholdPercentage],
    ).toBe("25");
    expect(variables[SloBurnRateTemplateVariable.PolicyTierWhatWeDo]).toBe(
      RELIABILITY_FIRST.whatWeDo,
    );
  });

  test("with no tier: None, and the other two empty", () => {
    for (const policyTier of [null, undefined]) {
      const variables: SloBurnRateTemplateVariables =
        buildSloBurnRateTemplateVariables(
          burnRateContext({ policyTier: policyTier }),
        );

      expect(variables[SloBurnRateTemplateVariable.PolicyTier]).toBe("None");
      expect(
        variables[SloBurnRateTemplateVariable.PolicyTierThresholdPercentage],
      ).toBe("");
      expect(variables[SloBurnRateTemplateVariable.PolicyTierWhatWeDo]).toBe(
        "",
      );
    }
  });

  test("a tier with a blank name reads as None; a decimal or string threshold reads as a number", () => {
    const variables: SloBurnRateTemplateVariables =
      buildSloBurnRateTemplateVariables(
        burnRateContext({
          policyTier: {
            name: "  ",
            thresholdPercentage: "2.5",
            whatWeDo: null,
          },
        }),
      );

    expect(variables[SloBurnRateTemplateVariable.PolicyTier]).toBe("None");
    expect(
      variables[SloBurnRateTemplateVariable.PolicyTierThresholdPercentage],
    ).toBe("2.5");
    expect(variables[SloBurnRateTemplateVariable.PolicyTierWhatWeDo]).toBe("");
  });

  test("a value is inserted literally, never expanded again", () => {
    const rendered: string | null = renderSloBurnRateTemplate(
      "{{policyTier}}",
      buildSloBurnRateTemplateVariables(
        burnRateContext({
          policyTier: {
            name: "{{sloName}} $& $1",
            thresholdPercentage: 10,
            whatWeDo: "x",
          },
        }),
      ),
    );

    expect(rendered).toBe("{{sloName}} $& $1");
  });

  test("the default burn rate text is unchanged: an SLO without a policy reads exactly as before", () => {
    expect(DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE).not.toContain("policy");
    expect(DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE).not.toContain("policy");
  });
});

describe("a policy tier's catalog", () => {
  const tierKeys: Array<string> = keysOf(SLO_POLICY_TIER_TEMPLATE_VARIABLES);

  test("offers the SLO, its budget and the tier", () => {
    expect(tierKeys).toEqual(
      expect.arrayContaining([
        SloBurnRateTemplateVariable.SloName,
        SloBurnRateTemplateVariable.SloId,
        SloBurnRateTemplateVariable.SloLink,
        SloBurnRateTemplateVariable.SloStatus,
        SloBurnRateTemplateVariable.TargetPercentage,
        SloBurnRateTemplateVariable.CurrentSliPercentage,
        SloBurnRateTemplateVariable.ErrorBudgetRemainingPercentage,
        SloBurnRateTemplateVariable.ErrorBudgetRemaining,
        SloBurnRateTemplateVariable.ErrorBudgetRemainingMinutes,
        SloBurnRateTemplateVariable.WindowDescription,
        ...POLICY_TIER_KEYS,
      ]),
    );
  });

  test("leaves out the rule's own variables", () => {
    for (const key of RULE_KEYS) {
      expect(tierKeys).not.toContain(key);
    }
  });

  test("is every variable that is not the rule's, once, with the same words", () => {
    const expected: Array<string> = keysOf(
      SLO_BURN_RATE_TEMPLATE_VARIABLES,
    ).filter((key: string): boolean => {
      return !(RULE_KEYS as Array<string>).includes(key);
    });

    expect([...tierKeys].sort()).toEqual([...expected].sort());
    expect(new Set(tierKeys).size).toBe(tierKeys.length);

    for (const definition of SLO_POLICY_TIER_TEMPLATE_VARIABLES) {
      expect(definition).toBe(
        SLO_BURN_RATE_TEMPLATE_VARIABLES.find(
          (candidate: SloBurnRateTemplateVariableDefinition): boolean => {
            return candidate.key === definition.key;
          },
        ),
      );
    }
  });

  test("is what the tier form offers, as the rule form offers its own", () => {
    const toNames: (
      groups: typeof SLO_POLICY_TIER_TEMPLATE_VARIABLE_GROUPS,
    ) => Array<string> = (
      groups: typeof SLO_POLICY_TIER_TEMPLATE_VARIABLE_GROUPS,
    ): Array<string> => {
      return groups.flatMap((group: TemplateVariableGroup): Array<string> => {
        return group.variables.map((variable: TemplateVariable): string => {
          return variable.name;
        });
      });
    };

    expect(toNames(SLO_POLICY_TIER_TEMPLATE_VARIABLE_GROUPS)).toEqual(tierKeys);
    expect(toNames(SLO_BURN_RATE_TEMPLATE_VARIABLE_GROUPS)).toEqual(
      keysOf(SLO_BURN_RATE_TEMPLATE_VARIABLES),
    );
  });
});

describe("buildSloPolicyTierTemplateVariables", () => {
  const variables: SloBurnRateTemplateVariables =
    buildSloPolicyTierTemplateVariables(tierContext());

  test("fills in every variable of the tier's catalog", () => {
    for (const key of keysOf(SLO_POLICY_TIER_TEMPLATE_VARIABLES)) {
      expect(variables[key as SloBurnRateTemplateVariable]).not.toBe("");
    }
  });

  test("renders the rule's variables empty", () => {
    for (const key of RULE_KEYS) {
      expect(variables[key]).toBe("");
    }
  });

  test("reads the budget the way a rule's records do", () => {
    expect(
      variables[SloBurnRateTemplateVariable.ErrorBudgetRemainingPercentage],
    ).toBe("18.46");
    expect(variables[SloBurnRateTemplateVariable.ErrorBudgetRemaining]).toBe(
      "7m 58s",
    );
    expect(variables[SloBurnRateTemplateVariable.WindowDescription]).toBe(
      "rolling 30-day window",
    );
  });
});

describe("the default policy tier text", () => {
  const variables: SloBurnRateTemplateVariables =
    buildSloPolicyTierTemplateVariables(tierContext());

  test("names the SLO and the tier in the title", () => {
    expect(
      renderSloBurnRateTemplate(
        DEFAULT_SLO_POLICY_TIER_TITLE_TEMPLATE,
        variables,
      ),
    ).toBe(
      "SLO error budget policy: Checkout availability — Reliability first",
    );
  });

  test("says the budget, the tier's threshold and the agreement in the description", () => {
    const description: string | null = renderSloBurnRateTemplate(
      DEFAULT_SLO_POLICY_TIER_DESCRIPTION_TEMPLATE,
      variables,
    );

    expect(description).toBe(
      'SLO "Checkout availability" is in the "Reliability first" tier of its error budget policy: 18.46% of its error budget is left (7m 58s), at or below the tier\'s 25%.\n\n**What we do:** Only **reliability** work ships.\n\nNo new features.',
    );
  });

  test("leaves no variable unrendered", () => {
    for (const template of [
      DEFAULT_SLO_POLICY_TIER_TITLE_TEMPLATE,
      DEFAULT_SLO_POLICY_TIER_DESCRIPTION_TEMPLATE,
    ]) {
      expect(renderSloBurnRateTemplate(template, variables)).not.toMatch(
        /\{\{/,
      );
    }
  });

  test("uses only variables of the tier's catalog", () => {
    const tierKeys: Array<string> = keysOf(SLO_POLICY_TIER_TEMPLATE_VARIABLES);

    for (const template of [
      DEFAULT_SLO_POLICY_TIER_TITLE_TEMPLATE,
      DEFAULT_SLO_POLICY_TIER_DESCRIPTION_TEMPLATE,
    ]) {
      const referenced: Array<string> = Array.from(
        template.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1]!;
      });

      expect(referenced.length).toBeGreaterThan(0);

      for (const name of referenced) {
        expect(tierKeys).toContain(name);
      }
    }
  });
});

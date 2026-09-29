import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";
import {
  DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE,
  DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE,
  SLO_BURN_RATE_TEMPLATE_VARIABLES,
  SloBurnRateTemplateContext,
  SloBurnRateTemplateVariable,
  SloBurnRateTemplateVariableDefinition,
  SloBurnRateTemplateVariables,
  buildSloBurnRateTemplateVariables,
  isSloBurnRateTemplateVariable,
  renderSloBurnRateTemplate,
} from "../../../Utils/Slo/SloBurnRateTemplate";

/*
 * The burn rate template contract has three parties that must agree: the
 * catalog the dashboard documents, the variable map the worker renders with,
 * and the replacer. A variable the catalog lists but the map never fills in
 * renders as a literal `{{name}}` in someone's page at 3am, so the agreement
 * is pinned here rather than trusted.
 */

// A fast-burn fire on a 99.9% / 30-day SLO, with deliberately awkward decimals.
function makeContext(
  overrides: Partial<SloBurnRateTemplateContext> = {},
): SloBurnRateTemplateContext {
  return {
    sloId: "slo-1",
    sloName: "Checkout availability",
    sloLink: "https://oneuptime.com/dashboard/project-1/slos/slo-1",
    sloStatus: "At Risk",
    ruleName: "Fast burn",
    burnRateThreshold: 14.4,
    longWindowBurnRate: 21.456,
    shortWindowBurnRate: 36,
    longWindowInMinutes: 60,
    shortWindowInMinutes: 5,
    targetPercentage: 99.9,
    currentSliPercentage: 99.87321,
    errorBudgetRemainingPercentage: 42.5049,
    errorBudgetRemainingSeconds: 1102.2,
    windowType: SloWindowType.Rolling,
    windowDays: 30,
    timezone: undefined,
    ...overrides,
  };
}

function variablesFor(
  overrides: Partial<SloBurnRateTemplateContext> = {},
): SloBurnRateTemplateVariables {
  return buildSloBurnRateTemplateVariables(makeContext(overrides));
}

describe("SloBurnRateTemplate", () => {
  describe("the catalog, the enum and the variable map agree", () => {
    const catalogKeys: Array<string> = SLO_BURN_RATE_TEMPLATE_VARIABLES.map(
      (definition: SloBurnRateTemplateVariableDefinition): string => {
        return definition.key;
      },
    );

    it("documents every variable the worker fills in, and nothing else", () => {
      const mapKeys: Array<string> = Object.keys(variablesFor());

      expect([...catalogKeys].sort()).toEqual([...mapKeys].sort());
    });

    it("documents every enum member exactly once", () => {
      const enumValues: Array<string> = Object.values(
        SloBurnRateTemplateVariable,
      );

      expect(new Set(catalogKeys).size).toBe(catalogKeys.length);
      expect([...catalogKeys].sort()).toEqual([...enumValues].sort());
    });

    it("covers the variables the product promises", () => {
      // The names docs, help text and stored templates already rely on.
      for (const required of [
        "sloName",
        "sloId",
        "sloLink",
        "ruleName",
        "burnRateThreshold",
        "longWindowBurnRate",
        "shortWindowBurnRate",
        "longWindowInMinutes",
        "shortWindowInMinutes",
        "targetPercentage",
        "currentSliPercentage",
        "errorBudgetRemainingPercentage",
        "errorBudgetRemaining",
        "sloStatus",
        "windowDescription",
      ]) {
        expect(catalogKeys).toContain(required);
      }
    });

    it("gives every entry a description and an example a reader can use", () => {
      for (const definition of SLO_BURN_RATE_TEMPLATE_VARIABLES) {
        expect(definition.description.trim().length).toBeGreaterThan(0);
        expect(definition.example.trim().length).toBeGreaterThan(0);
        // An example that is itself a placeholder documents nothing.
        expect(definition.example).not.toContain("{{");
        // The help table is markdown; a pipe would split the row.
        expect(definition.description).not.toContain("|");
        expect(definition.example).not.toContain("|");
      }
    });

    it("the defaults reference only variables that exist", () => {
      const referenced: Array<string> = [
        ...`${DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE}${DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE}`.matchAll(
          /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g,
        ),
      ].map((match: RegExpMatchArray): string => {
        return match[1]!;
      });

      expect(referenced.length).toBeGreaterThan(0);

      for (const name of referenced) {
        expect(isSloBurnRateTemplateVariable(name)).toBe(true);
      }
    });
  });

  describe("buildSloBurnRateTemplateVariables", () => {
    it("carries the identity of the SLO and the rule verbatim", () => {
      const variables: SloBurnRateTemplateVariables = variablesFor();

      expect(variables.sloName).toBe("Checkout availability");
      expect(variables.sloId).toBe("slo-1");
      expect(variables.sloLink).toBe(
        "https://oneuptime.com/dashboard/project-1/slos/slo-1",
      );
      expect(variables.sloStatus).toBe("At Risk");
      expect(variables.ruleName).toBe("Fast burn");
    });

    it("rounds every measurement to two decimals, the precision alerts always used", () => {
      const variables: SloBurnRateTemplateVariables = variablesFor();

      expect(variables.longWindowBurnRate).toBe("21.46");
      expect(variables.currentSliPercentage).toBe("99.87");
      expect(variables.errorBudgetRemainingPercentage).toBe("42.5");
      expect(variables.targetPercentage).toBe("99.9");
      expect(variables.burnRateThreshold).toBe("14.4");
    });

    it("renders whole numbers without a trailing .00", () => {
      const variables: SloBurnRateTemplateVariables = variablesFor();

      expect(variables.shortWindowBurnRate).toBe("36");
      expect(variables.longWindowInMinutes).toBe("60");
      expect(variables.shortWindowInMinutes).toBe("5");
    });

    it("renders the remaining budget both as minutes and as a spoken duration", () => {
      const variables: SloBurnRateTemplateVariables = variablesFor();

      // 1102.2 seconds.
      expect(variables.errorBudgetRemainingMinutes).toBe("18.37");
      expect(variables.errorBudgetRemaining).toBe("18m 22s");
    });

    it("keeps the sign of an overspent budget, because the overage is the point", () => {
      /*
       * -12.346 rather than a half: Math.round takes a half towards +infinity
       * (-12.345 becomes -12.34), exactly as the pre-template description
       * rounded, and this case is about the sign, not that edge.
       */
      const variables: SloBurnRateTemplateVariables = variablesFor({
        errorBudgetRemainingPercentage: -12.346,
        errorBudgetRemainingSeconds: -330,
      });

      expect(variables.errorBudgetRemainingPercentage).toBe("-12.35");
      expect(variables.errorBudgetRemaining).toBe("-5m 30s");
      expect(variables.errorBudgetRemainingMinutes).toBe("-5.5");
    });

    it("does not claim an overspend a sub-second remainder cannot show", () => {
      expect(
        variablesFor({ errorBudgetRemainingSeconds: -0.4 })
          .errorBudgetRemaining,
      ).toBe("0s");
    });

    it("renders a measurement that is not a real number as empty, never NaN", () => {
      const variables: SloBurnRateTemplateVariables = variablesFor({
        longWindowBurnRate: Number.NaN,
        shortWindowBurnRate: Number.POSITIVE_INFINITY,
        errorBudgetRemainingSeconds: Number.NaN,
      });

      expect(variables.longWindowBurnRate).toBe("");
      expect(variables.shortWindowBurnRate).toBe("");
      expect(variables.errorBudgetRemaining).toBe("");
      expect(variables.errorBudgetRemainingMinutes).toBe("");
    });

    it("renders missing names as empty rather than the word undefined", () => {
      const variables: SloBurnRateTemplateVariables = variablesFor({
        sloName: undefined,
        ruleName: undefined,
        sloLink: undefined,
        sloStatus: undefined,
      });

      expect(variables.sloName).toBe("");
      expect(variables.ruleName).toBe("");
      expect(variables.sloLink).toBe("");
      expect(variables.sloStatus).toBe("");
    });

    it("describes a rolling window by its length", () => {
      expect(variablesFor({ windowDays: 7 }).windowDescription).toBe(
        "rolling 7-day window",
      );
    });

    it("falls back to the worker's 30-day default when a rolling window has no length", () => {
      expect(variablesFor({ windowDays: undefined }).windowDescription).toBe(
        "rolling 30-day window",
      );
      expect(variablesFor({ windowDays: 0 }).windowDescription).toBe(
        "rolling 30-day window",
      );
    });

    it("describes a calendar month with its timezone, UTC when none is set", () => {
      expect(
        variablesFor({
          windowType: SloWindowType.CalendarMonth,
          timezone: "Europe/Berlin",
        }).windowDescription,
      ).toBe("calendar month (Europe/Berlin)");

      expect(
        variablesFor({
          windowType: SloWindowType.CalendarMonth,
          timezone: undefined,
        }).windowDescription,
      ).toBe("calendar month (UTC)");
    });
  });

  describe("renderSloBurnRateTemplate", () => {
    it.each([null, undefined, "", "   ", "\n\t "])(
      "returns null for the blank template %p so the caller falls back to the default",
      (template: string | null | undefined) => {
        expect(renderSloBurnRateTemplate(template, variablesFor())).toBeNull();
      },
    );

    it("replaces every known variable, every time it appears", () => {
      expect(
        renderSloBurnRateTemplate(
          "{{ruleName}} on {{sloName}}: {{longWindowBurnRate}}x, again {{ruleName}}",
          variablesFor(),
        ),
      ).toBe("Fast burn on Checkout availability: 21.46x, again Fast burn");
    });

    it("tolerates spaces inside the braces, the way people type them", () => {
      expect(
        renderSloBurnRateTemplate(
          "[{{ sloName }}] {{  ruleName}}",
          variablesFor(),
        ),
      ).toBe("[Checkout availability] Fast burn");
    });

    it("leaves an unknown variable exactly as written, so a typo is visible", () => {
      expect(
        renderSloBurnRateTemplate(
          "{{sloNmae}} burned {{ burnRate }}",
          variablesFor(),
        ),
      ).toBe("{{sloNmae}} burned {{ burnRate }}");
    });

    it("never reaches Object.prototype through a variable name", () => {
      expect(
        renderSloBurnRateTemplate(
          "{{constructor}} {{toString}} {{__proto__}} {{hasOwnProperty}}",
          variablesFor(),
        ),
      ).toBe("{{constructor}} {{toString}} {{__proto__}} {{hasOwnProperty}}");
    });

    it("inserts a value that looks like a template literally, never expanding it twice", () => {
      // An SLO really can be named this; the rule name must not leak into it.
      const variables: SloBurnRateTemplateVariables = variablesFor({
        sloName: "{{ruleName}}",
      });

      expect(renderSloBurnRateTemplate("{{sloName}}", variables)).toBe(
        "{{ruleName}}",
      );
    });

    it("takes dollar patterns inside a value literally", () => {
      expect(
        renderSloBurnRateTemplate(
          "SLO {{sloName}}",
          variablesFor({ sloName: "Pay $& $1 $` $' $$" }),
        ),
      ).toBe("SLO Pay $& $1 $` $' $$");
    });

    it("leaves Handlebars-looking blocks and stray braces alone", () => {
      expect(
        renderSloBurnRateTemplate(
          "{{#each x}}{{/each}} { {sloName} } {{sloName",
          variablesFor(),
        ),
      ).toBe("{{#each x}}{{/each}} { {sloName} } {{sloName");
    });

    it("keeps the rest of a markdown template intact, newlines included", () => {
      expect(
        renderSloBurnRateTemplate(
          "## {{sloName}}\n\n- Rule: **{{ruleName}}**\n- Link: [open]({{sloLink}})\n",
          variablesFor(),
        ),
      ).toBe(
        "## Checkout availability\n\n- Rule: **Fast burn**\n- Link: [open](https://oneuptime.com/dashboard/project-1/slos/slo-1)\n",
      );
    });

    it("a template of only an unknown variable is not blank, so it does not fall back", () => {
      expect(renderSloBurnRateTemplate("{{nope}}", variablesFor())).toBe(
        "{{nope}}",
      );
    });

    it("substitutes an empty value as empty text", () => {
      expect(
        renderSloBurnRateTemplate(
          "[{{sloLink}}]",
          variablesFor({ sloLink: undefined }),
        ),
      ).toBe("[]");
    });
  });

  describe("the default templates reproduce the text burn rate alerts always carried", () => {
    /*
     * The pre-template worker built these two strings inline. Copied here
     * verbatim as the reference: if the defaults drift from them, every
     * existing and seeded rule starts raising differently-worded alerts on
     * upgrade, and anything matching on the old title breaks.
     */
    function legacyTitle(data: { sloName: string; ruleName: string }): string {
      return `SLO burn rate: ${data.sloName} — ${data.ruleName}`;
    }

    function roundToTwoDecimals(value: number): number {
      return Math.round(value * 100) / 100;
    }

    function legacyDescription(data: {
      sloName: string;
      ruleName: string;
      longWindowInMinutes: number;
      shortWindowInMinutes: number;
      burnRateLong: number;
      burnRateShort: number;
      burnRateThreshold: number;
      budgetRemainingPercentage: number;
      budgetRemainingSeconds: number;
    }): string {
      const budgetRemainingMinutes: number = roundToTwoDecimals(
        data.budgetRemainingSeconds / 60,
      );

      return `SLO "${data.sloName}" is burning its error budget too fast. Rule "${data.ruleName}": burn rate over the last ${data.longWindowInMinutes} minutes is ${roundToTwoDecimals(data.burnRateLong)}x and over the last ${data.shortWindowInMinutes} minutes is ${roundToTwoDecimals(data.burnRateShort)}x — both at or above the threshold of ${roundToTwoDecimals(data.burnRateThreshold)}x. Error budget remaining: ${roundToTwoDecimals(data.budgetRemainingPercentage)}% (${budgetRemainingMinutes} minutes).`;
    }

    const cases: Array<{
      label: string;
      context: SloBurnRateTemplateContext;
    }> = [
      { label: "a fast burn with awkward decimals", context: makeContext() },
      {
        label: "an overspent budget",
        context: makeContext({
          ruleName: "Slow burn",
          longWindowInMinutes: 360,
          shortWindowInMinutes: 30,
          burnRateThreshold: 6,
          longWindowBurnRate: 6.004,
          shortWindowBurnRate: 100,
          errorBudgetRemainingPercentage: -3.456,
          errorBudgetRemainingSeconds: -89.6,
        }),
      },
      {
        label: "names carrying markdown, quotes and template braces",
        context: makeContext({
          sloName: 'API "v2" [prod] {{ruleName}}',
          ruleName: "Fast *burn* $&",
        }),
      },
    ];

    it.each(cases)(
      "for $label",
      ({ context }: { context: SloBurnRateTemplateContext }) => {
        const variables: SloBurnRateTemplateVariables =
          buildSloBurnRateTemplateVariables(context);

        expect(
          renderSloBurnRateTemplate(
            DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE,
            variables,
          ),
        ).toBe(
          legacyTitle({
            sloName: context.sloName!,
            ruleName: context.ruleName!,
          }),
        );

        expect(
          renderSloBurnRateTemplate(
            DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE,
            variables,
          ),
        ).toBe(
          legacyDescription({
            sloName: context.sloName!,
            ruleName: context.ruleName!,
            longWindowInMinutes: context.longWindowInMinutes,
            shortWindowInMinutes: context.shortWindowInMinutes,
            burnRateLong: context.longWindowBurnRate,
            burnRateShort: context.shortWindowBurnRate,
            burnRateThreshold: context.burnRateThreshold,
            budgetRemainingPercentage: context.errorBudgetRemainingPercentage,
            budgetRemainingSeconds: context.errorBudgetRemainingSeconds,
          }),
        );
      },
    );
  });

  describe("isSloBurnRateTemplateVariable", () => {
    it("accepts every catalog key and rejects anything else", () => {
      for (const definition of SLO_BURN_RATE_TEMPLATE_VARIABLES) {
        expect(isSloBurnRateTemplateVariable(definition.key)).toBe(true);
      }

      for (const name of [
        "",
        "SloName",
        "monitorName",
        "__proto__",
        "constructor",
      ]) {
        expect(isSloBurnRateTemplateVariable(name)).toBe(false);
      }
    });
  });
});

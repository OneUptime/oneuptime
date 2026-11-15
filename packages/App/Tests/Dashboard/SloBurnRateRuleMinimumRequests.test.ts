import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ServiceLevelObjectiveBurnRateRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import {
  Translator,
  createTranslator,
} from "Common/UI/Utils/TranslateTemplate";
import { DASHBOARD_LANGUAGES } from "Common/Tests/Helpers/TranslatedLanguages";
import {
  BURN_RATE_RULE_FORM_FIELDS,
  BURN_RATE_RULE_MINIMUM_EVENTS_ERROR,
  BURN_RATE_RULE_MINIMUM_EVENTS_FIELD,
  BURN_RATE_RULE_MINIMUM_REQUESTS_ERROR,
  BURN_RATE_RULE_MINIMUM_REQUESTS_FIELD,
  getBurnRateRuleFormFields,
  validateMinimumEvents,
  validateMinimumRequests,
} from "../../FeatureSet/Dashboard/src/Pages/Slo/Utils/BurnRateRuleForm";
import { formatBurnRateRuleMinimumRequests } from "../../FeatureSet/Dashboard/src/Pages/Slo/Utils/BurnRateRuleLines";

/*
 * MINIMUM REQUESTS (#8442): a request SLO's burn rate rule can skip a long
 * window that holds fewer requests than this, so a quiet hour with one
 * failed request out of five - a burn rate of hundreds - pages nobody. The
 * worker honours it for request SLOs only (EvaluateSlos,
 * hasEnoughSamplesForRule), so only a request SLO's rule form asks for it,
 * and the rules table says a rule's minimum under its windows.
 */

type RuleField = ModelField<ServiceLevelObjectiveBurnRateRule>;
type RuleValues = FormValues<ServiceLevelObjectiveBurnRateRule>;

const DASHBOARD: string = path.resolve(__dirname, "../../FeatureSet/Dashboard");

const ENGLISH: Translator = createTranslator(undefined);

function columnOf(field: RuleField): string {
  return Object.keys(field.field || field.overrideField || {})[0] || "";
}

function valuesOf(minimumSampleCount: unknown): RuleValues {
  return { minimumSampleCount: minimumSampleCount } as unknown as RuleValues;
}

function readLocale(code: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD, "src/Locales", `${code}.json`),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

function shippedTranslatorFor(code: string): Translator {
  const locale: Record<string, unknown> = readLocale(code);

  return createTranslator((text: string): string | undefined => {
    const value: unknown = locale[text];

    return typeof value === "string" && value !== text ? value : undefined;
  }, code);
}

describe("the burn rate rule form, by what the SLO measures", () => {
  test("a monitor uptime SLO's rule never asks for a minimum it would ignore", () => {
    const fields: Array<RuleField> = getBurnRateRuleFormFields({
      isRequestSlo: false,
    });

    expect(fields).toBe(BURN_RATE_RULE_FORM_FIELDS);
    expect(fields.map(columnOf)).not.toContain("minimumSampleCount");
  });

  test("a request SLO's rule asks for Minimum Requests on Burn Window, just before Re-fire Suppression", () => {
    const fields: Array<RuleField> = getBurnRateRuleFormFields({
      isRequestSlo: true,
    });
    const columns: Array<string> = fields.map(columnOf);
    const index: number = columns.indexOf("minimumSampleCount");

    expect(index).toBeGreaterThan(-1);
    expect(columns[index + 1]).toBe("refireSuppressionMinutes");
    expect(columns[index - 1]).toBe("shortWindowInMinutes");
    expect(fields[index]).toBe(BURN_RATE_RULE_MINIMUM_REQUESTS_FIELD);

    // Every other field is the same field, in the same order.
    expect(
      columns.filter((column: string): boolean => {
        return column !== "minimumSampleCount";
      }),
    ).toEqual(BURN_RATE_RULE_FORM_FIELDS.map(columnOf));
  });

  test("leaves the shared list as it was", () => {
    getBurnRateRuleFormFields({ isRequestSlo: true });

    expect(BURN_RATE_RULE_FORM_FIELDS.map(columnOf)).not.toContain(
      "minimumSampleCount",
    );
  });

  test("Burn Window keeps to five fields for a request SLO", () => {
    expect(
      getBurnRateRuleFormFields({ isRequestSlo: true }).filter(
        (field: RuleField): boolean => {
          return field.stepId === "burn-window";
        },
      ),
    ).toHaveLength(5);
  });

  test("Minimum Requests is an optional whole count, with an example", () => {
    const field: RuleField = BURN_RATE_RULE_MINIMUM_REQUESTS_FIELD;

    expect(field.title).toBe("Minimum Requests");
    expect(field.fieldType).toBe(FormFieldSchemaType.Number);
    expect(field.required).toBe(false);
    expect(field.placeholder).toBe("100");
    expect(field.stepId).toBe("burn-window");
    expect(field.description).toBe(
      "Skip the rule while its long window holds fewer requests than this, so a quiet hour with one failure does not page anyone. Leave empty for no minimum.",
    );
  });
});

describe("validateMinimumRequests", () => {
  test.each([undefined, null, "", 0, 1, 100, "250", 1000000])(
    "accepts %p",
    (value: unknown) => {
      expect(validateMinimumRequests(valuesOf(value))).toBeNull();
    },
  );

  test.each([-1, 2.5, "many", "1e2.5", Number.NaN])(
    "refuses %p, saying what a minimum is",
    (value: unknown) => {
      expect(validateMinimumRequests(valuesOf(value))).toBe(
        BURN_RATE_RULE_MINIMUM_REQUESTS_ERROR,
      );
    },
  );

  test("says so in a sentence", () => {
    expect(BURN_RATE_RULE_MINIMUM_REQUESTS_ERROR).toBe(
      "Minimum Requests must be a whole number of requests, 0 or more.",
    );
  });
});

describe("the rules table's line for a rule's minimum", () => {
  test.each([
    [100, "At least 100 requests"],
    [1, "At least 1 request"],
    ["250", "At least 250 requests"],
    [1200, "At least 1,200 requests"],
  ])("%p reads %s", (value: number | string, expected: string) => {
    expect(formatBurnRateRuleMinimumRequests(value, ENGLISH)).toBe(expected);
  });

  test.each([undefined, null, "", 0, -5, "many"])(
    "no minimum (%p) has no line",
    (value: unknown) => {
      expect(
        formatBurnRateRuleMinimumRequests(value as number, ENGLISH),
      ).toBeNull();
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s words the line and counts the requests its own way",
    (code: string) => {
      const translator: Translator = shippedTranslatorFor(code);
      const count: string = translator.formatNumber(1200);
      const line: string = formatBurnRateRuleMinimumRequests(
        1200,
        translator,
      ) as string;

      // The language's own digits alone are not a translation.
      expect(line).not.toBe(`At least ${count} requests`);
      expect(line).toContain(count);
      expect(line).not.toContain("{{");
    },
  );
});

describe("the Burn Rate Rules page", () => {
  const page: string = fs.readFileSync(
    path.join(DASHBOARD, "src/Pages/Slo/View/BurnRateRules.tsx"),
    "utf8",
  );

  test("builds the form for what the SLO measures", () => {
    expect(page).toMatch(
      /formFields=\{getBurnRateRuleFormFields\(\{\s*isRequestSlo: isRequestSlo,\s*isMetricSlo: isMetricSlo,\s*\}\)\}/,
    );
    expect(page).toContain("setIsRequestSlo(isRequestSliType(slo.sliType));");
  });

  test("reads each rule's minimum for the table's line", () => {
    expect(page).toContain("minimumSampleCount: true,");
    expect(page).toContain("formatBurnRateRuleMinimumRequests(");
  });
});

/*
 * MINIMUM EVENTS (#8445): a Metric SLO's quiet hour burns its budget as a
 * request SLO's does, and the worker honours the same minimum for it, so
 * its rule asks for one too - counted in its metric's events.
 */
describe("a Metric SLO's rule: Minimum Events", () => {
  test("is asked where a request SLO's Minimum Requests is", () => {
    const fields: Array<RuleField> = getBurnRateRuleFormFields({
      isRequestSlo: false,
      isMetricSlo: true,
    });
    const columns: Array<string> = fields.map(columnOf);
    const index: number = columns.indexOf("minimumSampleCount");

    expect(fields[index]).toBe(BURN_RATE_RULE_MINIMUM_EVENTS_FIELD);
    expect(columns[index + 1]).toBe("refireSuppressionMinutes");
    expect(
      fields.filter((field: RuleField): boolean => {
        return field === BURN_RATE_RULE_MINIMUM_REQUESTS_FIELD;
      }),
    ).toHaveLength(0);
  });

  test("is the same column and step, in its metric's words", () => {
    expect(BURN_RATE_RULE_MINIMUM_EVENTS_FIELD).toMatchObject({
      field: { minimumSampleCount: true },
      title: "Minimum Events",
      fieldType: FormFieldSchemaType.Number,
      required: false,
      placeholder: "100",
      stepId: "burn-window",
    });
    expect(BURN_RATE_RULE_MINIMUM_EVENTS_FIELD.description).toBe(
      "Skip this rule while its long window holds fewer of its metric's events than this, so a quiet hour with one bad event does not page anyone. Leave empty for no minimum.",
    );
  });

  test.each([undefined, null, "", 0, 100, "250"])(
    "accepts %p",
    (value: unknown) => {
      expect(validateMinimumEvents(valuesOf(value))).toBeNull();
    },
  );

  test.each([-1, 2.5, "many"])("refuses %p, in events", (value: unknown) => {
    expect(validateMinimumEvents(valuesOf(value))).toBe(
      BURN_RATE_RULE_MINIMUM_EVENTS_ERROR,
    );
  });

  test("says so in a sentence", () => {
    expect(BURN_RATE_RULE_MINIMUM_EVENTS_ERROR).toBe(
      "Minimum Events must be a whole number of events, 0 or more.",
    );
  });

  test.each([
    [1, "At least 1 event"],
    [1200, "At least 1,200 events"],
  ])("the table says %p as %s", (value: number, expected: string) => {
    expect(formatBurnRateRuleMinimumRequests(value, ENGLISH, true)).toBe(
      expected,
    );
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words the line in events, and counts them its own way",
    (code: string) => {
      const translator: Translator = shippedTranslatorFor(code);
      const count: string = translator.formatNumber(1200);
      const line: string = formatBurnRateRuleMinimumRequests(
        1200,
        translator,
        true,
      ) as string;

      expect(line).not.toBe(`At least ${count} events`);
      expect(line).not.toBe(
        formatBurnRateRuleMinimumRequests(1200, translator),
      );
      expect(line).toContain(count);
    },
  );

  test("the page asks a Metric SLO's rule in its own words", () => {
    const page: string = fs.readFileSync(
      path.join(DASHBOARD, "src/Pages/Slo/View/BurnRateRules.tsx"),
      "utf8",
    );

    expect(page).toContain("setIsMetricSlo(slo.sliType === SliType.Metric);");
    expect(page).toContain("isRequestSlo || isMetricSlo");
  });
});

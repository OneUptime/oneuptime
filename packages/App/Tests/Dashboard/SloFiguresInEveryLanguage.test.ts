import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  Translator,
  createTranslator,
} from "Common/UI/Utils/TranslateTemplate";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import { formatDurationCompactInLanguage } from "Common/Utils/Slo/SloDuration";
import {
  formatSloBurnRate,
  formatSloNumber,
  formatSloPercent,
} from "Common/Utils/Slo/SloWidgetFormat";
import { DASHBOARD_LANGUAGES } from "Common/Tests/Helpers/TranslatedLanguages";
import {
  BURN_RATE_RULE_FIRES_WHEN_TEMPLATE,
  BURN_RATE_RULE_SUPPRESSION_TEMPLATE,
  BURN_RATE_RULE_WINDOWS_TEMPLATE,
  formatBurnRateRuleFiresWhen,
  formatBurnRateRuleWindows,
} from "../../FeatureSet/Dashboard/src/Pages/Slo/Utils/BurnRateRuleLines";
import {
  SLO_ADVANCED_DEFAULTS_SUMMARY,
  SLO_FORM_ERRORS,
  SLO_TARGET_HELP_TEMPLATE,
  getSloTargetHelpText,
} from "../../FeatureSet/Dashboard/src/Pages/Slo/SloFormFields";
import {
  SLO_CALENDAR_MONTH_ERROR_BUDGET_TEMPLATE,
  describeSloErrorBudget,
  describeSloWindow,
} from "../../FeatureSet/Dashboard/src/Pages/Slo/SloSettingsFormFields";

/*
 * AN SLO'S RULE AND OBJECTIVE FIGURES IN EVERY DASHBOARD LANGUAGE (#6924,
 * #6925), from the shipped locale files: a burn rate rule's windows, its
 * suppression and what it fires on; the create form's help under Target
 * (%) and its checks; the Settings page's Error Budget and Window lines;
 * and the Overview's "1× spends the budget" note. Each is worded by every
 * language and writes every figure the way that language writes the
 * Dashboard's other figures (formatSloNumber, formatSloPercent,
 * formatDurationCompactInLanguage) - while English reads each word for
 * word as it always has.
 */

const DASHBOARD: string = path.resolve(__dirname, "../../FeatureSet/Dashboard");

const LANGUAGES: ReadonlyArray<string> = [...DASHBOARD_LANGUAGES];

// The languages whose Dashboard writes its own digits, not Latin ones.
const OWN_DIGIT_LANGUAGES: ReadonlyArray<string> = ["fa"];

const LATIN_DIGIT: RegExp = /[0-9]/;

const PLACEHOLDER: RegExp = /\{\{(\w+)\}\}/g;

const KPI_NOTE_KEY: string =
  "Over the last {{window}} · {{rate}} spends the budget exactly over the window";

// Every sentence this change looks up, which every language words.
const NEW_KEYS: ReadonlyArray<string> = [
  KPI_NOTE_KEY,
  SLO_TARGET_HELP_TEMPLATE,
  SLO_FORM_ERRORS.target,
  SLO_FORM_ERRORS.atRiskThresholdRange,
  SLO_FORM_ERRORS.atRiskThresholdWhole,
  SLO_FORM_ERRORS.windowDaysRange,
  SLO_FORM_ERRORS.windowDaysWhole,
  SLO_CALENDAR_MONTH_ERROR_BUDGET_TEMPLATE,
];

// The sentences the figures go into, which every language worded before.
const FIGURE_KEYS: ReadonlyArray<string> = [
  BURN_RATE_RULE_WINDOWS_TEMPLATE,
  BURN_RATE_RULE_SUPPRESSION_TEMPLATE,
  BURN_RATE_RULE_FIRES_WHEN_TEMPLATE,
  SLO_ADVANCED_DEFAULTS_SUMMARY,
  "{{budget}} of downtime per {{count}}-day window",
  "Rolling {{count}}-day window",
];

/*
 * The sentences whose share brings its own sign ("2%", "2 %", "۲٪"): a
 * sign the sentence wrote beside it would read twice, and on an Arabic or
 * Persian page it was drawn on the figure's left.
 */
const SHARE_KEYS: ReadonlyArray<string> = [
  BURN_RATE_RULE_FIRES_WHEN_TEMPLATE,
  SLO_ADVANCED_DEFAULTS_SUMMARY,
];

// A percent sign of any script just before or after a placeholder.
const SIGN_BESIDE_PLACEHOLDER: RegExp =
  /\{\{\w+\}\}\s?[%\u066a\ufe6a\uff05]|[%\u066a\ufe6a\uff05]\s?\{\{\w+\}\}/;

// The create form's figures and the rule's share, each set apart from their words.
const FIGURES_SET_APART: { setsValuesApart: boolean } = {
  setsValuesApart: true,
};

function readLocale(code: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD, "src/Locales", `${code}.json`),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

function readSource(file: string): string {
  return fs.readFileSync(path.join(DASHBOARD, "src", file), "utf8");
}

// A language as the Dashboard ships it.
function shippedTranslatorFor(code: string): Translator {
  const locale: Record<string, unknown> = readLocale(code);

  return createTranslator((text: string): string | undefined => {
    const value: unknown = locale[text];

    return typeof value === "string" && value !== text ? value : undefined;
  }, code);
}

function placeholders(text: string): Array<string> {
  return Array.from(text.matchAll(PLACEHOLDER))
    .map((match: RegExpMatchArray): string => {
      return match[1] as string;
    })
    .sort();
}

const SLOW_LEAK: {
  budgetPercentage: number;
  longWindowInMinutes: number;
  shortWindowInMinutes: number;
  refireSuppressionMinutes: number;
} = {
  budgetPercentage: 10,
  longWindowInMinutes: 4320,
  shortWindowInMinutes: 360,
  refireSuppressionMinutes: 1440,
};

const ENGLISH: Translator = shippedTranslatorFor("en");

describe("English reads every line word for word as before", () => {
  test("a rule's windows, suppression and what it fires on", () => {
    expect(formatBurnRateRuleWindows(SLOW_LEAK, ENGLISH)).toEqual({
      windows: "4320m / 360m",
      suppression: "Suppress 1440m after resolve",
    });
    expect(formatBurnRateRuleFiresWhen(SLOW_LEAK, ENGLISH)).toBe(
      "Fires when about 10% of the error budget burns in 3d",
    );
    expect(
      formatBurnRateRuleFiresWhen(
        { budgetPercentage: 2, longWindowInMinutes: 60 },
        ENGLISH,
      ),
    ).toBe("Fires when about 2% of the error budget burns in 1h");
  });

  test("a rule with no suppression waits its long window; one with no windows reads 0", () => {
    expect(
      formatBurnRateRuleWindows(
        { longWindowInMinutes: 60, shortWindowInMinutes: 5 },
        ENGLISH,
      ),
    ).toEqual({
      windows: "60m / 5m",
      suppression: "Suppress 60m after resolve",
    });
    expect(
      formatBurnRateRuleWindows(
        {
          longWindowInMinutes: 60,
          shortWindowInMinutes: 5,
          refireSuppressionMinutes: 0,
        },
        ENGLISH,
      ).suppression,
    ).toBe("Suppress 0m after resolve");
    expect(formatBurnRateRuleWindows({}, ENGLISH)).toEqual({
      windows: "0m / 0m",
      suppression: "Suppress 0m after resolve",
    });
    expect(
      formatBurnRateRuleWindows(
        {
          longWindowInMinutes: null,
          shortWindowInMinutes: Number.NaN,
          refireSuppressionMinutes: null,
        },
        ENGLISH,
      ),
    ).toEqual({ windows: "0m / 0m", suppression: "Suppress 0m after resolve" });
  });

  test("the create form's help and the Settings lines", () => {
    expect(getSloTargetHelpText(ENGLISH)).toBe(
      "The share of time its monitors must be up. Over 30 days, 99.9% allows 43 minutes of downtime and 99.99% about 4.",
    );
    expect(
      describeSloErrorBudget(
        { targetPercentage: 99.9, windowDays: 30 },
        ENGLISH,
      ),
    ).toBe("43m 12s of downtime per 30-day window");
    expect(
      describeSloErrorBudget(
        { targetPercentage: 99.9, windowType: SloWindowType.CalendarMonth },
        ENGLISH,
      ),
    ).toBe("0.1% of each month: 43m 12s of downtime in a 30-day month");
    expect(
      describeSloWindow(
        { windowType: SloWindowType.CalendarMonth, timezone: "Asia/Tehran" },
        ENGLISH,
      ),
    ).toBe("Calendar month (Asia/Tehran)");
    expect(describeSloWindow({ windowDays: 1 }, ENGLISH)).toBe(
      "Rolling 1-day window",
    );
  });

  test("the KPI note's 1×, from the burn rate formatter", () => {
    expect(
      ENGLISH.translateTemplate(KPI_NOTE_KEY, {
        window: "1h",
        rate: formatSloBurnRate(1, ENGLISH) as string,
      }),
    ).toBe("Over the last 1h · 1× spends the budget exactly over the window");
  });
});

describe.each(LANGUAGES)("%s", (code: string) => {
  const locale: Record<string, unknown> = readLocale(code);
  const translator: Translator = shippedTranslatorFor(code);

  // A figure as this language writes it.
  function figure(value: number, maxDecimals: number = 0): string {
    return formatSloNumber(value, maxDecimals, translator) as string;
  }

  function expectOwnDigits(text: string): void {
    if (OWN_DIGIT_LANGUAGES.includes(code)) {
      expect({ code, text, latinDigit: LATIN_DIGIT.test(text) }).toEqual({
        code,
        text,
        latinDigit: false,
      });
    }
  }

  test("words every sentence this change looks up, with the English placeholders", () => {
    for (const key of [...NEW_KEYS, ...FIGURE_KEYS]) {
      const text: unknown = locale[key];

      expect({
        code,
        key,
        worded: typeof text === "string" && text !== key,
      }).toEqual({
        code,
        key,
        worded: true,
      });
      expect({ code, key, placeholders: placeholders(text as string) }).toEqual(
        {
          code,
          key,
          placeholders: placeholders(key),
        },
      );
    }
  });

  test("writes a rule's windows and suppression with its own figures", () => {
    const text: { windows: string; suppression: string } =
      formatBurnRateRuleWindows(SLOW_LEAK, translator);

    expect(text.windows).toBe(
      translator.translateTemplate(BURN_RATE_RULE_WINDOWS_TEMPLATE, {
        long: figure(4320),
        short: figure(360),
      }),
    );
    expect(text.windows).toContain(figure(4320));
    expect(text.windows).not.toBe("4320m / 360m");
    expect(text.suppression).toContain(figure(1440));
    expect(text.suppression).not.toBe("Suppress 1440m after resolve");
    expectOwnDigits(`${text.windows} ${text.suppression}`);
  });

  test("says what a rule fires on with its own share and duration", () => {
    const text: string = formatBurnRateRuleFiresWhen(SLOW_LEAK, translator);

    expect(text).toBe(
      translator.translateTemplate(
        BURN_RATE_RULE_FIRES_WHEN_TEMPLATE,
        {
          percent: formatSloPercent(10, 2, translator) as string,
          duration: formatDurationCompactInLanguage(4320 * 60, code),
        },
        FIGURES_SET_APART,
      ),
    );
    expect(text).toContain(formatSloPercent(10, 2, translator) as string);
    expect(text).toContain(formatDurationCompactInLanguage(4320 * 60, code));
    expect(text).not.toContain("3d");
    expectOwnDigits(text);
  });

  test("writes no percent sign beside a share that brings its own", () => {
    for (const key of SHARE_KEYS) {
      const text: string = locale[key] as string;

      expect({
        code,
        key,
        signBesidePlaceholder: SIGN_BESIDE_PLACEHOLDER.test(text),
      }).toEqual({ code, key, signBesidePlaceholder: false });
    }
  });

  test("helps with the target in its own words and figures", () => {
    const help: string = getSloTargetHelpText(translator);

    expect(help).toBe(
      translator.translateTemplate(
        SLO_TARGET_HELP_TEMPLATE,
        {
          days: figure(30),
          target: formatSloPercent(99.9, 3, translator) as string,
          minutes: figure(43),
          stricterTarget: formatSloPercent(99.99, 3, translator) as string,
          stricterMinutes: figure(4),
        },
        FIGURES_SET_APART,
      ),
    );
    expect(help).not.toBe(getSloTargetHelpText(ENGLISH));
    expectOwnDigits(help);
  });

  test("writes the Settings page's Error Budget and Window lines with its own budget, share and days", () => {
    const budget: string = formatDurationCompactInLanguage(2592, code);
    const rolling: string = describeSloErrorBudget(
      { targetPercentage: 99.9, windowDays: 30 },
      translator,
    ) as string;
    const month: string = describeSloErrorBudget(
      { targetPercentage: 99.9, windowType: SloWindowType.CalendarMonth },
      translator,
    ) as string;
    const window: string = describeSloWindow({ windowDays: 30 }, translator);

    expect(rolling).toContain(budget);
    expect(rolling).not.toContain("43m 12s");
    expect(month).toBe(
      translator.translateTemplate(SLO_CALENDAR_MONTH_ERROR_BUDGET_TEMPLATE, {
        percentage: formatSloPercent(0.1, 6, translator) as string,
        budget: budget,
        days: figure(30),
      }),
    );
    expect(month).not.toContain("43m 12s");
    expect(window).not.toBe("Rolling 30-day window");

    for (const line of [rolling, month, window]) {
      expectOwnDigits(line);
    }
  });

  test("names the KPI note's 1× as its burn rate formatter writes it", () => {
    const rate: string = formatSloBurnRate(1, translator) as string;
    const note: string = translator.translateTemplate(KPI_NOTE_KEY, {
      window: formatDurationCompactInLanguage(3600, code),
      rate: rate,
    });

    expect(note).toContain(rate);
    expect(note).not.toContain("spends the budget");
    expectOwnDigits(note);
  });
});

describe("the pages draw these lines through the helpers", () => {
  test("the rules table, the dialog and the bulk confirmation write a rule's windows with formatBurnRateRuleWindows", () => {
    for (const file of [
      "Pages/Slo/View/BurnRateRules.tsx",
      "Components/Slo/SloRecommendedBurnRateRulesModal.tsx",
      "Components/Slo/SloBulkRecommendedRulesDetails.tsx",
    ]) {
      const source: string = readSource(file);

      expect({
        file,
        uses: source.includes("formatBurnRateRuleWindows("),
      }).toEqual({
        file,
        uses: true,
      });
      // No window or suppression sentence filled with a bare number.
      expect(source).not.toContain('"{{long}}m / {{short}}m"');
      expect(source).not.toContain('"Suppress {{minutes}}m after resolve"');
      expect(source).not.toContain("refireSuppressionMinutes ??");
    }
  });

  test("the dialog and the bulk confirmation say what a rule fires on with formatBurnRateRuleFiresWhen, and its threshold with formatSloBurnRate", () => {
    for (const file of [
      "Components/Slo/SloRecommendedBurnRateRulesModal.tsx",
      "Components/Slo/SloBulkRecommendedRulesDetails.tsx",
    ]) {
      const source: string = readSource(file);

      expect(source).toContain("formatBurnRateRuleFiresWhen(");
      expect(source).toContain("formatSloBurnRate(");
      expect(source).not.toContain('"Fires when about');
      // No × written beside a figure in the markup.
      expect(source).not.toMatch(/\}×/);
    }
  });

  test("the KPI strip names its 1× as a value, not in its words", () => {
    const source: string = readSource("Components/Slo/SloKpiStrip.tsx");

    expect(source).toContain(KPI_NOTE_KEY);
    expect(source).not.toContain("· 1× spends");
    expect(source).toContain("formatSloBurnRate(1, translator)");
  });

  test("the Settings page hands its translator to both lines", () => {
    const source: string = readSource("Pages/Slo/View/Settings.tsx");

    for (const helper of ["describeSloErrorBudget", "describeSloWindow"]) {
      const call: RegExpMatchArray | null = source.match(
        new RegExp(`${helper}\\(\\s*\\{[^}]*\\},\\s*translator,?\\s*\\)`),
      );

      expect({ helper, handsTranslator: call !== null }).toEqual({
        helper,
        handsTranslator: true,
      });
    }
  });

  test("the create form's help and checks are sentences of the locales, not English written in", () => {
    const source: string = readSource("Pages/Slo/SloFormFields.ts");

    expect(source).toContain("description: getSloTargetHelpText()");
    expect(source).not.toContain('"Target must be greater than 0');
    expect(source).not.toContain('"Window must be between 1 and 366 days."');
    expect(source).not.toContain(
      '"At-risk threshold must be a percentage between 0 and 100."',
    );
    expect(source).not.toContain("Over 30 days, 99.9% allows");
  });
});

import { describe, expect, test } from "@jest/globals";
import { translateGroupingRuleText } from "../../../../App/FeatureSet/Dashboard/src/Components/GroupingRule/GroupingRuleTranslate";
import {
  createGroupingRuleTranslate,
  formatGroupingDuration,
  getGroupByValuesForMode,
  getGroupingRuleSummary,
  GROUPING_SUMMARY_COPY,
  GroupingMode,
  GroupingRuleKind,
  GroupingRuleSummary,
  GroupingRuleTranslateFunction,
  GroupingRuleValues,
  MINIMUM_COUNT_FIELD_NAMES,
  toGroupingRuleValues,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/GroupingRule/GroupingRuleSetup";
import { Translator } from "../../../Types/Translator";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A GROUPING RULE'S DURATIONS AND COUNTS, IN THE READER'S DIGITS (#8317).
 *
 * formatGroupingDuration handed its count to the translator as a plain
 * number, and a template fills a number with String(value): the Persian
 * Dashboard wrote "30 دقیقه" - Latin "30" in a Persian sentence - in a
 * rule's folded More fields line and in the list's Grouping column, while
 * the rest of its page writes Persian digits. The grouping rule pages'
 * translate writes every count with the reader's formatNumber now.
 */

const LATIN_DIGIT: RegExp = /[0-9]/;

const persian: GroupingRuleTranslateFunction = createGroupingRuleTranslate(
  dashboardTranslator("fa"),
);

const translateIn: (language: string) => GroupingRuleTranslateFunction = (
  language: string,
): GroupingRuleTranslateFunction => {
  return createGroupingRuleTranslate(dashboardTranslator(language));
};

describe("toGroupingRuleValues", () => {
  const translator: Translator = dashboardTranslator("fa");

  test("a number is written in the reader's digits, a text as it is", () => {
    expect(
      toGroupingRuleValues({ count: 30, name: "API 30" }, translator),
    ).toEqual({ count: "۳۰", name: "API 30" });
  });

  test("a count of a thousand or more takes the reader's grouping", () => {
    expect(toGroupingRuleValues({ count: 1500 }, translator)).toEqual({
      count: "۱٬۵۰۰",
    });
    expect(
      toGroupingRuleValues({ count: 1500 }, dashboardTranslator("de")),
    ).toEqual({ count: "1.500" });
  });

  test("a number that is not finite is written as it is, never formatted", () => {
    expect(toGroupingRuleValues({ count: NaN }, translator)).toEqual({
      count: "NaN",
    });
  });

  test("no values, no values", () => {
    expect(toGroupingRuleValues({}, translator)).toEqual({});
  });
});

describe("formatGroupingDuration", () => {
  test("Persian: minutes, hours and days in Persian digits", () => {
    const minutes: string = formatGroupingDuration({
      minutes: 30,
      translate: persian,
    });
    const hours: string = formatGroupingDuration({
      minutes: 120,
      translate: persian,
    });
    const days: string = formatGroupingDuration({
      minutes: 4320,
      translate: persian,
    });

    expect(minutes).toContain("۳۰");
    expect(hours).toContain("۲");
    expect(days).toContain("۳");

    for (const text of [minutes, hours, days]) {
      expect(LATIN_DIGIT.test(text)).toBe(false);
    }
  });

  test("English reads exactly as before", () => {
    const english: GroupingRuleTranslateFunction = translateIn("en");

    expect(formatGroupingDuration({ minutes: 30, translate: english })).toBe(
      "30 minutes",
    );
    expect(formatGroupingDuration({ minutes: 120, translate: english })).toBe(
      "2 hours",
    );
    expect(formatGroupingDuration({ minutes: 4320, translate: english })).toBe(
      "3 days",
    );
    expect(formatGroupingDuration({ minutes: 1, translate: english })).toBe(
      "1 minute",
    );
  });

  test("German, French and Arabic write their own digits: Latin ones", () => {
    for (const language of ["de", "fr", "ar"]) {
      const text: string = formatGroupingDuration({
        minutes: 30,
        translate: translateIn(language),
      });

      expect({ language, hasThirty: text.includes("30") }).toEqual({
        language,
        hasThirty: true,
      });
    }
  });

  test("a long window of minutes takes the reader's grouping", () => {
    expect(
      formatGroupingDuration({ minutes: 1501, translate: translateIn("en") }),
    ).toBe("1,501 minutes");
    expect(
      formatGroupingDuration({ minutes: 1501, translate: persian }),
    ).toContain("۱٬۵۰۱");
  });

  test("negative control: the count handed in as a plain number kept Latin digits", () => {
    const translator: Translator = dashboardTranslator("fa");
    const asBefore: string = translator.translateTemplate(
      GROUPING_SUMMARY_COPY.minutes,
      { count: 30 },
    );

    expect(asBefore).toContain("30");
    expect(
      formatGroupingDuration({ minutes: 30, translate: persian }),
    ).not.toContain("30");
  });
});

describe("a rule's summary, as the Grouping column draws it", () => {
  const minimumCount: string =
    MINIMUM_COUNT_FIELD_NAMES[GroupingRuleKind.Incident].count;
  const minimumEnabled: string =
    MINIMUM_COUNT_FIELD_NAMES[GroupingRuleKind.Incident].enabled;

  const rule: GroupingRuleValues = {
    ...getGroupByValuesForMode(
      GroupingMode.Everything,
      GroupingRuleKind.Incident,
    ),
    enableTimeWindow: true,
    timeWindowMinutes: 30,
    enableReopenWindow: true,
    reopenWindowMinutes: 120,
    [minimumEnabled]: true,
    [minimumCount]: 3,
  };

  test("Persian: the time window, the reopen window and the count to wait for, in Persian digits", () => {
    const summary: GroupingRuleSummary = getGroupingRuleSummary({
      rule,
      kind: GroupingRuleKind.Incident,
      translate: persian,
    });

    expect(withoutIsolateMarks(summary.timing)).toContain("۳۰");
    expect(LATIN_DIGIT.test(summary.timing)).toBe(false);

    for (const detail of summary.details) {
      expect({ detail, latin: LATIN_DIGIT.test(detail) }).toEqual({
        detail,
        latin: false,
      });
    }
  });

  test("English reads exactly as before", () => {
    const summary: GroupingRuleSummary = getGroupingRuleSummary({
      rule,
      kind: GroupingRuleKind.Incident,
      translate: translateIn("en"),
    });

    expect(summary.timing).toBe(
      "New incidents join while they arrive within 30 minutes of the last one",
    );
    expect(summary.details).toEqual(
      expect.arrayContaining([
        "Opens an episode once 3 matching incidents are ongoing",
        "Reopens episodes resolved in the last 2 hours",
      ]),
    );
  });
});

describe("the form's callbacks, outside React", () => {
  test("translateGroupingRuleText writes English with no i18next set up, its counts as before", () => {
    expect(
      translateGroupingRuleText(GROUPING_SUMMARY_COPY.minutes, { count: 30 }),
    ).toBe("30 minutes");
    expect(translateGroupingRuleText(GROUPING_SUMMARY_COPY.minute)).toBe(
      "1 minute",
    );
  });
});

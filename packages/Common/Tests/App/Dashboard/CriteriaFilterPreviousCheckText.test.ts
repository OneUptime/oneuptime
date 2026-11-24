import CriteriaFilterUtil, {
  CRITERIA_PERCENTAGE_POINTS,
  CRITERIA_PREVIOUS_CHECK_NO_CHANGE_SENTENCES,
  CRITERIA_PREVIOUS_CHECK_SENTENCES,
  CRITERIA_STARTED_MATCHING_SENTENCE,
  EVALUATE_OVER_TIME_TYPE_DESCRIPTIONS,
  PREVIOUS_CHECK_CHANGE_FIELD,
  PREVIOUS_CHECK_NO_DATA_DESCRIPTION,
  PREVIOUS_CHECK_WINDOW_DESCRIPTION,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeOptions,
  EvaluateOverTimeType,
  FilterType,
  PreviousCheckChangeType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorMetricType from "../../../Types/Monitor/MonitorMetricType";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import { createTranslator, Translator } from "../../../Types/Translator";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";
import { describe, expect, test } from "@jest/globals";

/*
 * The Dashboard's side of #10821: how a filter that compares a check with
 * the one before it says itself in the criteria list and under the form's
 * window - "... is more than 50% above the previous check" - in every
 * language, which choices the form offers, and what picking it sets.
 */

const SLOWER: CriteriaFilter = {
  checkOn: CheckOn.ResponseTime,
  filterType: FilterType.GreaterThan,
  value: undefined,
};

function previousCheck(
  criteriaFilter: CriteriaFilter,
  options: Partial<EvaluateOverTimeOptions> = {},
): CriteriaFilter {
  return {
    ...criteriaFilter,
    evaluateOverTime: true,
    evaluateOverTimeOptions: {
      timeValueInMinutes: 5,
      evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
      changeType: PreviousCheckChangeType.Percentage,
      changeValue: 50,
      ...options,
    },
  };
}

function textOf(
  criteriaFilter: CriteriaFilter,
  monitorType: MonitorType,
  translator?: Translator,
): string {
  return CriteriaFilterUtil.translateFilterToText(
    criteriaFilter,
    monitorType,
    translator,
  );
}

// A page's translator in `language`, as the criteria list draws with.
function translatorIn(language: string): Translator {
  const words: Record<string, string> = readDashboardLocale(language);

  return createTranslator(
    (key: string): string | undefined => {
      return words[key];
    },
    language,
    { drawsOnPage: true },
  );
}

describe("the editor's sentence, for a measured value against the previous check", () => {
  test("more than 50% above the previous check", () => {
    expect(textOf(previousCheck(SLOWER), MonitorType.Website)).toBe(
      'Check if "Response Time (in ms)" is more than 50% above the previous check',
    );
  });

  test.each([
    [
      FilterType.GreaterThanOrEqualTo,
      { changeType: PreviousCheckChangeType.Percentage, changeValue: 25 },
      'Check if "Response Time (in ms)" is at least 25% above the previous check',
    ],
    [
      FilterType.GreaterThan,
      { changeType: PreviousCheckChangeType.Amount, changeValue: 200 },
      'Check if "Response Time (in ms)" is more than 200 ms above the previous check',
    ],
    [
      FilterType.LessThan,
      { changeType: PreviousCheckChangeType.Amount, changeValue: 100 },
      'Check if "Response Time (in ms)" is more than 100 ms below the previous check',
    ],
    [
      FilterType.LessThanOrEqualTo,
      { changeType: PreviousCheckChangeType.Percentage, changeValue: 12.5 },
      'Check if "Response Time (in ms)" is at least 12.5% below the previous check',
    ],
    [
      FilterType.GreaterThan,
      { changeType: PreviousCheckChangeType.Amount, changeValue: 0 },
      'Check if "Response Time (in ms)" is above the previous check',
    ],
    [
      FilterType.GreaterThanOrEqualTo,
      { changeType: PreviousCheckChangeType.Percentage, changeValue: 0 },
      'Check if "Response Time (in ms)" is at or above the previous check',
    ],
    [
      FilterType.LessThan,
      { changeType: undefined, changeValue: undefined },
      'Check if "Response Time (in ms)" is below the previous check',
    ],
    [
      FilterType.LessThanOrEqualTo,
      { changeType: PreviousCheckChangeType.Amount, changeValue: 0 },
      'Check if "Response Time (in ms)" is at or below the previous check',
    ],
    [
      FilterType.EqualTo,
      { changeType: PreviousCheckChangeType.Amount, changeValue: 5 },
      'Check if "Response Time (in ms)" is the same as on the previous check',
    ],
    [
      FilterType.NotEqualTo,
      { changeType: PreviousCheckChangeType.Percentage, changeValue: 50 },
      'Check if "Response Time (in ms)" is different from the previous check',
    ],
  ])(
    "%s, with a change of %o",
    (
      filterType: FilterType,
      options: Partial<EvaluateOverTimeOptions>,
      expected: string,
    ) => {
      expect(
        textOf(
          previousCheck({ ...SLOWER, filterType: filterType }, options),
          MonitorType.Website,
        ),
      ).toBe(expected);
    },
  );

  test("a percentage check changes in percentage points, never a % that reads as a share", () => {
    expect(
      textOf(
        previousCheck(
          {
            checkOn: CheckOn.CPUUsagePercent,
            filterType: FilterType.GreaterThan,
            value: undefined,
          },
          { changeType: PreviousCheckChangeType.Amount, changeValue: 10 },
        ),
        MonitorType.Server,
      ),
    ).toBe(
      'Check if "CPU Usage (in %)" is more than 10 percentage points above the previous check',
    );
    expect(
      textOf(
        previousCheck(
          {
            checkOn: CheckOn.CPUUsagePercent,
            filterType: FilterType.GreaterThan,
            value: undefined,
          },
          { changeType: PreviousCheckChangeType.Amount, changeValue: 1 },
        ),
        MonitorType.Server,
      ),
    ).toBe(
      'Check if "CPU Usage (in %)" is more than 1 percentage point above the previous check',
    );
    expect(
      textOf(
        previousCheck(
          {
            checkOn: CheckOn.CPUUsagePercent,
            filterType: FilterType.GreaterThan,
            value: undefined,
          },
          { changeType: PreviousCheckChangeType.Percentage, changeValue: 50 },
        ),
        MonitorType.Server,
      ),
    ).toBe(
      'Check if "CPU Usage (in %)" is more than 50% above the previous check',
    );
  });

  test("a disk, a database metric and a status code are named as anywhere else", () => {
    expect(
      textOf(
        previousCheck(
          {
            checkOn: CheckOn.DiskUsagePercent,
            filterType: FilterType.GreaterThan,
            value: undefined,
            serverMonitorOptions: { diskPath: "/data" },
          },
          { changeType: PreviousCheckChangeType.Amount, changeValue: 5 },
        ),
        MonitorType.Server,
      ),
    ).toBe(
      'Check if "Disk Usage (in %)" on /data is more than 5 percentage points above the previous check',
    );
    expect(
      textOf(
        previousCheck({
          checkOn: CheckOn.ResponseStatusCode,
          filterType: FilterType.NotEqualTo,
          value: undefined,
        }),
        MonitorType.API,
      ),
    ).toBe(
      'Check if "Response Status Code" is different from the previous check',
    );
    expect(
      textOf(
        previousCheck(
          {
            checkOn: CheckOn.DatabaseMetric,
            filterType: FilterType.GreaterThan,
            value: undefined,
            databaseMonitorOptions: {
              metricType: MonitorMetricType.DatabaseConnectionsUsedPercent,
            },
          },
          { changeType: PreviousCheckChangeType.Amount, changeValue: 20 },
        ),
        MonitorType.Database,
      ),
    ).toMatch(/^Check if ".+" is more than 20.* above the previous check$/);
  });
});

describe("the editor's sentence, for a yes or no check against the previous check", () => {
  test("a body that starts containing a text", () => {
    expect(
      textOf(
        previousCheck(
          {
            checkOn: CheckOn.ResponseBody,
            filterType: FilterType.Contains,
            value: "Maintenance",
          },
          { changeType: undefined, changeValue: undefined },
        ),
        MonitorType.Website,
      ),
    ).toBe(
      'Check if "Response Body" contains "Maintenance" now, but not on the previous check',
    );
  });

  test("Is Online False: the check a host went down", () => {
    expect(
      textOf(
        previousCheck(
          {
            checkOn: CheckOn.IsOnline,
            filterType: FilterType.False,
            value: undefined,
          },
          { changeType: undefined, changeValue: undefined },
        ),
        MonitorType.Ping,
      ),
    ).toBe('Check if "Is Online" is false now, but not on the previous check');
  });

  test("a change saved on a yes or no check is no part of it", () => {
    expect(
      textOf(
        previousCheck({
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.True,
          value: undefined,
        }),
        MonitorType.Ping,
      ),
    ).toBe('Check if "Is Online" is true now, but not on the previous check');
  });

  test("a body never reads as on every check of a window", () => {
    expect(
      CriteriaFilterUtil.getCheckByCheckWindow(
        previousCheck({
          checkOn: CheckOn.ResponseBody,
          filterType: FilterType.Contains,
          value: "Maintenance",
        }),
        MonitorType.Website,
      ),
    ).toBeNull();
  });
});

describe("what the form offers and sets", () => {
  test("Previous Check is offered with what it does, after the counts", () => {
    const options: Array<DropdownOption> =
      CriteriaFilterUtil.getEvaluateOverTimeTypeOptions(
        SLOWER,
        MonitorType.Website,
      );

    expect(options[options.length - 1]).toEqual({
      value: EvaluateOverTimeType.PreviousCheck,
      label: EvaluateOverTimeType.PreviousCheck,
      description: "This check compared with the one before it.",
    });
    expect(
      EVALUATE_OVER_TIME_TYPE_DESCRIPTIONS[EvaluateOverTimeType.PreviousCheck],
    ).toBe("This check compared with the one before it.");
  });

  test("the change is an amount or a percentage", () => {
    expect(CriteriaFilterUtil.getPreviousCheckChangeTypeOptions()).toEqual([
      {
        value: PreviousCheckChangeType.Amount,
        label: "Amount in the check's own unit",
      },
      {
        value: PreviousCheckChangeType.Percentage,
        label: "Percent of the previous check",
      },
    ]);
  });

  test("picking Previous Check on a measured value starts at more than 50% above it", () => {
    expect(
      CriteriaFilterUtil.setEvaluateOverTimeType({
        criteriaFilter: {
          ...SLOWER,
          evaluateOverTime: true,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 10,
            evaluateOverTimeType: EvaluateOverTimeType.Average,
          },
        },
        evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
        monitorType: MonitorType.Website,
      }).evaluateOverTimeOptions,
    ).toEqual({
      timeValueInMinutes: 10,
      evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
      changeType: PreviousCheckChangeType.Percentage,
      changeValue: 50,
    });
  });

  test("a change already set is kept; another type takes it away", () => {
    const set: CriteriaFilter = previousCheck(SLOWER, {
      changeType: PreviousCheckChangeType.Amount,
      changeValue: 200,
    });

    expect(
      CriteriaFilterUtil.setEvaluateOverTimeType({
        criteriaFilter: set,
        evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
        monitorType: MonitorType.Website,
      }).evaluateOverTimeOptions,
    ).toMatchObject({
      changeType: PreviousCheckChangeType.Amount,
      changeValue: 200,
    });
    expect(
      CriteriaFilterUtil.setEvaluateOverTimeType({
        criteriaFilter: set,
        evaluateOverTimeType: EvaluateOverTimeType.Average,
        monitorType: MonitorType.Website,
      }).evaluateOverTimeOptions,
    ).toEqual({
      timeValueInMinutes: 5,
      evaluateOverTimeType: EvaluateOverTimeType.Average,
    });
  });

  test("a yes or no check takes no change", () => {
    expect(
      CriteriaFilterUtil.setEvaluateOverTimeType({
        criteriaFilter: {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.False,
          value: undefined,
        },
        evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
        monitorType: MonitorType.Ping,
      }).evaluateOverTimeOptions,
    ).toEqual({
      timeValueInMinutes: 5,
      evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
    });
  });
});

describe("in every language the Dashboard ships", () => {
  const SENTENCES: Array<string> = [
    ...Object.values(CRITERIA_PREVIOUS_CHECK_SENTENCES),
    ...Object.values(CRITERIA_PREVIOUS_CHECK_NO_CHANGE_SENTENCES),
    CRITERIA_STARTED_MATCHING_SENTENCE,
    CRITERIA_PERCENTAGE_POINTS.other,
    `${CRITERIA_PERCENTAGE_POINTS.other}_one`,
    PREVIOUS_CHECK_CHANGE_FIELD.title,
    PREVIOUS_CHECK_CHANGE_FIELD.description,
    PREVIOUS_CHECK_WINDOW_DESCRIPTION,
    PREVIOUS_CHECK_NO_DATA_DESCRIPTION,
    EVALUATE_OVER_TIME_TYPE_DESCRIPTIONS[EvaluateOverTimeType.PreviousCheck]!,
    "Previous Check",
    "Amount in the check's own unit",
    "Percent of the previous check",
  ];

  test.each(
    DASHBOARD_LANGUAGES.map((language: string): [string] => {
      return [language];
    }),
  )(
    "%s words every new sentence, its placeholders kept",
    (language: string) => {
      const locale: Record<string, string> = readDashboardLocale(language);

      for (const key of SENTENCES) {
        const worded: string | undefined = locale[key];

        expect({ language, key, isWorded: Boolean(worded) }).toEqual({
          language,
          key,
          isWorded: true,
        });

        const placeholders: (text: string) => Array<string> = (
          text: string,
        ): Array<string> => {
          return (text.match(/\{\{[a-z]+\}\}/g) || []).sort();
        };

        expect({ language, key, placeholders: placeholders(worded!) }).toEqual({
          language,
          key,
          placeholders: placeholders(key.replace(/_one$/, "")),
        });
      }
    },
  );

  test("German says the whole sentence in German", () => {
    const german: string = textOf(
      previousCheck(SLOWER),
      MonitorType.Website,
      translatorIn("de"),
    );

    expect(german).not.toMatch(/previous check|above|Check if/);
    expect(german).toContain("50");
  });

  test("Persian writes the share in its digits and percent sign", () => {
    const persian: string = textOf(
      previousCheck(SLOWER),
      MonitorType.Website,
      translatorIn("fa"),
    );

    expect(persian).toContain("۵۰٪");
    expect(persian).not.toMatch(/previous check/);
  });
});

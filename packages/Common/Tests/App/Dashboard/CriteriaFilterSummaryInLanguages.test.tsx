// UX rule: Docs/ux/README.md#in-every-language
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  AnomalyDetectionSensitivity,
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { createTranslator, Translator } from "../../../Types/Translator";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import CriteriaFilterUtil, {
  CRITERIA_COMPARISON_SENTENCES,
  CRITERIA_FILTER_AND_SENTENCE,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import CriteriaFilterElement from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorSteps/CriteriaFilter";

/*
 * A CRITERIA FILTER'S SUMMARY, ONE SENTENCE IN THE READER'S LANGUAGE (#8350).
 *
 * The criteria list wrote each filter as an English sentence built in code,
 * its threshold glued to "ms" in Latin digits: `Check if "Response Time (in
 * ms)" is greater than 500ms and,` under a German or a Persian form. Each
 * part is a sentence of the locale now, wrapped around the part inside it,
 * and the threshold is in the reader's digits - milliseconds through
 * formatMilliseconds. The filters below type nothing with a digit of its
 * own (a path, a text, an expression), so a Latin digit in a Persian
 * summary is the summary's.
 */

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const LATIN_DIGIT: RegExp = /[0-9]/;
const PERSIAN_DIGIT: RegExp = /[\u{06F0}-\u{06F9}]/u;
const ARABIC_INDIC_DIGIT: RegExp = /[\u{0660}-\u{0669}]/u;

// An English word of the summary's own, never of a check's name.
const ENGLISH_WORDS: RegExp =
  /\b(Check if|is greater than|is less than|in the past|minutes|on every check|on any check|values of|and,|or,|contains|forecast|anomalously|sensitivity|evaluates)\b/;

async function readIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

function translatorIn(language: string): Translator {
  const words: Record<string, string> = readDashboardLocale(language);

  return createTranslator((key: string): string | undefined => {
    return words[key];
  }, language);
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      LANGUAGES.map((language: string) => {
        return [language, { translation: readDashboardLocale(language) }];
      }),
    ),
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(async () => {
  await readIn("en");
});

afterEach(() => {
  cleanup();
});

function overTime(
  criteriaFilter: CriteriaFilter,
  type: EvaluateOverTimeType,
  minutes: number = 5,
): CriteriaFilter {
  return {
    ...criteriaFilter,
    evaluateOverTime: true,
    evaluateOverTimeOptions: {
      timeValueInMinutes: minutes,
      evaluateOverTimeType: type,
    },
  };
}

const RESPONSE_TIME: CriteriaFilter = {
  checkOn: CheckOn.ResponseTime,
  filterType: FilterType.GreaterThan,
  value: 3000,
};

const DISK: CriteriaFilter = overTime(
  {
    checkOn: CheckOn.DiskUsagePercent,
    filterType: FilterType.GreaterThanOrEqualTo,
    value: 90,
    serverMonitorOptions: { diskPath: "/dev/sda" },
  },
  EvaluateOverTimeType.MaximumValue,
  15,
);

const BODY: CriteriaFilter = overTime(
  {
    checkOn: CheckOn.ResponseBody,
    filterType: FilterType.NotContains,
    value: "App Title",
  },
  EvaluateOverTimeType.AllValues,
);

const EXPRESSION: CriteriaFilter = {
  checkOn: CheckOn.JavaScriptExpression,
  filterType: FilterType.EvaluatesToTrue,
  value: "'{{responseBody.status}}' === 'ok'",
};

const ONLINE: CriteriaFilter = overTime(
  {
    checkOn: CheckOn.IsOnline,
    filterType: FilterType.False,
    value: undefined,
  },
  EvaluateOverTimeType.AnyValue,
  10,
);

const METRIC_AVERAGE: CriteriaFilter = overTime(
  {
    checkOn: CheckOn.MetricValue,
    filterType: FilterType.LessThan,
    value: 12.5,
    metricMonitorOptions: {
      metricAggregationType: EvaluateOverTimeType.Average,
      thresholdUnit: "GB",
    },
  } as CriteriaFilter,
  EvaluateOverTimeType.AllValues,
);

const ANOMALY: CriteriaFilter = {
  checkOn: CheckOn.MetricValue,
  filterType: FilterType.AnomalouslyHigh,
  value: undefined,
  metricMonitorOptions: {
    anomalyDetection: {
      sensitivity: AnomalyDetectionSensitivity.High,
      windowDays: 14,
    },
  },
} as CriteriaFilter;

const FORECAST: CriteriaFilter = {
  checkOn: CheckOn.MetricValue,
  filterType: FilterType.ForecastAbove,
  value: 90,
  metricMonitorOptions: {
    thresholdUnit: "%",
    forecast: { horizonInHours: 72 },
  },
} as CriteriaFilter;

const SNMP_TABLE: CriteriaFilter = {
  checkOn: CheckOn.SnmpTableValue,
  filterType: FilterType.EqualTo,
  value: 2,
  snmpMonitorOptions: { tableKey: "ipsec_tunnels", tableRow: "*" },
} as CriteriaFilter;

const INCOMING: CriteriaFilter = {
  checkOn: CheckOn.IncomingRequest,
  filterType: FilterType.NotRecievedInMinutes,
  value: 30,
};

interface Case {
  name: string;
  filter: CriteriaFilter;
  condition?: FilterCondition | undefined;
  monitorType?: MonitorType | undefined;
  english: string;
}

const CASES: ReadonlyArray<Case> = [
  {
    name: "a response time, in milliseconds",
    filter: RESPONSE_TIME,
    condition: FilterCondition.All,
    english: 'Check if "Response Time (in ms)" is greater than 3,000 ms and,',
  },
  {
    name: "a disk's highest share over a window",
    filter: DISK,
    condition: FilterCondition.Any,
    english:
      'Check if maximum value of "Disk Usage (in %)" on /dev/sda in the past 15 minutes is greater than or equal to 90% or,',
  },
  {
    name: "a body judged check by check",
    filter: BODY,
    monitorType: MonitorType.Website,
    english:
      'Check if "Response Body" does not contain "App Title" on every check in the past 5 minutes',
  },
  {
    name: "an expression",
    filter: EXPRESSION,
    english:
      "Check if JavaScript expression '{{responseBody.status}}' === 'ok' - evaluates to true.",
  },
  {
    name: "a yes or no over any value of a window",
    filter: ONLINE,
    english:
      'Check if any value of "Is Online" in the past 10 minutes is false',
  },
  {
    name: "a metric's aggregate, with its unit",
    filter: METRIC_AVERAGE,
    english:
      'Check if Average of all values of "Metric Value" in the past 5 minutes is less than 12.5 GB',
  },
  {
    name: "an anomaly",
    filter: ANOMALY,
    english:
      'Check if "Metric Value" is anomalously high (sensitivity: High, baseline window: 14 days)',
  },
  {
    name: "a forecast",
    filter: FORECAST,
    english:
      'Check if "Metric Value" is forecast to rise above 90 % within 3 days',
  },
  {
    name: "every row of an SNMP table",
    filter: SNMP_TABLE,
    english:
      'Check if "SNMP Table Value" in SNMP table ipsec_tunnels for each row is equal to 2',
  },
  {
    name: "an incoming request that stops arriving",
    filter: INCOMING,
    english: 'Check if "Incoming Request" is not received within 30 minutes',
  },
];

function summaryIn(item: Case, translator?: Translator): string {
  return withoutIsolateMarks(
    CriteriaFilterUtil.translateFilterToText(
      item.filter,
      item.condition,
      item.monitorType,
      translator,
    ),
  );
}

describe("in English, the summary reads as one sentence", () => {
  test.each(
    CASES.map((item: Case): [string, Case] => {
      return [item.name, item];
    }),
  )("%s", (_name: string, item: Case) => {
    expect(summaryIn(item)).toBe(item.english);
    expect(summaryIn(item, translatorIn("en"))).toBe(item.english);
  });
});

describe("in Persian, every summary is Persian, in Persian digits", () => {
  test.each(
    CASES.map((item: Case): [string, Case] => {
      return [item.name, item];
    }),
  )("%s", (_name: string, item: Case) => {
    const summary: string = summaryIn(item, translatorIn("fa"));

    expect({ summary, latin: LATIN_DIGIT.test(summary) }).toEqual({
      summary,
      latin: false,
    });
    expect({ summary, english: ENGLISH_WORDS.test(summary) }).toEqual({
      summary,
      english: false,
    });
    expect(summary.startsWith("بررسی کنید که")).toBe(true);
  });

  test("the check would find an English line or a Latin digit", () => {
    expect(LATIN_DIGIT.test(CASES[0]!.english)).toBe(true);
    expect(ENGLISH_WORDS.test(CASES[0]!.english)).toBe(true);
  });
});

describe("in German and Arabic, the locale's words in Latin digits", () => {
  test.each(
    ["de", "ar"].flatMap((language: string) => {
      return CASES.map((item: Case): [string, string, Case] => {
        return [language, item.name, item];
      });
    }),
  )("%s: %s", (language: string, _name: string, item: Case) => {
    const summary: string = summaryIn(item, translatorIn(language));

    expect({ summary, english: ENGLISH_WORDS.test(summary) }).toEqual({
      summary,
      english: false,
    });
    expect(PERSIAN_DIGIT.test(summary)).toBe(false);
    expect(ARABIC_INDIC_DIGIT.test(summary)).toBe(false);

    if (LATIN_DIGIT.test(item.english)) {
      expect(LATIN_DIGIT.test(summary)).toBe(true);
    }
  });
});

describe("the threshold, as the reader's language writes it", () => {
  test("German: milliseconds and a decimal comma, never '3000ms'", () => {
    const german: Translator = translatorIn("de");
    const summary: string = summaryIn(CASES[0]!, german);

    expect(summary).toContain("3.000 ms");
    expect(summary).not.toContain("3000ms");
    expect(summary).toContain(
      `"${german.translateTerm("Response Time (in ms)")}"`,
    );
    expect(summary.startsWith("Prüfen: ")).toBe(true);
    expect(summary.endsWith(" und")).toBe(true);
    expect(summaryIn(CASES[5]!, german)).toContain("12,5 GB");
  });

  test("Persian: milliseconds in Persian, a percentage with Persian's sign", () => {
    const persian: Translator = translatorIn("fa");

    expect(summaryIn(CASES[0]!, persian)).toMatch(/۳٬۰۰۰\sمیلی‌ثانیه/);
    expect(summaryIn(CASES[1]!, persian)).toContain("۹۰٪");
    expect(summaryIn(CASES[1]!, persian)).toContain("/dev/sda");
  });

  test("Arabic: its own unit for milliseconds, in Latin digits", () => {
    expect(summaryIn(CASES[0]!, translatorIn("ar"))).toMatch(/3,000\sملي ث/);
  });

  test("a threshold that is not a plain number is put in as typed", () => {
    const typed: string = CriteriaFilterUtil.translateFilterToText(
      { ...RESPONSE_TIME, value: "{{threshold}}" },
      undefined,
      undefined,
      translatorIn("fa"),
    );

    expect(typed).toContain("{{threshold}}");
  });

  test("a text a comparison looks for is put in as typed, in the locale's quotes", () => {
    const german: string = summaryIn(
      { name: "", filter: BODY, monitorType: MonitorType.Website, english: "" },
      translatorIn("de"),
    );

    expect(german).toContain("„App Title“");
  });
});

describe("the parts of a summary are one language", () => {
  test("every condition the list words has a sentence in each language", () => {
    for (const language of ["de", "ar", "fa"]) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const sentence of Object.values(CRITERIA_COMPARISON_SENTENCES)) {
        expect({
          language,
          sentence,
          worded: words[sentence] !== sentence,
        }).toEqual({ language, sentence, worded: true });
      }
    }
  });

  test("a language that has not worded the whole sentence reads it in English, its threshold too", () => {
    const words: Record<string, string> = readDashboardLocale("de");
    const unworded: Translator = createTranslator(
      (key: string): string | undefined => {
        return key === CRITERIA_FILTER_AND_SENTENCE ? undefined : words[key];
      },
      "de",
    );

    expect(
      CriteriaFilterUtil.translateFilterToText(
        RESPONSE_TIME,
        FilterCondition.All,
        undefined,
        unworded,
      ),
    ).toBe('Check if "Response Time (in ms)" is greater than 3,000 ms and,');
  });

  test("a forecast's horizon is written in the sentence's language", () => {
    const summary: string = summaryIn(CASES[7]!, translatorIn("fa"));

    expect(summary).toContain("۳ روز");
    expect(summaryIn(CASES[7]!, translatorIn("de"))).toContain("3 Tage");
  });
});

describe("the criteria list, drawn", () => {
  function renderFilter(item: Case): void {
    render(
      <CriteriaFilterElement
        criteriaFilter={item.filter}
        filterCondition={item.condition}
        monitorType={item.monitorType}
      />,
    );
  }

  test("Persian: the summary on the page is Persian, in Persian digits", async () => {
    await readIn("fa");
    renderFilter(CASES[0]!);

    const text: string = withoutIsolateMarks(
      document.body.textContent || "",
    ).trim();

    expect(text).toContain("۳٬۰۰۰");
    expect(LATIN_DIGIT.test(text)).toBe(false);
    expect(text).not.toContain("Check if");
  });

  test("German: the summary on the page is German", async () => {
    await readIn("de");
    renderFilter(CASES[1]!);

    const text: string = document.body.textContent || "";

    expect(text).toContain("Prüfen: ");
    expect(text).toContain("/dev/sda");
    expect(text).not.toContain("in the past");
  });

  test("English: as the list has always read it", () => {
    renderFilter(CASES[2]!);

    expect(
      screen.getByText(
        'Check if "Response Body" does not contain "App Title" on every check in the past 5 minutes',
      ),
    ).toBeInTheDocument();
  });
});

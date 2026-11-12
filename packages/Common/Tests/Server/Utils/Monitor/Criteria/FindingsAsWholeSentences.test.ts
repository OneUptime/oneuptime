import APIRequestCriteria from "../../../../../Server/Utils/Monitor/Criteria/APIRequestCriteria";
import CompareCriteria from "../../../../../Server/Utils/Monitor/Criteria/CompareCriteria";
import EvaluationSentenceMemo from "../../../../../Server/Utils/Monitor/EvaluationSentenceMemo";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import {
  EvaluationSentence,
  englishOfEvaluationSentence,
  wordStoredEvaluationText,
} from "../../../../../Types/Monitor/EvaluationSentence";
import { RETIRED_EVALUATION_TEMPLATES } from "../../../../../Types/Monitor/RetiredEvaluationTemplates";
import ObjectID from "../../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../../Types/Probe/ProbeMonitorResponse";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../../../Helpers/IsolateMarks";
import { describe, expect, test } from "@jest/globals";

/*
 * THE FINDINGS THE MONITOR ENGINE WRITES, AS WHOLE SENTENCES (issue #6581).
 *
 * A filter that matched is said in a sentence: the root cause, the
 * evaluation log, emails and chat messages all carry it in English, and the
 * Dashboard words it in each reader's language from the template it was
 * filled from. Until #6581 the comparisons read "Result Value is ok which
 * is contains ok." - a template kept byte for byte when it became a locale
 * key, so translators had to guess at it - and the response header
 * findings said "Response header threshold contains miss." for a header's
 * value. Here: the English the engine writes now, the sentence each is
 * filled from, and every Dashboard language wording it whole.
 */

interface Finding {
  name: string;
  english: string;
  template: string;
}

// A custom code monitor's result, read as text.
const RESULT: string = "status: degraded";

function filter(
  checkOn: CheckOn,
  filterType: FilterType,
  value?: string | number,
): CriteriaFilter {
  return { checkOn: checkOn, filterType: filterType, value: value };
}

// The sentence the engine remembered the finding by (EvaluationSentenceMemo).
function sentenceOf(english: string | null): EvaluationSentence {
  expect(english).not.toBeNull();

  const sentence: EvaluationSentence | undefined = EvaluationSentenceMemo.find(
    english as string,
  );

  expect(sentence).toBeDefined();

  return sentence as EvaluationSentence;
}

function compare(
  checkOn: CheckOn,
  filterType: FilterType,
  values: string | number,
  threshold: string | number,
): string {
  return CompareCriteria.getCompareMessage({
    values: values,
    threshold: threshold,
    criteriaFilter: filter(checkOn, filterType, threshold),
  });
}

// What a text filter found, through the comparison the engine runs.
function compareText(filterType: FilterType, threshold: string): string {
  const english: string | null = CompareCriteria.compareCriteriaStrings({
    value: RESULT,
    threshold: threshold,
    criteriaFilter: filter(CheckOn.ResultValue, filterType, threshold),
  });

  expect(english).not.toBeNull();

  return english as string;
}

/*
 * The comparisons: a text, and a number that could not be read as one (a
 * metric that divided by zero), which the engine quotes as it is.
 */
const COMPARISONS: Array<Finding> = [
  {
    name: "Contains",
    english: "Result Value is status: degraded, which contains degraded.",
    template: "{{subject}} is {{values}}, which contains {{threshold}}.",
  },
  {
    name: "Not Contains",
    english: "Result Value is status: degraded, which does not contain ok.",
    template:
      "{{subject}} is {{values}}, which does not contain {{threshold}}.",
  },
  {
    name: "Starts With",
    english: "Result Value is status: degraded, which starts with status.",
    template: "{{subject}} is {{values}}, which starts with {{threshold}}.",
  },
  {
    name: "Ends With",
    english: "Result Value is status: degraded, which ends with degraded.",
    template: "{{subject}} is {{values}}, which ends with {{threshold}}.",
  },
  {
    name: "Greater Than",
    english: "Metric Value is Infinity, which is greater than 90.",
    template: "{{subject}} is {{values}}, which is greater than {{threshold}}.",
  },
  {
    name: "Greater Than Or Equal To",
    english: "Metric Value is Infinity, which is greater than or equal to 90.",
    template:
      "{{subject}} is {{values}}, which is greater than or equal to {{threshold}}.",
  },
  {
    name: "Less Than",
    english: "Metric Value is -Infinity, which is less than 90.",
    template: "{{subject}} is {{values}}, which is less than {{threshold}}.",
  },
  {
    name: "Less Than Or Equal To",
    english: "Metric Value is -Infinity, which is less than or equal to 90.",
    template:
      "{{subject}} is {{values}}, which is less than or equal to {{threshold}}.",
  },
  {
    name: "Equal To",
    english:
      "Result Value is status: degraded, which is equal to status: degraded.",
    template: "{{subject}} is {{values}}, which is equal to {{threshold}}.",
  },
  {
    name: "Not Equal To",
    english: "Metric Value is Infinity, which is not equal to 90.",
    template: "{{subject}} is {{values}}, which is not equal to {{threshold}}.",
  },
];

function writeComparison(name: string): string {
  switch (name) {
    case "Contains":
      return compareText(FilterType.Contains, "degraded");
    case "Not Contains":
      return compareText(FilterType.NotContains, "ok");
    case "Starts With":
      return compareText(FilterType.StartsWith, "status");
    case "Ends With":
      return compareText(FilterType.EndsWith, "degraded");
    case "Greater Than":
      return compare(CheckOn.MetricValue, FilterType.GreaterThan, Infinity, 90);
    case "Greater Than Or Equal To":
      return compare(
        CheckOn.MetricValue,
        FilterType.GreaterThanOrEqualTo,
        Infinity,
        90,
      );
    case "Less Than":
      return compare(CheckOn.MetricValue, FilterType.LessThan, -Infinity, 90);
    case "Less Than Or Equal To":
      return compare(
        CheckOn.MetricValue,
        FilterType.LessThanOrEqualTo,
        -Infinity,
        90,
      );
    case "Equal To":
      return compare(CheckOn.ResultValue, FilterType.EqualTo, RESULT, RESULT);
    case "Not Equal To":
      return compare(CheckOn.MetricValue, FilterType.NotEqualTo, Infinity, 90);
    default:
      throw new Error(`No comparison named ${name}`);
  }
}

// An API check's response, its headers as the server sent them.
function response(): ProbeMonitorResponse {
  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: "",
    monitoredAt: new Date("2026-11-12T08:00:00.000Z"),
    isOnline: true,
    responseCode: 200,
    responseHeaders: { "Content-Type": "application/json", "X-Cache": "MISS" },
  } as ProbeMonitorResponse;
}

async function checkHeaders(
  checkOn: CheckOn.ResponseHeader | CheckOn.ResponseHeaderValue,
  filterType: FilterType.Contains | FilterType.NotContains,
  value: string,
): Promise<string | null> {
  return APIRequestCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess: response(),
    criteriaFilter: filter(checkOn, filterType, value),
  });
}

const HEADERS: Array<{
  name: string;
  checkOn: CheckOn.ResponseHeader | CheckOn.ResponseHeaderValue;
  filterType: FilterType.Contains | FilterType.NotContains;
  value: string;
  english: string;
  template: string;
}> = [
  {
    name: "a header found by its name",
    checkOn: CheckOn.ResponseHeader,
    filterType: FilterType.Contains,
    value: "x-cache",
    english: "The response has the header x-cache.",
    template: "The response has the header {{text}}.",
  },
  {
    name: "a header not found by its name",
    checkOn: CheckOn.ResponseHeader,
    filterType: FilterType.NotContains,
    value: "x-request-id",
    english: "The response does not have the header x-request-id.",
    template: "The response does not have the header {{text}}.",
  },
  {
    name: "a header found by its value",
    checkOn: CheckOn.ResponseHeaderValue,
    filterType: FilterType.Contains,
    value: "miss",
    english: "A response header has the value miss.",
    template: "A response header has the value {{text}}.",
  },
  {
    name: "no header with the value",
    checkOn: CheckOn.ResponseHeaderValue,
    filterType: FilterType.NotContains,
    value: "hit",
    english: "No response header has the value hit.",
    template: "No response header has the value {{text}}.",
  },
];

// Every template this file shows the engine writing.
const TEMPLATES: Array<string> = [
  ...COMPARISONS.map((finding: Finding): string => {
    return finding.template;
  }),
  "{{subject}} is {{values}}.",
  ...HEADERS.map((finding: { template: string }): string => {
    return finding.template;
  }),
];

/*
 * The English the old templates said, which no finding may say again: a
 * "which is" before a verb, and a sentence that stops at "which is".
 */
const BROKEN_ENGLISH: ReadonlyArray<RegExp> = [
  /which is (contains|does|starts|ends)\b/,
  /which is$/,
  /[^,\s] which /,
  /header threshold/,
];

const LATIN_LETTER: RegExp = /[A-Za-z]/;

describe("a comparison's finding is one whole sentence", () => {
  test.each(
    COMPARISONS.map((finding: Finding): [string, Finding] => {
      return [finding.name, finding];
    }),
  )("%s", (_name: string, finding: Finding) => {
    const english: string = writeComparison(finding.name);

    expect(english).toBe(finding.english);

    for (const broken of BROKEN_ENGLISH) {
      expect(english).not.toMatch(broken);
    }

    const sentence: EvaluationSentence = sentenceOf(english);

    // The sentence it is filled from is the locale key, and fills it back.
    expect(sentence.template).toBe(finding.template);
    expect(englishOfEvaluationSentence(sentence)).toBe(english);
  });

  test("a condition the comparison does not name still says what was read, as a sentence", () => {
    const english: string = compare(
      CheckOn.ResultValue,
      FilterType.IsExecuting,
      RESULT,
      "",
    );

    expect(english).toBe("Result Value is status: degraded.");
    expect(sentenceOf(english).template).toBe("{{subject}} is {{values}}.");
  });

  test("no condition, however it is reached, writes a broken sentence", () => {
    for (const filterType of Object.values(FilterType)) {
      for (const values of [RESULT, Infinity] as Array<string | number>) {
        const english: string = compare(
          CheckOn.ResultValue,
          filterType,
          values,
          "ok",
        );

        for (const broken of BROKEN_ENGLISH) {
          expect({ filterType, english, broken: broken.test(english) }).toEqual(
            { filterType, english, broken: false },
          );
        }

        // Every finding ends as a sentence does.
        expect({ filterType, english, ends: english.endsWith(".") }).toEqual({
          filterType,
          english,
          ends: true,
        });
      }
    }
  });
});

describe("a response header's finding says whether its name or its value was found", () => {
  test.each(
    HEADERS.map(
      (
        finding: (typeof HEADERS)[number],
      ): [string, (typeof HEADERS)[number]] => {
        return [finding.name, finding];
      },
    ),
  )("%s", async (_name: string, finding: (typeof HEADERS)[number]) => {
    const english: string | null = await checkHeaders(
      finding.checkOn,
      finding.filterType,
      finding.value,
    );

    expect(english).toBe(finding.english);
    expect(sentenceOf(english).template).toBe(finding.template);
    expect(englishOfEvaluationSentence(sentenceOf(english))).toBe(english);
  });

  test("the two checks still match as before: a name, or a whole value, in lowercase", async () => {
    // A header's value is not a header's name, and the other way round.
    expect(
      await checkHeaders(CheckOn.ResponseHeader, FilterType.Contains, "miss"),
    ).toBeNull();
    expect(
      await checkHeaders(
        CheckOn.ResponseHeaderValue,
        FilterType.Contains,
        "x-cache",
      ),
    ).toBeNull();
    // A value matches whole, not by a part of it.
    expect(
      await checkHeaders(
        CheckOn.ResponseHeaderValue,
        FilterType.Contains,
        "mis",
      ),
    ).toBeNull();
    // What is there is not missing.
    expect(
      await checkHeaders(
        CheckOn.ResponseHeader,
        FilterType.NotContains,
        "content-type",
      ),
    ).toBeNull();
    expect(
      await checkHeaders(
        CheckOn.ResponseHeaderValue,
        FilterType.NotContains,
        "application/json",
      ),
    ).toBeNull();
  });

  test("the name's and the value's findings read apart", () => {
    const named: Array<string> = HEADERS.filter(
      (finding: (typeof HEADERS)[number]): boolean => {
        return finding.checkOn === CheckOn.ResponseHeader;
      },
    ).map((finding: (typeof HEADERS)[number]): string => {
      return finding.template;
    });

    for (const template of named) {
      expect(template).toContain("the header {{text}}");
      expect(template).not.toContain("value");
    }

    for (const finding of HEADERS) {
      if (finding.checkOn === CheckOn.ResponseHeaderValue) {
        expect(finding.template).toContain("the value {{text}}");
      }
    }
  });
});

describe("every Dashboard language words each finding", () => {
  test("each template is an English Dashboard key", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const template of TEMPLATES) {
      expect({ template, key: english[template] }).toEqual({
        template,
        key: template,
      });
    }
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words every one, with its placeholders",
    (language: string) => {
      const locale: Record<string, string> = readDashboardLocale(language);
      const unworded: Array<string> = [];

      for (const template of TEMPLATES) {
        if (!isWordedInDashboardLocale(template, language)) {
          unworded.push(template);
        }

        expect(placeholdersOf(locale[template] || "")).toEqual(
          placeholdersOf(template),
        );
      }

      expect({ language, unworded }).toEqual({ language, unworded: [] });
    },
  );

  test("a template a language has no key for is not counted as worded (the control)", () => {
    for (const retired of Array.from(RETIRED_EVALUATION_TEMPLATES.keys())) {
      expect(isWordedInDashboardLocale(retired, "de")).toBe(false);
    }

    expect(
      isWordedInDashboardLocale("{{subject}} is {{values}} which is", "fr"),
    ).toBe(false);
  });

  test.each(["de", "fr", "es", "ja", "zh-CN", "ru"])(
    "a %s reader reads each finding without an English word of the template",
    async (language: string) => {
      const findings: Array<string> = [
        ...COMPARISONS.map((finding: Finding): string => {
          return writeComparison(finding.name);
        }),
      ];

      for (const finding of HEADERS) {
        findings.push(
          (await checkHeaders(
            finding.checkOn,
            finding.filterType,
            finding.value,
          )) as string,
        );
      }

      for (const english of findings) {
        const worded: string = wordStoredEvaluationText({
          english: english,
          sentence: sentenceOf(english),
          translator: dashboardTranslator(language),
        });

        expect(worded).not.toBe(english);

        for (const word of [
          " which ",
          "contains",
          "contain ",
          "starts with",
          "ends with",
          "greater than",
          "less than",
          "equal to",
          "response",
          "header",
        ]) {
          expect({ english, worded, word, has: worded.includes(word) }).toEqual(
            { english, worded, word, has: false },
          );
        }
      }
    },
  );

  test.each(["ar", "fa"])(
    "a %s reader reads each finding with no Latin letter but the values it quotes",
    async (language: string) => {
      const quoted: Array<string> = [
        RESULT,
        "-Infinity",
        "Infinity",
        "degraded",
        "status",
        "ok",
        "x-request-id",
        "x-cache",
        "miss",
        "hit",
      ];
      const findings: Array<string> = COMPARISONS.map(
        (finding: Finding): string => {
          return writeComparison(finding.name);
        },
      );

      for (const finding of HEADERS) {
        findings.push(
          (await checkHeaders(
            finding.checkOn,
            finding.filterType,
            finding.value,
          )) as string,
        );
      }

      for (const english of findings) {
        let words: string = withoutIsolateMarks(
          wordStoredEvaluationText({
            english: english,
            sentence: sentenceOf(english),
            translator: dashboardTranslator(language),
          }),
        );

        for (const value of quoted) {
          words = words.split(value).join("");
        }

        expect({ english, words, latin: LATIN_LETTER.test(words) }).toEqual({
          english,
          words,
          latin: false,
        });
      }
    },
  );
});

import { describe, expect, test } from "@jest/globals";
import {
  DATA_CHECK_ALERT_CONDITION_LABELS,
  DATA_CHECK_ALERT_CONDITION_SENTENCES,
  DATA_CHECK_ALERT_THRESHOLD_PHRASES,
  getDataCheckAlertConditionSentence,
  getDataCheckAlertConditionWords,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataCheckAlertConditionWords";
import {
  DATA_CHECK_ALERT_CONDITIONS,
  DataCheckAlertCondition,
  doesAlertConditionNeedThreshold,
} from "../../../Types/DataObservability/DataCheckType";
import { createTranslator, Translator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * WHEN A CHECK ALERTS, IN THE READER'S WORDS (#6976).
 *
 * Write a Check from a Sentence ended with "Alerts when its value is
 * {{condition}} {{threshold}}." filled with the condition's English value,
 * lowercased - "Alarmiert, wenn ihr Wert above 0 ist." - and a translated
 * "above" would still have put the number after it, where Japanese, Korean
 * and Hindi put it before ("0 を上回る", "0 초과", "0 से ऊपर"). Each
 * condition is now one whole sentence, and the Checks tab's other places
 * that name a condition (the Alert column, a suggested check, the Alert
 * When dropdown) say it whole too, read here from the locale files
 * themselves.
 */

const ENGLISH: Record<string, string> = readDashboardLocale("en");

const SENTENCES: Array<string> = Object.values(
  DATA_CHECK_ALERT_CONDITION_SENTENCES,
);

const LABELS: Array<string> = Object.values(DATA_CHECK_ALERT_CONDITION_LABELS);

const PHRASES: Array<string> = Object.values(
  DATA_CHECK_ALERT_THRESHOLD_PHRASES,
) as Array<string>;

const EVERY_KEY: Array<string> = [...SENTENCES, ...LABELS, ...PHRASES];

// A condition's English, as the old template filled it in (lowercased value).
const ENGLISH_CONDITION_WORDS: RegExp =
  /\b(?:above|below|unusually|high|low)\b/i;

// The English words of a condition left in a sentence: what #6976 found.
function englishConditionWordsIn(text: string): Array<string> {
  return (
    withoutIsolateMarks(text).match(
      new RegExp(ENGLISH_CONDITION_WORDS.source, "gi"),
    ) || []
  );
}

function sentence(
  translator: Translator,
  condition: DataCheckAlertCondition,
  threshold: number,
): string {
  return withoutIsolateMarks(
    getDataCheckAlertConditionSentence({
      translator,
      condition,
      threshold,
    }) || "",
  );
}

function words(
  translator: Translator,
  condition: string,
  threshold?: number | string | null | undefined,
): string {
  return withoutIsolateMarks(
    getDataCheckAlertConditionWords({ translator, condition, threshold }),
  );
}

describe("every condition has its own words", () => {
  test("a sentence and a label for each condition a check can be saved with, none left out", () => {
    expect(Object.keys(DATA_CHECK_ALERT_CONDITION_SENTENCES).sort()).toEqual(
      [...DATA_CHECK_ALERT_CONDITIONS].sort(),
    );
    expect(Object.keys(DATA_CHECK_ALERT_CONDITION_LABELS).sort()).toEqual(
      [...DATA_CHECK_ALERT_CONDITIONS].sort(),
    );
    expect(DATA_CHECK_ALERT_CONDITIONS).toHaveLength(4);
  });

  test("a phrase with the number for exactly the conditions that compare with one", () => {
    expect(Object.keys(DATA_CHECK_ALERT_THRESHOLD_PHRASES).sort()).toEqual(
      DATA_CHECK_ALERT_CONDITIONS.filter(
        doesAlertConditionNeedThreshold,
      ).sort(),
    );

    for (const phrase of PHRASES) {
      expect(placeholdersOf(phrase)).toEqual(["{{threshold}}"]);
    }
  });

  test("a sentence names the number exactly when its condition compares with one", () => {
    for (const condition of DATA_CHECK_ALERT_CONDITIONS) {
      expect({
        condition,
        placeholders: placeholdersOf(
          DATA_CHECK_ALERT_CONDITION_SENTENCES[condition],
        ),
      }).toEqual({
        condition,
        placeholders: doesAlertConditionNeedThreshold(condition)
          ? ["{{threshold}}"]
          : [],
      });
    }
  });

  test("each sentence is a whole sentence, the condition written in it, never a slot for it", () => {
    for (const text of SENTENCES) {
      expect(text).not.toContain("{{condition}}");
      expect(text.startsWith("Alerts when its value is ")).toBe(true);
      expect(text.endsWith(".")).toBe(true);
    }
  });

  test("the old template that took the condition as a slot is gone from the locale files", () => {
    expect(
      ENGLISH["Alerts when its value is {{condition}} {{threshold}}."],
    ).toBeUndefined();

    for (const language of DASHBOARD_LANGUAGES) {
      expect({
        language,
        has: Object.prototype.hasOwnProperty.call(
          readDashboardLocale(language),
          "Alerts when its value is {{condition}} {{threshold}}.",
        ),
      }).toEqual({ language, has: false });
    }
  });
});

describe("in English", () => {
  const translator: Translator = dashboardTranslator("en");

  test("each condition's sentence", () => {
    expect(sentence(translator, DataCheckAlertCondition.Above, 0)).toBe(
      "Alerts when its value is above 0.",
    );
    expect(sentence(translator, DataCheckAlertCondition.Below, 5)).toBe(
      "Alerts when its value is below 5.",
    );
    expect(sentence(translator, DataCheckAlertCondition.UnusuallyHigh, 0)).toBe(
      "Alerts when its value is unusually high.",
    );
    expect(sentence(translator, DataCheckAlertCondition.UnusuallyLow, 0)).toBe(
      "Alerts when its value is unusually low.",
    );
  });

  test("the sentence is drawn without isolate marks in English", () => {
    expect(
      getDataCheckAlertConditionSentence({
        translator,
        condition: DataCheckAlertCondition.Above,
        threshold: 0,
      }),
    ).toBe("Alerts when its value is above 0.");
  });

  test("the number is written the reader's way", () => {
    expect(sentence(translator, DataCheckAlertCondition.Above, 1234567)).toBe(
      "Alerts when its value is above 1,234,567.",
    );
    expect(sentence(translator, DataCheckAlertCondition.Below, 2.5)).toBe(
      "Alerts when its value is below 2.5.",
    );
  });

  test("a condition with its number, on its own", () => {
    expect(words(translator, DataCheckAlertCondition.Above, 0)).toBe("Above 0");
    expect(words(translator, DataCheckAlertCondition.Below, 2.5)).toBe(
      "Below 2.5",
    );
    expect(words(translator, DataCheckAlertCondition.Above, 1500)).toBe(
      "Above 1,500",
    );
    expect(words(translator, DataCheckAlertCondition.UnusuallyHigh)).toBe(
      "Unusually High",
    );
    expect(words(translator, DataCheckAlertCondition.UnusuallyLow, 4)).toBe(
      "Unusually Low",
    );
  });

  test("Above or Below with no number says the condition's name alone", () => {
    for (const threshold of [undefined, null, "", "not a number"]) {
      expect(words(translator, DataCheckAlertCondition.Above, threshold)).toBe(
        "Above",
      );
      expect(words(translator, DataCheckAlertCondition.Below, threshold)).toBe(
        "Below",
      );
    }
  });

  test("a number read back as text is still a number", () => {
    expect(words(translator, DataCheckAlertCondition.Above, "3")).toBe(
      "Above 3",
    );
    expect(words(translator, DataCheckAlertCondition.Below, "0.25")).toBe(
      "Below 0.25",
    );
  });

  test("a value that is no condition is drawn as it is, and has no sentence", () => {
    expect(words(translator, "Sideways", 3)).toBe("Sideways");
    expect(
      getDataCheckAlertConditionSentence({
        translator,
        condition: "Sideways",
        threshold: 3,
      }),
    ).toBeNull();
    // An inherited name is no condition either.
    expect(words(translator, "toString", 3)).toBe("toString");
  });

  test("English holds every key under its own words", () => {
    for (const key of EVERY_KEY) {
      expect({ key, english: ENGLISH[key] }).toEqual({ key, english: key });
    }
  });
});

describe.each([...DASHBOARD_LANGUAGES])("in %s", (language: string) => {
  const locale: Record<string, string> = readDashboardLocale(language);
  const translator: Translator = dashboardTranslator(language);

  test("every key is the language's own, with the English placeholders", () => {
    for (const key of EVERY_KEY) {
      expect({ key, worded: isWordedInDashboardLocale(key, language) }).toEqual(
        { key, worded: true },
      );
      expect(placeholdersOf(locale[key]!)).toEqual(placeholdersOf(key));
    }
  });

  test("no sentence or phrase holds a condition's English", () => {
    for (const condition of DATA_CHECK_ALERT_CONDITIONS) {
      for (const text of [
        sentence(translator, condition, 0),
        sentence(translator, condition, 5),
        words(translator, condition, 0),
        words(translator, condition, null),
      ]) {
        expect({
          language,
          condition,
          english: englishConditionWordsIn(text),
        }).toEqual({ language, condition, english: [] });
      }
    }
  });

  test("the number is in the sentence, written the reader's way", () => {
    const five: string = translator.formatNumber(5);

    expect(sentence(translator, DataCheckAlertCondition.Above, 5)).toContain(
      five,
    );
    expect(sentence(translator, DataCheckAlertCondition.Below, 5)).toContain(
      five,
    );
    expect(words(translator, DataCheckAlertCondition.Above, 5)).toContain(five);
    expect(words(translator, DataCheckAlertCondition.Below, 5)).toContain(five);
  });

  test("Above and Below say different things", () => {
    expect(sentence(translator, DataCheckAlertCondition.Above, 5)).not.toBe(
      sentence(translator, DataCheckAlertCondition.Below, 5),
    );
    expect(
      sentence(translator, DataCheckAlertCondition.UnusuallyHigh, 5),
    ).not.toBe(sentence(translator, DataCheckAlertCondition.UnusuallyLow, 5));
    expect(words(translator, DataCheckAlertCondition.Above, 5)).not.toBe(
      words(translator, DataCheckAlertCondition.Below, 5),
    );
  });
});

/*
 * Where each language puts the number: before the condition in Japanese,
 * Korean and Hindi ("0 を上回る", "0 초과", "0 से ऊपर"), after it in German
 * ("über 0"). The issue's four, read whole.
 */
describe("the number where each language puts it", () => {
  const CASES: Array<
    [string, DataCheckAlertCondition, number, string, string]
  > = [
    [
      "de",
      DataCheckAlertCondition.Above,
      0,
      "Alarmiert, wenn ihr Wert über 0 liegt.",
      "Über 0",
    ],
    [
      "de",
      DataCheckAlertCondition.Below,
      5,
      "Alarmiert, wenn ihr Wert unter 5 liegt.",
      "Unter 5",
    ],
    [
      "ja",
      DataCheckAlertCondition.Above,
      0,
      "値が 0 を上回るときにアラートします。",
      "0 を上回る",
    ],
    [
      "ja",
      DataCheckAlertCondition.Below,
      5,
      "値が 5 を下回るときにアラートします。",
      "5 を下回る",
    ],
    [
      "ko",
      DataCheckAlertCondition.Above,
      0,
      "값이 0 초과일 때 알림을 보냅니다.",
      "0 초과",
    ],
    [
      "ko",
      DataCheckAlertCondition.Below,
      5,
      "값이 5 미만일 때 알림을 보냅니다.",
      "5 미만",
    ],
    [
      "hi",
      DataCheckAlertCondition.Above,
      0,
      "अलर्ट करता है जब इसका मान 0 से ऊपर हो।",
      "0 से ऊपर",
    ],
    [
      "hi",
      DataCheckAlertCondition.Below,
      5,
      "अलर्ट करता है जब इसका मान 5 से नीचे हो।",
      "5 से नीचे",
    ],
  ];

  test.each(CASES)(
    "%s, %s %d",
    (
      language: string,
      condition: DataCheckAlertCondition,
      threshold: number,
      expectedSentence: string,
      expectedWords: string,
    ) => {
      const translator: Translator = dashboardTranslator(language);

      expect(sentence(translator, condition, threshold)).toBe(expectedSentence);
      expect(words(translator, condition, threshold)).toBe(expectedWords);
    },
  );

  test("in Japanese, Korean and Hindi the number comes before the condition's words", () => {
    for (const [language, aboveWord, belowWord] of [
      ["ja", "を上回る", "を下回る"],
      ["ko", "초과", "미만"],
      ["hi", "से ऊपर", "से नीचे"],
    ] as Array<[string, string, string]>) {
      const translator: Translator = dashboardTranslator(language);

      for (const [condition, conditionWord] of [
        [DataCheckAlertCondition.Above, aboveWord],
        [DataCheckAlertCondition.Below, belowWord],
      ] as Array<[DataCheckAlertCondition, string]>) {
        const text: string = sentence(translator, condition, 7);

        expect(text.indexOf("7")).toBeGreaterThan(-1);
        expect(text.indexOf(conditionWord)).toBeGreaterThan(text.indexOf("7"));
      }
    }
  });
});

describe("right-to-left languages", () => {
  test("Persian writes the number in its own digits, the condition in Persian", () => {
    const translator: Translator = dashboardTranslator("fa");

    expect(sentence(translator, DataCheckAlertCondition.Above, 5)).toBe(
      readDashboardLocale("fa")[
        "Alerts when its value is above {{threshold}}."
      ]!.replace("{{threshold}}", "۵"),
    );
    expect(words(translator, DataCheckAlertCondition.Below, 12)).toBe(
      readDashboardLocale("fa")["Below {{threshold}}"]!.replace(
        "{{threshold}}",
        "۱۲",
      ),
    );
  });

  test("Arabic writes Latin digits, the condition in Arabic", () => {
    const translator: Translator = dashboardTranslator("ar");

    expect(sentence(translator, DataCheckAlertCondition.Above, 5)).toBe(
      "ينبّه عندما تكون قيمته أعلى من 5.",
    );
    expect(words(translator, DataCheckAlertCondition.Below, 12)).toBe(
      "أدنى من 12",
    );
    expect(words(translator, DataCheckAlertCondition.UnusuallyHigh)).toBe(
      "مرتفع على غير العادة",
    );
  });
});

/*
 * A check of the checks above: a locale whose sentence was put back to
 * the English, or to the old template filled with the English value, is
 * caught.
 */
describe("negative controls", () => {
  test("a German sentence put back to English holds the condition's English", () => {
    const german: Record<string, string> = {
      ...readDashboardLocale("de"),
      "Alerts when its value is above {{threshold}}.":
        "Alerts when its value is above {{threshold}}.",
    };
    const translator: Translator = createTranslator(
      (text: string): string | undefined => {
        return german[text];
      },
      "de",
    );

    expect(
      englishConditionWordsIn(
        sentence(translator, DataCheckAlertCondition.Above, 0),
      ),
    ).toEqual(["above"]);
  });

  test("the old template, filled as it was, holds the condition's English", () => {
    const translator: Translator = dashboardTranslator("de");

    expect(
      englishConditionWordsIn(
        translator.translateTemplate(
          "Alarmiert, wenn ihr Wert {{condition}} {{threshold}} ist.",
          {
            condition: DataCheckAlertCondition.Above.toLowerCase(),
            threshold: 0,
          },
        ),
      ),
    ).toEqual(["above"]);
  });

  test("a key a language left in English is not worded", () => {
    expect(isWordedInDashboardLocale("Unusually High", "de")).toBe(true);
    expect(
      isWordedInDashboardLocale(
        "Alerts when its value is {{condition}} {{threshold}}.",
        "de",
      ),
    ).toBe(false);
  });
});

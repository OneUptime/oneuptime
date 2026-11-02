import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  REAL_TIME_CORRELATION_PROBLEM,
  REAL_TIME_DISTINCT_COUNT_PROBLEM,
  REAL_TIME_REGULAR_EXPRESSION_PROBLEM,
  REAL_TIME_THRESHOLD_PROBLEM,
} from "Common/Types/SecurityEvent/RealTimeDetection";
import {
  Translator,
  createTranslator,
} from "Common/UI/Utils/TranslateTemplate";
import {
  REAL_TIME_PROBLEM_KEYS,
  getRealTimeFormProblem,
  runsInRealTime,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/DetectionRuleRealTime";

/*
 * RUN IN REAL TIME on the rule form: turned on for a rule that cannot run
 * so, the switch says why and what to change before the rule is saved -
 * the sentence the server would refuse it with, in the reader's language.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");

const LOCALES: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const LANGUAGES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

function wordsOf(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

function shippedTranslator(language: string): Translator {
  const words: Record<string, unknown> = wordsOf(language);

  return createTranslator((text: string): string | undefined => {
    const translated: unknown = words[text];

    return typeof translated === "string" ? translated : undefined;
  }, language);
}

const SINGLE: string = `title: Break-glass account signed in
detection:
  selection:
    className: Authentication
    principalUser: breakglass@acme.example
  condition: selection`;

const WITH_REGEX: string = `title: Admin sign-in from a numbered host
detection:
  selection:
    className: Authentication
    principalHost|re: '^ws-[0-9]+$'
  condition: selection`;

const FAILED: string = `title: Failed sign-in
name: failed_sign_in
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection`;

const SUCCEEDED: string = `title: Successful sign-in
name: successful_sign_in
detection:
  selection:
    className: Authentication
    statusName: Success
  condition: selection`;

const SEQUENCE: string = `title: Failed sign-in, then a success
correlation:
  type: temporal_ordered
  rules: [failed_sign_in, successful_sign_in]
  group-by: [principalIp]
  timespan: 10m
---
${FAILED}
---
${SUCCEEDED}`;

describe("the sentences the switch says", () => {
  test("are Common's own, word for word, as keys the extractor reads", () => {
    for (const problem of [
      REAL_TIME_CORRELATION_PROBLEM,
      REAL_TIME_THRESHOLD_PROBLEM,
      REAL_TIME_DISTINCT_COUNT_PROBLEM,
      REAL_TIME_REGULAR_EXPRESSION_PROBLEM,
    ]) {
      expect(REAL_TIME_PROBLEM_KEYS[problem]).toBe(problem);
    }

    expect(Object.keys(REAL_TIME_PROBLEM_KEYS)).toHaveLength(4);
  });

  test.each(LANGUAGES)("are translated in %s", (language: string) => {
    const words: Record<string, unknown> = wordsOf(language);

    for (const problem of Object.values(REAL_TIME_PROBLEM_KEYS)) {
      const translated: unknown = words[problem];

      expect(typeof translated).toBe("string");
      expect(translated).not.toBe(problem);
      // The setting it names, and the modifiers it suggests, stay intact.
      if (problem === REAL_TIME_REGULAR_EXPRESSION_PROBLEM) {
        for (const word of ["|re", "contains", "startswith", "endswith"]) {
          expect(translated).toContain(word);
        }
      }
    }
  });
});

describe("why the form's rule cannot run in real time", () => {
  test("says nothing while the switch is off", () => {
    expect(
      getRealTimeFormProblem(
        { sigmaRuleYaml: SINGLE, matchCountThreshold: 5, isRealTime: false },
        ENGLISH,
      ),
    ).toBeNull();
    expect(
      getRealTimeFormProblem(
        { sigmaRuleYaml: SEQUENCE, isRealTime: undefined },
        ENGLISH,
      ),
    ).toBeNull();
  });

  test("says nothing for a rule that fires on one event", () => {
    for (const threshold of [1, "1", undefined, null, ""]) {
      expect(
        getRealTimeFormProblem(
          {
            sigmaRuleYaml: SINGLE,
            matchCountThreshold: threshold,
            distinctCountField: "",
            isRealTime: true,
          },
          ENGLISH,
        ),
      ).toBeNull();
    }
  });

  test("a threshold above 1, as a number or as the number field's text", () => {
    for (const threshold of [5, "5"]) {
      expect(
        getRealTimeFormProblem(
          {
            sigmaRuleYaml: SINGLE,
            matchCountThreshold: threshold,
            isRealTime: true,
          },
          ENGLISH,
        ),
      ).toBe(REAL_TIME_THRESHOLD_PROBLEM);
    }
  });

  test("a distinct count field, a regular expression and a correlation each say what to change", () => {
    expect(
      getRealTimeFormProblem(
        {
          sigmaRuleYaml: SINGLE,
          distinctCountField: "principalUser",
          isRealTime: "true",
        },
        ENGLISH,
      ),
    ).toBe(REAL_TIME_DISTINCT_COUNT_PROBLEM);
    expect(
      getRealTimeFormProblem(
        { sigmaRuleYaml: WITH_REGEX, isRealTime: true },
        ENGLISH,
      ),
    ).toBe(REAL_TIME_REGULAR_EXPRESSION_PROBLEM);
    expect(
      getRealTimeFormProblem(
        { sigmaRuleYaml: SEQUENCE, isRealTime: true },
        ENGLISH,
      ),
    ).toBe(REAL_TIME_CORRELATION_PROBLEM);
  });

  test("leaves YAML that does not read to the YAML field", () => {
    for (const yaml of ["title: [", "", "   ", undefined, 42]) {
      expect(
        getRealTimeFormProblem(
          { sigmaRuleYaml: yaml, matchCountThreshold: 5, isRealTime: true },
          ENGLISH,
        ),
      ).toBeNull();
    }
  });

  test("reads in the reader's language", () => {
    expect(
      getRealTimeFormProblem(
        { sigmaRuleYaml: SINGLE, matchCountThreshold: 5, isRealTime: true },
        shippedTranslator("de"),
      ),
    ).toBe(
      "Sie wartet auf eine Anzahl von Treffern, daher läuft sie in ihrem Intervall: Setzen Sie „Schwellenwert der Trefferanzahl“ auf 1, um sie in Echtzeit auszuführen.",
    );
  });

  test("the switch reads on as Postgres may hand it back", () => {
    expect(runsInRealTime({ isRealTime: true })).toBe(true);
    expect(runsInRealTime({ isRealTime: "true" })).toBe(true);
    expect(runsInRealTime({ isRealTime: false })).toBe(false);
    expect(runsInRealTime({})).toBe(false);
  });
});

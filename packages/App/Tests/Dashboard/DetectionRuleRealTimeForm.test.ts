import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { REAL_TIME_REGULAR_EXPRESSION_PROBLEM } from "Common/Types/SecurityEvent/RealTimeDetection";
import {
  Translator,
  createTranslator,
} from "Common/UI/Utils/TranslateTemplate";
import {
  REAL_TIME_PROBLEM_KEYS,
  countsInWindows,
  getRealTimeFormProblem,
  runsInRealTime,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/DetectionRuleRealTime";

/*
 * RUN IN REAL TIME on the rule form: any rule but one with a regular
 * expression can run so - a rule that counts and a correlation alike - and
 * turned on for one that cannot, the switch says why and what to change
 * before the rule is saved, the sentence the server would refuse it with,
 * in the reader's language. In real time, a rule that counts still counts
 * in windows of its interval, so the form keeps the interval for it.
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

const RULES_PAGE: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Pages",
  "SecurityEvents",
  "DetectionRules.tsx",
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

// The form's own words for the switch and the interval, as the page writes them.
const SWITCH_DESCRIPTION: string =
  "Check events as they arrive, within seconds, instead of every interval. Not for a rule with a regular expression (|re).";
const INTERVAL_DESCRIPTION: string =
  "How often the rule runs, in minutes. In real time, a rule that counts reads windows this long and fires at most once in each.";

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

const SEQUENCE_WITH_REGEX: string = SEQUENCE.replace(
  "statusName: Success",
  "statusName|re: '^Succ'",
);

describe("the sentences the switch says", () => {
  test("are Common's own, word for word, as keys the extractor reads", () => {
    expect(REAL_TIME_PROBLEM_KEYS[REAL_TIME_REGULAR_EXPRESSION_PROBLEM]).toBe(
      REAL_TIME_REGULAR_EXPRESSION_PROBLEM,
    );
    // A regular expression is all that keeps a rule off real time.
    expect(Object.keys(REAL_TIME_PROBLEM_KEYS)).toEqual([
      REAL_TIME_REGULAR_EXPRESSION_PROBLEM,
    ]);
  });

  test.each(LANGUAGES)("are translated in %s", (language: string) => {
    const words: Record<string, unknown> = wordsOf(language);

    for (const problem of Object.values(REAL_TIME_PROBLEM_KEYS)) {
      const translated: unknown = words[problem];

      expect(typeof translated).toBe("string");
      expect(translated).not.toBe(problem);
      // The modifiers it names and suggests stay intact.
      for (const word of ["|re", "contains", "startswith", "endswith"]) {
        expect(translated).toContain(word);
      }
    }
  });

  test("the sentences of a rule that could not count are gone from every language", () => {
    for (const language of ["en", ...LANGUAGES]) {
      const words: Record<string, unknown> = wordsOf(language);

      for (const retired of [
        "A correlation reads several events together over its timespan, so it runs on its interval.",
        "It waits for a count of matches, so it runs on its interval: set Match Count Threshold to 1 to run it in real time.",
        "It counts different values, so it runs on its interval: clear Distinct Count Field to run it in real time.",
        "Check each event as it arrives, within seconds. For a rule that fires on one event: threshold 1, no distinct count field, no regular expression.",
        "How often this rule is evaluated, in minutes.",
      ]) {
        expect({ language, retired, words: words[retired] }).toEqual({
          language,
          retired,
          words: undefined,
        });
      }
    }
  });
});

describe("the switch and the interval say what real time does", () => {
  test("in the page's own words", () => {
    const page: string = fs.readFileSync(RULES_PAGE, "utf8");

    expect(page).toContain(`"${SWITCH_DESCRIPTION}"`);
    expect(page).toContain(`"${INTERVAL_DESCRIPTION}"`);
  });

  test.each(LANGUAGES)(
    "translated in %s, naming the modifier as it is",
    (language: string) => {
      const words: Record<string, unknown> = wordsOf(language);

      for (const sentence of [SWITCH_DESCRIPTION, INTERVAL_DESCRIPTION]) {
        expect(typeof words[sentence]).toBe("string");
        expect(words[sentence]).not.toBe(sentence);
      }

      expect(words[SWITCH_DESCRIPTION]).toContain("|re");
    },
  );
});

describe("why the form's rule cannot run in real time", () => {
  test("says nothing while the switch is off", () => {
    expect(
      getRealTimeFormProblem(
        { sigmaRuleYaml: WITH_REGEX, isRealTime: false },
        ENGLISH,
      ),
    ).toBeNull();
    expect(
      getRealTimeFormProblem(
        { sigmaRuleYaml: SEQUENCE_WITH_REGEX, isRealTime: undefined },
        ENGLISH,
      ),
    ).toBeNull();
  });

  test("says nothing for a rule that fires on one event, one that counts, or a correlation", () => {
    for (const values of [
      { sigmaRuleYaml: SINGLE, matchCountThreshold: 1 },
      { sigmaRuleYaml: SINGLE, matchCountThreshold: "5" },
      { sigmaRuleYaml: SINGLE, distinctCountField: "principalUser" },
      { sigmaRuleYaml: SEQUENCE },
    ]) {
      expect(
        getRealTimeFormProblem({ ...values, isRealTime: true }, ENGLISH),
      ).toBeNull();
    }
  });

  test("a regular expression says what to change - in a correlation's rules too", () => {
    expect(
      getRealTimeFormProblem(
        { sigmaRuleYaml: WITH_REGEX, isRealTime: "true" },
        ENGLISH,
      ),
    ).toBe(REAL_TIME_REGULAR_EXPRESSION_PROBLEM);
    expect(
      getRealTimeFormProblem(
        { sigmaRuleYaml: SEQUENCE_WITH_REGEX, isRealTime: true },
        ENGLISH,
      ),
    ).toBe(REAL_TIME_REGULAR_EXPRESSION_PROBLEM);
  });

  test("leaves YAML that does not read to the YAML field", () => {
    for (const yaml of ["title: [", "", "   ", undefined, 42]) {
      expect(
        getRealTimeFormProblem(
          { sigmaRuleYaml: yaml, isRealTime: true },
          ENGLISH,
        ),
      ).toBeNull();
    }
  });

  test("reads in the reader's language", () => {
    expect(
      getRealTimeFormProblem(
        { sigmaRuleYaml: WITH_REGEX, isRealTime: true },
        shippedTranslator("de"),
      ),
    ).toBe(
      "Sie nutzt einen regulären Ausdruck (|re), der nur nach Zeitplan läuft: Verwenden Sie contains, startswith oder endswith, um sie in Echtzeit auszuführen.",
    );
  });

  test("the switch reads on as Postgres may hand it back", () => {
    expect(runsInRealTime({ isRealTime: true })).toBe(true);
    expect(runsInRealTime({ isRealTime: "true" })).toBe(true);
    expect(runsInRealTime({ isRealTime: false })).toBe(false);
    expect(runsInRealTime({})).toBe(false);
  });
});

describe("whether the form's rule counts in windows of its interval", () => {
  test("a rule that fires on one event does not: in real time it runs on no interval", () => {
    for (const threshold of [1, "1", undefined, null, ""]) {
      expect(
        countsInWindows({
          sigmaRuleYaml: SINGLE,
          matchCountThreshold: threshold,
          distinctCountField: "",
        }),
      ).toBe(false);
    }
  });

  test("a threshold above 1, a distinct count field and a correlation do", () => {
    for (const values of [
      { sigmaRuleYaml: SINGLE, matchCountThreshold: 5 },
      { sigmaRuleYaml: SINGLE, matchCountThreshold: "5" },
      { sigmaRuleYaml: SINGLE, distinctCountField: "principalUser" },
      { sigmaRuleYaml: SEQUENCE },
    ]) {
      expect(countsInWindows(values)).toBe(true);
    }
  });

  test("YAML that does not read yet keeps the interval on the form", () => {
    for (const yaml of ["title: [", "", undefined]) {
      expect(countsInWindows({ sigmaRuleYaml: yaml })).toBe(true);
    }
  });
});

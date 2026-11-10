import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  REMEDIATION_ROUND_COPY,
  REMEDIATION_ROUND_TRY_AGAIN_NOT_ALLOWED_KEYS,
  REMEDIATION_ROUND_TRY_AGAIN_REFUSAL_KEYS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStepCopy";
import { REMEDIATION_STEP_STATUS_TEXT } from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStepStatus";
import {
  REMEDIATION_ROUND_TRY_AGAIN_NOT_ALLOWED,
  REMEDIATION_ROUND_TRY_AGAIN_REFUSALS,
  RemediationRoundTryAgainRefusal,
} from "../../../Types/AutoRemediation/RemediationRound";
import {
  createTranslator,
  PluralTemplate,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * EVERY WORD A ROUND OF AN AI FIX IS EXPLAINED WITH IS EVERY LANGUAGE'S OWN
 * (issues #6436, #6487): that it stopped and why, what it ruled out and
 * checked, that nobody was asked, and every refusal of its Try again - read
 * from the Dashboard's locale files, so a key that lost its translation,
 * kept the English or lost a placeholder is caught. The refusals are the
 * server's sentences word for word: the step shows the server's sentence,
 * looked up as a key, so a sentence the server words differently would
 * reach a reader in English.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = [
  "ar",
  "da",
  "de",
  "es",
  "fa",
  "fr",
  "hi",
  "it",
  "ja",
  "ko",
  "nl",
  "no",
  "pt",
  "ru",
  "sv",
  "zh-CN",
  "zh-TW",
];

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const ENGLISH: Record<string, string> = readLocale("en");

const PLURALS: Array<PluralTemplate> = [REMEDIATION_ROUND_COPY.otherChecks];

const SENTENCES: Array<string> = [
  REMEDIATION_ROUND_COPY.unfinishedFix,
  REMEDIATION_ROUND_COPY.unfinishedRunbook,
  REMEDIATION_ROUND_COPY.didNotFinish,
  REMEDIATION_ROUND_COPY.whyItStopped,
  REMEDIATION_ROUND_COPY.ruledOutHeading,
  REMEDIATION_ROUND_COPY.checksHeading,
  REMEDIATION_ROUND_COPY.checkRan,
  REMEDIATION_ROUND_COPY.checkFailed,
  REMEDIATION_ROUND_COPY.checkUnknown,
  REMEDIATION_ROUND_COPY.checkRunning,
  REMEDIATION_ROUND_COPY.checkStopped,
  REMEDIATION_ROUND_COPY.nothingAskedNoFix,
  REMEDIATION_ROUND_COPY.nothingAskedNoRunbook,
  REMEDIATION_ROUND_COPY.nothingAskedUnfinished,
  REMEDIATION_ROUND_COPY.nothingAskedUnfinishedRunbook,
  REMEDIATION_ROUND_COPY.showFullReasoning,
  REMEDIATION_ROUND_COPY.showLessReasoning,
  REMEDIATION_STEP_STATUS_TEXT.didNotFinish,
  ...Object.values(REMEDIATION_ROUND_TRY_AGAIN_REFUSAL_KEYS),
  ...Object.values(REMEDIATION_ROUND_TRY_AGAIN_NOT_ALLOWED_KEYS),
];

// Each key, with the English it holds: a plural's "one" under key + "_one".
const WORDS: Array<[string, string]> = Array.from(new Set(SENTENCES))
  .map((word: string): [string, string] => {
    return [word, word];
  })
  .concat(
    PLURALS.flatMap((template: PluralTemplate): Array<[string, string]> => {
      return [
        [template.other, template.other],
        [`${template.other}_one`, template.one],
      ];
    }),
  );

const PLACEHOLDER: RegExp = /\{\{[a-zA-Z]+\}\}/g;

function placeholders(text: string): Array<string> {
  return Array.from(new Set(text.match(PLACEHOLDER) || [])).sort();
}

function translatorFor(language: string): Translator {
  const words: Record<string, string> = readLocale(language);

  return createTranslator((text: string): string | undefined => {
    return words[text];
  }, language);
}

describe("the refusals are the server's sentences, word for word", () => {
  test("every refusal the server can say has its key", () => {
    expect(
      Object.keys(REMEDIATION_ROUND_TRY_AGAIN_REFUSAL_KEYS).sort(),
    ).toEqual(Object.values(RemediationRoundTryAgainRefusal).sort());
  });

  test.each(Object.values(RemediationRoundTryAgainRefusal))(
    "%s",
    (refusal: RemediationRoundTryAgainRefusal) => {
      expect(REMEDIATION_ROUND_TRY_AGAIN_REFUSAL_KEYS[refusal]).toBe(
        REMEDIATION_ROUND_TRY_AGAIN_REFUSALS[refusal],
      );
    },
  );

  test("who may not change the incident or alert", () => {
    expect(REMEDIATION_ROUND_TRY_AGAIN_NOT_ALLOWED_KEYS).toEqual(
      REMEDIATION_ROUND_TRY_AGAIN_NOT_ALLOWED,
    );
  });
});

describe("English holds every word under its own key", () => {
  test("there is something to check", () => {
    expect(WORDS.length).toBeGreaterThan(30);
  });

  test.each(WORDS)("%s", (key: string, english: string) => {
    expect(ENGLISH[key]).toBe(english);
  });
});

describe.each(LANGUAGES)("the %s locale", (language: string) => {
  const words: Record<string, string> = readLocale(language);

  test.each(WORDS)(
    "words %s its own way, with the same placeholders",
    (key: string, english: string) => {
      const translated: string | undefined = words[key];

      expect(translated).toBeDefined();
      expect(translated!.trim().length).toBeGreaterThan(0);
      expect({ key, translated: translated !== english }).toEqual({
        key,
        translated: true,
      });
      expect(placeholders(translated!)).toEqual(placeholders(english));
    },
  );
});

describe("the step says the server's refusal in the reader's language", () => {
  test.each(LANGUAGES)("%s", (language: string) => {
    const translator: Translator = translatorFor(language);
    const sentence: string =
      REMEDIATION_ROUND_TRY_AGAIN_REFUSALS[
        RemediationRoundTryAgainRefusal.PartlyApplied
      ];

    // What the step does with the server's words (RemediationStep.tryAgainRound).
    expect(translator.translateText(sentence)).toBe(
      readLocale(language)[sentence],
    );
    expect(translator.translateText(sentence)).not.toBe(sentence);
  });

  test("the count of other checks is said in the language's own form", () => {
    expect(
      translatorFor("de").translatePlural(
        REMEDIATION_ROUND_COPY.otherChecks,
        1,
      ),
    ).toBe(
      readLocale("de")[
        `${REMEDIATION_ROUND_COPY.otherChecks.other}_one`
      ]!.replace("{{count}}", "1"),
    );
    expect(
      translatorFor("de").translatePlural(
        REMEDIATION_ROUND_COPY.otherChecks,
        4,
      ),
    ).toBe(
      readLocale("de")[REMEDIATION_ROUND_COPY.otherChecks.other]!.replace(
        "{{count}}",
        "4",
      ),
    );
  });
});

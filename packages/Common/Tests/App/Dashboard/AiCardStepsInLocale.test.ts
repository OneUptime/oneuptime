import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  AI_CARD_DESCRIPTION,
  AI_CARD_TITLE,
  HIDE_FULL_REPORT,
  INVESTIGATION_STEP_STATUS_LABEL,
  INVESTIGATION_STEP_TITLE,
  SHOW_FULL_REPORT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationPanel";
import {
  REMEDIATION_CODE_FIX_AUTOMATIC_REASONS,
  REMEDIATION_CODE_FIX_COPY,
  REMEDIATION_FIX_CHANGES_SENTENCE,
  REMEDIATION_FIX_COMMANDS_SENTENCE,
  REMEDIATION_FIX_FAILED_COUNT,
  REMEDIATION_FIX_HIDE_DETAILS,
  REMEDIATION_FIX_REVIEW_AND_APPROVE,
  REMEDIATION_FIX_SHOW_DETAILS,
  REMEDIATION_STEP_NOT_TRIED,
  REMEDIATION_STEP_STATUS_LABEL,
  REMEDIATION_STEP_TITLE,
  REMEDIATION_STEP_WAITING,
  REMEDIATION_TRY_AGAIN_BUTTON,
  REMEDIATION_TRY_AGAIN_FAILED,
  REMEDIATION_TRY_AGAIN_HINT,
  REMEDIATION_TRY_AGAIN_REFUSAL_KEYS,
  REMEDIATION_TRY_AGAIN_SERVER_SENTENCES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStepCopy";
import { REMEDIATION_STEP_STATUS_TEXT } from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStepStatus";
import {
  LINK_MONITOR_FOR_NEXT_TIME,
  TURN_FIXES_ON_WHAT_TO_DO,
  TURN_ON_FIXING_LINKS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationDecisionLines";
import { PluralTemplate } from "../../../Types/Translator";
import {
  REMEDIATION_TRY_AGAIN_REFUSALS,
  RemediationTryAgainRefusal,
  RemediationTryAgainResult,
  RemediationTryAgainSignal,
} from "../../../Types/AutoRemediation/RemediationTryAgain";

/*
 * EVERY WORD OF THE AI CARD'S TWO STEPS IS EVERY LANGUAGE'S OWN (block 43).
 *
 * The card's title and description, each step's title and its pill's name,
 * the fold of the report, where fixing stands, why it waits or was not
 * tried, Try again and every refusal of it, the fix in the code and why
 * OneUptime AI did not open it on its own, and the "on now" lines - read
 * from the Dashboard's locale files themselves: a key that lost its
 * translation, kept the English or lost a placeholder is caught. And the
 * server's refusals of Try again are the very keys the step looks up, so a
 * reworded refusal never reaches a reader in English.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
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

const SIGNALS: Array<RemediationTryAgainSignal> = ["incident", "alert"];

const REFUSALS: Array<RemediationTryAgainRefusal> = Object.values(
  RemediationTryAgainResult,
).filter((result: RemediationTryAgainResult): boolean => {
  return result !== RemediationTryAgainResult.Evaluated;
}) as Array<RemediationTryAgainRefusal>;

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const ENGLISH: Record<string, string> = readLocale("en");

// Every sentence and label the two steps added, by the key they are looked up with.
const WORDS: Array<string> = Array.from(
  new Set<string>([
    AI_CARD_DESCRIPTION,
    INVESTIGATION_STEP_TITLE,
    INVESTIGATION_STEP_STATUS_LABEL,
    SHOW_FULL_REPORT,
    HIDE_FULL_REPORT,
    REMEDIATION_STEP_TITLE,
    REMEDIATION_STEP_STATUS_LABEL,
    REMEDIATION_TRY_AGAIN_BUTTON,
    REMEDIATION_TRY_AGAIN_FAILED,
    "Checking what OneUptime AI did to fix this…",
    ...Object.values(REMEDIATION_STEP_STATUS_TEXT),
    ...Object.values(REMEDIATION_CODE_FIX_COPY),
    ...SIGNALS.flatMap((signal: RemediationTryAgainSignal): Array<string> => {
      return [
        REMEDIATION_STEP_WAITING[signal],
        REMEDIATION_STEP_NOT_TRIED[signal],
        REMEDIATION_TRY_AGAIN_HINT[signal],
        TURN_ON_FIXING_LINKS[signal],
        ...REFUSALS.map((refusal: RemediationTryAgainRefusal): string => {
          return REMEDIATION_TRY_AGAIN_REFUSAL_KEYS[refusal][signal];
        }),
        ...Object.values(REMEDIATION_CODE_FIX_AUTOMATIC_REASONS).flatMap(
          (
            reasons: Record<RemediationTryAgainSignal, string> | null,
          ): Array<string> => {
            return reasons ? [reasons[signal]] : [];
          },
        ),
      ];
    }),
    /*
     * A fix folded to its sentence, and what opens it (#5413's UI review),
     * and what to do under a cluster's or resource's Fixes off, and a
     * resolved record's monitor line.
     */
    REMEDIATION_FIX_REVIEW_AND_APPROVE,
    REMEDIATION_FIX_SHOW_DETAILS,
    REMEDIATION_FIX_HIDE_DETAILS,
    REMEDIATION_FIX_COMMANDS_SENTENCE.other,
    REMEDIATION_FIX_CHANGES_SENTENCE.other,
    REMEDIATION_FIX_FAILED_COUNT.other,
    TURN_FIXES_ON_WHAT_TO_DO,
    LINK_MONITOR_FOR_NEXT_TIME,
    // A switch that was off when OneUptime AI checked, and is on now.
    "Enable AI was off when OneUptime AI checked this incident. It is on now.",
    "Enable AI was off when OneUptime AI checked this alert. It is on now.",
    '"Fix new incidents automatically" was off when OneUptime AI checked this incident. It is on now.',
    '"Fix new alerts automatically" was off when OneUptime AI checked this alert. It is on now.',
  ]),
);

// The product's name: kept as the locale already has it.
const KEPT_AS_THE_LOCALE_HAS_IT: Array<string> = [AI_CARD_TITLE];

// A word a language spells as English does, as its own word.
const SPELLED_AS_ENGLISH: Readonly<Record<string, ReadonlyArray<string>>> = {
  fr: [INVESTIGATION_STEP_TITLE],
};

const PLACEHOLDER: RegExp = /\{\{[a-zA-Z]+\}\}/g;

function placeholders(text: string): Array<string> {
  return Array.from(new Set(text.match(PLACEHOLDER) || [])).sort();
}

describe("the server's refusals of Try again are the step's keys", () => {
  test.each(
    REFUSALS.flatMap(
      (
        refusal: RemediationTryAgainRefusal,
      ): Array<[RemediationTryAgainRefusal, RemediationTryAgainSignal]> => {
        return SIGNALS.map(
          (
            signal: RemediationTryAgainSignal,
          ): [RemediationTryAgainRefusal, RemediationTryAgainSignal] => {
            return [refusal, signal];
          },
        );
      },
    ),
  )(
    "%s, for an %s",
    (
      refusal: RemediationTryAgainRefusal,
      signal: RemediationTryAgainSignal,
    ) => {
      expect(REMEDIATION_TRY_AGAIN_REFUSAL_KEYS[refusal][signal]).toBe(
        REMEDIATION_TRY_AGAIN_REFUSALS[refusal][signal],
      );
      expect(REMEDIATION_TRY_AGAIN_SERVER_SENTENCES).toBe(
        REMEDIATION_TRY_AGAIN_REFUSALS,
      );
    },
  );
});

describe("English holds every word under its own key", () => {
  test("there is something to check", () => {
    expect(WORDS.length).toBeGreaterThan(60);
  });

  test.each([...WORDS, ...KEPT_AS_THE_LOCALE_HAS_IT])("%s", (word: string) => {
    expect(ENGLISH[word]).toBe(word);
  });
});

describe.each(LANGUAGES)("the %s locale", (language: string) => {
  const words: Record<string, string> = readLocale(language);

  test.each(WORDS)(
    "words %s its own way, with the same placeholders",
    (word: string) => {
      const translated: string | undefined = words[word];

      expect(translated).toBeDefined();
      expect(translated!.trim().length).toBeGreaterThan(0);
      expect({
        word,
        translated:
          translated !== word ||
          (SPELLED_AS_ENGLISH[language] || []).includes(word),
      }).toEqual({
        word,
        translated: true,
      });
      expect(placeholders(translated!)).toEqual(placeholders(word));
    },
  );

  test.each(KEPT_AS_THE_LOCALE_HAS_IT)("has %s", (word: string) => {
    expect(words[word]).toBeDefined();
    expect(words[word]!.trim().length).toBeGreaterThan(0);
  });

  // The quoted switch names are the AI settings page's own, as it draws them.
  test("the 'on now' lines quote each switch as its settings page names it", () => {
    expect(
      words[
        '"Fix new incidents automatically" was off when OneUptime AI checked this incident. It is on now.'
      ],
    ).toContain(words["Fix new incidents automatically"]!);
    expect(
      words[
        '"Fix new alerts automatically" was off when OneUptime AI checked this alert. It is on now.'
      ],
    ).toContain(words["Fix new alerts automatically"]!);
  });
});

/*
 * A folded fix's counted sentences: each language words the form for one
 * too ("_one"), with the same placeholders. Japanese, Korean and Chinese
 * have no form for one of their own, so theirs is never shown; it is
 * there all the same, as en.json's keys are.
 */
const PLURALS: Array<PluralTemplate> = [
  REMEDIATION_FIX_COMMANDS_SENTENCE,
  REMEDIATION_FIX_CHANGES_SENTENCE,
  REMEDIATION_FIX_FAILED_COUNT,
];

const NO_FORM_FOR_ONE: ReadonlyArray<string> = ["ja", "ko", "zh-CN", "zh-TW"];

describe("a folded fix's counted sentences", () => {
  test.each(PLURALS)(
    "English holds $other and its form for one",
    (plural: PluralTemplate) => {
      expect(ENGLISH[plural.other]).toBe(plural.other);
      expect(ENGLISH[`${plural.other}_one`]).toBe(plural.one);
    },
  );

  test.each(
    LANGUAGES.flatMap((language: string): Array<[string, PluralTemplate]> => {
      return PLURALS.map((plural: PluralTemplate): [string, PluralTemplate] => {
        return [language, plural];
      });
    }),
  )(
    "%s words the form for one of %o",
    (language: string, plural: PluralTemplate) => {
      const words: Record<string, string> = readLocale(language);
      const one: string | undefined = words[`${plural.other}_one`];

      expect(one).toBeDefined();
      expect(placeholders(one!)).toEqual(placeholders(plural.one));

      if (!NO_FORM_FOR_ONE.includes(language)) {
        expect(one).not.toBe(plural.one);
      }
    },
  );
});

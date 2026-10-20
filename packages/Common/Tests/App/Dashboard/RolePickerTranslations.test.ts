import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ROLE_AREAS,
  ROLE_LEVEL_TITLES,
  ROLE_REACH_TITLES,
  RoleArea,
  RoleLevel,
  RoleReach,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Permission/RoleCatalog";
import {
  ROLE_LEVEL_SEARCH_WORDS,
  ROLE_PICKER_FIELD_TITLE,
  ROLE_PICKER_LEVEL_LABEL,
  ROLE_PICKER_PICK_AN_AREA,
  ROLE_PICKER_PICK_AN_AREA_HINT,
  ROLE_PICKER_SEARCH_PLACEHOLDER,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Permission/RolePickerOptions";
import { ROLE_CARD_SUMMARIES } from "../../../../App/FeatureSet/Dashboard/src/Components/Permission/RoleCardSelectOptions";
import Permission from "../../../Types/Permission";

/*
 * THE ROLE PICKER IN THE DASHBOARD'S SIXTEEN OTHER LANGUAGES: every word the
 * Add a Role dialog draws - the two answers, the twelve areas, the three
 * levels, the words under the tiles, the search box and its empty state, and
 * every role's one line - read from the modules that draw them, so a word
 * added there later is held here too.
 *
 * Beyond being translated, the words must agree with each other: the line
 * under the tiles names the levels as the level switch shows them ("Dann
 * Administrator, Mitglied oder Betrachter wählen." beside Administrator |
 * Mitglied | Betrachter), and "Pick an area" says area with the word the One
 * area switch uses.
 */

const LOCALES: string = path.resolve(
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

const SENTENCE_ENDINGS: Array<string> = [".", "。", "।"];

/*
 * Words a language writes as English does: the product names the
 * translators kept ("Runbooks"), and what is the same word ("Incidents" in
 * French, "Workflows" in Dutch).
 */
const SAME_IN_EVERY_LANGUAGE: Array<string> = ["Runbooks"];

const SAME_IN_LANGUAGE: Record<string, Array<string>> = {
  fr: ["Incidents"],
  nl: ["Workflows"],
};

function locale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

// Everything the picker draws, as English keys.
const PICKER_WORDS: Array<string> = Array.from(
  new Set<string>([
    ...Object.values(ROLE_REACH_TITLES),
    ...Object.values(ROLE_LEVEL_TITLES),
    ...ROLE_AREAS.map((area: RoleArea): string => {
      return area.title;
    }),
    ROLE_PICKER_FIELD_TITLE,
    ROLE_PICKER_LEVEL_LABEL,
    ROLE_PICKER_PICK_AN_AREA,
    ROLE_PICKER_PICK_AN_AREA_HINT,
    ROLE_PICKER_SEARCH_PLACEHOLDER,
    ...ROLE_LEVEL_SEARCH_WORDS[RoleLevel.Viewer],
    // The search's empty state, worded once for every picker.
    "Nothing matches every word you typed.",
    "Clear search",
    ...(Object.values(ROLE_CARD_SUMMARIES) as Array<string>),
  ]),
);

// The word each language's One area and Pick an area share.
const AREA_WORD: Record<string, string> = {
  de: "Bereich",
  fr: "domaine",
  es: "área",
  it: "area",
  pt: "área",
  nl: "onderdeel",
  da: "område",
  no: "område",
  sv: "område",
  ru: "раздел",
  ja: "領域",
  ko: "영역",
  "zh-CN": "模块",
  "zh-TW": "模組",
  hi: "क्षेत्र",
  fa: "بخش",
};

describe("the role picker's words", () => {
  test("are read from the modules that draw them", () => {
    // Twelve areas, three levels, two answers, the picker's own and the lines.
    expect(PICKER_WORDS.length).toBeGreaterThan(60);
  });

  test("English keys every one as itself", () => {
    const english: Record<string, string> = locale("en");

    expect(
      PICKER_WORDS.filter((text: string): boolean => {
        return english[text] !== text;
      }),
    ).toEqual([]);
  });

  test.each(LANGUAGES)(
    "%s words every one in its language",
    (language: string) => {
      const words: Record<string, string> = locale(language);
      const problems: Array<string> = [];

      for (const text of PICKER_WORDS) {
        const value: string | undefined = words[text];

        if (!value || !value.trim()) {
          problems.push(`missing: ${text}`);
          continue;
        }

        if (
          value === text &&
          !SAME_IN_EVERY_LANGUAGE.includes(text) &&
          !(SAME_IN_LANGUAGE[language] || []).includes(text)
        ) {
          problems.push(`left in English: ${text}`);
          continue;
        }

        const isSentence: boolean = text.endsWith(".");
        const endsLikeSentence: boolean = SENTENCE_ENDINGS.some(
          (ending: string): boolean => {
            return value.trim().endsWith(ending);
          },
        );

        if (isSentence !== endsLikeSentence) {
          problems.push(`punctuation differs: ${text}`);
        }
      }

      expect(problems).toEqual([]);
    },
  );

  test.each(LANGUAGES)(
    "%s: the words this dialog added are its own, never English",
    (language: string) => {
      const words: Record<string, string> = locale(language);

      for (const text of [
        ROLE_REACH_TITLES[RoleReach.WholeProject],
        ROLE_REACH_TITLES[RoleReach.OneArea],
        ROLE_LEVEL_TITLES[RoleLevel.Admin],
        ROLE_PICKER_PICK_AN_AREA,
        ROLE_PICKER_PICK_AN_AREA_HINT,
        ROLE_PICKER_LEVEL_LABEL,
      ]) {
        expect({ text, translated: words[text] !== text }).toEqual({
          text,
          translated: true,
        });
      }
    },
  );

  test.each(LANGUAGES)(
    "%s: the line under the tiles names the levels as the level switch shows them",
    (language: string) => {
      const words: Record<string, string> = locale(language);
      const hint: string = words[ROLE_PICKER_PICK_AN_AREA_HINT] as string;

      for (const level of [
        RoleLevel.Admin,
        RoleLevel.Member,
        RoleLevel.Viewer,
      ]) {
        const shown: string = words[ROLE_LEVEL_TITLES[level]] as string;

        expect({ level, shown, inHint: hint.includes(shown) }).toEqual({
          level,
          shown,
          inHint: true,
        });
      }
    },
  );

  test.each(LANGUAGES)(
    "%s: Pick an area says area as One area does",
    (language: string) => {
      const words: Record<string, string> = locale(language);
      const area: string = AREA_WORD[language] as string;

      expect(words[ROLE_REACH_TITLES[RoleReach.OneArea]]).toContain(area);
      expect(words[ROLE_PICKER_PICK_AN_AREA]).toContain(area);
    },
  );

  test("Spanish speaks to the reader as tú, as the Dashboard does", () => {
    const spanish: Record<string, string> = locale("es");

    expect(spanish[ROLE_PICKER_PICK_AN_AREA]).toBe("Elige un área");
    expect(spanish[ROLE_PICKER_PICK_AN_AREA_HINT]).toContain("elige");
    expect(spanish[ROLE_PICKER_PICK_AN_AREA_HINT]).not.toContain("elija");
  });

  test("the two roles that grant the same keep the same line in every language", () => {
    for (const language of LANGUAGES) {
      const words: Record<string, string> = locale(language);

      expect(
        words[ROLE_CARD_SUMMARIES[Permission.StatusPageMember] as string],
      ).toBe(words[ROLE_CARD_SUMMARIES[Permission.StatusPageAdmin] as string]);
    }
  });
});

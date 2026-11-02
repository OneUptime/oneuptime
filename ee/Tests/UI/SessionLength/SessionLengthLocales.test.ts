import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import SessionLengthCopy, {
  getDurationLabel,
  getIdleChoices,
  getLengthChoices,
  SESSION_LENGTH_SIGNS_OUT,
  SessionLengthChoice,
} from "../../../AdminDashboard/SessionLength/SessionLengthCopy";
import { SESSION_LENGTH_SETTINGS_PAGE_TITLE } from "../../../AdminDashboard/SessionLength/SessionLengthPaths";
import { getEnterpriseSettingNoticeCopy } from "../../../Dashboard/EnterpriseSettings/EnterpriseSettingLicenseNotice";
import {
  EnterpriseLicenseMode,
  LicensedFeature,
} from "../../../Dashboard/Identity/License/EnterpriseLicenseMode";
import { FOLDED_SECTION_ON } from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { PluralTemplate } from "Common/UI/Utils/TranslateTemplate";

/*
 * Every word the Session Length page shows is in the Admin Dashboard's
 * locale files, in every language: its copy, every length it offers ("1
 * hour", "{{count}} days"...), the sentence that changes with how many
 * people a change signs out (the "other" sentence as the key, the one form
 * under key_one), and what the license notice says above it.
 *
 * A translation keeps the English placeholders and differs from the
 * English, except the few words a language writes as English does.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "App",
  "FeatureSet",
  "AdminDashboard",
  "src",
  "Locales",
);

const LOCALES: Array<string> = [
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

// Languages with no "one" form: their key_one is never read.
const WITHOUT_ONE_FORM: ReadonlySet<string> = new Set<string>([
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
]);

// What some languages write as English does.
const MAY_READ_AS_ENGLISH: ReadonlySet<string> = new Set<string>([
  "Save",
  FOLDED_SECTION_ON,
  // French.
  "{{count}} minutes",
]);

const PLACEHOLDER: RegExp = /\{\{\w+\}\}/g;

function placeholdersOf(text: string): Array<string> {
  return (text.match(PLACEHOLDER) || []).sort();
}

function choiceLabels(choices: Array<SessionLengthChoice>): Array<string> {
  return choices.map((choice: SessionLengthChoice): string => {
    return choice.label;
  });
}

function noticeStrings(): Array<string> {
  const strings: Array<string> = [];

  for (const mode of [
    EnterpriseLicenseMode.ReadOnly,
    EnterpriseLicenseMode.NotIncluded,
    EnterpriseLicenseMode.Grace,
  ]) {
    const copy: { title: string } | null = getEnterpriseSettingNoticeCopy(
      mode,
      LicensedFeature.SessionLength,
    );

    if (copy) {
      strings.push(copy.title);
    }
  }

  return strings;
}

function pageStrings(): Array<string> {
  return Array.from(
    new Set<string>([
      ...Object.values(SessionLengthCopy),
      ...choiceLabels(getLengthChoices(null)),
      ...choiceLabels(getIdleChoices(null)),
      getDurationLabel(45).label,
      SESSION_LENGTH_SETTINGS_PAGE_TITLE,
      FOLDED_SECTION_ON,
      ...noticeStrings(),
    ]),
  );
}

function plurals(): Array<PluralTemplate> {
  return [SESSION_LENGTH_SIGNS_OUT];
}

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

describe("the Session Length page's words", () => {
  test("are read from the copy (the scan is not empty)", () => {
    expect(pageStrings().length).toBeGreaterThan(25);
    expect(pageStrings()).toEqual(
      expect.arrayContaining([
        "1 hour",
        "1 day",
        "{{count}} hours",
        "{{count}} days",
        "{{count}} minutes",
        "No limit",
      ]),
    );
  });

  test("are keys of the Admin Dashboard's English locale, mapping to themselves", () => {
    const english: Record<string, unknown> = readLocale("en");

    expect(
      pageStrings().filter((text: string): boolean => {
        return english[text] !== text;
      }),
    ).toEqual([]);
  });

  test("the count sentence is in English under its other sentence, with its one form beside it", () => {
    const english: Record<string, unknown> = readLocale("en");

    for (const plural of plurals()) {
      expect(plural.other).toContain("{{count}}");
      expect(plural.one).toContain("{{count}}");
      expect(english[plural.other]).toBe(plural.other);
      expect(english[`${plural.other}_one`]).toBe(plural.one);
    }
  });

  test.each(LOCALES)(
    "are translated in the %s locale, with the English placeholders",
    (locale: string) => {
      const translations: Record<string, unknown> = readLocale(locale);
      const problems: Array<string> = [];

      const check: (
        key: string,
        english: string,
        isOneForm: boolean,
      ) => void = (key: string, english: string, isOneForm: boolean): void => {
        const translated: unknown = translations[key];

        if (typeof translated !== "string" || translated.trim() === "") {
          problems.push(`missing: ${key}`);
          return;
        }

        if (
          translated === english &&
          !MAY_READ_AS_ENGLISH.has(english) &&
          !(isOneForm && WITHOUT_ONE_FORM.has(locale))
        ) {
          problems.push(`still English: ${key}`);
        }

        if (
          JSON.stringify(placeholdersOf(translated)) !==
          JSON.stringify(placeholdersOf(english))
        ) {
          problems.push(`placeholders: ${key}`);
        }
      };

      for (const text of pageStrings()) {
        check(text, text, false);
      }

      for (const plural of plurals()) {
        check(plural.other, plural.other, false);
        check(`${plural.other}_one`, plural.one, true);
      }

      expect(problems).toEqual([]);
    },
  );
});

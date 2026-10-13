/*
 * The workflow builder's new words, in every dashboard language: the Run
 * panel's record search and confirmation, the two field lists (Fields to
 * watch, Fields to pass on) and their Add field list, the value picker's
 * steps that are not available here and fields that are empty here, the
 * notes that offer a test run while the workflow is off, and If / Else's
 * comparisons.
 *
 * The dashboard looks each sentence up by its English text, and a sentence
 * with no entry silently stays English - so every one of them is held to
 * all seventeen locale files here, each plural in both its forms.
 */

jest.mock("../../../../Models/DatabaseModels/Index", () => {
  return { __esModule: true, default: [] };
});

import { AddFieldsPanelCopy } from "../../../../UI/Components/Workflow/FieldPicker/AddFieldsPanel";
import { FieldPickerOptionsCopy } from "../../../../UI/Components/Workflow/FieldPicker/FieldPickerOptions";
import { ModelFieldPickerCopy } from "../../../../UI/Components/Workflow/ModelFieldPicker";
import {
  RUN_WORKFLOW_SUBMIT_TITLE,
  RunFormCopy,
} from "../../../../UI/Components/Workflow/RunForm";
import { RunModalCopy } from "../../../../UI/Components/Workflow/RunModal";
import { RunRecordFieldCopy } from "../../../../UI/Components/Workflow/RunRecordField";
import { StepSampleCopy } from "../../../../UI/Components/Workflow/ValuePicker/StepSampleSource";
import { StepValueCopy } from "../../../../UI/Components/Workflow/ValuePicker/StepValueSource";
import { ValuePickerMenuCopy } from "../../../../UI/Components/Workflow/ValuePicker/ValuePickerMenu";
import { CONDITION_CATALOG_WORDS } from "../../../../UI/Components/Workflow/Condition/ConditionModel";
import { PluralTemplate } from "../../../../UI/Utils/TranslateTemplate";
import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const PROGRESS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "i18n",
  "Progress",
);

const OTHER_LOCALES: Array<string> = [
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

// Languages with no "one" form, whose `_one` keys are never read.
const NO_ONE_FORM: Array<string> = ["ja", "ko", "zh-CN", "zh-TW"];

type ReadJsonFunction = (file: string) => Record<string, unknown>;

const readJson: ReadJsonFunction = (file: string): Record<string, unknown> => {
  return JSON.parse(fs.readFileSync(file, "utf8"));
};

type ReadLocaleFunction = (locale: string) => Record<string, string>;

const readLocale: ReadLocaleFunction = (
  locale: string,
): Record<string, string> => {
  return readJson(path.join(LOCALES_DIR, `${locale}.json`)) as Record<
    string,
    string
  >;
};

type SameAsEnglishFunction = (locale: string) => Array<string>;

// What a language writes as English does (i18n/Progress/<code>.json).
const sameAsEnglish: SameAsEnglishFunction = (
  locale: string,
): Array<string> => {
  return (
    (readJson(path.join(PROGRESS_DIR, `${locale}.json`))[
      "sameAsEnglish"
    ] as Array<string>) || []
  );
};

const GLOBAL_SAME_AS_ENGLISH: Array<string> = JSON.parse(
  fs.readFileSync(path.join(PROGRESS_DIR, "..", "SameAsEnglish.json"), "utf8"),
) as Array<string>;

type IsPluralFunction = (value: unknown) => value is PluralTemplate;

const isPlural: IsPluralFunction = (
  value: unknown,
): value is PluralTemplate => {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PluralTemplate).one === "string" &&
    typeof (value as PluralTemplate).other === "string"
  );
};

/*
 * The keys a copy object's values are looked up by: a sentence's English,
 * or a plural's general form and its "_one" form.
 */
type KeysOfFunction = (copy: Record<string, unknown>) => Array<string>;

const keysOf: KeysOfFunction = (
  copy: Record<string, unknown>,
): Array<string> => {
  return Object.values(copy).flatMap((value: unknown): Array<string> => {
    if (isPlural(value)) {
      return [value.other, `${value.other}_one`];
    }

    return typeof value === "string" ? [value] : [];
  });
};

/*
 * StepSampleCopy.partial is added to a sentence built from pieces (where a
 * value came from, and when), which is looked up as a whole elsewhere.
 */
const { partial: _partial, ...STEP_SAMPLE_SENTENCES } = StepSampleCopy;

const SCREENS: Array<{ name: string; keys: Array<string> }> = [
  {
    name: "the Run panel",
    keys: [
      ...keysOf(RunModalCopy),
      ...keysOf(RunFormCopy),
      ...keysOf(RunRecordFieldCopy),
      RUN_WORKFLOW_SUBMIT_TITLE,
    ],
  },
  {
    name: "the field lists",
    keys: [
      ...keysOf(ModelFieldPickerCopy),
      ...keysOf(AddFieldsPanelCopy),
      ...keysOf(FieldPickerOptionsCopy),
    ],
  },
  {
    name: "the value picker",
    keys: [
      ...keysOf(StepValueCopy),
      ...keysOf(STEP_SAMPLE_SENTENCES),
      ...keysOf(ValuePickerMenuCopy),
    ],
  },
  {
    name: "If / Else",
    keys: [...CONDITION_CATALOG_WORDS],
  },
];

const ENGLISH: Record<string, string> = readLocale("en");

describe("the workflow builder's words in every dashboard language", () => {
  test("the screens' words were found, so the checks below are not vacuous", () => {
    for (const screen of SCREENS) {
      expect({ screen: screen.name, some: screen.keys.length > 5 }).toEqual({
        screen: screen.name,
        some: true,
      });
    }

    expect(SCREENS[0]!.keys).toContain("Run this workflow now?");
    expect(SCREENS[1]!.keys).toContain("{{count}} fields_one");
    expect(SCREENS[2]!.keys).toContain(
      "{{count}} steps aren't available here_one",
    );
    expect(SCREENS[3]!.keys).toContain("is equal to");
  });

  test.each(SCREENS)(
    "$name: English has every key",
    (screen: { name: string; keys: Array<string> }) => {
      for (const key of screen.keys) {
        expect({ key, english: typeof ENGLISH[key] }).toEqual({
          key,
          english: "string",
        });
      }
    },
  );

  test.each(OTHER_LOCALES)(
    "%s translates every one of them",
    (locale: string) => {
      const translations: Record<string, string> = readLocale(locale);
      const same: Array<string> = [
        ...GLOBAL_SAME_AS_ENGLISH,
        ...sameAsEnglish(locale),
      ];

      for (const screen of SCREENS) {
        for (const key of screen.keys) {
          const translated: string | undefined = translations[key];

          expect({ locale, key, has: typeof translated === "string" }).toEqual({
            locale,
            key,
            has: true,
          });

          if (key.endsWith("_one") && NO_ONE_FORM.includes(locale)) {
            continue;
          }

          const isLeftInEnglish: boolean =
            translated === ENGLISH[key] && !same.includes(ENGLISH[key]!);

          expect({ locale, key, isLeftInEnglish }).toEqual({
            locale,
            key,
            isLeftInEnglish: false,
          });
        }
      }
    },
  );

  test.each(OTHER_LOCALES)(
    "%s keeps every {{placeholder}} of the English",
    (locale: string) => {
      const translations: Record<string, string> = readLocale(locale);
      const placeholders: (text: string) => Array<string> = (
        text: string,
      ): Array<string> => {
        return (text.match(/\{\{[^}]*\}\}/g) || []).sort();
      };

      for (const screen of SCREENS) {
        for (const key of screen.keys) {
          expect({
            locale,
            key,
            placeholders: placeholders(translations[key] || ""),
          }).toEqual({
            locale,
            key,
            placeholders: placeholders(ENGLISH[key] || ""),
          });
        }
      }
    },
  );

  test("a record's type is a noun in every language, not the verb to record", () => {
    // "Record" was the verb in German and Spanish, which the badge is not.
    expect(readLocale("de")["Record"]).toBe("Datensatz");
    expect(readLocale("es")["Record"]).toBe("Registro");
  });
});

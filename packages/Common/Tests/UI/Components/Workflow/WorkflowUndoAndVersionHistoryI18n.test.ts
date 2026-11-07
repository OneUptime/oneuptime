/*
 * Undo, Redo and the Version history in every dashboard language (issue
 * #6188): every sentence the toolbar's Undo and Redo say, the save pill's
 * Try again, and the Version history's panel and preview - and, when
 * someone else saved the workflow first (issue #6257), the dialog that asks
 * whose version to keep and the save pill meanwhile.
 *
 * The dashboard looks each sentence up by its English text, and a sentence
 * with no entry silently stays English - so every one of them is held to all
 * seventeen locale files here, each plural in both its forms, with the
 * English {{placeholders}}.
 */

jest.mock("../../../../Models/DatabaseModels/Index", () => {
  return { __esModule: true, default: [] };
});

import {
  WorkflowRedoCopy,
  WorkflowUndoCopy,
} from "../../../../UI/Components/Workflow/WorkflowHistoryLabels";
import { WorkflowVersionCopy } from "../../../../UI/Components/Workflow/WorkflowVersionPresentation";
import {
  WorkflowSaveState,
  WorkflowStatusBarCopy,
  getWorkflowSaveStatePresentation,
} from "../../../../UI/Components/Workflow/WorkflowStatusBar";
import { WorkflowSaveConflictCopy } from "../../../../UI/Components/Workflow/WorkflowSaveConflict";
import { WorkflowUndoRedoCopy } from "../../../../UI/Components/Workflow/WorkflowUndoRedoButtons";
import { WorkflowVersionPreviewCopy } from "../../../../UI/Components/Workflow/WorkflowVersionPreview";
import { PluralTemplate } from "../../../../UI/Utils/TranslateTemplate";
import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

const COMMON_DIR: string = path.join(__dirname, "..", "..", "..", "..");

const LOCALES_DIR: string = path.join(
  COMMON_DIR,
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const PROGRESS_DIR: string = path.join(
  COMMON_DIR,
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

const readJson: (file: string) => Record<string, unknown> = (
  file: string,
): Record<string, unknown> => {
  return JSON.parse(fs.readFileSync(file, "utf8"));
};

const readLocale: (locale: string) => Record<string, string> = (
  locale: string,
): Record<string, string> => {
  return readJson(path.join(LOCALES_DIR, `${locale}.json`)) as Record<
    string,
    string
  >;
};

const sameAsEnglish: (locale: string) => Array<string> = (
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

const isPlural: (value: unknown) => value is PluralTemplate = (
  value: unknown,
): value is PluralTemplate => {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PluralTemplate).one === "string" &&
    typeof (value as PluralTemplate).other === "string"
  );
};

// The keys a copy object's values are looked up by.
const keysOf: (copy: Record<string, unknown>) => Array<string> = (
  copy: Record<string, unknown>,
): Array<string> => {
  return Object.values(copy).flatMap((value: unknown): Array<string> => {
    if (isPlural(value)) {
      return [value.other, `${value.other}_one`];
    }

    return typeof value === "string" ? [value] : [];
  });
};

const KEYS: Array<string> = Array.from(
  new Set<string>([
    ...keysOf(WorkflowUndoCopy as unknown as Record<string, unknown>),
    ...keysOf(WorkflowRedoCopy as unknown as Record<string, unknown>),
    ...keysOf(WorkflowVersionCopy as unknown as Record<string, unknown>),
    ...keysOf(WorkflowUndoRedoCopy as unknown as Record<string, unknown>),
    ...keysOf(WorkflowVersionPreviewCopy as unknown as Record<string, unknown>),
    ...keysOf(WorkflowStatusBarCopy as unknown as Record<string, unknown>),
    ...keysOf(WorkflowSaveConflictCopy as unknown as Record<string, unknown>),
    getWorkflowSaveStatePresentation(WorkflowSaveState.Conflict).label,
  ]),
);

const ENGLISH: Record<string, string> = readLocale("en");

describe("Undo, Redo and the Version history in every dashboard language", () => {
  test("the words were found, so the checks below are not vacuous", () => {
    expect(KEYS.length).toBeGreaterThan(50);
    expect(KEYS).toContain("Undo deleting {{step}}");
    expect(KEYS).toContain("Redo {{count}} changes_one");
    expect(KEYS).toContain("Restore this version");
    expect(KEYS).toContain("Undo and redo");
    expect(KEYS).toContain(
      "This version cannot be shown: it has a step OneUptime no longer has.",
    );
    expect(KEYS).toContain(
      "Save the workflow again. Your changes stay on the canvas until it is saved.",
    );
    expect(KEYS).toContain("Someone else changed this workflow");
    expect(KEYS).toContain("Keep mine");
    expect(KEYS).toContain("Undo showing their changes");
    expect(KEYS).toContain("Not saved");
  });

  test("English has every key", () => {
    for (const key of KEYS) {
      expect({ key, english: typeof ENGLISH[key] }).toEqual({
        key,
        english: "string",
      });
    }
  });

  test.each(OTHER_LOCALES)(
    "%s translates every one of them",
    (locale: string) => {
      const translations: Record<string, string> = readLocale(locale);
      const same: Array<string> = [
        ...GLOBAL_SAME_AS_ENGLISH,
        ...sameAsEnglish(locale),
      ];

      for (const key of KEYS) {
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

      for (const key of KEYS) {
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
    },
  );

  test.each(OTHER_LOCALES)(
    "%s words Undo and Redo apart in every sentence",
    (locale: string) => {
      const translations: Record<string, string> = readLocale(locale);
      const undo: Array<string> = keysOf(
        WorkflowUndoCopy as unknown as Record<string, unknown>,
      );
      const redo: Array<string> = keysOf(
        WorkflowRedoCopy as unknown as Record<string, unknown>,
      );

      undo.forEach((key: string, index: number) => {
        const redoKey: string = redo[index] as string;

        if (key.endsWith("_one") && NO_ONE_FORM.includes(locale)) {
          return;
        }

        expect({
          locale,
          key,
          apart: translations[key] !== translations[redoKey],
        }).toEqual({
          locale,
          key,
          apart: true,
        });
      });
    },
  );
});

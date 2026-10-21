import {
  ARCHIVABLE_VALUE_COPY,
  ARCHIVE_LOCKED_REASONS,
  getArchivableValueStrings,
  getServerArchiveLockedReasons,
} from "../../FeatureSet/Dashboard/src/Components/ArchivableValue/ArchivableValueCopy";
import { ArchivableValueType } from "Common/Utils/ArchivableValues";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Archive and Unarchive on the eight settings pages of the values records
 * pick from - Incident State, Incident Severity, Alert State, Alert
 * Severity, Monitor Status, Event State, Labels, Incident Roles - say what
 * archiving does, what an archived value is, why a value can never be
 * archived and what deleting one would do. Every word is looked up in the
 * Dashboard locale files by its English text, so a string no locale carries
 * stays English for everyone. This holds every one of them to all seventeen
 * locales, translated, and the reasons the dashboard words to the reasons
 * the server gives.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");
const I18N_DIR: string = path.join(DASHBOARD_SRC, "..", "i18n");

const PLACEHOLDER: RegExp = /\{\{[^}]+\}\}/g;

const SENTENCE_ENDINGS: Array<string> = [".", "。", "।"];
const QUESTION_ENDINGS: Array<string> = ["?", "？", "؟"];
const COLON_ENDINGS: Array<string> = [":", "："];

const readLocale: (file: string) => Record<string, unknown> = (
  file: string,
): Record<string, unknown> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
  ) as Record<string, unknown>;
};

const LOCALE_FILES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json");
  })
  .sort();

const NON_ENGLISH_FILES: Array<string> = LOCALE_FILES.filter(
  (file: string): boolean => {
    return file !== "en.json";
  },
);

const readSameAsEnglish: (file: string) => Set<string> = (
  file: string,
): Set<string> => {
  const global: Array<string> = JSON.parse(
    fs.readFileSync(path.join(I18N_DIR, "SameAsEnglish.json"), "utf8"),
  ) as Array<string>;

  const progressFile: string = path.join(I18N_DIR, "Progress", file);

  const own: Array<string> = fs.existsSync(progressFile)
    ? (
        JSON.parse(fs.readFileSync(progressFile, "utf8")) as {
          sameAsEnglish?: Array<string>;
        }
      ).sameAsEnglish || []
    : [];

  return new Set<string>([...global, ...own]);
};

const endsWithOneOf: (value: string, endings: Array<string>) => boolean = (
  value: string,
  endings: Array<string>,
): boolean => {
  return endings.some((ending: string): boolean => {
    return value.trim().endsWith(ending);
  });
};

// Text with letters in it: "{{count}}+" reads the same everywhere.
const LETTER: RegExp = /\p{L}/u;

const hasWords: (text: string) => boolean = (text: string): boolean => {
  return LETTER.test(text.replace(PLACEHOLDER, ""));
};

// Under an archived role a person still holds, in the role picker.
const ROLE_NOTE: string =
  "This role is archived: the people who hold it keep it, and nobody new can be given it.";

const ROLE_PICKER_FILE: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "Incident",
  "IncidentRoleFormField.tsx",
);

const STRINGS: Array<string> = [...getArchivableValueStrings(), ROLE_NOTE];

describe("the archive strings of the value settings pages", () => {
  test("seventeen locales are checked", () => {
    expect(LOCALE_FILES).toHaveLength(17);
    expect(LOCALE_FILES).toContain("en.json");
  });

  test("the role picker draws its archived-role note as one whole string", () => {
    expect(
      fs.readFileSync(ROLE_PICKER_FILE, "utf8").replace(/\s+/g, " "),
    ).toContain(`translationKey( "${ROLE_NOTE}", )`);
  });

  test("every value has its own words", () => {
    expect(Object.keys(ARCHIVABLE_VALUE_COPY).sort()).toEqual(
      Object.values(ArchivableValueType).sort(),
    );

    const titles: Set<string> = new Set<string>();

    for (const copy of Object.values(ARCHIVABLE_VALUE_COPY)) {
      expect(
        copy.archiveMessage.endsWith("You can unarchive it at any time."),
      ).toBe(true);
      expect(copy.archivedTitle.startsWith("Archived ")).toBe(true);
      expect(copy.archivedDescription.trim().length).toBeGreaterThan(0);
      titles.add(copy.archivedTitle);
    }

    expect(titles.size).toBe(Object.keys(ARCHIVABLE_VALUE_COPY).length);
  });

  test("the reasons a value can't be archived are the server's, every one", () => {
    expect([...ARCHIVE_LOCKED_REASONS].sort()).toEqual(
      getServerArchiveLockedReasons().sort(),
    );
  });

  test("English carries every string as itself", () => {
    const english: Record<string, unknown> = readLocale("en.json");

    expect(
      STRINGS.filter((text: string): boolean => {
        return english[text] !== text;
      }),
    ).toEqual([]);
  });

  test.each(NON_ENGLISH_FILES)(
    "%s translates every string, keeping its placeholders and its ending",
    (file: string) => {
      const locale: Record<string, unknown> = readLocale(file);
      const sameAsEnglish: Set<string> = readSameAsEnglish(file);

      const problems: Array<string> = STRINGS.flatMap(
        (text: string): Array<string> => {
          const value: unknown = locale[text];

          if (typeof value !== "string" || value.trim().length === 0) {
            return [`missing: ${text}`];
          }

          if (value === text && hasWords(text) && !sameAsEnglish.has(text)) {
            return [`left in English: ${text}`];
          }

          const placeholders: string = (text.match(PLACEHOLDER) || [])
            .sort()
            .join(",");

          if (
            (value.match(PLACEHOLDER) || []).sort().join(",") !== placeholders
          ) {
            return [`placeholders changed: ${text}`];
          }

          if (text.endsWith(".") && !endsWithOneOf(value, SENTENCE_ENDINGS)) {
            return [`not a sentence: ${text}`];
          }

          if (text.endsWith("?") && !endsWithOneOf(value, QUESTION_ENDINGS)) {
            return [`not a question: ${text}`];
          }

          if (text.endsWith(":") && !endsWithOneOf(value, COLON_ENDINGS)) {
            return [`no colon before its list: ${text}`];
          }

          return [];
        },
      );

      expect(problems).toEqual([]);
    },
  );
});

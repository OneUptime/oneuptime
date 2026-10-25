import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  BACKUP_FREQUENCY_COPY,
  BACKUP_PLURALS,
  BACKUP_RUN_STATUS_COPY,
  BACKUP_RUN_TRIGGER_COPY,
  BACKUP_STEP_COPY,
  BackupsCopy,
  RESTORE_ISSUE_COPY,
} from "../../../AdminDashboard/Backups/BackupsCopy";
import { BACKUP_TEST_CHECK_TITLES } from "../../../AdminDashboard/Backups/BackupDestinationTestPanel";
import { BACKUPS_SETTINGS_PAGE_TITLE } from "../../../AdminDashboard/Backups/BackupsPaths";
import {
  BackupDestinationCatalog,
  BackupDestinationDefinition,
  BackupDestinationField,
  BackupProviderCatalog,
  BackupProviderDefinition,
} from "Common/Types/Backup/BackupDestinationCatalog";
import { PluralTemplate } from "Common/UI/Utils/TranslateTemplate";

/*
 * Every word the Backups page shows is in the Admin Dashboard's locale
 * files, in every language: its copy, each status, trigger, step,
 * frequency and restore problem, the sentences that change with a count
 * (the "other" sentence as the key, the one form under key_one), and the
 * recommended destinations' own words from the catalog - so a field added
 * there is held here too.
 *
 * A translation keeps the English placeholders and differs from the
 * English - except brand names and the few words a language writes the
 * same ("Backup" in German, "{{size}} in {{duration}}" in Dutch...).
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

// Brands, and what some languages write as English does.
const MAY_READ_AS_ENGLISH: ReadonlySet<string> = new Set<string>([
  "PostgreSQL",
  "ClickHouse",
  "Amazon S3",
  "Cloudflare R2",
  "Backblaze B2",
  "Wasabi",
  "MinIO",
  "Google Cloud Storage",
  "Azure Blob Storage",
  "Azure China",
  "Backups",
  "Backup",
  "Bucket",
  "Region",
  "Container",
  "Cloud",
  "Endpoint",
  "Destination",
  "Connection",
  "Status",
  "Configuration",
  "{{size}} in {{duration}}",
  "{{count}} monitor",
  "{{count}} monitors",
  "{{count}} project",
  "{{count}} file",
]);

const PLACEHOLDER: RegExp = /\{\{\w+\}\}/g;

function placeholdersOf(text: string): Array<string> {
  return (text.match(PLACEHOLDER) || []).sort();
}

function catalogStrings(): Array<string> {
  const strings: Array<string> = [];

  for (const provider of BackupProviderCatalog as Array<BackupProviderDefinition>) {
    strings.push(provider.title, provider.description);

    if (provider.endpointDescription) {
      strings.push(provider.endpointDescription);
    }
  }

  for (const definition of BackupDestinationCatalog as Array<BackupDestinationDefinition>) {
    for (const field of [
      ...definition.configFields,
      ...definition.secretFields,
    ] as Array<BackupDestinationField>) {
      strings.push(field.title, field.description);

      for (const option of field.options || []) {
        strings.push(option.label);
      }
    }
  }

  return strings;
}

function pageStrings(): Array<string> {
  return Array.from(
    new Set<string>([
      ...Object.values(BackupsCopy),
      ...Object.values(BACKUP_RUN_STATUS_COPY).flatMap(
        (copy: { title: string; description: string }) => {
          return [copy.title, copy.description];
        },
      ),
      ...Object.values(BACKUP_RUN_TRIGGER_COPY),
      ...Object.values(BACKUP_STEP_COPY),
      ...Object.values(BACKUP_FREQUENCY_COPY),
      ...Object.values(RESTORE_ISSUE_COPY),
      ...Object.values(BACKUP_TEST_CHECK_TITLES),
      BACKUPS_SETTINGS_PAGE_TITLE,
      ...catalogStrings(),
    ]),
  );
}

function plurals(): Array<PluralTemplate> {
  return Object.values(BACKUP_PLURALS);
}

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

describe("the Backups page's words", () => {
  test("are read from the copy and the catalog (the scan is not empty)", () => {
    expect(pageStrings().length).toBeGreaterThan(200);
    expect(plurals().length).toBe(8);
  });

  test("are keys of the Admin Dashboard's English locale, mapping to themselves", () => {
    const english: Record<string, unknown> = readLocale("en");

    expect(
      pageStrings().filter((text: string): boolean => {
        return english[text] !== text;
      }),
    ).toEqual([]);
  });

  test("each count sentence is in English under its other sentence, with its one form beside it", () => {
    const english: Record<string, unknown> = readLocale("en");

    for (const plural of plurals()) {
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

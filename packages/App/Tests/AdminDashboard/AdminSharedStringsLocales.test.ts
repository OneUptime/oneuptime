import {
  ExtractedString,
  scanSourceText,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE ADMIN DASHBOARD SAYS THE SHARED STRINGS IN THE READER'S LANGUAGE.
 *
 * The Admin Dashboard draws the same lists, rows, dialogs and forms as the
 * Dashboard (Common/UI's ModelTable, Table, Modal, RowActions, Forms ...),
 * and each looks its strings up by their English text in the app's own
 * locale. The Admin locales lacked many of them - the row dialogs' Error and
 * "Something went wrong. Please try again.", the row menu's More actions
 * and "More actions for", the create button's "Add {{itemName}}", the
 * filters, the pagination - so every Admin list read them in English in
 * every language. Each is an entry of all 17 Admin locales now, before the
 * markdownCallouts block as those files keep their flat entries, worded as
 * the same language's Dashboard words it: the two dashboards say a shared
 * string alike.
 *
 * The Custom Channels page (ee/AdminDashboard/CustomChannels) said its own
 * words in English too; they are entries now, and its test dialog's title is
 * one sentence ("Send test: {{name}}").
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");
const FEATURE_SET: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet",
);
const ADMIN_LOCALES: string = path.join(
  FEATURE_SET,
  "AdminDashboard/src/Locales",
);
const DASHBOARD_LOCALES: string = path.join(
  FEATURE_SET,
  "Dashboard/src/Locales",
);

const LANGUAGES: ReadonlyArray<string> = [
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

// The shared components an Admin list, row, dialog and form are drawn with.
const SHARED_COMPONENTS: ReadonlyArray<string> = [
  "ModelTable",
  "Table",
  "Modal",
  "Pagination",
  "Filters",
  "Card",
  "ActionButton",
  "ModelDelete",
  "ErrorMessage",
  "Banner",
  "Detail",
  "Forms",
  "Toggle",
  "Button",
  "Loader",
  "EmptyState",
];

// The row strings every Admin list's dialogs and its row menu draw.
const ROW_STRINGS: ReadonlyArray<string> = [
  "Error",
  "More actions",
  "More actions for",
  "Something went wrong. Please try again.",
];

const CUSTOM_CHANNELS_FILES: ReadonlyArray<string> = [
  "ee/AdminDashboard/CustomChannels/CustomChannelsSettingsPage.tsx",
  "ee/AdminDashboard/CustomChannels/CustomChannelsPaths.ts",
];

// The page's words a translation keeps as written: a name and a URL.
const CUSTOM_CHANNELS_AS_WRITTEN: ReadonlyArray<string> = ["CorpoApp"];

type Locale = Record<string, unknown>;

function readLocale(folder: string, language: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(folder, `${language}.json`), "utf8"),
  ) as Locale;
}

function sourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];
  const walk: (dir: string) => void = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full: string = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        files.push(full);
      }
    }
  };

  walk(directory);

  return files.sort();
}

function stringsOf(files: Array<string>): Array<string> {
  const strings: Set<string> = new Set<string>();

  for (const file of files) {
    const relative: string = path.relative(REPOSITORY_ROOT, file);

    for (const entry of scanSourceText(
      relative,
      fs.readFileSync(file, "utf8"),
      {
        kind: "ui",
      },
    ).strings as Array<ExtractedString>) {
      strings.add(entry.text);
    }
  }

  return Array.from(strings);
}

const SHARED_STRINGS: Array<string> = stringsOf(
  SHARED_COMPONENTS.flatMap((component: string): Array<string> => {
    return sourceFiles(
      path.join(REPOSITORY_ROOT, "packages/Common/UI/Components", component),
    );
  }),
);

const ADMIN_ENGLISH: Locale = readLocale(ADMIN_LOCALES, "en");
const DASHBOARD_ENGLISH: Locale = readLocale(DASHBOARD_LOCALES, "en");

describe("the Admin Dashboard's shared strings", () => {
  test("the row strings come before the markdownCallouts block, in every locale, in the same place", () => {
    const englishKeys: Array<string> = Object.keys(ADMIN_ENGLISH);
    const callouts: number = englishKeys.indexOf("markdownCallouts");

    for (const language of ["en", ...LANGUAGES]) {
      const keys: Array<string> = Object.keys(
        readLocale(ADMIN_LOCALES, language),
      );

      for (const row of ROW_STRINGS) {
        expect({
          language,
          row,
          beforeCallouts:
            keys.indexOf(row) >= 0 &&
            keys.indexOf(row) < keys.indexOf("markdownCallouts"),
          sameSpot: keys.indexOf(row) === englishKeys.indexOf(row),
        }).toEqual({ language, row, beforeCallouts: true, sameSpot: true });
      }
    }

    expect(callouts).toBeGreaterThan(0);
  });

  test("every string the shared lists, rows, dialogs and forms draw has an Admin entry", () => {
    // Many: a scan that read nothing would pass otherwise.
    expect(SHARED_STRINGS.length).toBeGreaterThan(150);

    const missing: Array<string> = SHARED_STRINGS.filter(
      (text: string): boolean => {
        return !(text in ADMIN_ENGLISH);
      },
    );

    // Add each to all 17 Admin locales, worded as the Dashboard words it.
    expect(missing).toEqual([]);
  });

  test.each(LANGUAGES)(
    "%s says the shared strings as its Dashboard does",
    (language: string) => {
      const admin: Locale = readLocale(ADMIN_LOCALES, language);
      const dashboard: Locale = readLocale(DASHBOARD_LOCALES, language);
      const apart: Array<string> = [...SHARED_STRINGS, ...ROW_STRINGS].filter(
        (text: string): boolean => {
          const worded: unknown = dashboard[text];

          return (
            typeof worded === "string" &&
            worded !== DASHBOARD_ENGLISH[text] &&
            admin[text] !== worded
          );
        },
      );

      expect({ language, apart }).toEqual({ language, apart: [] });
    },
  );

  test.each(LANGUAGES)("%s words the row strings", (language: string) => {
    const admin: Locale = readLocale(ADMIN_LOCALES, language);
    // A language that writes a string as English does ("Error" in Spanish).
    const dashboard: Locale = readLocale(DASHBOARD_LOCALES, language);

    for (const row of ROW_STRINGS) {
      expect({
        language,
        row,
        worded: admin[row] !== row || dashboard[row] === row,
      }).toEqual({
        language,
        row,
        worded: true,
      });
    }
  });
});

describe("the Custom Channels page's words", () => {
  const pageStrings: Array<string> = stringsOf(
    CUSTOM_CHANNELS_FILES.map((file: string): string => {
      return path.join(REPOSITORY_ROOT, file);
    }),
  ).filter((text: string): boolean => {
    return !CUSTOM_CHANNELS_AS_WRITTEN.includes(text);
  });

  test("are what the page says, its test dialog's title one sentence", () => {
    const page: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, CUSTOM_CHANNELS_FILES[0] as string),
      "utf8",
    );

    expect(page).toContain('t("Send test: {{name}}", {');
    expect(page).not.toContain("`Send test: ${");
    expect(pageStrings).toEqual(
      expect.arrayContaining([
        "Custom Channels",
        "Send test",
        "What your service receives",
        "Webhook URL",
        "Pages Everyone",
        "Page everyone through this channel",
        "Send test: {{name}}",
        "Custom channel",
      ]),
    );
  });

  test.each(["en", ...LANGUAGES])(
    "%s has an entry for each, and words it",
    (language: string) => {
      const admin: Locale = readLocale(ADMIN_LOCALES, language);
      const missing: Array<string> = pageStrings.filter(
        (text: string): boolean => {
          return typeof admin[text] !== "string";
        },
      );
      const english: Array<string> = pageStrings.filter(
        (text: string): boolean => {
          return (
            language !== "en" &&
            admin[text] === text &&
            // A word some languages write as English does ("Webhook URL").
            readLocale(DASHBOARD_LOCALES, language)[text] !== text
          );
        },
      );

      expect({ language, missing, english }).toEqual({
        language,
        missing: [],
        english: [],
      });
    },
  );
});

// UX rule: Docs/ux/README.md#in-every-language
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { IMPORT_SCREENS, keysOf, SHARED_WITH_ADMIN } from "./ImportScreens";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
  readDashboardSameAsEnglish,
} from "Common/Tests/Helpers/DashboardLocales";

/*
 * THE IMPORT SCREENS, WHOLE, IN EVERY LANGUAGE (#7957).
 *
 * The UI review of #7310 worded every word the import screens draw in
 * Hindi (HindiImportScreensWhole). In the other languages the same screens
 * were still largely English - about a hundred keys each in Italian,
 * Portuguese, Dutch, Danish, Norwegian, Swedish, Russian, Korean and both
 * Chinese, fifty in French, thirty-five in German:
 *
 *   - the label rule import dialog: Validate and preview, Edit JSON,
 *     Download failed rules, Labels to add, the row and paging lines, the
 *     results;
 *   - the CSV upload: Click to upload CSV, {{upload}} or drag and drop,
 *     Expected columns:, the preview line, the row problems and counts;
 *   - the JSON import dialog's code editor: Nothing entered yet., Ln
 *     {{line}}, Col {{column}}, Valid {{language}} · {{count}} lines;
 *   - Network > Settings > Auto Import Rules, its form (Behavior, Include
 *     Ping-Only Hosts, Is Exclusion Rule, Host IP Is In...) and its Dry Run
 *     and Run Now dialog.
 *
 * Every language words them all now, but for a name kept in English on
 * purpose (KEPT_IN_ENGLISH, each with its reason). The Admin Dashboard's
 * JSON import draws the same editor and dialog from its own locale files,
 * worded as the Dashboard words them, and the translated docs name the
 * screens' buttons as each Dashboard draws them.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");
const APP: string = path.join(REPOSITORY_ROOT, "packages", "App");
const DOCS: string = path.join(APP, "FeatureSet", "Docs", "Content");

const SCREEN_KEYS: Array<string> = keysOf(IMPORT_SCREENS);

/*
 * The network's OID collection templates: the network docs of these
 * languages quote the Dashboard's English name in their tables and links
 * ("[OID Collection Template](#...)"), so the field keeps that name until
 * the docs word it.
 */
const QUOTED_IN_ENGLISH_BY_THE_NETWORK_DOCS: string =
  "named in English by this language's network docs";

const OID_TEMPLATE_NAMES: ReadonlyArray<string> = [
  "OID Collection Template",
  "Unnamed OID Collection Template",
];

const OID_TEMPLATES_IN_ENGLISH: ReadonlyArray<string> = [
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
];

// The words a language keeps in English on purpose, each with its reason.
const KEPT_IN_ENGLISH: Record<string, Record<string, string>> = {};

for (const language of OID_TEMPLATES_IN_ENGLISH) {
  KEPT_IN_ENGLISH[language] = {};

  for (const name of OID_TEMPLATE_NAMES) {
    KEPT_IN_ENGLISH[language]![name] = QUOTED_IN_ENGLISH_BY_THE_NETWORK_DOCS;
  }
}

// The screens' keys `language` leaves in English, as npm run i18n:check counts it.
function unworded(language: string): Array<string> {
  const kept: Record<string, string> = KEPT_IN_ENGLISH[language] || {};

  return SCREEN_KEYS.filter((key: string): boolean => {
    return (
      !Object.prototype.hasOwnProperty.call(kept, key) &&
      !isWordedInDashboardLocale(key, language)
    );
  });
}

/*
 * Runs `check` with `language`'s Dashboard words as they are, but `key` put
 * back to its English - the cached file the helpers read, restored after.
 */
function withKeyInEnglish<T>(language: string, key: string, check: () => T): T {
  const words: Record<string, string> = readDashboardLocale(language);
  const worded: string | undefined = words[key];

  words[key] = readDashboardLocale("en")[key] as string;

  try {
    return check();
  } finally {
    words[key] = worded as string;
  }
}

describe("the import screens in every language", () => {
  test("the scan reads each screen's words", () => {
    for (const key of [
      "Validate and preview",
      "Edit JSON",
      "Download failed rules",
      "Nothing entered yet.",
      "Ln {{line}}, Col {{column}}",
      "Click to upload CSV",
      "{{upload}} or drag and drop",
      "Expected columns:",
      "Start Dry Run",
      "Include Ping-Only Hosts",
      "Is Exclusion Rule",
      "Host IP Is In",
    ]) {
      expect({ key, drawn: SCREEN_KEYS.includes(key) }).toEqual({
        key,
        drawn: true,
      });
    }

    expect(SCREEN_KEYS.length).toBeGreaterThan(150);
    expect(DASHBOARD_LANGUAGES.length).toBeGreaterThanOrEqual(17);
  });

  test.each(DASHBOARD_LANGUAGES)(
    "every word the import screens draw is worded in %s",
    (language: string) => {
      expect(unworded(language)).toEqual([]);
    },
  );

  test("a word put back to English is caught, in any language (control)", () => {
    for (const [language, key] of [
      ["it", "Validate and preview"],
      ["it", "Ln {{line}}, Col {{column}}"],
      ["ar", "Click to upload CSV"],
      ["ko", "Start Dry Run"],
      ["de", "{{count}} rules · Page {{page}} of {{pages}}_one"],
    ] as Array<[string, string]>) {
      expect(
        withKeyInEnglish(language, key, () => {
          return unworded(language);
        }),
      ).toEqual([key]);
    }

    expect(unworded("it")).toEqual([]);
  });

  test("each word kept in English is drawn, kept, and quoted so by the docs", () => {
    for (const [language, kept] of Object.entries(KEPT_IN_ENGLISH)) {
      const networkDocs: string = fs.readFileSync(
        path.join(DOCS, language, "monitor", "network-device-monitor.md"),
        "utf8",
      );

      for (const key of Object.keys(kept)) {
        expect({ language, key, drawn: SCREEN_KEYS.includes(key) }).toEqual({
          language,
          key,
          drawn: true,
        });
        expect({
          language,
          key,
          value: readDashboardLocale(language)[key],
        }).toEqual({
          language,
          key,
          value: key,
        });
      }

      // The reason holds: the language's docs quote the English name.
      expect({
        language,
        quoted: networkDocs.includes("OID Collection Template"),
      }).toEqual({
        language,
        quoted: true,
      });
    }
  });

  test("a language whose docs word the template words it too", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      if (OID_TEMPLATES_IN_ENGLISH.includes(language)) {
        continue;
      }

      expect({
        language,
        worded: isWordedInDashboardLocale("OID Collection Template", language),
      }).toEqual({ language, worded: true });
      expect(
        readDashboardSameAsEnglish(language).includes(
          "OID Collection Template",
        ),
      ).toBe(false);
    }
  });
});

function readAdminLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(
      path.join(
        APP,
        "FeatureSet/AdminDashboard/src/Locales",
        `${language}.json`,
      ),
      "utf8",
    ),
  ) as Record<string, string>;
}

const ADMIN_ENGLISH: Record<string, string> = readAdminLocale("en");

// The JSON import's keys the Admin Dashboard's locale files hold too.
const SHARED_KEYS: Array<string> = keysOf(SHARED_WITH_ADMIN).filter(
  (key: string): boolean => {
    return Object.prototype.hasOwnProperty.call(ADMIN_ENGLISH, key);
  },
);

// Where `admin` words a shared key otherwise than `language`'s Dashboard.
function adminDiffers(
  admin: Record<string, string>,
  language: string,
): Array<string> {
  const dashboard: Record<string, string> = readDashboardLocale(language);

  return SHARED_KEYS.filter((key: string): boolean => {
    return admin[key] !== dashboard[key];
  });
}

describe("the Admin Dashboard's JSON import says what the Dashboard's says", () => {
  test("the two share the editor's and the dialog's words", () => {
    expect(SHARED_KEYS).toEqual(
      expect.arrayContaining([
        "Nothing entered yet.",
        "Ln {{line}}, Col {{column}}",
        "Valid {{language}} · {{count}} lines",
        "Tab inserts indentation. To move focus out of the editor, press Escape, then Tab.",
        "{{count}} {{itemsName}} imported successfully.",
      ]),
    );
  });

  test.each(DASHBOARD_LANGUAGES)("in %s", (language: string) => {
    expect(adminDiffers(readAdminLocale(language), language)).toEqual([]);
  });

  test("an Admin word left in English is caught (control)", () => {
    const admin: Record<string, string> = {
      ...readAdminLocale("sv"),
      "Nothing entered yet.": "Nothing entered yet.",
    };

    expect(adminDiffers(admin, "sv")).toEqual(["Nothing entered yet."]);
  });
});

/*
 * The docs pages that name these screens' buttons, and the labels each one
 * names - in bold, as each language's Dashboard draws them.
 */
const DOCS_LABELS: Record<string, ReadonlyArray<string>> = {
  "configuration/label-rule-import-export.md": [
    "Validate and preview",
    "Edit JSON",
    "Download failed rules",
  ],
  "monitor/network-device-monitor.md": ["Include Ping-Only Hosts", "Dry Run"],
  "configuration/run-rules-now.md": ["Dry Run"],
};

// Arabic readers read the docs in English (Common/Types/Docs/DocsLanguage).
const DOCS_LANGUAGES: ReadonlyArray<string> = DASHBOARD_LANGUAGES.filter(
  (language: string): boolean => {
    return language !== "ar";
  },
);

// Where a page names `labels` other than as `language`'s Dashboard draws them.
function labelsNotAsDrawn(
  language: string,
  text: string,
  labels: ReadonlyArray<string>,
): Array<string> {
  const words: Record<string, string> = readDashboardLocale(language);
  const problems: Array<string> = [];

  for (const label of labels) {
    const drawn: string = words[label] as string;

    if (drawn !== label && text.includes(`**${label}**`)) {
      problems.push(`says **${label}** in English`);
    }

    if (!text.includes(`**${drawn}**`)) {
      problems.push(`never names **${drawn}**`);
    }
  }

  return problems;
}

describe("the translated docs name the import screens' buttons as drawn", () => {
  test.each(DOCS_LANGUAGES)("%s", (language: string) => {
    const problems: Array<string> = [];

    for (const [page, labels] of Object.entries(DOCS_LABELS)) {
      const text: string = fs.readFileSync(
        path.join(DOCS, language, page),
        "utf8",
      );

      for (const problem of labelsNotAsDrawn(language, text, labels)) {
        problems.push(`${page}: ${problem}`);
      }
    }

    expect(problems).toEqual([]);
  });

  test("a label left in English is caught (control)", () => {
    const page: string = "monitor/network-device-monitor.md";
    const text: string = fs.readFileSync(path.join(DOCS, "it", page), "utf8");
    const drawn: string = readDashboardLocale("it")["Dry Run"] as string;

    expect(drawn).toBe("Simulazione");
    expect(
      labelsNotAsDrawn("it", text.split(`**${drawn}**`).join("**Dry Run**"), [
        "Dry Run",
      ]),
    ).toEqual(["says **Dry Run** in English", `never names **${drawn}**`]);
  });
});

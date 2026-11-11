import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { NamingLookupKey } from "Common/Types/NetworkDevice/DeviceNaming";
import {
  NAMING_LOOKUP_BAD_KEY_PROBLEMS,
  NAMING_LOOKUP_PROBLEMS,
} from "Common/Utils/NetworkDevice/Naming/NamingLookup";
import {
  ExtractedString,
  SourceKind,
  scanSourceText,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import { getDefaultContext } from "../../FeatureSet/Dashboard/scripts/i18n/I18n";

/*
 * NETWORK NAMING RULES AND POWER BI VIEWS AND REFRESHES, IN EVERY LANGUAGE
 * (#6671, #6686) - read from the Dashboard's shipped locale files.
 *
 * Network naming rules (#6619) added the Naming Rules page, its rule form
 * (the name pattern with its placeholder buttons, the lookup table), the
 * Apply Naming Rules dialog and the name previews of Review Results and Add
 * to monitoring. Power BI views and refreshes added the Views, Last Viewed
 * and Last Refresh columns of BI Dashboards and the lines under each
 * dashboard of a table's Lineage tab. Both shipped their sentences in
 * English only, so a German, Japanese or Arabic reader met English on those
 * pages. Every key the files below look up is worded in every language the
 * Dashboard ships; what a language keeps as written (a sample pattern such
 * as "00:05:0b*", a vendor's name) is recorded in its progress file.
 *
 * A lookup table's key of the wrong kind, and an empty table's request for
 * rows, are a whole sentence for each kind of key: the one sentence each
 * replaced filled the kind's title in lowercased ("is not a last part of
 * the ip address"), which no language could word right.
 */

const CONTEXT: ReturnType<typeof getDefaultContext> = getDefaultContext();
const REPOSITORY_ROOT: string = CONTEXT.repositoryRoot;
const DASHBOARD: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet/Dashboard",
);

// Every language besides English.
const LANGUAGES: Array<string> = CONTEXT.locales.slice();

// Languages with one plural form: their "_one" keys are never read.
const ONE_FORM_LANGUAGES: ReadonlySet<string> = new Set([
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
]);

// Languages read from the right.
const RIGHT_TO_LEFT_LANGUAGES: Array<string> = ["ar", "fa"];

interface SourceFile {
  // Repository-relative.
  file: string;
  kind: SourceKind;
}

function dashboardFile(file: string): SourceFile {
  return {
    file: `packages/App/FeatureSet/Dashboard/src/${file}`,
    kind: "ui",
  };
}

// The Naming Rules page, the rule form, the Apply dialog and the previews.
const NAMING_FILES: Array<SourceFile> = [
  dashboardFile("Components/NetworkDevice/Naming/ApplyNamingRulesModal.tsx"),
  dashboardFile("Components/NetworkDevice/Naming/DeviceNamingApi.ts"),
  dashboardFile("Components/NetworkDevice/Naming/DeviceNamingCopy.ts"),
  dashboardFile("Components/NetworkDevice/Naming/NamePatternInput.tsx"),
  dashboardFile("Components/NetworkDevice/Naming/NamingLookupTableEditor.tsx"),
  dashboardFile("Components/NetworkDevice/Naming/NamingPreviewSummary.tsx"),
  dashboardFile("Components/NetworkDevice/Naming/NamingRuleFormFields.tsx"),
  dashboardFile("Components/NetworkDevice/Naming/useBulkApplyNamingRules.tsx"),
  dashboardFile("Components/NetworkDevice/Naming/useNamingPreview.ts"),
  dashboardFile("Pages/NetworkDevice/Settings/NamingRules.tsx"),
  dashboardFile(
    "Components/NetworkDevice/DiscoveryImport/DiscoveredHostTable.tsx",
  ),
  // What each placeholder is, and what is wrong with a pattern or a table.
  {
    file: "packages/Common/Utils/NetworkDevice/Naming/NamePattern.ts",
    kind: "keys",
  },
  {
    file: "packages/Common/Utils/NetworkDevice/Naming/NamingLookup.ts",
    kind: "keys",
  },
  // The rule's columns, and a device's Rule-Assigned Name.
  {
    file: "packages/Common/Models/DatabaseModels/NetworkDeviceNamingRule.ts",
    kind: "models",
  },
];

// BI Dashboards' views and refreshes, and the Lineage tab's dashboards.
const POWER_BI_FILES: Array<SourceFile> = [
  dashboardFile("Components/DataObservability/DashboardActivity.tsx"),
  dashboardFile("Components/DataObservability/TableDashboards.tsx"),
  dashboardFile("Pages/DataObservability/BiDashboards.tsx"),
  {
    file: "packages/Common/Models/DatabaseModels/DataDashboard.ts",
    kind: "models",
  },
  {
    file: "packages/Common/Models/DatabaseModels/DataBiConnection.ts",
    kind: "models",
  },
];

// An empty lookup table's request for rows, one for each kind of key.
const EMPTY_TABLE_SENTENCES: Array<string> = [
  "No rows yet. Add one, or paste two columns from a spreadsheet: the last part of each IP address and the value it stands for.",
  "No rows yet. Add one, or paste two columns from a spreadsheet: each IP address and the value it stands for.",
  "No rows yet. Add one, or paste two columns from a spreadsheet: each MAC address and the value it stands for.",
  "No rows yet. Add one, or paste two columns from a spreadsheet: each discovered name and the value it stands for.",
];

// A lookup table's key of the wrong kind, one for each kind of key.
const BAD_KEY_SENTENCES: Array<string> = Object.values(NamingLookupKey).map(
  (kind: NamingLookupKey): string => {
    return NAMING_LOOKUP_BAD_KEY_PROBLEMS[kind];
  },
);

// The two sentences that filled the kind's title in, now gone.
const REMOVED_KEYS: Array<string> = [
  'Row {{row}}: "{{key}}" is not a {{kind}}, such as {{example}}.',
  "No rows yet. Add one, or paste two columns from a spreadsheet: the {{key}} and the value it stands for.",
];

/*
 * Sentences of both screens a reader sees most, named here so the source
 * scan cannot quietly lose them.
 */
const NAMED_NAMING_KEYS: Array<string> = [
  "Naming rules",
  "Name Pattern",
  "Look Up By",
  "Insert:",
  "Will be renamed",
  "Named by a person",
  "How Naming Rules Work",
  "Rule-Assigned Name",
  "{{count}} devices checked: {{rename}} to rename, {{following}} already follow your rules, {{attention}} need attention.",
  "{{count}} devices checked: {{rename}} to rename, {{following}} already follow your rules, {{attention}} need attention._one",
  ...EMPTY_TABLE_SENTENCES,
  ...BAD_KEY_SENTENCES,
];

const NAMED_POWER_BI_KEYS: Array<string> = [
  "Views",
  "Last Viewed",
  "Last Refresh",
  "Top Viewers",
  "Refreshes",
  "Alert on Failed Refreshes",
  "{{count}} views",
  "{{count}} views_one",
  "{{count}} refreshes in the last 7 days",
  "{{failed}} of {{count}} failed in the last 7 days",
];

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readLocale(language: string): Record<string, string> {
  return readJson(
    path.join(DASHBOARD, `src/Locales/${language}.json`),
  ) as Record<string, string>;
}

const ENGLISH: Record<string, string> = readLocale("en");

const GLOBAL_SAME_AS_ENGLISH: Array<string> = readJson(
  path.join(DASHBOARD, "i18n/SameAsEnglish.json"),
) as Array<string>;

// What reads the same as English in every language, and in this one.
function keptAsWritten(language: string): Set<string> {
  const progress: { sameAsEnglish?: Array<string> } = readJson(
    path.join(DASHBOARD, `i18n/Progress/${language}.json`),
  ) as { sameAsEnglish?: Array<string> };

  return new Set([
    ...GLOBAL_SAME_AS_ENGLISH,
    ...(progress.sameAsEnglish || []),
  ]);
}

// Every key the files look up: a plural's general sentence and its "_one".
function getKeys(files: Array<SourceFile>): Array<string> {
  const keys: Set<string> = new Set<string>();

  for (const source of files) {
    const strings: Array<ExtractedString> = scanSourceText(
      source.file,
      fs.readFileSync(path.join(REPOSITORY_ROOT, source.file), "utf8"),
      { kind: source.kind },
    ).strings;

    for (const entry of strings) {
      keys.add(entry.text);

      if (entry.pluralOne !== undefined) {
        keys.add(`${entry.text}_one`);
      }
    }
  }

  return [...keys].sort();
}

/*
 * Naming sentences in files with many other features' (the device model,
 * the site pages): the device's Rule-Assigned Name column, and the site
 * code a pattern's {site.code} names.
 */
const NAMING_KEYS_ELSEWHERE: Array<string> = [
  "Rule-Assigned Name",
  "A short code, such as a store or unit number. Naming rules can put it in device names with {site.code}.",
];

const NAMING_KEYS: Array<string> = [
  ...new Set([...getKeys(NAMING_FILES), ...NAMING_KEYS_ELSEWHERE]),
].sort();
const POWER_BI_KEYS: Array<string> = getKeys(POWER_BI_FILES);
const ALL_KEYS: Array<string> = [
  ...new Set([...NAMING_KEYS, ...POWER_BI_KEYS]),
];

/*
 * The keys a language does not word: missing from its file, or still the
 * English without recording that it keeps it so.
 */
function untranslated(
  language: string,
  keys: Array<string>,
  locale: Record<string, string> = readLocale(language),
): Array<string> {
  const same: Set<string> = keptAsWritten(language);

  return keys.filter((key: string): boolean => {
    const english: string = ENGLISH[key] as string;

    if (locale[key] === undefined) {
      return true;
    }

    if (ONE_FORM_LANGUAGES.has(language) && key.endsWith("_one")) {
      return false;
    }

    // An English without letters ("{{count}}") reads the same everywhere.
    if (!/\p{L}/u.test(english.replace(/\{\{?[^}]*\}\}?/g, ""))) {
      return false;
    }

    // The progress files record the English a language keeps, not its key.
    return locale[key] === english && !same.has(english);
  });
}

// Every language's gaps at once, so a failure names them all.
function gaps(keys: Array<string>): Record<string, Array<string>> {
  const missing: Record<string, Array<string>> = {};

  for (const language of LANGUAGES) {
    const left: Array<string> = untranslated(language, keys);

    if (left.length > 0) {
      missing[language] = left;
    }
  }

  return missing;
}

// The {{values}} a sentence fills in, and the {placeholders} it names.
function tokensOf(text: string): Array<string> {
  return (text.match(/\{\{[^}]+\}\}|\{[a-z][a-z0-9.:]*\}/gi) || []).sort();
}

describe("the keys the naming rules and Power BI screens look up", () => {
  test("the source scan finds both screens' sentences, and every one is in en.json", () => {
    expect(NAMING_KEYS).toEqual(expect.arrayContaining(NAMED_NAMING_KEYS));
    expect(POWER_BI_KEYS).toEqual(expect.arrayContaining(NAMED_POWER_BI_KEYS));
    expect(NAMING_KEYS.length).toBeGreaterThan(150);
    expect(POWER_BI_KEYS.length).toBeGreaterThan(40);
    expect(
      ALL_KEYS.filter((key: string): boolean => {
        return ENGLISH[key] === undefined;
      }),
    ).toEqual([]);
  });

  test("the sentences that filled a kind's title in are gone from every locale", () => {
    for (const language of ["en", ...LANGUAGES]) {
      const locale: Record<string, string> = readLocale(language);

      expect({
        language,
        left: REMOVED_KEYS.filter((key: string): boolean => {
          return locale[key] !== undefined;
        }),
      }).toEqual({ language, left: [] });
    }

    expect(Object.values(NAMING_LOOKUP_PROBLEMS)).not.toContain(
      REMOVED_KEYS[0],
    );
  });
});

describe("network naming rules and Power BI views and refreshes in every language", () => {
  test("there is a language to check besides English", () => {
    expect(LANGUAGES.length).toBe(17);
    expect(LANGUAGES).toEqual(expect.arrayContaining(["de", "ja", "ar"]));
  });

  test("every language words every key the naming rules files look up", () => {
    expect(gaps(NAMING_KEYS)).toEqual({});
  });

  test("every language words every key the Power BI views and refreshes files look up", () => {
    expect(gaps(POWER_BI_KEYS)).toEqual({});
  });

  test("every language keeps each sentence's values and placeholders", () => {
    const wrong: Array<string> = [];

    for (const language of LANGUAGES) {
      const locale: Record<string, string> = readLocale(language);

      for (const key of ALL_KEYS) {
        const english: string = ENGLISH[key] as string;
        const words: string | undefined = locale[key];

        if (words === undefined || words === english) {
          continue;
        }

        if (tokensOf(words).join(" ") !== tokensOf(english).join(" ")) {
          wrong.push(`${language}: ${key}`);
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  test("every language words the four kinds of key in four sentences: a wrong key, and an empty table", () => {
    for (const sentences of [BAD_KEY_SENTENCES, EMPTY_TABLE_SENTENCES]) {
      expect(new Set(sentences).size).toBe(4);

      for (const language of LANGUAGES) {
        const locale: Record<string, string> = readLocale(language);
        const worded: Array<string | undefined> = sentences.map(
          (key: string): string | undefined => {
            return locale[key];
          },
        );

        expect({ language, distinct: new Set(worded).size }).toEqual({
          language,
          distinct: 4,
        });
      }
    }
  });

  test("Arabic and Persian put no direction marks in these sentences: the page sets their code apart", () => {
    for (const language of RIGHT_TO_LEFT_LANGUAGES) {
      const locale: Record<string, string> = readLocale(language);

      expect({
        language,
        marked: ALL_KEYS.filter((key: string): boolean => {
          return /[‎‏؜]/.test(locale[key] || "");
        }),
      }).toEqual({ language, marked: [] });
    }
  });
});

describe("the check itself", () => {
  test("a sentence set back to English, or left out, is reported", () => {
    const german: Record<string, string> = readLocale("de");
    const key: string = BAD_KEY_SENTENCES[0] as string;

    expect(untranslated("de", ALL_KEYS, german)).toEqual([]);

    expect(
      untranslated("de", ALL_KEYS, { ...german, [key]: ENGLISH[key]! }),
    ).toEqual([key]);

    const withoutViews: Record<string, string> = { ...german };
    delete withoutViews["Views"];

    expect(untranslated("de", ALL_KEYS, withoutViews)).toEqual(["Views"]);
  });

  test("what a language keeps as written, a one-form language's _one and a sentence without letters are not reported", () => {
    const japanese: Record<string, string> = readLocale("ja");

    // A sample MAC pattern every progress file records as kept.
    expect(
      untranslated("de", ["00:05:0b*"], {
        "00:05:0b*": "00:05:0b*",
      }),
    ).toEqual([]);
    expect(
      untranslated("ja", ["{{count}} views_one"], {
        ...japanese,
        "{{count}} views_one": ENGLISH["{{count}} views_one"]!,
      }),
    ).toEqual([]);
    // German has a "one" form: its _one in English is reported.
    expect(
      untranslated("de", ["{{count}} views_one"], {
        "{{count}} views_one": ENGLISH["{{count}} views_one"]!,
      }),
    ).toEqual(["{{count}} views_one"]);
  });

  test("a placeholder a translation drops is caught", () => {
    expect(
      tokensOf("Zeile {{row}}: kein MAC-Adresse, z. B. {{example}}.").join(" "),
    ).not.toBe(tokensOf(BAD_KEY_SENTENCES[2] as string).join(" "));
    expect(tokensOf("UN{site.code}{lookup} {{count}}")).toEqual([
      "{lookup}",
      "{site.code}",
      "{{count}}",
    ]);
  });
});

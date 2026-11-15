import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ExtractedString,
  scanSourceText,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";

/*
 * THE IMPORT SCREENS, WHOLE, IN HINDI (#7310, UI review).
 *
 * #7310 made Hindi say आयात for import everywhere. A Hindi reader who
 * opened the import screens still met English around that word: the label
 * rule import dialog (Validate and preview, Edit JSON, Download failed
 * rules, Labels to add), the CSV upload (Click to upload CSV, Expected
 * columns), the JSON import dialog's editor (Nothing entered yet., Ln 1,
 * Col 1) and the network auto import page, its form and its Dry Run
 * dialog (Behavior, Include Ping-Only Hosts, Start Dry Run).
 *
 * Every word those screens draw is Hindi now. The rule-type pill on the
 * auto import page drew the Import button's key, which Hindi words as a
 * verb (आयात करें, "do import") and German as one too (Importieren); it
 * names a kind of rule, so it has keys of its own, "Import rule" and
 * "Exclusion rule", worded as nouns in every language. The Hindi docs
 * name these buttons as the Dashboard draws them.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");
const PACKAGES: string = path.join(REPOSITORY_ROOT, "packages");
const APP: string = path.join(PACKAGES, "App");

// The screens a reader imports from, each file that draws their words.
const IMPORT_SCREENS: ReadonlyArray<string> = [
  // Any model's JSON import and export (monitor groups, status pages...).
  "Common/UI/Components/ImportExport/ImportModelsModal.tsx",
  "Common/UI/Components/ImportExport/ExportModelCard.tsx",
  "Common/UI/Components/CodeEditor/CodeEditor.tsx",
  // The label rule import (alert, incident, monitor... label rules).
  "Common/UI/Components/LabelRule/ImportLabelRulesModal.tsx",
  "Common/UI/Components/LabelRule/LabelRuleTable.tsx",
  // The CSV upload of the site and status page group imports.
  "Common/UI/Components/CSVFileUpload/CSVFileUpload.tsx",
  // Network > Settings > Auto Import Rules, its form and its run dialog.
  "App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Settings/AutoImportRules.tsx",
  "App/FeatureSet/Dashboard/src/Components/NetworkAutomation/RunAutoImportRuleModal.tsx",
];

/*
 * Words these screens draw that Hindi keeps in English on purpose, each
 * with its reason.
 */
const KEPT_IN_ENGLISH: Record<string, string> = {
  /*
   * The network's OID collection templates are named in English across
   * the Hindi network docs (their tables quote the Dashboard's English
   * names), so the field keeps that name.
   */
  "OID Collection Template": "named in English by the Hindi network docs",
  "Unnamed OID Collection Template":
    "named in English by the Hindi network docs",
};

function scan(file: string): Array<ExtractedString> {
  return scanSourceText(
    path.join("packages", file),
    fs.readFileSync(path.join(PACKAGES, file), "utf8"),
    { kind: "ui" },
  ).strings as Array<ExtractedString>;
}

// Every key a file draws, with the "one" form of a plural.
function keysOf(files: ReadonlyArray<string>): Array<string> {
  const keys: Set<string> = new Set<string>();

  for (const file of files) {
    for (const entry of scan(file)) {
      keys.add(entry.text);

      if (entry.pluralOne) {
        keys.add(`${entry.text}_one`);
      }
    }
  }

  return Array.from(keys).sort();
}

const SCREEN_KEYS: Array<string> = keysOf(IMPORT_SCREENS);

// The keys the Hindi Dashboard leaves in English, as npm run i18n:check counts it.
function unwordedInHindi(keys: ReadonlyArray<string>): Array<string> {
  return keys.filter((key: string): boolean => {
    return (
      !Object.prototype.hasOwnProperty.call(KEPT_IN_ENGLISH, key) &&
      !isWordedInDashboardLocale(key, "hi")
    );
  });
}

/*
 * Runs `check` with the Hindi Dashboard words as they are, but with `key`
 * put back to its English - the cached file the helpers read, restored
 * after.
 */
function withHindiKeyInEnglish<T>(key: string, check: () => T): T {
  const hindi: Record<string, string> = readDashboardLocale("hi");
  const worded: string | undefined = hindi[key];

  hindi[key] = readDashboardLocale("en")[key] as string;

  try {
    return check();
  } finally {
    hindi[key] = worded as string;
  }
}

describe("the import screens in Hindi", () => {
  test("the scan reads each screen's words", () => {
    for (const key of [
      // The label rule import.
      "Validate and preview",
      "Edit JSON",
      "Download failed rules",
      "Labels to add",
      // The JSON import's editor.
      "Nothing entered yet.",
      "Ln {{line}}, Col {{column}}",
      // The CSV upload.
      "Click to upload CSV",
      "Expected columns:",
      // The auto import page, its form and its run dialog.
      "Dry Run",
      "Start Dry Run",
      "Include Ping-Only Hosts",
      "Behavior",
      "Import rule",
      "Exclusion rule",
    ]) {
      expect({ key, drawn: SCREEN_KEYS.includes(key) }).toEqual({
        key,
        drawn: true,
      });
    }

    expect(SCREEN_KEYS.length).toBeGreaterThan(150);
  });

  test("every word the import screens draw is Hindi", () => {
    expect(unwordedInHindi(SCREEN_KEYS)).toEqual([]);
  });

  test("a word put back to English is caught", () => {
    for (const key of [
      "Validate and preview",
      "Click to upload CSV",
      "Ln {{line}}, Col {{column}}",
      "Start Dry Run",
      "Import rule",
    ]) {
      expect(
        withHindiKeyInEnglish(key, () => {
          return unwordedInHindi(SCREEN_KEYS);
        }),
      ).toEqual([key]);
    }

    // The words kept in English on purpose are drawn, and kept.
    for (const key of Object.keys(KEPT_IN_ENGLISH)) {
      expect({ key, drawn: SCREEN_KEYS.includes(key) }).toEqual({
        key,
        drawn: true,
      });
      expect(readDashboardLocale("hi")[key]).toBe(key);
    }
  });

  test("the Admin Dashboard's JSON import says what the Dashboard's says", () => {
    const admin: Record<string, string> = JSON.parse(
      fs.readFileSync(
        path.join(APP, "FeatureSet/AdminDashboard/src/Locales/hi.json"),
        "utf8",
      ),
    ) as Record<string, string>;
    const hindi: Record<string, string> = readDashboardLocale("hi");
    const shared: Array<string> = keysOf([
      "Common/UI/Components/ImportExport/ImportModelsModal.tsx",
      "Common/UI/Components/CodeEditor/CodeEditor.tsx",
    ]).filter((key: string): boolean => {
      return Object.prototype.hasOwnProperty.call(admin, key);
    });

    expect(shared).toEqual(
      expect.arrayContaining([
        "Nothing entered yet.",
        "Ln {{line}}, Col {{column}}",
        "Could not read the selected file. Please try again.",
      ]),
    );

    const differing: Array<{ key: string; admin: string; dashboard: string }> =
      shared
        .filter((key: string): boolean => {
          return admin[key] !== hindi[key];
        })
        .map((key: string) => {
          return {
            key,
            admin: admin[key] as string,
            dashboard: hindi[key] as string,
          };
        });

    expect(differing).toEqual([]);
  });
});

describe("the auto import rule's type", () => {
  const source: string = fs.readFileSync(
    path.join(
      PACKAGES,
      "App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Settings/AutoImportRules.tsx",
    ),
    "utf8",
  );

  test("the pill names the rule's kind, not the Import button", () => {
    expect(source).toContain('<Pill color={Blue} text="Import rule" />');
    expect(source).toContain('<Pill color={Red} text="Exclusion rule" />');
    expect(source).not.toMatch(/text="(?:Import|Exclusion)"/);
  });

  test("every language words the two kinds, apart from its Import button", () => {
    const problems: Array<string> = [];

    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const key of ["Import rule", "Exclusion rule"]) {
        if (!isWordedInDashboardLocale(key, language)) {
          problems.push(`${language}: ${key} is in English`);
        }
      }

      if (words["Import rule"] === words["Import"]) {
        problems.push(`${language}: Import rule says the Import button`);
      }

      if (words["Import rule"] === words["Exclusion rule"]) {
        problems.push(`${language}: the two kinds say the same`);
      }
    }

    expect(problems).toEqual([]);
    expect(DASHBOARD_LANGUAGES.length).toBeGreaterThanOrEqual(17);
  });

  test("Hindi names them as nouns, with आयात", () => {
    const hindi: Record<string, string> = readDashboardLocale("hi");

    expect(hindi["Import rule"]).toBe("आयात नियम");
    expect(hindi["Exclusion rule"]).toBe("बहिष्करण नियम");
    // The Import button is a verb: the pill is not.
    expect(hindi["Import"]).toBe("आयात करें");
    expect(hindi["Import rule"]).not.toMatch(/करें/u);
    expect(hindi["Exclusion rule"]).not.toMatch(/करें/u);
  });
});

/*
 * The Hindi docs pages that name these screens' buttons, and the labels
 * each one names.
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

const HINDI_DOCS: string = path.join(APP, "FeatureSet/Docs/Content/hi");

// Where a Hindi page names `labels` other than as the Dashboard draws them.
function labelsNotAsDrawn(
  text: string,
  labels: ReadonlyArray<string>,
): Array<string> {
  const hindi: Record<string, string> = readDashboardLocale("hi");
  const problems: Array<string> = [];

  for (const label of labels) {
    if (text.includes(label)) {
      problems.push(`says ${label} in English`);
    }

    if (!text.includes(`**${hindi[label]}**`)) {
      problems.push(`never names **${hindi[label]}**`);
    }
  }

  return problems;
}

describe("the Hindi docs", () => {
  test("name the import screens' buttons as the Dashboard draws them", () => {
    const problems: Array<string> = [];

    for (const [page, labels] of Object.entries(DOCS_LABELS)) {
      const text: string = fs.readFileSync(path.join(HINDI_DOCS, page), "utf8");

      for (const problem of labelsNotAsDrawn(text, labels)) {
        problems.push(`${page}: ${problem}`);
      }
    }

    expect(problems).toEqual([]);
  });

  test("a label left in English is caught", () => {
    const page: string = "monitor/network-device-monitor.md";
    const text: string = fs.readFileSync(path.join(HINDI_DOCS, page), "utf8");

    expect(
      labelsNotAsDrawn(
        `${text}\n- **Dry Run** हर पूरे हुए स्कैन का मूल्यांकन करता है।\n`,
        ["Dry Run"],
      ),
    ).toEqual(["says Dry Run in English"]);

    expect(
      labelsNotAsDrawn(text.split("**ड्राई रन**").join("**Dry Run**"), [
        "Dry Run",
      ]),
    ).toEqual(["says Dry Run in English", "never names **ड्राई रन**"]);
  });
});

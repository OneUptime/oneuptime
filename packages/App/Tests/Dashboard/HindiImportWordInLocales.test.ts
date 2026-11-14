import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ExtractedString,
  SOURCE_ROOTS,
  getEnglishEntries,
  scanSourceRoots,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";

/*
 * ONE HINDI WORD FOR IMPORT (#7310).
 *
 * Hindi said import two ways: आयात in 144 Dashboard values (the Import
 * button, Imported, Import results) and the English word in Devanagari
 * letters, इम्पोर्ट or इंपोर्ट, in 106 more - the import from another
 * tool, the security event connections, the Code repository import, the
 * monitor auto-import rules. A reader met आयात on one button and इम्पोर्ट
 * in the title or help beside it, and the docs did the same: the network
 * sites page had the heading "CSV फ़ाइल से साइटें इम्पोर्ट करें" right
 * above the bold Dashboard label "CSV से आयात करें".
 *
 * Every one says आयात now, in the Dashboard, the other apps and the Hindi
 * docs, and the import words the Dashboard still drew in English are
 * worded with it. This suite keeps the loanword out, holds every import
 * word the Dashboard draws to आयात, pins the sentences the issue named, and
 * catches the grammar a plain swap had kept wrong: लाना never takes ने,
 * so "the earlier import brought it" is "पिछला आयात इसे लाया", not
 * "पिछले आयात ने इसे लाया".
 *
 * (#7110 did the same for incident: HindiIncidentWordInLocales.)
 */

const APP: string = path.resolve(__dirname, "../..");

// Every Hindi locale file a reader of OneUptime meets.
const HINDI_LOCALES: ReadonlyArray<string> = [
  "FeatureSet/Dashboard/src/Locales/hi.json",
  "FeatureSet/AdminDashboard/src/Locales/hi.json",
  "FeatureSet/Accounts/src/Locales/hi.json",
  "FeatureSet/StatusPage/src/Locales/hi.json",
  "FeatureSet/PublicDashboard/src/Locales/hi.json",
  "FeatureSet/Docs/Locales/hi.json",
  "FeatureSet/APIReference/Locales/hi.json",
  "../Common/Server/Locales/hi.json",
];

const HINDI_DOCS: string = path.join(APP, "FeatureSet/Docs/Content/hi");

/*
 * The English word in Devanagari, however it is spelled: इम्पोर्ट, इंपोर्ट,
 * इँपोर्ट, इमपोर्ट - and its plural इंपोर्ट्स, which holds it.
 */
const LOANWORD: RegExp = /इ(?:ं|ँ|म्|म)पोर्ट/u;

const IMPORT_WORD: string = "आयात";

// A key that names an import: Import, imports, imported, importing, importable - not important.
const IMPORT_KEY: RegExp = /\bimport(?:s|ed|ing|able)?\b/i;

// A value worded in Hindi, rather than left in English.
const DEVANAGARI: RegExp = /\p{Script=Devanagari}/u;

/*
 * लाना ("to bring") never takes ने: "an earlier import brought it over"
 * is "पिछला आयात इसे लाया", not "पिछले आयात ने इसे लाया". A compound with
 * देना does take it, so "पिछले आयात ने इसे ला दिया है" is right.
 */
const IMPORT_WITH_NE_BROUGHT: RegExp =
  /आयात ने [^।|]*?ला(?:या|ई|ए)(?![\p{L}\p{M}])/u;

// "OneUptime remembers what each import brought, by the other tool's id."
const EACH_IMPORT_BROUGHT: RegExp = /हर आयात .+ के अनुसार क्या लाया/u;

/*
 * Import keys whose Hindi rightly says no आयात, each with its reason.
 */
const SAYS_ANOTHER_WORD: Record<string, string> = {
  // What happened to an imported row: बनाया गया, "was created".
  "Created (import result)":
    "the outcome of a row an import made, not the import itself",
  // Terraform's own keyword, written as Terraform reads it.
  "Its settings as they are now, and an import block: it tells Terraform the {{singular}} already exists, so Terraform adopts it instead of creating a copy. Comments name the records its IDs point at.":
    "Terraform's import block keeps its keyword",
};

type Locale = Record<string, unknown>;

interface Value {
  key: string;
  text: string;
}

function readLocale(file: string): Locale {
  return JSON.parse(fs.readFileSync(path.join(APP, file), "utf8")) as Locale;
}

// Every string of a locale, under its key (a nested one as its path).
function valuesOf(locale: Locale, prefix: string = ""): Array<Value> {
  const values: Array<Value> = [];

  for (const [key, value] of Object.entries(locale)) {
    const fullKey: string = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "string") {
      values.push({ key: fullKey, text: value });
    } else if (value && typeof value === "object") {
      values.push(...valuesOf(value as Locale, fullKey));
    }
  }

  return values;
}

// The keys whose wording holds the loanword.
function withLoanword(values: ReadonlyArray<Value>): Array<string> {
  return values
    .filter((value: Value): boolean => {
      return LOANWORD.test(value.text);
    })
    .map((value: Value): string => {
      return value.key;
    });
}

/*
 * The import keys of `keys` whose Hindi is not आयात: left in English, or
 * worded with another word, and not one SAYS_ANOTHER_WORD gives a reason for.
 */
function notSayingImport(
  keys: ReadonlyArray<string>,
  hindi: Record<string, unknown>,
): Array<string> {
  return keys.filter((key: string): boolean => {
    const text: string = String(hindi[key] ?? "");

    if (SAYS_ANOTHER_WORD[key]) {
      return false;
    }

    return !DEVANAGARI.test(text) || !text.includes(IMPORT_WORD);
  });
}

function markdownFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...markdownFiles(full));
    } else if (entry.name.endsWith(".md")) {
      files.push(full);
    }
  }

  return files;
}

// The Hindi docs pages whose text matches `pattern`, by their path under hi/.
function docsPagesMatching(pattern: RegExp): Array<string> {
  return markdownFiles(HINDI_DOCS)
    .filter((page: string): boolean => {
      return pattern.test(fs.readFileSync(page, "utf8"));
    })
    .map((page: string): string => {
      return path.relative(HINDI_DOCS, page);
    });
}

function readDocsPage(page: string): string {
  return fs.readFileSync(path.join(HINDI_DOCS, page), "utf8");
}

const DASHBOARD: Locale = readLocale(HINDI_LOCALES[0]!);
const ADMIN_DASHBOARD: Locale = readLocale(HINDI_LOCALES[1]!);

function dashboardWord(key: string): string {
  return DASHBOARD[key] as string;
}

/*
 * Every key the Dashboard draws - its pages and components, Common's UI
 * and every model's titles - as npm run i18n:extract finds them.
 */
const DRAWN_KEYS: Array<string> = Object.keys(
  getEnglishEntries(
    scanSourceRoots(SOURCE_ROOTS).strings as ReadonlyArray<ExtractedString>,
  ),
);

const DRAWN_IMPORT_KEYS: Array<string> = DRAWN_KEYS.filter(
  (key: string): boolean => {
    return IMPORT_KEY.test(key);
  },
);

describe("Hindi's word for import", () => {
  test.each(HINDI_LOCALES)(
    "%s never says इम्पोर्ट or इंपोर्ट",
    (file: string) => {
      expect({ file, keys: withLoanword(valuesOf(readLocale(file))) }).toEqual({
        file,
        keys: [],
      });
    },
  );

  test("no Hindi docs page says it: prose, headings, link anchors and diagram labels", () => {
    expect(markdownFiles(HINDI_DOCS).length).toBeGreaterThan(100);
    expect(docsPagesMatching(LOANWORD)).toEqual([]);
  });

  test("every import word the Dashboard draws reads आयात in Hindi", () => {
    // The issue counted 250 import values; the guard reads every one drawn.
    expect(DRAWN_IMPORT_KEYS.length).toBeGreaterThan(250);
    expect(notSayingImport(DRAWN_IMPORT_KEYS, DASHBOARD)).toEqual([]);
  });

  test("the keys allowed another word are drawn, and say what their reason says", () => {
    for (const key of Object.keys(SAYS_ANOTHER_WORD)) {
      expect({ key, drawn: DRAWN_IMPORT_KEYS.includes(key) }).toEqual({
        key,
        drawn: true,
      });
      expect(DEVANAGARI.test(dashboardWord(key))).toBe(true);
      expect(dashboardWord(key)).not.toContain(IMPORT_WORD);
    }

    expect(dashboardWord("Created (import result)")).toBe("बनाया गया");
    expect(
      dashboardWord(
        "Its settings as they are now, and an import block: it tells Terraform the {{singular}} already exists, so Terraform adopts it instead of creating a copy. Comments name the records its IDs point at.",
      ),
    ).toContain("एक import ब्लॉक");
  });

  test("the checks see the loanword however it is spelled, English left as it was and a third word (negative control)", () => {
    const planted: Array<Value> = [
      { key: "Import Values", text: "मान इम्पोर्ट करें" },
      { key: "Start import", text: "इंपोर्ट शुरू करें" },
      { key: "Tool Imports", text: "टूल इंपोर्ट्स" },
      { key: "Importing", text: "इमपोर्ट हो रहा है" },
      { key: "Import", text: "आयात करें" },
      { key: "Imported", text: "आयात किया गया" },
    ];

    expect(withLoanword(planted)).toEqual([
      "Import Values",
      "Start import",
      "Tool Imports",
      "Importing",
    ]);

    // A copy of the locale with one value put back to the loanword fails.
    const putBack: Locale = {
      ...DASHBOARD,
      "Auto Import Rules": "ऑटो इम्पोर्ट नियम",
    };

    expect(withLoanword(valuesOf(putBack))).toEqual(["Auto Import Rules"]);

    // One left in English, and one worded without आयात.
    expect(
      notSayingImport(["Import Complete", "Start import", "Import"], {
        ...DASHBOARD,
        "Import Complete": "Import Complete",
        "Start import": "शुरू करें",
      }),
    ).toEqual(["Import Complete", "Start import"]);

    // The key filter reads an import, not "important".
    expect(IMPORT_KEY.test("Imported before")).toBe(true);
    expect(IMPORT_KEY.test("{{count}} importable hosts")).toBe(true);
    expect(IMPORT_KEY.test("Important")).toBe(false);
  });

  test("the docs check reads a page that says the loanword (negative control)", () => {
    const page: string = [
      "# CSV",
      "",
      "### CSV फ़ाइल से साइटें इम्पोर्ट करें",
      "",
      "**CSV से आयात करें** चुनें।",
    ].join("\n");

    expect(LOANWORD.test(page)).toBe(true);
    expect(LOANWORD.test(page.replace("इम्पोर्ट", IMPORT_WORD))).toBe(false);
  });
});

describe("the words the issue named", () => {
  test("the Dashboard's import words", () => {
    expect(dashboardWord("Import")).toBe("आयात करें");
    expect(dashboardWord("Imported")).toBe("आयात किया गया");
    expect(dashboardWord("Import results")).toBe("आयात के परिणाम");
    expect(dashboardWord("Auto Import Rules")).toBe("ऑटो आयात नियम");
    expect(dashboardWord("Last Event Imported")).toBe(
      "अंतिम आयात किया गया इवेंट",
    );
    // The column and its UTC heading say the same.
    expect(dashboardWord("Last event imported (UTC)")).toBe(
      `${dashboardWord("Last Event Imported")} (UTC)`,
    );
    expect(dashboardWord("Import the next poll window now.")).toBe(
      "अगली पोल विंडो अभी आयात करें।",
    );
    expect(
      dashboardWord(
        "A preview is kept for a day. Read the tool again to import from it.",
      ),
    ).toBe(
      "पूर्वावलोकन एक दिन तक रखा जाता है। इससे आयात करने के लिए टूल को फिर से पढ़ें।",
    );
  });

  test("the import from another tool: its menu entry, its buttons and its report", () => {
    expect(dashboardWord("Import from another tool")).toBe(
      "किसी दूसरे टूल से आयात करें",
    );
    expect(dashboardWord("Start import")).toBe("आयात शुरू करें");
    expect(dashboardWord("Start a new import")).toBe("नया आयात शुरू करें");
    expect(dashboardWord("Earlier imports")).toBe("पिछले आयात");
    expect(dashboardWord("Importing")).toBe("आयात हो रहा है");
    expect(dashboardWord("The import from {{tool}} is done")).toBe(
      "{{tool}} से आयात पूरा हुआ",
    );
    expect(dashboardWord("Tool Import")).toBe("टूल आयात");
    expect(dashboardWord("Tool Imports")).toBe("टूल आयात");
    expect(dashboardWord("Import from your current tool")).toBe(
      "अपने मौजूदा टूल से आयात करें",
    );
  });

  test("the Code repository import and the monitor auto-import rules", () => {
    expect(
      dashboardWord(
        "{{connectInstallation}} to import its repositories into this project.",
      ),
    ).toBe(
      "इसकी रिपॉज़िटरी इस प्रोजेक्ट में आयात करने के लिए {{connectInstallation}}।",
    );
    expect(
      dashboardWord(
        "Your repositories were imported. Pick one to ask AI to work in it.",
      ),
    ).toBe(
      "आपकी रिपॉजिटरी आयात हो गई हैं। उसमें AI से काम करवाने के लिए एक चुनें।",
    );
    // The rules' own page, its model and the template help name them alike.
    for (const key of [
      "Network Device Auto Import Rule",
      "Network Device Auto Import Rules",
    ]) {
      expect(dashboardWord(key)).toBe(
        `नेटवर्क डिवाइस ${dashboardWord("Auto Import Rules")}`,
      );
    }
    expect(dashboardWord("How Auto Import Rules Work")).toBe(
      `${dashboardWord("Auto Import Rules")} कैसे काम करते हैं`,
    );
    expect(
      dashboardWord(
        "Custom field values written onto every monitor created from this template — including monitors provisioned automatically by auto-import rules and alert policies. Fields left blank here are not defaulted.",
      ),
    ).toContain("ऑटो आयात नियमों");
  });

  test("the dialogs that were still in English read आयात, worded as their neighbours", () => {
    // The JSON import dialog and the label rule import, as the device import says it.
    expect(dashboardWord("Import Complete")).toBe(
      dashboardWord("Import finished"),
    );
    expect(dashboardWord("Import complete")).toBe(
      dashboardWord("Import finished"),
    );
    expect(dashboardWord("Preview import")).toBe(
      dashboardWord("Preview Import"),
    );
    expect(dashboardWord("Importing...")).toBe("आयात हो रहा है...");
    expect(
      dashboardWord("{{count}} {{itemsName}} imported successfully."),
    ).toBe("{{count}} {{itemsName}} सफलतापूर्वक आयात हुए।");
    expect(
      dashboardWord("{{count}} {{itemsName}} imported successfully._one"),
    ).toBe("{{count}} {{itemName}} सफलतापूर्वक आयात हुआ।");
    expect(dashboardWord("{{fileName}} - {{count}} rows ready to import")).toBe(
      "{{fileName}} - {{count}} पंक्तियाँ आयात के लिए तैयार",
    );
    // The browser setup step, as the RUM docs' heading says it.
    expect(dashboardWord("Create telemetry.ts and import it first")).toBe(
      "telemetry.ts बनाएँ और उसे सबसे पहले आयात करें",
    );
    expect(readDocsPage("rum/browser-setup.md")).toContain(
      "### इसे सबसे पहले आयात करें",
    );
  });

  test("the Admin Dashboard's JSON import dialog says what the Dashboard's does", () => {
    for (const key of [
      "Import JSON",
      "Importing...",
      "Import Complete",
      "{{count}} {{itemsName}} imported successfully.",
      "{{count}} {{itemsName}} imported successfully._one",
      "{{count}} {{itemsName}} could not be imported.",
      "{{count}} {{itemsName}} could not be imported._one",
      "Upload a {{itemName}} JSON export, or paste it below, to create new {{itemsName}} here. Owners, labels and linked resources are not included.",
    ]) {
      expect({ key, admin: ADMIN_DASHBOARD[key] }).toEqual({
        key,
        admin: dashboardWord(key),
      });
    }
  });
});

describe("the grammar around आयात", () => {
  test("an earlier import brought it: no ने before लाना, in the Dashboard or the docs", () => {
    expect(
      dashboardWord(
        "An earlier import brought this over and it was deleted since, so it will be created again.",
      ),
    ).toBe(
      "पिछला आयात इसे लाया था और तब से यह हटा दिया गया है, इसलिए इसे फिर से बनाया जाएगा।",
    );
    // A compound with देना takes ने, and stays.
    expect(dashboardWord("An earlier import brought this over.")).toBe(
      "पिछले आयात ने इसे पहले ही ला दिया है।",
    );

    for (const file of HINDI_LOCALES) {
      const wrong: Array<string> = valuesOf(readLocale(file))
        .filter((value: Value): boolean => {
          return IMPORT_WITH_NE_BROUGHT.test(value.text);
        })
        .map((value: Value): string => {
          return value.key;
        });

      expect({ file, wrong }).toEqual({ file, wrong: [] });
    }

    expect(docsPagesMatching(IMPORT_WITH_NE_BROUGHT)).toEqual([]);
  });

  test("the grammar check sees what a plain swap kept, and lets the right forms be (negative control)", () => {
    expect(IMPORT_WITH_NE_BROUGHT.test("पिछले आयात ने इसे लाया था")).toBe(true);
    expect(
      IMPORT_WITH_NE_BROUGHT.test(
        "OneUptime याद रखता है कि हर आयात ने Pingdom ID के अनुसार क्या लाया।",
      ),
    ).toBe(true);
    expect(IMPORT_WITH_NE_BROUGHT.test("कुछ ऐसा जो पिछले आयात ने लाया")).toBe(
      true,
    );
    expect(IMPORT_WITH_NE_BROUGHT.test("पिछला आयात इसे लाया था")).toBe(false);
    expect(
      IMPORT_WITH_NE_BROUGHT.test("पिछले आयात ने इसे पहले ही ला दिया है।"),
    ).toBe(false);
    expect(
      IMPORT_WITH_NE_BROUGHT.test(
        "नेटवर्क डिस्कवरी आयात ने डिवाइसों के लिए जो मॉनिटर बनाए",
      ),
    ).toBe(false);
  });

  test("the moving-to-OneUptime pages say who brought what in the natural order", () => {
    const pages: Array<string> = markdownFiles(
      path.join(HINDI_DOCS, "moving-to-oneuptime"),
    ).filter((page: string): boolean => {
      return path.basename(page) !== "index.md";
    });

    expect(pages.length).toBeGreaterThanOrEqual(11);

    for (const page of pages) {
      const text: string = fs.readFileSync(page, "utf8");

      expect({
        page: path.basename(page),
        earlier: text.includes("कोई पिछला आयात उसे लाया था"),
        remembers: EACH_IMPORT_BROUGHT.test(text),
      }).toEqual({ page: path.basename(page), earlier: true, remembers: true });
    }
  });
});

describe("the Hindi docs read as the Dashboard draws it", () => {
  test("the network sites page's heading says what its bold label says", () => {
    const sites: string = readDocsPage("monitor/network-sites.md");

    expect(dashboardWord("Import from CSV")).toBe("CSV से आयात करें");
    expect(sites).toContain("### CSV फ़ाइल से साइटें आयात करें");
    expect(sites).toContain(`**${dashboardWord("Import from CSV")}**`);
  });

  test("every moving-to-OneUptime page names the import as the Dashboard draws it", () => {
    const pages: Array<string> = markdownFiles(
      path.join(HINDI_DOCS, "moving-to-oneuptime"),
    ).filter((page: string): boolean => {
      return path.basename(page) !== "index.md";
    });

    for (const page of pages) {
      const text: string = fs.readFileSync(page, "utf8");

      for (const label of ["Import from another tool", "Start import"]) {
        expect({
          page: path.basename(page),
          label,
          quoted: text.includes(`**${dashboardWord(label)}**`),
        }).toEqual({ page: path.basename(page), label, quoted: true });
      }

      expect({
        page: path.basename(page),
        heading: text.includes(`### ${dashboardWord("Start import")}`),
      }).toEqual({ page: path.basename(page), heading: true });
    }
  });

  test("the auto-import rules: the menu path, the heading and its anchor", () => {
    const devices: string = readDocsPage("monitor/network-device-monitor.md");

    expect(devices).toContain(`**${dashboardWord("Auto Import Rules")}**`);
    expect(devices).toContain("### ऑटो आयात नियमों से अपने-आप आयात करना");
    // Another page links to the heading by its new anchor.
    expect(readDocsPage("configuration/run-rules-now.md")).toContain(
      "/docs/monitor/network-device-monitor#ऑटो-आयात-नियमों-से-अपने-आप-आयात-करना",
    );
  });
});

/*
 * Where an export sits beside an import - the watchlist card's two buttons,
 * the JSON import dialog, Uptime Kuma's backup - it says निर्यात, as the
 * Dashboard's Export CSV and Export JSON do, so the pair reads निर्यात and
 * आयात rather than एक्सपोर्ट and आयात.
 */
describe("an export beside an import", () => {
  const EXPORT_LOANWORD: RegExp = /एक्सपोर्ट(?!र)/u;

  test("the watchlist card's buttons and the JSON import dialog say निर्यात", () => {
    expect(dashboardWord("Import Values")).toBe("मान आयात करें");
    expect(dashboardWord("Export Values")).toBe("मान निर्यात करें");
    expect(dashboardWord("Export CSV")).toBe("CSV निर्यात करें");
    expect(dashboardWord("Export JSON")).toBe("JSON निर्यात करें");

    const dialog: string = dashboardWord(
      "Upload a {{itemName}} JSON export, or paste it below, to create new {{itemsName}} here. Owners, labels and linked resources are not included.",
    );

    expect(dialog).toContain("निर्यात की गई JSON फ़ाइल");
    expect(EXPORT_LOANWORD.test(dialog)).toBe(false);
    expect(
      dashboardWord(
        "On Uptime Kuma 2, which has no export, add an API key under Settings, then API Keys. Open /metrics on your Uptime Kuma, sign in with no user name and the key as the password, and save the page as a text file.",
      ),
    ).toContain("जिसमें निर्यात नहीं है");
  });

  test("the docs that name both say निर्यात", () => {
    expect(readDocsPage("telemetry/security-events.md")).toContain(
      `**${dashboardWord("Export Values")}**`,
    );
    expect(readDocsPage("monitor/monitor-groups.md")).toContain(
      "JSON के रूप में निर्यात या आयात",
    );
    expect(readDocsPage("monitor/network-events.md")).toContain(
      "पाइपलाइन को अभी निर्यात और आयात नहीं किया जा सकता।",
    );

    const kuma: string = readDocsPage("moving-to-oneuptime/uptime-kuma.md");

    expect(kuma).toContain("वह बैकअप जो Uptime Kuma 1 निर्यात करता है");
    expect(kuma).toContain("बैकअप फिर से निर्यात करें");
    expect(EXPORT_LOANWORD.test(kuma)).toBe(false);
  });

  test("the export check tells the loanword from an exporter (negative control)", () => {
    expect(EXPORT_LOANWORD.test("मान एक्सपोर्ट करें")).toBe(true);
    expect(EXPORT_LOANWORD.test("OTLP एक्सपोर्टर")).toBe(false);
  });
});

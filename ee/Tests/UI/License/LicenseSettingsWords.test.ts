import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DAYS_LEFT,
  LICENSE_SETTINGS_PLURALS,
  LicenseSettingsCopy,
  LicenseStatusCopy,
  SALES_EMAIL,
} from "../../../AdminDashboard/License/LicenseSettingsCopy";
import { ADMIN_DASHBOARD_LANGUAGES } from "Common/Tests/Helpers/TranslatedLanguages";
import {
  GRACE_ENFORCEMENT_TEMPLATE,
  LICENSE_LAPSED_STATE,
  TRIAL_ENFORCEMENT_TEMPLATE,
} from "Common/UI/Components/EditionLabel/EditionLabel";
import { PluralTemplate } from "Common/UI/Utils/TranslateTemplate";

/*
 * SETTINGS > LICENSE'S WORDS, IN EVERY ADMIN DASHBOARD LANGUAGE (#7132).
 *
 * The Admin Dashboard's License settings page (ee/AdminDashboard/License/
 * LicenseSettingsView.tsx, its activation form LicenseActivationForm.tsx
 * and the status it reads off the server's answer, LicenseStatus.ts) was in
 * English on every page, around license cards that were already in the
 * reader's language. Every word of it is in LicenseSettingsCopy and
 * LicenseStatusCopy now, and each is an entry of every Admin Dashboard
 * locale:
 *
 *   - en.json holds each as written, the one form of a count under its
 *     plural's key plus "_one";
 *   - every other language words each its own way, keeping the English
 *     placeholders - the sales address ({{email}}) and the instance ID
 *     ({{instanceId}}) are drawn as written where the language puts them;
 *   - the page's new entries sit among the flat entries, before the
 *     markdownCallouts block, at the same place in every locale;
 *   - the page, its form and its status draw no English of their own: no
 *     sentence in the JSX, no label, title or placeholder written out, none
 *     of the copy written out again.
 */

type Locale = Record<string, unknown>;

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");
const LICENSE_FOLDER: string = path.join(
  REPOSITORY_ROOT,
  "ee/AdminDashboard/License",
);

const SOURCES: ReadonlyArray<string> = [
  "LicenseSettingsView.tsx",
  "LicenseActivationForm.tsx",
  "LicenseStatus.ts",
];

const readSource: (file: string) => string = (file: string): string => {
  return fs.readFileSync(path.join(LICENSE_FOLDER, file), "utf8");
};

const localeCache: Map<string, Locale> = new Map<string, Locale>();

const readLocale: (language: string) => Locale = (language: string): Locale => {
  const cached: Locale | undefined = localeCache.get(language);

  if (cached) {
    return cached;
  }

  const locale: Locale = JSON.parse(
    fs.readFileSync(
      path.join(
        REPOSITORY_ROOT,
        "packages/App/FeatureSet/AdminDashboard/src/Locales",
        `${language}.json`,
      ),
      "utf8",
    ),
  ) as Locale;

  localeCache.set(language, locale);

  return locale;
};

const OTHER_LANGUAGES: Array<string> = ADMIN_DASHBOARD_LANGUAGES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

// Each entry the page reads: its key and the English en.json holds for it.
interface Entry {
  key: string;
  english: string;
}

const textEntry: (text: string) => Entry = (text: string): Entry => {
  return { key: text, english: text };
};

const ENTRIES: Array<Entry> = [
  ...Object.values(LicenseSettingsCopy).map(textEntry),
  ...Object.values(LicenseStatusCopy).map(textEntry),
  // What stops, as the edition dialog says it: the page's notes.
  ...[
    TRIAL_ENFORCEMENT_TEMPLATE,
    GRACE_ENFORCEMENT_TEMPLATE,
    LICENSE_LAPSED_STATE,
  ].map(textEntry),
  ...LICENSE_SETTINGS_PLURALS.flatMap(
    (plural: PluralTemplate): Array<Entry> => {
      return [
        { key: plural.other, english: plural.other },
        { key: `${plural.other}_one`, english: plural.one },
      ];
    },
  ),
];

/*
 * The entries this page brought to the Admin Dashboard. The rest were its
 * words already - the edition dialog's sentences about the license, "Licensed
 * to", "Expires", "Cancel" - and sit where they were.
 */
const NEW_KEYS: ReadonlyArray<string> = [
  ...Object.values(LicenseSettingsCopy).filter((key: string): boolean => {
    return ![
      LicenseSettingsCopy.licensedTo,
      LicenseSettingsCopy.notSpecified,
      LicenseSettingsCopy.expires,
      LicenseSettingsCopy.cancel,
    ].includes(key);
  }),
  LicenseStatusCopy.renewThenRefreshHere,
  LicenseStatusCopy.evaluationActive,
  LicenseStatusCopy.enterpriseFeaturesOn,
  LicenseStatusCopy.storedButNotLicensing,
];

const PLACEHOLDER: RegExp = /\{\{\w+\}\}/g;

const placeholdersOf: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return (text.match(PLACEHOLDER) || []).sort();
};

interface Gaps {
  missing: Array<string>;
  english: Array<string>;
  placeholders: Array<string>;
}

const NO_GAPS: Gaps = { missing: [], english: [], placeholders: [] };

// What a language writes as English does: French says "Activation" too.
const MAY_READ_AS_ENGLISH: ReadonlyArray<string> = [
  `fr/${LicenseSettingsCopy.activation}`,
];

const gapsOf: (locale: Locale, language: string) => Gaps = (
  locale: Locale,
  language: string,
): Gaps => {
  const gaps: Gaps = { missing: [], english: [], placeholders: [] };

  for (const entry of ENTRIES) {
    const value: unknown = locale[entry.key];

    if (typeof value !== "string" || !value.trim()) {
      gaps.missing.push(entry.key);
      continue;
    }

    if (
      value === entry.english &&
      !MAY_READ_AS_ENGLISH.includes(`${language}/${entry.key}`)
    ) {
      gaps.english.push(entry.key);
    }

    if (placeholdersOf(value).join() !== placeholdersOf(entry.english).join()) {
      gaps.placeholders.push(entry.key);
    }
  }

  return gaps;
};

// A word: two letters or more, in any script.
const WORD: RegExp = /\p{L}{2,}/u;

// The source without its comments: block comments, and lines that are one.
const withoutComments: (source: string) => string = (
  source: string,
): string => {
  let code: string = "";
  let at: number = 0;

  while (at < source.length) {
    const start: number = source.indexOf("/*", at);

    if (start < 0) {
      code += source.slice(at);
      break;
    }

    code += source.slice(at, start);

    const end: number = source.indexOf("*/", start + 2);

    at = end < 0 ? source.length : end + 2;
  }

  return code
    .split("\n")
    .filter((line: string): boolean => {
      return !line.trimStart().startsWith("//");
    })
    .join("\n");
};

/*
 * JSX text with words in it - a sentence drawn as written, in English:
 * ">Validate License<". Comments are read out first; a value drawn in braces
 * ({props.instanceId}) is not text.
 */
const englishInJsx: (source: string) => Array<string> = (
  source: string,
): Array<string> => {
  const code: string = withoutComments(source);

  return Array.from(code.matchAll(/(?<![=-])>([^<>{}();=]*)</g))
    .map((match: RegExpMatchArray): string => {
      return (match[1] || "").trim();
    })
    .filter((text: string): boolean => {
      return WORD.test(text);
    });
};

/*
 * A label, title, tooltip, placeholder or description written out as a
 * string: title="Cancel". The words of a component's props are the copy's.
 */
const WORDED_ATTRIBUTE: RegExp =
  /\b(title|tooltip|placeholder|description|label|aria-label)="([^"]*)"/g;

const wordedAttributes: (source: string) => Array<string> = (
  source: string,
): Array<string> => {
  return Array.from(withoutComments(source).matchAll(WORDED_ATTRIBUTE))
    .map((match: RegExpMatchArray): string => {
      return `${match[1]}="${match[2]}"`;
    })
    .filter((attribute: string): boolean => {
      return WORD.test(attribute.slice(attribute.indexOf('"')));
    });
};

// The copy written out again as a string literal, bypassing the copy.
const copyWrittenOut: (source: string) => Array<string> = (
  source: string,
): Array<string> => {
  return ENTRIES.map((entry: Entry): string => {
    return entry.english;
  }).filter((english: string): boolean => {
    return (
      source.includes(`"${english}"`) ||
      source.includes(`'${english}'`) ||
      source.includes(`\`${english}\``)
    );
  });
};

describe("Settings > License's words", () => {
  test("are read from the copy (the scan is not empty)", () => {
    expect(Object.values(LicenseSettingsCopy).length).toBeGreaterThan(30);
    expect(Object.values(LicenseStatusCopy).length).toBeGreaterThan(30);
    expect(ENTRIES.length).toBeGreaterThan(65);
    expect(NEW_KEYS.length).toBe(31);
    expect(ENTRIES).toEqual(
      expect.arrayContaining([
        { key: "Refresh license", english: "Refresh license" },
        { key: "Validate License", english: "Validate License" },
        { key: "{{count}} days left_one", english: "{{count}} day left" },
      ]),
    );
    expect(DAYS_LEFT.other).toBe("{{count}} days left");
    expect(OTHER_LANGUAGES.length).toBe(17);
    expect(OTHER_LANGUAGES).toEqual(expect.arrayContaining(["ar", "fa", "ru"]));
  });

  test("are in the Admin Dashboard's en.json as written, each one form under its plural's key", () => {
    const english: Locale = readLocale("en");
    const apart: Array<string> = ENTRIES.filter((entry: Entry): boolean => {
      return english[entry.key] !== entry.english;
    }).map((entry: Entry): string => {
      return entry.key;
    });

    expect(apart).toEqual([]);
  });

  test.each(OTHER_LANGUAGES)(
    "%s words each its own way, keeping its placeholders",
    (language: string) => {
      expect({ language, ...gapsOf(readLocale(language), language) }).toEqual({
        language,
        ...NO_GAPS,
      });
    },
  );

  test("the page's new entries sit among the flat entries, at the same place in every locale", () => {
    const englishKeys: Array<string> = Object.keys(readLocale("en"));
    const anchor: number = englishKeys.indexOf("markdownCallouts");

    expect(anchor).toBeGreaterThan(0);

    for (const language of OTHER_LANGUAGES) {
      const keys: Array<string> = Object.keys(readLocale(language));
      const misplaced: Array<string> = NEW_KEYS.filter(
        (key: string): boolean => {
          return (
            keys.indexOf(key) < 0 ||
            keys.indexOf(key) !== englishKeys.indexOf(key) ||
            keys.indexOf(key) > keys.indexOf("markdownCallouts")
          );
        },
      );

      expect({ language, misplaced }).toEqual({ language, misplaced: [] });
    }
  });

  /*
   * A question in the help and the link to the token: Arabic and Persian ask
   * with "؟", Chinese and Japanese with a full-width "？" - never a Latin "?"
   * at the end of a word of theirs.
   */
  test.each([
    ["ar", "؟"],
    ["fa", "؟"],
    ["ja", "？"],
    ["zh-CN", "？"],
    ["zh-TW", "？"],
  ])("%s asks with %s", (language: string, mark: string) => {
    for (const key of [
      LicenseSettingsCopy.licenseKeyHelp,
      LicenseSettingsCopy.activateOfflineInstead,
    ]) {
      const value: string = String(readLocale(language)[key]);

      expect({ key, asks: value.includes(mark) }).toEqual({ key, asks: true });
      expect({ key, latin: value.includes("?") }).toEqual({
        key,
        latin: false,
      });
    }
  });

  test("leave the sales address and the instance ID to the page, as written", () => {
    for (const language of ADMIN_DASHBOARD_LANGUAGES) {
      const locale: Locale = readLocale(language);

      expect(String(locale[LicenseSettingsCopy.licenseKeyHelp])).not.toContain(
        SALES_EMAIL,
      );
      expect(
        placeholdersOf(String(locale[LicenseSettingsCopy.tokenInstanceId])),
      ).toEqual(["{{instanceId}}"]);
    }

    expect(SALES_EMAIL).toBe("sales@oneuptime.com");
  });

  test.each(SOURCES)("%s draws no English of its own", (file: string) => {
    const source: string = readSource(file);

    expect(englishInJsx(source)).toEqual([]);
    expect(wordedAttributes(source)).toEqual([]);
    expect(copyWrittenOut(withoutComments(source))).toEqual([]);
  });

  test("the scans read the page (it names the copy)", () => {
    expect(readSource("LicenseSettingsView.tsx")).toContain(
      "LicenseSettingsCopy.refreshLicense",
    );
    expect(readSource("LicenseActivationForm.tsx")).toContain(
      "LicenseSettingsCopy.validateLicense",
    );
    expect(readSource("LicenseStatus.ts")).toContain(
      "LicenseStatusCopy.licenseActive",
    );
  });
});

describe("the checks (negative controls)", () => {
  test("a word left out, left English or missing a placeholder is a gap", () => {
    const german: Locale = { ...readLocale("de") };

    delete german[LicenseSettingsCopy.refreshLicense];
    german[LicenseSettingsCopy.instanceId] = LicenseSettingsCopy.instanceId;
    german[LicenseSettingsCopy.tokenInstanceId] =
      "Ein Token funktioniert nur auf seiner Instanz.";

    expect(gapsOf(german, "de")).toEqual({
      missing: [LicenseSettingsCopy.refreshLicense],
      english: [LicenseSettingsCopy.instanceId],
      placeholders: [LicenseSettingsCopy.tokenInstanceId],
    });
  });

  test("French's own Activation is allowed; German's would not be", () => {
    const german: Locale = {
      ...readLocale("de"),
      [LicenseSettingsCopy.activation]: "Activation",
    };

    expect(gapsOf(readLocale("fr"), "fr")).toEqual(NO_GAPS);
    expect(gapsOf(german, "de").english).toEqual([
      LicenseSettingsCopy.activation,
    ]);
  });

  test("an English sentence in the JSX is seen; a comment and a value are not", () => {
    expect(
      englishInJsx(
        [
          "<p>",
          "  A token works only on the instance it was issued for.",
          "</p>",
          "{/* A comment <b>with words</b> */}",
          "<span>{props.instanceId}</span>",
          "<span>.</span>",
        ].join("\n"),
      ),
    ).toEqual(["A token works only on the instance it was issued for."]);
  });

  test("a label, title or placeholder written out is seen; one from the copy is not", () => {
    expect(
      wordedAttributes(
        [
          '<Button title="Cancel" dataTestId="cancel" />',
          '<Input placeholder="Enter your enterprise license key" />',
          "<Button title={LicenseSettingsCopy.cancel} />",
          '<div className="mt-1 text-sm" />',
        ].join("\n"),
      ),
    ).toEqual([
      'title="Cancel"',
      'placeholder="Enter your enterprise license key"',
    ]);
  });

  test("the copy written out again is seen", () => {
    expect(copyWrittenOut('return "License key";')).toEqual(["License key"]);
    expect(copyWrittenOut("LicenseSettingsCopy.licenseKey")).toEqual([]);
  });
});

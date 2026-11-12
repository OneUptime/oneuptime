import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  INSTANCE_USERS,
  INSTANCES,
  LICENSE_DETAILS_PLURALS,
  LicenseDetailsCopy,
  SEAT_LIMIT,
} from "../../../AdminDashboard/License/LicenseDetailsCopy";
import {
  ADMIN_DASHBOARD_LANGUAGES,
  DASHBOARD_LANGUAGES,
} from "Common/Tests/Helpers/TranslatedLanguages";
import { PluralTemplate } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE LICENSE DETAILS' WORDS, IN EVERY LANGUAGE (#6470).
 *
 * The edition dialog of the Admin Dashboard's header and the Dashboard's
 * footer is in the reader's language; on a licensed installation its seat
 * card and its instances on the license (ee/AdminDashboard/License/
 * LicenseDetails.tsx) were the one part still in English, with English
 * dates - and read right to left on an Arabic or Persian page, their full
 * stops at the wrong end. Every word of them is in LicenseDetailsCopy now,
 * and each is an entry of both apps that draw the details, in every
 * language each offers:
 *
 *   - en.json holds each as written, the one form of a count under its
 *     plural's key plus "_one";
 *   - every other language words each its own way, with the English
 *     placeholders and none lost;
 *   - the Admin Dashboard has them among its flat entries, before its
 *     markdownCallouts block, at the same place in every locale, and words
 *     them as its Dashboard does;
 *   - the details draw no English of their own: no sentence in the JSX,
 *     none of the copy written out again.
 */

type App = "Dashboard" | "AdminDashboard";
type Locale = Record<string, unknown>;

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

const DETAILS_SOURCE: string = path.join(
  REPOSITORY_ROOT,
  "ee/AdminDashboard/License/LicenseDetails.tsx",
);

const APPS: Record<App, ReadonlyArray<string>> = {
  Dashboard: DASHBOARD_LANGUAGES,
  AdminDashboard: ADMIN_DASHBOARD_LANGUAGES,
};

const APP_LANGUAGES: Array<[App, string]> = (
  Object.keys(APPS) as Array<App>
).flatMap((app: App): Array<[App, string]> => {
  return APPS[app].map((language: string): [App, string] => {
    return [app, language];
  });
});

const localeCache: Map<string, Locale> = new Map<string, Locale>();

const readLocale: (app: App, language: string) => Locale = (
  app: App,
  language: string,
): Locale => {
  const cacheKey: string = `${app}/${language}`;
  const cached: Locale | undefined = localeCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const locale: Locale = JSON.parse(
    fs.readFileSync(
      path.join(
        REPOSITORY_ROOT,
        "packages/App/FeatureSet",
        app,
        "src/Locales",
        `${language}.json`,
      ),
      "utf8",
    ),
  ) as Locale;

  localeCache.set(cacheKey, locale);

  return locale;
};

// Each entry the details read: its key and the English en.json holds for it.
interface Entry {
  key: string;
  english: string;
}

const ENTRIES: Array<Entry> = [
  ...Object.values(LicenseDetailsCopy).map((text: string): Entry => {
    return { key: text, english: text };
  }),
  ...LICENSE_DETAILS_PLURALS.flatMap((plural: PluralTemplate): Array<Entry> => {
    return [
      { key: plural.other, english: plural.other },
      { key: `${plural.other}_one`, english: plural.one },
    ];
  }),
];

const PLACEHOLDER: RegExp = /\{\{\w+\}\}/g;

const placeholdersOf: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return (text.match(PLACEHOLDER) || []).sort();
};

/*
 * What a language lacks of the details' words: an entry missing, one left
 * as its English, or one that lost or gained a placeholder.
 */
interface Gaps {
  missing: Array<string>;
  english: Array<string>;
  placeholders: Array<string>;
}

// What a language writes as English does: French counts "instances" too.
const MAY_READ_AS_ENGLISH: ReadonlyArray<string> = [
  `fr/${INSTANCES.other}`,
  `fr/${INSTANCES.other}_one`,
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

const NO_GAPS: Gaps = { missing: [], english: [], placeholders: [] };

/*
 * Words the Admin Dashboard says its own way. Persian: the card counts
 * "نمونه" (instances), as both apps' "{{count}} instances" do; the
 * Dashboard's "This instance" is an OpenStack VM's, "این اینستنس".
 */
const ADMIN_OWN_WORDING: ReadonlyArray<string> = [
  `fa/${LicenseDetailsCopy.thisInstance}`,
];

/*
 * An instance's users ("7 users") the Admin Dashboard had before these
 * details, for its backups (ee/AdminDashboard/Backups): worded its own way
 * in some languages ("7 个用户" beside the Dashboard's "7 位用户"), both
 * right.
 */
const ADMIN_HAD_BEFORE: ReadonlyArray<string> = [
  INSTANCE_USERS.other,
  `${INSTANCE_USERS.other}_one`,
];

/*
 * JSX text with words in it - a sentence drawn as written, in English:
 * ">Licensed seats<". Comments are read out first, so a comment's words do
 * not count; a value drawn in braces ({seatsRemainingText}) is not text.
 */
// A word: two letters or more, in any script.
const WORD: RegExp = /\p{L}{2,}/u;

const englishInJsx: (source: string) => Array<string> = (
  source: string,
): Array<string> => {
  const code: string = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  // Not an arrow's ">" (=> Array<string>): JSX text follows a tag's ">".
  return Array.from(code.matchAll(/(?<![=-])>([^<>{}();=]*)</g))
    .map((match: RegExpMatchArray): string => {
      return (match[1] || "").trim();
    })
    .filter((text: string): boolean => {
      return WORD.test(text);
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

describe("the license details' words", () => {
  test("are read from the copy (the scan is not empty)", () => {
    expect(Object.values(LicenseDetailsCopy).length).toBeGreaterThan(25);
    expect(LICENSE_DETAILS_PLURALS.length).toBeGreaterThan(8);
    expect(ENTRIES.length).toBeGreaterThan(45);
    expect(ENTRIES).toEqual(
      expect.arrayContaining([
        { key: "Licensed seats", english: "Licensed seats" },
        { key: "/ {{count}} seats_one", english: "/ {{count}} seat" },
        { key: "{{count}} users_one", english: "{{count}} user" },
      ]),
    );
    expect(APP_LANGUAGES.length).toBeGreaterThan(30);
    expect(APPS.AdminDashboard).toEqual(expect.arrayContaining(["ar", "fa"]));
  });

  test.each(Object.keys(APPS) as Array<App>)(
    "are in %s's en.json as written, each one form under its plural's key",
    (app: App) => {
      const english: Locale = readLocale(app, "en");
      const apart: Array<string> = ENTRIES.filter((entry: Entry): boolean => {
        return english[entry.key] !== entry.english;
      }).map((entry: Entry): string => {
        return entry.key;
      });

      expect({ app, apart }).toEqual({ app, apart: [] });
    },
  );

  test.each(APP_LANGUAGES)(
    "%s: %s words each its own way, keeping its placeholders",
    (app: App, language: string) => {
      expect({
        app,
        language,
        ...gapsOf(readLocale(app, language), language),
      }).toEqual({
        app,
        language,
        ...NO_GAPS,
      });
    },
  );

  test.each(ADMIN_DASHBOARD_LANGUAGES)(
    "AdminDashboard: %s says each as its Dashboard does",
    (language: string) => {
      const admin: Locale = readLocale("AdminDashboard", language);
      const dashboard: Locale = readLocale("Dashboard", language);
      const apart: Array<string> = ENTRIES.filter((entry: Entry): boolean => {
        return (
          admin[entry.key] !== dashboard[entry.key] &&
          !ADMIN_OWN_WORDING.includes(`${language}/${entry.key}`) &&
          !ADMIN_HAD_BEFORE.includes(entry.key)
        );
      }).map((entry: Entry): string => {
        return entry.key;
      });

      expect({ language, apart }).toEqual({ language, apart: [] });
    },
  );

  test("the Admin Dashboard's own wording is a wording (not an English left)", () => {
    for (const own of ADMIN_OWN_WORDING) {
      const language: string = own.slice(0, own.indexOf("/"));
      const key: string = own.slice(own.indexOf("/") + 1);
      const admin: unknown = readLocale("AdminDashboard", language)[key];

      expect(typeof admin).toBe("string");
      expect(admin).not.toBe(key);
      expect(admin).not.toBe(readLocale("Dashboard", language)[key]);
    }
  });

  test("sit among the Admin Dashboard's flat entries, at the same place in every locale", () => {
    const englishKeys: Array<string> = Object.keys(
      readLocale("AdminDashboard", "en"),
    );

    expect(englishKeys.indexOf("markdownCallouts")).toBeGreaterThan(0);

    for (const language of ADMIN_DASHBOARD_LANGUAGES) {
      const keys: Array<string> = Object.keys(
        readLocale("AdminDashboard", language),
      );
      const misplaced: Array<string> = ENTRIES.filter(
        (entry: Entry): boolean => {
          return (
            keys.indexOf(entry.key) !== englishKeys.indexOf(entry.key) ||
            keys.indexOf(entry.key) > keys.indexOf("markdownCallouts")
          );
        },
      ).map((entry: Entry): string => {
        return entry.key;
      });

      expect({ language, misplaced }).toEqual({ language, misplaced: [] });
    }
  });

  /*
   * After the seats in use, "37 / 50 seats": the slash belongs to the
   * sentence, so Russian and Arabic count "37 из 50", "37 من أصل 50".
   */
  test.each(APP_LANGUAGES)(
    "%s: %s writes the seat limit after the seats in use as one phrase",
    (app: App, language: string) => {
      const locale: Locale = readLocale(app, language);

      for (const key of [SEAT_LIMIT.other, `${SEAT_LIMIT.other}_one`]) {
        const phrase: string = String(locale[key]);

        expect({
          key,
          phrase,
          startsWithSlash: phrase.startsWith("/ "),
        }).toEqual({
          key,
          phrase,
          startsWithSlash: !["ru", "ar", "fa"].includes(language),
        });
      }
    },
  );

  test("the instances and an instance's users are both apps' existing words", () => {
    for (const app of Object.keys(APPS) as Array<App>) {
      const english: Locale = readLocale(app, "en");

      expect(english[INSTANCES.other]).toBe("{{count}} instances");
      expect(english[`${INSTANCE_USERS.other}_one`]).toBe("{{count}} user");
    }
  });

  test("the details draw no English sentence of their own", () => {
    const source: string = fs.readFileSync(DETAILS_SOURCE, "utf8");

    expect(englishInJsx(source)).toEqual([]);
    expect(copyWrittenOut(source)).toEqual([]);
    // The scan reads the details (negative control below: it would see text).
    expect(source).toContain("LicenseDetailsCopy.seatsTitle");
  });
});

describe("the checks (negative controls)", () => {
  test("a word left out, left English or missing a placeholder is a gap", () => {
    const german: Locale = {
      ...readLocale("AdminDashboard", "de"),
    };

    delete german[LicenseDetailsCopy.seatsTitle];
    german[LicenseDetailsCopy.unknownHost] = LicenseDetailsCopy.unknownHost;
    german[LicenseDetailsCopy.running] = "Läuft.";
    german[`${SEAT_LIMIT.other}_one`] = SEAT_LIMIT.one;

    expect(gapsOf(german, "de")).toEqual({
      missing: [LicenseDetailsCopy.seatsTitle],
      english: [LicenseDetailsCopy.unknownHost, `${SEAT_LIMIT.other}_one`],
      placeholders: [LicenseDetailsCopy.running],
    });
  });

  test("an English sentence in the JSX is seen; a comment and a value are not", () => {
    expect(
      englishInJsx(
        [
          '<h4 className="x">',
          "  Licensed seats",
          "</h4>",
          "{/* A comment <b>with words</b> */}",
          "<span>{seatsRemainingText}</span>",
          "<span>v{displayVersion}</span>",
          "<span>—</span>",
        ].join("\n"),
      ),
    ).toEqual(["Licensed seats"]);
  });

  test("the copy written out again is seen", () => {
    expect(copyWrittenOut('title={instance.host || "Unknown host"}')).toEqual([
      "Unknown host",
    ]);
    expect(copyWrittenOut("{LicenseDetailsCopy.unknownHost}")).toEqual([]);
  });
});

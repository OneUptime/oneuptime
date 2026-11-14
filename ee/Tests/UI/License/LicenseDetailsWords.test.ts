import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { BACKUP_PLURALS } from "../../../AdminDashboard/Backups/BackupsCopy";
import {
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
 * ">Licensed seats<". Comments are read out first, so a comment's words do
 * not count; a value drawn in braces ({seatsRemainingText}) is not text.
 */
const englishInJsx: (source: string) => Array<string> = (
  source: string,
): Array<string> => {
  const code: string = withoutComments(source);

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
        { key: "Users: {{count}}", english: "Users: {{count}}" },
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
          !ADMIN_OWN_WORDING.includes(`${language}/${entry.key}`)
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

  test("the instances are both apps' existing words", () => {
    for (const app of Object.keys(APPS) as Array<App>) {
      expect(readLocale(app, "en")[INSTANCES.other]).toBe(
        "{{count}} instances",
      );
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

/*
 * AN INSTANCE'S USERS BEGIN THEIR LINE (#7134).
 *
 * The end of an instance's row said its users with the Backups page's count
 * ("{{count}} users"), worded to sit inside a sentence ("3 projects, 12 users
 * and 140 monitors"): in Russian "пользователей: 7", lowercase where the
 * row's line begins. The row has a key of its own now, a label and its
 * figure ("Users: 7"), worded as a line's start in every language and alike
 * in both apps; the Backups count keeps its mid-sentence wording.
 */
describe("an instance's users (#7134)", () => {
  // The first letter of a line, in any script.
  const firstLetterOf: (text: string) => string = (text: string): string => {
    return (text.match(/\p{L}/u) || [""])[0] as string;
  };

  test("are a key of their own, not the Backups page's count", () => {
    expect(LicenseDetailsCopy.instanceUsers).toBe("Users: {{count}}");
    expect(LicenseDetailsCopy.instanceUsers).not.toBe(
      BACKUP_PLURALS.users.other,
    );

    const source: string = fs.readFileSync(DETAILS_SOURCE, "utf8");

    expect(source).toContain("LicenseDetailsCopy.instanceUsers");
    expect(source).not.toContain('"{{count}} users"');
    expect(source).not.toContain("INSTANCE_USERS");
  });

  test.each(APP_LANGUAGES)(
    "%s: %s begins the line with its label, never a lowercase letter",
    (app: App, language: string) => {
      const line: string = String(
        readLocale(app, language)[LicenseDetailsCopy.instanceUsers],
      );

      expect({ language, line, label: !line.startsWith("{{") }).toEqual({
        language,
        line,
        label: true,
      });
      expect({ language, line, lower: (/\p{Ll}/u).test(firstLetterOf(line)) })
        .toEqual({ language, line, lower: false });
    },
  );

  test("Russian: the line starts a line, and the Backups count stays mid-sentence", () => {
    for (const app of Object.keys(APPS) as Array<App>) {
      expect(readLocale(app, "ru")[LicenseDetailsCopy.instanceUsers]).toBe(
        "Пользователей: {{count}}",
      );
    }

    expect(readLocale("AdminDashboard", "ru")[BACKUP_PLURALS.users.other]).toBe(
      "пользователей: {{count}}",
    );
  });

  test("Chinese: both apps count users the same way", () => {
    for (const key of [
      BACKUP_PLURALS.users.other,
      `${BACKUP_PLURALS.users.other}_one`,
    ]) {
      expect(readLocale("AdminDashboard", "zh-CN")[key]).toBe(
        readLocale("Dashboard", "zh-CN")[key],
      );
      expect(readLocale("AdminDashboard", "zh-CN")[key]).toBe(
        "{{count}} 位用户",
      );
    }
  });

  test("only Russian's Admin words the users count apart from its Dashboard, for the Backups sentence", () => {
    const apart: Array<string> = ADMIN_DASHBOARD_LANGUAGES.filter(
      (language: string): boolean => {
        return [
          BACKUP_PLURALS.users.other,
          `${BACKUP_PLURALS.users.other}_one`,
        ].some((key: string): boolean => {
          return (
            readLocale("AdminDashboard", language)[key] !==
            readLocale("Dashboard", language)[key]
          );
        });
      },
    );

    expect(apart).toEqual(["ru"]);
  });

  test("the check sees a line that begins lowercase (negative control)", () => {
    expect((/\p{Ll}/u).test(firstLetterOf("пользователей: {{count}}"))).toBe(
      true,
    );
    expect((/\p{Ll}/u).test(firstLetterOf("用户数：{{count}}"))).toBe(false);
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

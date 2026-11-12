import {
  ExtractedString,
  scanSourceText,
} from "../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ACCOUNTS_LANGUAGES,
  ADMIN_DASHBOARD_LANGUAGES,
  DASHBOARD_LANGUAGES,
} from "Common/Tests/Helpers/TranslatedLanguages";

/*
 * THE EDITION BADGE'S WORDS, IN EVERY APP THAT DRAWS IT (#6470).
 *
 * Three apps draw the edition badge (Common/UI/Components/EditionLabel):
 * the sign-in pages (Accounts' Login and LoginWithSSO), the Admin
 * Dashboard's header and the Dashboard's footer. Each looks the badge's
 * words up in its own locale files, and only the Dashboard had them: the
 * sign-in pages and the Admin Dashboard said "Community Edition, Learn
 * more", the whole Community comparison, "Talk to Sales" and every license
 * notice in English in every language. The badge's words, and the update
 * status words its dialog borrows (UpdateStatus/UpdateStatusPill), are
 * entries of all three apps now, in all their languages:
 *
 *   - each worded in every language, but the two edition names, which every
 *     language but Arabic writes as the docs do: they are the product's
 *     names;
 *   - each said by Accounts and the Admin Dashboard as the same language's
 *     Dashboard says it;
 *   - the one forms of the counts beside their plurals;
 *   - before the markdownCallouts block, where the files keep their flat
 *     entries, at the same place in every locale of an app.
 *
 * The pill's tag says "Evaluation license", the dialog's own heading for
 * it: "Evaluation" is an SLO card's title too, which German words
 * "Auswertung" (assessing), never a license for trying OneUptime out.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../..");
const FEATURE_SET: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet",
);

const BADGE_FILES: ReadonlyArray<string> = [
  "packages/Common/UI/Components/EditionLabel/EditionLabel.tsx",
  "packages/Common/UI/Components/UpdateStatus/UpdateStatusPill.tsx",
];

type App = "Dashboard" | "Accounts" | "AdminDashboard";
type Locale = Record<string, unknown>;

const APPS: Record<App, ReadonlyArray<string>> = {
  Dashboard: DASHBOARD_LANGUAGES,
  Accounts: ACCOUNTS_LANGUAGES,
  AdminDashboard: ADMIN_DASHBOARD_LANGUAGES,
};

// Where each app draws the badge.
const DRAWN_IN: Record<App, ReadonlyArray<string>> = {
  Dashboard: ["Dashboard/src/Components/Footer/Footer.tsx"],
  Accounts: [
    "Accounts/src/Pages/Login.tsx",
    "Accounts/src/Pages/LoginWithSSO.tsx",
  ],
  AdminDashboard: ["AdminDashboard/src/Components/Header/Header.tsx"],
};

// The product's names, which every language but Arabic writes as English does.
const PRODUCT_NAMES: ReadonlyArray<string> = [
  "Community Edition",
  "Enterprise Edition",
];

const PLACEHOLDER: RegExp = /{{\s*\w+\s*}}/g;

const localeCache: Map<string, Locale> = new Map<string, Locale>();

function readLocale(app: App, language: string): Locale {
  const key: string = `${app}/${language}`;
  const cached: Locale | undefined = localeCache.get(key);

  if (cached) {
    return cached;
  }

  const locale: Locale = JSON.parse(
    fs.readFileSync(
      path.join(FEATURE_SET, app, "src/Locales", `${language}.json`),
      "utf8",
    ),
  ) as Locale;

  localeCache.set(key, locale);

  return locale;
}

const SCANS: Array<ReturnType<typeof scanSourceText>> = BADGE_FILES.map(
  (file: string): ReturnType<typeof scanSourceText> => {
    return scanSourceText(
      file,
      fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"),
      { kind: "ui" },
    );
  },
);

const ENTRIES: Array<ExtractedString> = SCANS.flatMap(
  (scan: ReturnType<typeof scanSourceText>): Array<ExtractedString> => {
    return scan.strings as Array<ExtractedString>;
  },
);

// Each count's one form, under its key plus "_one", with its English.
const ONE_FORMS: Map<string, string> = new Map<string, string>(
  ENTRIES.filter((entry: ExtractedString): boolean => {
    return entry.pluralOne !== undefined;
  }).map((entry: ExtractedString): [string, string] => {
    return [`${entry.text}_one`, entry.pluralOne as string];
  }),
);

// The badge's words, as the extractor reads them, and the one forms.
const BADGE_WORDS: Array<string> = [
  ...Array.from(
    new Set<string>(
      ENTRIES.map((entry: ExtractedString): string => {
        return entry.text;
      }),
    ),
  ),
  ...Array.from(ONE_FORMS.keys()),
];

const placeholdersOf: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return (text.match(PLACEHOLDER) || []).sort();
};

/*
 * The words `language` leaves as their English, or lacks: none but the
 * product's names, and Arabic words those too.
 */
function unworded(
  locale: Locale,
  english: Locale,
  language: string,
): Array<string> {
  return BADGE_WORDS.filter((key: string): boolean => {
    const value: unknown = locale[key];

    if (typeof value !== "string" || value.trim().length === 0) {
      return true;
    }

    if (value !== english[key]) {
      return false;
    }

    return language === "ar" || !PRODUCT_NAMES.includes(key);
  });
}

const APP_LANGUAGES: Array<[App, string]> = (
  Object.keys(APPS) as Array<App>
).flatMap((app: App): Array<[App, string]> => {
  return APPS[app].map((language: string): [App, string] => {
    return [app, language];
  });
});

describe("the edition badge's words", () => {
  test("are read from the badge and its update status, with nothing left hard-coded", () => {
    for (const scan of SCANS) {
      expect(scan.hardcoded).toEqual([]);
    }

    // Many: a scan that read nothing would pass the checks below.
    expect(BADGE_WORDS.length).toBeGreaterThan(120);
    expect(BADGE_WORDS).toEqual(
      expect.arrayContaining([
        "Community Edition",
        "Enterprise Edition",
        "Learn more",
        "Talk to Sales",
        "Close",
        "Manage license",
        "Enterprise Edition (Trial, {{daysLeft}})",
        "Enterprise Edition (Marketplace Reports Failing)",
        "{{count}} days left",
        "{{count}} days left_one",
        "Update available",
        "Read the upgrade guide",
        "Evaluation license",
      ]),
    );
    // The pill's name lists its words (#7133): no template of its own.
    expect(BADGE_WORDS).not.toContain(
      "{{edition}}, Evaluation license, {{action}}",
    );
    expect(ONE_FORMS.get("{{count}} days left_one")).toBe("{{count}} day left");
  });

  test("give the pill's tag as the license it is, not as an SLO card's Evaluation", () => {
    expect(BADGE_WORDS).not.toContain("Evaluation");
    expect(BADGE_WORDS).not.toContain("{{edition}}, Evaluation, {{action}}");

    for (const app of Object.keys(APPS) as Array<App>) {
      expect({
        app,
        oldTag: "{{edition}}, Evaluation, {{action}}" in readLocale(app, "en"),
        oldName:
          "{{edition}}, Evaluation license, {{action}}" in
          readLocale(app, "en"),
      }).toEqual({ app, oldTag: false, oldName: false });
    }

    expect(readLocale("Dashboard", "de")["Evaluation license"]).toBe(
      "Testlizenz",
    );
  });

  test.each(Object.keys(DRAWN_IN) as Array<App>)(
    "are drawn by %s",
    (app: App) => {
      for (const file of DRAWN_IN[app]) {
        expect({
          file,
          drawsTheBadge: fs
            .readFileSync(path.join(FEATURE_SET, file), "utf8")
            .includes("<EditionLabel"),
        }).toEqual({ file, drawsTheBadge: true });
      }
    },
  );

  test.each(Object.keys(APPS) as Array<App>)(
    "are English entries of %s, the counts' one forms the English one forms",
    (app: App) => {
      const english: Locale = readLocale(app, "en");
      const missing: Array<string> = BADGE_WORDS.filter(
        (key: string): boolean => {
          return typeof english[key] !== "string";
        },
      );
      const wrong: Array<string> = BADGE_WORDS.filter(
        (key: string): boolean => {
          const expected: string = ONE_FORMS.get(key) ?? key;

          return typeof english[key] === "string" && english[key] !== expected;
        },
      );

      expect({ app, missing, wrong }).toEqual({ app, missing: [], wrong: [] });
    },
  );

  test.each(APP_LANGUAGES)(
    "%s: %s words each, its placeholders kept",
    (app: App, language: string) => {
      const english: Locale = readLocale(app, "en");
      const locale: Locale = readLocale(app, language);
      const placeholdersChanged: Array<string> = BADGE_WORDS.filter(
        (key: string): boolean => {
          return (
            typeof locale[key] === "string" &&
            placeholdersOf(locale[key] as string).join() !==
              placeholdersOf(english[key] as string).join()
          );
        },
      );

      expect({
        app,
        language,
        unworded: unworded(locale, english, language),
        placeholdersChanged,
      }).toEqual({ app, language, unworded: [], placeholdersChanged: [] });
    },
  );

  test.each(
    APP_LANGUAGES.filter(([app]: [App, string]): boolean => {
      return app !== "Dashboard";
    }),
  )("%s: %s says each as its Dashboard does", (app: App, language: string) => {
    const locale: Locale = readLocale(app, language);
    const dashboard: Locale = readLocale("Dashboard", language);
    const apart: Array<string> = BADGE_WORDS.filter((key: string): boolean => {
      return locale[key] !== dashboard[key];
    });

    expect({ app, language, apart }).toEqual({ app, language, apart: [] });
  });

  test.each(["Accounts", "AdminDashboard"] as Array<App>)(
    "sit before %s's markdownCallouts block, at the same place in every locale",
    (app: App) => {
      const englishKeys: Array<string> = Object.keys(readLocale(app, "en"));
      const callouts: number = englishKeys.indexOf("markdownCallouts");

      expect(callouts).toBeGreaterThan(0);

      for (const language of APPS[app]) {
        const keys: Array<string> = Object.keys(readLocale(app, language));
        const misplaced: Array<string> = BADGE_WORDS.filter(
          (key: string): boolean => {
            return (
              keys.indexOf(key) !== englishKeys.indexOf(key) ||
              keys.indexOf(key) > keys.indexOf("markdownCallouts")
            );
          },
        );

        expect({ app, language, misplaced }).toEqual({
          app,
          language,
          misplaced: [],
        });
      }
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s quotes the buttons and switches it names by their own words",
    (language: string) => {
      const locale: Locale = readLocale("Dashboard", language);
      const talkToSales: string = locale["Talk to Sales"] as string;
      const requireSso: string = locale["Require SSO for Login"] as string;

      expect(
        locale[
          'Ready to unlock enterprise capabilities? Click "Talk to Sales" to start the conversation.'
        ],
      ).toContain(talkToSales);
      expect(
        locale[
          'SAML and OIDC single sign-on (SSO) for projects, status pages, and the whole instance, including "Require SSO for login".'
        ],
      ).toContain(requireSso);
    },
  );

  test("German calls the grace period a Kulanzfrist, as the docs and the other license pages do", () => {
    for (const app of Object.keys(APPS) as Array<App>) {
      const german: Locale = readLocale(app, "de");
      const otherWord: Array<string> = BADGE_WORDS.filter(
        (key: string): boolean => {
          return String(german[key]).includes("Kulanzzeitraum");
        },
      );

      expect({ app, otherWord }).toEqual({ app, otherWord: [] });
      expect(german["Grace period"]).toBe("Kulanzfrist");
    }
  });

  test("a word left in English, or missing, is caught", () => {
    const english: Locale = readLocale("Accounts", "en");
    const german: Locale = { ...readLocale("Accounts", "de") };

    expect(unworded(german, english, "de")).toEqual([]);

    german["Talk to Sales"] = "Talk to Sales";
    delete german["Learn more"];

    expect(unworded(german, english, "de")).toEqual(
      expect.arrayContaining(["Talk to Sales", "Learn more"]),
    );
    expect(unworded(german, english, "de")).toHaveLength(2);

    // Arabic words the product's names too.
    const arabic: Locale = {
      ...readLocale("Accounts", "ar"),
      "Community Edition": "Community Edition",
    };

    expect(unworded(arabic, english, "ar")).toEqual(["Community Edition"]);
  });
});

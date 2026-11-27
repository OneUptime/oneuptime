import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE ADMIN DASHBOARD'S HELP MENU AND FOOTER SAY WHAT THE DASHBOARD'S SAY
 * (#10942).
 *
 * The two apps keep their own locales, and the same entry read one way for
 * a server's admins and another way for everyone else: Portuguese "Conversar
 * no Slack" in the Admin Dashboard's Help menu and "Chat no Slack" in the
 * Dashboard's, Dutch "Help en ondersteuning" and "Hulp en ondersteuning" in
 * the footers, Italian "E-mail di supporto" and "Email di supporto", and so
 * on in twelve languages. Admin Dashboard > Settings > Help and Support,
 * which previews the Dashboard's Help menu, named the Italian entries the
 * Admin Dashboard's way too.
 *
 * One wording per language, the Dashboard's, which everyone on the server
 * reads:
 *
 *   - every help.* and footer.* key of the Admin Dashboard's locales is a
 *     key of the Dashboard's, worded as the Dashboard words it;
 *   - the settings page's preview of the Help menu, and the names of its
 *     rows for those entries, are the Dashboard's Help menu words.
 */

const FEATURE_SETS: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
);

const ADMIN_LOCALES: string = path.join(
  FEATURE_SETS,
  "AdminDashboard",
  "src",
  "Locales",
);

const DASHBOARD_LOCALES: string = path.join(
  FEATURE_SETS,
  "Dashboard",
  "src",
  "Locales",
);

const languagesIn: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
  return fs
    .readdirSync(directory)
    .filter((file: string): boolean => {
      return file.endsWith(".json");
    })
    .map((file: string): string => {
      return file.slice(0, -".json".length);
    })
    .sort();
};

const LANGUAGES: Array<string> = languagesIn(ADMIN_LOCALES);

type Locale = Record<string, unknown>;

const read: (directory: string, language: string) => Locale = (
  directory: string,
  language: string,
): Locale => {
  return JSON.parse(
    fs.readFileSync(path.join(directory, `${language}.json`), "utf8"),
  ) as Locale;
};

const section: (locale: Locale, name: string) => Record<string, unknown> = (
  locale: Locale,
  name: string,
): Record<string, unknown> => {
  const value: unknown = locale[name];

  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
};

// The sections of the Admin Dashboard's own Help menu and footer.
const SHARED_SECTIONS: ReadonlyArray<string> = ["help", "footer"];

/*
 * The settings page's preview of the Dashboard's Help menu: the key each
 * entry is looked up by in the Admin Dashboard, and the Dashboard's own key
 * for that entry. "Support Email" and "Request Demo" are also the names of
 * the page's rows for those entries.
 */
const PREVIEW_WORDS: ReadonlyArray<{ adminKey: string; dashboardKey: string }> =
  [
    { adminKey: "Support Email", dashboardKey: "help.supportEmail" },
    { adminKey: "Request Demo", dashboardKey: "help.requestDemo" },
    { adminKey: "Chat on Slack", dashboardKey: "help.chatSlack" },
    { adminKey: "Give feedback", dashboardKey: "help.giveFeedback" },
    { adminKey: "Keyboard shortcuts", dashboardKey: "keyboardShortcuts.title" },
    {
      adminKey: "Chat on Microsoft Teams",
      dashboardKey: "Chat on Microsoft Teams",
    },
    { adminKey: "Chat with Support", dashboardKey: "Chat with Support" },
  ];

// A key as i18next reads it: "help.chatSlack" in its section, or flat.
const lookUp: (locale: Locale, key: string) => unknown = (
  locale: Locale,
  key: string,
): unknown => {
  if (key in locale) {
    return locale[key];
  }

  let cursor: unknown = locale;

  for (const part of key.split(".")) {
    if (!cursor || typeof cursor !== "object") {
      return undefined;
    }

    cursor = (cursor as Record<string, unknown>)[part];
  }

  return cursor;
};

describe("the Admin Dashboard's Help menu and footer words", () => {
  test("every language of both apps is checked", () => {
    expect(LANGUAGES).toEqual(languagesIn(DASHBOARD_LOCALES));
    expect(LANGUAGES).toContain("en");
    expect(LANGUAGES.length).toBe(18);
  });

  test("the Admin Dashboard draws its Help menu and footer from these sections", () => {
    const admin: Locale = read(ADMIN_LOCALES, "en");

    expect(Object.keys(section(admin, "help")).sort()).toEqual([
      "chatSlack",
      "requestDemo",
      "supportEmail",
    ]);
    expect(Object.keys(section(admin, "footer")).length).toBeGreaterThan(5);
  });

  test.each(LANGUAGES)(
    "%s: every help.* and footer.* word of the Admin Dashboard is the Dashboard's",
    (language: string) => {
      const admin: Locale = read(ADMIN_LOCALES, language);
      const dashboard: Locale = read(DASHBOARD_LOCALES, language);
      const differences: Array<string> = [];

      for (const name of SHARED_SECTIONS) {
        const adminWords: Record<string, unknown> = section(admin, name);
        const dashboardWords: Record<string, unknown> = section(
          dashboard,
          name,
        );

        for (const key of Object.keys(adminWords)) {
          if (typeof adminWords[key] !== "string") {
            differences.push(`${name}.${key} is not text`);
            continue;
          }

          if (!(key in dashboardWords)) {
            differences.push(`${name}.${key} is not a key of the Dashboard`);
            continue;
          }

          if (adminWords[key] !== dashboardWords[key]) {
            differences.push(
              `${name}.${key}: "${String(adminWords[key])}" where the Dashboard says "${String(dashboardWords[key])}"`,
            );
          }
        }
      }

      expect(differences).toEqual([]);
    },
  );

  test.each(LANGUAGES)(
    "%s: the settings page previews the Help menu in the Dashboard's words",
    (language: string) => {
      const admin: Locale = read(ADMIN_LOCALES, language);
      const dashboard: Locale = read(DASHBOARD_LOCALES, language);

      for (const word of PREVIEW_WORDS) {
        const dashboardWord: unknown = lookUp(dashboard, word.dashboardKey);

        expect({ key: word.adminKey, isText: typeof dashboardWord }).toEqual({
          key: word.adminKey,
          isText: "string",
        });
        expect({ key: word.adminKey, word: admin[word.adminKey] }).toEqual({
          key: word.adminKey,
          word: dashboardWord,
        });
      }
    },
  );

  test("the words the issue named now read one way in both apps", () => {
    const expectations: ReadonlyArray<{
      language: string;
      key: string;
      word: string;
    }> = [
      { language: "pt", key: "help.chatSlack", word: "Chat no Slack" },
      { language: "pt", key: "help.requestDemo", word: "Solicitar demo" },
      { language: "nl", key: "help.chatSlack", word: "Chat op Slack" },
      {
        language: "nl",
        key: "footer.helpSupport",
        word: "Hulp en ondersteuning",
      },
      { language: "no", key: "help.supportEmail", word: "Støtte-e-post" },
      { language: "it", key: "help.requestDemo", word: "Richiedi una demo" },
      { language: "it", key: "help.supportEmail", word: "Email di supporto" },
      {
        language: "ru",
        key: "footer.helpSupport",
        word: "Помощь и поддержка",
      },
    ];

    for (const expectation of expectations) {
      expect({
        ...expectation,
        admin: lookUp(
          read(ADMIN_LOCALES, expectation.language),
          expectation.key,
        ),
        dashboard: lookUp(
          read(DASHBOARD_LOCALES, expectation.language),
          expectation.key,
        ),
      }).toEqual({
        ...expectation,
        admin: expectation.word,
        dashboard: expectation.word,
      });
    }
  });
});

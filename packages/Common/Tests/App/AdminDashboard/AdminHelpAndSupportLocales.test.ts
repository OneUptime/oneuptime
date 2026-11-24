import {
  HELP_ITEM_COPY,
  HelpAndSupportCopy,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/HelpAndSupport/HelpAndSupportCopy";
import {
  HELP_ITEMS,
  HelpAndSupportProblems,
  HelpItem,
} from "../../../Types/HelpAndSupport/HelpAndSupport";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ADMIN DASHBOARD > SETTINGS > HELP AND SUPPORT IN EVERY LANGUAGE
 * (#10864, #10865, #10866).
 *
 * Every sentence the page draws - its cards, each place's name and where it
 * appears, the pills, the dialog's choices, hints and placeholders, the
 * previews and every refusal the server or the page can say - is a key of
 * each of the Admin Dashboard's locales, translated (not left in English,
 * but for addresses and names a language writes as English does), with its
 * {{placeholders}} kept. The side menu entry and the trail's word are the
 * Dashboard footer's own "Help and Support", in every language.
 */

const APP_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
);

const ADMIN_LOCALES: string = path.join(
  APP_SRC,
  "AdminDashboard",
  "src",
  "Locales",
);
const DASHBOARD_LOCALES: string = path.join(
  APP_SRC,
  "Dashboard",
  "src",
  "Locales",
);

const LANGUAGES: Array<string> = fs
  .readdirSync(ADMIN_LOCALES)
  .filter((file: string): boolean => {
    return file.endsWith(".json");
  })
  .map((file: string): string => {
    return file.replace(/\.json$/, "");
  })
  .sort();

const read: (directory: string, language: string) => Record<string, unknown> = (
  directory: string,
  language: string,
): Record<string, unknown> => {
  return JSON.parse(
    fs.readFileSync(path.join(directory, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
};

const nested: (locale: Record<string, unknown>, key: string) => unknown = (
  locale: Record<string, unknown>,
  key: string,
): unknown => {
  let cursor: unknown = locale;

  for (const part of key.split(".")) {
    if (!cursor || typeof cursor !== "object") {
      return undefined;
    }

    cursor = (cursor as Record<string, unknown>)[part];
  }

  return cursor;
};

// Each key the page looks up, which is the English it stands for.
const SENTENCES: Array<string> = Array.from(
  new Set<string>([
    ...Object.values(HelpAndSupportCopy),
    ...HELP_ITEMS.flatMap((item: HelpItem): Array<string> => {
      return [HELP_ITEM_COPY[item].title, HELP_ITEM_COPY[item].where];
    }),
    ...Object.values(HelpAndSupportProblems),
    // The Help menu preview's own entries, worded as the Dashboard's.
    "Give feedback",
    "Keyboard shortcuts",
    // A read the page could not make sense of.
    "The server did not answer with its help and support settings.",
  ]),
);

/*
 * Written as English does in every language: an address and a link people
 * replace with their own.
 */
const READ_AS_WRITTEN: ReadonlyArray<string> = [
  HelpAndSupportCopy.emailPlaceholder,
  HelpAndSupportCopy.linkPlaceholder,
];

const placeholders: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return Array.from(text.matchAll(/\{\{\s*(\w+)\s*\}\}/g))
    .map((match: RegExpMatchArray): string => {
      return match[1] as string;
    })
    .sort();
};

describe("Settings > Help and Support in every language", () => {
  test("every Admin Dashboard language is checked", () => {
    expect(LANGUAGES).toContain("en");
    expect(LANGUAGES.length).toBe(18);
    expect(SENTENCES.length).toBeGreaterThan(60);
  });

  test.each(LANGUAGES)(
    "%s has every sentence of the page, with its placeholders",
    (language: string) => {
      const locale: Record<string, unknown> = read(ADMIN_LOCALES, language);

      for (const sentence of SENTENCES) {
        const value: unknown = locale[sentence];

        expect({ sentence, isText: typeof value === "string" }).toEqual({
          sentence,
          isText: true,
        });
        expect({
          sentence,
          placeholders: placeholders(value as string),
        }).toEqual({ sentence, placeholders: placeholders(sentence) });

        if (language === "en") {
          expect(value).toBe(sentence);
        }
      }
    },
  );

  test.each(
    LANGUAGES.filter((language: string): boolean => {
      return language !== "en";
    }),
  )(
    "%s translates the page's sentences, not leaving them in English",
    (language: string) => {
      const locale: Record<string, unknown> = read(ADMIN_LOCALES, language);
      const untranslated: Array<string> = SENTENCES.filter(
        (sentence: string): boolean => {
          return (
            !READ_AS_WRITTEN.includes(sentence) &&
            sentence.split(" ").length > 2 &&
            locale[sentence] === sentence
          );
        },
      );

      expect(untranslated).toEqual([]);
    },
  );

  test.each(LANGUAGES)(
    "%s keeps the addresses and links people replace as written",
    (language: string) => {
      const locale: Record<string, unknown> = read(ADMIN_LOCALES, language);

      for (const sentence of READ_AS_WRITTEN) {
        expect(locale[sentence]).toBe(sentence);
      }
    },
  );

  test.each(LANGUAGES)(
    "%s has the side menu entry and the trail's word, the Dashboard footer's own",
    (language: string) => {
      const admin: Record<string, unknown> = read(ADMIN_LOCALES, language);
      const dashboard: Record<string, unknown> = read(
        DASHBOARD_LOCALES,
        language,
      );
      const sideMenu: unknown = nested(
        admin,
        "sideMenu.settingsHelpAndSupport",
      );
      const breadcrumb: unknown = nested(admin, "breadcrumbs.helpAndSupport");

      expect(typeof sideMenu).toBe("string");
      expect(breadcrumb).toBe(sideMenu);
      expect(sideMenu).toBe(nested(dashboard, "footer.helpSupport"));

      if (language === "en") {
        expect(sideMenu).toBe("Help and Support");
      }
    },
  );

  test.each(LANGUAGES)(
    "%s words the preview's chat entry as the Dashboard's Help menu does",
    (language: string) => {
      const admin: Record<string, unknown> = read(ADMIN_LOCALES, language);
      const dashboard: Record<string, unknown> = read(
        DASHBOARD_LOCALES,
        language,
      );

      expect(admin[HelpAndSupportCopy.chatOnSlack]).toBe(
        nested(dashboard, "help.chatSlack"),
      );
    },
  );
});

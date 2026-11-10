import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import {
  MARKDOWN_CALLOUT_KINDS,
  MarkdownCalloutKind,
} from "../../../UI/Components/Markdown.tsx/MarkdownCallouts";
import {
  MARKDOWN_CALLOUT_STYLES,
  getMarkdownCalloutName,
} from "../../../UI/Components/Markdown.tsx/MarkdownQuote";
import {
  DASHBOARD_LANGUAGES,
  DOCS_LANGUAGES,
} from "../../Helpers/TranslatedLanguages";

/*
 * What a screen reader calls a callout in Markdown - "> [!NOTE]" in a note,
 * a status page's description, a form's thank-you message - in every
 * frontend and language.
 *
 * The callouts used to look their names up under the shared words: the
 * Dashboard's "Note" is a note somebody wrote ("Notiz" in German, where a
 * callout is a "Hinweis"), and its "Warning" and "Info" were English in
 * most languages because the docs and other pages pin those words where
 * they name a status. Each kind now has a key of its own,
 * markdownCallouts.<kind>, in every frontend that draws Markdown, worded
 * as the docs name their callouts.
 */

const APP_FEATURE_SETS: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet",
);

const FRONTENDS: Array<string> = [
  "Dashboard",
  "StatusPage",
  "Accounts",
  "AdminDashboard",
];

const LANGUAGES: Array<string> = ["en", ...DASHBOARD_LANGUAGES];

// The languages the docs are written in: Arabic's docs are English (#6466).
const LANGUAGES_WITH_DOCS: Array<string> = LANGUAGES.filter(
  (language: string): boolean => {
    return language === "en" || DOCS_LANGUAGES.includes(language);
  },
);

const LANGUAGES_WITHOUT_DOCS: Array<string> = LANGUAGES.filter(
  (language: string): boolean => {
    return !LANGUAGES_WITH_DOCS.includes(language);
  },
);

type LocaleFile = Record<string, unknown>;

function readJson(file: string): LocaleFile {
  return JSON.parse(fs.readFileSync(file, "utf8")) as LocaleFile;
}

function frontendLocale(frontend: string, language: string): LocaleFile {
  return readJson(
    path.join(APP_FEATURE_SETS, frontend, "src", "Locales", `${language}.json`),
  );
}

// The docs' own callout names (calloutNote, calloutTip, ...) in a language.
function docsCalloutNames(
  language: string,
): Record<MarkdownCalloutKind, string> {
  const find: (value: unknown) => LocaleFile | null = (
    value: unknown,
  ): LocaleFile | null => {
    if (!value || typeof value !== "object") {
      return null;
    }

    const record: LocaleFile = value as LocaleFile;

    if (typeof record["calloutNote"] === "string") {
      return record;
    }

    for (const child of Object.values(record)) {
      const found: LocaleFile | null = find(child);

      if (found) {
        return found;
      }
    }

    return null;
  };

  const block: LocaleFile | null = find(
    readJson(
      path.join(APP_FEATURE_SETS, "Docs", "Locales", `${language}.json`),
    ),
  );

  expect(block).not.toBeNull();

  const names: Partial<Record<MarkdownCalloutKind, string>> = {};

  for (const kind of MARKDOWN_CALLOUT_KINDS) {
    names[kind] = block![
      `callout${kind.charAt(0).toUpperCase()}${kind.slice(1)}`
    ] as string;
  }

  return names as Record<MarkdownCalloutKind, string>;
}

describe("every frontend names each callout with a key of its own", () => {
  test.each(FRONTENDS)(
    "%s's English is the viewer's English",
    (frontend: string) => {
      const names: unknown = frontendLocale(frontend, "en")["markdownCallouts"];
      const expected: Record<string, string> = {};

      for (const kind of MARKDOWN_CALLOUT_KINDS) {
        expected[kind] = MARKDOWN_CALLOUT_STYLES[kind].label;
      }

      expect(names).toEqual(expected);
    },
  );

  test.each(
    FRONTENDS.flatMap((frontend: string): Array<[string, string]> => {
      return LANGUAGES_WITH_DOCS.map((language: string): [string, string] => {
        return [frontend, language];
      });
    }),
  )(
    "%s in %s names them as the docs do",
    (frontend: string, language: string) => {
      expect(frontendLocale(frontend, language)["markdownCallouts"]).toEqual(
        docsCalloutNames(language),
      );
    },
  );

  /*
   * A language without docs of its own (Arabic) names each callout in its
   * own words, and every frontend alike.
   */
  test("every language has docs of its own but Arabic", () => {
    expect(LANGUAGES_WITHOUT_DOCS).toEqual(["ar"]);
  });

  test.each(
    FRONTENDS.flatMap((frontend: string): Array<[string, string]> => {
      return LANGUAGES_WITHOUT_DOCS.map(
        (language: string): [string, string] => {
          return [frontend, language];
        },
      );
    }),
  )(
    "%s in %s names them in its own words, as the Dashboard does",
    (frontend: string, language: string) => {
      const names: Record<string, string> = frontendLocale(frontend, language)[
        "markdownCallouts"
      ] as Record<string, string>;
      const english: Record<string, string> = frontendLocale(frontend, "en")[
        "markdownCallouts"
      ] as Record<string, string>;

      expect(names).toEqual(
        frontendLocale("Dashboard", language)["markdownCallouts"],
      );
      expect(Object.keys(names).sort()).toEqual(
        [...MARKDOWN_CALLOUT_KINDS].sort(),
      );

      for (const kind of MARKDOWN_CALLOUT_KINDS) {
        expect([kind, names[kind] !== english[kind]]).toEqual([kind, true]);
      }

      // Each callout has a name of its own.
      expect(new Set(Object.values(names)).size).toBe(
        MARKDOWN_CALLOUT_KINDS.length,
      );
    },
  );

  test("Arabic names its callouts as Arabic technical docs do", () => {
    expect(frontendLocale("Dashboard", "ar")["markdownCallouts"]).toEqual({
      note: "ملاحظة",
      tip: "نصيحة",
      important: "مهم",
      warning: "تحذير",
      caution: "تنبيه",
      danger: "خطر",
      info: "معلومات",
    });
  });

  test("the shared words keep their own meaning in the Dashboard", () => {
    const german: LocaleFile = frontendLocale("Dashboard", "de");

    // A note somebody wrote is a "Notiz"; a callout is a "Hinweis".
    expect(german["Note"]).toBe("Notiz");
    expect((german["markdownCallouts"] as LocaleFile)["note"]).toBe("Hinweis");
  });
});

describe("the viewer reads the callout's own key", () => {
  const instances: Record<string, i18n> = {};

  beforeAll(async () => {
    for (const frontend of FRONTENDS) {
      for (const language of ["de", "ja", "fa"]) {
        const instance: i18n = createInstance();

        await instance.init({
          lng: language,
          fallbackLng: "en",
          resources: {
            en: { translation: frontendLocale(frontend, "en") },
            [language]: { translation: frontendLocale(frontend, language) },
          },
          interpolation: { escapeValue: false },
        });

        instances[`${frontend}:${language}`] = instance;
      }
    }
  });

  test.each(
    FRONTENDS.flatMap((frontend: string): Array<[string, string]> => {
      return ["de", "ja", "fa"].map((language: string): [string, string] => {
        return [frontend, language];
      });
    }),
  )("%s in %s", (frontend: string, language: string) => {
    const instance: i18n = instances[`${frontend}:${language}`]!;
    const docs: Record<MarkdownCalloutKind, string> =
      docsCalloutNames(language);

    for (const kind of MARKDOWN_CALLOUT_KINDS) {
      expect(getMarkdownCalloutName(instance.t, kind)).toBe(docs[kind]);
    }
  });

  test("a frontend without the keys reads the English", async () => {
    const bare: i18n = createInstance();

    await bare.init({
      lng: "de",
      fallbackLng: "en",
      resources: { de: { translation: { Note: "Notiz" } } },
    });

    for (const kind of MARKDOWN_CALLOUT_KINDS) {
      expect(getMarkdownCalloutName(bare.t, kind)).toBe(
        MARKDOWN_CALLOUT_STYLES[kind].label,
      );
    }
  });
});

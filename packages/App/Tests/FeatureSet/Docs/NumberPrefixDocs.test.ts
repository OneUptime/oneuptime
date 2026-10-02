import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Number prefixes moved from a page called More Settings to a page of their
 * own, Number Prefix, in Incidents, Alerts and Scheduled Maintenance. The
 * incident docs describe that page in 17 languages: English and Persian in
 * full, the other 15 in an older translation of the settings page. Markdown
 * is not compiled, so nothing else notices a doc that still sends readers to
 * a page that is gone.
 *
 * Every language must send readers to Number Prefix - named the way that
 * language's dashboard names it (Persian keeps the English names, as its
 * incident pages do) - at its new address, and must never send them to More
 * Settings, whose old address is mentioned only as one that forwards.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");
const LOCALES_DIR: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: ReadonlyArray<string> = [
  "en",
  "fa",
  "da",
  "de",
  "es",
  "fr",
  "hi",
  "it",
  "ja",
  "ko",
  "nl",
  "no",
  "pt",
  "ru",
  "sv",
  "zh-CN",
  "zh-TW",
];

// The languages whose incident docs name the UI in English.
const ENGLISH_UI_NAMES: ReadonlyArray<string> = ["en", "fa"];

// What each language called More Settings, from the locale files before it went.
const MORE_SETTINGS: Record<string, string> = {
  en: "More Settings",
  fa: "More Settings",
  da: "Flere indstillinger",
  de: "Weitere Einstellungen",
  es: "Más Ajustes",
  fr: "Plus de paramètres",
  hi: "अधिक सेटिंग्स",
  it: "Altre impostazioni",
  ja: "その他の設定",
  ko: "기타 설정",
  nl: "Meer instellingen",
  no: "Flere innstillinger",
  pt: "Mais configurações",
  ru: "Дополнительные настройки",
  sv: "Fler inställningar",
  "zh-CN": "更多设置",
  "zh-TW": "更多設定",
};

const SETTINGS_PAGE: string = "incidents/settings";
const DECLARING_PAGE: string = "incidents/declaring-incidents";
const OVERVIEW_PAGE: string = "incidents/index";
const PAGES: ReadonlyArray<string> = [
  SETTINGS_PAGE,
  DECLARING_PAGE,
  OVERVIEW_PAGE,
];

const NEW_ADDRESS: string =
  "/dashboard/{projectId}/incidents/settings/number-prefix";
const OLD_ADDRESS: string = "/dashboard/{projectId}/incidents/settings/more";
// How the docs mention the old address: as one that forwards.
const OLD_ADDRESS_MENTION: string = "`…/settings/more`";

function readPage(page: string, language: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${page}.md`),
    "utf8",
  );
}

function locale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

// The name the reader sees for a piece of UI, in the docs' language.
function uiName(language: string, english: string): string {
  if (ENGLISH_UI_NAMES.includes(language)) {
    return english;
  }

  const name: string | undefined = locale(language)[english];

  expect({ language, english, translated: Boolean(name) }).toEqual({
    language,
    english,
    translated: true,
  });

  return name as string;
}

function count(text: string, part: string): number {
  return text.split(part).length - 1;
}

describe("the docs send readers to Number Prefix, never to More Settings", () => {
  it("covers all 17 docs languages", () => {
    const languages: Array<string> = fs
      .readdirSync(CONTENT_DIR, { withFileTypes: true })
      .filter((entry: fs.Dirent): boolean => {
        return (
          entry.isDirectory() &&
          fs.existsSync(
            path.join(CONTENT_DIR, entry.name, `${SETTINGS_PAGE}.md`),
          )
        );
      })
      .map((entry: fs.Dirent): string => {
        return entry.name;
      })
      .sort();

    expect(languages).toEqual([...LANGUAGES].sort());
  });

  it.each(LANGUAGES)(
    "%s: no page gives the old address or a path to More Settings",
    (language: string) => {
      for (const page of PAGES) {
        const markdown: string = readPage(page, language);

        expect({
          language,
          page,
          oldAddress: markdown.includes(OLD_ADDRESS),
          pathToMoreSettings: markdown.includes(
            `→ ${MORE_SETTINGS[language]}**`,
          ),
        }).toEqual({
          language,
          page,
          oldAddress: false,
          pathToMoreSettings: false,
        });
      }
    },
  );

  it.each(LANGUAGES)(
    "%s: More Settings is named only where its old address is said to forward",
    (language: string) => {
      const oldName: string = `**${MORE_SETTINGS[language]}**`;
      const settings: string = readPage(SETTINGS_PAGE, language);

      expect(count(settings, oldName)).toBe(1);
      expect(count(settings, OLD_ADDRESS_MENTION)).toBe(1);

      const sentence: string =
        settings.split("\n").find((line: string): boolean => {
          return line.includes(oldName);
        }) || "";

      expect(sentence).toContain(OLD_ADDRESS_MENTION);

      for (const page of [DECLARING_PAGE, OVERVIEW_PAGE]) {
        expect({
          language,
          page,
          mentions: count(readPage(page, language), oldName),
        }).toEqual({ language, page, mentions: 0 });
      }
    },
  );

  it.each(LANGUAGES)(
    "%s: the settings and declaring pages give the path to Number Prefix, in the reader's words",
    (language: string) => {
      const pageName: string = uiName(language, "Number Prefix");

      for (const page of [SETTINGS_PAGE, DECLARING_PAGE]) {
        expect({
          language,
          page,
          path: readPage(page, language).includes(`→ ${pageName}**`),
        }).toEqual({ language, page, path: true });
      }

      expect(readPage(SETTINGS_PAGE, language)).toContain(NEW_ADDRESS);
    },
  );

  it.each(LANGUAGES)(
    "%s: the settings table and the overview's Settings row list Number Prefix",
    (language: string) => {
      const pageName: string = uiName(language, "Number Prefix");

      expect(
        readPage(SETTINGS_PAGE, language)
          .split("\n")
          .some((line: string): boolean => {
            return line.startsWith(`| **${pageName}**`);
          }),
      ).toBe(true);
      expect(readPage(OVERVIEW_PAGE, language)).toContain(`**${pageName}**`);
    },
  );

  it.each(LANGUAGES)(
    "%s: names the dialog and its fields as the dashboard does",
    (language: string) => {
      const settings: string = readPage(SETTINGS_PAGE, language);
      const declaring: string = readPage(DECLARING_PAGE, language);

      for (const english of [
        "Update",
        "Edit Number Prefix",
        "Incident Number Prefix",
        "Incident Episode Number Prefix",
      ]) {
        expect({
          language,
          english,
          inSettings: settings.includes(`**${uiName(language, english)}**`),
        }).toEqual({ language, english, inSettings: true });
      }

      for (const english of ["Incident Number Prefix", "Update"]) {
        expect({
          language,
          english,
          inDeclaring: declaring.includes(`**${uiName(language, english)}**`),
        }).toEqual({ language, english, inDeclaring: true });
      }
    },
  );

  /*
   * What the old page's docs never said, and the page now does: what a
   * prefix may hold, and that existing numbers stay as they are.
   */
  it.each(LANGUAGES)(
    "%s: the settings page states the rules and the example the dialog uses",
    (language: string) => {
      const settings: string = readPage(SETTINGS_PAGE, language);

      for (const part of [
        "20",
        "`-` `_` `.` `/` `:` `#`",
        "`SEV1`",
        "`SEV142`",
        "`INC-42`",
        "`#42`",
        "`incidentNumberWithPrefix`",
      ]) {
        expect({ language, part, stated: settings.includes(part) }).toEqual({
          language,
          part,
          stated: true,
        });
      }
    },
  );

  it.each(LANGUAGES)(
    "%s: says alerts and scheduled maintenance have the same page",
    (language: string) => {
      const settings: string = readPage(SETTINGS_PAGE, language);
      const pageName: string = uiName(language, "Number Prefix");

      // Every path that ends at a Number Prefix page.
      const paths: Array<string> = Array.from(
        settings.matchAll(/\*\*([^*\n]+?) → ([^*\n]+?) → ([^*\n]+?)\*\*/g),
      )
        .filter((match: RegExpMatchArray): boolean => {
          return match[3] === pageName;
        })
        .map((match: RegExpMatchArray): string => {
          return match[1] as string;
        });

      expect({ language, products: paths.length }).toEqual({
        language,
        products: 3,
      });
      expect(paths).toContain(uiName(language, "Alerts"));
      expect(paths).toContain(uiName(language, "Scheduled Maintenance"));
    },
  );
});

describe("English and Persian describe the page in full", () => {
  it.each(ENGLISH_UI_NAMES)(
    "%s: the Number prefixes section covers the card, the preview, the rules and who can change it",
    (language: string) => {
      const settings: string = readPage(SETTINGS_PAGE, language);

      for (const part of [
        "**Incidents**",
        "**Incident Episodes**",
        "**Example:**",
        "**No prefix**",
        "**Preview:**",
        "**Edit Project**",
        "`INC-`",
        "`IE-`",
        "`ALT-`",
        "`AE-`",
        "`SM-`",
        "`OPS-42`",
        "`INC-41`",
      ]) {
        expect({ language, part, stated: settings.includes(part) }).toEqual({
          language,
          part,
          stated: true,
        });
      }
    },
  );

  it("en: links from the declaring page to the rules", () => {
    expect(readPage(DECLARING_PAGE, "en")).toContain(
      "[Number prefixes](/docs/incidents/settings#number-prefixes)",
    );
    expect(readPage(SETTINGS_PAGE, "en")).toContain("\n## Number prefixes\n");
  });

  it("fa: links from the declaring page to the rules, by the section's own heading", () => {
    expect(readPage(DECLARING_PAGE, "fa")).toContain(
      "(/docs/incidents/settings#پیشوندهای-شماره)",
    );
    expect(readPage(SETTINGS_PAGE, "fa")).toContain("\n## پیشوندهای شماره\n");
  });
});

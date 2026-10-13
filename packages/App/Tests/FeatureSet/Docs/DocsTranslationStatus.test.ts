import DocsTranslations, {
  ENGLISH_COPY_SHARE,
  UNTRANSLATED_PAGE_MARKER,
  getSentences,
  isEnglishCopy,
} from "../../../FeatureSet/Docs/Utils/Translations";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  DOCS_LANGUAGES,
  NAV_PAGES,
  TRANSLATED_LANGUAGES,
  hasPage,
  listPages,
  readPage,
} from "./DocsContentSupport";
import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import type * as Path from "path";
import type * as FileSystem from "fs";

/*
 * Which languages a docs page is really written in (Utils/Translations.ts).
 * Every page is served in every language, and a language's copy of a page
 * can still be English: copied in to be translated later, sometimes with a
 * "TODO(i18n)" comment, more often with no more than a dashboard label
 * translated. Search engines are pointed at the English page for those, and
 * the sitemap leaves them out, so a copy is a translation only when its
 * sentences are its own.
 */
jest.mock("../../../FeatureSet/Docs/Utils/Config", () => {
  const path: typeof Path = jest.requireActual("path") as typeof Path;
  const root: string = path.resolve(__dirname, "../../../FeatureSet/Docs");
  return {
    ContentPath: path.join(root, "Content"),
    StaticPath: path.join(root, "Static"),
    ViewsPath: path.join(root, "Views"),
  };
});
jest.mock("Common/Server/Utils/LocalFile", () => {
  const fs: typeof FileSystem = jest.requireActual("fs") as typeof FileSystem;
  return {
    __esModule: true,
    default: {
      doesFileExist: async (file: string): Promise<boolean> => {
        return fs.existsSync(file);
      },
      read: (file: string): Promise<string> => {
        return fs.promises.readFile(file, "utf8");
      },
    },
  };
});

// Lines of Markdown, as a page.
const md: (...lines: Array<string>) => string = (
  ...lines: Array<string>
): string => {
  return lines.join("\n");
};

const ENGLISH: string = md(
  "# Website Monitor",
  "",
  "A website monitor checks that a page loads, from probes around the world.",
  "",
  "## Create the monitor",
  "",
  "Open **Monitors**, click **Create Monitor** and pick the website type.",
  "",
  "| Field | What it does |",
  "| --- | --- |",
  "| URL | The page the probes load, with its scheme and its path. |",
  "",
  '```bash title="Check it by hand"',
  "curl -sS https://status.example.com/health --max-time 10",
  "```",
  "",
  "The monitor checks the page every minute until you pause it.",
);

const GERMAN: string = md(
  "# Website-Monitor",
  "",
  "Ein Website-Monitor prüft von Probes auf der ganzen Welt, ob eine Seite lädt.",
  "",
  "## Den Monitor anlegen",
  "",
  "Öffnen Sie **Monitore**, klicken Sie auf **Monitor erstellen** und wählen Sie den Typ Website.",
  "",
  "| Feld | Was es tut |",
  "| --- | --- |",
  "| URL | Die Seite, die die Probes laden, mit Schema und Pfad. |",
  "",
  '```bash title="Von Hand prüfen"',
  "curl -sS https://status.example.com/health --max-time 10",
  "```",
  "",
  "Der Monitor prüft die Seite jede Minute, bis Sie ihn anhalten.",
);

describe("getSentences", () => {
  it("reads the lines of prose, as they are written", () => {
    expect(getSentences(ENGLISH)).toEqual([
      "A website monitor checks that a page loads, from probes around the world.",
      "Open **Monitors**, click **Create Monitor** and pick the website type.",
      "The monitor checks the page every minute until you pause it.",
    ]);
  });

  it("leaves out code samples, however they are fenced", () => {
    expect(
      getSentences(
        md(
          "````markdown",
          "```bash",
          "A sentence inside a sample that shows another sample.",
          "```",
          "A sentence still inside the outer sample, after the inner fence.",
          "````",
          "~~~",
          "A sentence inside a tilde-fenced sample of some length.",
          "~~~",
          "> ```yaml",
          "> A sentence inside a sample that sits in a quote.",
          "> ```",
          "A sentence after every sample, which is prose again.",
        ),
      ),
    ).toEqual(["A sentence after every sample, which is prose again."]);
  });

  it("leaves out tables, components, tabs and comments", () => {
    expect(
      getSentences(
        md(
          "| A table row with plenty of words in its cells | and more |",
          ":::details A collapsible section with a long title",
          "@tab A tab label that is long enough to count",
          "<!-- A comment that is long enough to read as prose. -->",
          "> A quoted sentence, which is prose like any other.",
          ":::",
        ),
      ),
    ).toEqual(["A quoted sentence, which is prose like any other."]);
  });

  it("counts letters, not code, addresses or tokens", () => {
    expect(
      getSentences(
        md(
          "Set `OTEL_EXPORTER_OTLP_ENDPOINT` to `https://x.example.com`.",
          "See [it](https://oneuptime.com/docs/en/a/very-long-page-address).",
          "Write {{IP_WHITELIST}} in https://example.com/a/b/c/d/e/f/g/h.",
          "Set the endpoint and the headers before you start the service.",
        ),
      ),
    ).toEqual([
      "Set the endpoint and the headers before you start the service.",
    ]);
  });

  it("reads a sentence in any script, and not a short heading", () => {
    expect(
      getSentences(
        md(
          "## 工作原理",
          "网站监视器会从世界各地的探针检查页面是否能够正常加载并返回结果。",
          "## Как это работает",
          "Монитор сайта проверяет, загружается ли страница, с проб по всему миру.",
          "این راهنما توضیح می‌دهد که مانیتور چگونه کار می‌کند و چه چیزی را بررسی می‌کند.",
        ),
      ),
    ).toEqual([
      "网站监视器会从世界各地的探针检查页面是否能够正常加载并返回结果。",
      "Монитор сайта проверяет, загружается ли страница, с проб по всему миру.",
      "این راهنما توضیح می‌دهد که مانیتور چگونه کار می‌کند و چه چیزی را بررسی می‌کند.",
    ]);
  });
});

describe("isEnglishCopy", () => {
  it("is false for a translation, which keeps code, names and addresses as written", () => {
    expect(isEnglishCopy(ENGLISH, GERMAN)).toBe(false);
  });

  it("is true for a copy that is the English page, byte for byte", () => {
    expect(isEnglishCopy(ENGLISH, ENGLISH)).toBe(true);
  });

  it("is true for a copy that says it is still to be translated, whatever it holds", () => {
    expect(
      isEnglishCopy(
        ENGLISH,
        md(
          GERMAN,
          "",
          `<!-- ${UNTRANSLATED_PAGE_MARKER}: Translate this page. English source: en/monitor/website-monitor.md -->`,
        ),
      ),
    ).toBe(true);
  });

  it("is true for English with a dashboard label translated, the usual copy", () => {
    const copy: string = ENGLISH.split("**Create Monitor**").join(
      "**Monitor erstellen**",
    );

    expect(copy).not.toBe(ENGLISH);
    expect(isEnglishCopy(ENGLISH, copy)).toBe(true);
  });

  it("is false for a translation that leaves a sentence in English", () => {
    const translation: string = md(
      GERMAN,
      "",
      "The monitor checks the page every minute until you pause it.",
    );

    expect(isEnglishCopy(ENGLISH, translation)).toBe(false);
  });

  it("reads a page with no prose by the page itself", () => {
    const table: string = md("# Limits", "", "| A | B |", "| --- | --- |");

    expect(isEnglishCopy(table, table)).toBe(true);
    expect(isEnglishCopy(table, md("# Grenzen", "", "| A | B |"))).toBe(false);
  });
});

// A language's copy of a page, and its English page.
interface DocsCopy {
  lang: string;
  page: string;
  markdown: string;
  english: string;
}

/*
 * The real docs. getLanguages reads them as the docs are served: every
 * language's copy, held to its English page. Every page in every language
 * is read once, up front.
 */
describe("the languages a docs page is written in", () => {
  const languagesOf: Map<string, Array<string>> = new Map();
  const copies: Array<DocsCopy> = [];

  beforeAll(async () => {
    for (const page of NAV_PAGES) {
      languagesOf.set(page, await DocsTranslations.getLanguages(page));
    }

    for (const lang of TRANSLATED_LANGUAGES) {
      for (const page of listPages(lang)) {
        copies.push({
          lang: lang,
          page: page,
          markdown: readPage(lang, page),
          english: readPage("en", page),
        });
      }
    }
  }, 900000);

  // Whether getLanguages counts a copy as a translation.
  const isTranslation: (copy: DocsCopy) => boolean = (
    copy: DocsCopy,
  ): boolean => {
    return (languagesOf.get(copy.page) || []).includes(copy.lang);
  };

  it("is English first, then each translation in the docs' order", () => {
    expect(languagesOf.size).toBe(NAV_PAGES.length);

    for (const [page, languages] of languagesOf) {
      expect({ page, first: languages[0] }).toEqual({ page, first: "en" });
      expect({ page, languages }).toEqual({
        page,
        languages: SUPPORTED_DOCS_LANGUAGE_CODES.filter(
          (lang: string): boolean => {
            return languages.includes(lang);
          },
        ),
      });
    }
  });

  it("is never a language without a copy of the page", () => {
    for (const [page, languages] of languagesOf) {
      for (const lang of languages) {
        expect({ page, lang, has: hasPage(lang, page) }).toEqual({
          page,
          lang,
          has: true,
        });
      }
    }
  });

  it("is every language for a page translated into every one of them", async () => {
    expect(
      await DocsTranslations.getLanguages("installation/docker-compose"),
    ).toEqual(DOCS_LANGUAGES);
    expect(
      await DocsTranslations.isTranslated("installation/docker-compose", "de"),
    ).toBe(true);
  });

  it("is nothing for a page that is not there", async () => {
    expect(await DocsTranslations.getLanguages("nope/nope")).toEqual([]);
    expect(await DocsTranslations.isTranslated("nope/nope", "en")).toBe(false);
  });

  it("leaves out every copy that says it is still to be translated", () => {
    for (const copy of copies) {
      if (copy.markdown.includes(UNTRANSLATED_PAGE_MARKER)) {
        expect({
          page: copy.page,
          lang: copy.lang,
          translated: isTranslation(copy),
        }).toEqual({ page: copy.page, lang: copy.lang, translated: false });
      }
    }
  });

  it("leaves out every copy that is the English page, byte for byte", () => {
    for (const copy of copies) {
      if (copy.markdown === copy.english) {
        expect({
          page: copy.page,
          lang: copy.lang,
          translated: isTranslation(copy),
        }).toEqual({ page: copy.page, lang: copy.lang, translated: false });
      }
    }
  });

  it("counts a copy as a translation exactly when isEnglishCopy says it is not English", () => {
    for (const copy of copies) {
      expect({
        page: copy.page,
        lang: copy.lang,
        translated: isTranslation(copy),
      }).toEqual({
        page: copy.page,
        lang: copy.lang,
        translated: !isEnglishCopy(copy.english, copy.markdown),
      });
    }
  }, 600000);

  /*
   * The line between a translation and an English copy is not a fine one:
   * on the real docs every copy shares either very little of its prose with
   * English or nearly all of it. A copy close to the line is a page half
   * translated - finish it, rather than move the line.
   */
  it("never has to decide a copy that is close to the line", () => {
    const close: Array<string> = [];

    for (const copy of copies) {
      const english: Set<string> = new Set(getSentences(copy.english));
      const sentences: Array<string> = getSentences(copy.markdown);

      if (sentences.length === 0) {
        continue;
      }

      const share: number =
        sentences.filter((sentence: string): boolean => {
          return english.has(sentence);
        }).length / sentences.length;

      if (
        share > ENGLISH_COPY_SHARE - 0.25 &&
        share < ENGLISH_COPY_SHARE + 0.15
      ) {
        close.push(`${copy.lang}/${copy.page}: ${Math.round(share * 100)}%`);
      }
    }

    expect(close).toEqual([]);
  }, 600000);

  it("reads each page once in a while, not on every request", async () => {
    const first: Array<string> = await DocsTranslations.getLanguages(
      "installation/docker-compose",
    );

    expect(
      await DocsTranslations.getLanguages("installation/docker-compose"),
    ).toBe(first);

    DocsTranslations.clearCache();

    const again: Array<string> = await DocsTranslations.getLanguages(
      "installation/docker-compose",
    );

    expect(again).not.toBe(first);
    expect(again).toEqual(first);
  }, 120000);
});

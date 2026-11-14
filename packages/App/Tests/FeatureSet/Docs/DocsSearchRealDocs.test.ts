import DocsSearch, {
  DocsSearchAnswer,
  DocsSearchResult,
} from "../../../FeatureSet/Docs/Utils/DocsSearch";
import DocsAIReader, {
  AIDocsIndexedPage,
  AIDocsIndexedSection,
  AIDocsLanguageIndex,
  tokenizeForDocs,
} from "../../../FeatureSet/Docs/Utils/AIDocsReader";
import {
  DOCS_SEARCH_SYNONYMS,
  DocsSearchSynonyms,
  foldDocsSearchWord,
} from "../../../FeatureSet/Docs/Utils/DocsSearchWords";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, jest, test } from "@jest/globals";
import path from "path";

/*
 * DOCS SEARCH ON THE REAL DOCS (issue #6822), in English and in other
 * languages - the issue's "done when": "escalaton", "pager" and a phrase
 * from the middle of a page find the right section, in English and in two
 * other languages (German, French, and Japanese too).
 *
 * The phrase is not picked by hand: every 41st section long enough to have
 * a middle gives the six words in its middle, and nine in ten of them must
 * open that very section among the first five results. (A phrase every
 * one of the eleven "Moving from" guides says word for word cannot tell
 * them apart, which is why it is nine in ten and not all.)
 *
 * The index is the one Ask AI reads too (AIDocsReader), built from the
 * docs on disk.
 */

jest.mock("../../../FeatureSet/Docs/Utils/Config", () => {
  const nodePath: typeof path = jest.requireActual("path") as typeof path;
  const root: string = nodePath.resolve(__dirname, "../../../FeatureSet/Docs");

  return {
    ContentPath: nodePath.join(root, "Content"),
    StaticPath: nodePath.join(root, "Static"),
    ViewsPath: nodePath.join(root, "Views"),
  };
});

const BUILD_TIMEOUT_MS: number = 600000;

const search: (
  language: string,
  query: string,
  limit?: number,
) => Promise<DocsSearchAnswer> = async (
  language: string,
  query: string,
  limit?: number,
): Promise<DocsSearchAnswer> => {
  return DocsSearch.search({ query, language, limit });
};

const urls: (answer: DocsSearchAnswer) => Array<string> = (
  answer: DocsSearchAnswer,
): Array<string> => {
  return answer.results.map((result: DocsSearchResult): string => {
    return result.url;
  });
};

// How many of the sampled middle-of-section phrases open their section in the first five.
const phraseSweep: (
  language: string,
) => Promise<{ tried: number; found: number; missed: Array<string> }> = async (
  language: string,
): Promise<{ tried: number; found: number; missed: Array<string> }> => {
  const index: AIDocsLanguageIndex = await DocsAIReader.getIndex(language);
  let counter: number = 0;
  let tried: number = 0;
  let found: number = 0;
  const missed: Array<string> = [];

  for (const page of index.pages) {
    for (const section of page.sections) {
      counter++;

      if (
        counter % 41 !== 0 ||
        section.isOtherName ||
        section.text.length < 300
      ) {
        continue;
      }

      const words: Array<string> = section.text.split(" ");
      const middle: number = Math.floor(words.length / 2);
      const phrase: string = words.slice(middle, middle + 6).join(" ");
      const answer: DocsSearchAnswer = DocsSearch.rank(index, `${phrase} `, 5);

      tried++;

      if (
        urls(answer).includes(
          `/docs/${language}/${page.page}#${section.anchor}`,
        )
      ) {
        found++;
      } else {
        missed.push(`${page.page}#${section.anchor}: ${phrase}`);
      }
    }
  }

  return { tried, found, missed };
};

describe("docs search, on the real docs", () => {
  test(
    "English: a typo, a reader's word and a phrase from the middle of a page find the right section",
    async () => {
      const escalaton: DocsSearchAnswer = await search("en", "escalaton");
      expect(urls(escalaton).slice(0, 3)).toContain(
        "/docs/en/on-call/escalation-rules",
      );
      expect(escalaton.words).toContain("escalation");

      for (const result of (await search("en", "pager")).results.slice(0, 3)) {
        expect(`${result.title} ${result.url}`).toMatch(/on-call/i);
      }

      const sweep: { tried: number; found: number; missed: Array<string> } =
        await phraseSweep("en");
      expect(sweep.tried).toBeGreaterThan(50);
      expect({ ...sweep, share: sweep.found / sweep.tried >= 0.9 }).toEqual(
        expect.objectContaining({ share: true }),
      );
    },
    BUILD_TIMEOUT_MS,
  );

  test(
    "English: the issue's other words, a half-typed word and a misspelt plural",
    async () => {
      expect(urls(await search("en", "2fa")).slice(0, 2)).toContain(
        "/docs/en/introduction/your-account#turn-on-two-factor-authentication",
      );
      expect(
        (await search("en", "outage")).results
          .slice(0, 3)
          .some((result: DocsSearchResult): boolean => {
            return result.url.startsWith("/docs/en/incidents/");
          }),
      ).toBe(true);
      expect(
        (await search("en", "uptime")).results.some(
          (result: DocsSearchResult): boolean => {
            return result.title.toLowerCase().includes("monitor");
          },
        ),
      ).toBe(true);
      expect(
        (await search("en", "kube")).results
          .slice(0, 3)
          .every((result: DocsSearchResult): boolean => {
            return `${result.title} ${result.url}`
              .toLowerCase()
              .includes("kubernetes");
          }),
      ).toBe(true);
      expect(urls(await search("en", "notifcations")).slice(0, 3)).toEqual(
        expect.arrayContaining(["/docs/en/notifications/notification-methods"]),
      );
      /*
       * Services' old name (#6817): the page no longer says it, so the
       * glossary's term that lists it comes first, then the page itself.
       */
      expect(
        urls(await search("en", "service catalog"))
          .slice(0, 2)
          .some((url: string): boolean => {
            return url.startsWith("/docs/en/telemetry/services");
          }),
      ).toBe(true);
    },
    BUILD_TIMEOUT_MS,
  );

  test(
    "German: a typo, a reader's word and a phrase from the middle of a page",
    async () => {
      expect(
        urls(await search("de", "Eskalatonsregel"))
          .slice(0, 3)
          .some((url: string): boolean => {
            return url.includes("escalation-rule");
          }),
      ).toBe(true);

      for (const result of (await search("de", "pager")).results.slice(0, 3)) {
        expect(result.title).toMatch(/bereitschaft/i);
      }

      const sweep: { tried: number; found: number; missed: Array<string> } =
        await phraseSweep("de");
      expect(sweep.tried).toBeGreaterThan(50);
      expect({ ...sweep, share: sweep.found / sweep.tried >= 0.9 }).toEqual(
        expect.objectContaining({ share: true }),
      );
    },
    BUILD_TIMEOUT_MS,
  );

  /*
   * The German API reference names its step by the button's word (#7876):
   * the button is "API-Schlüssel erstellen". The step said "anlegen", so
   * the button's name found it 14th, after other tools' "erstellen" steps.
   */
  test(
    "German: the button's name opens the API reference's step that creates an API key",
    async () => {
      expect(urls(await search("de", "API-Schlüssel erstellen"))[0]).toBe(
        "/docs/de/api-reference/api-reference#einen-api-schlüssel-erstellen",
      );
    },
    BUILD_TIMEOUT_MS,
  );

  test(
    "French: a half-typed word, a reader's word and a phrase from the middle of a page",
    async () => {
      expect(urls(await search("fr", "escalad"))[0]).toBe(
        "/docs/fr/on-call/escalation-rules",
      );

      for (const result of (await search("fr", "pager")).results.slice(0, 3)) {
        expect(result.title).toMatch(/astreinte/i);
      }

      expect(
        (await search("fr", "panne")).results.some(
          (result: DocsSearchResult): boolean => {
            return result.url.startsWith("/docs/fr/incidents/");
          },
        ),
      ).toBe(true);

      const sweep: { tried: number; found: number; missed: Array<string> } =
        await phraseSweep("fr");
      expect(sweep.tried).toBeGreaterThan(50);
      expect({ ...sweep, share: sweep.found / sweep.tried >= 0.9 }).toEqual(
        expect.objectContaining({ share: true }),
      );
    },
    BUILD_TIMEOUT_MS,
  );

  test(
    "Japanese: written without spaces, a reader's word and a phrase from the middle of a page",
    async () => {
      expect(urls(await search("ja", "エスカレーション"))[0]).toBe(
        "/docs/ja/on-call/escalation-rules",
      );

      for (const result of (await search("ja", "pager")).results.slice(0, 3)) {
        expect(result.title).toMatch(/オンコール/);
      }

      const sweep: { tried: number; found: number; missed: Array<string> } =
        await phraseSweep("ja");
      expect(sweep.tried).toBeGreaterThan(50);
      expect({ ...sweep, share: sweep.found / sweep.tried >= 0.9 }).toEqual(
        expect.objectContaining({ share: true }),
      );
    },
    BUILD_TIMEOUT_MS,
  );

  /*
   * A synonym that names a word the docs of its language never use finds
   * nothing: each one must match a word of that language's index - every
   * word of a phrase, or at least one word a word start begins.
   */
  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s: every synonym leads to words the docs in that language use",
    async (language: string) => {
      const index: AIDocsLanguageIndex = await DocsAIReader.getIndex(language);
      const list: DocsSearchSynonyms = (
        DOCS_SEARCH_SYNONYMS as Record<string, DocsSearchSynonyms>
      )[language] as DocsSearchSynonyms;
      const dead: Array<string> = [];

      for (const [word, values] of Object.entries(list)) {
        for (const value of values) {
          if (value.endsWith("*")) {
            const start: string = foldDocsSearchWord(value.slice(0, -1));
            if (
              !index.vocabulary.has(start) &&
              index.vocabulary.startingWith(start, 1).length === 0
            ) {
              dead.push(`${word} -> ${value}`);
            }
            continue;
          }

          if (
            !tokenizeForDocs(value).every((term: string): boolean => {
              return index.vocabulary.has(term);
            })
          ) {
            dead.push(`${word} -> ${value}`);
          }
        }
      }

      expect(dead).toEqual([]);
    },
    BUILD_TIMEOUT_MS,
  );

  /*
   * What a search sends the browser is small: twenty results, each a title,
   * where it is, an address and one line (Devanagari takes three bytes a
   * letter, so Hindi's is the largest). The whole docs as an index the
   * browser could search measured 1.2 to 3 MB a language, which is why the
   * search runs on the docs server (Utils/DocsSearch.ts).
   */
  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s: an answer of twenty results stays under 16 KB",
    async (language: string) => {
      const index: AIDocsLanguageIndex = await DocsAIReader.getIndex(language);
      const monitorPage: AIDocsIndexedPage | undefined = index.pages.find(
        (page: AIDocsIndexedPage): boolean => {
          return page.page === "monitor/website-monitor";
        },
      );
      const firstSection: AIDocsIndexedSection | undefined =
        monitorPage?.sections[0];

      for (const query of [
        "monitor",
        monitorPage?.title || "monitor",
        firstSection?.title || "monitor",
      ]) {
        const answer: DocsSearchAnswer = DocsSearch.rank(index, query, 20);

        expect(answer.results.length).toBeGreaterThan(0);
        expect({
          language,
          query,
          small: Buffer.byteLength(JSON.stringify(answer), "utf8") < 16 * 1024,
        }).toEqual({ language, query, small: true });
      }
    },
    BUILD_TIMEOUT_MS,
  );
});

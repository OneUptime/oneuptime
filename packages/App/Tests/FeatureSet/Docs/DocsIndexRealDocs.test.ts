import DocsAIReader, {
  AIDocsIndexedPage,
  AIDocsIndexedSection,
  AIDocsLanguageIndex,
  plainTextOfDocs,
  splitDocsSections,
  tokenizeForDocs,
} from "../../../FeatureSet/Docs/Utils/AIDocsReader";
import { describe, expect, jest, test } from "@jest/globals";
import childProcess from "child_process";
import fs from "fs";
import path from "path";

/*
 * THE INDEX OF THE DOCS ON DISK, LAID OUT TO HOLD LITTLE (issue #8818).
 *
 * A docs language's index held 62 to 103 MB once searched, and a server
 * asked in all seventeen languages kept 1.3 GB of them: every page's and
 * section's words as Maps and Sets, every section's text twice, and every
 * page's Markdown, which V8 kept alive for the section headings cut from
 * it. Utils/DocsIndex.ts lays it out as typed arrays and one deflated
 * Buffer instead, and the build reads each line of a page's body once.
 *
 * So, for languages of every script the docs are written in:
 *   - every page's body holds the words of the body read whole, each with
 *     its count, and as many words as it says (the build reads it line by
 *     line now);
 *   - every section is the section the page's Markdown splits into, with
 *     its heading, its anchor, its text and its words;
 *   - built in a process of its own and searched in, an index holds at
 *     most three times its pages' Markdown. Measured on the 14.3 docs,
 *     every language's holds 1.4 to 3 times; as it was, 5 to 13 times
 *     (English 8.9, Russian 6.5, Japanese 10.4, the three measured here).
 *
 * DocsSearchRealDocs.test.ts and AskAiHowDoIRetrieval.test.ts hold the
 * searches on the same index to their real questions in every language.
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
const APP_ROOT: string = path.resolve(__dirname, "../../..");
const CONTENT: string = path.join(APP_ROOT, "FeatureSet/Docs/Content");

// A language of each script the docs are written in, and German's compounds.
const LANGUAGES: Array<string> = [
  "en",
  "de",
  "ru",
  "hi",
  "fa",
  "ja",
  "ko",
  "zh-CN",
];

/*
 * How many times its pages' Markdown, in bytes on disk, an index may hold
 * once searched in. English, Russian and Japanese hold about twice; a
 * change that takes one past three holds what the index need not.
 */
const MOST_TIMES_ITS_MARKDOWN: number = 3;

// The words of `text` with how many times each is written.
const countWords: (text: string, language: string) => Map<string, number> = (
  text: string,
  language: string,
): Map<string, number> => {
  const counts: Map<string, number> = new Map();

  for (const word of tokenizeForDocs(text, language)) {
    counts.set(word, (counts.get(word) || 0) + 1);
  }

  return counts;
};

// A page's Markdown as the index read it: its copy's language, without its title line.
const bodyOf: (page: AIDocsIndexedPage) => string = (
  page: AIDocsIndexedPage,
): string => {
  return fs
    .readFileSync(path.join(CONTENT, page.language, `${page.page}.md`), "utf8")
    .split("\n")
    .slice(1)
    .join("\n");
};

describe("the index of the docs on disk", () => {
  test.each(LANGUAGES)(
    "%s: every page's body holds the words of the body read whole, and every section is the page's",
    async (language: string) => {
      const index: AIDocsLanguageIndex = await DocsAIReader.build(language);
      const differing: Array<string> = [];

      expect(index.pages.length).toBeGreaterThan(300);

      for (const page of index.pages) {
        const body: string = bodyOf(page);
        const words: Map<string, number> = countWords(body, language);
        let total: number = 0;

        for (const [term, count] of words) {
          total += count;

          if (page.bodyTerms.get(term) !== count) {
            differing.push(
              `${page.page}: "${term}" ${page.bodyTerms.get(term)} times, not ${count}`,
            );
          }
        }

        if (page.bodyLength !== total) {
          differing.push(
            `${page.page}: ${page.bodyLength} words, not ${total}`,
          );
        }

        splitDocsSections(body).forEach(
          (
            section: { title: string; anchor: string; body: string },
            at: number,
          ): void => {
            const indexed: AIDocsIndexedSection | undefined = page.sections[at];

            if (
              !indexed ||
              indexed.title !== section.title ||
              indexed.anchor !== section.anchor ||
              indexed.text !== plainTextOfDocs(section.body)
            ) {
              differing.push(`${page.page}#${section.anchor}: not as written`);
              return;
            }

            const sectionWords: Map<string, number> = countWords(
              section.body,
              language,
            );
            let sectionTotal: number = 0;

            for (const [term, count] of sectionWords) {
              sectionTotal += count;

              if (indexed.terms.get(term) !== count) {
                differing.push(
                  `${page.page}#${section.anchor}: "${term}" ${indexed.terms.get(term)} times, not ${count}`,
                );
              }
            }

            for (const term of tokenizeForDocs(section.title, language)) {
              if (!indexed.titleTerms.has(term)) {
                differing.push(
                  `${page.page}#${section.anchor}: its heading's "${term}"`,
                );
              }
            }

            if (indexed.wordCount !== sectionTotal) {
              differing.push(
                `${page.page}#${section.anchor}: ${indexed.wordCount} words, not ${sectionTotal}`,
              );
            }
          },
        );
      }

      expect(differing.slice(0, 20)).toEqual([]);
    },
    BUILD_TIMEOUT_MS,
  );
});

/*
 * Builds `language`'s index in a node process of its own and searches it,
 * and says what it holds there: the JS heap and the typed arrays and Buffer
 * outside it, after garbage collection, against the same process before
 * the build. The process builds the index once first and lets it go, so
 * what is measured is the index - not the stems it read or the code it
 * ran, which a first build leaves behind.
 */
const measureIndex: (language: string) => {
  bytes: number;
  markdownBytes: number;
} = (language: string): { bytes: number; markdownBytes: number } => {
  const output: string = childProcess.execFileSync(
    process.execPath,
    [
      "--expose-gc",
      "-e",
      String.raw`
        require("ts-node").register({
          transpileOnly: true,
          compilerOptions: { module: "commonjs" },
        });

        const fs = require("fs");
        const path = require("path");
        const docs = path.resolve("FeatureSet/Docs");
        const configPath = require.resolve(path.join(docs, "Utils/Config"));

        require.cache[configPath] = {
          id: configPath,
          filename: configPath,
          loaded: true,
          exports: {
            ContentPath: path.join(docs, "Content"),
            StaticPath: path.join(docs, "Static"),
            ViewsPath: path.join(docs, "Views"),
          },
        };

        const DocsAIReader = require("./FeatureSet/Docs/Utils/AIDocsReader").default;
        const DocsSearch = require("./FeatureSet/Docs/Utils/DocsSearch").default;
        const language = process.argv[1];
        const held = () => {
          for (let round = 0; round < 4; round++) {
            global.gc();
          }
          const usage = process.memoryUsage();
          return usage.heapUsed + usage.external;
        };
        const firstBuild = async () => {
          const index = await DocsAIReader.build(language);
          return index.pages.length;
        };
        const kept = [];

        (async () => {
          await firstBuild();
          const before = held();
          kept.push(await DocsAIReader.build(language));
          const index = kept[0];

          for (const query of [
            "monitor",
            "escalaton",
            "kube",
            index.pages[0].title,
            index.pages[1].sections[0].title,
            "how do I set up an on-call schedule?",
          ]) {
            DocsSearch.rank(index, query, 20);
            DocsAIReader.rank(index, query, 6);
          }

          const bytes = held() - before;
          let markdownBytes = 0;

          for (const page of index.pages) {
            markdownBytes += fs.statSync(
              path.join(docs, "Content", page.language, page.page + ".md"),
            ).size;
          }

          process.stdout.write(JSON.stringify({ bytes, markdownBytes, pages: kept[0].pages.length }) + "\n");
        })().catch((error) => {
          console.error(error);
          process.exit(1);
        });
      `,
      language,
    ],
    {
      cwd: APP_ROOT,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: BUILD_TIMEOUT_MS,
    },
  );

  return JSON.parse(output.trim().split("\n").pop() || "{}") as {
    bytes: number;
    markdownBytes: number;
  };
};

describe("what a language's index holds", () => {
  test.each(["en", "ru", "ja"])(
    `%s: once searched in, at most ${MOST_TIMES_ITS_MARKDOWN} times its pages' Markdown`,
    (language: string) => {
      const measured: { bytes: number; markdownBytes: number } =
        measureIndex(language);
      const mb: (bytes: number) => number = (bytes: number): number => {
        return Math.round((bytes / 1024 / 1024) * 10) / 10;
      };

      expect(measured.markdownBytes).toBeGreaterThan(1024 * 1024);
      expect({
        language,
        indexMb: mb(measured.bytes),
        markdownMb: mb(measured.markdownBytes),
        withinBudget:
          measured.bytes <= MOST_TIMES_ITS_MARKDOWN * measured.markdownBytes,
      }).toEqual({
        language,
        indexMb: mb(measured.bytes),
        markdownMb: mb(measured.markdownBytes),
        withinBudget: true,
      });
    },
    BUILD_TIMEOUT_MS,
  );
});

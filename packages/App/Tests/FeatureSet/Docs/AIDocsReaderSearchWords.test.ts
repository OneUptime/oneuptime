import DocsAIReader, {
  AIDocsIndexedPage,
  AIDocsIndexedSection,
  AIDocsLanguageIndex,
  plainTextOfDocs,
  splitDocsWords,
  tokenizeForDocs,
  tokenizeQueryForDocs,
} from "../../../FeatureSet/Docs/Utils/AIDocsReader";
import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import { AIDocsSearchHit } from "Common/Server/Utils/AI/Docs/AIDocsLibrary";
import { describe, expect, jest, test } from "@jest/globals";
import path from "path";

/*
 * WHAT THE DOCS INDEX KEEPS FOR DOCS SEARCH, AND WHAT ASK AI GAINS FROM IT
 * (issue #6822).
 *
 * The docs' search box and Search (Cmd/Ctrl+K)'s Docs group read the index
 * Ask AI's reader builds (AIDocsReader), so the reader now also keeps each
 * section's text, every word with how many pages hold it, the Glossary's
 * other names as sections, and which pages are guides; and it reads a
 * hyphenated word joined as well ("on-call" as "oncall"). Ask AI's own
 * search gains the shared synonyms and reads a misspelt word as the docs
 * word it nearly spells. AskAiHowDoIRetrieval holds its forty questions to
 * the same answers as before.
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
const reader: DocsAIReader = new DocsAIReader();

describe("reading words", () => {
  test("keeps a hyphenated word together as it comes", () => {
    expect(splitDocsWords("Set up On-Call, then 2FA.")).toEqual([
      "set",
      "up",
      "on-call",
      "then",
      "2fa",
    ]);
    expect(splitDocsWords(" -- - ")).toEqual([]);
  });

  test("reads a hyphenated word joined as well as in its parts", () => {
    expect(tokenizeForDocs("on-call")).toEqual(["call", "oncall"]);
    expect(tokenizeForDocs("two-factor")).toEqual([
      "two",
      "factor",
      "twofactor",
    ]);
    expect(tokenizeForDocs("Zwei-Faktor-Authentifizierung")).toEqual(
      expect.arrayContaining(["zweifaktor", "zweifaktorauthentifizierung"]),
    );
  });

  test("does not join an id, a version or a number range", () => {
    expect(tokenizeForDocs("a1b2-c3d4-e5f6-a7b8-c9d0")).toEqual([
      "a1b2",
      "c3d4",
      "e5f6",
      "a7b8",
      "c9d0",
    ]);
    expect(tokenizeForDocs("10-20")).toEqual(["10", "20"]);
  });

  test("reads Chinese and Japanese in pairs of characters, joined or not", () => {
    expect(tokenizeForDocs("ステータス-ページ")).toEqual([
      "ステ",
      "テー",
      "ータ",
      "タス",
      "ペー",
      "ージ",
    ]);
  });

  test("reads a reader's word into a question in the question's language", () => {
    expect(tokenizeQueryForDocs("get a text")).toEqual(
      expect.arrayContaining(["text", "sms"]),
    );
    expect(tokenizeQueryForDocs("ausfall", "de")).toEqual(
      expect.arrayContaining(["ausfall", "vorfall"]),
    );
    expect(tokenizeQueryForDocs("2fa")).toEqual(
      expect.arrayContaining(["twofactor"]),
    );
    // A word start needs the docs' words, so it is left to the reader's index.
    expect(tokenizeQueryForDocs("pager", "da")).toEqual(["pag"]);
  });
});

describe("plainTextOfDocs", () => {
  test("reads a section as its words: no code, no table rules, no components' syntax", () => {
    expect(
      plainTextOfDocs(
        [
          "Open **Monitors** and see [the list](/docs/monitor/create-monitor).",
          "",
          "```bash",
          "npm run doctor",
          "```",
          "",
          "| Field | Default |",
          "| --- | :---: |",
          "| Interval | 5 minutes |",
          "",
          ":::details Why is the monitor offline?",
          "> [!NOTE]",
          "> The probe could not reach the site.",
          ":::",
          "",
          "- One `item`",
          "1. Two",
          "@tab Docker Compose",
        ].join("\n"),
      ),
    ).toBe(
      "Open Monitors and see the list. Field Default Interval 5 minutes Why is the monitor offline? The probe could not reach the site. One item Two Docker Compose",
    );
  });
});

describe("the index docs search reads", () => {
  test(
    "keeps every section's text, and every word with how many pages hold it",
    async () => {
      const index: AIDocsLanguageIndex = await DocsAIReader.getIndex("en");
      const escalation: AIDocsIndexedPage | undefined = index.pages.find(
        (page: AIDocsIndexedPage): boolean => {
          return page.page === "on-call/escalation-rules";
        },
      );

      expect(index.language).toBe("en");
      expect(escalation?.sections.length).toBeGreaterThan(3);
      for (const section of escalation?.sections || []) {
        expect(section.text).not.toContain("```");
      }
      expect(
        (escalation?.sections || []).some((section: AIDocsIndexedSection) => {
          return section.text.length > 100;
        }),
      ).toBe(true);
      expect(index.vocabulary.has("escalation")).toBe(true);
      expect(index.vocabulary.has("oncall")).toBe(true);
      expect(index.vocabulary.pagesHolding("escalation")).toBe(
        index.documentFrequency.get("escalation"),
      );
    },
    BUILD_TIMEOUT_MS,
  );

  test(
    "marks the guides: the Quickstart and the Self-Hosting Guide, as the nav does",
    async () => {
      const index: AIDocsLanguageIndex = await DocsAIReader.getIndex("en");
      const guides: Array<string> = index.pages
        .filter((page: AIDocsIndexedPage): boolean => {
          return page.isGuide;
        })
        .map((page: AIDocsIndexedPage): string => {
          return page.page;
        });
      const navGuides: Array<string> = DocsNav.flatMap(
        (group: NavGroup): Array<string> => {
          return group.links
            .filter((link: NavLink): boolean => {
              return link.isGuide === true;
            })
            .map((link: NavLink): string => {
              return link.url.replace(/^\/docs\//, "");
            });
        },
      );

      expect(guides).toEqual(navGuides);
      expect(guides).toEqual(
        expect.arrayContaining([
          "introduction/quickstart",
          "installation/self-hosting-guide",
        ]),
      );
    },
    BUILD_TIMEOUT_MS,
  );

  test.each(["en", "de"])(
    "%s: keeps the Glossary's other names as sections that open their term, saying its definition",
    async (language: string) => {
      const index: AIDocsLanguageIndex = await DocsAIReader.getIndex(language);
      const glossary: AIDocsIndexedPage | undefined = index.pages.find(
        (page: AIDocsIndexedPage): boolean => {
          return page.page === "introduction/glossary";
        },
      );
      const otherNames: Array<AIDocsIndexedSection> = (
        glossary?.sections || []
      ).filter((section: AIDocsIndexedSection): boolean => {
        return section.isOtherName === true;
      });
      // The Service term's other names, by its English anchor in every language.
      const service: Array<AIDocsIndexedSection> = otherNames.filter(
        (section: AIDocsIndexedSection): boolean => {
          return section.anchor === "service";
        },
      );

      expect(otherNames.length).toBeGreaterThan(30);
      expect(service.length).toBeGreaterThan(0);
      expect(service[0]!.text.length).toBeGreaterThan(20);
      expect(service[0]!.title).toMatch(/\(.+\)$/);

      if (language === "en") {
        expect(
          service.map((section: AIDocsIndexedSection): string => {
            return section.title;
          }),
        ).toContain("Service Catalog (Service)");
        // An other name is found by its words: it counts as a page's word.
        expect(index.vocabulary.has("catalog")).toBe(true);
      }
    },
    BUILD_TIMEOUT_MS,
  );
});

describe("Ask AI's search, with the shared words", () => {
  test(
    "reads a misspelt word as the docs word it nearly spells",
    async () => {
      const index: AIDocsLanguageIndex = await DocsAIReader.getIndex("en");

      expect(DocsAIReader.readQuestion(index, "escalaton rules")).toEqual(
        expect.arrayContaining(["escalation"]),
      );
      // A word nothing in the docs is like stays as it is, and finds nothing.
      expect(DocsAIReader.readQuestion(index, "zzqxv")).toEqual(["zzqxv"]);

      const hits: Array<AIDocsSearchHit> = await reader.search({
        query: "How do I set up escalaton rules?",
        language: "en",
        limit: 3,
      });

      expect(
        hits.map((hit: AIDocsSearchHit): string => {
          return hit.page;
        }),
      ).toContain("on-call/escalation-rules");
    },
    BUILD_TIMEOUT_MS,
  );

  test(
    "reads a word start synonym as the docs' most used word it starts",
    async () => {
      const index: AIDocsLanguageIndex = await DocsAIReader.getIndex("da");
      const words: Array<string> = DocsAIReader.readQuestion(index, "pager");

      expect(
        words.some((word: string): boolean => {
          return word.startsWith("vagt");
        }),
      ).toBe(true);
    },
    BUILD_TIMEOUT_MS,
  );
});

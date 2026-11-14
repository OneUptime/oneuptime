import { afterEach, describe, expect, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { DOCS_URL } from "../../../UI/Config";
import {
  DOCS_SEARCH_PALETTE_LIMIT,
  DocsSearchHit,
  getDocsSearchUrl,
  readDocsSearchAnswer,
  searchDocs,
  toDocsAddress,
} from "../../../UI/Utils/DocsSearch";

/*
 * The docs, as Search (Cmd/Ctrl+K) asks for them (UI/Utils/DocsSearch,
 * issue #6822): the installation's own docs search, in the reader's docs
 * language; only docs pages' own addresses come back; and a read that fails
 * is no results, never an error.
 */

const mockFetch: (
  implementation?: (...args: Array<unknown>) => unknown,
) => MockFunction = (
  implementation?: (...args: Array<unknown>) => unknown,
): MockFunction => {
  const mock: MockFunction = getJestMockFunction();
  if (implementation) {
    mock.mockImplementation(implementation);
  }
  return mock;
};

const DOCS: string = DOCS_URL.toString().replace(/\/$/, "");

const answer: (results: Array<unknown>) => unknown = (
  results: Array<unknown>,
): unknown => {
  return { query: "x", words: [], results };
};

const RESULT: Record<string, unknown> = {
  title: "Adding an escalation rule",
  where: "On Call › Escalation Rules",
  url: "/docs/de/on-call/escalation-rules#adding-an-escalation-rule",
  snippet: "Each escalation rule is one level.",
  isSection: true,
  isGuide: false,
};

afterEach(() => {
  delete (globalThis as unknown as { fetch?: unknown }).fetch;
});

describe("getDocsSearchUrl", () => {
  test("asks this installation's docs, in the reader's docs language, for a few results", () => {
    expect(getDocsSearchUrl({ query: "escalaton", language: "de" })).toBe(
      `${DOCS}/search/de.json?q=escalaton&limit=${DOCS_SEARCH_PALETTE_LIMIT}`,
    );
    expect(DOCS_SEARCH_PALETTE_LIMIT).toBe(5);
  });

  test("asks in English for a language the docs do not have, and spells what was typed safely", () => {
    expect(
      getDocsSearchUrl({ query: "on call & pager?", language: "ar", limit: 3 }),
    ).toBe(`${DOCS}/search/en.json?q=on%20call%20%26%20pager%3F&limit=3`);
  });
});

describe("readDocsSearchAnswer", () => {
  test("reads each result as Search shows it, at its full address", () => {
    expect(readDocsSearchAnswer(answer([RESULT]))).toEqual([
      {
        title: "Adding an escalation rule",
        where: "On Call › Escalation Rules",
        url: `${DOCS}/de/on-call/escalation-rules#adding-an-escalation-rule`,
        isSection: true,
      },
    ]);
  });

  test("keeps only docs pages' own addresses, so a broken answer cannot send anyone elsewhere", () => {
    for (const url of [
      "https://evil.example.com/docs/en/a/b",
      "//evil.example.com/docs/en/a/b",
      "/docs/en/../../admin",
      "/dashboard/projects",
      "javascript:alert(1)",
      "/docs/en/a b",
      42,
    ]) {
      expect({
        url,
        hits: readDocsSearchAnswer(answer([{ ...RESULT, url }])),
      }).toEqual({ url, hits: [] });
    }
  });

  test("leaves out a result with no title, and reads anything that is not an answer as no results", () => {
    expect(readDocsSearchAnswer(answer([{ ...RESULT, title: " " }]))).toEqual(
      [],
    );
    expect(readDocsSearchAnswer(answer([null, "x", []]))).toEqual([]);
    for (const data of [null, undefined, "x", [], {}, { results: "x" }]) {
      expect(readDocsSearchAnswer(data)).toEqual([]);
    }
  });
});

describe("a translated heading's anchor", () => {
  test("is percent-encoded once, so the address opens", () => {
    const hits: Array<DocsSearchHit> = readDocsSearchAnswer(
      answer([
        { ...RESULT, url: "/docs/de/a/b#hinzufügen" },
        { ...RESULT, url: "/docs/de/a/b#hinzuf%C3%BCgen" },
        { ...RESULT, url: "/docs/ja/a/b#エスカレーション" },
      ]),
    );

    expect(
      hits.map((hit: DocsSearchHit): string => {
        return hit.url;
      }),
    ).toEqual([
      `${DOCS}/de/a/b#hinzuf%C3%BCgen`,
      `${DOCS}/de/a/b#hinzuf%C3%BCgen`,
      `${DOCS}/ja/a/b#%E3%82%A8%E3%82%B9%E3%82%AB%E3%83%AC%E3%83%BC%E3%82%B7%E3%83%A7%E3%83%B3`,
    ]);
  });
});

describe("toDocsAddress", () => {
  test("puts a docs address under this installation's docs", () => {
    expect(toDocsAddress("/docs/en/introduction/glossary#probe")).toBe(
      `${DOCS}/en/introduction/glossary#probe`,
    );
  });
});

describe("searchDocs", () => {
  test("asks once, and answers with the results, at most the limit", async () => {
    const fetchMock: MockFunction = mockFetch(async () => {
      return {
        ok: true,
        json: async (): Promise<unknown> => {
          return answer(
            Array.from({ length: 8 }, () => {
              return RESULT;
            }),
          );
        },
      };
    });
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

    const hits: Array<DocsSearchHit> = await searchDocs({
      query: "escalaton",
      language: "de",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      getDocsSearchUrl({ query: "escalaton", language: "de" }),
    );
    expect(hits).toHaveLength(DOCS_SEARCH_PALETTE_LIMIT);
  });

  test("asks nothing for nothing typed", async () => {
    const fetchMock: MockFunction = mockFetch();
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

    expect(await searchDocs({ query: "   " })).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("is no results, never an error, when the docs answer badly or cannot be reached", async () => {
    (globalThis as unknown as { fetch: unknown }).fetch = mockFetch(
      async () => {
        return {
          ok: false,
          status: 404,
          json: async (): Promise<unknown> => {
            return {};
          },
        };
      },
    );
    expect(await searchDocs({ query: "monitor" })).toEqual([]);

    (globalThis as unknown as { fetch: unknown }).fetch = mockFetch(
      async () => {
        throw new Error("offline");
      },
    );
    expect(await searchDocs({ query: "monitor" })).toEqual([]);

    (globalThis as unknown as { fetch: unknown }).fetch = mockFetch(
      async () => {
        return {
          ok: true,
          json: async (): Promise<unknown> => {
            throw new Error("not JSON");
          },
        };
      },
    );
    expect(await searchDocs({ query: "monitor" })).toEqual([]);
  });
});

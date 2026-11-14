import { DOCS_URL } from "../Config";
import { getDocsLanguageFor } from "../../Types/Docs/DocsLanguage";

/*
 * THE DOCS, FOUND FROM SEARCH (Cmd/Ctrl+K) (issue #6822).
 *
 * The product's Search shows a Documentation group under its pages and
 * records, read from the same search the docs' own search box asks: the
 * installation's docs server, /docs/search/<lang>.json?q= (App's
 * Docs/Utils/DocsSearch). It reads every page in full and forgives a typo,
 * a half-typed word and a reader's other words for the docs' own, in the
 * reader's language. Every installation serves its own docs, an air-gapped
 * one too, so nothing leaves it.
 *
 * A read that fails - an old server, no docs, offline - is no results,
 * never an error: Search works the same without its docs.
 */

// How many docs results Search shows under its pages and records.
export const DOCS_SEARCH_PALETTE_LIMIT: number = 5;

export interface DocsSearchHit {
  // The page's title, or the section's heading.
  title: string;
  // Where it is in the docs: "On Call › Escalation Rules".
  where: string;
  // The page as a full address, in the reader's language, at the section.
  url: string;
  isSection: boolean;
}

// A docs address ("/docs/de/...") as a full address under DOCS_URL.
export const toDocsAddress: (docsPath: string) => string = (
  docsPath: string,
): string => {
  return `${DOCS_URL.toString().replace(/\/$/, "")}${docsPath.replace(/^\/docs/, "")}`;
};

// Where the docs search for `query` is asked, in the reader's docs language.
export const getDocsSearchUrl: (data: {
  query: string;
  language?: string | undefined;
  limit?: number | undefined;
}) => string = (data: {
  query: string;
  language?: string | undefined;
  limit?: number | undefined;
}): string => {
  const language: string = getDocsLanguageFor(data.language);
  const limit: number = data.limit || DOCS_SEARCH_PALETTE_LIMIT;

  return `${DOCS_URL.toString().replace(/\/$/, "")}/search/${language}.json?q=${encodeURIComponent(data.query)}&limit=${limit}`;
};

/*
 * A translated heading's anchor is written in its language
 * ("#eine-eskalationsregel-hinzufügen"); an address carries it
 * percent-encoded, once.
 */
const percentEncoded: (docsPath: string) => string = (
  docsPath: string,
): string => {
  try {
    return encodeURI(decodeURI(docsPath));
  } catch {
    return encodeURI(docsPath);
  }
};

// A docs page's own address: /docs/<lang>/<page>[#anchor], no spaces.
const DOCS_ADDRESS: RegExp = /^\/docs\/[a-zA-Z-]+\/[^\s]+$/;

const isRecord: (value: unknown) => value is Record<string, unknown> = (
  value: unknown,
): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

/*
 * The docs server's answer, as Search shows it: each result with a title
 * and an address that is a docs page's, nothing else. Anything that is not
 * an answer is no results.
 */
export const readDocsSearchAnswer: (data: unknown) => Array<DocsSearchHit> = (
  data: unknown,
): Array<DocsSearchHit> => {
  if (!isRecord(data) || !Array.isArray(data["results"])) {
    return [];
  }

  const hits: Array<DocsSearchHit> = [];

  for (const result of data["results"]) {
    if (!isRecord(result)) {
      continue;
    }

    const title: unknown = result["title"];
    const url: unknown = result["url"];
    const where: unknown = result["where"];

    // Only a docs page's own address: nothing a broken answer could send elsewhere.
    if (
      typeof title !== "string" ||
      !title.trim() ||
      typeof url !== "string" ||
      !DOCS_ADDRESS.test(url) ||
      url.includes("//") ||
      url.includes("..")
    ) {
      continue;
    }

    hits.push({
      title: title.trim(),
      where: typeof where === "string" ? where : "",
      url: toDocsAddress(percentEncoded(url)),
      isSection: result["isSection"] === true,
    });
  }

  return hits;
};

/*
 * The docs results for what was typed in Search, in the reader's language.
 * Never throws: a read that fails is no results.
 */
export const searchDocs: (data: {
  query: string;
  language?: string | undefined;
  limit?: number | undefined;
}) => Promise<Array<DocsSearchHit>> = async (data: {
  query: string;
  language?: string | undefined;
  limit?: number | undefined;
}): Promise<Array<DocsSearchHit>> => {
  if (!data.query.trim()) {
    return [];
  }

  try {
    const response: Response = await globalThis.fetch(getDocsSearchUrl(data), {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return [];
    }

    return readDocsSearchAnswer(await response.json()).slice(
      0,
      data.limit || DOCS_SEARCH_PALETTE_LIMIT,
    );
  } catch {
    return [];
  }
};

import { DEFAULT_DOCS_LANGUAGE } from "./I18n";
import { ExpressRequest } from "Common/Server/Utils/Express";

/*
 * Where the docs' old addresses go.
 *
 * Before the docs had languages, a page lived at /docs/<category>/<page>.
 * Those addresses are still linked from other sites and still in search
 * results, so they redirect - permanently, to the English page, which is the
 * address a search engine should keep. (They used to redirect temporarily,
 * by the browser's language: search engines kept the old address and the
 * new one, and the clicks were split between them.)
 */

/*
 * First segments of a two-segment /docs address that are not a category of
 * pages: files and endpoints the docs serve, never an old page.
 */
export const NOT_PAGE_CATEGORIES: Array<string> = [
  "static",
  "as-markdown",
  "search-index",
];

// Path segments that are not names: a browser would read them as steps up.
const DOT_SEGMENTS: Array<string> = [".", ".."];

/*
 * The English page an old address without a language now lives at, or null
 * for an address that was never a page.
 */
export const getLegacyDocsPageTarget: (
  category: string,
  page: string,
) => string | null = (category: string, page: string): string | null => {
  const categoryPath: string = category.toLowerCase();
  const pagePath: string = page.toLowerCase();

  if (
    NOT_PAGE_CATEGORIES.includes(categoryPath) ||
    DOT_SEGMENTS.includes(categoryPath) ||
    DOT_SEGMENTS.includes(pagePath)
  ) {
    return null;
  }

  return `/docs/${DEFAULT_DOCS_LANGUAGE}/${encodeURIComponent(categoryPath)}/${encodeURIComponent(pagePath)}`;
};

/*
 * A redirect's target, with the query string the request arrived with -
 * taken as the raw bytes of the original URL, so a campaign's parameters
 * reach the page exactly as they were sent.
 */
export const withQueryOf: (req: ExpressRequest, target: string) => string = (
  req: ExpressRequest,
  target: string,
): string => {
  const originalUrl: string = req.originalUrl || "";
  const separator: number = originalUrl.indexOf("?");
  const query: string =
    separator === -1 ? "" : originalUrl.slice(separator + 1);

  if (!query) {
    return target;
  }

  return `${target}${target.includes("?") ? "&" : "?"}${query}`;
};

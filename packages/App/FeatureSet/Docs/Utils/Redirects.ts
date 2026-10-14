import { DEFAULT_DOCS_LANGUAGE } from "./I18n";
import DocsNav, { NavGroup } from "./Nav";
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
 * A category's own address, /docs/<category> or /docs/<lang>/<category>, is
 * not a page. The website, old emails, search results and people typing an
 * address still ask for it, so it opens the category's first page in the
 * nav: where its pages start, and its overview wherever it has one. A name
 * that is not a category of the nav is not an address of the docs.
 */

// A nav link to a docs page: /docs/<category>/<page>.
const NAV_PAGE_URL: RegExp = /^\/docs\/([^/?#]+)\/([^/?#]+)$/;

/*
 * The first page of a category in the nav, as "category/page", or null when
 * the nav has no such category. The name is matched in any case, as the docs
 * serve every page in lower case.
 */
export const getDocsCategoryFirstPage: (
  category: string,
  nav?: Array<NavGroup>,
) => string | null = (
  category: string,
  nav: Array<NavGroup> = DocsNav,
): string | null => {
  const categoryPath: string = category.toLowerCase();

  for (const group of nav) {
    for (const link of group.links) {
      const page: RegExpMatchArray | null = link.url
        .toLowerCase()
        .match(NAV_PAGE_URL);

      if (page && page[1] === categoryPath) {
        return `${page[1]}/${page[2]}`;
      }
    }
  }

  return null;
};

/*
 * Where a category's own address goes, in the given language: its first
 * page, or null for a name that is not a category of the nav.
 */
export const getDocsCategoryTarget: (
  category: string,
  lang: string,
) => string | null = (category: string, lang: string): string | null => {
  const page: string | null = getDocsCategoryFirstPage(category);

  return page === null ? null : `/docs/${lang}/${page}`;
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

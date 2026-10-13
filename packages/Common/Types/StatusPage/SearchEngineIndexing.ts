/*
 * Search engine indexing for status pages.
 *
 * A status page is indexable only on a custom domain, and only if its owner
 * left indexing on (StatusPage.enableSearchEngineIndexing, which defaults to
 * true). Its preview URL is never indexable; see isSearchEngineIndexingAllowed.
 * A page that is not indexable is marked for crawlers two ways:
 *
 *   - <meta name="robots" content="noindex, nofollow"> in the server-rendered
 *     index.ejs, which is in the HTML before the JS bundle loads
 *   - an X-Robots-Tag response header, which crawlers also honour on
 *     responses that are not HTML (the RSS feed, llms.txt)
 *
 * Both live here rather than in each renderer because the status page is
 * rendered by two servers - the standalone status-page container
 * (App/FeatureSet/StatusPage/Serve.ts) and the combined App container
 * (App/FeatureSet/Frontend/Index.ts) - and the two must not drift.
 */

/*
 * nofollow rides along with noindex: a page that is meant to stay out of
 * search results should not be passing crawl signals to the pages it links to
 * either. This is the same directive Atlassian Statuspage and Status.io emit
 * for their equivalent setting.
 */
export const NOINDEX_ROBOTS_DIRECTIVE: string = "noindex, nofollow";

export const X_ROBOTS_TAG_HEADER_NAME: string = "X-Robots-Tag";

/*
 * Name of the flag on the status page /seo API response, and of the variable
 * handed to index.ejs. Kept as a constant so the API, the two renderers and
 * the template cannot disagree about the spelling.
 */
export const SEARCH_ENGINE_INDEXING_FLAG_NAME: string =
  "enableSearchEngineIndexing";

/**
 * Reads the indexing flag off an untyped value - a JSON field from the /seo
 * API, or a column that predates the migration.
 *
 * Everything that is not an explicit "off" means indexable. Failing this open
 * is deliberate: the flag reaches the renderers over an internal HTTP call,
 * and a blip on that call must not de-index a page whose owner never asked for
 * that. The opposite failure (one render of a noindex page missing its meta
 * tag) costs nothing permanent, because crawlers re-fetch.
 */
export function isSearchEngineIndexingEnabled(value: unknown): boolean {
  if (value === false) {
    return false;
  }

  /*
   * JSON round-trips and query strings can turn the boolean into a string.
   * "false" is the only spelling either produces for false.
   */
  if (value === "false") {
    return false;
  }

  return true;
}

/*
 * Every status page can be opened at /status-page/:statusPageId on the
 * OneUptime host - its preview URL - whether or not it also has a custom
 * domain. On a custom domain it is served from the root of that domain.
 */
const STATUS_PAGE_PREVIEW_PATH_SEGMENT: string = "/status-page/";

export function isStatusPagePreviewPath(path: string): boolean {
  return path.includes(STATUS_PAGE_PREVIEW_PATH_SEGMENT);
}

/**
 * Whether search engines may index a status page at the URL it was requested
 * on: only on a custom domain, and only if the owner left indexing on.
 *
 * The preview URL is never indexable. Every status page has one from the
 * moment it is created, on the OneUptime host rather than on a domain set up
 * for that page, so indexing preview URLs let anyone who could create a status
 * page publish pages into search results under that host - on OneUptime's
 * cloud, spam sites did. It also put a second copy of every page with a custom
 * domain into search, competing with the real one. A page that should appear
 * in search results needs a custom domain.
 *
 * The owner's flag is read with isSearchEngineIndexingEnabled, so on a
 * custom domain anything but an explicit off is still indexable. Pass
 * undefined when the page could not be looked up.
 */
export function isSearchEngineIndexingAllowed(data: {
  path: string;
  indexingFlag: unknown;
}): boolean {
  if (isStatusPagePreviewPath(data.path)) {
    return false;
  }

  return isSearchEngineIndexingEnabled(data.indexingFlag);
}

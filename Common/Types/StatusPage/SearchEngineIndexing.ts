/*
 * Search engine indexing for status pages.
 *
 * A status page is indexable unless its owner turned indexing off
 * (StatusPage.enableSearchEngineIndexing, which defaults to true). The
 * opt-out is carried to crawlers two ways:
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

import { ExpressResponse } from "./Express";
import {
  NOINDEX_ROBOTS_DIRECTIVE,
  X_ROBOTS_TAG_HEADER_NAME,
} from "../../Types/StatusPage/SearchEngineIndexing";

/*
 * How a public page - a status page or a public dashboard - answers a request
 * for a page that, as far as anyone outside its project can tell, does not
 * exist: none was ever made, it is archived (or a dashboard shared only with
 * its project), or a master admin blocked its project. Its API answers all of
 * these with the same 404, so the servers that render the page, its RSS feed
 * and its llms.txt cannot tell them apart either, and answer them alike:
 *
 *   - 404, so search engines drop the URL rather than keep a page they last
 *     saw before it was taken down (a blocked project's pages are most often
 *     spam put into search results);
 *   - X-Robots-Tag: noindex, nofollow, for whatever reads the body anyway -
 *     the page shell renders the matching <meta name="robots"> itself.
 *
 * A lookup that FAILED is not this answer: the page may well exist, and each
 * server keeps serving what it served before (see getStatusPageData).
 */

/*
 * What the page servers' lookups (getStatusPageData, getPublicDashboardData)
 * return for such a page, beside the page's data and null (the lookup
 * failed, or the request named no page). A string rather than a symbol, so it
 * compares equal however many copies of this module a process loads.
 */
export const PUBLIC_PAGE_NOT_FOUND: "PublicPageNotFound" = "PublicPageNotFound";

export type PublicPageNotFound = typeof PUBLIC_PAGE_NOT_FOUND;

// Sets the not-found answer's status and robots header; the caller sends the body.
export default function applyPublicPageNotFound(res: ExpressResponse): void {
  if (res.headersSent) {
    return;
  }

  res.status(404);
  res.set(X_ROBOTS_TAG_HEADER_NAME, NOINDEX_ROBOTS_DIRECTIVE);
}

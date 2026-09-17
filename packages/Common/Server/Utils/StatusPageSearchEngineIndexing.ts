import { ExpressResponse } from "./Express";
import {
  NOINDEX_ROBOTS_DIRECTIVE,
  X_ROBOTS_TAG_HEADER_NAME,
} from "../../Types/StatusPage/SearchEngineIndexing";

/**
 * Sets X-Robots-Tag: noindex, nofollow when the status page has search engine
 * indexing turned off, and sets nothing at all when it is on.
 *
 * The "sets nothing" half is the point. An explicit `index, follow` header
 * would be the default behaviour restated, and it would also override a
 * noindex that an operator put in front of OneUptime (a CDN rule, an ingress
 * annotation) - headers do not merge, the last writer wins. Staying silent
 * leaves those in place.
 *
 * Callers must invoke this before the response is sent; a header set after
 * headers are flushed is dropped by Node, silently.
 */
export default function applyStatusPageRobotsHeader(
  res: ExpressResponse,
  isSearchEngineIndexingEnabled: boolean,
): void {
  if (isSearchEngineIndexingEnabled) {
    return;
  }

  if (res.headersSent) {
    return;
  }

  res.set(X_ROBOTS_TAG_HEADER_NAME, NOINDEX_ROBOTS_DIRECTIVE);
}

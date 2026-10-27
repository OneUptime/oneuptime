import { StatusPageApiInternalUrl } from "Common/Server/EnvironmentConfig";
import { StatusPageApiRoute } from "Common/ServiceRoute";
import ProductBrandingText from "Common/Server/Utils/ProductBrandingText";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import applyStatusPageRobotsHeader from "Common/Server/Utils/StatusPageSearchEngineIndexing";
import applyPublicPageNotFound, {
  PUBLIC_PAGE_NOT_FOUND,
  PublicPageNotFound,
} from "Common/Server/Utils/PublicPageNotFound";
import StatusPageRssFeed from "Common/Server/Utils/StatusPage/StatusPageRssFeed";
import {
  SEARCH_ENGINE_INDEXING_FLAG_NAME,
  isSearchEngineIndexingAllowed,
  isStatusPagePreviewPath,
} from "Common/Types/StatusPage/SearchEngineIndexing";
import StatusPageTheme, {
  parseStatusPageTheme,
  STATUS_PAGE_THEME_COLUMN,
} from "Common/Types/StatusPage/StatusPageTheme";

export interface StatusPageData {
  id: string;
  title: string;
  description: string;
  faviconUrl: string;
  /*
   * False on a preview URL, and on a custom domain whose owner turned
   * indexing off. See Common/Types/StatusPage/SearchEngineIndexing.ts for
   * why anything else - including an unreachable /seo API - reads as
   * indexable on a custom domain.
   */
  isSearchEngineIndexingEnabled: boolean;
  /*
   * Light, Dark or System, as the /seo API reads the page's column; Light
   * when it did not say (Types/StatusPage/StatusPageTheme). The page's HTML
   * is sent in it, so a dark page is dark before its first paint.
   */
  theme: StatusPageTheme;
  /*
   * The language first-time visitors read the page in, as the /seo API
   * reads the page's column; null when it did not say. The page's HTML is
   * sent with it, and with the way it is read: a Persian page is laid out
   * right to left before its first paint.
   */
  defaultLanguage: string | null;
}

/*
 * The page a request names: its data; PUBLIC_PAGE_NOT_FOUND when the status
 * page API says there is no such page - none was made, it is archived, or a
 * master admin blocked its project, which it answers alike - and the caller
 * answers 404 (PublicPageNotFound); or null when the URL names no page or the
 * page could not be looked up.
 */
export const getStatusPageData: (
  req: ExpressRequest,
) => Promise<StatusPageData | PublicPageNotFound | null> = async (
  req: ExpressRequest,
): Promise<StatusPageData | PublicPageNotFound | null> => {
  try {
    logger.debug("Getting status page data", { service: "frontend" });

    let statusPageIdOrDomain: string = "";
    let isPreview: boolean = false;

    const path: string = req.path;
    logger.debug(`Request path: ${path}`, { service: "frontend" });

    if (path && isStatusPagePreviewPath(path)) {
      statusPageIdOrDomain =
        path.split("/status-page/")[1]?.split("/")[0] || "";
      isPreview = true;
      logger.debug(`Found status page ID in URL: ${statusPageIdOrDomain}`, {
        service: "frontend",
      });
    } else {
      const host: string =
        req.hostname?.toString() || req.headers["host"]?.toString() || "";
      if (host) {
        statusPageIdOrDomain = host;
        logger.debug(
          `Found domain in request headers: ${statusPageIdOrDomain}`,
          { service: "frontend" },
        );
      }
    }

    if (!statusPageIdOrDomain) {
      logger.debug("No status page ID or domain found", {
        service: "frontend",
      });
      return null;
    }

    let statusPageId: string;
    let title: string = "Status Page";
    let description: string =
      "Status Page lets you see real-time information about the status of our services.";

    /*
     * The /seo API resolves an id or a custom domain, so preview URLs
     * (/status-page/:statusPageId) go through it too, for the page's title
     * and description. A preview URL is never indexed whatever the owner's
     * setting says, so the lookup does not decide that for it.
     */
    logger.debug(
      `Pinging the API with statusPageIdOrDomain: ${statusPageIdOrDomain}`,
      { service: "frontend" },
    );
    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.get({
        url: URL.fromString(StatusPageApiInternalUrl.toString()).addRoute(
          `/seo/${statusPageIdOrDomain}`,
        ),
      });

    let seoData: JSONObject | null = null;

    /*
     * Not found is an answer, not a failed lookup: the page is served as not
     * found, on a preview URL too, where the id alone could render it.
     */
    if (response instanceof HTTPErrorResponse && response.statusCode === 404) {
      logger.debug("The status page API knows no such page", {
        service: "frontend",
      });
      return PUBLIC_PAGE_NOT_FOUND;
    }

    if (response instanceof HTTPErrorResponse) {
      logger.debug(`Received error response from API: ${response}`, {
        service: "frontend",
      });
    } else {
      logger.debug("Successfully received response from API", {
        service: "frontend",
      });
      seoData = response.data || null;
    }

    if (isPreview) {
      /*
       * A preview URL carries the id, so the page can still be rendered when
       * the lookup fails - it just renders with the default title. Failing
       * the render instead would take the page down over an SEO lookup.
       */
      statusPageId = statusPageIdOrDomain;
    } else {
      if (!seoData) {
        return null;
      }

      statusPageId = seoData["_id"] as string;
      if (!statusPageId) {
        logger.debug("No status page ID in response", { service: "frontend" });
        return null;
      }
    }

    title = (seoData?.["title"] as string) || title;
    description = (seoData?.["description"] as string) || description;

    return {
      id: statusPageId,
      title,
      description,
      faviconUrl: `/status-page-api/favicon/${statusPageIdOrDomain}`,
      isSearchEngineIndexingEnabled: isSearchEngineIndexingAllowed({
        path,
        indexingFlag: seoData?.[SEARCH_ENGINE_INDEXING_FLAG_NAME],
      }),
      theme: parseStatusPageTheme(seoData?.[STATUS_PAGE_THEME_COLUMN]),
      defaultLanguage: (seoData?.["defaultLanguage"] as string | null) || null,
    };
  } catch (err) {
    logger.error("Error getting status page data:", { service: "frontend" });
    logger.error(err, { service: "frontend" });
    return null;
  }
};

export const handleRSS: (
  req: ExpressRequest,
  res: ExpressResponse,
) => Promise<void> = async (
  req: ExpressRequest,
  res: ExpressResponse,
): Promise<void> => {
  try {
    const statusPageData: StatusPageData | PublicPageNotFound | null =
      await getStatusPageData(req);

    if (statusPageData === PUBLIC_PAGE_NOT_FOUND) {
      applyPublicPageNotFound(res);
      res.send("Status page not found");
      return;
    }

    if (!statusPageData) {
      res.status(404).send("Status page not found");
      return;
    }

    const { id: statusPageId, title, description } = statusPageData;

    /*
     * The feed is not HTML, so it has no <meta name="robots"> to carry the
     * owner's opt-out. The header is the only channel it has.
     */
    applyStatusPageRobotsHeader(
      res,
      statusPageData.isSearchEngineIndexingEnabled,
    );

    const isPreview: boolean = req.path.includes("/status-page/");
    const baseUrl: string = isPreview
      ? `${req.protocol}://${req.get("host")}/status-page/${statusPageId}`
      : `${req.protocol}://${req.get("host")}`;

    /*
     * The page's incidents, announcements and scheduled maintenance, read
     * as the reader may read them and dated as the page dates them
     * (StatusPageRssFeed).
     */
    const rssXml: string = await StatusPageRssFeed.build({
      req: req,
      statusPageId: statusPageId,
      title: title,
      description: description,
      baseUrl: baseUrl,
      feedUrl: `${req.protocol}://${req.get("host")}${req.path}`,
    });

    res.set("Content-Type", "application/rss+xml");
    res.send(rssXml);
  } catch (err) {
    logger.error(err, { service: "frontend" });
    res.status(500).send("Internal Server Error");
  }
};

/*
 * Serves an llms.txt document for a status page so that AI agents and
 * crawlers that only issue plain GET requests can discover the
 * machine-readable endpoints of the status page (RSS feed and the
 * overview JSON API).
 *
 * Access control mirrors the RSS feed (/rss): the status page is resolved
 * with getStatusPageData, and a page that does not exist - or is archived,
 * or of a blocked project - or cannot be resolved gets a 404. Everything
 * this document exposes (page title, feed and API URLs) is already exposed
 * by /rss.
 */
export const handleLlmsTxt: (
  req: ExpressRequest,
  res: ExpressResponse,
) => Promise<void> = async (
  req: ExpressRequest,
  res: ExpressResponse,
): Promise<void> => {
  try {
    /*
     * Resolve the status page from the host or the
     * /status-page/:statusPageId path, same as the RSS feed.
     */
    const statusPageData: StatusPageData | PublicPageNotFound | null =
      await getStatusPageData(req);

    if (statusPageData === PUBLIC_PAGE_NOT_FOUND) {
      applyPublicPageNotFound(res);
      res.send("Status page not found");
      return;
    }

    if (!statusPageData) {
      res.status(404).send("Status page not found");
      return;
    }

    const { id: statusPageId, title } = statusPageData;

    applyStatusPageRobotsHeader(
      res,
      statusPageData.isSearchEngineIndexingEnabled,
    );

    const isPreview: boolean = req.path.includes("/status-page/");
    const host: string = req.get("host") || "";
    const baseUrl: string = isPreview
      ? `${req.protocol}://${host}/status-page/${statusPageId}`
      : `${req.protocol}://${host}`;

    const rssFeedUrl: string = `${baseUrl}/rss`;

    /*
     * Public overview JSON endpoint. Constructed the same way the status
     * page SPA constructs API URLs: <protocol>://<host><StatusPageApiRoute>
     * (StatusPageApiRoute is /status-page-api, which is rewritten by the
     * ingress to the status page API).
     */
    const overviewApiUrl: string = `${req.protocol}://${host}${StatusPageApiRoute.toString()}/overview/${statusPageId}`;

    const llmsTxt: string = `# ${title} Status

> This is a service status page powered by ${ProductBrandingText.getProductName()}. It shows real-time status, incidents, announcements, and scheduled maintenance events.

- [RSS Feed](${rssFeedUrl}): RSS feed of incidents, announcements, and scheduled maintenance events.
- [Status Overview JSON](${overviewApiUrl}): Machine-readable JSON overview of the current status, resources, active incidents, announcements, and scheduled maintenance events (HTTP GET).
`;

    res.set("Content-Type", "text/plain; charset=utf-8");
    res.set("Cache-Control", "public, max-age=600");
    res.send(llmsTxt);
  } catch (err) {
    logger.error(err, { service: "frontend" });
    res.status(500).send("Internal Server Error");
  }
};

import { ExpressRequest } from "Common/Server/Utils/Express";
import API from "Common/Utils/API";
import { StatusPageApiInternalUrl } from "Common/Server/EnvironmentConfig";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";
import {
  SEARCH_ENGINE_INDEXING_FLAG_NAME,
  isSearchEngineIndexingEnabled,
} from "Common/Types/StatusPage/SearchEngineIndexing";

export interface StatusPageData {
  id: string;
  title: string;
  description: string;
  faviconUrl: string;
  defaultLanguage: string | null;
  /*
   * False only when the owner turned indexing off. See
   * Common/Types/StatusPage/SearchEngineIndexing.ts for why anything else -
   * including an unreachable /seo API - reads as indexable.
   */
  isSearchEngineIndexingEnabled: boolean;
}

export const getStatusPageData: (
  req: ExpressRequest,
) => Promise<StatusPageData | null> = async (
  req: ExpressRequest,
): Promise<StatusPageData | null> => {
  try {
    logger.debug("Getting status page data", { service: "status-page" });

    let statusPageIdOrDomain: string = "";
    let isPreview: boolean = false;

    const path: string = req.path;
    logger.debug(`Request path: ${path}`, { service: "status-page" });

    if (path && path.includes("/status-page/")) {
      statusPageIdOrDomain =
        path.split("/status-page/")[1]?.split("/")[0] || "";
      isPreview = true;
      logger.debug(`Found status page ID in URL: ${statusPageIdOrDomain}`, {
        service: "status-page",
      });
    } else {
      const host: string =
        req.hostname?.toString() || req.headers["host"]?.toString() || "";
      if (host) {
        statusPageIdOrDomain = host;
        logger.debug(
          `Found domain in request headers: ${statusPageIdOrDomain}`,
          { service: "status-page" },
        );
      }
    }

    if (!statusPageIdOrDomain) {
      logger.debug("No status page ID or domain found", {
        service: "status-page",
      });
      return null;
    }

    let statusPageId: string;
    let title: string = "Status Page";
    let description: string =
      "Status Page lets you see real-time information about the status of our services.";
    let defaultLanguage: string | null = null;

    /*
     * The /seo API resolves an id or a custom domain, so preview URLs
     * (/status-page/:statusPageId) go through it too. They have to: the
     * preview URL is the only URL a status page has until someone attaches a
     * custom domain, so skipping the lookup here would leave the indexing
     * opt-out working on custom domains and doing nothing for everyone else.
     */
    logger.debug(
      `Pinging the API with statusPageIdOrDomain: ${statusPageIdOrDomain}`,
      { service: "status-page" },
    );
    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.get({
        url: URL.fromString(StatusPageApiInternalUrl.toString()).addRoute(
          `/seo/${statusPageIdOrDomain}`,
        ),
      });

    let seoData: JSONObject | null = null;

    if (response instanceof HTTPErrorResponse) {
      logger.debug(`Received error response from API: ${response}`, {
        service: "status-page",
      });
    } else {
      logger.debug("Successfully received response from API", {
        service: "status-page",
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
        logger.debug("No status page ID in response", {
          service: "status-page",
        });
        return null;
      }
    }

    title = (seoData?.["title"] as string) || title;
    description = (seoData?.["description"] as string) || description;
    defaultLanguage = (seoData?.["defaultLanguage"] as string | null) || null;

    return {
      id: statusPageId,
      title,
      description,
      faviconUrl: `/status-page-api/favicon/${statusPageIdOrDomain}`,
      defaultLanguage,
      isSearchEngineIndexingEnabled: isSearchEngineIndexingEnabled(
        seoData?.[SEARCH_ENGINE_INDEXING_FLAG_NAME],
      ),
    };
  } catch (err) {
    logger.error("Error getting status page data:", { service: "status-page" });
    logger.error(err, { service: "status-page" });
    return null;
  }
};

import { ExpressRequest } from "Common/Server/Utils/Express";
import API from "Common/Utils/API";
import { StatusPageApiInternalUrl } from "Common/Server/EnvironmentConfig";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";

export interface StatusPageData {
  id: string;
  title: string;
  description: string;
  faviconUrl: string;
  defaultLanguage: string | null;
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

    if (isPreview) {
      // For preview pages, use the extracted ID directly
      statusPageId = statusPageIdOrDomain;
      // For preview, we might not have SEO data, so use defaults
    } else {
      // For live pages, call SEO API
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

      if (response instanceof HTTPErrorResponse) {
        logger.debug(`Received error response from API: ${response}`, {
          service: "status-page",
        });
        return null;
      }

      logger.debug("Successfully received response from API", {
        service: "status-page",
      });

      statusPageId = response.data?.["_id"] as string;
      if (!statusPageId) {
        logger.debug("No status page ID in response", {
          service: "status-page",
        });
        return null;
      }

      title = (response.data?.["title"] as string) || title;
      description = (response.data?.["description"] as string) || description;
      defaultLanguage =
        (response.data?.["defaultLanguage"] as string | null) || null;
    }

    return {
      id: statusPageId,
      title,
      description,
      faviconUrl: `/status-page-api/favicon/${statusPageIdOrDomain}`,
      defaultLanguage,
    };
  } catch (err) {
    logger.error("Error getting status page data:", { service: "status-page" });
    logger.error(err, { service: "status-page" });
    return null;
  }
};

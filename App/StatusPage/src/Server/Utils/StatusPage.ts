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
}

export const getStatusPageData: (
  req: ExpressRequest,
) => Promise<StatusPageData | null> = async (
  req: ExpressRequest,
): Promise<StatusPageData | null> => {
  try {
    logger.debug("Getting status page data");

    let statusPageIdOrDomain: string = "";
    let isPreview: boolean = false;

    const path: string = req.path;
    logger.debug(`Request path: ${path}`);

    if (path && path.includes("/status-page/")) {
      statusPageIdOrDomain =
        path.split("/status-page/")[1]?.split("/")[0] || "";
      isPreview = true;
      logger.debug(`Found status page ID in URL: ${statusPageIdOrDomain}`);
    } else {
      const host: string =
        req.hostname?.toString() || req.headers["host"]?.toString() || "";
      if (host) {
        statusPageIdOrDomain = host;
        logger.debug(
          `Found domain in request headers: ${statusPageIdOrDomain}`,
        );
      }
    }

    if (!statusPageIdOrDomain) {
      logger.debug("No status page ID or domain found");
      return null;
    }

    let statusPageId: string;
    let title: string = "Status Page";
    let description: string =
      "Status Page lets you see real-time information about the status of our services.";

    if (isPreview) {
      // For preview pages, use the extracted ID directly
      statusPageId = statusPageIdOrDomain;
      // For preview, we might not have SEO data, so use defaults
    } else {
      // For live pages, call SEO API
      logger.debug(
        `Pinging the API with statusPageIdOrDomain: ${statusPageIdOrDomain}`,
      );
      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.get({
          url: URL.fromString(StatusPageApiInternalUrl.toString()).addRoute(
            `/seo/${statusPageIdOrDomain}`,
          ),
        });

      if (response instanceof HTTPErrorResponse) {
        logger.debug(`Received error response from API: ${response}`);
        return null;
      }

      logger.debug("Successfully received response from API");

      statusPageId = response.data?.["_id"] as string;
      if (!statusPageId) {
        logger.debug("No status page ID in response");
        return null;
      }

      title = (response.data?.["title"] as string) || title;
      description = (response.data?.["description"] as string) || description;
    }

    return {
      id: statusPageId,
      title,
      description,
      faviconUrl: `/status-page-api/favicon/${statusPageIdOrDomain}`,
    };
  } catch (err) {
    logger.error("Error getting status page data:");
    logger.error(err);
    return null;
  }
};

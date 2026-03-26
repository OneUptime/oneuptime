import { ExpressRequest } from "Common/Server/Utils/Express";
import API from "Common/Utils/API";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";

const DashboardApiInternalUrl: string =
  process.env["DASHBOARD_API_URL"] ||
  `http://${process.env["SERVER_APP_HOSTNAME"] || "localhost"}:${process.env["APP_PORT"] || "3002"}/api/dashboard`;

export interface PublicDashboardData {
  id: string;
  title: string;
  description: string;
}

export const getPublicDashboardData: (
  req: ExpressRequest,
) => Promise<PublicDashboardData | null> = async (
  req: ExpressRequest,
): Promise<PublicDashboardData | null> => {
  try {
    logger.debug("Getting public dashboard data");

    let dashboardIdOrDomain: string = "";
    let isPreview: boolean = false;

    const path: string = req.path;
    logger.debug(`Request path: ${path}`);

    if (path && path.includes("/public-dashboard/")) {
      dashboardIdOrDomain =
        path.split("/public-dashboard/")[1]?.split("/")[0] || "";
      isPreview = true;
      logger.debug(`Found dashboard ID in URL: ${dashboardIdOrDomain}`);
    } else {
      const host: string =
        req.hostname?.toString() || req.headers["host"]?.toString() || "";
      if (host) {
        dashboardIdOrDomain = host;
        logger.debug(`Found domain in request headers: ${dashboardIdOrDomain}`);
      }
    }

    if (!dashboardIdOrDomain) {
      logger.debug("No dashboard ID or domain found");
      return null;
    }

    let dashboardId: string;
    let title: string = "Dashboard";
    let description: string = "View dashboard metrics and insights.";

    if (isPreview) {
      dashboardId = dashboardIdOrDomain;
    } else {
      logger.debug(
        `Pinging the API with dashboardIdOrDomain: ${dashboardIdOrDomain}`,
      );
      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.get({
          url: URL.fromString(DashboardApiInternalUrl).addRoute(
            `/seo/${dashboardIdOrDomain}`,
          ),
        });

      if (response instanceof HTTPErrorResponse) {
        logger.debug(`Received error response from API: ${response}`);
        return null;
      }

      logger.debug("Successfully received response from API");

      dashboardId = response.data?.["_id"] as string;
      if (!dashboardId) {
        logger.debug("No dashboard ID in response");
        return null;
      }

      title = (response.data?.["title"] as string) || title;
      description = (response.data?.["description"] as string) || description;
    }

    return {
      id: dashboardId,
      title,
      description,
    };
  } catch (err) {
    logger.error("Error getting public dashboard data:");
    logger.error(err);
    return null;
  }
};

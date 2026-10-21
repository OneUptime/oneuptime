import { ExpressRequest } from "Common/Server/Utils/Express";
import API from "Common/Utils/API";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";
import {
  PUBLIC_PAGE_NOT_FOUND,
  PublicPageNotFound,
} from "Common/Server/Utils/PublicPageNotFound";
import DashboardTheme, {
  DASHBOARD_THEME_COLUMN,
  parseDashboardTheme,
} from "Common/Types/Dashboard/DashboardTheme";

const DashboardApiInternalUrl: string =
  process.env["DASHBOARD_API_URL"] ||
  `http://${process.env["SERVER_APP_HOSTNAME"] || "localhost"}:${process.env["APP_PORT"] || "3002"}/api/dashboard`;

export interface PublicDashboardData {
  id: string;
  title: string;
  description: string;
  /*
   * Light, Dark or System, as the dashboard API read it (/seo), for the
   * theme the page's HTML is sent with (Types/Dashboard/DashboardTheme). Null
   * when the answer names none - Access Denied by the IP allowlist, which
   * shows nothing of the dashboard - or the lookup failed: the page then
   * follows the visitor until the app reads the dashboard's own.
   */
  theme: DashboardTheme | null;
}

/*
 * The dashboard a request names: its data; PUBLIC_PAGE_NOT_FOUND when the
 * dashboard API says its link answers nobody - no such dashboard, an archived
 * one, one shared only with its project, or one of a project a master admin
 * blocked, which it answers alike - and the caller answers 404
 * (PublicPageNotFound); or null when the URL names no dashboard or it could
 * not be looked up.
 */
export const getPublicDashboardData: (
  req: ExpressRequest,
) => Promise<PublicDashboardData | PublicPageNotFound | null> = async (
  req: ExpressRequest,
): Promise<PublicDashboardData | PublicPageNotFound | null> => {
  try {
    logger.debug("Getting public dashboard data", {
      service: "public-dashboard",
    });

    let dashboardIdOrDomain: string = "";
    let isPreview: boolean = false;

    const path: string = req.path;
    logger.debug(`Request path: ${path}`, { service: "public-dashboard" });

    if (path && path.includes("/public-dashboard/")) {
      dashboardIdOrDomain =
        path.split("/public-dashboard/")[1]?.split("/")[0] || "";
      isPreview = true;
      logger.debug(`Found dashboard ID in URL: ${dashboardIdOrDomain}`, {
        service: "public-dashboard",
      });
    } else {
      const host: string =
        req.hostname?.toString() || req.headers["host"]?.toString() || "";
      if (host) {
        dashboardIdOrDomain = host;
        logger.debug(
          `Found domain in request headers: ${dashboardIdOrDomain}`,
          { service: "public-dashboard" },
        );
      }
    }

    if (!dashboardIdOrDomain) {
      logger.debug("No dashboard ID or domain found", {
        service: "public-dashboard",
      });
      return null;
    }

    let dashboardId: string;
    let title: string = "Dashboard";
    let description: string = "View dashboard metrics and insights.";

    /*
     * The /seo API resolves an id or a custom domain, so preview URLs
     * (/public-dashboard/:dashboardId) go through it too: for the
     * dashboard's title and description, and to learn whether its link
     * answers at all.
     */
    logger.debug(
      `Pinging the API with dashboardIdOrDomain: ${dashboardIdOrDomain}`,
      { service: "public-dashboard" },
    );
    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.get({
        url: URL.fromString(DashboardApiInternalUrl).addRoute(
          `/seo/${dashboardIdOrDomain}`,
        ),
      });

    // Not found is an answer, not a failed lookup.
    if (response instanceof HTTPErrorResponse && response.statusCode === 404) {
      logger.debug("The dashboard API knows no such public dashboard", {
        service: "public-dashboard",
      });
      return PUBLIC_PAGE_NOT_FOUND;
    }

    let seoData: JSONObject | null = null;

    if (response instanceof HTTPErrorResponse) {
      logger.debug(`Received error response from API: ${response}`, {
        service: "public-dashboard",
      });
    } else {
      logger.debug("Successfully received response from API", {
        service: "public-dashboard",
      });
      seoData = response.data || null;
    }

    if (isPreview) {
      /*
       * A preview URL carries the id, so the page can still be rendered when
       * the lookup fails - with the default title - as it always was.
       */
      dashboardId = dashboardIdOrDomain;
    } else {
      if (!seoData) {
        return null;
      }

      dashboardId = seoData["_id"] as string;
      if (!dashboardId) {
        logger.debug("No dashboard ID in response", {
          service: "public-dashboard",
        });
        return null;
      }
    }

    title = (seoData?.["title"] as string) || title;
    description = (seoData?.["description"] as string) || description;

    return {
      id: dashboardId,
      title,
      description,
      theme:
        seoData && seoData[DASHBOARD_THEME_COLUMN] !== undefined
          ? parseDashboardTheme(seoData[DASHBOARD_THEME_COLUMN])
          : null,
    };
  } catch (err) {
    logger.error("Error getting public dashboard data:", {
      service: "public-dashboard",
    });
    logger.error(err, { service: "public-dashboard" });
    return null;
  }
};

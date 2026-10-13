import { DashboardApiInternalUrl } from "Common/Server/EnvironmentConfig";
import { PublicDashboardApiRoute } from "Common/ServiceRoute";
import ProductBrandingText from "Common/Server/Utils/ProductBrandingText";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import applyPublicPageNotFound, {
  PUBLIC_PAGE_NOT_FOUND,
  PublicPageNotFound,
} from "Common/Server/Utils/PublicPageNotFound";

export interface PublicDashboardData {
  id: string;
  title: string;
  description: string;
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
    logger.debug("Getting public dashboard data", { service: "frontend" });

    let dashboardIdOrDomain: string = "";
    let isPreview: boolean = false;

    const path: string = req.path;
    logger.debug(`Request path: ${path}`, { service: "frontend" });

    if (path && path.includes("/public-dashboard/")) {
      dashboardIdOrDomain =
        path.split("/public-dashboard/")[1]?.split("/")[0] || "";
      isPreview = true;
      logger.debug(`Found dashboard ID in URL: ${dashboardIdOrDomain}`, {
        service: "frontend",
      });
    } else {
      const host: string =
        req.hostname?.toString() || req.headers["host"]?.toString() || "";
      if (host) {
        dashboardIdOrDomain = host;
        logger.debug(
          `Found domain in request headers: ${dashboardIdOrDomain}`,
          { service: "frontend" },
        );
      }
    }

    if (!dashboardIdOrDomain) {
      logger.debug("No dashboard ID or domain found", {
        service: "frontend",
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
      { service: "frontend" },
    );
    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.get({
        url: URL.fromString(DashboardApiInternalUrl.toString()).addRoute(
          `/seo/${dashboardIdOrDomain}`,
        ),
      });

    // Not found is an answer, not a failed lookup.
    if (response instanceof HTTPErrorResponse && response.statusCode === 404) {
      logger.debug("The dashboard API knows no such public dashboard", {
        service: "frontend",
      });
      return PUBLIC_PAGE_NOT_FOUND;
    }

    let seoData: JSONObject | null = null;

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
       * the lookup fails - with the default title - as it always was.
       */
      dashboardId = dashboardIdOrDomain;
    } else {
      if (!seoData) {
        return null;
      }

      dashboardId = seoData["_id"] as string;
      if (!dashboardId) {
        logger.debug("No dashboard ID in response", { service: "frontend" });
        return null;
      }
    }

    title = (seoData?.["title"] as string) || title;
    description = (seoData?.["description"] as string) || description;

    return {
      id: dashboardId,
      title,
      description,
    };
  } catch (err) {
    logger.error("Error getting public dashboard data:", {
      service: "frontend",
    });
    logger.error(err, { service: "frontend" });
    return null;
  }
};

/*
 * Serves an llms.txt document for a public dashboard so that AI agents and
 * crawlers that only issue plain GET requests can discover the dashboard's
 * machine-readable overview endpoint (the SPA shell renders no content
 * without JavaScript).
 *
 * Access control: the dashboard is resolved with getPublicDashboardData,
 * and one whose link answers nobody - or that cannot be resolved - gets a
 * 404. This document only exposes the dashboard title (already in the SPA
 * shell's <title>) and the overview URL; the overview endpoint itself
 * enforces the dashboard's access rules (public flag, IP whitelist, master
 * password).
 */
export const handlePublicDashboardLlmsTxt: (
  req: ExpressRequest,
  res: ExpressResponse,
) => Promise<void> = async (
  req: ExpressRequest,
  res: ExpressResponse,
): Promise<void> => {
  try {
    /*
     * Resolve the dashboard from the host or the
     * /public-dashboard/:dashboardId path, same as the SPA shell render.
     */
    const dashboardData: PublicDashboardData | PublicPageNotFound | null =
      await getPublicDashboardData(req);

    if (dashboardData === PUBLIC_PAGE_NOT_FOUND) {
      applyPublicPageNotFound(res);
      res.send("Dashboard not found");
      return;
    }

    if (!dashboardData) {
      res.status(404).send("Dashboard not found");
      return;
    }

    const { id: dashboardId, title } = dashboardData;

    const host: string = req.get("host") || "";

    /*
     * Public overview JSON endpoint. Constructed the same way the public
     * dashboard SPA constructs API URLs: <protocol>://<host><PublicDashboardApiRoute>
     * (PublicDashboardApiRoute is /public-dashboard-api, which is rewritten
     * by the ingress to the dashboard API).
     */
    const overviewApiUrl: string = `${req.protocol}://${host}${PublicDashboardApiRoute.toString()}/overview/${dashboardId}`;

    const llmsTxt: string = `# ${title}

> This is a public dashboard powered by ${ProductBrandingText.getProductName()}. It shows real-time charts, metrics, and monitoring data.

- [Dashboard Overview JSON](${overviewApiUrl}): Machine-readable JSON overview of this dashboard — its title, description, widgets, and the metric names it displays (HTTP GET).
`;

    res.set("Content-Type", "text/plain; charset=utf-8");
    res.set("Cache-Control", "public, max-age=600");
    res.send(llmsTxt);
  } catch (err) {
    logger.error(err, { service: "frontend" });
    res.status(500).send("Internal Server Error");
  }
};

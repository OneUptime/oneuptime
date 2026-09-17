import { DashboardApiInternalUrl } from "Common/Server/EnvironmentConfig";
import { PublicDashboardApiRoute } from "Common/ServiceRoute";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";

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

    if (isPreview) {
      // For preview pages, use the extracted ID directly.
      dashboardId = dashboardIdOrDomain;
    } else {
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

      if (response instanceof HTTPErrorResponse) {
        logger.debug(`Received error response from API: ${response}`, {
          service: "frontend",
        });
        return null;
      }

      logger.debug("Successfully received response from API", {
        service: "frontend",
      });

      dashboardId = response.data?.["_id"] as string;
      if (!dashboardId) {
        logger.debug("No dashboard ID in response", { service: "frontend" });
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
 * which returns null (-> 404) when it cannot be resolved. This document
 * only exposes the dashboard title (already in the SPA shell's <title>)
 * and the overview URL; the overview endpoint itself enforces the
 * dashboard's access rules (public flag, IP whitelist, master password).
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
    const dashboardData: PublicDashboardData | null =
      await getPublicDashboardData(req);

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

> This is a public dashboard powered by OneUptime. It shows real-time charts, metrics, and monitoring data.

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

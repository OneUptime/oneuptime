import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import logger, {
  getLogAttributesFromRequest,
} from "Common/Server/Utils/Logger";
import { PublicDashboardApiRoute } from "Common/ServiceRoute";
import {
  getPublicDashboardData,
  PublicDashboardData,
} from "../Utils/PublicDashboard";

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
export const handleLlmsTxt: (
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
    logger.error(err, getLogAttributesFromRequest(req as any));
    res.status(500).send("Internal Server Error");
  }
};

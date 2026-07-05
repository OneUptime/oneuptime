import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import logger, {
  getLogAttributesFromRequest,
} from "Common/Server/Utils/Logger";
import { StatusPageApiRoute } from "Common/ServiceRoute";
import { getStatusPageData, StatusPageData } from "../Utils/StatusPage";

/*
 * Serves an llms.txt document for a status page so that AI agents and
 * crawlers that only issue plain GET requests can discover the
 * machine-readable endpoints of the status page (RSS feed and the
 * overview JSON API).
 *
 * Access control mirrors the RSS feed (/rss): the status page is resolved
 * with getStatusPageData, which returns null (-> 404) when the page cannot
 * be resolved. Everything this document exposes (page title, feed and API
 * URLs) is already exposed by /rss.
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
     * Get status page data (resolves the page from the host or the
     * /status-page/:statusPageId path, same as the RSS feed).
     */
    const statusPageData: StatusPageData | null = await getStatusPageData(req);

    if (!statusPageData) {
      res.status(404).send("Status page not found");
      return;
    }

    const { id: statusPageId, title } = statusPageData;

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

> This is a service status page powered by OneUptime. It shows real-time status, incidents, announcements, and scheduled maintenance events.

- [RSS Feed](${rssFeedUrl}): RSS feed of incidents, announcements, and scheduled maintenance events.
- [Status Overview JSON](${overviewApiUrl}): Machine-readable JSON overview of the current status, resources, active incidents, announcements, and scheduled maintenance events (HTTP GET).
`;

    res.set("Content-Type", "text/plain; charset=utf-8");
    res.set("Cache-Control", "public, max-age=600");
    res.send(llmsTxt);
  } catch (err) {
    logger.error(err, getLogAttributesFromRequest(req as any));
    res.status(500).send("Internal Server Error");
  }
};

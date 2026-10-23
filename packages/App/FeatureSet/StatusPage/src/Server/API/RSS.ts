import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import { HttpProtocol } from "Common/Server/EnvironmentConfig";
import logger, {
  getLogAttributesFromRequest,
} from "Common/Server/Utils/Logger";
import { getStatusPageData, StatusPageData } from "../Utils/StatusPage";
import applyStatusPageRobotsHeader from "Common/Server/Utils/StatusPageSearchEngineIndexing";
import applyPublicPageNotFound, {
  PUBLIC_PAGE_NOT_FOUND,
  PublicPageNotFound,
} from "Common/Server/Utils/PublicPageNotFound";
import StatusPageRssFeed from "Common/Server/Utils/StatusPage/StatusPageRssFeed";

export const handleRSS: (
  req: ExpressRequest,
  res: ExpressResponse,
) => Promise<void> = async (
  req: ExpressRequest,
  res: ExpressResponse,
): Promise<void> => {
  try {
    // Get status page data
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
      feedUrl: `${HttpProtocol}${req.get("host")}${req.path}`,
    });

    res.set("Content-Type", "application/rss+xml");
    res.send(rssXml);
  } catch (err) {
    logger.error(err, getLogAttributesFromRequest(req as any));
    res.status(500).send("Internal Server Error");
  }
};

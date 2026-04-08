import { StatusPageApiInternalUrl } from "Common/Server/EnvironmentConfig";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";

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
    logger.debug("Getting status page data", { service: "frontend" });

    let statusPageIdOrDomain: string = "";
    let isPreview: boolean = false;

    const path: string = req.path;
    logger.debug(`Request path: ${path}`, { service: "frontend" });

    if (path && path.includes("/status-page/")) {
      statusPageIdOrDomain =
        path.split("/status-page/")[1]?.split("/")[0] || "";
      isPreview = true;
      logger.debug(`Found status page ID in URL: ${statusPageIdOrDomain}`, { service: "frontend" });
    } else {
      const host: string =
        req.hostname?.toString() || req.headers["host"]?.toString() || "";
      if (host) {
        statusPageIdOrDomain = host;
        logger.debug(
          `Found domain in request headers: ${statusPageIdOrDomain}`,
          { service: "frontend" },
        );
      }
    }

    if (!statusPageIdOrDomain) {
      logger.debug("No status page ID or domain found", { service: "frontend" });
      return null;
    }

    let statusPageId: string;
    let title: string = "Status Page";
    let description: string =
      "Status Page lets you see real-time information about the status of our services.";

    if (isPreview) {
      // For preview pages, use the extracted ID directly.
      statusPageId = statusPageIdOrDomain;
    } else {
      logger.debug(
        `Pinging the API with statusPageIdOrDomain: ${statusPageIdOrDomain}`,
        { service: "frontend" },
      );
      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.get({
          url: URL.fromString(StatusPageApiInternalUrl.toString()).addRoute(
            `/seo/${statusPageIdOrDomain}`,
          ),
        });

      if (response instanceof HTTPErrorResponse) {
        logger.debug(`Received error response from API: ${response}`, { service: "frontend" });
        return null;
      }

      logger.debug("Successfully received response from API", { service: "frontend" });

      statusPageId = response.data?.["_id"] as string;
      if (!statusPageId) {
        logger.debug("No status page ID in response", { service: "frontend" });
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
    logger.error("Error getting status page data:", { service: "frontend" });
    logger.error(err, { service: "frontend" });
    return null;
  }
};

type RSSItem = {
  title: string;
  description: string;
  link: string;
  pubDate: string;
};

export const handleRSS: (
  req: ExpressRequest,
  res: ExpressResponse,
) => Promise<void> = async (
  req: ExpressRequest,
  res: ExpressResponse,
): Promise<void> => {
  try {
    const statusPageData: StatusPageData | null = await getStatusPageData(req);

    if (!statusPageData) {
      res.status(404).send("Status page not found");
      return;
    }

    const { id: statusPageId, title, description } = statusPageData;

    const incidentsResponse: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post({
        url: URL.fromString(StatusPageApiInternalUrl.toString()).addRoute(
          `/incidents/${statusPageId}`,
        ),
        data: {},
        headers: {
          "status-page-id": statusPageId,
        },
      });

    const announcementsResponse: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post({
        url: URL.fromString(StatusPageApiInternalUrl.toString()).addRoute(
          `/announcements/${statusPageId}`,
        ),
        data: {},
        headers: {
          "status-page-id": statusPageId,
        },
      });

    const scheduledResponse: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post({
        url: URL.fromString(StatusPageApiInternalUrl.toString()).addRoute(
          `/scheduled-maintenance-events/${statusPageId}`,
        ),
        data: {},
        headers: {
          "status-page-id": statusPageId,
        },
      });

    const items: RSSItem[] = [];

    const isPreview: boolean = req.path.includes("/status-page/");
    const baseUrl: string = isPreview
      ? `${req.protocol}://${req.get("host")}/status-page/${statusPageId}`
      : `${req.protocol}://${req.get("host")}`;

    if (
      incidentsResponse instanceof HTTPResponse &&
      incidentsResponse.data?.["incidents"]
    ) {
      const incidents: JSONArray = incidentsResponse.data[
        "incidents"
      ] as JSONArray;
      incidents.forEach((incident: JSONObject) => {
        items.push({
          title: `Incident: ${incident["title"]}`,
          description: (incident["description"] as string) || "",
          link: `${baseUrl}/incidents/${incident["_id"]}`,
          pubDate: new Date(incident["createdAt"] as string).toUTCString(),
        });
      });
    }

    if (
      announcementsResponse instanceof HTTPResponse &&
      announcementsResponse.data?.["announcements"]
    ) {
      const announcements: JSONArray = announcementsResponse.data[
        "announcements"
      ] as JSONArray;
      announcements.forEach((announcement: JSONObject) => {
        items.push({
          title: `Announcement: ${announcement["title"]}`,
          description: (announcement["description"] as string) || "",
          link: `${baseUrl}/announcements/${announcement["_id"]}`,
          pubDate: new Date(announcement["createdAt"] as string).toUTCString(),
        });
      });
    }

    if (
      scheduledResponse instanceof HTTPResponse &&
      scheduledResponse.data?.["scheduledMaintenanceEvents"]
    ) {
      const scheduled: JSONArray = scheduledResponse.data[
        "scheduledMaintenanceEvents"
      ] as JSONArray;
      scheduled.forEach((event: JSONObject) => {
        items.push({
          title: `Scheduled Maintenance: ${event["title"]}`,
          description: (event["description"] as string) || "",
          link: `${baseUrl}/scheduled-events/${event["_id"]}`,
          pubDate: new Date(event["createdAt"] as string).toUTCString(),
        });
      });
    }

    items.sort((a: RSSItem, b: RSSItem) => {
      return new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime();
    });

    const feedUrl: string = `${req.protocol}://${req.get("host")}${req.path}`;

    let rssXml: string = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${title} Updates</title>
<description>${description}</description>
<link>${baseUrl}</link>
<atom:link href="${feedUrl}" rel="self" type="application/rss+xml" />
`;

    items.forEach((item: RSSItem) => {
      rssXml += `
<item>
<title><![CDATA[${item.title}]]></title>
<description><![CDATA[${item.description}]]></description>
<link>${item.link}</link>
<guid>${item.link}</guid>
<pubDate>${item.pubDate}</pubDate>
</item>`;
    });

    rssXml += `
</channel>
</rss>`;

    res.set("Content-Type", "application/rss+xml");
    res.send(rssXml);
  } catch (err) {
    logger.error(err, { service: "frontend" });
    res.status(500).send("Internal Server Error");
  }
};

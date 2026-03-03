import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import API from "Common/Utils/API";
import {
  HttpProtocol,
  StatusPageApiInternalUrl,
} from "Common/Server/EnvironmentConfig";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject, JSONArray } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";
import { getStatusPageData, StatusPageData } from "../Utils/StatusPage";

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
    // Get status page data
    const statusPageData: StatusPageData | null = await getStatusPageData(req);

    if (!statusPageData) {
      res.status(404).send("Status page not found");
      return;
    }

    const { id: statusPageId, title, description } = statusPageData;

    // Fetch incidents
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

    // Fetch announcements
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

    // Fetch scheduled maintenance
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

    // Process incidents
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

    // Process announcements
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

    // Process scheduled maintenance
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

    // Sort items by pubDate descending
    items.sort((a: RSSItem, b: RSSItem) => {
      return new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime();
    });

    // Generate RSS XML
    const feedUrl: string = `${HttpProtocol}${req.get("host")}${req.path}`;

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
    logger.error(err);
    res.status(500).send("Internal Server Error");
  }
};

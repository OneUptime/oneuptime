import { StatusPageApiInternalUrl, TrustedProxyHops } from "../../EnvironmentConfig";
import { resolveClientIp } from "../ClientIp";
import { ExpressRequest } from "../Express";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import Dictionary from "../../../Types/Dictionary";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import XML from "../../../Types/XML";
import API from "../../../Utils/API";

/*
 * A STATUS PAGE'S RSS FEED (/rss on the page's domain, /status-page/<id>/rss
 * under OneUptime), written by both servers that serve a status page: the App
 * (Frontend) and the standalone status page server.
 *
 * WHAT IT HOLDS is what the page's Incidents, Announcements and Scheduled
 * Events pages list, read through the same endpoints the page reads
 * (StatusPageAPI), asked as the reader: the reader's address and cookies go
 * with each read (getReadHeaders), so the page's IP allowlist and its
 * sign-in judge the reader, not the server that writes the feed. A feed
 * reader signs in nowhere, so a private page's feed lists nothing.
 *
 * EACH ITEM IS DATED AS THE PAGE DATES IT: an incident by when it was
 * declared, an announcement by when it went up on the page, a scheduled
 * maintenance event by when it is scheduled to start - and that event's
 * description starts with its window. Dated by when each was written, an
 * announcement put up later read as old news, and maintenance announced a
 * week ahead looked like something happening now, then never surfaced again
 * when it started.
 *
 * Its own few words are English, as the page's emails and calendar are.
 */

export interface StatusPageRssItem {
  title: string;
  description: string;
  link: string;
  // The item's pubDate; null when it has no date the feed can write.
  date: Date | null;
}

export interface StatusPageRssShownLists {
  incidents: JSONArray;
  announcements: JSONArray;
  scheduledMaintenanceEvents: JSONArray;
}

const WEEKDAYS: ReadonlyArray<string> = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
];

const MONTHS: ReadonlyArray<string> = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export default class StatusPageRssFeed {
  /*
   * The headers of the feed's reads of the status page API: the page, the
   * reader's cookies (a private page's signed-in reader, in a browser), and
   * the reader's address where the API looks for it. The API reads a
   * request's address TRUSTED_PROXY_HOPS entries from the right of
   * X-Forwarded-For (ClientIp), so the address this server resolved for the
   * reader goes in that many times, and every place the API may read holds
   * it. A read without it was judged by this server's own address: an
   * allowlist that left the server out gave every reader an empty feed, and
   * one that let it in gave every reader the page.
   */
  public static getReadHeaders(data: {
    req: ExpressRequest;
    statusPageId: string;
  }): Dictionary<string> {
    const headers: Dictionary<string> = {
      "status-page-id": data.statusPageId,
    };

    const readerAddress: string | undefined = resolveClientIp(data.req);

    if (readerAddress) {
      const hops: number = Math.max(1, Math.floor(TrustedProxyHops) || 0);

      headers["x-forwarded-for"] = new Array(hops)
        .fill(readerAddress)
        .join(", ");
    }

    const cookie: unknown = data.req.headers?.["cookie"];

    if (typeof cookie === "string" && cookie.trim()) {
      headers["cookie"] = cookie;
    }

    return headers;
  }

  // The three lists the page shows, read as the reader may read them.
  public static async readShownLists(data: {
    req: ExpressRequest;
    statusPageId: string;
  }): Promise<StatusPageRssShownLists> {
    const headers: Dictionary<string> = StatusPageRssFeed.getReadHeaders(data);

    const read: (route: string, key: string) => Promise<JSONArray> = async (
      route: string,
      key: string,
    ): Promise<JSONArray> => {
      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post({
          url: URL.fromString(StatusPageApiInternalUrl.toString()).addRoute(
            `/${route}/${data.statusPageId}`,
          ),
          data: {},
          headers: headers,
        });

      if (!(response instanceof HTTPResponse)) {
        return [];
      }

      const list: unknown = response.data?.[key];

      return Array.isArray(list) ? (list as JSONArray) : [];
    };

    const [incidents, announcements, scheduledMaintenanceEvents]: [
      JSONArray,
      JSONArray,
      JSONArray,
    ] = await Promise.all([
      read("incidents", "incidents"),
      read("announcements", "announcements"),
      read("scheduled-maintenance-events", "scheduledMaintenanceEvents"),
    ]);

    return {
      incidents: incidents,
      announcements: announcements,
      scheduledMaintenanceEvents: scheduledMaintenanceEvents,
    };
  }

  /*
   * The feed's items, newest first: each dated as the page dates it, an
   * item with no date last.
   */
  public static buildItems(data: {
    lists: StatusPageRssShownLists;
    baseUrl: string;
  }): Array<StatusPageRssItem> {
    const items: Array<StatusPageRssItem> = [];

    for (const incident of data.lists.incidents as Array<JSONObject>) {
      items.push({
        title: `Incident: ${StatusPageRssFeed.text(incident["title"])}`,
        description: StatusPageRssFeed.text(incident["description"]),
        link: `${data.baseUrl}/incidents/${StatusPageRssFeed.text(incident["_id"])}`,
        date:
          StatusPageRssFeed.toDate(incident["declaredAt"]) ||
          StatusPageRssFeed.toDate(incident["createdAt"]),
      });
    }

    for (const announcement of data.lists.announcements as Array<JSONObject>) {
      items.push({
        title: `Announcement: ${StatusPageRssFeed.text(announcement["title"])}`,
        description: StatusPageRssFeed.text(announcement["description"]),
        link: `${data.baseUrl}/announcements/${StatusPageRssFeed.text(announcement["_id"])}`,
        date:
          StatusPageRssFeed.toDate(announcement["showAnnouncementAt"]) ||
          StatusPageRssFeed.toDate(announcement["createdAt"]),
      });
    }

    for (const event of data.lists
      .scheduledMaintenanceEvents as Array<JSONObject>) {
      const startsAt: Date | null = StatusPageRssFeed.toDate(event["startsAt"]);
      const endsAt: Date | null = StatusPageRssFeed.toDate(event["endsAt"]);
      const description: string = StatusPageRssFeed.text(event["description"]);
      const window: string = StatusPageRssFeed.describeWindow(startsAt, endsAt);

      items.push({
        title: `Scheduled Maintenance: ${StatusPageRssFeed.text(event["title"])}`,
        description: window
          ? description
            ? `${window}\n\n${description}`
            : window
          : description,
        link: `${data.baseUrl}/scheduled-events/${StatusPageRssFeed.text(event["_id"])}`,
        date: startsAt || StatusPageRssFeed.toDate(event["createdAt"]),
      });
    }

    return items.sort((a: StatusPageRssItem, b: StatusPageRssItem): number => {
      if (!a.date || !b.date) {
        return Number(!a.date) - Number(!b.date);
      }

      return b.date.getTime() - a.date.getTime();
    });
  }

  /*
   * When a maintenance window is, in UTC: "Scheduled from Sat, 25 Oct 2026
   * 02:00 UTC to Sat, 25 Oct 2026 04:00 UTC." - or "Scheduled for ..." when
   * it has no end. Empty when it has no start.
   */
  public static describeWindow(
    startsAt: Date | null,
    endsAt: Date | null,
  ): string {
    if (!startsAt) {
      return "";
    }

    if (!endsAt) {
      return `Scheduled for ${StatusPageRssFeed.formatUtc(startsAt)}.`;
    }

    return `Scheduled from ${StatusPageRssFeed.formatUtc(startsAt)} to ${StatusPageRssFeed.formatUtc(endsAt)}.`;
  }

  // "Sat, 25 Oct 2026 02:00 UTC".
  public static formatUtc(date: Date): string {
    const pad: (value: number) => string = (value: number): string => {
      return value.toString().padStart(2, "0");
    };

    return `${WEEKDAYS[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${
      MONTHS[date.getUTCMonth()]
    } ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(
      date.getUTCMinutes(),
    )} UTC`;
  }

  /*
   * The feed's XML. Every value goes through XML.escape: one "&" in a page
   * title, or a "]]>" ending a CDATA section early, and feed readers reject
   * the whole feed. The links carry the request's host and path.
   */
  public static render(data: {
    title: string;
    description: string;
    baseUrl: string;
    feedUrl: string;
    items: Array<StatusPageRssItem>;
  }): string {
    let rssXml: string = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${XML.escape(data.title)} Updates</title>
<description>${XML.escape(data.description)}</description>
<link>${XML.escape(data.baseUrl)}</link>
<atom:link href="${XML.escape(data.feedUrl)}" rel="self" type="application/rss+xml" />
`;

    for (const item of data.items) {
      rssXml += `
<item>
<title>${XML.escape(item.title)}</title>
<description>${XML.escape(item.description)}</description>
<link>${XML.escape(item.link)}</link>
<guid>${XML.escape(item.link)}</guid>${
        item.date ? `\n<pubDate>${item.date.toUTCString()}</pubDate>` : ""
      }
</item>`;
    }

    rssXml += `
</channel>
</rss>`;

    return rssXml;
  }

  // The whole feed of a page, read as the reader may read it.
  public static async build(data: {
    req: ExpressRequest;
    statusPageId: string;
    title: string;
    description: string;
    baseUrl: string;
    feedUrl: string;
  }): Promise<string> {
    const lists: StatusPageRssShownLists =
      await StatusPageRssFeed.readShownLists({
        req: data.req,
        statusPageId: data.statusPageId,
      });

    return StatusPageRssFeed.render({
      title: data.title,
      description: data.description,
      baseUrl: data.baseUrl,
      feedUrl: data.feedUrl,
      items: StatusPageRssFeed.buildItems({
        lists: lists,
        baseUrl: data.baseUrl,
      }),
    });
  }

  /*
   * A date as the API sends it - a Date once its answer is read, an ISO
   * string, or { _type: "DateTime", value } still serialized - or null.
   */
  public static toDate(value: unknown): Date | null {
    let candidate: unknown = value;

    if (
      candidate &&
      typeof candidate === "object" &&
      !(candidate instanceof Date) &&
      "value" in (candidate as JSONObject)
    ) {
      candidate = (candidate as JSONObject)["value"];
    }

    if (candidate instanceof Date) {
      return Number.isNaN(candidate.getTime()) ? null : candidate;
    }

    if (typeof candidate !== "string" || !candidate.trim()) {
      return null;
    }

    const date: Date = new Date(candidate);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  // A text field as the feed writes it: "" when it is not text.
  private static text(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }

    if (value === null || value === undefined) {
      return "";
    }

    return String(value);
  }
}

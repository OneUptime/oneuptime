import {
  StatusPageApiInternalUrl,
  TrustedProxyHops,
} from "../../EnvironmentConfig";
import { resolveClientIp } from "../ClientIp";
import { ExpressRequest } from "../Express";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import Dictionary from "../../../Types/Dictionary";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import XML from "../../../Types/XML";
import API from "../../../Utils/API";
import StatusPageIncidentGrouping, {
  INCIDENT_LIST_MODE_RESPONSE_KEY,
  StatusPageIncidentListCards,
  StatusPageIncidentListMode,
} from "../../../Utils/StatusPage/IncidentGrouping";

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
 * Its incidents are laid out as the page lays them out (#10767,
 * StatusPageIncidentGrouping): an item for each incident card and each
 * episode card the Incidents page draws. Grouped by episode, an episode is
 * one item that names its incidents, and they get none of their own; on a
 * page that shows episodes only, the episodes are its items. The feed used
 * to read the incident list alone, so a page of episodes had none.
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
  /*
   * The episodes the page lists, each with the incidents it holds while the
   * page groups incidents by episode. Empty while it shows none.
   */
  episodes?: JSONArray | undefined;
  /*
   * How the page lays its incidents and episodes out, as its answers name
   * it. Left out, each list is drawn on its own.
   */
  incidentListMode?: StatusPageIncidentListMode | undefined;
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

  // The lists the page shows, read as the reader may read them.
  public static async readShownLists(data: {
    req: ExpressRequest;
    statusPageId: string;
  }): Promise<StatusPageRssShownLists> {
    const headers: Dictionary<string> = StatusPageRssFeed.getReadHeaders(data);

    // A list's whole answer, or null when the page does not let it be read.
    const read: (route: string) => Promise<JSONObject | null> = async (
      route: string,
    ): Promise<JSONObject | null> => {
      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post({
          url: URL.fromString(StatusPageApiInternalUrl.toString()).addRoute(
            `/${route}/${data.statusPageId}`,
          ),
          data: {},
          headers: headers,
        });

      if (!(response instanceof HTTPResponse)) {
        return null;
      }

      return response.data || null;
    };

    const [incidents, episodes, announcements, scheduledMaintenanceEvents]: [
      JSONObject | null,
      JSONObject | null,
      JSONObject | null,
      JSONObject | null,
    ] = await Promise.all([
      read("incidents"),
      read("episodes"),
      read("announcements"),
      read("scheduled-maintenance-events"),
    ]);

    return {
      incidents: StatusPageRssFeed.listOf(incidents, "incidents"),
      episodes: StatusPageRssFeed.listOf(episodes, "episodes"),
      incidentListMode: StatusPageRssFeed.readIncidentListMode(
        incidents,
        episodes,
      ),
      announcements: StatusPageRssFeed.listOf(announcements, "announcements"),
      scheduledMaintenanceEvents: StatusPageRssFeed.listOf(
        scheduledMaintenanceEvents,
        "scheduledMaintenanceEvents",
      ),
    };
  }

  // A list an answer holds under its key, or none.
  public static listOf(answer: JSONObject | null, key: string): JSONArray {
    const list: unknown = answer?.[key];

    return Array.isArray(list) ? (list as JSONArray) : [];
  }

  /*
   * The mode the incident or the episode list names. A server that predates
   * it names none, and each list is then drawn on its own, as before.
   */
  public static readIncidentListMode(
    ...answers: Array<JSONObject | null>
  ): StatusPageIncidentListMode {
    for (const answer of answers) {
      const mode: unknown = answer?.[INCIDENT_LIST_MODE_RESPONSE_KEY];

      if (mode !== undefined && mode !== null) {
        return StatusPageIncidentGrouping.readMode(
          mode,
          StatusPageIncidentListMode.Separate,
        );
      }
    }

    return StatusPageIncidentListMode.Separate;
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

    // The incident and episode cards the page's Incidents page draws.
    const cards: StatusPageIncidentListCards<JSONObject, JSONObject> =
      StatusPageIncidentGrouping.getCards<JSONObject, JSONObject>({
        mode:
          data.lists.incidentListMode || StatusPageIncidentListMode.Separate,
        incidents: data.lists.incidents as Array<JSONObject>,
        episodes: (data.lists.episodes || []) as Array<JSONObject>,
        getIncidentId: (incident: JSONObject): string => {
          return StatusPageRssFeed.text(incident["_id"]);
        },
        getEpisodeIncidentIds: (episode: JSONObject): Array<string> => {
          return StatusPageIncidentGrouping.getEpisodeIncidentIdsFromJson(
            episode,
          );
        },
      });

    for (const incident of cards.incidents) {
      items.push({
        title: `Incident: ${StatusPageRssFeed.text(incident["title"])}`,
        description: StatusPageRssFeed.text(incident["description"]),
        link: `${data.baseUrl}/incidents/${StatusPageRssFeed.text(incident["_id"])}`,
        date:
          StatusPageRssFeed.toDate(incident["declaredAt"]) ||
          StatusPageRssFeed.toDate(incident["createdAt"]),
      });
    }

    /*
     * An episode is an incident to the page's readers, opened at the
     * incident's own address, as the page opens it. While the page shows
     * incidents too, its description ends with the incidents it holds, as
     * its page lists them; grouped, those get no item of their own.
     */
    for (const episode of cards.episodes) {
      const description: string = StatusPageRssFeed.text(
        episode["description"],
      );
      const holds: string = StatusPageRssFeed.describeEpisodeIncidents(episode);

      items.push({
        title: `Incident: ${StatusPageRssFeed.text(episode["title"])}`,
        description: holds
          ? description
            ? `${description}\n\n${holds}`
            : holds
          : description,
        link: `${data.baseUrl}/incidents/${StatusPageRssFeed.text(episode["_id"])}`,
        date:
          StatusPageRssFeed.toDate(episode["declaredAt"]) ||
          StatusPageRssFeed.toDate(episode["createdAt"]),
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
   * The incidents an episode holds, as its item says them while the page
   * shows incidents too: "Related incidents: Website down, API down."
   * Empty when it lists none - on a page that shows episodes only, an
   * episode carries no incidents (EPISODE_INCIDENTS_KEY).
   */
  public static describeEpisodeIncidents(episode: JSONObject): string {
    const titles: Array<string> =
      StatusPageIncidentGrouping.getEpisodeIncidentsFromJson(episode)
        .map((incident: JSONObject): string => {
          return StatusPageRssFeed.text(incident["title"]).trim();
        })
        .filter((title: string): boolean => {
          return Boolean(title);
        });

    if (titles.length === 0) {
      return "";
    }

    return `Related incidents: ${titles.join(", ")}.`;
  }

  /*
   * When a maintenance window is, in UTC: "Scheduled from Sun, 25 Oct 2026
   * 02:00 to 04:00 UTC." for a window within one day, "Scheduled from Sat,
   * 24 Oct 2026 22:00 UTC to Sun, 25 Oct 2026 02:00 UTC." for one that
   * crosses midnight, or "Scheduled for ..." when it has no end. Empty when
   * it has no start.
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

    if (
      StatusPageRssFeed.formatUtcDay(startsAt) ===
      StatusPageRssFeed.formatUtcDay(endsAt)
    ) {
      return `Scheduled from ${StatusPageRssFeed.formatUtcDay(startsAt)} ${StatusPageRssFeed.formatUtcTime(startsAt)} to ${StatusPageRssFeed.formatUtcTime(endsAt)} UTC.`;
    }

    return `Scheduled from ${StatusPageRssFeed.formatUtc(startsAt)} to ${StatusPageRssFeed.formatUtc(endsAt)}.`;
  }

  // "Sun, 25 Oct 2026 02:00 UTC".
  public static formatUtc(date: Date): string {
    return `${StatusPageRssFeed.formatUtcDay(date)} ${StatusPageRssFeed.formatUtcTime(date)} UTC`;
  }

  // "Sun, 25 Oct 2026".
  public static formatUtcDay(date: Date): string {
    return `${WEEKDAYS[date.getUTCDay()]}, ${StatusPageRssFeed.pad(
      date.getUTCDate(),
    )} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  }

  // "02:00", in UTC.
  public static formatUtcTime(date: Date): string {
    return `${StatusPageRssFeed.pad(date.getUTCHours())}:${StatusPageRssFeed.pad(
      date.getUTCMinutes(),
    )}`;
  }

  private static pad(value: number): string {
    return value.toString().padStart(2, "0");
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

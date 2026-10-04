import { JSONObject } from "../JSON";
import StatusPageEventType from "./StatusPageEventType";

/*
 * Which status pages list some monitors: where a scheduled maintenance event
 * or an announcement about those monitors belongs. The dashboard suggests
 * these pages under the status page picker of those forms - "Status pages
 * that show the affected monitors: Public, EU · Add all" - so nobody has to
 * guess which pages their customers read about those monitors on. It only
 * suggests: nothing is picked without a click, because picking a page
 * publishes the event there and tells the page's subscribers.
 *
 * POST /status-page/listing-monitors (StatusPageAPI) answers it, from
 * StatusPageResourceService.findByMonitors - the lookup the subscriber jobs
 * use, so a page that lists a monitor through a monitor group, or through a
 * monitor rule that added it, counts the same way it does when the
 * notifications go out.
 *
 * What a caller learns is bounded by what they may read
 * (StatusPagesListingMonitorsBuilder): only the monitors they can read are
 * looked up, and only the status pages they can read are named - status page
 * access can be limited to pages with some labels, and a page outside those
 * is neither named nor counted. An archived page, or one that does not show
 * the kind of event asked about, is left out: adding the event to it would
 * show nobody anything.
 *
 * Everything here is shared by the server, which builds the answer, and the
 * dashboard, which reads it, so the two cannot drift apart.
 */

// A status page that lists some of the monitors, by name.
export interface StatusPageListingMonitors {
  statusPageId: string;
  name: string;
}

export interface StatusPagesListingMonitorsResult {
  // In name order.
  statusPages: Array<StatusPageListingMonitors>;
}

export default class StatusPagesListingMonitors {
  // The route, under the API's base URL.
  public static readonly apiPath: string = "/status-page/listing-monitors";

  // How many monitors one request may name.
  public static readonly maxIdsPerRequest: number = 1000;

  /*
   * The kinds of event a request may ask about. A page that does not show
   * that kind of event (StatusPage.showScheduledMaintenanceEventsOnStatusPage,
   * showAnnouncementsOnStatusPage) is not suggested for it. Incidents are not
   * here: an incident already reaches every page that lists its monitors, and
   * picking pages for one only narrows that (IncidentStatusPageScope).
   */
  public static readonly eventTypes: ReadonlyArray<StatusPageEventType> = [
    StatusPageEventType.ScheduledEvent,
    StatusPageEventType.Announcement,
  ];

  public static isEventType(value: unknown): value is StatusPageEventType {
    return (
      typeof value === "string" &&
      (this.eventTypes as ReadonlyArray<string>).includes(value)
    );
  }

  /*
   * The server's answer as the dashboard receives it. Read defensively: the
   * suggestion is advisory, and a field that is missing or of the wrong type
   * must read as "nothing to suggest" rather than break the form it sits
   * on. A page without an id is dropped, and so is a second mention of one.
   */
  public static fromJSON(json: JSONObject): StatusPagesListingMonitorsResult {
    const items: Array<unknown> = Array.isArray(json["statusPages"])
      ? (json["statusPages"] as Array<unknown>)
      : [];

    const statusPages: Array<StatusPageListingMonitors> = [];

    for (const item of items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }

      const record: JSONObject = item as JSONObject;

      const statusPageId: string = String(record["statusPageId"] || "")
        .trim()
        .toLowerCase();

      if (
        !statusPageId ||
        statusPages.some((existing: StatusPageListingMonitors): boolean => {
          return existing.statusPageId === statusPageId;
        })
      ) {
        continue;
      }

      statusPages.push({
        statusPageId: statusPageId,
        name: String(record["name"] || "").trim(),
      });
    }

    return { statusPages: statusPages };
  }

  public static toJSON(result: StatusPagesListingMonitorsResult): JSONObject {
    return {
      statusPages: result.statusPages.map(
        (statusPage: StatusPageListingMonitors): JSONObject => {
          return {
            statusPageId: statusPage.statusPageId,
            name: statusPage.name,
          };
        },
      ),
    };
  }

  /*
   * Status pages in the order they are suggested: by name, the way people
   * read a list of names - case-insensitive, and "Site 2" before "Site 10".
   */
  public static compareByName(
    a: StatusPageListingMonitors,
    b: StatusPageListingMonitors,
  ): number {
    return (
      a.name.localeCompare(b.name, "en", {
        sensitivity: "base",
        numeric: true,
      }) || a.statusPageId.localeCompare(b.statusPageId)
    );
  }
}

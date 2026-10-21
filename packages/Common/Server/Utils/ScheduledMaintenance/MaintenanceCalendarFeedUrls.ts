import { Host, HttpProtocol } from "../../EnvironmentConfig";
import OnCallCalendarFeedUrls from "../OnCall/OnCallCalendarFeedUrls";
import { AppApiRoute } from "../../../ServiceRoute";
import Protocol from "../../../Types/API/Protocol";
import CalendarSubscriptionLinks, {
  CalendarSubscriptionLinkSet,
} from "../../../Types/Calendar/CalendarSubscriptionLinks";
import { MAINTENANCE_CALENDAR_FILE_NAME } from "../../../Types/ScheduledMaintenance/MaintenanceCalendar";

/*
 * The addresses of the team's calendar link for scheduled maintenance, and
 * the warnings the dialog shows beside it.
 *
 * As for the on-call links (OnCallCalendarFeedUrls), every address is built
 * from the instance's own configuration - HOST and HTTP_PROTOCOL - never from
 * the request that asked for it: a Host header is the caller's to write, and
 * a link minted from it would point wherever the caller said. The three
 * shapes are the three ways calendar apps subscribe (https, webcal://, and
 * Google's add-by-URL link with the webcal:// address in its cid).
 *
 * The path is a public contract shared with the Nginx location that keeps
 * these URLs out of its logs (`^/api/scheduled-maintenance-calendar/project/`)
 * and with ScheduledMaintenanceCalendarAPI's routes; change them together.
 */

export const SCHEDULED_MAINTENANCE_CALENDAR_ROUTE_PREFIX: string =
  "/scheduled-maintenance-calendar";

// The team's link is the project's: /scheduled-maintenance-calendar/project/<token>/maintenance.ics
export const TEAM_CALENDAR_PATH_SEGMENT: string = "project";

/*
 * The on-call link's protocol warning speaks of shifts; this one of the
 * events the link serves.
 */
export const MAINTENANCE_CALENDAR_PROTOCOL_WARNING: string =
  "HTTP_PROTOCOL is http, so this link travels unencrypted. Anyone who can see the traffic can read the link and the maintenance events it serves; serve OneUptime over https to fix this.";

export interface MaintenanceCalendarFeedUrlOptions {
  token: string;
  // Defaults to EnvironmentConfig.Host.
  host?: string | undefined;
  // Defaults to EnvironmentConfig.HttpProtocol.
  protocol?: Protocol | undefined;
}

export default class MaintenanceCalendarFeedUrls {
  /*
   * The route path (without the /api prefix):
   * /scheduled-maintenance-calendar/project/<token>/maintenance.ics
   */
  public static getFeedRoutePath(token: string): string {
    return `${SCHEDULED_MAINTENANCE_CALENDAR_ROUTE_PREFIX}/${TEAM_CALENDAR_PATH_SEGMENT}/${encodeURIComponent(
      token,
    )}/${MAINTENANCE_CALENDAR_FILE_NAME}`;
  }

  // The public path, with the /api prefix the app router is mounted under.
  public static getFeedPath(token: string): string {
    return `${AppApiRoute.toString()}${MaintenanceCalendarFeedUrls.getFeedRoutePath(
      token,
    )}`;
  }

  public static buildFeedUrls(
    options: MaintenanceCalendarFeedUrlOptions,
  ): CalendarSubscriptionLinkSet {
    const protocol: Protocol =
      options.protocol === undefined ? HttpProtocol : options.protocol;
    const host: string = OnCallCalendarFeedUrls.normalizeHost(
      options.host === undefined ? Host : options.host,
    );

    return CalendarSubscriptionLinks.build(
      `${protocol}${host}${MaintenanceCalendarFeedUrls.getFeedPath(
        options.token,
      )}`,
    );
  }

  // Non-null when HOST is empty or a loopback name (OnCallCalendarFeedUrls).
  public static getHostWarning(host?: string | undefined): string | null {
    return OnCallCalendarFeedUrls.getHostWarning(host);
  }

  // HOST, when it is a private address Google Calendar cannot reach.
  public static getPrivateHost(host?: string | undefined): string | null {
    return OnCallCalendarFeedUrls.getPrivateHost(host);
  }

  // Non-null when the instance serves plain http.
  public static getProtocolWarning(
    protocol?: Protocol | undefined,
  ): string | null {
    const value: Protocol = protocol === undefined ? HttpProtocol : protocol;

    if (value !== Protocol.HTTPS) {
      return MAINTENANCE_CALENDAR_PROTOCOL_WARNING;
    }

    return null;
  }
}

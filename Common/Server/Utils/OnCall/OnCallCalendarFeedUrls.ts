import { Host, HttpProtocol } from "../../EnvironmentConfig";
import { AppApiRoute } from "../../../ServiceRoute";
import Protocol from "../../../Types/API/Protocol";
import { OnCallCalendarFeedKind } from "../../../Types/OnCallDutyPolicy/OnCallCalendarFeedUtil";

/*
 * The subscription URLs of an on-call calendar feed, and the two deployment
 * warnings the settings page shows next to them.
 *
 * Every URL is built from the instance's OWN configuration (HOST and
 * HTTP_PROTOCOL), never from the request that asked for it: a Host header is
 * caller-supplied, and a link minted from it would be a link to wherever the
 * caller said. The three shapes are the three ways calendar clients take a
 * subscription:
 *
 *   https     the plain URL. Google Calendar ("From URL"), Outlook on the web
 *             and Thunderbird take this as-is.
 *   webcal    the same URL under the webcal:// scheme (webcals:// when the
 *             instance serves https). Apple Calendar on macOS and iOS opens it
 *             straight into a "Subscribe" sheet; Windows without Outlook has no
 *             handler for it, which the docs explain.
 *   googleAdd Google Calendar's add-by-URL deep link, the https URL encoded
 *             into its `cid` parameter.
 *
 * The path segments are a public contract shared with the Nginx access-log
 * exemption (`^/api/on-call-calendar/(user|schedule|project)/`) and the
 * OnCallCalendarAPI routes; change them together or not at all.
 */

export const ON_CALL_CALENDAR_ROUTE_PREFIX: string = "/on-call-calendar";

export const PERSONAL_FEED_FILE_NAME: string = "shifts.ics";
export const SCHEDULE_FEED_FILE_NAME: string = "schedule.ics";
export const PROJECT_FEED_FILE_NAME: string = "project.ics";

export const GOOGLE_CALENDAR_ADD_BY_URL: string =
  "https://calendar.google.com/calendar/r?cid=";

export const HOST_WARNING: string =
  "HOST is not set to a public address, so calendar apps outside this machine cannot reach this link. Set HOST to the address your team uses to open OneUptime.";

export const PROTOCOL_WARNING: string =
  "HTTP_PROTOCOL is http, so this link travels unencrypted. Anyone who can see the traffic can read the link and the shifts it serves; serve OneUptime over https to fix this.";

/*
 * Hosts that only ever resolve to the machine the browser runs on. A link
 * built on one of these works for exactly one person, and only until they
 * close their laptop.
 */
const LOCAL_HOST_NAMES: Array<string> = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
];

export interface FeedUrls {
  https: string;
  webcal: string;
  googleAdd: string;
}

export interface FeedUrlOptions {
  kind: OnCallCalendarFeedKind;
  token: string;
  /* Defaults to EnvironmentConfig.Host. */
  host?: string | undefined;
  /* Defaults to EnvironmentConfig.HttpProtocol. */
  protocol?: Protocol | undefined;
}

export default class OnCallCalendarFeedUrls {
  /*
   * The route path (without the /api prefix) a feed of this kind is served
   * on, e.g. `/on-call-calendar/user/<token>/shifts.ics`.
   */
  public static getFeedRoutePath(
    kind: OnCallCalendarFeedKind,
    token: string,
  ): string {
    const segment: string = OnCallCalendarFeedUrls.getKindSegment(kind);
    const fileName: string = OnCallCalendarFeedUrls.getFileName(kind);

    return `${ON_CALL_CALENDAR_ROUTE_PREFIX}/${segment}/${encodeURIComponent(
      token,
    )}/${fileName}`;
  }

  /*
   * The public path INCLUDING the /api prefix that the app router is mounted
   * under, e.g. `/api/on-call-calendar/user/<token>/shifts.ics`.
   */
  public static getFeedPath(
    kind: OnCallCalendarFeedKind,
    token: string,
  ): string {
    return `${AppApiRoute.toString()}${OnCallCalendarFeedUrls.getFeedRoutePath(
      kind,
      token,
    )}`;
  }

  /*
   * The path segment after /on-call-calendar/ for each feed kind. "user" for
   * the personal feed (not "personal") because it is what the URL says and
   * what the Nginx location matches.
   */
  public static getKindSegment(kind: OnCallCalendarFeedKind): string {
    switch (kind) {
      case OnCallCalendarFeedKind.Personal:
        return "user";
      case OnCallCalendarFeedKind.Schedule:
        return "schedule";
      case OnCallCalendarFeedKind.Project:
        return "project";
      default:
        return "user";
    }
  }

  public static getFileName(kind: OnCallCalendarFeedKind): string {
    switch (kind) {
      case OnCallCalendarFeedKind.Personal:
        return PERSONAL_FEED_FILE_NAME;
      case OnCallCalendarFeedKind.Schedule:
        return SCHEDULE_FEED_FILE_NAME;
      case OnCallCalendarFeedKind.Project:
        return PROJECT_FEED_FILE_NAME;
      default:
        return PERSONAL_FEED_FILE_NAME;
    }
  }

  public static buildFeedUrls(options: FeedUrlOptions): FeedUrls {
    const protocol: Protocol =
      options.protocol === undefined ? HttpProtocol : options.protocol;
    const host: string = OnCallCalendarFeedUrls.normalizeHost(
      options.host === undefined ? Host : options.host,
    );

    const path: string = OnCallCalendarFeedUrls.getFeedPath(
      options.kind,
      options.token,
    );

    const https: string = `${protocol}${host}${path}`;

    const webcalScheme: string =
      protocol === Protocol.HTTPS ? "webcals://" : "webcal://";

    const webcal: string = `${webcalScheme}${host}${path}`;

    const googleAdd: string = `${GOOGLE_CALENDAR_ADD_BY_URL}${encodeURIComponent(
      https,
    )}`;

    return { https, webcal, googleAdd };
  }

  /*
   * Non-null when the configured HOST cannot be reached from anywhere but
   * this machine: empty (the default on a fresh install) or a loopback name.
   */
  public static getHostWarning(host?: string | undefined): string | null {
    const value: string = OnCallCalendarFeedUrls.normalizeHost(
      host === undefined ? Host : host,
    );

    if (!value) {
      return HOST_WARNING;
    }

    const withoutPort: string = OnCallCalendarFeedUrls.stripPort(value);

    if (LOCAL_HOST_NAMES.includes(withoutPort.toLowerCase())) {
      return HOST_WARNING;
    }

    return null;
  }

  /*
   * Non-null when the instance serves plain http, so the link -- a bearer
   * credential -- would cross the network in the clear.
   */
  public static getProtocolWarning(
    protocol?: Protocol | undefined,
  ): string | null {
    const value: Protocol = protocol === undefined ? HttpProtocol : protocol;

    if (value !== Protocol.HTTPS) {
      return PROTOCOL_WARNING;
    }

    return null;
  }

  /*
   * HOST is documented as a bare host[:port], but installs do put a scheme or
   * a trailing slash in it. Strip both so the URL never reads
   * "https://https://example.com//api/...".
   */
  public static normalizeHost(host: string): string {
    let value: string = (host || "").trim();

    value = value.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");

    while (value.endsWith("/")) {
      value = value.slice(0, -1);
    }

    return value;
  }

  private static stripPort(host: string): string {
    // [::1]:443 -> [::1]
    if (host.startsWith("[")) {
      const closing: number = host.indexOf("]");
      return closing === -1 ? host : host.slice(0, closing + 1);
    }

    // example.com:8443 -> example.com (one colon = host:port, not IPv6)
    if (host.split(":").length === 2) {
      return host.split(":")[0] || host;
    }

    return host;
  }
}

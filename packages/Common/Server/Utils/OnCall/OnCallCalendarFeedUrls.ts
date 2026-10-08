import { Host, HttpProtocol } from "../../EnvironmentConfig";
import { AppApiRoute } from "../../../ServiceRoute";
import Protocol from "../../../Types/API/Protocol";
import CalendarSubscriptionLinks, {
  CalendarSubscriptionLinkSet,
  GOOGLE_CALENDAR_SUBSCRIBE_URL_PREFIX,
} from "../../../Types/Calendar/CalendarSubscriptionLinks";
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
 *   webcal    the same URL under the webcal:// scheme - always webcal://,
 *             never webcals://, which iOS refuses to open. Apple Calendar on
 *             macOS and iOS opens it straight into a "Subscribe" sheet and
 *             Outlook for Windows into its own; both fetch it over https when
 *             the server serves https. Windows without Outlook has no handler
 *             for it, which the docs explain.
 *   googleAdd Google Calendar's add-by-URL deep link, with the webcal:// form
 *             of the URL encoded into its `cid` parameter. Given the https://
 *             form there, Google answers "Unable to add calendar. Check the
 *             URL." (CalendarSubscriptionLinks explains both rules.)
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
  GOOGLE_CALENDAR_SUBSCRIBE_URL_PREFIX;

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

/*
 * Name suffixes that only resolve inside a private network: the special-use
 * names of RFC 6761 / RFC 2606 (.test, .example, .invalid, .localhost),
 * mDNS's .local, RFC 8375's .home.arpa, the .internal that ICANN reserved for
 * private use in 2024, and the suffixes intranets have long used without
 * them (.lan, .home, .corp, .intranet, .private, .localdomain).
 */
const PRIVATE_NAME_SUFFIXES: Array<string> = [
  ".local",
  ".localdomain",
  ".localhost",
  ".internal",
  ".intranet",
  ".lan",
  ".home",
  ".home.arpa",
  ".corp",
  ".private",
  ".test",
  ".example",
  ".invalid",
];

const IPV4_LITERAL_PATTERN: RegExp =
  /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/*
 * fc00::/7 (unique local) and fe80::/10 (link local). The first group has to
 * be written with all four digits to fall in either range: "fc::1" is
 * 00fc::1, a public address.
 */
const PRIVATE_IPV6_PREFIX_PATTERN: RegExp =
  /^(f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):/;

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

    const links: CalendarSubscriptionLinkSet = CalendarSubscriptionLinks.build(
      `${protocol}${host}${path}`,
    );

    return {
      https: links.https,
      webcal: links.webcal,
      googleAdd: links.googleAdd,
    };
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
   * The configured host, without its port, when it is a PRIVATE address:
   * one that only machines on the same network can reach. Null for a public
   * address, and for the empty and loopback values getHostWarning already
   * warns about.
   *
   * Calendar apps that fetch a subscription from their own servers - Google
   * Calendar, Outlook on the web - can never reach a link on such a host,
   * however it is pasted; apps on a computer inside the network (Apple
   * Calendar, Outlook for Windows, Thunderbird) can. The settings page names
   * the host and says so next to the link, so nobody waits a day for a
   * Google Calendar that cannot fill.
   *
   * Private means: an RFC 1918, shared (100.64/10) or link-local IPv4
   * address; a unique-local or link-local IPv6 address; a name with no dot
   * (a container or service name such as "ingress" or "oneuptime"); or a
   * name under one of PRIVATE_NAME_SUFFIXES.
   */
  public static getPrivateHost(host?: string | undefined): string | null {
    const value: string = OnCallCalendarFeedUrls.normalizeHost(
      host === undefined ? Host : host,
    );

    if (!value || OnCallCalendarFeedUrls.getHostWarning(value)) {
      return null;
    }

    const withoutPort: string = OnCallCalendarFeedUrls.stripPort(value);
    const name: string = withoutPort.toLowerCase();

    if (name.startsWith("[")) {
      const address: string = name.slice(
        1,
        name.endsWith("]") ? -1 : undefined,
      );

      return PRIVATE_IPV6_PREFIX_PATTERN.test(address) ? withoutPort : null;
    }

    const ipv4: RegExpMatchArray | null = name.match(IPV4_LITERAL_PATTERN);

    if (ipv4) {
      const first: number = Number(ipv4[1]);
      const second: number = Number(ipv4[2]);

      const isPrivate: boolean =
        first === 10 ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168) ||
        (first === 100 && second >= 64 && second <= 127) ||
        (first === 169 && second === 254) ||
        first === 127 ||
        first === 0;

      return isPrivate ? withoutPort : null;
    }

    const bareName: string = name.endsWith(".") ? name.slice(0, -1) : name;

    if (!bareName.includes(".")) {
      return withoutPort;
    }

    for (const suffix of PRIVATE_NAME_SUFFIXES) {
      if (bareName.endsWith(suffix)) {
        return withoutPort;
      }
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

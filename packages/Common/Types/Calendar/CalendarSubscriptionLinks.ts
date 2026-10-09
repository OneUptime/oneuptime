/*
 * The links a calendar app subscribes to an iCalendar feed with, all built
 * from the feed's own address (the `https://` URL the server serves it on).
 *
 *   https     the address itself. Google Calendar's "From URL", Outlook's
 *             "Subscribe from web", Thunderbird and every other app that asks
 *             for a calendar address take it as it is.
 *   webcal    the same address under the webcal:// scheme, which the operating
 *             system hands to the calendar app registered for subscriptions:
 *             Apple Calendar on a Mac, iPhone or iPad, Outlook on Windows.
 *   googleAdd Google Calendar's add-by-URL link: Google Calendar opens with an
 *             "Add calendar" prompt for the address in its `cid` parameter.
 *
 * Two rules here are the difference between a link that works and one that
 * shows an error, and both were broken once:
 *
 * - Google's `cid` takes the address in its webcal:// form. Given an
 *   `https://` address, Google Calendar opens and then fails with "Unable to
 *   add calendar. Check the URL." - while the very same `https://` address
 *   pasted into "Other calendars > From URL" works. Google fetches a webcal://
 *   address over https.
 *
 * - The scheme is always `webcal://`, never `webcals://`. webcals is not a
 *   scheme the platforms register: iOS Safari answers a webcals:// link with
 *   "Safari cannot open the page because the address is invalid", and Google
 *   does not take it either. Apple Calendar and Google fetch a webcal://
 *   address over https when the server offers it.
 *
 * The address is rewritten as a string, never through `URL.protocol`: the
 * WHATWG URL setter silently refuses to move a URL from a special scheme
 * (http, https) to a non-special one (webcal), so `url.protocol = "webcal:"`
 * leaves `https://` in place and produces exactly the link Google rejects.
 *
 * Pure and dependency-free, so the server's URL builder, the Dashboard and the
 * tests all build the same links from one place.
 */

export const GOOGLE_CALENDAR_SUBSCRIBE_URL_PREFIX: string =
  "https://calendar.google.com/calendar/r?cid=";

export const WEBCAL_SCHEME: string = "webcal://";

/* http://, https://, webcal:// or webcals://, in any letter case. */
const FEED_SCHEME_PATTERN: RegExp = /^(?:https?|webcals?):\/\//i;

export interface CalendarSubscriptionLinkSet {
  /* The feed address as the server serves it (http:// on a plain-http install). */
  https: string;
  webcal: string;
  googleAdd: string;
}

export default class CalendarSubscriptionLinks {
  /*
   * The webcal:// form of a feed address. Path, query string and fragment are
   * kept exactly as they are. Anything that is not an http(s) or webcal(s)
   * address is returned unchanged rather than guessed at.
   */
  public static toWebcalUrl(feedUrl: string): string {
    const value: string = (feedUrl || "").trim();

    if (!FEED_SCHEME_PATTERN.test(value)) {
      return value;
    }

    return value.replace(FEED_SCHEME_PATTERN, WEBCAL_SCHEME);
  }

  /*
   * Google Calendar's add-by-URL link for a feed: the webcal:// form of the
   * address, percent-encoded whole into `cid`, so a query string on the feed
   * (`?schedule=<id>`) stays part of the address instead of becoming a
   * parameter of Google's own URL.
   */
  public static buildGoogleCalendarUrl(feedUrl: string): string {
    return `${GOOGLE_CALENDAR_SUBSCRIBE_URL_PREFIX}${encodeURIComponent(
      CalendarSubscriptionLinks.toWebcalUrl(feedUrl),
    )}`;
  }

  /*
   * The address that a Google Calendar link subscribes to, or null when the
   * link is not one this module builds. The reverse of buildGoogleCalendarUrl,
   * for tests and for anything that has to tell a good link from a bad one.
   */
  public static readGoogleCalendarAddress(googleUrl: string): string | null {
    if (!googleUrl.startsWith(GOOGLE_CALENDAR_SUBSCRIBE_URL_PREFIX)) {
      return null;
    }

    const encoded: string = googleUrl.slice(
      GOOGLE_CALENDAR_SUBSCRIBE_URL_PREFIX.length,
    );

    if (!encoded || encoded.includes("&") || encoded.includes("#")) {
      return null;
    }

    try {
      return decodeURIComponent(encoded);
    } catch {
      return null;
    }
  }

  public static build(feedUrl: string): CalendarSubscriptionLinkSet {
    const https: string = (feedUrl || "").trim();

    return {
      https,
      webcal: CalendarSubscriptionLinks.toWebcalUrl(https),
      googleAdd: CalendarSubscriptionLinks.buildGoogleCalendarUrl(https),
    };
  }
}

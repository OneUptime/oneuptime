import type { OnCallCalendarFeedStatus } from "../api/types";
import { formatDuration } from "../utils/duration";

/*
 * Turning the server's idea of a feed URL into one this handset can use.
 *
 * The server builds its links from its own HOST setting. On a lot of
 * self-hosted installs that is not the address the phone reaches it on - a
 * VPN name, a split-DNS name, or nothing at all (HOST left empty, in which
 * case the server's links point at localhost). The app already knows an
 * address that works: the one it is signed in through. So the link shown on
 * the phone is rebuilt from that address plus the server-built path, and the
 * server's address is kept alongside for the case where the two differ.
 *
 * No `URL` here: React Native's URL polyfill throws on `pathname`, so the
 * parsing is a regex, and it only has to understand the URLs the server
 * builds (scheme, host, path, optional query).
 */

const ABSOLUTE_URL_PATTERN: RegExp =
  /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)((?:\/[^?#]*)?(?:\?[^#]*)?)/i;

const TRAILING_SLASHES_PATTERN: RegExp = /\/+$/;

const HTTPS_SCHEME_PATTERN: RegExp = /^https:\/\//i;

export interface ParsedFeedUrl {
  scheme: string;
  host: string;

  /* Path plus query string, always starting with "/"; "/" when absent. */
  pathAndQuery: string;
}

export function parseAbsoluteUrl(url: string): ParsedFeedUrl | null {
  const match: RegExpMatchArray | null = url.trim().match(ABSOLUTE_URL_PATTERN);

  if (!match) {
    return null;
  }

  const scheme: string = (match[1] ?? "").toLowerCase();
  const host: string = match[2] ?? "";
  const pathAndQuery: string = match[3] || "/";

  if (!scheme || !host) {
    return null;
  }

  return { scheme, host, pathAndQuery };
}

export interface FeedLinks {
  /* The https link built for THIS device's server address. */
  https: string;

  /* The same link on the webcal(s) scheme, for Apple Calendar and Outlook. */
  webcal: string;

  /* Google Calendar's "add by URL" deep link; browser only. */
  googleAdd: string;

  /* The https link exactly as the server built it. */
  serverHttps: string;

  /* True when the device-built link points at a different host. */
  differsFromServer: boolean;

  /* The host the server put in its own link, for the "differs" note. */
  serverHost: string | null;
}

export function toWebcalUrl(httpsUrl: string): string {
  const scheme: string = HTTPS_SCHEME_PATTERN.test(httpsUrl)
    ? "webcals"
    : "webcal";

  return httpsUrl.replace(/^https?:\/\//i, `${scheme}://`);
}

export function toGoogleAddUrl(httpsUrl: string): string {
  return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(
    httpsUrl,
  )}`;
}

/**
 * The links to show for a feed, rebuilt around `serverUrl` (the address the
 * app is signed in through). Null when the feed has no links - not generated
 * yet, or the server could not decrypt the token.
 *
 * When the server's own link cannot be parsed the server's links are returned
 * untouched: a link the phone cannot reinterpret is still a link.
 */
export function buildFeedLinks(
  serverUrl: string,
  status: Pick<OnCallCalendarFeedStatus, "urls">,
): FeedLinks | null {
  if (!status.urls) {
    return null;
  }

  const serverHttps: string = status.urls.https;
  const parsedServerLink: ParsedFeedUrl | null = parseAbsoluteUrl(serverHttps);
  const parsedAppServer: ParsedFeedUrl | null = parseAbsoluteUrl(serverUrl);

  if (!parsedServerLink || !parsedAppServer) {
    return {
      https: serverHttps,
      webcal: status.urls.webcal || toWebcalUrl(serverHttps),
      googleAdd: status.urls.googleAdd || toGoogleAddUrl(serverHttps),
      serverHttps,
      differsFromServer: false,
      serverHost: parsedServerLink?.host ?? null,
    };
  }

  const appOrigin: string = `${parsedAppServer.scheme}://${parsedAppServer.host}`;

  /*
   * The app's stored URL may carry a base path (a server mounted under
   * /oneuptime); the server's link already includes any such prefix, so only
   * the origin is taken from the app side.
   */
  const https: string = `${appOrigin}${parsedServerLink.pathAndQuery}`.replace(
    TRAILING_SLASHES_PATTERN,
    "",
  );

  const differsFromServer: boolean =
    parsedAppServer.host.toLowerCase() !== parsedServerLink.host.toLowerCase();

  return {
    https,
    webcal: toWebcalUrl(https),
    googleAdd: toGoogleAddUrl(https),
    serverHttps,
    differsFromServer,
    serverHost: parsedServerLink.host,
  };
}

/**
 * The one-line status under the link: when it was last fetched and by what,
 * how many times, and the tail of the token so the user can match it against
 * what their calendar app shows. "Not fetched yet" is said outright - a blank
 * here is indistinguishable from a link that works.
 */
export function describeFetchStatus(
  status: Pick<
    OnCallCalendarFeedStatus,
    "lastFetchedAt" | "lastFetchedClient" | "fetchCount" | "tokenHint"
  >,
  now: number,
): string {
  const parts: Array<string> = [];

  const lastFetched: number = status.lastFetchedAt
    ? new Date(status.lastFetchedAt).getTime()
    : Number.NaN;

  if (Number.isFinite(lastFetched)) {
    const age: number = now - lastFetched;
    const when: string =
      age < 60 * 1000 ? "just now" : `${formatDuration(age)} ago`;

    parts.push(
      status.lastFetchedClient
        ? `Last fetched ${when} by ${status.lastFetchedClient}`
        : `Last fetched ${when}`,
    );
  } else {
    parts.push("Not fetched yet");
  }

  if (status.fetchCount > 0) {
    parts.push(
      status.fetchCount === 1 ? "1 fetch" : `${status.fetchCount} fetches`,
    );
  }

  if (status.tokenHint) {
    parts.push(`link ending in …${status.tokenHint}`);
  }

  return parts.join(" · ");
}

const UNREACHABLE_HINT_AFTER_MILLISECONDS: number = 48 * 60 * 60 * 1000;

/**
 * True when a link has existed for two days and nothing has ever fetched it.
 * On a self-hosted install that almost always means the server is not
 * reachable from wherever the calendar app polls from, which is worth saying
 * before the user concludes the feature is broken.
 */
export function looksUnreachable(
  status: Pick<
    OnCallCalendarFeedStatus,
    "exists" | "fetchCount" | "rotatedAt" | "lastFetchedAt"
  >,
  now: number,
): boolean {
  if (!status.exists || status.fetchCount > 0 || status.lastFetchedAt) {
    return false;
  }

  const rotatedAt: number = status.rotatedAt
    ? new Date(status.rotatedAt).getTime()
    : Number.NaN;

  if (!Number.isFinite(rotatedAt)) {
    return false;
  }

  return now - rotatedAt >= UNREACHABLE_HINT_AFTER_MILLISECONDS;
}

/*
 * Copy that is shown verbatim on the feed screen. It lives here rather than
 * inline in the JSX so the platform-specific sentences can be asserted on and
 * so the docs and the app say the same thing.
 */
export const REFRESH_CADENCE_COPY: string =
  "Calendar apps refresh on their own schedule: Apple Calendar about hourly, Outlook every few hours, Google Calendar up to a day later. Same-day changes reach you through this app and your pager notifications, not through the calendar.";

export const IOS_SUBSCRIBE_HINT: string =
  "For reliable refresh, subscribe on a Mac and choose iCloud. A subscription made only on this iPhone refreshes when iOS decides to.";

export const ANDROID_SUBSCRIBE_HINT: string =
  "Add this link on a computer: Google Calendar → Other calendars → From URL. It then syncs to this phone.";

export const REGENERATE_WARNING_COPY: string =
  "Every calendar app subscribed with the current link stops receiving updates. The old link shows an empty calendar for 30 days, then stops working.";

export const PLANNING_ONLY_COPY: string =
  "This calendar is for planning ahead. The shift list above and your pager notifications are the source of truth for today.";

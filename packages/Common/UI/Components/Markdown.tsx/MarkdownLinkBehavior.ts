import Route from "../../../Types/API/Route";
import {
  AccountsRoute,
  AdminDashboardRoute,
  AppApiRoute,
  DashboardRoute,
  FileRoute,
  PublicDashboardApiRoute,
  PublicDashboardRoute,
  StatusPageApiRoute,
  StatusPageRoute,
} from "../../../ServiceRoute";

/*
 * WHERE A LINK IN RENDERED MARKDOWN OPENS.
 *
 * Notes, feeds, descriptions and setup guides are Markdown, and their links
 * were plain <a> elements: a link to another site, or to a file somebody
 * attached, took over the OneUptime tab the reader was working in. A link
 * now stays in the tab only when it goes to another page of the app the
 * reader is in; everything else opens in a tab of its own:
 *
 *   - another site (another origin, whatever the scheme of the page);
 *   - an attachment or another file the API serves (/api, /file,
 *     /status-page-api, /public-dashboard-api), which is no page to come back
 *     from;
 *   - another part of OneUptime on the same host - the docs from the
 *     Dashboard, a public status page from the Dashboard, the Dashboard from
 *     a status page - when the page is under one of the apps' own routes.
 *
 * A link into the same app - an incident a feed entry names, a relative
 * path, a "#section" of the page - stays in the tab, as it always did. So do
 * mailto:, tel: and the other schemes a browser hands to another program: a
 * tab of their own would stay empty.
 *
 * A link that stays in the tab and goes to another page of the same app
 * opens inside the app (inAppPath), as the app's own links do, rather than
 * loading the whole app again: in the Dashboard, a page of the same project
 * (another project is loaded in full, as switching projects is, so nothing
 * of the first one is left behind); on a status page or a public
 * dashboard, a page of the same one; in the Admin Dashboard and Accounts,
 * any of their pages. A "#section" of the page it is on is left to the
 * browser, which scrolls to it.
 *
 * A status page on a custom domain is served at the domain's root, under no
 * app route, so there every page of the domain is the status page's own,
 * apart from the files.
 *
 * Pure, so it can be tested without a browser: the page's own address is
 * passed in.
 */

export interface MarkdownLinkBehavior {
  // Opened in a tab of its own, cut loose from this page.
  opensInNewTab: boolean;
  /*
   * A route of the App's API - an attachment - opened from the Dashboard or
   * the Admin Dashboard, which sign it in with the session cookie. The
   * cookie lapses with the access token, so the tab is pointed at it only
   * once the session is refreshed (handleAuthenticatedLinkClick), as the
   * attachment chips on the Notes pages do.
   */
  needsSignedInSession: boolean;
  // The address, made absolute against the page; null when it could not be read.
  absoluteUrl: string | null;
  /*
   * For a link to another page of the same app (see the top): its path,
   * query and fragment, to open inside the app without loading it again.
   * Null for everything else - a new tab, a "#section" of this page, a page
   * the app must load in full.
   */
  inAppPath: string | null;
}

const STAYS_IN_TAB: MarkdownLinkBehavior = {
  opensInNewTab: false,
  needsSignedInSession: false,
  absoluteUrl: null,
  inAppPath: null,
};

// The first segment of a route ("/dashboard" -> "dashboard").
const firstSegmentOf: (path: string) => string = (path: string): string => {
  return path.split("/")[1] || "";
};

const segmentOf: (route: Route) => string = (route: Route): string => {
  return firstSegmentOf(route.toString());
};

// The apps a page can be in, each under a route of its own.
const APP_SEGMENTS: ReadonlySet<string> = new Set<string>([
  segmentOf(DashboardRoute),
  segmentOf(AdminDashboardRoute),
  segmentOf(AccountsRoute),
  segmentOf(StatusPageRoute),
  segmentOf(PublicDashboardRoute),
]);

// Routes that serve files and data, never a page to come back from.
const FILE_SEGMENTS: ReadonlySet<string> = new Set<string>([
  segmentOf(AppApiRoute),
  segmentOf(FileRoute),
  segmentOf(StatusPageApiRoute),
  segmentOf(PublicDashboardApiRoute),
]);

// The apps whose session the App's API reads (BaseAPI's own).
const SIGNED_IN_APP_SEGMENTS: ReadonlySet<string> = new Set<string>([
  segmentOf(DashboardRoute),
  segmentOf(AdminDashboardRoute),
]);

const APP_API_SEGMENT: string = segmentOf(AppApiRoute);

/*
 * The apps whose second segment says what a page belongs to - the project
 * (/dashboard/<project>/...), the status page, the public dashboard - so a
 * link opens inside the app only within the same one.
 */
const SCOPED_APP_SEGMENTS: ReadonlySet<string> = new Set<string>([
  segmentOf(DashboardRoute),
  segmentOf(StatusPageRoute),
  segmentOf(PublicDashboardRoute),
]);

/*
 * What a page of an app belongs to: "/dashboard/<project>", "/admin", or ""
 * for a status page on a domain of its own, which is the whole domain. In
 * lower case: an id is the same id in any case.
 */
const scopeOf: (pathname: string) => string = (pathname: string): string => {
  const segments: Array<string> = pathname.split("/");
  const app: string = segments[1] || "";

  if (!APP_SEGMENTS.has(app)) {
    return "";
  }

  const scope: string = SCOPED_APP_SEGMENTS.has(app)
    ? "/" + app + "/" + (segments[2] || "")
    : "/" + app;

  return scope.toLowerCase();
};

const WEB_PROTOCOLS: ReadonlySet<string> = new Set<string>(["http:", "https:"]);

const readUrl: (address: string, base?: string) => URL | null = (
  address: string,
  base?: string,
): URL | null => {
  try {
    return base === undefined ? new URL(address) : new URL(address, base);
  } catch {
    return null;
  }
};

/*
 * Where a link opens. `href` is the address as the Markdown wrote it (after
 * the viewer's URL check), `pageUrl` the address of the page it is shown on
 * (window.location.href), or "" where there is none (a server render).
 */
export const getMarkdownLinkBehavior: (
  href: string | null | undefined,
  pageUrl: string,
) => MarkdownLinkBehavior = (
  href: string | null | undefined,
  pageUrl: string,
): MarkdownLinkBehavior => {
  if (typeof href !== "string" || href.trim() === "") {
    return STAYS_IN_TAB;
  }

  const page: URL | null = readUrl(pageUrl);
  const link: URL | null = page ? readUrl(href, page.href) : readUrl(href);

  /*
   * Unreadable - or relative with no page to read it against: the browser
   * reads it against the page it is on, so it is a page of this app.
   */
  if (!link) {
    return STAYS_IN_TAB;
  }

  // mailto:, tel:, xmpp: and the like are handed to another program.
  if (!WEB_PROTOCOLS.has(link.protocol)) {
    return STAYS_IN_TAB;
  }

  const newTab: MarkdownLinkBehavior = {
    opensInNewTab: true,
    needsSignedInSession: false,
    absoluteUrl: link.href,
    inAppPath: null,
  };

  if (!page || link.origin !== page.origin) {
    return newTab;
  }

  const linkSegment: string = firstSegmentOf(link.pathname);
  const pageSegment: string = firstSegmentOf(page.pathname);

  if (FILE_SEGMENTS.has(linkSegment)) {
    return {
      ...newTab,
      needsSignedInSession:
        linkSegment === APP_API_SEGMENT &&
        SIGNED_IN_APP_SEGMENTS.has(pageSegment),
    };
  }

  // Another part of OneUptime on the same host.
  if (APP_SEGMENTS.has(pageSegment) && linkSegment !== pageSegment) {
    return newTab;
  }

  const isThisPage: boolean =
    link.pathname === page.pathname && link.search === page.search;
  const isSameScope: boolean =
    scopeOf(link.pathname) === scopeOf(page.pathname);

  return {
    ...STAYS_IN_TAB,
    absoluteUrl: link.href,
    inAppPath:
      !isThisPage && isSameScope
        ? link.pathname + link.search + link.hash
        : null,
  };
};

/*
 * The address of the page the viewer is drawn on, or "" where there is no
 * window (a server render, where every relative link stays in the tab).
 */
export const getCurrentPageUrl: () => string = (): string => {
  try {
    return typeof window === "undefined" ? "" : window.location.href;
  } catch {
    return "";
  }
};

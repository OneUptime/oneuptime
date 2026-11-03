/*
 * A PUSH ABOUT SOMETHING THIS APP HAS NO SCREEN FOR.
 *
 * Most pushes are about something the app shows - an incident, an alert, an
 * episode, a security case, a monitor - and a tap opens it there. A few are
 * about something it has no screen for: a scheduled hunt that found security
 * events (SecurityHuntNotifications), and scheduled maintenance. Their push
 * names the record's page in the dashboard (`data.url`), as their email and
 * web push do, and a tap opens that page in the browser - it used to open the
 * app wherever it was last, which read as the push having been for nothing.
 *
 * Only a page of the OneUptime this app is signed in to opens: the same
 * origin, compared as parsed URLs, never as text, and a path inside its
 * dashboard. Anything else a push carries opens nothing, so a push that did
 * not come from that server cannot send the reader to some other site.
 */

// The entity types whose push opens the record's dashboard page.
export const BROWSER_ENTITY_TYPES: ReadonlyArray<string> = [
  "security-hunt",
  "scheduled-maintenance",
];

export function opensInBrowser(entityType: string | undefined): boolean {
  return Boolean(entityType) && BROWSER_ENTITY_TYPES.includes(entityType!);
}

function parseWebUrl(value: string): URL | null {
  try {
    const url: URL = new URL(value);

    // React Native's URL accepts any text; a page has an http(s) scheme and a host.
    if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.host) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

function pathSegments(url: URL): Array<string> {
  return url.pathname.split("/").filter((segment: string): boolean => {
    return segment.length > 0;
  });
}

/**
 * The page to open for a push's `url`: the link itself when it is a page in
 * the dashboard of the OneUptime at `serverUrl` (one served under a path of
 * its own included), else null.
 */
export function getDashboardPageOnServer(
  href: unknown,
  serverUrl: string | null | undefined,
): string | null {
  if (typeof href !== "string" || !href || !serverUrl) {
    return null;
  }

  const link: URL | null = parseWebUrl(href);
  const server: URL | null = parseWebUrl(serverUrl);

  /*
   * Origins compared whatever their case: React Native's URL keeps a host as
   * it was written, and a server address typed with capitals is the same
   * server.
   */
  if (
    !link ||
    !server ||
    link.origin.toLowerCase() !== server.origin.toLowerCase()
  ) {
    return null;
  }

  const serverSegments: Array<string> = pathSegments(server);
  const segments: Array<string> = pathSegments(link);

  for (const [index, segment] of serverSegments.entries()) {
    if (segments[index] !== segment) {
      return null;
    }
  }

  // A page of the dashboard: /dashboard/<project id>/...
  const [dashboard, projectId] = segments.slice(serverSegments.length);

  if (dashboard !== "dashboard" || !projectId) {
    return null;
  }

  return href;
}

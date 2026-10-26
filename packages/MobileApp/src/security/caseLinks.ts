/*
 * A LINK TO A SECURITY CASE IN THE DASHBOARD, opened in the app instead.
 *
 * Wherever OneUptime writes about a case it links to it in the dashboard:
 * `<your OneUptime>/dashboard/<project id>/security-events/cases/<case id>`
 * (SecurityCaseService.getCaseLinkInDashboard), and to one of the case's own
 * pages after that (`.../cases/<case id>/timeline`). The alert a playbook's
 * Page On-Call step opens names its case that way, and so does an incident
 * declared from a case. On a phone that link would open a browser and a
 * sign-in page; the app has the case, so it opens it there.
 *
 * Only a link to the OneUptime this app is signed in to counts - the same
 * origin, compared as parsed URLs, never as text - and only one whose project
 * and case are real ids. Anything else stays a link for the browser.
 */

export interface SecurityCaseLink {
  projectId: string;
  caseId: string;
}

const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): boolean {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function parseUrl(value: string): URL | null {
  try {
    const url: URL = new URL(value);

    // React Native's URL accepts any text; a link has a scheme and a host.
    return url.protocol && url.origin ? url : null;
  } catch {
    return null;
  }
}

function pathSegments(url: URL): Array<string> {
  return url.pathname.split("/").filter((segment: string): boolean => {
    return segment.length > 0;
  });
}

// The case a run of path segments names, read from where the dashboard's path starts.
function readCaseSegments(
  segments: ReadonlyArray<string>,
): SecurityCaseLink | null {
  const [dashboard, projectId, product, cases, caseId] = segments;

  if (
    dashboard !== "dashboard" ||
    product !== "security-events" ||
    cases !== "cases" ||
    !isUuid(projectId) ||
    !isUuid(caseId)
  ) {
    return null;
  }

  return { projectId: projectId!, caseId: caseId! };
}

function isWebLink(url: URL): boolean {
  return url.protocol === "https:" || url.protocol === "http:";
}

/*
 * Whether a link has the shape of a dashboard case link at all, whatever
 * server it is on: the cheap question asked before reading the app's server
 * address, so every other link opens at once.
 */
export function looksLikeSecurityCaseLink(
  href: string | null | undefined,
): boolean {
  const link: URL | null = href ? parseUrl(href) : null;

  if (!link || !isWebLink(link)) {
    return false;
  }

  const segments: Array<string> = pathSegments(link);

  return segments.some((_segment: string, index: number): boolean => {
    return readCaseSegments(segments.slice(index)) !== null;
  });
}

export function parseSecurityCaseLink(
  href: string | null | undefined,
  serverUrl: string | null | undefined,
): SecurityCaseLink | null {
  if (!href || !serverUrl) {
    return null;
  }

  const link: URL | null = parseUrl(href);
  const server: URL | null = parseUrl(serverUrl);

  /*
   * Origins compared whatever their case: React Native's URL keeps a host as
   * it was written, and a server address typed with capitals is the same
   * server.
   */
  if (
    !link ||
    !server ||
    !isWebLink(link) ||
    link.origin.toLowerCase() !== server.origin.toLowerCase()
  ) {
    return null;
  }

  // The server's own path, for a OneUptime served under one (https://example.com/oneuptime).
  const serverSegments: Array<string> = pathSegments(server);
  const segments: Array<string> = pathSegments(link);

  for (const [index, segment] of serverSegments.entries()) {
    if (segments[index] !== segment) {
      return null;
    }
  }

  return readCaseSegments(segments.slice(serverSegments.length));
}

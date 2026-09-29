import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Navigations to authenticated routes refresh the session first.
 *
 * The access cookie expires with the 15-minute access token. Requests made
 * through the API class survive that: a 401 refreshes the session and the
 * request is replayed. A navigation cannot be replayed, so on a page left open
 * past the token's lifetime these opened a bare 401 page although the refresh
 * token was still good:
 *
 *   - attachment links on incident, alert and maintenance notes;
 *   - the profile page's "Download pprof" link;
 *   - "Connect with GitHub App", a full-page navigation to the install route;
 *   - attachment links on a private status page.
 *
 * The behaviour of the shared link helper is tested in
 * Common/Tests/UI/Components/OpenAuthenticatedUrl.test.ts and
 * EventAttachmentList.test.tsx. These pages need a project, a router and a
 * model API to render, so what is pinned here is that each one is wired to
 * it (or, for the full-page navigation, refreshes before navigating).
 */

const APP_ROOT: string = path.join(__dirname, "../../FeatureSet");

// Comments are stripped so an explanation can never satisfy an assertion.
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function readSource(relativePath: string): string {
  return stripComments(
    fs.readFileSync(path.join(APP_ROOT, relativePath), "utf8"),
  );
}

// The text between two markers, so an assertion can be scoped to one region.
function slice(source: string, fromMarker: string, toMarker: string): string {
  const start: number = source.indexOf(fromMarker);

  expect(start).toBeGreaterThan(-1);

  const end: number = source.indexOf(toMarker, start);

  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

const HELPER_IMPORT: RegExp =
  /import \{ handleAuthenticatedLinkClick \} from "Common\/UI\/Utils\/OpenAuthenticatedUrl";/;

describe("dashboard links to authenticated routes", () => {
  test("note attachments keep their href and open through the refreshing helper", () => {
    const source: string = readSource(
      "Dashboard/src/Components/Attachment/AttachmentList.tsx",
    );
    const anchor: string = slice(source, "<a\n", ">\n");

    expect(source).toMatch(HELPER_IMPORT);
    expect(anchor).toContain("href={attachmentUrl}");
    expect(anchor).toContain('target="_blank"');
    expect(anchor).toContain(
      "handleAuthenticatedLinkClick(event, attachmentUrl);",
    );
  });

  test("the pprof download keeps its href and opens through the refreshing helper", () => {
    const source: string = readSource(
      "Dashboard/src/Pages/Profiles/View/Index.tsx",
    );
    const anchor: string = slice(source, "href={pprofDownloadUrl}", ">\n");

    expect(source).toMatch(HELPER_IMPORT);
    expect(anchor).toContain('target="_blank"');
    expect(anchor).toContain(
      "handleAuthenticatedLinkClick(event, pprofDownloadUrl);",
    );
  });
});

describe("Connect with GitHub App", () => {
  const source: string = readSource(
    "Dashboard/src/Pages/CodeRepository/CodeRepository.tsx",
  );
  const handler: string = slice(
    source,
    "const handleConnectWithGitHub:",
    "\n    };\n",
  );

  test("refreshes the session before navigating to the install route", () => {
    const refreshIndex: number = handler.indexOf("await API.refreshSession()");
    const navigateIndex: number = handler.indexOf(
      "window.location.href = installUrl",
    );

    expect(source).toContain('import API from "Common/UI/Utils/API/API";');
    expect(refreshIndex).toBeGreaterThan(-1);
    expect(navigateIndex).toBeGreaterThan(refreshIndex);
  });

  test("does not navigate when the refresh did not work", () => {
    /*
     * A refused refresh has already sent the page to the login page;
     * navigating to the install route would cancel that and show its 401.
     * The navigation is reached only past a guard on the refresh's result.
     */
    expect(handler).toMatch(
      /const refreshed: boolean = await API\.refreshSession\(\);/,
    );
    expect(handler).toMatch(
      /if \(!refreshed\) \{\s*return;\s*\}[\s\S]*window\.location\.href = installUrl;/,
    );
  });

  test("ignores a second click while the first is still refreshing", () => {
    expect(handler).toMatch(
      /if \(!projectId \|\| isConnectingToGitHubRef\.current\) \{\s*return;\s*\}\s*isConnectingToGitHubRef\.current = true;/,
    );
  });
});

describe("private status page attachments", () => {
  /*
   * EventItem hands each builder's attachmentRefreshSession to its
   * EventAttachmentList. Every builder that produces an event item for the
   * status page passes one, and only on a private page.
   */
  const builders: Array<[string, number]> = [
    ["StatusPage/src/Pages/Incidents/Detail.tsx", 2],
    ["StatusPage/src/Pages/Announcement/Detail.tsx", 1],
    ["StatusPage/src/Pages/ScheduledEvent/Detail.tsx", 1],
  ];

  test.each(builders)(
    "%s passes the status page's own refresh on private pages only",
    (relativePath: string, builderCount: number) => {
      const source: string = readSource(relativePath);
      const wirings: Array<string> =
        source.match(
          /attachmentRefreshSession: StatusPageUtil\.isPrivateStatusPage\(\)\s*\? \(\): Promise<boolean> => \{\s*return API\.refreshSession\(\);\s*\}\s*: undefined,/g,
        ) ?? [];

      expect(source).toContain('import API from "../../Utils/API";');
      expect(wirings).toHaveLength(builderCount);
      expect(source.match(/isDetailItem: !isSummary,/g) ?? []).toHaveLength(
        builderCount,
      );
    },
  );
});

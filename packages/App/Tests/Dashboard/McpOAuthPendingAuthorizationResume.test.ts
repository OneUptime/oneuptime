/*
 * Picking an MCP authorization back up after a sign-in.
 *
 * Somebody connecting an MCP client who is not signed in is sent to the
 * sign-in page by the consent screen, and every way of signing in ends on the
 * dashboard rather than where the person came from. So the consent screen
 * leaves the request in a cookie, and the dashboard - once its project list
 * has loaded, which is what proves there is a session - sends the browser
 * back to the consent screen with it.
 *
 * Two files carry that, and each can drop it silently:
 *
 *  - Utils/McpAuthorizationResume.ts decides. Its mistakes are a dashboard
 *    that never returns anybody (the client's sign-in dead-ends on the home
 *    page), one that navigates with a router push instead of a full page load
 *    (the consent screen is a different bundle, so the router shows "page not
 *    found"), or one that reads the request without it being forgotten (every
 *    later visit to the dashboard bounces to the consent screen).
 *  - App.tsx calls it. Called before the project list loads, it would bounce
 *    a visitor with no session between the dashboard and the sign-in page;
 *    called without the early return, the dashboard carries on rendering
 *    under a navigation that is already leaving.
 *
 * The decision is run for real here, with the two things it touches - the
 * cookie reader and the navigation - replaced by recorders, since both need a
 * browser. App.tsx cannot be loaded in this plain-node suite, so its half is
 * pinned from the source. The whole round trip, in a real shell with a real
 * cookie, is in Common/Tests/App/Dashboard/McpAuthorizationResume.test.tsx.
 */
jest.mock("Common/UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: jest.fn(),
    },
  };
});

jest.mock("Common/UI/Utils/McpOAuthPendingAuthorization", () => {
  return {
    __esModule: true,
    default: {
      consumeRoute: jest.fn(),
    },
  };
});

import { resumePendingMcpAuthorization } from "../../FeatureSet/Dashboard/src/Utils/McpAuthorizationResume";
import Route from "Common/Types/API/Route";
import McpOAuthPendingAuthorization from "Common/UI/Utils/McpOAuthPendingAuthorization";
import Navigation from "Common/UI/Utils/Navigation";
import { beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

const consumeRouteMock: jest.Mock =
  McpOAuthPendingAuthorization.consumeRoute as unknown as jest.Mock;
const navigateMock: jest.Mock = Navigation.navigate as unknown as jest.Mock;

const TICKET: string = `v1.${"cGF5bG9hZA".repeat(4)}.${"s".repeat(43)}`;
const CONSENT_ROUTE: Route = new Route(
  `/accounts/mcp-authorize?request=${TICKET}`,
);

beforeEach(() => {
  consumeRouteMock.mockReset();
  navigateMock.mockReset();
});

describe("resumePendingMcpAuthorization", () => {
  test("with a request waiting, sends the browser to the consent screen and says so", () => {
    consumeRouteMock.mockReturnValue(CONSENT_ROUTE);

    expect(resumePendingMcpAuthorization()).toBe(true);

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock.mock.calls[0]![0]).toBe(CONSENT_ROUTE);
    expect(String(navigateMock.mock.calls[0]![0])).toBe(
      `/accounts/mcp-authorize?request=${TICKET}`,
    );
  });

  test("navigates with a full page load: the consent screen is not part of the dashboard bundle", () => {
    consumeRouteMock.mockReturnValue(CONSENT_ROUTE);

    resumePendingMcpAuthorization();

    expect(navigateMock.mock.calls[0]![1]).toEqual({ forceNavigate: true });
    // Not a new tab: the person is returning to something they started.
    expect(navigateMock.mock.calls[0]![1]).not.toHaveProperty("openInNewTab");
    expect(navigateMock.mock.calls[0]).toHaveLength(2);
  });

  test("with nothing waiting, navigates nowhere and says so", () => {
    consumeRouteMock.mockReturnValue(null);

    expect(resumePendingMcpAuthorization()).toBe(false);

    expect(navigateMock).not.toHaveBeenCalled();
  });

  test("reads the request exactly once per call, and before navigating", () => {
    /*
     * consumeRoute() forgets what it reads. Reading twice would see nothing
     * the second time; reading after navigating would leave the request in
     * place for the next visit to the dashboard.
     */
    consumeRouteMock.mockReturnValue(CONSENT_ROUTE);

    resumePendingMcpAuthorization();

    expect(consumeRouteMock).toHaveBeenCalledTimes(1);
    expect(consumeRouteMock).toHaveBeenCalledWith();
    expect(consumeRouteMock.mock.invocationCallOrder[0]!).toBeLessThan(
      navigateMock.mock.invocationCallOrder[0]!,
    );
  });

  test("goes where the reader says and nowhere else", () => {
    // The route is the reader's to build; this function adds nothing to it.
    const other: Route = new Route(
      `/accounts/mcp-authorize?request=v1.b3RoZXI.${"t".repeat(43)}`,
    );

    consumeRouteMock.mockReturnValue(other);

    resumePendingMcpAuthorization();

    expect(navigateMock.mock.calls[0]![0]).toBe(other);
  });

  test("a second call after the request was consumed does nothing", () => {
    consumeRouteMock.mockReturnValueOnce(CONSENT_ROUTE).mockReturnValue(null);

    expect(resumePendingMcpAuthorization()).toBe(true);
    expect(resumePendingMcpAuthorization()).toBe(false);

    expect(navigateMock).toHaveBeenCalledTimes(1);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Source-level: where the dashboard shell calls it.
 * ---------------------------------------------------------------------------
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

type ReadCodeFunction = (...segments: Array<string>) => string;

// Comments out, whitespace collapsed: the prose describes what is asserted.
const readCode: ReadCodeFunction = (...segments: Array<string>): string => {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...segments), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ");
};

const appSource: string = readCode("App.tsx");
const resumeSource: string = readCode("Utils", "McpAuthorizationResume.ts");

type CountOccurrencesFunction = (source: string, needle: string) => number;

const countOccurrences: CountOccurrencesFunction = (
  source: string,
  needle: string,
): number => {
  return source.split(needle).length - 1;
};

type FetchProjectsBodyFunction = () => string;

// `const fetchProjects ... = async (): Promise<void> => { ... };`
const fetchProjectsBody: FetchProjectsBodyFunction = (): string => {
  const start: number = appSource.indexOf("const fetchProjects:");

  if (start === -1) {
    throw new Error("App.tsx no longer declares fetchProjects");
  }

  const open: number = appSource.indexOf("=> {", start);
  let depth: number = 0;

  for (let index: number = open + 3; index < appSource.length; index++) {
    if (appSource[index] === "{") {
      depth++;
    }

    if (appSource[index] === "}") {
      depth--;

      if (depth === 0) {
        return appSource.slice(open, index + 1);
      }
    }
  }

  throw new Error("fetchProjects is not terminated");
};

describe("the dashboard shell resumes a pending MCP authorization", () => {
  test("it imports the helper", () => {
    expect(appSource).toMatch(
      /import \{ resumePendingMcpAuthorization \} from "\.\/Utils\/McpAuthorizationResume";/,
    );
  });

  test("it asks exactly once, inside fetchProjects", () => {
    // The import and the one call.
    expect(countOccurrences(appSource, "resumePendingMcpAuthorization")).toBe(
      2,
    );
    expect(
      countOccurrences(fetchProjectsBody(), "resumePendingMcpAuthorization("),
    ).toBe(1);
  });

  test("only after the project list has loaded, and before the failure path", () => {
    /*
     * The list loading is what proves there is a session to return with. A
     * visitor without one gets a 401 from that request and never reaches the
     * call, so the request stays remembered for after they sign in.
     */
    const body: string = fetchProjectsBody();

    const listIndex: number = body.indexOf("await ModelAPI.getList<Project>(");
    const setIndex: number = body.indexOf("setProjects(result.data)");
    const resumeIndex: number = body.indexOf("resumePendingMcpAuthorization()");
    const catchIndex: number = body.indexOf("} catch (err) {");

    expect(listIndex).toBeGreaterThan(-1);
    expect(setIndex).toBeGreaterThan(listIndex);
    expect(resumeIndex).toBeGreaterThan(setIndex);
    expect(catchIndex).toBeGreaterThan(resumeIndex);
  });

  test("it stops there when the browser is being sent away", () => {
    expect(fetchProjectsBody()).toMatch(
      /setProjects\(result\.data\); if \(resumePendingMcpAuthorization\(\)\) \{ return; \} \} catch \(err\) \{/,
    );
  });

  test("the shell leaves the cookie and the navigation to the helper", () => {
    /*
     * One reader of the cookie. A second in the shell would consume the
     * request before the helper saw it.
     */
    expect(appSource).not.toContain("McpOAuthPendingAuthorization");
    expect(appSource).not.toContain("mcp-authorize");
    expect(appSource).not.toMatch(/forceNavigate:\s*true\b/);
  });
});

describe("the helper itself", () => {
  test("reads the request through the one cookie reader, and navigates through Navigation", () => {
    expect(resumeSource).toContain(
      'import McpOAuthPendingAuthorization from "Common/UI/Utils/McpOAuthPendingAuthorization";',
    );
    expect(resumeSource).toContain(
      "McpOAuthPendingAuthorization.consumeRoute()",
    );
    expect(resumeSource).toContain(
      "Navigation.navigate(consentRoute, { forceNavigate: true });",
    );

    // It builds no address of its own and touches no cookie directly.
    expect(resumeSource).not.toContain("window.location");
    expect(resumeSource).not.toContain("document.cookie");
    expect(resumeSource).not.toContain("mcp-authorize");
    expect(countOccurrences(resumeSource, "Navigation.navigate(")).toBe(1);
  });
});

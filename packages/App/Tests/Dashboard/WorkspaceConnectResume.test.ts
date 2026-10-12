/*
 * Picking a Connect link from Slack or Microsoft Teams back up after a
 * sign-in.
 *
 * Somebody whose chat account is not connected presses a button in Slack or
 * Microsoft Teams and is answered with a Connect button. It opens their own
 * settings page with `?connect=`. If that browser is not signed in to
 * OneUptime, the dashboard's first request sends it to the sign-in page, and
 * every sign-in ends on the home page: the link would be lost. So the
 * dashboard remembers the link before that request
 * (rememberWorkspaceConnectLink), and once the project list has loaded -
 * which proves there is a session - sends the browser back to it
 * (resumeWorkspaceConnect).
 *
 * The decision runs for real here, with the cookie reader and the navigation
 * replaced by recorders. App.tsx cannot be loaded in this plain-node suite,
 * so its half is pinned from the source.
 */
jest.mock("Common/UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: jest.fn(),
    },
  };
});

jest.mock("Common/UI/Utils/WorkspaceConnectPendingLink", () => {
  return {
    __esModule: true,
    default: {
      consumeRoute: jest.fn(),
      rememberCurrentPage: jest.fn(),
    },
  };
});

import {
  rememberWorkspaceConnectLink,
  resumeWorkspaceConnect,
} from "../../FeatureSet/Dashboard/src/Utils/WorkspaceConnectResume";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
import WorkspaceConnectPendingLink from "Common/UI/Utils/WorkspaceConnectPendingLink";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

const consumeRouteMock: jest.Mock =
  WorkspaceConnectPendingLink.consumeRoute as unknown as jest.Mock;
const rememberMock: jest.Mock =
  WorkspaceConnectPendingLink.rememberCurrentPage as unknown as jest.Mock;
const navigateMock: jest.Mock = Navigation.navigate as unknown as jest.Mock;

const PROJECT_ID: string = "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e";
const TOKEN: string = "a".repeat(43);
const SLACK_PAGE: string = `/dashboard/${PROJECT_ID}/user-settings/slack-integration`;
const CONNECT_ROUTE: Route = new Route(`${SLACK_PAGE}?connect=${TOKEN}`);

// This suite runs in node: the page the browser is on, as the helper reads it.
const realWindow: unknown = (globalThis as { window?: unknown }).window;

function browserOn(pathname: string): void {
  (globalThis as { window?: unknown }).window = {
    location: { pathname: pathname },
  };
}

beforeEach(() => {
  consumeRouteMock.mockReset();
  rememberMock.mockReset();
  navigateMock.mockReset();
  browserOn(`/dashboard/${PROJECT_ID}/home`);
});

afterEach(() => {
  (globalThis as { window?: unknown }).window = realWindow;
});

describe("resumeWorkspaceConnect", () => {
  test("with a Connect link waiting, sends the browser to it with a full page load, and says so", () => {
    consumeRouteMock.mockReturnValue(CONNECT_ROUTE);

    expect(resumeWorkspaceConnect()).toBe(true);

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock.mock.calls[0]![0]).toBe(CONNECT_ROUTE);
    expect(navigateMock.mock.calls[0]![1]).toEqual({ forceNavigate: true });
  });

  test("a Slack channel note's Connect Slack account link waiting is opened the same way", () => {
    const noteLink: Route = new Route(`${SLACK_PAGE}?connectAccount=true`);
    consumeRouteMock.mockReturnValue(noteLink);

    expect(resumeWorkspaceConnect()).toBe(true);

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock.mock.calls[0]![0]).toBe(noteLink);
    expect(navigateMock.mock.calls[0]![1]).toEqual({ forceNavigate: true });
  });

  test("with nothing waiting, navigates nowhere", () => {
    consumeRouteMock.mockReturnValue(null);

    expect(resumeWorkspaceConnect()).toBe(false);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test("on the Connect page already - signed in all along - the link is forgotten and the page goes on", () => {
    browserOn(SLACK_PAGE);
    consumeRouteMock.mockReturnValue(CONNECT_ROUTE);

    expect(resumeWorkspaceConnect()).toBe(false);
    expect(consumeRouteMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test("reads the link exactly once, before navigating: it is picked up once", () => {
    consumeRouteMock.mockReturnValueOnce(CONNECT_ROUTE).mockReturnValue(null);

    expect(resumeWorkspaceConnect()).toBe(true);
    expect(resumeWorkspaceConnect()).toBe(false);

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(consumeRouteMock.mock.invocationCallOrder[0]!).toBeLessThan(
      navigateMock.mock.invocationCallOrder[0]!,
    );
  });
});

describe("rememberWorkspaceConnectLink", () => {
  test("asks the cookie to remember the page the browser is on", () => {
    rememberWorkspaceConnectLink();

    expect(rememberMock).toHaveBeenCalledTimes(1);
    expect(rememberMock).toHaveBeenCalledWith();
  });
});

/*
 * ---------------------------------------------------------------------------
 * Source-level: where the dashboard shell calls them.
 * ---------------------------------------------------------------------------
 */

// Comments out, whitespace collapsed: the prose describes what is asserted.
function readCode(...segments: Array<string>): string {
  return fs
    .readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "FeatureSet",
        "Dashboard",
        "src",
        ...segments,
      ),
      "utf8",
    )
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ");
}

const appSource: string = readCode("App.tsx");

// `const fetchProjects ... = async (): Promise<void> => { ... };`
function fetchProjectsBody(): string {
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
}

describe("the dashboard shell picks a Connect link back up", () => {
  test("it remembers the link before the first request, which sends a signed-out browser to sign in", () => {
    const body: string = fetchProjectsBody();

    const rememberIndex: number = body.indexOf(
      "rememberWorkspaceConnectLink()",
    );
    const listIndex: number = body.indexOf("await ModelAPI.getList<Project>(");

    expect(rememberIndex).toBeGreaterThan(-1);
    expect(listIndex).toBeGreaterThan(rememberIndex);
  });

  test("it sends the browser back only once the project list has loaded, after an MCP client waiting on its consent screen, and stops there", () => {
    const body: string = fetchProjectsBody();

    const setIndex: number = body.indexOf("setProjects(result.data)");
    const mcpIndex: number = body.indexOf("resumePendingMcpAuthorization()");
    const resumeIndex: number = body.indexOf("resumeWorkspaceConnect()");
    const catchIndex: number = body.indexOf("} catch (err) {");

    expect(setIndex).toBeGreaterThan(-1);
    expect(mcpIndex).toBeGreaterThan(setIndex);
    expect(resumeIndex).toBeGreaterThan(mcpIndex);
    expect(catchIndex).toBeGreaterThan(resumeIndex);
    expect(body).toContain("if (resumeWorkspaceConnect()) { return; }");
  });

  test("each is called once, and the shell leaves the cookie to the helper", () => {
    expect(appSource.split("rememberWorkspaceConnectLink(").length - 1).toBe(1);
    expect(appSource.split("resumeWorkspaceConnect(").length - 1).toBe(1);
    expect(appSource).not.toContain("WorkspaceConnectPendingLink");
  });
});

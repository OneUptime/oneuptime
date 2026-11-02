/*
 * Back to the page a person was on when their session ended, once they
 * have signed in again.
 *
 * A master admin can end sign-ins after a length of time or a while without
 * use (Admin Dashboard > Settings > Session Length), and a person can be
 * signed out somewhere else. The Dashboard and the Admin Dashboard then
 * remember the page (Common/UI/Utils/SessionEndReturn) and send the browser
 * to sign in; every sign-in ends on the Dashboard, which - once its project
 * list has loaded, proving there is a session - takes the page back
 * (takePageAfterSessionEnd) and opens it (resumePageAfterSessionEnd),
 * unless an MCP authorization, a marketplace purchase or a Connect link
 * takes the browser elsewhere first.
 *
 * The decision runs for real here, with the cookie reader and the
 * navigation replaced by recorders. App.tsx cannot be loaded in this
 * plain-node suite, so its half is pinned from the source, as are the two
 * apps' entry points, which start noticing activity for the idle timeout.
 */
jest.mock("Common/UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: jest.fn(),
    },
  };
});

jest.mock("Common/UI/Utils/SessionEndReturn", () => {
  return {
    __esModule: true,
    default: {
      consumeRoute: jest.fn(),
    },
  };
});

jest.mock("Common/UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      getUserId: jest.fn(),
    },
  };
});

import {
  resumePageAfterSessionEnd,
  takePageAfterSessionEnd,
} from "../../FeatureSet/Dashboard/src/Utils/SessionEndResume";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import SessionEndReturn from "Common/UI/Utils/SessionEndReturn";
import UserUtil from "Common/UI/Utils/User";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

const consumeRouteMock: jest.Mock =
  SessionEndReturn.consumeRoute as unknown as jest.Mock;
const navigateMock: jest.Mock = Navigation.navigate as unknown as jest.Mock;
const getUserIdMock: jest.Mock = UserUtil.getUserId as unknown as jest.Mock;

const USER_ID: string = "3c3c3c3c-3c3c-43c3-83c3-3c3c3c3c3c3c";
const PROJECT_ID: string = "4d4d4d4d-4d4d-44d4-84d4-4d4d4d4d4d4d";
const HOME: string = `/dashboard/${PROJECT_ID}/home`;
const INCIDENT_PAGE: string = `/dashboard/${PROJECT_ID}/incidents/view/7?tab=notes#timeline`;

// This suite runs in node: the page the browser is on, as the helper reads it.
const realWindow: unknown = (globalThis as { window?: unknown }).window;

function browserOn(
  pathname: string,
  search: string = "",
  hash: string = "",
): void {
  (globalThis as { window?: unknown }).window = {
    location: { pathname: pathname, search: search, hash: hash },
  };
}

beforeEach(() => {
  consumeRouteMock.mockReset();
  navigateMock.mockReset();
  getUserIdMock.mockReset();
  getUserIdMock.mockReturnValue(new ObjectID(USER_ID));
  browserOn(HOME);
});

afterEach(() => {
  (globalThis as { window?: unknown }).window = realWindow;
});

describe("takePageAfterSessionEnd", () => {
  test("reads the page remembered for the person signed in now", () => {
    const remembered: Route = new Route(INCIDENT_PAGE);
    consumeRouteMock.mockReturnValue(remembered);

    expect(takePageAfterSessionEnd()).toBe(remembered);
    expect(consumeRouteMock).toHaveBeenCalledTimes(1);
    expect(consumeRouteMock).toHaveBeenCalledWith(USER_ID);
  });

  test("nothing remembered, or remembered for someone else: nothing", () => {
    consumeRouteMock.mockReturnValue(null);

    expect(takePageAfterSessionEnd()).toBeNull();
  });
});

describe("resumePageAfterSessionEnd", () => {
  test("opens the page with a full page load, and says the browser is leaving", () => {
    const remembered: Route = new Route(INCIDENT_PAGE);

    expect(resumePageAfterSessionEnd(remembered)).toBe(true);
    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock.mock.calls[0]![0]).toBe(remembered);
    expect(navigateMock.mock.calls[0]![1]).toEqual({ forceNavigate: true });
  });

  test("an Admin Dashboard page is opened the same way: it belongs to another bundle", () => {
    const adminPage: Route = new Route("/admin/settings/session-length");

    expect(resumePageAfterSessionEnd(adminPage)).toBe(true);
    expect(navigateMock.mock.calls[0]![1]).toEqual({ forceNavigate: true });
  });

  test("nothing to open: the page goes on", () => {
    expect(resumePageAfterSessionEnd(null)).toBe(false);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test("on that very page already, query and fragment included, nothing is opened again", () => {
    browserOn(
      `/dashboard/${PROJECT_ID}/incidents/view/7`,
      "?tab=notes",
      "#timeline",
    );

    expect(resumePageAfterSessionEnd(new Route(INCIDENT_PAGE))).toBe(false);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test("the same page with another query is another page, and is opened", () => {
    browserOn(`/dashboard/${PROJECT_ID}/incidents/view/7`, "?tab=overview");

    expect(resumePageAfterSessionEnd(new Route(INCIDENT_PAGE))).toBe(true);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Source-level: where the dashboard shell and the two apps call them.
 * ---------------------------------------------------------------------------
 */

// Comments out, whitespace collapsed: the prose describes what is asserted.
function readCode(...segments: Array<string>): string {
  return fs
    .readFileSync(
      path.join(__dirname, "..", "..", "FeatureSet", ...segments),
      "utf8",
    )
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ");
}

const appSource: string = readCode("Dashboard", "src", "App.tsx");

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

describe("the dashboard shell brings a person back after their session ended", () => {
  test("the page is taken once the project list has loaded, before anything else a sign-in leads back to, so it is forgotten either way", () => {
    const body: string = fetchProjectsBody();

    const setIndex: number = body.indexOf("setProjects(result.data)");
    const takeIndex: number = body.indexOf("takePageAfterSessionEnd()");
    const mcpIndex: number = body.indexOf("resumePendingMcpAuthorization()");

    expect(setIndex).toBeGreaterThan(-1);
    expect(takeIndex).toBeGreaterThan(setIndex);
    expect(mcpIndex).toBeGreaterThan(takeIndex);
  });

  test("it is opened last, only when nothing before it took the browser elsewhere, and the shell stops there", () => {
    const body: string = fetchProjectsBody();

    const workspaceIndex: number = body.indexOf("resumeWorkspaceConnect()");
    const resumeIndex: number = body.indexOf(
      "resumePageAfterSessionEnd(pageAfterSessionEnd)",
    );
    const catchIndex: number = body.indexOf("} catch (err) {");

    expect(workspaceIndex).toBeGreaterThan(-1);
    expect(resumeIndex).toBeGreaterThan(workspaceIndex);
    expect(catchIndex).toBeGreaterThan(resumeIndex);
    expect(body).toContain(
      "if (resumePageAfterSessionEnd(pageAfterSessionEnd)) { return; }",
    );
  });

  test("each is called once, and the shell leaves the cookie to the helper", () => {
    expect(appSource.split("takePageAfterSessionEnd(").length - 1).toBe(1);
    expect(appSource.split("resumePageAfterSessionEnd(").length - 1).toBe(1);
    expect(appSource).not.toContain("SessionEndReturn");
  });
});

describe("the Dashboard and the Admin Dashboard notice activity, for the idle timeout", () => {
  test.each([["Dashboard"], ["AdminDashboard"]])(
    "%s starts UserActivity once, as it loads",
    (app: string) => {
      const source: string = readCode(app, "src", "Index.tsx");

      expect(source).toContain(
        'import UserActivity from "Common/UI/Utils/UserActivity";',
      );
      expect(source.split("UserActivity.install()").length - 1).toBe(1);
    },
  );
});

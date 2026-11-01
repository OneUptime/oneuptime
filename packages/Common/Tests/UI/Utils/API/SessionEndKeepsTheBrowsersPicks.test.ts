// Must stay the first import: the client's URLs are built from HOST on load.
import { DASHBOARD_ORIGIN } from "./DashboardHost";
import FakeAxiosServer, { FakeTransport, settle } from "./FakeAxiosServer";
import BaseAPI from "../../../../UI/Utils/API/API";
import { IDENTITY_URL } from "../../../../UI/Config";
import Navigation from "../../../../UI/Utils/Navigation";
import ThemeUtil, { ThemePreference } from "../../../../UI/Utils/Theme";
import UserUtil from "../../../../UI/Utils/User";
import HTTPMethod from "../../../../Types/API/HTTPMethod";
import Route from "../../../../Types/API/Route";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import Sleep from "../../../../Types/Sleep";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import axios from "axios";

jest.mock("axios", () => {
  // Keep the real helpers (axios.isAxiosError, AxiosError) and fake only the call.
  return Object.assign(jest.fn(), jest.requireActual("axios"));
});

/*
 * THE SESSION THAT ENDED ON ITS OWN.
 *
 * Nobody pressed Log out: the session lapsed and its refresh was refused, or
 * the project was deleted, and the client ran User.logout() and went to the
 * sign-in page by itself. Issue #5404 names this as the commoner way to the
 * sign-in page, and it went through the same emptied local storage.
 *
 * Everything here runs through the real client and the real User.logout(),
 * down to where axios would open a socket (FakeAxiosServer), so a test fails
 * if any step on the way takes a pick with it.
 */

const mockedAxios: FakeTransport = axios as unknown as FakeTransport;

const IDENTITY: string = URL.fromString(IDENTITY_URL.toString()).toString();
const REFRESH_URL: string = `${IDENTITY}/refresh-token`;
const LOGOUT_URL: string = `${IDENTITY}/logout`;

const INCIDENTS_URL: string = `${DASHBOARD_ORIGIN}/api/incident/get-list`;

const THE_BROWSERS_OWN: Record<string, string> = {
  "oneuptime-dashboard-theme": "dark",
  oneuptimeLang: "de",
  cookiesAccepted: "false",
};

const THE_PERSONS_OWN: Record<string, string> = {
  user_name: "Ada Lovelace",
  project: '{"name":"Acme"}',
  "session-refreshed-at:dashboard": "0",
};

const whatTheBrowserKeeps: () => Record<string, string> = (): Record<
  string,
  string
> => {
  const kept: Record<string, string> = {};

  for (let index: number = 0; index < localStorage.length; index++) {
    const key: string = localStorage.key(index)!;
    kept[key] = localStorage.getItem(key)!;
  }

  return kept;
};

let server: FakeAxiosServer;
let navigateSpy: jest.SpiedFunction<typeof Navigation.navigate>;
let currentRouteSpy: jest.SpiedFunction<typeof Navigation.getCurrentRoute>;

beforeEach(() => {
  localStorage.clear();

  for (const key of Object.keys(THE_BROWSERS_OWN)) {
    localStorage.setItem(key, THE_BROWSERS_OWN[key]!);
  }

  for (const key of Object.keys(THE_PERSONS_OWN)) {
    localStorage.setItem(key, THE_PERSONS_OWN[key]!);
  }

  server = new FakeAxiosServer(mockedAxios);

  jest.spyOn(Sleep, "sleep").mockImplementation(async (): Promise<void> => {});

  navigateSpy = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {});

  currentRouteSpy = jest
    .spyOn(Navigation, "getCurrentRoute")
    .mockReturnValue(new Route("/dashboard/project/incidents"));
});

afterEach(() => {
  mockedAxios.mockReset();
  jest.restoreAllMocks();
  localStorage.clear();
});

const askForIncidents: () => Promise<void> = async (): Promise<void> => {
  await BaseAPI.post<JSONObject>({
    url: URL.fromString(INCIDENTS_URL),
    data: {},
  });
  await settle();
};

describe("a session that lapsed and could not be refreshed", () => {
  /*
   * Both 401s sign the person out, the refresh's and the request's own, so
   * logging out runs twice here and has to be safe to.
   */
  beforeEach(() => {
    server
      .on(HTTPMethod.POST, INCIDENTS_URL, [{ status: 401, data: {} }])
      .on(HTTPMethod.POST, REFRESH_URL, [{ status: 401, data: {} }])
      .on(HTTPMethod.POST, LOGOUT_URL, [
        { status: 200, data: {} },
        { status: 200, data: {} },
      ]);
  });

  test("leaves the browser's picks, and nothing of the person's", async () => {
    await askForIncidents();

    expect(whatTheBrowserKeeps()).toEqual(THE_BROWSERS_OWN);
  });

  test("the sign-in page it goes to can still read the pick", async () => {
    await askForIncidents();

    const routes: Array<string> = navigateSpy.mock.calls.map(
      (call: Parameters<typeof Navigation.navigate>): string => {
        return call[0].toString();
      },
    );

    expect(new Set(routes)).toEqual(new Set(["/accounts/login"]));
    expect(ThemeUtil.getPreference()).toBe(ThemePreference.Dark);
  });

  test("still tells the server the session is over", async () => {
    await askForIncidents();

    expect(
      server.requestsTo(HTTPMethod.POST, LOGOUT_URL).length,
    ).toBeGreaterThan(0);
  });

  test("leaves the person signed out", async () => {
    await askForIncidents();

    expect(UserUtil.isLoggedIn()).toBe(false);
    expect(localStorage.getItem("user_name")).toBeNull();
  });
});

describe("a project that is gone", () => {
  test("answers 405, which signs the person out and leaves the picks", async () => {
    server
      .on(HTTPMethod.POST, INCIDENTS_URL, [{ status: 405, data: {} }])
      .on(HTTPMethod.POST, LOGOUT_URL, [{ status: 200, data: {} }]);

    await askForIncidents();

    expect(whatTheBrowserKeeps()).toEqual(THE_BROWSERS_OWN);
  });
});

describe("a 401 on the sign-in page itself", () => {
  test("stays on the page, and the page keeps its theme", async () => {
    currentRouteSpy.mockReturnValue(new Route("/accounts/login"));

    server
      .on(HTTPMethod.POST, INCIDENTS_URL, [{ status: 401, data: {} }])
      .on(HTTPMethod.POST, REFRESH_URL, [{ status: 401, data: {} }])
      .on(HTTPMethod.POST, LOGOUT_URL, [
        { status: 200, data: {} },
        { status: 200, data: {} },
      ]);

    await askForIncidents();

    expect(navigateSpy).not.toHaveBeenCalled();
    expect(whatTheBrowserKeeps()).toEqual(THE_BROWSERS_OWN);
  });
});

describe("a session that did not end", () => {
  test("a request that fails another way takes nothing from the browser", async () => {
    server.on(HTTPMethod.POST, INCIDENTS_URL, [{ status: 400, data: {} }]);

    await askForIncidents();

    expect(whatTheBrowserKeeps()).toEqual({
      ...THE_BROWSERS_OWN,
      ...THE_PERSONS_OWN,
    });
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});

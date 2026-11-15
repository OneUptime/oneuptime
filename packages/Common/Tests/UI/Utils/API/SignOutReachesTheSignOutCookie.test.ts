// Must stay the first import: the client's URLs are built from HOST on load.
import { DASHBOARD_ORIGIN } from "./DashboardHost";
import FakeAxiosServer, {
  FakeTransport,
  SentRequest,
  settle,
} from "./FakeAxiosServer";
import { SESSION_SIGN_OUT_COOKIE_PATH } from "../../../../Server/Utils/Cookie";
import BaseAPI from "../../../../UI/Utils/API/API";
import { IDENTITY_URL } from "../../../../UI/Config";
import Navigation from "../../../../UI/Utils/Navigation";
import User from "../../../../UI/Utils/User";
import HTTPMethod from "../../../../Types/API/HTTPMethod";
import Route from "../../../../Types/API/Route";
import URL from "../../../../Types/API/URL";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import axios from "axios";

jest.mock("axios", () => {
  // Keep the real helpers (axios.isAxiosError, AxiosError) and fake only the call.
  return Object.assign(jest.fn(), jest.requireActual("axios"));
});

/*
 * THE DASHBOARD'S SIGN-OUT IS SENT WHERE THE SIGN-OUT COOKIE GOES
 * (issue #8638).
 *
 * After a renewal whose answer was lost, a browser's sign-out names its
 * session by its sign-out cookie, which the server sets on one path only -
 * POST /identity/logout (CookieUtil.SESSION_SIGN_OUT_COOKIE_PATH) - so no
 * other request carries it. A browser sends a cookie only to a path that
 * matches its own (RFC 6265, 5.1.4), so the dashboards must post their
 * sign-out to exactly that path, on their own host: when the person signs
 * out, and when the server refused a renewal - which is what a dashboard
 * meets first after a lost one, and answers by signing out at once.
 *
 * The real client throughout, down to where axios would open a socket.
 */

const mockedAxios: FakeTransport = axios as unknown as FakeTransport;

const REFRESH_URL: string = URL.fromString(IDENTITY_URL.toString())
  .addRoute("/refresh-token")
  .toString();

// The address the sign-out cookie is sent to: the dashboard's host, on its path.
const SIGN_OUT_COOKIE_ADDRESS: string = `${DASHBOARD_ORIGIN}${SESSION_SIGN_OUT_COOKIE_PATH}`;

let server: FakeAxiosServer;

function sentOnTheWire(): Array<string> {
  return server.sent.map((request: SentRequest): string => {
    return `${request.method.toUpperCase()} ${request.url}`;
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();

  server = new FakeAxiosServer(mockedAxios);

  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});
  jest
    .spyOn(Navigation, "getCurrentRoute")
    .mockReturnValue(new Route("/dashboard/overview"));
});

afterEach(() => {
  mockedAxios.mockReset();
  jest.restoreAllMocks();
  localStorage.clear();
});

describe("where the dashboards sign out", () => {
  test("the sign-out cookie's path is /identity/logout", () => {
    expect(SESSION_SIGN_OUT_COOKIE_PATH).toBe("/identity/logout");
  });

  test("signing out posts to that path on the dashboard's own host: the one address the cookie is sent to", async () => {
    server.on(HTTPMethod.POST, SIGN_OUT_COOKIE_ADDRESS, [{ status: 200 }]);

    User.logout();
    await settle();

    expect(sentOnTheWire()).toEqual([`POST ${SIGN_OUT_COOKIE_ADDRESS}`]);
  });

  test("after a lost renewal: the next 401, the renewal the server refuses, and the sign-out the dashboard sends at once, to that address", async () => {
    const url: string = `${DASHBOARD_ORIGIN}/api/incident/get-list`;

    server
      .on(HTTPMethod.POST, url, [{ status: 401 }])
      // The refresh token the lost renewal replaced matches no session.
      .on(HTTPMethod.POST, REFRESH_URL, [
        {
          status: 401,
          data: { message: "Session expired. Please login again." },
        },
      ])
      .on(HTTPMethod.POST, SIGN_OUT_COOKIE_ADDRESS, [
        { status: 200 },
        { status: 200 },
      ]);

    await BaseAPI.post({ url: URL.fromString(url) });
    await settle();

    const sent: Array<string> = sentOnTheWire();

    expect(sent.slice(0, 2)).toEqual([`POST ${url}`, `POST ${REFRESH_URL}`]);

    /*
     * The refused renewal and the request it was for each sign out; a
     * second sign-out of an ended session ends nothing more, and records
     * nothing (POST /identity/logout).
     */
    const signOuts: Array<string> = sent.slice(2);

    expect(signOuts.length).toBeGreaterThanOrEqual(1);

    for (const signOut of signOuts) {
      expect(signOut).toBe(`POST ${SIGN_OUT_COOKIE_ADDRESS}`);
    }
  });
});

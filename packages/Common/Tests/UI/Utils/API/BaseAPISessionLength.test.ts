// Must stay the first import: the client's URLs are built from HOST on load.
import { DASHBOARD_ORIGIN } from "./DashboardHost";
import FakeAxiosServer, { FakeTransport, SentRequest } from "./FakeAxiosServer";
import BaseAPI from "../../../../UI/Utils/API/API";
import { IDENTITY_URL } from "../../../../UI/Config";
import Navigation from "../../../../UI/Utils/Navigation";
import SessionEndReturn from "../../../../UI/Utils/SessionEndReturn";
import User from "../../../../UI/Utils/User";
import UserActivity from "../../../../UI/Utils/UserActivity";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import Route from "../../../../Types/API/Route";
import URL from "../../../../Types/API/URL";
import { SESSION_ENDED_MESSAGES } from "../../../../Types/Exception/SessionEndedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Sleep from "../../../../Types/Sleep";
import {
  INACTIVE_FOR_IN_SECONDS_FIELD,
  SessionEndReason,
} from "../../../../Types/UserSession/SessionLength";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import axios from "axios";

jest.mock("axios", () => {
  // Keep the real helpers (axios.isAxiosError, AxiosError) and fake only the call.
  return Object.assign(jest.fn(), jest.requireActual("axios"));
});

/*
 * HOW LONG A SIGN-IN LASTS, AS THE DASHBOARD'S CLIENT TAKES PART IN IT
 * (UI/Utils/API/API.ts).
 *
 * A master admin can end sign-ins after a length of time, or after a while
 * without use (Admin Dashboard > Settings > Session Length). The server
 * decides both; the client does two things for them:
 *
 *   - each renewal of the session says how long the person has not used
 *     OneUptime in this browser (UserActivity), on the Dashboard and the Admin
 *     Dashboard only, which the server counts the idle timeout from;
 *   - a renewal the server refuses because the session reached its length
 *     or its idle timeout (SessionEndedException) sends the browser to the
 *     sign-in page saying why, and the page the person was on waits for
 *     them to sign in again (SessionEndReturn).
 *
 * Everything runs through the real client, down to where axios would open
 * a socket (FakeAxiosServer).
 */

const mockedAxios: FakeTransport = axios as unknown as FakeTransport;

const REFRESH_URL: string = URL.fromString(IDENTITY_URL.toString())
  .addRoute("/refresh-token")
  .toString();

const PROJECT_ID: string = "8d8d8d8d-8d8d-48d8-88d8-8d8d8d8d8d8d";
const USER_ID: string = "9e9e9e9e-9e9e-49e9-89e9-9e9e9e9e9e9e";

const INCIDENTS_URL: string = `${DASHBOARD_ORIGIN}/api/incident/get-list`;

const INCIDENT_PAGE: string = `/dashboard/${PROJECT_ID}/incidents/view/42?tab=timeline`;

const LOGIN_ROUTE: string = "/accounts/login";

const NOT_AUTHENTICATED_BODY: JSONObject = {
  message: "Authentication required. Please log in to access this resource.",
};

let server: FakeAxiosServer;

let nowInMs: number = 0;

let navigateSpy: jest.SpiedFunction<typeof Navigation.navigate>;

let logoutSpy: jest.SpiedFunction<typeof User.logout>;

// A client whose session is a status page's: not a sign-in to OneUptime.
class StatusPageClient extends BaseAPI {
  protected static override getSessionName(): string {
    return "status-page:7f7f7f7f-7f7f-47f7-87f7-7f7f7f7f7f7f";
  }
}

const navigatedRoutes: () => Array<string> = (): Array<string> => {
  return navigateSpy.mock.calls.map(
    (call: Parameters<typeof Navigation.navigate>): string => {
      return call[0].toString();
    },
  );
};

const refreshRequests: () => Array<SentRequest> = (): Array<SentRequest> => {
  return server.requestsTo(HTTPMethod.POST, REFRESH_URL);
};

// The original request is refused, and so is its renewal, with `refusal`.
const sessionEndsWith: (refusal: JSONObject) => void = (
  refusal: JSONObject,
): void => {
  server
    .on(HTTPMethod.POST, INCIDENTS_URL, [
      { status: 401, data: NOT_AUTHENTICATED_BODY },
    ])
    .on(HTTPMethod.POST, REFRESH_URL, [{ status: 401, data: refusal }]);
};

const requestIncidents: (
  client?: typeof BaseAPI,
) => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> = async (
  client: typeof BaseAPI = BaseAPI,
): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
  return await client.post<JSONObject>({ url: URL.fromString(INCIDENTS_URL) });
};

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, "", INCIDENT_PAGE);
  SessionEndReturn.clear();
  UserActivity.resetForTests();
  BaseAPI.resetSessionEndForTests();

  server = new FakeAxiosServer(mockedAxios);

  nowInMs = 1_800_000_000_000;

  jest.spyOn(Date, "now").mockImplementation((): number => {
    return nowInMs;
  });
  jest.spyOn(Sleep, "sleep").mockImplementation(async (ms: number) => {
    nowInMs += ms;
  });
  jest.spyOn(Math, "random").mockReturnValue(0.5);

  jest.spyOn(User, "getUserId").mockReturnValue(new ObjectID(USER_ID));
  logoutSpy = jest.spyOn(User, "logout").mockImplementation((): void => {});
  navigateSpy = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {});
  jest
    .spyOn(Navigation, "getCurrentRoute")
    .mockReturnValue(new Route(INCIDENT_PAGE));
});

afterEach(() => {
  mockedAxios.mockReset();
  jest.restoreAllMocks();
  UserActivity.resetForTests();
  BaseAPI.resetSessionEndForTests();
  window.history.replaceState({}, "", INCIDENT_PAGE);
  SessionEndReturn.clear();
  localStorage.clear();
});

describe("a renewal says how long the person has not used OneUptime", () => {
  test("on the Dashboard, which notices activity: the seconds since the newest activity of any tab", async () => {
    UserActivity.install();
    nowInMs += 10 * 60 * 1000;

    server
      .on(HTTPMethod.POST, INCIDENTS_URL, [
        { status: 401, data: NOT_AUTHENTICATED_BODY },
        { status: 200, data: { count: 1 } },
      ])
      .on(HTTPMethod.POST, REFRESH_URL, [{ status: 200 }]);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await requestIncidents();

    expect(response.statusCode).toBe(200);
    expect(refreshRequests()).toHaveLength(1);
    expect(refreshRequests()[0]!.data).toEqual({
      [INACTIVE_FOR_IN_SECONDS_FIELD]: 600,
    });
  });

  test("refreshSession, for the paths that renew on their own, says it too", async () => {
    UserActivity.install();
    nowInMs += 42 * 1000;

    server.on(HTTPMethod.POST, REFRESH_URL, [{ status: 200 }]);

    await expect(BaseAPI.refreshSession()).resolves.toBe(true);
    expect(refreshRequests()[0]!.data).toEqual({
      [INACTIVE_FOR_IN_SECONDS_FIELD]: 42,
    });
  });

  test("a page that does not notice activity says nothing: the server counts from the last renewal", async () => {
    server.on(HTTPMethod.POST, REFRESH_URL, [{ status: 200 }]);

    await BaseAPI.refreshSession();

    expect(refreshRequests()[0]!.data).toBeUndefined();
  });

  test("a status page's session says nothing: it is not a sign-in to OneUptime", async () => {
    UserActivity.install();
    nowInMs += 60 * 1000;

    server.on(HTTPMethod.POST, REFRESH_URL, [{ status: 200 }]);

    await StatusPageClient.refreshSession();

    expect(refreshRequests()[0]!.data).toBeUndefined();
  });
});

describe("a session the server ended for its length or its idle timeout", () => {
  test.each([
    [SessionEndReason.LengthReached, "length-reached"],
    [SessionEndReason.Inactive, "inactive"],
  ])(
    "%s: the sign-in page says why",
    async (reason: SessionEndReason, inAddress: string) => {
      sessionEndsWith({ message: SESSION_ENDED_MESSAGES[reason] });

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await requestIncidents();

      expect(response).toBeInstanceOf(HTTPErrorResponse);
      expect(response.statusCode).toBe(401);
      expect(logoutSpy).toHaveBeenCalled();

      const routes: Array<string> = navigatedRoutes();

      expect(routes.length).toBeGreaterThan(0);

      for (const route of routes) {
        expect(route).toBe(`${LOGIN_ROUTE}?sessionEnded=${inAddress}`);
      }
    },
  );

  test("the page the person was on waits for them, query and all", async () => {
    sessionEndsWith({
      message: SESSION_ENDED_MESSAGES[SessionEndReason.Inactive],
    });

    await requestIncidents();

    expect(SessionEndReturn.consumeRoute(USER_ID)?.toString()).toBe(
      INCIDENT_PAGE,
    );
  });

  test("the page is remembered before the client forgets who was signed in", async () => {
    let rememberedWhenLoggedOut: boolean = false;

    logoutSpy.mockImplementation((): void => {
      // As User.logout does: who was signed in is gone from here on.
      jest.spyOn(User, "getUserId").mockReturnValue(new ObjectID(""));
      rememberedWhenLoggedOut = document.cookie.includes(
        "oneuptime-page-after-sign-in=",
      );
    });

    sessionEndsWith({
      message: SESSION_ENDED_MESSAGES[SessionEndReason.LengthReached],
    });

    await requestIncidents();

    expect(rememberedWhenLoggedOut).toBe(true);
    expect(SessionEndReturn.consumeRoute(USER_ID)?.toString()).toBe(
      INCIDENT_PAGE,
    );
  });

  test("every request that fails after the server said why goes to the same page", async () => {
    sessionEndsWith({
      message: SESSION_ENDED_MESSAGES[SessionEndReason.LengthReached],
    });

    await requestIncidents();

    // A request already on its way comes back 401 too; its renewal says nothing more.
    server
      .on(HTTPMethod.POST, INCIDENTS_URL, [
        { status: 401, data: NOT_AUTHENTICATED_BODY },
      ])
      .on(HTTPMethod.POST, REFRESH_URL, [
        { status: 401, data: NOT_AUTHENTICATED_BODY },
      ]);

    navigateSpy.mockClear();

    await requestIncidents();

    expect(navigatedRoutes().length).toBeGreaterThan(0);

    for (const route of navigatedRoutes()) {
      expect(route).toBe(`${LOGIN_ROUTE}?sessionEnded=length-reached`);
    }
  });

  test("a session that ended for another reason (signed out elsewhere) goes to the sign-in page as before, and still brings the person back", async () => {
    sessionEndsWith(NOT_AUTHENTICATED_BODY);

    await requestIncidents();

    expect(new Set(navigatedRoutes())).toEqual(new Set([LOGIN_ROUTE]));
    expect(SessionEndReturn.consumeRoute(USER_ID)?.toString()).toBe(
      INCIDENT_PAGE,
    );
  });

  test("a renewal that only failed to arrive ends nothing: it is retried, and the person stays", async () => {
    server
      .on(HTTPMethod.POST, INCIDENTS_URL, [
        { status: 401, data: NOT_AUTHENTICATED_BODY },
        { status: 200, data: { count: 2 } },
      ])
      .on(HTTPMethod.POST, REFRESH_URL, [
        { networkErrorCode: "ECONNRESET" },
        { status: 200 },
      ]);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await requestIncidents();

    expect(response.statusCode).toBe(200);
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(SessionEndReturn.consumeRoute(USER_ID)).toBeNull();
  });

  test("a status page's 401 is no sign-in to OneUptime ending: no reason said, no page remembered", async () => {
    sessionEndsWith({
      message: SESSION_ENDED_MESSAGES[SessionEndReason.LengthReached],
    });

    await requestIncidents(StatusPageClient);

    expect(navigatedRoutes().length).toBeGreaterThan(0);

    for (const route of navigatedRoutes()) {
      expect(route).toBe(LOGIN_ROUTE);
    }

    expect(SessionEndReturn.consumeRoute(USER_ID)).toBeNull();
  });

  test("a project that is gone (405) is not a session ending: no page remembered", async () => {
    server.on(HTTPMethod.POST, INCIDENTS_URL, [
      { status: 405, data: { message: "Project not found" } },
    ]);

    await requestIncidents();

    expect(navigatedRoutes()).toEqual([LOGIN_ROUTE]);
    expect(SessionEndReturn.consumeRoute(USER_ID)).toBeNull();
  });

  test("on the sign-in page already, nothing navigates: a forced reload would fail the same way", async () => {
    jest
      .spyOn(Navigation, "getCurrentRoute")
      .mockReturnValue(new Route(LOGIN_ROUTE));

    sessionEndsWith({
      message: SESSION_ENDED_MESSAGES[SessionEndReason.Inactive],
    });

    await requestIncidents();

    expect(navigateSpy).not.toHaveBeenCalled();
  });
});

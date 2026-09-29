// Must stay the first import: the client's URLs are built from HOST on load.
import { DASHBOARD_ORIGIN } from "./DashboardHost";
import FakeAxiosServer, {
  FakeTransport,
  Gate,
  SentRequest,
  createGate,
  settle,
} from "./FakeAxiosServer";
import BaseAPI from "../../../../UI/Utils/API/API";
import { IDENTITY_URL } from "../../../../UI/Config";
import Navigation from "../../../../UI/Utils/Navigation";
import User from "../../../../UI/Utils/User";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import Route from "../../../../Types/API/Route";
import URL from "../../../../Types/API/URL";
import APIException from "../../../../Types/Exception/ApiException";
import { JSONObject } from "../../../../Types/JSON";
import Sleep from "../../../../Types/Sleep";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import axios from "axios";

jest.mock("axios", () => {
  // Keep the real helpers (axios.isAxiosError, AxiosError) and fake only the call.
  return Object.assign(jest.fn(), jest.requireActual("axios"));
});

/*
 * THE SESSION THAT LAPSED WHILE THE TAB WAS OPEN.
 *
 * The access-token cookie lives exactly as long as the 15-minute JWT inside it,
 * so a Dashboard left open for a quarter of an hour sends its next request with
 * no credentials at all. The server now answers every such request 401, and the
 * browser client is expected to do one thing with a 401: refresh the session
 * once, replay the request once, and hand the caller the replayed answer - as if
 * the lapse had never happened.
 *
 * Everything here runs through the real client, down to where axios would open
 * a socket: the fake below answers in axios's place, with real AxiosErrors.
 * What these tests pin:
 *
 *   - a 401 costs exactly one refresh and one replay, of the same request;
 *   - a page load of concurrent 401s still costs ONE refresh (the server rotates
 *     the refresh token on every use, so a second refresh would spend a token
 *     that no longer exists and log the user out);
 *   - a refresh the server refuses is final, and ends at the login page -
 *     unless the reader is already there, where a forced navigation would
 *     reload the page into the same 401 forever;
 *   - a refresh that failed for a reason a retry can fix is retried first;
 *   - no other status - above all the 422 the customer saw - refreshes anything;
 *   - refreshSession(), the public entry point, shares the single flight, uses
 *     the cross-tab lock when there is one, and reuses a refresh another tab
 *     finished moments ago.
 */

const mockedAxios: FakeTransport = axios as unknown as FakeTransport;

const REFRESH_URL: string = URL.fromString(IDENTITY_URL.toString())
  .addRoute("/refresh-token")
  .toString();

const API_ORIGIN: string = `${DASHBOARD_ORIGIN}/api`;

const SEND_SETUP_REMINDER_URL: string = `${API_ORIGIN}/on-call-readiness/send-setup-reminder`;

const PROJECT_ID: string = "dddddddd-4444-4444-8444-444444444444";

const SESSION_REFRESHED_AT_KEY: string = "session-refreshed-at:dashboard";

const NOT_AUTHENTICATED_BODY: JSONObject = {
  message: "Authentication required. Please log in to access this resource.",
};

const DASHBOARD_ROUTE: Route = new Route(`/dashboard/${PROJECT_ID}/on-call`);

const LOGIN_ROUTE: string = "/accounts/login";

let server: FakeAxiosServer;

// Simulated wall clock, so the "recently refreshed" window is exact.
let nowInMs: number = 0;

let sleptForInMs: Array<number> = [];

let logoutSpy: jest.SpiedFunction<typeof User.logout>;

let navigateSpy: jest.SpiedFunction<typeof Navigation.navigate>;

let currentRouteSpy: jest.SpiedFunction<typeof Navigation.getCurrentRoute>;

type EndpointFunction = (path: string) => string;

const endpoint: EndpointFunction = (path: string): string => {
  return `${API_ORIGIN}${path}`;
};

type RefreshRequestsFunction = () => Array<SentRequest>;

const refreshRequests: RefreshRequestsFunction = (): Array<SentRequest> => {
  return server.requestsTo(HTTPMethod.POST, REFRESH_URL);
};

type NavigatedRoutesFunction = () => Array<string>;

const navigatedRoutes: NavigatedRoutesFunction = (): Array<string> => {
  return navigateSpy.mock.calls.map(
    (call: Parameters<typeof Navigation.navigate>): string => {
      return call[0].toString();
    },
  );
};

type SetLocksFunction = (locks: LockManager | undefined) => void;

const setNavigatorLocks: SetLocksFunction = (
  locks: LockManager | undefined,
): void => {
  if (locks === undefined) {
    delete (window.navigator as unknown as { locks?: LockManager }).locks;
    return;
  }

  Object.defineProperty(window.navigator, "locks", {
    configurable: true,
    value: locks,
  });
};

beforeEach(() => {
  localStorage.clear();
  setNavigatorLocks(undefined);

  server = new FakeAxiosServer(mockedAxios);

  nowInMs = 1_700_000_000_000;
  sleptForInMs = [];

  jest.spyOn(Date, "now").mockImplementation((): number => {
    return nowInMs;
  });

  jest.spyOn(Sleep, "sleep").mockImplementation(async (ms: number) => {
    sleptForInMs.push(ms);
    nowInMs += ms;
  });

  // Deterministic backoff jitter: the midpoint of each window.
  jest.spyOn(Math, "random").mockReturnValue(0.5);

  logoutSpy = jest.spyOn(User, "logout").mockImplementation((): void => {});

  navigateSpy = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {});

  currentRouteSpy = jest
    .spyOn(Navigation, "getCurrentRoute")
    .mockReturnValue(DASHBOARD_ROUTE);
});

afterEach(() => {
  mockedAxios.mockReset();
  jest.restoreAllMocks();
  setNavigatorLocks(undefined);
  localStorage.clear();
});

describe("A request that comes back 401 because the session lapsed", () => {
  test("is refreshed once and replayed once, and the caller gets the replayed answer", async () => {
    const url: string = endpoint("/incident/get-list");

    server
      .on(HTTPMethod.POST, `${url}?limit=10&skip=0`, [
        { status: 401, data: NOT_AUTHENTICATED_BODY },
        { status: 200, data: { count: 3 } },
      ])
      .on(HTTPMethod.POST, REFRESH_URL, [{ status: 200 }]);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await BaseAPI.post<JSONObject>({
        url: URL.fromString(url),
        data: { query: { title: "db" } },
        headers: { tenantid: PROJECT_ID },
        params: { limit: "10", skip: "0" },
      });

    expect(response).toBeInstanceOf(HTTPResponse);
    expect(response).not.toBeInstanceOf(HTTPErrorResponse);
    expect(response.statusCode).toBe(200);
    expect(response.data).toEqual({ count: 3 });

    // The order on the wire: the refused request, the refresh, the replay.
    expect(
      server.sent.map((request: SentRequest): string => {
        return `${request.method.toUpperCase()} ${request.url}`;
      }),
    ).toEqual([
      `POST ${url}?limit=10&skip=0`,
      `POST ${REFRESH_URL}`,
      `POST ${url}?limit=10&skip=0`,
    ]);

    const original: SentRequest = server.sent[0]!;
    const refresh: SentRequest = server.sent[1]!;
    const replay: SentRequest = server.sent[2]!;

    // The replay is the same request: same body, same tenant, same query once.
    expect(replay.data).toEqual(original.data);
    expect(replay.data).toEqual({ query: { title: "db" } });
    expect(replay.headers["tenantid"]).toBe(PROJECT_ID);
    expect(replay.url.match(/limit=/g)).toHaveLength(1);
    expect(replay.url.match(/skip=/g)).toHaveLength(1);

    // The refresh carries nothing of the request it is refreshing for.
    expect(refresh.data).toBeUndefined();
    expect(refresh.headers["tenantid"]).toBeUndefined();

    // Nobody is logged out and nothing navigates: the lapse is invisible.
    expect(logoutSpy).not.toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  test.each([
    HTTPMethod.GET,
    HTTPMethod.PUT,
    HTTPMethod.PATCH,
    HTTPMethod.DELETE,
  ])("a %s is replayed with its own method", async (method: HTTPMethod) => {
    const url: string = endpoint("/monitor/abc");

    server
      .on(method, url, [
        { status: 401, data: NOT_AUTHENTICATED_BODY },
        { status: 200, data: { ok: true } },
      ])
      .on(HTTPMethod.POST, REFRESH_URL, [{ status: 200 }]);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await BaseAPI.fetch<JSONObject>({
        method: method,
        url: URL.fromString(url),
      });

    expect(response.statusCode).toBe(200);
    expect(server.requestsTo(method, url)).toHaveLength(2);
    expect(refreshRequests()).toHaveLength(1);
  });

  test("a successful refresh is remembered for the other tabs", async () => {
    const url: string = endpoint("/project/get-list");

    server
      .on(HTTPMethod.POST, url, [{ status: 401 }, { status: 200 }])
      .on(HTTPMethod.POST, REFRESH_URL, [{ status: 200 }]);

    await BaseAPI.post<JSONObject>({ url: URL.fromString(url) });

    expect(localStorage.getItem(SESSION_REFRESHED_AT_KEY)).toBe(
      String(nowInMs),
    );
  });

  /*
   * One refresh buys one replay. A replay refused again means the refresh did
   * not help, and a second refresh would not either - it would only spend the
   * rotated token.
   */
  test("a replay that is refused again is final: no second refresh, one logout", async () => {
    const url: string = endpoint("/alert/get-list");

    server
      .on(HTTPMethod.POST, url, [
        { status: 401, data: NOT_AUTHENTICATED_BODY },
        { status: 401, data: NOT_AUTHENTICATED_BODY },
      ])
      .on(HTTPMethod.POST, REFRESH_URL, [{ status: 200 }]);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await BaseAPI.post<JSONObject>({ url: URL.fromString(url) });

    expect(response).toBeInstanceOf(HTTPErrorResponse);
    expect(response.statusCode).toBe(401);
    expect(refreshRequests()).toHaveLength(1);
    expect(server.requestsTo(HTTPMethod.POST, url)).toHaveLength(2);
    expect(logoutSpy).toHaveBeenCalledTimes(1);
    expect(navigatedRoutes()).toEqual([LOGIN_ROUTE]);
  });

  test("a request that opted out of refreshing gets its 401 as it came", async () => {
    const url: string = endpoint("/user/me");

    server.on(HTTPMethod.GET, url, [
      { status: 401, data: NOT_AUTHENTICATED_BODY },
    ]);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await BaseAPI.get<JSONObject>({
        url: URL.fromString(url),
        options: { skipAuthRefresh: true },
      });

    expect(response.statusCode).toBe(401);
    expect(refreshRequests()).toHaveLength(0);
    expect(logoutSpy).toHaveBeenCalledTimes(1);
  });
});

describe("Many requests lapsing at once", () => {
  /*
   * A page load: five lists requested together, all of them past the token's
   * lifetime. The refresh is held open until every one of the five has come
   * back 401, so this is the worst case for a single flight rather than a
   * lucky ordering.
   */
  test("five concurrent 401s share ONE refresh, and all five are replayed", async () => {
    const refreshGate: Gate = createGate();

    const urls: Array<string> = [1, 2, 3, 4, 5].map((n: number): string => {
      return endpoint(`/widget-${n}/get-list`);
    });

    urls.forEach((url: string, index: number) => {
      server.on(HTTPMethod.POST, url, [
        { status: 401, data: NOT_AUTHENTICATED_BODY },
        { status: 200, data: { widget: index + 1 } },
      ]);
    });

    server.on(HTTPMethod.POST, REFRESH_URL, [
      { status: 200, gate: refreshGate.promise },
    ]);

    const pending: Promise<
      Array<HTTPResponse<JSONObject> | HTTPErrorResponse>
    > = Promise.all(
      urls.map(
        (
          url: string,
        ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
          return BaseAPI.post<JSONObject>({ url: URL.fromString(url) });
        },
      ),
    );

    await settle();

    // All five have been refused and all five are waiting on the same refresh.
    for (const url of urls) {
      expect(server.requestsTo(HTTPMethod.POST, url)).toHaveLength(1);
    }
    expect(refreshRequests()).toHaveLength(1);

    refreshGate.open();

    const responses: Array<HTTPResponse<JSONObject> | HTTPErrorResponse> =
      await pending;

    expect(
      responses.map(
        (response: HTTPResponse<JSONObject> | HTTPErrorResponse): number => {
          return response.statusCode;
        },
      ),
    ).toEqual([200, 200, 200, 200, 200]);

    expect(
      responses.map(
        (response: HTTPResponse<JSONObject> | HTTPErrorResponse): unknown => {
          return (response.data as JSONObject)["widget"];
        },
      ),
    ).toEqual([1, 2, 3, 4, 5]);

    expect(refreshRequests()).toHaveLength(1);

    for (const url of urls) {
      expect(server.requestsTo(HTTPMethod.POST, url)).toHaveLength(2);
    }

    expect(logoutSpy).not.toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  /*
   * The straggler: a request that was already on the wire when the refresh
   * finished comes back 401 a moment later. The session is fresh, so it is
   * replayed on the refresh that just happened instead of spending the new
   * refresh token on another one.
   */
  test("a 401 that lands just after a refresh finished reuses it", async () => {
    const first: string = endpoint("/incident/get-list");
    const straggler: string = endpoint("/alert/get-list");

    server
      .on(HTTPMethod.POST, first, [{ status: 401 }, { status: 200 }])
      .on(HTTPMethod.POST, straggler, [{ status: 401 }, { status: 200 }])
      .on(HTTPMethod.POST, REFRESH_URL, [{ status: 200 }]);

    await BaseAPI.post<JSONObject>({ url: URL.fromString(first) });

    nowInMs += 2_000;

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await BaseAPI.post<JSONObject>({ url: URL.fromString(straggler) });

    expect(response.statusCode).toBe(200);
    expect(refreshRequests()).toHaveLength(1);
  });
});

describe("A refresh the server refuses", () => {
  test("the caller gets its own 401, the user is logged out and sent to the login page", async () => {
    const url: string = endpoint("/incident/get-list");

    server
      .on(HTTPMethod.POST, url, [{ status: 401, data: NOT_AUTHENTICATED_BODY }])
      .on(HTTPMethod.POST, REFRESH_URL, [
        { status: 401, data: { message: "Refresh token expired." } },
      ]);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await BaseAPI.post<JSONObject>({ url: URL.fromString(url) });

    // The caller's own refusal, not the refresh's.
    expect(response).toBeInstanceOf(HTTPErrorResponse);
    expect(response.statusCode).toBe(401);
    expect((response as HTTPErrorResponse).message).toBe(
      NOT_AUTHENTICATED_BODY["message"],
    );

    // Never replayed: there is no session to replay it on.
    expect(server.requestsTo(HTTPMethod.POST, url)).toHaveLength(1);

    // A 401 is final for the refresh too - it is not retried.
    expect(refreshRequests()).toHaveLength(1);
    expect(sleptForInMs).toEqual([]);

    /*
     * The refresh request answers through the same error handler as the
     * request it was refreshing for, so the logout runs for each of them;
     * what matters is that it runs and that every navigation goes to login.
     */
    expect(logoutSpy).toHaveBeenCalled();
    expect(new Set(navigatedRoutes())).toEqual(new Set([LOGIN_ROUTE]));
    for (const call of navigateSpy.mock.calls) {
      expect(call[1]).toEqual({ forceNavigate: true });
    }

    // A failed refresh is not remembered as a refresh.
    expect(localStorage.getItem(SESSION_REFRESHED_AT_KEY)).toBeNull();
  });

  /*
   * The reload loop. The login page makes requests of its own; if they 401 and
   * the handler force-navigates to the login page it is already on, the page
   * reloads, makes the same requests, and does it again.
   */
  test("on the login page itself, it logs out but does not navigate", async () => {
    currentRouteSpy.mockReturnValue(new Route(LOGIN_ROUTE));

    const url: string = endpoint("/global-config/get");

    server
      .on(HTTPMethod.GET, url, [{ status: 401 }])
      .on(HTTPMethod.POST, REFRESH_URL, [{ status: 401 }]);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await BaseAPI.get<JSONObject>({ url: URL.fromString(url) });

    expect(response.statusCode).toBe(401);
    expect(logoutSpy).toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  test("a 405 (the project is gone) still logs out and navigates away", async () => {
    const url: string = endpoint("/incident/get-list");

    server.on(HTTPMethod.POST, url, [{ status: 405 }]);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await BaseAPI.post<JSONObject>({ url: URL.fromString(url) });

    expect(response.statusCode).toBe(405);
    expect(refreshRequests()).toHaveLength(0);
    expect(logoutSpy).toHaveBeenCalledTimes(1);
    expect(navigatedRoutes()).toEqual([LOGIN_ROUTE]);
  });

  test("the failed refresh does not stick: the next 401 refreshes afresh", async () => {
    const url: string = endpoint("/incident/get-list");

    server
      .on(HTTPMethod.POST, url, [
        { status: 401 },
        { status: 401 },
        { status: 200, data: { ok: true } },
      ])
      .on(HTTPMethod.POST, REFRESH_URL, [{ status: 401 }, { status: 200 }]);

    const refused: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await BaseAPI.post<JSONObject>({ url: URL.fromString(url) });

    expect(refused.statusCode).toBe(401);

    const recovered: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await BaseAPI.post<JSONObject>({ url: URL.fromString(url) });

    expect(recovered.statusCode).toBe(200);
    expect(refreshRequests()).toHaveLength(2);
  });
});

describe("A refresh that fails for a reason a retry can fix", () => {
  /*
   * The identity service restarting during a deploy answers 503 for a few
   * seconds. That is not a dead session, and logging the user out for it is
   * what the retries are there to prevent.
   */
  test("a 503 is retried with backoff, and the request is replayed once it works", async () => {
    const url: string = endpoint("/incident/get-list");

    server
      .on(HTTPMethod.POST, url, [
        { status: 401 },
        { status: 200, data: { ok: true } },
      ])
      .on(HTTPMethod.POST, REFRESH_URL, [{ status: 503 }, { status: 200 }]);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await BaseAPI.post<JSONObject>({ url: URL.fromString(url) });

    expect(response.statusCode).toBe(200);
    expect(response.data).toEqual({ ok: true });
    expect(refreshRequests()).toHaveLength(2);
    // Exponential backoff with equal jitter: 2s window, midpoint = 1.5s.
    expect(sleptForInMs).toEqual([1500]);
    expect(logoutSpy).not.toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  test("a refresh still failing after its retries is a failed refresh: logout", async () => {
    const url: string = endpoint("/incident/get-list");

    server
      .on(HTTPMethod.POST, url, [{ status: 401 }])
      .on(HTTPMethod.POST, REFRESH_URL, [
        { status: 503 },
        { status: 503 },
        { status: 503 },
      ]);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await BaseAPI.post<JSONObject>({ url: URL.fromString(url) });

    expect(response.statusCode).toBe(401);
    // One attempt and two retries, backing off 1.5s then 3s.
    expect(refreshRequests()).toHaveLength(3);
    expect(sleptForInMs).toEqual([1500, 3000]);
    expect(server.requestsTo(HTTPMethod.POST, url)).toHaveLength(1);
    expect(logoutSpy).toHaveBeenCalled();
    expect(navigatedRoutes()).toContain(LOGIN_ROUTE);
  });

  test("a dropped connection is retried, and the request replayed once it works", async () => {
    const url: string = endpoint("/incident/get-list");

    server
      .on(HTTPMethod.POST, url, [{ status: 401 }, { status: 200 }])
      .on(HTTPMethod.POST, REFRESH_URL, [
        { networkErrorCode: "ECONNRESET" },
        { status: 200 },
      ]);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await BaseAPI.post<JSONObject>({ url: URL.fromString(url) });

    expect(response.statusCode).toBe(200);
    expect(refreshRequests()).toHaveLength(2);
    expect(logoutSpy).not.toHaveBeenCalled();
  });

  /*
   * No answer at all, three times over. The client does NOT read that as a
   * dead session: the refresh rejects with the transport error instead of
   * resolving false, so the request that needed it rejects too, and nobody is
   * logged out over what may be a network blip. The in-flight slot is still
   * released, so the next 401 tries again.
   */
  test("a refresh that never gets an answer rejects rather than logging the user out", async () => {
    const url: string = endpoint("/incident/get-list");

    server
      .on(HTTPMethod.POST, url, [{ status: 401 }])
      .on(HTTPMethod.POST, REFRESH_URL, [
        { networkErrorCode: "ECONNREFUSED" },
        { networkErrorCode: "ECONNREFUSED" },
        { networkErrorCode: "ECONNREFUSED" },
        { status: 200 },
      ]);

    await expect(
      BaseAPI.post<JSONObject>({ url: URL.fromString(url) }),
    ).rejects.toBeInstanceOf(APIException);

    expect(refreshRequests()).toHaveLength(3);
    expect(sleptForInMs).toEqual([1500, 3000]);
    expect(logoutSpy).not.toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();

    await expect(BaseAPI.refreshSession()).resolves.toBe(true);
    expect(refreshRequests()).toHaveLength(4);
  });

  /*
   * Called directly - by a raw fetch, a navigation, the realtime socket - the
   * same unanswered refresh resolves false instead of rejecting, so none of
   * those callers has to guard against a throw. It still logs nobody out.
   */
  test("refreshSession() called directly resolves false when the refresh never gets an answer", async () => {
    server.on(HTTPMethod.POST, REFRESH_URL, [
      { networkErrorCode: "ECONNREFUSED" },
      { networkErrorCode: "ECONNREFUSED" },
      { networkErrorCode: "ECONNREFUSED" },
    ]);

    await expect(BaseAPI.refreshSession()).resolves.toBe(false);

    expect(refreshRequests()).toHaveLength(3);
    expect(logoutSpy).not.toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});

describe("Statuses that are not a lapsed session", () => {
  /*
   * The customer's screenshot: a 422 "You are not authorized to access this
   * project's data." for a request that simply had no credentials. The client
   * cannot tell that 422 from a real permission refusal, so it must never
   * refresh on one - which is exactly why the server now says 401.
   */
  test.each([
    [400, "Project ID is required."],
    [403, "Forbidden."],
    [404, "Not found."],
    [422, "You are not authorized to access this project's data."],
    [500, "Server error."],
  ])(
    "a %s goes straight back to the caller, with no refresh",
    async (status: number, message: string) => {
      const url: string = SEND_SETUP_REMINDER_URL;

      server.on(HTTPMethod.POST, url, [
        { status: status, data: { message: message } },
      ]);

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await BaseAPI.post<JSONObject>({
          url: URL.fromString(url),
          data: { userIds: ["aaaaaaaa-1111-4111-8111-111111111111"] },
        });

      expect(response).toBeInstanceOf(HTTPErrorResponse);
      expect(response.statusCode).toBe(status);
      expect((response as HTTPErrorResponse).message).toBe(message);
      expect(server.sent).toHaveLength(1);
      expect(refreshRequests()).toHaveLength(0);
      expect(logoutSpy).not.toHaveBeenCalled();
      expect(navigatedRoutes()).not.toContain(LOGIN_ROUTE);
    },
  );
});

describe("BaseAPI.refreshSession()", () => {
  test("returns true on a 2xx and stamps the time it happened", async () => {
    server.on(HTTPMethod.POST, REFRESH_URL, [{ status: 200 }]);

    await expect(BaseAPI.refreshSession()).resolves.toBe(true);

    expect(refreshRequests()).toHaveLength(1);
    expect(localStorage.getItem(SESSION_REFRESHED_AT_KEY)).toBe(
      String(nowInMs),
    );
  });

  test("returns false on a refusal, and stamps nothing", async () => {
    server.on(HTTPMethod.POST, REFRESH_URL, [{ status: 401 }]);

    await expect(BaseAPI.refreshSession()).resolves.toBe(false);

    expect(localStorage.getItem(SESSION_REFRESHED_AT_KEY)).toBeNull();
  });

  /*
   * Another tab (or an earlier request in this one) refreshed a moment ago.
   * Tabs share cookies, so that refresh's access token is already this tab's,
   * and refreshing again would spend the refresh token that tab just rotated.
   */
  test("inside the recent-refresh window it returns true without a request", async () => {
    localStorage.setItem(SESSION_REFRESHED_AT_KEY, String(nowInMs));

    nowInMs += BaseAPI.RECENT_SESSION_REFRESH_WINDOW_IN_MS - 1;

    await expect(BaseAPI.refreshSession()).resolves.toBe(true);

    expect(server.sent).toHaveLength(0);
  });

  test("a second call right after a successful one is free", async () => {
    server.on(HTTPMethod.POST, REFRESH_URL, [{ status: 200 }]);

    await expect(BaseAPI.refreshSession()).resolves.toBe(true);

    nowInMs += 5_000;

    await expect(BaseAPI.refreshSession()).resolves.toBe(true);

    expect(refreshRequests()).toHaveLength(1);
  });

  test("once the window has passed it refreshes again", async () => {
    server.on(HTTPMethod.POST, REFRESH_URL, [{ status: 200 }, { status: 200 }]);

    await expect(BaseAPI.refreshSession()).resolves.toBe(true);

    nowInMs += BaseAPI.RECENT_SESSION_REFRESH_WINDOW_IN_MS;

    await expect(BaseAPI.refreshSession()).resolves.toBe(true);

    expect(refreshRequests()).toHaveLength(2);
    expect(localStorage.getItem(SESSION_REFRESHED_AT_KEY)).toBe(
      String(nowInMs),
    );
  });

  test("the window is fifteen seconds", () => {
    expect(BaseAPI.RECENT_SESSION_REFRESH_WINDOW_IN_MS).toBe(15_000);
  });

  // A stamp from the future (a skewed clock in another tab) proves nothing.
  test("a stamp from the future is ignored", async () => {
    localStorage.setItem(SESSION_REFRESHED_AT_KEY, String(nowInMs + 60_000));

    server.on(HTTPMethod.POST, REFRESH_URL, [{ status: 200 }]);

    await expect(BaseAPI.refreshSession()).resolves.toBe(true);

    expect(refreshRequests()).toHaveLength(1);
  });

  test("a stamp that is not a time is ignored", async () => {
    localStorage.setItem(SESSION_REFRESHED_AT_KEY, "not-a-number");

    server.on(HTTPMethod.POST, REFRESH_URL, [{ status: 200 }]);

    await expect(BaseAPI.refreshSession()).resolves.toBe(true);

    expect(refreshRequests()).toHaveLength(1);
  });

  /*
   * The stamp is best effort: storage that refuses it (quota, privacy modes)
   * must cost the cross-tab reuse and nothing else - every tab just refreshes.
   */
  test("a stamp that cannot be read or written never breaks the refresh", async () => {
    const originalGetItem: Storage["getItem"] = Storage.prototype.getItem;
    const originalSetItem: Storage["setItem"] = Storage.prototype.setItem;

    type IsStampKeyFunction = (key: string) => boolean;

    const isStampKey: IsStampKeyFunction = (key: string): boolean => {
      return key.startsWith("session-refreshed-at:");
    };

    jest
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation((key: string): string | null => {
        if (isStampKey(key)) {
          throw new Error("SecurityError: storage is disabled");
        }

        return originalGetItem.call(window.localStorage, key);
      });

    jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation((key: string, value: string): void => {
        if (isStampKey(key)) {
          throw new Error("QuotaExceededError: storage is full");
        }

        originalSetItem.call(window.localStorage, key, value);
      });

    server.on(HTTPMethod.POST, REFRESH_URL, [{ status: 200 }]);

    await expect(BaseAPI.refreshSession()).resolves.toBe(true);

    expect(refreshRequests()).toHaveLength(1);
  });

  test("concurrent callers share one request and one answer", async () => {
    const refreshGate: Gate = createGate();

    server.on(HTTPMethod.POST, REFRESH_URL, [
      { status: 200, gate: refreshGate.promise },
    ]);

    const results: Promise<Array<boolean>> = Promise.all([
      BaseAPI.refreshSession(),
      BaseAPI.refreshSession(),
      BaseAPI.refreshSession(),
    ]);

    await settle();

    expect(refreshRequests()).toHaveLength(1);

    refreshGate.open();

    await expect(results).resolves.toEqual([true, true, true]);
    expect(refreshRequests()).toHaveLength(1);
  });

  test("concurrent callers share a failure too", async () => {
    const refreshGate: Gate = createGate();

    server.on(HTTPMethod.POST, REFRESH_URL, [
      { status: 401, gate: refreshGate.promise },
    ]);

    const results: Promise<Array<boolean>> = Promise.all([
      BaseAPI.refreshSession(),
      BaseAPI.refreshSession(),
    ]);

    await settle();

    refreshGate.open();

    await expect(results).resolves.toEqual([false, false]);
    expect(refreshRequests()).toHaveLength(1);
  });

  test("the refresh is a bodiless POST to the identity service's refresh-token route", async () => {
    server.on(HTTPMethod.POST, REFRESH_URL, [{ status: 200 }]);

    await BaseAPI.refreshSession();

    expect(REFRESH_URL).toBe(
      "https://oneuptime.example.com/identity/refresh-token",
    );
    expect(server.sent).toEqual([
      expect.objectContaining({
        method: HTTPMethod.POST,
        url: REFRESH_URL,
        data: undefined,
      }),
    ]);
  });
});

describe("BaseAPI.refreshSession() across tabs", () => {
  test("with Web Locks, the request is made while holding the session's lock", async () => {
    let isInsideLock: boolean = false;
    const requestsMadeInsideLock: Array<boolean> = [];

    const request: MockFunction = getJestMockFunction().mockImplementation(
      async (
        _name: string,
        callback: () => Promise<boolean>,
      ): Promise<boolean> => {
        isInsideLock = true;

        try {
          return await callback();
        } finally {
          isInsideLock = false;
        }
      },
    );

    setNavigatorLocks({ request: request } as unknown as LockManager);

    server.onRequest = (): void => {
      requestsMadeInsideLock.push(isInsideLock);
    };

    server.on(HTTPMethod.POST, REFRESH_URL, [{ status: 200 }]);

    await expect(BaseAPI.refreshSession()).resolves.toBe(true);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![0]).toBe(
      "oneuptime-session-refresh:dashboard",
    );
    expect(requestsMadeInsideLock).toEqual([true]);
  });

  /*
   * The race the lock exists for. Two tabs notice the lapse together; the
   * other tab wins the lock and refreshes. By the time this tab is granted the
   * lock the refresh token it would send has already been rotated - sending it
   * gets a 401 and a response that clears the cookies the winner just set. So
   * it must look at the stamp the winner left and stop there.
   */
  test("a tab granted the lock after another tab refreshed reuses that refresh", async () => {
    const otherTabFinished: Gate = createGate();

    const request: MockFunction = getJestMockFunction().mockImplementation(
      async (
        _name: string,
        callback: () => Promise<boolean>,
      ): Promise<boolean> => {
        // The other tab holds the lock until it has finished refreshing.
        await otherTabFinished.promise;
        return await callback();
      },
    );

    setNavigatorLocks({ request: request } as unknown as LockManager);

    const refreshed: Promise<boolean> = BaseAPI.refreshSession();

    await settle();

    // The other tab's refresh lands and stamps the shared storage.
    localStorage.setItem(SESSION_REFRESHED_AT_KEY, String(nowInMs));
    nowInMs += 300;
    otherTabFinished.open();

    await expect(refreshed).resolves.toBe(true);
    expect(server.sent).toHaveLength(0);
  });

  test("a 401 end to end goes through the lock as well", async () => {
    const request: MockFunction = getJestMockFunction().mockImplementation(
      async (
        _name: string,
        callback: () => Promise<boolean>,
      ): Promise<boolean> => {
        return await callback();
      },
    );

    setNavigatorLocks({ request: request } as unknown as LockManager);

    const url: string = endpoint("/incident/get-list");

    server
      .on(HTTPMethod.POST, url, [{ status: 401 }, { status: 200 }])
      .on(HTTPMethod.POST, REFRESH_URL, [{ status: 200 }]);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await BaseAPI.post<JSONObject>({ url: URL.fromString(url) });

    expect(response.statusCode).toBe(200);
    expect(request).toHaveBeenCalledWith(
      "oneuptime-session-refresh:dashboard",
      expect.any(Function),
    );
  });

  test("without Web Locks the refresh simply runs", async () => {
    setNavigatorLocks(undefined);

    expect(
      (window.navigator as unknown as { locks?: LockManager }).locks,
    ).toBeUndefined();

    server.on(HTTPMethod.POST, REFRESH_URL, [{ status: 200 }]);

    await expect(BaseAPI.refreshSession()).resolves.toBe(true);

    expect(refreshRequests()).toHaveLength(1);
  });

  test("a lock manager without request() is treated as no lock manager", async () => {
    setNavigatorLocks({} as unknown as LockManager);

    server.on(HTTPMethod.POST, REFRESH_URL, [{ status: 200 }]);

    await expect(BaseAPI.refreshSession()).resolves.toBe(true);

    expect(refreshRequests()).toHaveLength(1);
  });
});

/*
 * Subclasses: the status page and the public dashboard extend BaseAPI and swap
 * WHERE the session is refreshed, and under WHICH name. The single flight is
 * keyed by that name, not by class - two classes refreshing one session must
 * share one refresh, and two sessions must never wait on each other.
 */
describe("Sessions are named, and the name is what is shared", () => {
  const OTHER_REFRESH_URL: string =
    "https://status.example.com/status-page-identity-api/refresh-token/abc";

  class SameSessionAPI extends BaseAPI {}

  class OtherSessionAPI extends BaseAPI {
    protected static override getRefreshSessionUrl(): URL | null {
      return URL.fromString(OTHER_REFRESH_URL);
    }

    protected static override getSessionName(): string {
      return "status-page-abc";
    }
  }

  class NoSessionAPI extends BaseAPI {
    protected static override getRefreshSessionUrl(): URL | null {
      return null;
    }
  }

  test("two classes on the same session share one in-flight refresh", async () => {
    const refreshGate: Gate = createGate();

    server.on(HTTPMethod.POST, REFRESH_URL, [
      { status: 200, gate: refreshGate.promise },
    ]);

    const results: Promise<Array<boolean>> = Promise.all([
      BaseAPI.refreshSession(),
      SameSessionAPI.refreshSession(),
    ]);

    await settle();

    refreshGate.open();

    await expect(results).resolves.toEqual([true, true]);
    expect(refreshRequests()).toHaveLength(1);
  });

  test("a different session refreshes on its own, at its own URL, under its own stamp", async () => {
    const refreshGate: Gate = createGate();

    server
      .on(HTTPMethod.POST, REFRESH_URL, [
        { status: 200, gate: refreshGate.promise },
      ])
      .on(HTTPMethod.POST, OTHER_REFRESH_URL, [{ status: 200 }]);

    const dashboard: Promise<boolean> = BaseAPI.refreshSession();

    // The status page does not wait behind the dashboard's slow refresh.
    await expect(OtherSessionAPI.refreshSession()).resolves.toBe(true);

    expect(localStorage.getItem("session-refreshed-at:status-page-abc")).toBe(
      String(nowInMs),
    );
    expect(localStorage.getItem(SESSION_REFRESHED_AT_KEY)).toBeNull();

    refreshGate.open();

    await expect(dashboard).resolves.toBe(true);

    expect(refreshRequests()).toHaveLength(1);
    expect(server.requestsTo(HTTPMethod.POST, OTHER_REFRESH_URL)).toHaveLength(
      1,
    );
  });

  test("a class with no refresh URL reports false without a request", async () => {
    await expect(NoSessionAPI.refreshSession()).resolves.toBe(false);

    expect(server.sent).toHaveLength(0);
  });

  test("and its 401s go straight to its error handling", async () => {
    const url: string = endpoint("/dashboard/view");

    server.on(HTTPMethod.GET, url, [{ status: 401 }]);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await NoSessionAPI.get<JSONObject>({ url: URL.fromString(url) });

    expect(response.statusCode).toBe(401);
    expect(server.sent).toHaveLength(1);
    expect(logoutSpy).toHaveBeenCalledTimes(1);
    expect(navigatedRoutes()).toEqual([LOGIN_ROUTE]);
  });
});

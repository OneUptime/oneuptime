// Must stay the first import: it gives the browser clients below a page to load on.
import {
  DEFAULT_PAGE_URL,
  ONEUPTIME_ORIGIN,
  clearBrowserStorage,
  setNavigatorLocks,
  setPageUrl,
} from "./BrowserSessionHarness";
import StatusPageAPI from "../../FeatureSet/StatusPage/src/Utils/API";
import StatusPageUtil from "../../FeatureSet/StatusPage/src/Utils/StatusPage";
import StatusPageUser from "../../FeatureSet/StatusPage/src/Utils/User";
import FakeAxiosServer, {
  FakeTransport,
  Gate,
  SentRequest,
  createGate,
  settle,
} from "Common/Tests/UI/Utils/API/FakeAxiosServer";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { IDENTITY_URL } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import axios from "Common/node_modules/axios";

/*
 * Common's API client is loaded from packages/Common, so the axios it calls is
 * Common's copy, not App's - mock that one, by path.
 */
jest.mock("Common/node_modules/axios", () => {
  // Keep the real helpers (axios.isAxiosError, AxiosError) and fake only the call.
  return Object.assign(
    jest.fn(),
    jest.requireActual("Common/node_modules/axios"),
  );
});

/*
 * A PRIVATE STATUS PAGE'S SESSION, REFRESHED WHERE ITS COOKIES LIVE.
 *
 * A private status page on a custom domain (status.example.com) keeps its
 * session cookies on that domain. Its API client used to refresh at
 * IDENTITY_URL - the OneUptime host - where the browser sends none of them, so
 * every refresh failed and every reader was logged out when the 15-minute
 * access token lapsed. It now inherits BaseAPI's refresh and only says WHERE:
 * the page's own origin, /status-page-identity-api/refresh-token/<id>, which
 * every host proxies to the identity service. And it names the session after
 * the page, so its single flight, cross-tab lock and "recently refreshed"
 * stamp are its own.
 *
 * These run the real StatusPage API class through the real BaseAPI and
 * Common/Utils/API, with a scripted server in place of axios.
 */

const mockedAxios: FakeTransport = axios as unknown as FakeTransport;

const STATUS_PAGE_ID: string = "11111111-1111-4111-8111-111111111111";

const OTHER_STATUS_PAGE_ID: string = "22222222-2222-4222-8222-222222222222";

const PAGE_ORIGIN: string = new globalThis.URL(DEFAULT_PAGE_URL).origin;

type PageRouteFunction = (path: string) => string;

const pageRoute: PageRouteFunction = (path: string): string => {
  return `${PAGE_ORIGIN}/status-page-identity-api${path}`;
};

const REFRESH_URL: string = pageRoute(`/refresh-token/${STATUS_PAGE_ID}`);

const LOGOUT_URL: string = pageRoute(`/logout/${STATUS_PAGE_ID}`);

const DASHBOARD_REFRESH_URL: string = URL.fromString(IDENTITY_URL.toString())
  .addRoute("/refresh-token")
  .toString();

const STATUS_PAGE_API_URL: string = `${PAGE_ORIGIN}/status-page-api/overview/${STATUS_PAGE_ID}`;

let server: FakeAxiosServer;

let statusPageId: string | null = STATUS_PAGE_ID;

let navigateSpy: jest.SpiedFunction<typeof Navigation.navigate>;

let currentRouteSpy: jest.SpiedFunction<typeof Navigation.getCurrentRoute>;

type RequestsToFunction = (url: string) => Array<SentRequest>;

const postsTo: RequestsToFunction = (url: string): Array<SentRequest> => {
  return server.requestsTo(HTTPMethod.POST, url);
};

beforeEach(() => {
  clearBrowserStorage();
  setNavigatorLocks(undefined);

  server = new FakeAxiosServer(mockedAxios);

  statusPageId = STATUS_PAGE_ID;

  jest
    .spyOn(StatusPageUtil, "getStatusPageId")
    .mockImplementation((): ObjectID | null => {
      return statusPageId ? new ObjectID(statusPageId) : null;
    });

  navigateSpy = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {});

  currentRouteSpy = jest
    .spyOn(Navigation, "getCurrentRoute")
    .mockReturnValue(new Route("/incidents"));
});

afterEach(async () => {
  // Let any logout the handler fired without awaiting reach the fake first.
  await settle();

  mockedAxios.mockReset();
  jest.restoreAllMocks();
  setNavigatorLocks(undefined);
  setPageUrl(DEFAULT_PAGE_URL);
  clearBrowserStorage();
});

describe("Status page: a lapsed session is refreshed on the page's own origin", () => {
  test("a 401 refreshes at <page origin>/status-page-identity-api/refresh-token/<id> and replays", async () => {
    StatusPageUtil.setIsPrivateStatusPage(true);

    server
      .on(HTTPMethod.POST, STATUS_PAGE_API_URL, [
        { status: 401 },
        { status: 200, data: { incidents: [] } },
      ])
      .on(HTTPMethod.POST, REFRESH_URL, [{ status: 200 }]);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await StatusPageAPI.post<JSONObject>({
        url: URL.fromString(STATUS_PAGE_API_URL),
      });

    expect(response.statusCode).toBe(200);
    expect(response.data).toEqual({ incidents: [] });

    expect(
      server.sent.map((request: SentRequest): string => {
        return request.url;
      }),
    ).toEqual([STATUS_PAGE_API_URL, REFRESH_URL, STATUS_PAGE_API_URL]);

    // Not the OneUptime host, where this page's cookies are never sent.
    expect(REFRESH_URL.startsWith("https://status.example.com/")).toBe(true);
    expect(DASHBOARD_REFRESH_URL).toBe(
      `${ONEUPTIME_ORIGIN}/identity/refresh-token`,
    );
    for (const request of server.sent) {
      expect(request.url.startsWith(ONEUPTIME_ORIGIN)).toBe(false);
    }

    // The refresh names the page it is for, like every status page request.
    expect(postsTo(REFRESH_URL)[0]!.headers["status-page-id"]).toBe(
      STATUS_PAGE_ID,
    );

    expect(postsTo(LOGOUT_URL)).toHaveLength(0);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  test("the session is named after the page: its stamp is 'session-refreshed-at:status-page-<id>'", async () => {
    server.on(HTTPMethod.POST, REFRESH_URL, [{ status: 200 }]);

    await expect(StatusPageAPI.refreshSession()).resolves.toBe(true);

    expect(
      localStorage.getItem(
        `session-refreshed-at:status-page-${STATUS_PAGE_ID}`,
      ),
    ).not.toBeNull();
    // The dashboard's session is a different session, and is left alone.
    expect(localStorage.getItem("session-refreshed-at:dashboard")).toBeNull();
  });

  test("and its cross-tab lock is the page's, not the dashboard's", async () => {
    const lockNames: Array<string> = [];

    setNavigatorLocks({
      request: async (
        name: string,
        callback: () => Promise<boolean>,
      ): Promise<boolean> => {
        lockNames.push(name);
        return await callback();
      },
    });

    server.on(HTTPMethod.POST, REFRESH_URL, [{ status: 200 }]);

    await expect(StatusPageAPI.refreshSession()).resolves.toBe(true);

    expect(lockNames).toEqual([
      `oneuptime-session-refresh:status-page-${STATUS_PAGE_ID}`,
    ]);
  });

  test("concurrent 401s on the page share one refresh", async () => {
    StatusPageUtil.setIsPrivateStatusPage(true);

    const refreshGate: Gate = createGate();

    const urls: Array<string> = ["incidents", "announcements", "overview"].map(
      (resource: string): string => {
        return `${PAGE_ORIGIN}/status-page-api/${resource}/${STATUS_PAGE_ID}`;
      },
    );

    for (const url of urls) {
      server.on(HTTPMethod.POST, url, [{ status: 401 }, { status: 200 }]);
    }

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
          return StatusPageAPI.post<JSONObject>({ url: URL.fromString(url) });
        },
      ),
    );

    await settle();

    expect(postsTo(REFRESH_URL)).toHaveLength(1);

    refreshGate.open();

    const responses: Array<HTTPResponse<JSONObject> | HTTPErrorResponse> =
      await pending;

    expect(
      responses.map(
        (response: HTTPResponse<JSONObject> | HTTPErrorResponse): number => {
          return response.statusCode;
        },
      ),
    ).toEqual([200, 200, 200]);
    expect(postsTo(REFRESH_URL)).toHaveLength(1);
  });

  /*
   * Two status pages open in two tabs of the same browser are two sessions.
   * One page's recent refresh says nothing about the other's cookies.
   */
  test("another page's recent refresh is not this page's", async () => {
    const otherRefreshUrl: string = pageRoute(
      `/refresh-token/${OTHER_STATUS_PAGE_ID}`,
    );

    server
      .on(HTTPMethod.POST, REFRESH_URL, [{ status: 200 }])
      .on(HTTPMethod.POST, otherRefreshUrl, [{ status: 200 }]);

    await expect(StatusPageAPI.refreshSession()).resolves.toBe(true);

    statusPageId = OTHER_STATUS_PAGE_ID;

    await expect(StatusPageAPI.refreshSession()).resolves.toBe(true);

    expect(postsTo(REFRESH_URL)).toHaveLength(1);
    expect(postsTo(otherRefreshUrl)).toHaveLength(1);
  });
});

describe("Status page: when there is nothing to refresh", () => {
  test("with no status page id, a 401 makes no refresh request at all", async () => {
    statusPageId = null;

    const url: string = `${PAGE_ORIGIN}/status-page-api/overview`;

    server.on(HTTPMethod.POST, url, [{ status: 401 }]);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await StatusPageAPI.post<JSONObject>({ url: URL.fromString(url) });

    expect(response.statusCode).toBe(401);
    expect(server.sent).toHaveLength(1);
    expect(postsTo(DASHBOARD_REFRESH_URL)).toHaveLength(0);
  });

  test("with no status page id, refreshSession() is false without a request", async () => {
    statusPageId = null;

    await expect(StatusPageAPI.refreshSession()).resolves.toBe(false);

    expect(server.sent).toHaveLength(0);
  });
});

describe("Status page: a refresh the server refuses", () => {
  test("a private page logs the reader out on its own origin and goes to its login page", async () => {
    StatusPageUtil.setIsPrivateStatusPage(true);

    server
      .on(HTTPMethod.POST, STATUS_PAGE_API_URL, [{ status: 401 }])
      .on(HTTPMethod.POST, REFRESH_URL, [{ status: 401 }])
      .on(HTTPMethod.POST, LOGOUT_URL, [{ status: 200 }, { status: 200 }]);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await StatusPageAPI.post<JSONObject>({
        url: URL.fromString(STATUS_PAGE_API_URL),
      });

    await settle();

    expect(response.statusCode).toBe(401);
    expect(postsTo(STATUS_PAGE_API_URL)).toHaveLength(1);

    // The logout goes where the page's cookies are - and nowhere else.
    expect(postsTo(LOGOUT_URL).length).toBeGreaterThan(0);
    for (const request of server.sent) {
      expect(request.url.startsWith(PAGE_ORIGIN)).toBe(true);
    }

    expect(navigateSpy).toHaveBeenCalledWith(new Route("/login"), {
      forceNavigate: true,
    });
  });

  test("on its own login page, the reader is logged out but not navigated", async () => {
    StatusPageUtil.setIsPrivateStatusPage(true);
    currentRouteSpy.mockReturnValue(new Route("/login"));

    server
      .on(HTTPMethod.POST, STATUS_PAGE_API_URL, [{ status: 401 }])
      .on(HTTPMethod.POST, REFRESH_URL, [{ status: 401 }])
      .on(HTTPMethod.POST, LOGOUT_URL, [{ status: 200 }, { status: 200 }]);

    await StatusPageAPI.post<JSONObject>({
      url: URL.fromString(STATUS_PAGE_API_URL),
    });

    await settle();

    expect(postsTo(LOGOUT_URL).length).toBeGreaterThan(0);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  /*
   * A public page has no session to lose: a stray 401 is shown where it
   * happened, with no logout and no trip to a login page the page does not
   * have.
   */
  test("a public page keeps the reader where they are", async () => {
    StatusPageUtil.setIsPrivateStatusPage(false);

    server
      .on(HTTPMethod.POST, STATUS_PAGE_API_URL, [{ status: 401 }])
      .on(HTTPMethod.POST, REFRESH_URL, [{ status: 401 }]);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await StatusPageAPI.post<JSONObject>({
        url: URL.fromString(STATUS_PAGE_API_URL),
      });

    await settle();

    expect(response.statusCode).toBe(401);
    expect(postsTo(LOGOUT_URL)).toHaveLength(0);
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});

describe("Status page: logging out", () => {
  test("User.logout POSTs <page origin>/status-page-identity-api/logout/<id>", async () => {
    StatusPageUser.setUserId(
      new ObjectID(STATUS_PAGE_ID),
      new ObjectID("33333333-3333-4333-8333-333333333333"),
    );

    server.on(HTTPMethod.POST, LOGOUT_URL, [{ status: 200 }]);

    await StatusPageUser.logout(new ObjectID(STATUS_PAGE_ID));

    expect(
      server.sent.map((request: SentRequest): string => {
        return `${request.method.toUpperCase()} ${request.url}`;
      }),
    ).toEqual([`POST ${LOGOUT_URL}`]);

    expect(localStorage.getItem(`${STATUS_PAGE_ID}user_id`)).toBeNull();
  });

  /*
   * The logout runs from inside the error handler, so it goes through the
   * bare client on purpose: a logout that could itself refresh-and-replay or
   * log out again would recurse.
   */
  test("a logout refused 401 is not refreshed", async () => {
    server.on(HTTPMethod.POST, LOGOUT_URL, [{ status: 401 }]);

    await StatusPageUser.logout(new ObjectID(STATUS_PAGE_ID));

    expect(server.sent).toHaveLength(1);
    expect(postsTo(REFRESH_URL)).toHaveLength(0);
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});

/*
 * The preview of a status page is served from the OneUptime host itself, under
 * /status-page/<id>. Same rule: refresh on the origin the page was served
 * from. The page URLs are read once, when the client's Config is first loaded,
 * so this loads a fresh copy of the client on the preview page.
 */
describe("Status page: the preview on the OneUptime host", () => {
  const PREVIEW_ORIGIN: string = ONEUPTIME_ORIGIN;

  const PREVIEW_REFRESH_URL: string = `${PREVIEW_ORIGIN}/status-page-identity-api/refresh-token/${STATUS_PAGE_ID}`;

  const PREVIEW_API_URL: string = `${PREVIEW_ORIGIN}/status-page-api/overview/${STATUS_PAGE_ID}`;

  // The route the client used to refresh at, before it refreshed on the page's origin.
  const OLD_REFRESH_URL: string = URL.fromString(IDENTITY_URL.toString())
    .addRoute(`/status-page/refresh-token/${STATUS_PAGE_ID}`)
    .toString();

  let previewAPI!: typeof StatusPageAPI;
  let previewUtil!: typeof StatusPageUtil;
  let previewNavigation!: typeof Navigation;

  beforeEach(() => {
    setPageUrl(`${PREVIEW_ORIGIN}/status-page/${STATUS_PAGE_ID}/incidents`);

    jest.isolateModules(() => {
      previewAPI = (
        jest.requireActual("../../FeatureSet/StatusPage/src/Utils/API") as {
          default: typeof StatusPageAPI;
        }
      ).default;

      previewUtil = (
        jest.requireActual(
          "../../FeatureSet/StatusPage/src/Utils/StatusPage",
        ) as { default: typeof StatusPageUtil }
      ).default;

      previewNavigation = (
        jest.requireActual("Common/UI/Utils/Navigation") as {
          default: typeof Navigation;
        }
      ).default;
    });

    jest
      .spyOn(previewUtil, "getStatusPageId")
      .mockReturnValue(new ObjectID(STATUS_PAGE_ID));

    jest
      .spyOn(previewNavigation, "navigate")
      .mockImplementation((): void => {});

    jest
      .spyOn(previewNavigation, "getCurrentRoute")
      .mockReturnValue(new Route(`/status-page/${STATUS_PAGE_ID}/incidents`));

    previewUtil.setIsPrivateStatusPage(true);
  });

  test("a 401 refreshes on the preview host's origin and replays", async () => {
    server
      .on(HTTPMethod.POST, PREVIEW_API_URL, [{ status: 401 }, { status: 200 }])
      .on(HTTPMethod.POST, PREVIEW_REFRESH_URL, [{ status: 200 }]);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await previewAPI.post<JSONObject>({
        url: URL.fromString(PREVIEW_API_URL),
      });

    expect(response.statusCode).toBe(200);
    expect(postsTo(PREVIEW_REFRESH_URL)).toHaveLength(1);
    expect(OLD_REFRESH_URL).toBe(
      `${ONEUPTIME_ORIGIN}/identity/status-page/refresh-token/${STATUS_PAGE_ID}`,
    );
    expect(postsTo(OLD_REFRESH_URL)).toHaveLength(0);
  });

  test("a refused refresh sends the reader to the preview's own login page", async () => {
    server
      .on(HTTPMethod.POST, PREVIEW_API_URL, [{ status: 401 }])
      .on(HTTPMethod.POST, PREVIEW_REFRESH_URL, [{ status: 401 }])
      .on(
        HTTPMethod.POST,
        `${PREVIEW_ORIGIN}/status-page-identity-api/logout/${STATUS_PAGE_ID}`,
        [{ status: 200 }, { status: 200 }],
      );

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await previewAPI.post<JSONObject>({
        url: URL.fromString(PREVIEW_API_URL),
      });

    await settle();

    expect(response.statusCode).toBe(401);
    expect(previewNavigation.navigate).toHaveBeenCalledWith(
      new Route(`/status-page/${STATUS_PAGE_ID}/login`),
      { forceNavigate: true },
    );
  });
});

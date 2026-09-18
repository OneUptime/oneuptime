// Must stay the first import: it gives the browser clients below a page to load on.
import {
  DEFAULT_PAGE_URL,
  clearBrowserStorage,
  setPageUrl,
} from "../StatusPage/BrowserSessionHarness";
import PublicDashboardAPI from "../../FeatureSet/PublicDashboard/src/Utils/API";
import PublicDashboardUtil from "../../FeatureSet/PublicDashboard/src/Utils/PublicDashboard";
import FakeAxiosServer, {
  FakeTransport,
  SentRequest,
  settle,
} from "Common/Tests/UI/Utils/API/FakeAxiosServer";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
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
 * A PUBLIC DASHBOARD HAS NO SESSION TO REFRESH.
 *
 * Its only credential is the master-password cookie, and a 401 means "enter it
 * again". Inheriting the Dashboard's refresh sent a viewer's 401 to
 * /identity/refresh-token; for a viewer with no Dashboard session that refresh
 * fails, and a failed refresh answers by clearing every cookie on the host -
 * the master-password cookie included. So its refresh URL is null: a 401 makes
 * no refresh request and goes straight to the master-password page.
 *
 * These run the real PublicDashboard API class through the real BaseAPI and
 * Common/Utils/API, with a scripted server in place of axios - which answers
 * nothing but the requests each test expects, so a refresh request to anywhere
 * fails the test.
 */

const mockedAxios: FakeTransport = axios as unknown as FakeTransport;

const DASHBOARD_ID: string = "44444444-4444-4444-8444-444444444444";

const PAGE_ORIGIN: string = "https://dashboards.example.com";

const DASHBOARD_API_URL: string = `${PAGE_ORIGIN}/public-dashboard-api/view/${DASHBOARD_ID}`;

let server: FakeAxiosServer;

let navigateSpy: jest.SpiedFunction<typeof Navigation.navigate>;

let currentRouteSpy: jest.SpiedFunction<typeof Navigation.getCurrentRoute>;

type RequestFunction = () => Promise<
  HTTPResponse<JSONObject> | HTTPErrorResponse
>;

const requestDashboard: RequestFunction = async (): Promise<
  HTTPResponse<JSONObject> | HTTPErrorResponse
> => {
  return await PublicDashboardAPI.post<JSONObject>({
    url: URL.fromString(DASHBOARD_API_URL),
  });
};

beforeEach(() => {
  clearBrowserStorage();
  setPageUrl(`${PAGE_ORIGIN}/`);

  server = new FakeAxiosServer(mockedAxios);

  jest
    .spyOn(PublicDashboardUtil, "getDashboardId")
    .mockReturnValue(new ObjectID(DASHBOARD_ID));

  navigateSpy = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {});

  currentRouteSpy = jest
    .spyOn(Navigation, "getCurrentRoute")
    .mockReturnValue(new Route("/"));
});

afterEach(async () => {
  await settle();

  mockedAxios.mockReset();
  jest.restoreAllMocks();
  setPageUrl(DEFAULT_PAGE_URL);
  clearBrowserStorage();
});

describe("Public dashboard: a 401 is never a session to refresh", () => {
  test("a 401 makes no refresh request and goes to the master-password page", async () => {
    PublicDashboardUtil.setRequiresMasterPassword(true);
    PublicDashboardUtil.setMasterPasswordValidated(true);

    server.on(HTTPMethod.POST, DASHBOARD_API_URL, [{ status: 401 }]);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await requestDashboard();

    // The caller gets its 401, and it is the only request that was made.
    expect(response).toBeInstanceOf(HTTPErrorResponse);
    expect(response.statusCode).toBe(401);
    expect(
      server.sent.map((request: SentRequest): string => {
        return `${request.method.toUpperCase()} ${request.url}`;
      }),
    ).toEqual([`POST ${DASHBOARD_API_URL}`]);

    // Its "logout" is forgetting that the password was entered...
    expect(PublicDashboardUtil.isMasterPasswordValidated()).toBe(false);

    // ...and its login page is the master-password page.
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledWith(new Route("/master-password"), {
      forceNavigate: true,
    });
  });

  test("the preview of a protected dashboard goes to the preview's master-password page", async () => {
    setPageUrl(`${PAGE_ORIGIN}/public-dashboard/${DASHBOARD_ID}/view`);
    PublicDashboardUtil.setRequiresMasterPassword(true);

    server.on(HTTPMethod.POST, DASHBOARD_API_URL, [{ status: 401 }]);

    await requestDashboard();

    expect(server.sent).toHaveLength(1);
    expect(navigateSpy).toHaveBeenCalledWith(
      new Route(`/public-dashboard/${DASHBOARD_ID}/master-password`),
      { forceNavigate: true },
    );
  });

  test("a dashboard with no master password goes back to its overview", async () => {
    PublicDashboardUtil.setRequiresMasterPassword(false);
    currentRouteSpy.mockReturnValue(new Route("/not-found"));

    server.on(HTTPMethod.POST, DASHBOARD_API_URL, [{ status: 401 }]);

    await requestDashboard();

    expect(server.sent).toHaveLength(1);
    expect(navigateSpy).toHaveBeenCalledWith(new Route("/"), {
      forceNavigate: true,
    });
  });

  /*
   * With no master password the "login page" is the overview, "/" - the page
   * the viewer is usually on. Force-navigating there from there is a reload,
   * whose requests 401 again: the loop the guard exists to break.
   */
  test("on the overview of a dashboard with no master password, it does not reload itself", async () => {
    PublicDashboardUtil.setRequiresMasterPassword(false);
    currentRouteSpy.mockReturnValue(new Route("/"));

    server.on(HTTPMethod.POST, DASHBOARD_API_URL, [{ status: 401 }]);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await requestDashboard();

    expect(response.statusCode).toBe(401);
    expect(server.sent).toHaveLength(1);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  /*
   * The loop guard applies here too: a master-password page whose own request
   * 401s must not force-navigate to itself and reload forever.
   */
  test("on the master-password page itself, it does not navigate again", async () => {
    PublicDashboardUtil.setRequiresMasterPassword(true);
    currentRouteSpy.mockReturnValue(new Route("/master-password"));

    server.on(HTTPMethod.POST, DASHBOARD_API_URL, [{ status: 401 }]);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await requestDashboard();

    expect(response.statusCode).toBe(401);
    expect(server.sent).toHaveLength(1);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  test("concurrent 401s make no refresh request between them", async () => {
    PublicDashboardUtil.setRequiresMasterPassword(true);

    const urls: Array<string> = ["a", "b", "c"].map(
      (widget: string): string => {
        return `${DASHBOARD_API_URL}/widget-${widget}`;
      },
    );

    for (const url of urls) {
      server.on(HTTPMethod.POST, url, [{ status: 401 }]);
    }

    const responses: Array<HTTPResponse<JSONObject> | HTTPErrorResponse> =
      await Promise.all(
        urls.map(
          (
            url: string,
          ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
            return PublicDashboardAPI.post<JSONObject>({
              url: URL.fromString(url),
            });
          },
        ),
      );

    expect(
      responses.map(
        (response: HTTPResponse<JSONObject> | HTTPErrorResponse): number => {
          return response.statusCode;
        },
      ),
    ).toEqual([401, 401, 401]);
    expect(
      server.sent.map((request: SentRequest): string => {
        return request.url;
      }),
    ).toEqual(urls);
  });

  test("refreshSession() reports false without a request", async () => {
    await expect(PublicDashboardAPI.refreshSession()).resolves.toBe(false);

    expect(server.sent).toHaveLength(0);
    expect(localStorage.getItem("session-refreshed-at:dashboard")).toBeNull();
  });
});

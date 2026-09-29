// Must stay the first import: the client's URLs are built from HOST on load.
import { DASHBOARD_ORIGIN } from "../UI/Utils/API/DashboardHost";
import FakeAxiosServer, {
  FakeTransport,
  SentRequest,
} from "../UI/Utils/API/FakeAxiosServer";
import BaseAPI from "../../UI/Utils/API/API";
import { IDENTITY_URL } from "../../UI/Config";
import Navigation from "../../UI/Utils/Navigation";
import User from "../../UI/Utils/User";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../Types/API/HTTPMethod";
import HTTPResponse from "../../Types/API/HTTPResponse";
import Headers from "../../Types/API/Headers";
import Hostname from "../../Types/API/Hostname";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import APIException from "../../Types/Exception/ApiException";
import { JSONObject } from "../../Types/JSON";
import API, { APIRequestOptions, AuthRetryContext } from "../../Utils/API";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import axios from "axios";

jest.mock("axios", () => {
  // Keep the real helpers (axios.isAxiosError, AxiosError) and fake only the call.
  return Object.assign(jest.fn(), jest.requireActual("axios"));
});

/*
 * AN API INSTANCE IS ITS CLASS.
 *
 * `new BaseAPI(protocol, hostname).get(...)` used to forward to `API.get` - the
 * base class, by name - so a request made through an INSTANCE silently lost
 * everything its class adds: BaseAPI's refresh-and-replay on a 401, its error
 * handling, its headers. A lapsed session on such a call surfaced as a bare 401
 * where the same request made through `BaseAPI.get` recovered on its own.
 *
 * The instance methods now dispatch through `this.constructor`. These tests make
 * the class of the instance observable - which refresh ran, which headers went
 * out, which error handler saw the failure - for every instance method.
 */

const mockedAxios: FakeTransport = axios as unknown as FakeTransport;

const REFRESH_URL: string = URL.fromString(IDENTITY_URL.toString())
  .addRoute("/refresh-token")
  .toString();

const RESOURCE_URL: string = `${DASHBOARD_ORIGIN}/api/monitor/abc`;

let server: FakeAxiosServer;

let logoutSpy: jest.SpiedFunction<typeof User.logout>;

let navigateSpy: jest.SpiedFunction<typeof Navigation.navigate>;

type InstanceMethod = "get" | "delete" | "head" | "put" | "patch";

const INSTANCE_METHODS: Array<[InstanceMethod, HTTPMethod]> = [
  ["get", HTTPMethod.GET],
  ["delete", HTTPMethod.DELETE],
  ["head", HTTPMethod.HEAD],
  ["put", HTTPMethod.PUT],
  ["patch", HTTPMethod.PATCH],
];

type CallInstanceFunction = (
  api: API,
  method: InstanceMethod,
  options: APIRequestOptions,
) => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse>;

const callInstance: CallInstanceFunction = async (
  api: API,
  method: InstanceMethod,
  options: APIRequestOptions,
): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
  switch (method) {
    case "get":
      return await api.get<JSONObject>(options);
    case "delete":
      return await api.delete<JSONObject>(options);
    case "head":
      return await api.head<JSONObject>(options);
    case "put":
      return await api.put<JSONObject>(options);
    case "patch":
      return await api.patch<JSONObject>(options);
  }
};

beforeEach(() => {
  localStorage.clear();

  server = new FakeAxiosServer(mockedAxios);

  logoutSpy = jest.spyOn(User, "logout").mockImplementation((): void => {});

  navigateSpy = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {});

  jest
    .spyOn(Navigation, "getCurrentRoute")
    .mockReturnValue(new Route("/dashboard/home"));
});

afterEach(() => {
  mockedAxios.mockReset();
  jest.restoreAllMocks();
  localStorage.clear();
});

describe("A BaseAPI instance refreshes a lapsed session like BaseAPI does", () => {
  test.each(INSTANCE_METHODS)(
    "instance %s: a 401 is refreshed and replayed",
    async (method: InstanceMethod, httpMethod: HTTPMethod) => {
      server
        .on(httpMethod, RESOURCE_URL, [
          { status: 401 },
          { status: 200, data: { replayed: true } },
        ])
        .on(HTTPMethod.POST, REFRESH_URL, [{ status: 200 }]);

      const api: BaseAPI = new BaseAPI(
        Protocol.HTTPS,
        new Hostname("oneuptime.example.com"),
      );

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await callInstance(api, method, {
          url: URL.fromString(RESOURCE_URL),
          data: { name: "db" },
        });

      expect(response.statusCode).toBe(200);
      expect(response.data).toEqual({ replayed: true });
      expect(server.requestsTo(HTTPMethod.POST, REFRESH_URL)).toHaveLength(1);
      expect(server.requestsTo(httpMethod, RESOURCE_URL)).toHaveLength(2);
      expect(logoutSpy).not.toHaveBeenCalled();
    },
  );

  test("an instance made with BaseAPI.fromURL is a BaseAPI, and refreshes too", async () => {
    server
      .on(HTTPMethod.GET, RESOURCE_URL, [{ status: 401 }, { status: 200 }])
      .on(HTTPMethod.POST, REFRESH_URL, [{ status: 200 }]);

    const api: BaseAPI = BaseAPI.fromURL(
      URL.fromString(`${DASHBOARD_ORIGIN}/api`),
    );

    expect(api).toBeInstanceOf(BaseAPI);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await api.get<JSONObject>({ url: URL.fromString(RESOURCE_URL) });

    expect(response.statusCode).toBe(200);
    expect(server.requestsTo(HTTPMethod.POST, REFRESH_URL)).toHaveLength(1);
  });

  test("a refused refresh through an instance ends in BaseAPI's logout, not a silent 401", async () => {
    server
      .on(HTTPMethod.GET, RESOURCE_URL, [{ status: 401 }])
      .on(HTTPMethod.POST, REFRESH_URL, [{ status: 401 }]);

    const api: BaseAPI = new BaseAPI(
      Protocol.HTTPS,
      new Hostname("oneuptime.example.com"),
    );

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await api.get<JSONObject>({ url: URL.fromString(RESOURCE_URL) });

    expect(response.statusCode).toBe(401);
    expect(logoutSpy).toHaveBeenCalled();
    expect(navigateSpy).toHaveBeenCalledWith(new Route("/accounts/login"), {
      forceNavigate: true,
    });
  });

  test("BaseAPI's own headers go out on instance requests", async () => {
    localStorage.setItem("project-permissions-hash", "hash-123");

    server.on(HTTPMethod.GET, RESOURCE_URL, [{ status: 200 }]);

    await new BaseAPI(
      Protocol.HTTPS,
      new Hostname("oneuptime.example.com"),
    ).get({ url: URL.fromString(RESOURCE_URL) });

    expect(server.sent[0]!.headers["project-permissions-hash"]).toBe(
      "hash-123",
    );
  });
});

describe("The most-derived class is the one that answers", () => {
  const STATUS_PAGE_REFRESH_URL: string =
    "https://status.example.com/status-page-identity-api/refresh-token/abc";

  class StatusPageLikeAPI extends BaseAPI {
    protected static override getRefreshSessionUrl(): URL | null {
      return URL.fromString(STATUS_PAGE_REFRESH_URL);
    }

    protected static override getSessionName(): string {
      return "status-page-abc";
    }
  }

  test("an instance of a BaseAPI subclass refreshes at the subclass's URL", async () => {
    server
      .on(HTTPMethod.PUT, RESOURCE_URL, [{ status: 401 }, { status: 200 }])
      .on(HTTPMethod.POST, STATUS_PAGE_REFRESH_URL, [{ status: 200 }]);

    const api: StatusPageLikeAPI = new StatusPageLikeAPI(
      Protocol.HTTPS,
      new Hostname("status.example.com"),
    );

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await api.put<JSONObject>({ url: URL.fromString(RESOURCE_URL) });

    expect(response.statusCode).toBe(200);
    expect(
      server.requestsTo(HTTPMethod.POST, STATUS_PAGE_REFRESH_URL),
    ).toHaveLength(1);
    expect(server.requestsTo(HTTPMethod.POST, REFRESH_URL)).toHaveLength(0);
  });

  test("an instance of a plain API subclass uses that subclass's headers, refresh and error handler", async () => {
    const handled: Array<number> = [];
    const refreshedFor: Array<string> = [];

    class CustomAPI extends API {
      public static override getDefaultHeaders(): Headers {
        return { "x-client": "custom" };
      }

      public static override handleError(
        error: HTTPErrorResponse | APIException,
      ): HTTPErrorResponse | APIException {
        if (error instanceof HTTPErrorResponse) {
          handled.push(error.statusCode);
        }

        return error;
      }

      protected static override async tryRefreshAuth(
        context: AuthRetryContext,
      ): Promise<boolean> {
        refreshedFor.push(context.request.url.toString());
        return true;
      }
    }

    server.on(HTTPMethod.PATCH, RESOURCE_URL, [
      { status: 401 },
      { status: 500 },
    ]);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await new CustomAPI(
        Protocol.HTTPS,
        new Hostname("oneuptime.example.com"),
      ).patch<JSONObject>({ url: URL.fromString(RESOURCE_URL) });

    expect(response.statusCode).toBe(500);
    expect(refreshedFor).toEqual([RESOURCE_URL]);
    expect(handled).toEqual([500]);

    for (const request of server.sent) {
      expect(request.headers["x-client"]).toBe("custom");
    }
  });
});

describe("A plain API instance is still the plain client", () => {
  /*
   * The bare client has no session to refresh and no login page to go to.
   * Server-side callers and deliberately-bare browser calls (a status page's
   * logout) depend on a 401 coming straight back.
   */
  test.each(INSTANCE_METHODS)(
    "instance %s: a 401 comes straight back, with no refresh and no logout",
    async (method: InstanceMethod, httpMethod: HTTPMethod) => {
      server.on(httpMethod, RESOURCE_URL, [{ status: 401 }]);

      const api: API = new API(
        Protocol.HTTPS,
        new Hostname("oneuptime.example.com"),
      );

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await callInstance(api, method, { url: URL.fromString(RESOURCE_URL) });

      expect(response).toBeInstanceOf(HTTPErrorResponse);
      expect(response.statusCode).toBe(401);
      expect(
        server.sent.map((request: SentRequest): string => {
          return request.url;
        }),
      ).toEqual([RESOURCE_URL]);
      expect(logoutSpy).not.toHaveBeenCalled();
      expect(navigateSpy).not.toHaveBeenCalled();
    },
  );
});

// Must stay the first import: it gives the browser clients below a page to load on.
import {
  DEFAULT_PAGE_URL,
  ONEUPTIME_ORIGIN,
  clearBrowserStorage,
  setPageUrl,
} from "../StatusPage/BrowserSessionHarness";
import FormAPI from "../../FeatureSet/Accounts/src/Utils/FormAPI";
import FakeAxiosServer, {
  FakeTransport,
  SentRequest,
  settle,
} from "Common/Tests/UI/Utils/API/FakeAxiosServer";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Headers from "Common/Types/API/Headers";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import {
  FORM_PAGE_HEADER,
  FORM_PAGE_HEADER_VALUE,
} from "Common/Types/Form/FormPublic";
import { JSONObject } from "Common/Types/JSON";
import BaseAPI from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import User from "Common/UI/Utils/User";
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
 * THE PUBLIC FORM'S CLIENT NEVER TOUCHES A SESSION.
 *
 * The form page is served from the OneUptime host itself, so a visitor who
 * is signed in to the dashboard carries its session cookies to the form's
 * routes - and so does one whose session has long expired. Through the
 * dashboard's client (BaseAPI) a 401 from those routes would try to refresh
 * that session, then sign the visitor out and force the page over to
 * /accounts/login; a 403 would send them to /accounts/forbidden. Either way
 * the answers they were typing are gone, and a signed-in visitor has lost a
 * session that had nothing to do with the form.
 *
 * These run the real FormAPI through the real BaseAPI and
 * Common/Utils/API, with a scripted server where axios would reach the
 * network. The server answers nothing but the requests each test expects, so
 * a refresh or a logout request fails the test by name. The last test runs
 * the dashboard's own client over the same answer, to show what these guard
 * against is really there.
 */

const mockedAxios: FakeTransport = axios as unknown as FakeTransport;

const SHARE_KEY: string = "8a4f2c1e-3b5d-4c6e-9f70-1a2b3c4d5e6f";

const PAGE_PATH: string = `/accounts/form/${SHARE_KEY}`;

const FORM_URL: string = `${ONEUPTIME_ORIGIN}/api/form/public/${SHARE_KEY}`;

const SUBMIT_URL: string = `${FORM_URL}/submit`;

const REFRESH_URL: string = `${ONEUPTIME_ORIGIN}/identity/refresh-token`;

let server: FakeAxiosServer;

let navigateSpy: jest.SpiedFunction<typeof Navigation.navigate>;

let logoutSpy: jest.SpiedFunction<typeof User.logout>;

type SentRequestsFunction = () => Array<string>;

const sentRequests: SentRequestsFunction = (): Array<string> => {
  return server.sent.map((request: SentRequest): string => {
    return `${request.method.toUpperCase()} ${request.url}`;
  });
};

type ReadFormFunction = () => Promise<
  HTTPResponse<JSONObject> | HTTPErrorResponse
>;

const readForm: ReadFormFunction = async (): Promise<
  HTTPResponse<JSONObject> | HTTPErrorResponse
> => {
  return await FormAPI.get<JSONObject>({
    url: URL.fromString(FORM_URL),
  });
};

const submitForm: ReadFormFunction = async (): Promise<
  HTTPResponse<JSONObject> | HTTPErrorResponse
> => {
  return await FormAPI.post<JSONObject>({
    url: URL.fromString(SUBMIT_URL),
    data: { data: { title: "Checkout is down" } },
  });
};

beforeEach(() => {
  clearBrowserStorage();
  setPageUrl(`${ONEUPTIME_ORIGIN}${PAGE_PATH}`);

  // A visitor who is signed in to the dashboard on this host.
  localStorage.setItem("user_id", "33333333-3333-4333-8333-333333333333");
  localStorage.setItem("user_email", "grace@example.com");

  server = new FakeAxiosServer(mockedAxios);

  navigateSpy = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {});

  logoutSpy = jest.spyOn(User, "logout").mockImplementation((): void => {});
});

afterEach(async () => {
  await settle();

  mockedAxios.mockReset();
  jest.restoreAllMocks();
  setPageUrl(DEFAULT_PAGE_URL);
  clearBrowserStorage();
});

describe("a refusal from the form's routes is the page's to show", () => {
  test.each([401, 405])(
    "%s on reading the form: no refresh, nobody signed out, nowhere to go",
    async (statusCode: number) => {
      server.on(HTTPMethod.GET, FORM_URL, [
        { status: statusCode, data: { message: "Refused" } },
      ]);

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await readForm();

      // The caller gets its answer, and it was the only request made.
      expect(response).toBeInstanceOf(HTTPErrorResponse);
      expect(response.statusCode).toBe(statusCode);
      expect(sentRequests()).toEqual([`GET ${FORM_URL}`]);

      expect(logoutSpy).not.toHaveBeenCalled();
      expect(navigateSpy).not.toHaveBeenCalled();

      // The visitor's session state is untouched.
      expect(localStorage.getItem("user_id")).toBe(
        "33333333-3333-4333-8333-333333333333",
      );
      expect(localStorage.getItem("user_email")).toBe("grace@example.com");
    },
  );

  test.each([401, 403, 404, 405, 429, 500, 503])(
    "%s on submitting: handed back as it came, and nothing else happens",
    async (statusCode: number) => {
      server.on(HTTPMethod.POST, SUBMIT_URL, [
        { status: statusCode, data: { error: "Refused" } },
      ]);

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await submitForm();

      expect(response).toBeInstanceOf(HTTPErrorResponse);
      expect(response.statusCode).toBe(statusCode);
      expect(sentRequests()).toEqual([`POST ${SUBMIT_URL}`]);
      expect(logoutSpy).not.toHaveBeenCalled();
      expect(navigateSpy).not.toHaveBeenCalled();
    },
  );

  test("a 403 does not send the visitor to the forbidden page", async () => {
    server.on(HTTPMethod.GET, FORM_URL, [
      { status: 403, data: { error: "Not from this network" } },
    ]);

    await readForm();

    expect(navigateSpy).not.toHaveBeenCalled();
  });

  test("concurrent 401s make no refresh request between them", async () => {
    server.on(HTTPMethod.GET, FORM_URL, [{ status: 401 }, { status: 401 }]);
    server.on(HTTPMethod.POST, SUBMIT_URL, [{ status: 401 }]);

    const responses: Array<HTTPResponse<JSONObject> | HTTPErrorResponse> =
      await Promise.all([readForm(), readForm(), submitForm()]);

    expect(
      responses.map(
        (response: HTTPResponse<JSONObject> | HTTPErrorResponse): number => {
          return response.statusCode;
        },
      ),
    ).toEqual([401, 401, 401]);
    expect(server.requestsTo(HTTPMethod.POST, REFRESH_URL)).toEqual([]);
    expect(logoutSpy).not.toHaveBeenCalled();
  });

  test("refreshSession() reports false without a request", async () => {
    await expect(FormAPI.refreshSession()).resolves.toBe(false);

    expect(server.sent).toHaveLength(0);
    expect(localStorage.getItem("session-refreshed-at:dashboard")).toBeNull();
  });
});

describe("what the page's client sends", () => {
  test("JSON, with the tenant left empty", async () => {
    server.on(HTTPMethod.GET, FORM_URL, [{ status: 200, data: {} }]);

    await readForm();

    const headers: Headers = server.sent[0]!.headers;

    expect(headers["tenantid"]).toBe("");
    expect(headers["Accept"]).toBe("application/json");
    expect(headers["Content-Type"]).toBe("application/json;charset=UTF-8");
  });

  test("its default headers name no tenant and carry no key", () => {
    const headers: Headers = FormAPI.getDefaultHeaders();

    expect(headers["tenantid"]).toBe("");
    expect(Object.keys(headers)).not.toContain("apikey");
    expect(Object.keys(headers)).not.toContain("projectid");
  });

  /*
   * The server reads a form only for a request carrying the page's own
   * header: another site can have a visitor's browser send that GET - an
   * <img> is enough - but not with a header of its own. Without it, the
   * page could not load a single form.
   */
  test("the form page's own header, reading the form and submitting it", async () => {
    server.on(HTTPMethod.GET, FORM_URL, [{ status: 200, data: {} }]);
    server.on(HTTPMethod.POST, SUBMIT_URL, [{ status: 200, data: {} }]);

    await readForm();
    await submitForm();

    expect(sentRequests()).toEqual([`GET ${FORM_URL}`, `POST ${SUBMIT_URL}`]);

    for (const request of server.sent) {
      expect(request.headers[FORM_PAGE_HEADER]).toBe(FORM_PAGE_HEADER_VALUE);
    }

    expect(FormAPI.getDefaultHeaders()[FORM_PAGE_HEADER]).toBe(
      FORM_PAGE_HEADER_VALUE,
    );
    expect(FORM_PAGE_HEADER).toBe("x-oneuptime-form");
  });

  // The dashboard's client sends no such header: it is the form page's alone.
  test("the dashboard's own client does not send it", () => {
    expect(Object.keys(BaseAPI.getDefaultHeaders())).not.toContain(
      FORM_PAGE_HEADER,
    );
  });
});

describe("where it would send a visitor, were it ever asked", () => {
  test("nowhere: the login and forbidden routes are the page itself", () => {
    const currentRoute: Route = new Route(PAGE_PATH);

    jest.spyOn(Navigation, "getCurrentRoute").mockReturnValue(currentRoute);

    expect(FormAPI.getLoginRoute().toString()).toBe(PAGE_PATH);
    expect(FormAPI.getForbiddenRoute().toString()).toBe(PAGE_PATH);
  });

  test("signing out is a no-op that leaves the visitor's storage alone", () => {
    FormAPI.logoutUser();

    expect(localStorage.getItem("user_email")).toBe("grace@example.com");
    expect(logoutSpy).not.toHaveBeenCalled();
  });

  test("handleError hands the error back and does nothing else", () => {
    const error: HTTPErrorResponse = new HTTPErrorResponse(
      401,
      { message: "Unauthorized" },
      {},
    );

    expect(FormAPI.handleError(error)).toBe(error);
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(logoutSpy).not.toHaveBeenCalled();
  });
});

describe("the guard is real: the dashboard's own client would not have held back", () => {
  test("the same 401 through BaseAPI refreshes, signs out and navigates", async () => {
    server.on(HTTPMethod.GET, FORM_URL, [{ status: 401 }]);
    server.on(HTTPMethod.POST, REFRESH_URL, [{ status: 401 }]);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await BaseAPI.get<JSONObject>({ url: URL.fromString(FORM_URL) });

    expect(response.statusCode).toBe(401);
    expect(sentRequests()).toEqual([`GET ${FORM_URL}`, `POST ${REFRESH_URL}`]);
    // Once for the refused refresh, once for the request itself.
    expect(logoutSpy).toHaveBeenCalled();
    expect(navigateSpy).toHaveBeenCalledWith(new Route("/accounts/login"), {
      forceNavigate: true,
    });
  });
});

import StatusPageUser from "../../../../App/FeatureSet/StatusPage/src/Utils/User";
import { STATUS_PAGE_IDENTITY_API_URL } from "../../../../App/FeatureSet/StatusPage/src/Utils/Config";
import CookieUtil from "../../../Server/Utils/Cookie";
import ObjectID from "../../../Types/ObjectID";
import SignOutRequest from "../../../UI/Utils/SignOutRequest";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A STATUS PAGE'S SIGN-OUT IS SENT WHERE ITS SIGN-OUT COOKIE GOES
 * (issue #8671).
 *
 * After a renewal whose answer was lost, a status page's sign-out names its
 * session by the page's sign-out cookie, which the server sets on one path
 * only - /status-page-identity-api/logout/<page>
 * (CookieUtil.getStatusPageSessionSignOutPath) - so no other request
 * carries it. A browser sends a cookie only to a path that matches its own,
 * so the page must post its sign-out to exactly that path, on the host that
 * serves the page: the host its cookies are on, a custom domain included.
 * The real UserUtil.logout() of the status page; only the page's fetch,
 * which the sign-out is sent with (UI/Utils/SignOutRequest, issue #9508),
 * is answered here.
 */

const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

type FetchAnswer = (address: string, init: RequestInit) => Promise<Response>;

let fetchSpy: jest.Mock<FetchAnswer>;

beforeEach(() => {
  window.localStorage.clear();
  SignOutRequest.forgetSignOutsOnTheirWayForTests();

  fetchSpy = jest.fn<FetchAnswer>((): Promise<Response> => {
    return Promise.resolve({ ok: true, status: 200 } as Response);
  });

  Object.defineProperty(window, "fetch", {
    configurable: true,
    writable: true,
    value: fetchSpy,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  SignOutRequest.forgetSignOutsOnTheirWayForTests();
  Object.defineProperty(window, "fetch", {
    configurable: true,
    writable: true,
    value: undefined,
  });
});

// The address the sign-out was sent to, as the browser parses it.
function signOutAddress(): globalThis.URL {
  expect(fetchSpy.mock.calls).toHaveLength(1);

  return new globalThis.URL(fetchSpy.mock.calls[0]![0]);
}

describe("where a status page signs its reader out", () => {
  test("it posts to the one path the page's sign-out cookie is sent to", async () => {
    await StatusPageUser.logout(STATUS_PAGE_ID);

    // The path the browser asks for, as it parses the address it is handed.
    const requestPath: string = signOutAddress().pathname;

    expect(fetchSpy.mock.calls[0]![1]).toEqual(
      expect.objectContaining({ method: "POST", keepalive: true }),
    );
    expect(requestPath).toBe(
      CookieUtil.getStatusPageSessionSignOutPath(STATUS_PAGE_ID),
    );
    expect(requestPath).toBe(
      `/status-page-identity-api/logout/${STATUS_PAGE_ID.toString()}`,
    );
  });

  test("on the host that serves the page, where its cookies are", async () => {
    await StatusPageUser.logout(STATUS_PAGE_ID);

    const host: string = signOutAddress().host;

    expect(host).toBe(window.location.host);
    expect(host).toBe(STATUS_PAGE_IDENTITY_API_URL.hostname.toString());
  });
});

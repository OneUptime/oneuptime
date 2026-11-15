import StatusPageUser from "../../../../App/FeatureSet/StatusPage/src/Utils/User";
import { STATUS_PAGE_IDENTITY_API_URL } from "../../../../App/FeatureSet/StatusPage/src/Utils/Config";
import CookieUtil from "../../../Server/Utils/Cookie";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../Utils/API";
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
 * The real UserUtil.logout() of the status page; only the call to the
 * server is answered here.
 */

const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

let post: jest.SpiedFunction<typeof API.post>;

beforeEach(() => {
  window.localStorage.clear();
  post = jest
    .spyOn(API, "post")
    .mockResolvedValue(new HTTPResponse<JSONObject>(200, {}, {}));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("where a status page signs its reader out", () => {
  test("it posts to the one path the page's sign-out cookie is sent to", async () => {
    await StatusPageUser.logout(STATUS_PAGE_ID);

    expect(post).toHaveBeenCalledTimes(1);

    const url: URL = (post.mock.calls[0]![0] as { url: URL }).url;
    // The path the browser asks for, as it parses the address it is handed.
    const requestPath: string = new globalThis.URL(url.toString()).pathname;

    expect(requestPath).toBe(
      CookieUtil.getStatusPageSessionSignOutPath(STATUS_PAGE_ID),
    );
    expect(requestPath).toBe(
      `/status-page-identity-api/logout/${STATUS_PAGE_ID.toString()}`,
    );
  });

  test("on the host that serves the page, where its cookies are", async () => {
    await StatusPageUser.logout(STATUS_PAGE_ID);

    const url: URL = (post.mock.calls[0]![0] as { url: URL }).url;

    expect(url.hostname.toString()).toBe(window.location.host);
    expect(url.hostname.toString()).toBe(
      STATUS_PAGE_IDENTITY_API_URL.hostname.toString(),
    );
  });
});

import StatusPageAPI from "../../../../App/FeatureSet/StatusPage/src/Utils/API";
import StatusPageUtil from "../../../../App/FeatureSet/StatusPage/src/Utils/StatusPage";
import StatusPageUser from "../../../../App/FeatureSet/StatusPage/src/Utils/User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import CookieName from "../../../Types/CookieName";
import ObjectID from "../../../Types/ObjectID";
import LocalStorage from "../../../UI/Utils/LocalStorage";
import Navigation from "../../../UI/Utils/Navigation";
import DashboardUser from "../../../UI/Utils/User";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const STATUS_PAGE_ID: string = "22222222-2222-4222-8222-222222222222";
const PREVIEW_PATH: string = `/status-page/${STATUS_PAGE_ID}/subscribe/email`;

type SetUrlFunction = (url: string) => void;

interface RecordedSpy {
  mock: { calls: Array<Array<unknown>> };
}

const setUrl: SetUrlFunction = (url: string): void => {
  window.history.replaceState(window.history.state, "", url);
};

describe("public Status Page API authentication errors", () => {
  let dashboardLogoutSpy: RecordedSpy;
  let statusPageLogoutSpy: RecordedSpy;
  let navigateSpy: RecordedSpy;

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    setUrl(PREVIEW_PATH);

    StatusPageUtil.setStatusPageId(new ObjectID(STATUS_PAGE_ID));
    StatusPageUtil.setIsPrivateStatusPage(false);

    LocalStorage.setItem("dashboard-session-marker", "keep-me");
    window.sessionStorage.setItem("dashboard-tab-marker", "keep-me-too");
    document.cookie = `${CookieName.Token}=dashboard-token; path=/`;

    dashboardLogoutSpy = jest
      .spyOn(DashboardUser, "logout")
      .mockImplementation(() => {}) as unknown as RecordedSpy;
    statusPageLogoutSpy = jest
      .spyOn(StatusPageUser, "logout")
      .mockResolvedValue(undefined) as unknown as RecordedSpy;
    navigateSpy = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation(() => {}) as unknown as RecordedSpy;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    document.cookie = `${CookieName.Token}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  test.each([401, 405])(
    "keeps the dashboard and Status Page state intact on HTTP %s",
    (statusCode: number) => {
      const error: HTTPErrorResponse = new HTTPErrorResponse(
        statusCode,
        { message: "Unrelated account authentication error" },
        {},
      );

      const result: HTTPErrorResponse = StatusPageAPI.handleError(
        error,
      ) as HTTPErrorResponse;

      expect(result).toBe(error);
      expect(dashboardLogoutSpy).not.toHaveBeenCalled();
      expect(statusPageLogoutSpy).not.toHaveBeenCalled();
      expect(navigateSpy).not.toHaveBeenCalled();

      expect(StatusPageUtil.getStatusPageId()?.toString()).toBe(STATUS_PAGE_ID);
      expect(LocalStorage.getItem("dashboard-session-marker")).toBe("keep-me");
      expect(window.sessionStorage.getItem("dashboard-tab-marker")).toBe(
        "keep-me-too",
      );
      expect(document.cookie).toContain(`${CookieName.Token}=dashboard-token`);
      expect(window.location.pathname).toBe(PREVIEW_PATH);
    },
  );

  test("retains page-scoped login handling for a private Status Page", () => {
    StatusPageUtil.setIsPrivateStatusPage(true);

    const error: HTTPErrorResponse = new HTTPErrorResponse(
      401,
      { message: "Status Page session expired" },
      {},
    );

    StatusPageAPI.handleError(error);

    expect(dashboardLogoutSpy).not.toHaveBeenCalled();
    expect(statusPageLogoutSpy).toHaveBeenCalledTimes(1);
    expect(statusPageLogoutSpy).toHaveBeenCalledWith(
      new ObjectID(STATUS_PAGE_ID),
    );
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy.mock.calls[0]?.[0]?.toString()).toBe(
      `/status-page/${STATUS_PAGE_ID}/login`,
    );
    expect(navigateSpy.mock.calls[0]?.[1]).toEqual({ forceNavigate: true });
  });
});

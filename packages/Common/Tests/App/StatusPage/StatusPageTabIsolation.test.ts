import StatusPageAPI from "../../../../App/FeatureSet/StatusPage/src/Utils/API";
import PageMap from "../../../../App/FeatureSet/StatusPage/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/StatusPage/src/Utils/RouteMap";
import StatusPageUtil, {
  IS_PRIVATE_STATUS_PAGE_STORAGE_KEY,
  MASTER_PASSWORD_VALIDATED_STORAGE_KEY,
  REQUIRES_MASTER_PASSWORD_STORAGE_KEY,
  SIGN_IN_REDIRECT_STORAGE_KEY,
} from "../../../../App/FeatureSet/StatusPage/src/Utils/StatusPage";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Status pages open side by side in one browser (issue #5277).
 *
 * Every tab open on OneUptime's host shares its localStorage, and the status
 * page app kept the id of the page it showed there, under one key. The page a
 * second tab opened became every tab's page: the first one's next refresh
 * drew the second one's content, and its links, its sign-in and its
 * Subscribe form were the second one's.
 *
 * Here each part of the app that names a page is held to the page this tab
 * shows, while localStorage holds another page's id, as a tab of an earlier
 * version - or any other tab - leaves it.
 */

const PAGE_A: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PAGE_B: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type SetUrlFunction = (url: string) => void;

const setUrl: SetUrlFunction = (url: string): void => {
  window.history.replaceState(window.history.state, "", url);
};

// Another tab, on the same host, showing page B as an earlier version did.
const anotherTabOpens: (pageId: string) => void = (pageId: string): void => {
  window.localStorage.setItem("statusPageId", pageId);
};

interface StatusPageAPIInternals {
  getRefreshSessionUrl: () => URL | null;
  getSessionName: () => string;
  getLoginRoute: () => Route;
  getForbiddenRoute: () => Route;
}

const internals: StatusPageAPIInternals =
  StatusPageAPI as unknown as StatusPageAPIInternals;

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  StatusPageUtil.setStatusPageId(null);
  setUrl("/");
});

afterEach(() => {
  jest.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  StatusPageUtil.setStatusPageId(null);
  setUrl("/");
});

describe("the status page a tab shows", () => {
  test("is the one its address names, whatever another tab keeps", () => {
    setUrl(`/status-page/${PAGE_A}/incidents`);
    anotherTabOpens(PAGE_B);

    expect(StatusPageUtil.getStatusPageId()?.toString()).toBe(PAGE_A);
    expect(StatusPageUtil.getStatusPageIdInAddress()?.toString()).toBe(PAGE_A);
  });

  test("on a custom domain, is the one the master page found for the domain", () => {
    setUrl("/incidents");
    StatusPageUtil.setStatusPageId(new ObjectID(PAGE_A));
    anotherTabOpens(PAGE_B);

    expect(StatusPageUtil.getStatusPageId()?.toString()).toBe(PAGE_A);
    expect(StatusPageUtil.getStatusPageIdInAddress()).toBeNull();
  });

  test("is not kept in localStorage, under any name", () => {
    const setItem: ReturnType<typeof jest.spyOn> = jest.spyOn(
      Storage.prototype,
      "setItem",
    );

    StatusPageUtil.setStatusPageId(new ObjectID(PAGE_A));

    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("statusPageId")).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  test("is not read from the key an earlier version kept", () => {
    anotherTabOpens(PAGE_B);

    expect(StatusPageUtil.getStatusPageId()).toBeNull();
  });
});

describe("whether the address names another status page than the tab loaded", () => {
  test.each([
    [`/status-page/${PAGE_A}`, false],
    [`/status-page/${PAGE_A}/subscribe/email`, false],
    [`/status-page/${PAGE_A.toUpperCase()}/incidents`, false],
    [`/status-page/${PAGE_B}`, true],
    [`/status-page/${PAGE_B}/subscribe/email`, true],
    // An address that names no page: a custom domain, or a placeholder.
    ["/", false],
    ["/incidents", false],
    ["/status-page/:statusPageId", false],
  ])("%s, with page A loaded: %p", (address: string, isAnother: boolean) => {
    StatusPageUtil.setStatusPageId(new ObjectID(PAGE_A));
    setUrl(address);

    expect(StatusPageUtil.isAddressOfAnotherStatusPage()).toBe(isAnother);
  });

  test("a tab that has loaded no page yet is on no other page's address", () => {
    setUrl(`/status-page/${PAGE_B}`);

    expect(StatusPageUtil.isAddressOfAnotherStatusPage()).toBe(false);
  });
});

describe("what the browser keeps about a status page", () => {
  test("is kept under the page's own id, and read for the page the tab shows", () => {
    setUrl(`/status-page/${PAGE_A}`);
    StatusPageUtil.setIsPrivateStatusPage(true);
    StatusPageUtil.setRequiresMasterPassword(true);
    StatusPageUtil.setMasterPasswordValidated(true);

    expect(
      window.localStorage.getItem(
        `${IS_PRIVATE_STATUS_PAGE_STORAGE_KEY}-${PAGE_A}`,
      ),
    ).toBe("true");
    expect(
      window.localStorage.getItem(
        `${REQUIRES_MASTER_PASSWORD_STORAGE_KEY}-${PAGE_A}`,
      ),
    ).toBe("true");
    expect(
      window.localStorage.getItem(
        `${MASTER_PASSWORD_VALIDATED_STORAGE_KEY}-${PAGE_A}`,
      ),
    ).toBe("true");

    // Page B, a public page, in another tab.
    setUrl(`/status-page/${PAGE_B}`);
    StatusPageUtil.setIsPrivateStatusPage(false);
    StatusPageUtil.setRequiresMasterPassword(false);

    expect(StatusPageUtil.isPrivateStatusPage()).toBe(false);
    expect(StatusPageUtil.requiresMasterPassword()).toBe(false);
    expect(StatusPageUtil.isMasterPasswordValidated()).toBe(false);

    // Page A still is what it was.
    setUrl(`/status-page/${PAGE_A}`);

    expect(StatusPageUtil.isPrivateStatusPage()).toBe(true);
    expect(StatusPageUtil.requiresMasterPassword()).toBe(true);
    expect(StatusPageUtil.isMasterPasswordValidated()).toBe(true);
  });

  test("is shared by every tab showing the same page", () => {
    setUrl(`/status-page/${PAGE_A}`);
    StatusPageUtil.setMasterPasswordValidated(true);

    // A second tab on page A, on the page's custom domain address.
    setUrl("/");
    StatusPageUtil.setStatusPageId(new ObjectID(PAGE_A));

    expect(StatusPageUtil.isMasterPasswordValidated()).toBe(true);
  });

  test("is neither kept nor read while the tab knows no page", () => {
    const setItem: ReturnType<typeof jest.spyOn> = jest.spyOn(
      Storage.prototype,
      "setItem",
    );

    // What an earlier version kept for every page under one name.
    window.localStorage.setItem(IS_PRIVATE_STATUS_PAGE_STORAGE_KEY, "true");
    window.localStorage.setItem(REQUIRES_MASTER_PASSWORD_STORAGE_KEY, "true");
    setItem.mockClear();

    StatusPageUtil.setIsPrivateStatusPage(true);
    StatusPageUtil.setRequiresMasterPassword(true);

    expect(setItem).not.toHaveBeenCalled();
    expect(StatusPageUtil.isPrivateStatusPage()).toBe(false);
    expect(StatusPageUtil.requiresMasterPassword()).toBe(false);
    expect(StatusPageUtil.isMasterPasswordValidated()).toBe(false);
  });

  test("a password entered before keys named their page opens no page, and is dropped", () => {
    window.localStorage.setItem(MASTER_PASSWORD_VALIDATED_STORAGE_KEY, "true");
    setUrl(`/status-page/${PAGE_A}`);

    expect(StatusPageUtil.isMasterPasswordValidated()).toBe(false);
    expect(
      window.localStorage.getItem(
        `${MASTER_PASSWORD_VALIDATED_STORAGE_KEY}-${PAGE_A}`,
      ),
    ).toBeNull();

    StatusPageUtil.setMasterPasswordValidated(true);

    expect(
      window.localStorage.getItem(MASTER_PASSWORD_VALIDATED_STORAGE_KEY),
    ).toBeNull();
    expect(StatusPageUtil.isMasterPasswordValidated()).toBe(true);
  });

  test("a page that stops asking for its password forgets it was entered", () => {
    setUrl(`/status-page/${PAGE_A}`);
    StatusPageUtil.setRequiresMasterPassword(true);
    StatusPageUtil.setMasterPasswordValidated(true);

    StatusPageUtil.setRequiresMasterPassword(false);

    expect(StatusPageUtil.isMasterPasswordValidated()).toBe(false);
  });
});

describe("where signing in leads", () => {
  test.each([
    [`/status-page/${PAGE_A}/incidents/incident-id`],
    [`/status-page/${PAGE_A}/subscribe/email?x=1#y`],
    ["/incidents/incident-id"],
  ])("on page A's address, keeps %s", (redirectPath: string) => {
    setUrl(`/status-page/${PAGE_A}/login`);

    expect(StatusPageUtil.getSafeRedirectPath(redirectPath)).toBe(redirectPath);
  });

  test.each([
    [`/status-page/${PAGE_B}`],
    [`/status-page/${PAGE_B}/subscribe/email`],
    [`/status-page/${PAGE_B.toUpperCase()}/incidents`],
  ])(
    "on page A's address, never to another page: %s",
    (redirectPath: string) => {
      setUrl(`/status-page/${PAGE_A}/login`);

      expect(StatusPageUtil.getSafeRedirectPath(redirectPath)).toBeNull();
      expect(
        StatusPageUtil.getSignInRoute({
          path: `/status-page/${PAGE_A}/sso`,
          redirectUrl: redirectPath,
        }).toString(),
      ).toBe(`/status-page/${PAGE_A}/sso`);
    },
  );

  test("on a custom domain, never to another page's preview address", () => {
    setUrl("/login");
    StatusPageUtil.setStatusPageId(new ObjectID(PAGE_A));

    expect(
      StatusPageUtil.getSafeRedirectPath(`/status-page/${PAGE_B}/incidents`),
    ).toBeNull();
    expect(
      StatusPageUtil.getSafeRedirectPath(`/status-page/${PAGE_A}/incidents`),
    ).toBe(`/status-page/${PAGE_A}/incidents`);
    expect(StatusPageUtil.getSafeRedirectPath("/incidents")).toBe("/incidents");
  });

  test("a redirect query naming another page is dropped", () => {
    setUrl(
      `/status-page/${PAGE_A}/login?redirectUrl=${encodeURIComponent(
        `/status-page/${PAGE_B}/subscribe/email`,
      )}`,
    );

    expect(StatusPageUtil.getSafeRedirectUrl()).toBeNull();
  });
});

describe("where single sign-on returns to", () => {
  const keyOf: (pageId: string) => string = (pageId: string): string => {
    return `${SIGN_IN_REDIRECT_STORAGE_KEY}-${pageId}`;
  };

  test("is kept in this tab's session storage, for this page only", () => {
    setUrl(`/status-page/${PAGE_A}/sso`);
    StatusPageUtil.rememberSignInRedirect(
      `/status-page/${PAGE_A}/incidents/incident-id`,
    );

    expect(window.sessionStorage.getItem(keyOf(PAGE_A))).toBe(
      `/status-page/${PAGE_A}/incidents/incident-id`,
    );
    expect(window.localStorage.getItem("redirectUrl")).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  test("is taken once, by the page it was kept for", () => {
    setUrl(`/status-page/${PAGE_A}/sso`);
    StatusPageUtil.rememberSignInRedirect(`/status-page/${PAGE_A}/incidents`);

    // Another page's overview takes nothing of page A's.
    setUrl(`/status-page/${PAGE_B}`);
    expect(StatusPageUtil.takeSignInRedirect()).toBeNull();

    setUrl(`/status-page/${PAGE_A}`);
    expect(StatusPageUtil.takeSignInRedirect()).toBe(
      `/status-page/${PAGE_A}/incidents`,
    );
    expect(StatusPageUtil.takeSignInRedirect()).toBeNull();
    expect(window.sessionStorage.getItem(keyOf(PAGE_A))).toBeNull();
  });

  test("the shared key an earlier version kept is never taken", () => {
    window.localStorage.setItem("redirectUrl", `/status-page/${PAGE_B}`);
    setUrl(`/status-page/${PAGE_A}`);

    expect(StatusPageUtil.takeSignInRedirect()).toBeNull();
  });

  test.each([
    ["https://evil.example/path"],
    ["//evil.example/path"],
    [`/status-page/${PAGE_B}/subscribe/email`],
    ["/login"],
  ])("an unsafe place is not kept: %s", (redirectPath: string) => {
    setUrl(`/status-page/${PAGE_A}/sso`);
    StatusPageUtil.rememberSignInRedirect(redirectPath);

    expect(window.sessionStorage.getItem(keyOf(PAGE_A))).toBeNull();
  });

  test("a later visit to single sign-on with nowhere to go forgets the last place", () => {
    setUrl(`/status-page/${PAGE_A}/sso`);
    StatusPageUtil.rememberSignInRedirect(`/status-page/${PAGE_A}/incidents`);
    StatusPageUtil.rememberSignInRedirect(null);

    expect(StatusPageUtil.takeSignInRedirect()).toBeNull();
  });

  test("what storage hands back is checked again as it is taken", () => {
    setUrl(`/status-page/${PAGE_A}`);
    window.sessionStorage.setItem(keyOf(PAGE_A), "https://evil.example/path");

    expect(StatusPageUtil.takeSignInRedirect()).toBeNull();
  });

  test("a tab that knows no page keeps and takes nothing", () => {
    const setItem: ReturnType<typeof jest.spyOn> = jest.spyOn(
      Storage.prototype,
      "setItem",
    );

    StatusPageUtil.rememberSignInRedirect("/incidents");

    expect(setItem).not.toHaveBeenCalled();
    expect(StatusPageUtil.takeSignInRedirect()).toBeNull();
  });

  test("blocked storage keeps nothing and takes nothing, without failing", () => {
    setUrl(`/status-page/${PAGE_A}/sso`);
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(() => {
      StatusPageUtil.rememberSignInRedirect(`/status-page/${PAGE_A}/x`);
    }).not.toThrow();
    expect(StatusPageUtil.takeSignInRedirect()).toBeNull();
  });
});

describe("the routes a tab links to", () => {
  test("name the page the tab shows", () => {
    setUrl(`/status-page/${PAGE_A}`);
    anotherTabOpens(PAGE_B);

    expect(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.PREVIEW_SUBSCRIBE_EMAIL]!,
      ).toString(),
    ).toBe(`/status-page/${PAGE_A}/subscribe/email`);
    expect(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.PREVIEW_INCIDENT_DETAIL]!,
        new ObjectID("cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
      ).toString(),
    ).toBe(
      `/status-page/${PAGE_A}/incidents/cccccccc-cccc-4ccc-8ccc-cccccccccccc`,
    );
    expect(
      RouteUtil.populateRouteParams(RouteMap[PageMap.PREVIEW_OVERVIEW]!)
        .toString()
        .startsWith(`/status-page/${PAGE_A}`),
    ).toBe(true);
  });

  test("on a custom domain, are the domain's own", () => {
    setUrl("/");
    StatusPageUtil.setStatusPageId(new ObjectID(PAGE_A));
    anotherTabOpens(PAGE_B);

    expect(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.SUBSCRIBE_EMAIL]!,
      ).toString(),
    ).toBe("/subscribe/email");
  });

  test("the overview, the sign-in page and the password page are the page's own", () => {
    setUrl(`/status-page/${PAGE_A}/incidents`);
    anotherTabOpens(PAGE_B);

    expect(StatusPageUtil.getDefaultRedirectRoute().toString()).toBe(
      `/status-page/${PAGE_A}/`,
    );

    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation(() => {});

    StatusPageUtil.navigateToLoginPage();
    StatusPageUtil.navigateToMasterPasswordPage();

    expect(
      navigate.mock.calls.map((call: Array<unknown>) => {
        return String(call[0]);
      }),
    ).toEqual([
      `/status-page/${PAGE_A}/login?redirectUrl=${encodeURIComponent(
        `/status-page/${PAGE_A}/incidents`,
      )}`,
      `/status-page/${PAGE_A}/master-password?redirectUrl=${encodeURIComponent(
        `/status-page/${PAGE_A}/incidents`,
      )}`,
    ]);
  });
});

describe("what a tab's requests name", () => {
  test("the status-page-id header is the page the tab shows", () => {
    setUrl(`/status-page/${PAGE_A}`);
    anotherTabOpens(PAGE_B);

    expect(StatusPageAPI.getDefaultHeaders()).toEqual({
      "status-page-id": PAGE_A,
      tenantid: "",
    });
  });

  test("a tab that knows no page sends no page header", () => {
    anotherTabOpens(PAGE_B);

    expect(StatusPageAPI.getDefaultHeaders()).toEqual({});
  });

  test("its session is refreshed and named for its own page", () => {
    setUrl(`/status-page/${PAGE_A}`);
    anotherTabOpens(PAGE_B);

    expect(
      new globalThis.URL(internals.getRefreshSessionUrl()!.toString()).pathname,
    ).toBe(`/status-page-identity-api/refresh-token/${PAGE_A}`);
    expect(internals.getSessionName()).toBe(`status-page-${PAGE_A}`);
  });

  test("its sign-in and forbidden pages are its own page's", () => {
    setUrl(`/status-page/${PAGE_A}`);
    anotherTabOpens(PAGE_B);

    expect(internals.getLoginRoute().toString()).toBe(
      `/status-page/${PAGE_A}/login`,
    );
    expect(internals.getForbiddenRoute().toString()).toBe(
      `/status-page/${PAGE_A}/forbidden`,
    );
  });
});

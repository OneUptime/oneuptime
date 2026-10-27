import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import type { SpyInstance } from "jest-mock";
import API from "../../../../App/FeatureSet/PublicDashboard/src/Utils/API";
import DashboardThemeUtil from "../../../../App/FeatureSet/PublicDashboard/src/Utils/DashboardTheme";
import PageMap from "../../../../App/FeatureSet/PublicDashboard/src/Utils/PageMap";
import PublicDashboardUtil, {
  DASHBOARD_MASTER_PASSWORD_VALIDATED_STORAGE_KEY,
  DASHBOARD_REQUIRES_MASTER_PASSWORD_STORAGE_KEY,
} from "../../../../App/FeatureSet/PublicDashboard/src/Utils/PublicDashboard";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/PublicDashboard/src/Utils/RouteMap";
import MasterPasswordPage from "../../../../App/FeatureSet/PublicDashboard/src/Pages/MasterPassword/MasterPassword";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";

/*
 * Public dashboards open side by side in one browser (issue #5277).
 *
 * The public dashboard app kept the id of the dashboard it showed in
 * localStorage, under one key every tab on the host shares, so a dashboard
 * a second tab opened became every tab's: a password entered in the first
 * tab was kept as the second dashboard's, and the first one asked for it
 * again and again.
 *
 * Each part of the app that names a dashboard is held here to the dashboard
 * this tab shows, while localStorage holds another one's id, as a tab of an
 * earlier version - or any other tab - leaves it.
 */

const BOARD_A: string = "da000000-0000-4000-8000-0000000000aa";
const BOARD_B: string = "da000000-0000-4000-8000-0000000000bb";

interface PublicDashboardAPIInternals {
  getLoginRoute: () => Route;
  getForbiddenRoute: () => Route;
}

const internals: PublicDashboardAPIInternals =
  API as unknown as PublicDashboardAPIInternals;

// The util reads the link's theme once a page: each address is a fresh page.
const openAt: (address: string) => void = (address: string): void => {
  window.history.replaceState(null, "", address);
  (
    DashboardThemeUtil as unknown as { linkTheme: string | null | undefined }
  ).linkTheme = undefined;
};

// Another tab, on the same host, showing dashboard B as an earlier version did.
const anotherTabOpens: (boardId: string) => void = (boardId: string): void => {
  window.localStorage.setItem("dashboardId", boardId);
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  PublicDashboardUtil.setDashboardId(null);
  openAt("/");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  PublicDashboardUtil.setDashboardId(null);
  openAt("/");
});

describe("the dashboard a tab shows", () => {
  test("is the one its address names, whatever another tab keeps", () => {
    openAt(`/public-dashboard/${BOARD_A}`);
    anotherTabOpens(BOARD_B);

    expect(PublicDashboardUtil.getDashboardId()?.toString()).toBe(BOARD_A);
  });

  test("on a custom domain, is the one the app found for the domain", () => {
    openAt("/");
    PublicDashboardUtil.setDashboardId(new ObjectID(BOARD_A));
    anotherTabOpens(BOARD_B);

    expect(PublicDashboardUtil.getDashboardId()?.toString()).toBe(BOARD_A);
  });

  test("is not kept in localStorage, under any name", () => {
    const setItem: ReturnType<typeof jest.spyOn> = jest.spyOn(
      Storage.prototype,
      "setItem",
    );

    PublicDashboardUtil.setDashboardId(new ObjectID(BOARD_A));

    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("dashboardId")).toBeNull();
  });

  test("is not read from the key an earlier version kept", () => {
    anotherTabOpens(BOARD_B);

    expect(PublicDashboardUtil.getDashboardId()).toBeNull();
  });
});

describe("what the browser keeps about a dashboard", () => {
  test("is kept under the dashboard's own id, and read for the one the tab shows", () => {
    openAt(`/public-dashboard/${BOARD_A}`);
    PublicDashboardUtil.setRequiresMasterPassword(true);
    PublicDashboardUtil.setMasterPasswordValidated(true);

    expect(
      window.localStorage.getItem(
        `${DASHBOARD_REQUIRES_MASTER_PASSWORD_STORAGE_KEY}-${BOARD_A}`,
      ),
    ).toBe("true");
    expect(
      window.localStorage.getItem(
        `${DASHBOARD_MASTER_PASSWORD_VALIDATED_STORAGE_KEY}-${BOARD_A}`,
      ),
    ).toBe("true");

    // Dashboard B, behind a password not entered yet, in another tab.
    openAt(`/public-dashboard/${BOARD_B}`);
    PublicDashboardUtil.setRequiresMasterPassword(true);

    expect(PublicDashboardUtil.requiresMasterPassword()).toBe(true);
    expect(PublicDashboardUtil.isMasterPasswordValidated()).toBe(false);

    openAt(`/public-dashboard/${BOARD_A}`);

    expect(PublicDashboardUtil.isMasterPasswordValidated()).toBe(true);
  });

  test("is neither kept nor read while the tab knows no dashboard", () => {
    const setItem: ReturnType<typeof jest.spyOn> = jest.spyOn(
      Storage.prototype,
      "setItem",
    );

    // What an earlier version kept for every dashboard under one name.
    window.localStorage.setItem(
      DASHBOARD_REQUIRES_MASTER_PASSWORD_STORAGE_KEY,
      "true",
    );
    window.localStorage.setItem(
      DASHBOARD_MASTER_PASSWORD_VALIDATED_STORAGE_KEY,
      "true",
    );
    setItem.mockClear();

    PublicDashboardUtil.setRequiresMasterPassword(true);
    PublicDashboardUtil.setMasterPasswordValidated(true);

    expect(setItem).not.toHaveBeenCalled();
    expect(PublicDashboardUtil.requiresMasterPassword()).toBe(false);
    expect(PublicDashboardUtil.isMasterPasswordValidated()).toBe(false);
  });

  test("a dashboard that stops asking for its password forgets it was entered", () => {
    openAt(`/public-dashboard/${BOARD_A}`);
    PublicDashboardUtil.setRequiresMasterPassword(true);
    PublicDashboardUtil.setMasterPasswordValidated(true);

    PublicDashboardUtil.setRequiresMasterPassword(false);

    expect(PublicDashboardUtil.isMasterPasswordValidated()).toBe(false);
  });
});

describe("where the password prompt leads", () => {
  test.each([
    [`/public-dashboard/${BOARD_A}`],
    [`/public-dashboard/${BOARD_A}?var-env=prod`],
    ["/?theme=dark"],
  ])("on dashboard A's prompt, back to %s", (redirectUrl: string) => {
    openAt(
      `/public-dashboard/${BOARD_A}/master-password?redirectUrl=${encodeURIComponent(
        redirectUrl,
      )}`,
    );

    expect(PublicDashboardUtil.getSafeRedirectUrl()).toBe(redirectUrl);
  });

  test.each([
    [`/public-dashboard/${BOARD_B}`],
    [`/public-dashboard/${BOARD_B}?var-env=prod`],
    [`/public-dashboard/${BOARD_B.toUpperCase()}`],
    // Dashboard A's address in front, dashboard B's where the browser lands.
    [`/public-dashboard/${BOARD_A}/../${BOARD_B}`],
    [`/public-dashboard/${BOARD_A}/%2e%2e/${BOARD_B}?var-env=prod`],
    [`/public-dashboard//${BOARD_B}`],
    [`/PUBLIC-DASHBOARD/${BOARD_B}`],
  ])(
    "on dashboard A's prompt, never to another dashboard: %s",
    (redirectUrl: string) => {
      openAt(
        `/public-dashboard/${BOARD_A}/master-password?redirectUrl=${encodeURIComponent(
          redirectUrl,
        )}`,
      );

      expect(PublicDashboardUtil.getSafeRedirectUrl()).toBeNull();
    },
  );

  /*
   * By the rule every navigation keeps (Navigation.isSafeInternalRoute):
   * the prompt sends the visitor on in full, and navigation refuses these
   * outright - so the visitor got an error instead of their dashboard.
   */
  test.each([
    ["https://evil.example/path"],
    ["//evil.example/path"],
    ["/\\evil.example/path"],
    ["javascript:alert(1)"],
    ["dashboard"],
    ['/"'],
  ])(
    "on dashboard A's prompt, never to another site or an address navigation refuses: %s",
    (redirectUrl: string) => {
      openAt(
        `/public-dashboard/${BOARD_A}/master-password?redirectUrl=${encodeURIComponent(
          redirectUrl,
        )}`,
      );

      expect(PublicDashboardUtil.getSafeRedirectUrl()).toBeNull();
    },
  );

  test("on a custom domain, never to another dashboard's address", () => {
    PublicDashboardUtil.setDashboardId(new ObjectID(BOARD_A));
    openAt(
      `/master-password?redirectUrl=${encodeURIComponent(
        `/public-dashboard/${BOARD_B}`,
      )}`,
    );

    expect(PublicDashboardUtil.getSafeRedirectUrl()).toBeNull();
  });
});

describe("the addresses and requests of a tab", () => {
  test("its routes name the dashboard it shows", () => {
    openAt(`/public-dashboard/${BOARD_A}`);
    anotherTabOpens(BOARD_B);

    expect(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.PREVIEW_MASTER_PASSWORD]!,
      ).toString(),
    ).toBe(`/public-dashboard/${BOARD_A}/master-password`);
    expect(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.PREVIEW_FORBIDDEN]!,
      ).toString(),
    ).toBe(`/public-dashboard/${BOARD_A}/forbidden`);
  });

  test("the dashboard-id header is the dashboard it shows", () => {
    openAt(`/public-dashboard/${BOARD_A}`);
    anotherTabOpens(BOARD_B);

    expect(API.getDefaultHeaders()).toEqual({
      "dashboard-id": BOARD_A,
      tenantid: "",
    });
  });

  test("a tab that knows no dashboard sends no dashboard header", () => {
    anotherTabOpens(BOARD_B);

    expect(API.getDefaultHeaders()).toEqual({});
  });

  test("its password prompt and forbidden page are its own dashboard's", () => {
    openAt(`/public-dashboard/${BOARD_A}`);
    anotherTabOpens(BOARD_B);
    PublicDashboardUtil.setRequiresMasterPassword(true);

    expect(internals.getLoginRoute().toString()).toBe(
      `/public-dashboard/${BOARD_A}/master-password`,
    );
    expect(internals.getForbiddenRoute().toString()).toBe(
      `/public-dashboard/${BOARD_A}/forbidden`,
    );
  });

  test("a 401 sends it to its own dashboard's password prompt", async () => {
    openAt(`/public-dashboard/${BOARD_A}?var-env=prod`);
    PublicDashboardUtil.setRequiresMasterPassword(true);
    anotherTabOpens(BOARD_B);

    const navigate: SpyInstance<typeof Navigation.navigate> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {});

    PublicDashboardUtil.navigateToMasterPasswordPage();

    const address: URL = new URL(
      String(navigate.mock.calls[0]?.[0]),
      "https://dashboard.acme.com",
    );

    expect(address.pathname).toBe(
      `/public-dashboard/${BOARD_A}/master-password`,
    );
    expect(address.searchParams.get("redirectUrl")).toBe(
      `/public-dashboard/${BOARD_A}?var-env=prod`,
    );
  });
});

describe("the password prompt, with another dashboard open in another tab", () => {
  test("unlocks the dashboard the tab shows, and only that one", async () => {
    openAt(`/public-dashboard/${BOARD_A}/master-password`);
    PublicDashboardUtil.setRequiresMasterPassword(true);

    // Dashboard B opens in another tab, behind a password of its own.
    anotherTabOpens(BOARD_B);
    window.localStorage.setItem(
      `${DASHBOARD_REQUIRES_MASTER_PASSWORD_STORAGE_KEY}-${BOARD_B}`,
      "true",
    );

    const navigate: SpyInstance<typeof Navigation.navigate> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {});
    const post: ReturnType<typeof jest.spyOn> = jest
      .spyOn(API, "post")
      .mockImplementation(async (): Promise<HTTPResponse<JSONObject>> => {
        return new HTTPResponse<JSONObject>(200, {}, {});
      });

    await act(async () => {
      render(
        <MemoryRouter>
          <MasterPasswordPage dashboardName="Checkout" />
        </MemoryRouter>,
      );
    });

    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "open sesame" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Unlock Dashboard" }));
    });

    await waitFor(() => {
      expect(navigate).toHaveBeenCalled();
    });

    const sentTo: { url: { toString: () => string } } = post.mock
      .calls[0]?.[0] as { url: { toString: () => string } };

    expect(new URL(sentTo.url.toString()).pathname).toBe(
      `/public-dashboard-api/master-password/${BOARD_A}`,
    );
    expect(
      window.localStorage.getItem(
        `${DASHBOARD_MASTER_PASSWORD_VALIDATED_STORAGE_KEY}-${BOARD_A}`,
      ),
    ).toBe("true");
    expect(
      window.localStorage.getItem(
        `${DASHBOARD_MASTER_PASSWORD_VALIDATED_STORAGE_KEY}-${BOARD_B}`,
      ),
    ).toBeNull();
    expect(String(navigate.mock.calls[0]?.[0])).toBe(
      `/public-dashboard/${BOARD_A}`,
    );
  });
});

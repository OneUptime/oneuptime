import "@testing-library/jest-dom";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React, { ReactElement } from "react";
import fs from "fs";
import path from "path";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import IconProp from "../../../Types/Icon/IconProp";
import { ActionButtonPlacement } from "../../../UI/Components/ActionButton/ActionButtonSchema";
import Navigation from "../../../UI/Utils/Navigation";
import type { SpyInstance } from "jest-mock";

/*
 * Where a dashboard shown full screen is (issue #10409): its own page, with
 * ?view=full-screen in the address. The address is the truth - a tab opened
 * on it, a bookmark and a reload show the dashboard full screen - and going
 * in and out writes it in place, as the dashboard's range, refresh and
 * variables are written: no new history entry, every other parameter kept.
 *
 *   - Open in New Tab, from the dashboard, opens this dashboard full screen
 *     on what the person sees (its range, refresh and variables); from the
 *     Dashboards list, each row's ⋯ menu opens that dashboard full screen.
 *   - The dashboard's page hands the board what its address says, and
 *     writes back what the board asks for.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const DASHBOARD_ID: string = "66666666-6666-4666-8666-666666666666";
const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/dashboards/${DASHBOARD_ID}`;

/*
 * The board on the dashboard's page is recorded rather than drawn: what
 * matters here is what the page hands it. (DashboardFullScreen.test.tsx
 * draws the real one.)
 */
const viewerProps: Array<Record<string, unknown>> = [];

(
  globalThis as unknown as {
    __fullScreenViewerProps: Array<Record<string, unknown>>;
  }
).__fullScreenViewerProps = viewerProps;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardView",
  () => {
    const react: typeof React = jest.requireActual("react") as typeof React;

    return {
      __esModule: true,
      default: (props: Record<string, unknown>): ReactElement => {
        (
          globalThis as unknown as {
            __fullScreenViewerProps: Array<Record<string, unknown>>;
          }
        ).__fullScreenViewerProps.push(props);

        return react.createElement("div", {
          "data-testid": "board",
          "data-full-screen": String(props["isFullScreen"]),
        });
      },
    };
  },
);

import {
  getDashboardFullScreenNewTabAddress,
  getDashboardFullScreenRoute,
  isAddressFullScreen,
  openAddressInNewTab,
  useDashboardFullScreenAddress,
  writeAddressFullScreen,
  DashboardFullScreenAddress,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/DashboardFullScreenAddress";
import DashboardViewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/View/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { DASHBOARD_OPEN_IN_NEW_TAB_ROW_ACTION } from "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/Dashboards";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard"),
  currentProject: null,
  hasPaymentMethod: false,
};

type OpenFunction = (
  url?: string | URL,
  target?: string,
  features?: string,
) => Window | null;

let openCalls: Array<Array<unknown>> = [];

function openAt(address: string): void {
  window.history.replaceState({ kept: "state" }, "", address);
}

function lastProps(): Record<string, unknown> {
  return viewerProps[viewerProps.length - 1]!;
}

beforeEach(() => {
  viewerProps.length = 0;
  openCalls = [];
  openAt(PAGE_PATH);
  jest.spyOn(window, "open").mockImplementation(((
    ...args: Array<unknown>
  ): Window | null => {
    openCalls.push(args);
    return null;
  }) as OpenFunction);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  openAt("/");
});

describe("a dashboard's full-screen address", () => {
  test("is its own page with ?view=full-screen: what the Dashboards list opens", () => {
    expect(
      getDashboardFullScreenRoute(new ObjectID(DASHBOARD_ID)).toString(),
    ).toBe(`${PAGE_PATH}?view=full-screen`);
  });

  test("a new tab opens on what this one shows - its range, refresh and variables - full screen", () => {
    expect(
      getDashboardFullScreenNewTabAddress({
        pathname: PAGE_PATH,
        search: "?range=1d&refresh=1m&var-service=checkout",
      }),
    ).toBe(
      `${PAGE_PATH}?range=1d&refresh=1m&var-service=checkout&view=full-screen`,
    );
  });

  test("a link's widget is not carried to the new tab: it landed this one once", () => {
    expect(
      getDashboardFullScreenNewTabAddress({
        pathname: PAGE_PATH,
        search: "?widget=abc-123&range=1d",
      }),
    ).toBe(`${PAGE_PATH}?range=1d&view=full-screen`);
  });

  test("a tab already full screen opens another full screen, named once", () => {
    expect(
      getDashboardFullScreenNewTabAddress({
        pathname: PAGE_PATH,
        search: "?view=full-screen",
      }),
    ).toBe(`${PAGE_PATH}?view=full-screen`);
  });

  test("a new tab is opened on its own: it cannot reach back into this one", () => {
    openAddressInNewTab(`${PAGE_PATH}?view=full-screen`);

    expect(openCalls).toEqual([
      [`${PAGE_PATH}?view=full-screen`, "_blank", "noopener"],
    ]);
  });
});

describe("reading and writing the tab's address", () => {
  test("reads the view from the address", () => {
    expect(isAddressFullScreen()).toBe(false);

    openAt(`${PAGE_PATH}?range=1d&view=full-screen`);

    expect(isAddressFullScreen()).toBe(true);
  });

  test("writes it in place: no new history entry, its state and every other parameter kept", () => {
    openAt(`${PAGE_PATH}?range=1d&var-service=checkout#widgets`);

    const entries: number = window.history.length;

    writeAddressFullScreen(true);

    expect(window.location.pathname).toBe(PAGE_PATH);
    expect(window.location.search).toBe(
      "?range=1d&var-service=checkout&view=full-screen",
    );
    expect(window.location.hash).toBe("#widgets");
    expect(window.history.state).toEqual({ kept: "state" });
    expect(window.history.length).toBe(entries);

    writeAddressFullScreen(false);

    expect(window.location.search).toBe("?range=1d&var-service=checkout");
    expect(window.location.hash).toBe("#widgets");
    expect(window.history.length).toBe(entries);
  });

  test("taken out of an address with nothing else, it leaves no ?", () => {
    openAt(`${PAGE_PATH}?view=full-screen`);

    writeAddressFullScreen(false);

    expect(window.location.href).toBe(`${window.location.origin}${PAGE_PATH}`);
  });

  test("writing what the address already says writes nothing", () => {
    openAt(`${PAGE_PATH}?view=full-screen`);

    const replaceState: SpyInstance<typeof window.history.replaceState> =
      jest.spyOn(window.history, "replaceState");

    writeAddressFullScreen(true);

    expect(replaceState).not.toHaveBeenCalled();
  });
});

describe("the page's hook", () => {
  test("reads the address, writes it, and opens a new tab on it", () => {
    openAt(`${PAGE_PATH}?range=1d`);

    const { result } = renderHook((): DashboardFullScreenAddress => {
      return useDashboardFullScreenAddress();
    });

    expect(result.current.isFullScreen).toBe(false);

    act(() => {
      result.current.setFullScreen(true);
    });

    expect(result.current.isFullScreen).toBe(true);
    expect(window.location.search).toBe("?range=1d&view=full-screen");

    act(() => {
      result.current.openInNewTab();
    });

    expect(openCalls).toEqual([
      [`${PAGE_PATH}?range=1d&view=full-screen`, "_blank", "noopener"],
    ]);

    act(() => {
      result.current.setFullScreen(false);
    });

    expect(result.current.isFullScreen).toBe(false);
    expect(window.location.search).toBe("?range=1d");
  });

  test("follows Back or Forward onto an address that says otherwise", () => {
    const { result } = renderHook((): DashboardFullScreenAddress => {
      return useDashboardFullScreenAddress();
    });

    expect(result.current.isFullScreen).toBe(false);

    act(() => {
      openAt(`${PAGE_PATH}?view=full-screen`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(result.current.isFullScreen).toBe(true);

    act(() => {
      openAt(PAGE_PATH);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(result.current.isFullScreen).toBe(false);
  });

  test("a new tab opened from a dashboard on its page opens it full screen", () => {
    openAt(`${PAGE_PATH}?refresh=30s`);

    const { result } = renderHook((): DashboardFullScreenAddress => {
      return useDashboardFullScreenAddress();
    });

    act(() => {
      result.current.openInNewTab();
    });

    expect(openCalls[0]![0]).toBe(`${PAGE_PATH}?refresh=30s&view=full-screen`);
    // This tab stays as it was.
    expect(window.location.search).toBe("?refresh=30s");
  });
});

describe("the dashboard's page", () => {
  beforeEach(() => {
    jest
      .spyOn(Navigation, "getLastParamAsObjectID")
      .mockReturnValue(new ObjectID(DASHBOARD_ID));
  });

  test("the address alone opens the dashboard full screen", async () => {
    openAt(`${PAGE_PATH}?view=full-screen`);

    await act(async () => {
      render(<DashboardViewPage {...PAGE_PROPS} />);
    });

    expect(lastProps()["isFullScreen"]).toBe(true);
    expect((lastProps()["dashboardId"] as ObjectID).toString()).toBe(
      DASHBOARD_ID,
    );
  });

  test("without it, the dashboard opens on its page", async () => {
    await act(async () => {
      render(<DashboardViewPage {...PAGE_PROPS} />);
    });

    expect(lastProps()["isFullScreen"]).toBe(false);
  });

  test("the board's Full Screen and Exit Full Screen write the address, and the page follows", async () => {
    openAt(`${PAGE_PATH}?range=7d`);

    await act(async () => {
      render(<DashboardViewPage {...PAGE_PROPS} />);
    });

    await act(async () => {
      (lastProps()["onFullScreenChange"] as (value: boolean) => void)(true);
    });

    expect(window.location.search).toBe("?range=7d&view=full-screen");
    expect(lastProps()["isFullScreen"]).toBe(true);

    await act(async () => {
      (lastProps()["onFullScreenChange"] as (value: boolean) => void)(false);
    });

    expect(window.location.search).toBe("?range=7d");
    expect(lastProps()["isFullScreen"]).toBe(false);
  });

  test("the board's Open in New Tab opens this dashboard full screen in a tab of its own", async () => {
    openAt(`${PAGE_PATH}?range=1d`);

    await act(async () => {
      render(<DashboardViewPage {...PAGE_PROPS} />);
    });

    await act(async () => {
      (lastProps()["onOpenInNewTab"] as () => void)();
    });

    expect(openCalls).toEqual([
      [`${PAGE_PATH}?range=1d&view=full-screen`, "_blank", "noopener"],
    ]);
  });

  test("still hands the board its Share", async () => {
    await act(async () => {
      render(<DashboardViewPage {...PAGE_PROPS} />);
    });

    expect(typeof lastProps()["onShareClick"]).toBe("function");
  });
});

describe("the Dashboards list's Open in New Tab", () => {
  test("is each row's, in its ⋯ menu, with an icon, never the row's button", () => {
    expect(DASHBOARD_OPEN_IN_NEW_TAB_ROW_ACTION.title).toBe("Open in New Tab");
    expect(DASHBOARD_OPEN_IN_NEW_TAB_ROW_ACTION.icon).toBe(
      IconProp.ExternalLink,
    );
    expect(DASHBOARD_OPEN_IN_NEW_TAB_ROW_ACTION.placement).toBe(
      ActionButtonPlacement.MoreMenu,
    );
    // Offered to whoever can see the row: nothing locks or hides it.
    expect(DASHBOARD_OPEN_IN_NEW_TAB_ROW_ACTION.disabled).toBeUndefined();
    expect(DASHBOARD_OPEN_IN_NEW_TAB_ROW_ACTION.isVisible).toBeUndefined();
    expect(
      DASHBOARD_OPEN_IN_NEW_TAB_ROW_ACTION.getConfirmation,
    ).toBeUndefined();
  });

  test("opens that dashboard full screen in a tab of its own, and is done at once", () => {
    openAt(`/dashboard/${PROJECT_ID}/dashboards`);

    const dashboard: Dashboard = new Dashboard();
    dashboard._id = DASHBOARD_ID;

    const completed: Array<boolean> = [];

    DASHBOARD_OPEN_IN_NEW_TAB_ROW_ACTION.onClick(
      dashboard,
      () => {
        completed.push(true);
      },
      () => {
        completed.push(false);
      },
    );

    expect(openCalls).toEqual([
      [`${PAGE_PATH}?view=full-screen`, "_blank", "noopener"],
    ]);
    expect(completed).toEqual([true]);
    // The list stays where it was.
    expect(window.location.pathname).toBe(
      `/dashboard/${PROJECT_ID}/dashboards`,
    );
  });

  test("a row without an id opens nothing, and is done all the same", () => {
    const completed: Array<boolean> = [];

    DASHBOARD_OPEN_IN_NEW_TAB_ROW_ACTION.onClick(
      new Dashboard(),
      () => {
        completed.push(true);
      },
      () => {
        completed.push(false);
      },
    );

    expect(openCalls).toEqual([]);
    expect(completed).toEqual([true]);
  });

  test("comes first in each row's ⋯ menu, before Archive", () => {
    const source: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/Dashboards.tsx",
      ),
      "utf8",
    );
    const rowActions: RegExp = new RegExp(
      "actionButtons=\\{\\[([\\s\\S]*?)\\]\\}",
    );
    const actions: string = rowActions.exec(source)?.[1] || "";

    expect(
      actions
        .split(",")
        .map((part: string): string => {
          return part.trim();
        })
        .filter(Boolean),
    ).toEqual(["DASHBOARD_OPEN_IN_NEW_TAB_ROW_ACTION", "...archiveRowActions"]);
  });
});

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

// Badge counts: nothing open, nothing to count, no network.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (): Promise<number> => {
        return Promise.resolve(0);
      },
      getList: (): Promise<unknown> => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 10 });
      },
      getItem: (): Promise<null> => {
        return Promise.resolve(null);
      },
    },
  };
});

/*
 * The board itself (its toolbar has a test below) is recorded rather than
 * drawn: what matters on the dashboard's page is what it hands the board.
 */
const viewerProps: Array<Record<string, unknown>> = [];

(
  globalThis as unknown as {
    __sharingViewerProps: Array<Record<string, unknown>>;
  }
).__sharingViewerProps = viewerProps;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardView",
  () => {
    const react: typeof React = jest.requireActual("react") as typeof React;

    return {
      __esModule: true,
      default: (props: Record<string, unknown>): ReactElement => {
        (
          globalThis as unknown as {
            __sharingViewerProps: Array<Record<string, unknown>>;
          }
        ).__sharingViewerProps.push(props);

        return react.createElement("div", { "data-testid": "board" });
      },
    };
  },
);

import DashboardSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/View/SideMenu";
import DashboardViewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/View/Index";
import DashboardToolbar from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardToolbar";
import { getDashboardBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/DashboardBreadCrumbs";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import DashboardMode from "../../../Types/Dashboard/DashboardMode";
import DashboardViewConfig, {
  AutoRefreshInterval,
} from "../../../Types/Dashboard/DashboardViewConfig";
import DefaultDashboardSize from "../../../Types/Dashboard/DashboardSize";
import { ObjectType } from "../../../Types/JSON";
import Link from "../../../Types/Link";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import Navigation from "../../../UI/Utils/Navigation";
import {
  DESKTOP_WIDTH,
  MenuLink,
  PROJECT_ID,
  activeLinkTitles,
  goTo,
  iconCountIn,
  isExpanded,
  linksIn,
  renderMenu,
  setViewportWidth,
  titlesInMenu,
} from "./SideMenuHarness";

/*
 * Who can view a dashboard is one choice on its Sharing page. It used to be
 * "Authentication", folded away under Advanced; now it is reached the two
 * ways people look for it:
 *
 *   - from the dashboard itself: ⋯ -> Share on its toolbar;
 *   - from the side menu: Sharing, in the Basic section beside the dashboard
 *     and its overview - at the old page's address, so links and bookmarks
 *     still land on it.
 */

const MODEL_ID: string = "0193c0de-6666-4aaa-8bbb-0000000000d4";

function viewRoute(pageMapKey: string): string {
  return RouteUtil.populateRouteParams(RouteMap[pageMapKey] as Route, {
    modelId: new ObjectID(MODEL_ID),
  }).toString();
}

const SHARING_ROUTE: () => string = (): string => {
  return viewRoute(PageMap.DASHBOARD_VIEW_AUTHENTICATION_SETTINGS);
};

async function renderMenuAt(page: string): Promise<void> {
  goTo(viewRoute(page));
  await renderMenu(<DashboardSideMenu modelId={new ObjectID(MODEL_ID)} />);
}

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
  goTo(`/dashboard/${PROJECT_ID}`);
  viewerProps.length = 0;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the dashboard's side menu", () => {
  test("Basic holds the dashboard, its overview, and Sharing", async () => {
    await renderMenuAt(PageMap.DASHBOARD_VIEW);

    const basic: Array<{ title: string; page: string }> = [
      { title: "Dashboard", page: PageMap.DASHBOARD_VIEW },
      { title: "Overview", page: PageMap.DASHBOARD_VIEW_OVERVIEW },
      {
        title: "Sharing",
        page: PageMap.DASHBOARD_VIEW_AUTHENTICATION_SETTINGS,
      },
    ];

    expect(linksIn("Basic")).toEqual(
      basic.map((entry: { title: string; page: string }): MenuLink => {
        return { title: entry.title, href: viewRoute(entry.page) };
      }),
    );
    expect(iconCountIn("Basic")).toBe(basic.length);
    // Basic is the menu's first section: always open.
    expect(isExpanded("Basic")).toBe(true);
  });

  test("Sharing is the old Authentication page, at the same address, and Authentication is gone", async () => {
    await renderMenuAt(PageMap.DASHBOARD_VIEW);

    expect(SHARING_ROUTE()).toBe(
      `/dashboard/${PROJECT_ID}/dashboards/${MODEL_ID}/authentication-settings`,
    );
    expect(titlesInMenu()).not.toContain("Authentication");
    expect(
      titlesInMenu().filter((title: string): boolean => {
        return title === "Sharing";
      }),
    ).toHaveLength(1);
  });

  test("Advanced keeps settings, audit logs and delete, and stays folded", async () => {
    await renderMenuAt(PageMap.DASHBOARD_VIEW);

    expect(
      linksIn("Advanced").map((link: MenuLink): string => {
        return link.title;
      }),
    ).toEqual(["Settings", "Audit Logs", "Delete"]);
    expect(isExpanded("Advanced")).toBe(false);
  });

  test("on Sharing, Sharing is the page marked as current", async () => {
    await renderMenuAt(PageMap.DASHBOARD_VIEW_AUTHENTICATION_SETTINGS);

    expect(isExpanded("Basic")).toBe(true);
    expect(activeLinkTitles()).toEqual(["Sharing"]);
    // Nothing folded has to open for it.
    expect(isExpanded("Advanced")).toBe(false);
  });
});

describe("the Sharing page's breadcrumbs", () => {
  test("name it Sharing", () => {
    const links: Array<Link> | undefined = getDashboardBreadcrumbs(
      (
        RouteMap[PageMap.DASHBOARD_VIEW_AUTHENTICATION_SETTINGS] as Route
      ).toString(),
    );

    expect(
      (links || []).map((link: Link): string => {
        return link.title;
      }),
    ).toEqual(["Project", "Dashboards", "View Dashboard", "Sharing"]);
  });
});

const RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_HOUR,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-09-08T10:00:00.000Z"),
    new Date("2026-09-08T11:00:00.000Z"),
  ),
};

const EMPTY_BOARD: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: DefaultDashboardSize.heightInDashboardUnits,
};

function noop(): void {
  return undefined;
}

function renderToolbar(props: {
  onShareClick?: (() => void) | undefined;
  canEditDashboard: boolean;
  editDashboardDisabledReason?: string | undefined;
  dashboardMode?: DashboardMode | undefined;
}): void {
  render(
    <DashboardToolbar
      dashboardMode={props.dashboardMode || DashboardMode.View}
      dashboardName="Checkout"
      dashboardViewConfig={EMPTY_BOARD}
      isSaving={false}
      canEditDashboard={props.canEditDashboard}
      editDashboardDisabledReason={props.editDashboardDisabledReason}
      onShareClick={props.onShareClick}
      startAndEndDate={RANGE}
      onStartAndEndDateChange={noop}
      autoRefreshInterval={AutoRefreshInterval.OFF}
      onAutoRefreshIntervalChange={noop}
      onEditClick={noop}
      onSaveClick={noop}
      onCancelEditClick={noop}
      onFullScreenClick={noop}
      onAddComponentClick={noop}
    />,
  );
}

function openMoreMenu(): void {
  fireEvent.click(screen.getByLabelText("More dashboard options"));
}

function menuItems(): Array<string> {
  return screen.getAllByRole("menuitem").map((item: HTMLElement): string => {
    return item.textContent || "";
  });
}

describe("the dashboard's ⋯ menu", () => {
  test("offers Share, after Edit Dashboard and before Full Screen", () => {
    renderToolbar({ onShareClick: noop, canEditDashboard: true });
    openMoreMenu();

    expect(menuItems()).toEqual(["Edit Dashboard", "Share", "Full Screen"]);
  });

  test("Share opens the Sharing page", () => {
    const onShareClick: MockFunction = getJestMockFunction();

    renderToolbar({
      onShareClick: onShareClick as unknown as () => void,
      canEditDashboard: true,
    });
    openMoreMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: "Share" }));

    expect(onShareClick).toHaveBeenCalledTimes(1);
  });

  test("a reader who may not edit still gets Share: who can view it, and its public link", () => {
    const onShareClick: MockFunction = getJestMockFunction();

    renderToolbar({
      onShareClick: onShareClick as unknown as () => void,
      canEditDashboard: false,
    });
    openMoreMenu();

    expect(menuItems()).toEqual(["Share", "Full Screen"]);

    fireEvent.click(screen.getByRole("menuitem", { name: "Share" }));

    expect(onShareClick).toHaveBeenCalledTimes(1);
  });

  test("Share has an icon, as every menu item does", () => {
    renderToolbar({ onShareClick: noop, canEditDashboard: true });
    openMoreMenu();

    const share: HTMLElement = screen.getByRole("menuitem", { name: "Share" });

    expect(share.querySelector("svg")).not.toBeNull();
  });

  test("without a Sharing page to open, there is no Share", () => {
    renderToolbar({ canEditDashboard: true });
    openMoreMenu();

    expect(menuItems()).toEqual(["Edit Dashboard", "Full Screen"]);
  });

  test("while editing, the ⋯ menu (and Share with it) is not there", () => {
    renderToolbar({
      onShareClick: noop,
      canEditDashboard: true,
      dashboardMode: DashboardMode.Edit,
    });

    expect(
      screen.queryByLabelText("More dashboard options"),
    ).not.toBeInTheDocument();
  });
});

describe("the dashboard's page", () => {
  const PAGE_PROPS: PageComponentProps = {
    pageRoute: new Route("/dashboard"),
    currentProject: null,
    hasPaymentMethod: false,
  };

  test("hands the board this dashboard, and a Share that opens its Sharing page", async () => {
    goTo(viewRoute(PageMap.DASHBOARD_VIEW));

    jest
      .spyOn(Navigation, "getLastParamAsObjectID")
      .mockReturnValue(new ObjectID(MODEL_ID));

    const navigate: jest.SpyInstance<any, any> = getJestSpyOn(
      Navigation,
      "navigate",
    ).mockImplementation((): void => {
      return undefined;
    });

    await act(async () => {
      render(<DashboardViewPage {...PAGE_PROPS} />);
    });

    expect(screen.getByTestId("board")).toBeInTheDocument();

    const props: Record<string, unknown> = viewerProps[viewerProps.length - 1]!;

    expect((props["dashboardId"] as ObjectID).toString()).toBe(MODEL_ID);
    expect(typeof props["onShareClick"]).toBe("function");

    (props["onShareClick"] as () => void)();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect((navigate.mock.calls[0]![0] as Route).toString()).toBe(
      SHARING_ROUTE(),
    );
  });
});

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
} from "@testing-library/react";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import {
  MemoryRouter,
  Route as PageRoute,
  Routes,
  useNavigate,
} from "react-router-dom";
import HomeLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/Home/Layout";
import UserProfileLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/Layout";
import InventoryLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/Inventory/Layout";
import MonitorLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Layout";
import NetworkLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/Network/Layout";
import SettingsLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/Layout";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import Navigation from "../../../UI/Utils/Navigation";

/*
 * These side menus make network requests and contain their own local
 * collapse state. Replace only their product-specific contents with a small
 * stateful probe: the real Layout, Page, Outlet and Suspense boundary remain
 * under test. A mount and a nested "count request" effect make a remount
 * observable even if React removes and recreates an identical-looking menu in
 * the same commit.
 */
type LayoutFamily =
  | "home"
  | "user-profile"
  | "settings"
  | "monitor"
  | "network"
  | "inventory";

interface SideMenuLifecycle {
  mounts: number;
  unmounts: number;
  countInitializations: number;
}

const sideMenuLifecycle: Record<LayoutFamily, SideMenuLifecycle> = {
  home: { mounts: 0, unmounts: 0, countInitializations: 0 },
  "user-profile": { mounts: 0, unmounts: 0, countInitializations: 0 },
  settings: { mounts: 0, unmounts: 0, countInitializations: 0 },
  monitor: { mounts: 0, unmounts: 0, countInitializations: 0 },
  network: { mounts: 0, unmounts: 0, countInitializations: 0 },
  inventory: { mounts: 0, unmounts: 0, countInitializations: 0 },
};

const familyTitle: Record<LayoutFamily, string> = {
  home: "Home",
  "user-profile": "User Profile",
  settings: "Settings",
  monitor: "Monitor",
  network: "Network",
  inventory: "Inventory",
};

const MockCountInitializer: FunctionComponent<{
  family: LayoutFamily;
}> = (props: { family: LayoutFamily }): ReactElement => {
  useEffect(() => {
    sideMenuLifecycle[props.family].countInitializations++;
  }, []);

  return (
    <span data-testid={`${props.family}-side-menu-count`}>Count ready</span>
  );
};

const MockPersistentSideMenu: FunctionComponent<{
  family: LayoutFamily;
}> = (props: { family: LayoutFamily }): ReactElement => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [localNote, setLocalNote] = useState<string>("");

  useEffect(() => {
    sideMenuLifecycle[props.family].mounts++;

    return () => {
      sideMenuLifecycle[props.family].unmounts++;
    };
  }, []);

  const title: string = familyTitle[props.family];

  return (
    <aside
      data-testid={`${props.family}-side-menu`}
      aria-label={`${title} test side menu`}
    >
      <button
        type="button"
        aria-expanded={!isCollapsed}
        onClick={() => {
          setIsCollapsed(!isCollapsed);
        }}
      >
        {title} test section
      </button>
      <label>
        {title} side menu note
        <input
          aria-label={`${title} side menu note`}
          value={localNote}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            setLocalNote(event.target.value);
          }}
        />
      </label>
      <MockCountInitializer family={props.family} />
    </aside>
  );
};

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Home/SideMenu",
  () => {
    return {
      __esModule: true,
      default: function MockHomeSideMenu(): ReactElement {
        return <MockPersistentSideMenu family="home" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/SideMenu",
  () => {
    return {
      __esModule: true,
      default: function MockUserProfileSideMenu(): ReactElement {
        return <MockPersistentSideMenu family="user-profile" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/SideMenu",
  () => {
    return {
      __esModule: true,
      default: function MockSettingsSideMenu(): ReactElement {
        return <MockPersistentSideMenu family="settings" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/SideMenu",
  () => {
    return {
      __esModule: true,
      default: function MockMonitorSideMenu(): ReactElement {
        return <MockPersistentSideMenu family="monitor" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Network/NetworkSideMenu",
  () => {
    return {
      __esModule: true,
      default: function MockNetworkSideMenu(): ReactElement {
        return <MockPersistentSideMenu family="network" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Inventory/SideMenu",
  () => {
    return {
      __esModule: true,
      default: function MockInventorySideMenu(): ReactElement {
        return <MockPersistentSideMenu family="inventory" />;
      },
    };
  },
);

interface SuspensionGate {
  promise: Promise<void>;
  resolved: boolean;
  resolve: () => void;
}

function createSuspensionGate(): SuspensionGate {
  let releasePromise: () => void = (): void => {
    return;
  };

  const gate: SuspensionGate = {
    promise: new Promise<void>((resolve: () => void) => {
      releasePromise = resolve;
    }),
    resolved: false,
    resolve: (): void => {
      gate.resolved = true;
      releasePromise();
    },
  };

  return gate;
}

interface InitialPaneProps {
  family: LayoutFamily;
  targetPath: string;
}

const InitialPane: FunctionComponent<InitialPaneProps> = (
  props: InitialPaneProps,
): ReactElement => {
  const navigate: ReturnType<typeof useNavigate> = useNavigate();
  const title: string = familyTitle[props.family];

  return (
    <div data-testid={`${props.family}-initial-content`}>
      <p>{title} initial content</p>
      <button
        type="button"
        onClick={() => {
          navigate(props.targetPath);
        }}
      >
        Open {title} lazy child
      </button>
    </div>
  );
};

interface SuspendedPaneProps {
  family: LayoutFamily;
  gate: SuspensionGate;
  initialPath: string;
}

const SuspendedPane: FunctionComponent<SuspendedPaneProps> = (
  props: SuspendedPaneProps,
): ReactElement => {
  const navigate: ReturnType<typeof useNavigate> = useNavigate();

  if (!props.gate.resolved) {
    /*
     * The promise is created before render and released by the test. This is
     * the same contract React.lazy exposes without relying on module-loading
     * speed, the filesystem cache, or a timer.
     */
    throw props.gate.promise;
  }

  const title: string = familyTitle[props.family];

  return (
    <div data-testid={`${props.family}-target-content`}>
      <p>{title} lazy child content</p>
      <button
        type="button"
        onClick={() => {
          navigate(props.initialPath);
        }}
      >
        Return to {title} initial child
      </button>
    </div>
  );
};

interface LayoutCase {
  family: LayoutFamily;
  parentRoute?: string | undefined;
  initialLeaf?: string | undefined;
  initialPath: string;
  targetLeaf: string;
  targetPath: string;
  renderLayout: () => ReactElement;
}

const project: Project = {
  _id: "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
  name: "Persistent layout test project",
} as Project;

const pageProps: PageComponentProps = {
  currentProject: project,
  hasPaymentMethod: true,
  pageRoute: RouteMap[PageMap.HOME] as Route,
};

function projectPath(page: PageMap): string {
  return (RouteMap[page] as Route)
    .toString()
    .replace(":projectId", project._id?.toString() || "");
}

const layoutCases: Array<LayoutCase> = [
  {
    family: "home",
    parentRoute: "/dashboard/:projectId/home",
    initialPath: `/dashboard/${project._id}/home`,
    targetLeaf: "active-alerts",
    targetPath: `/dashboard/${project._id}/home/active-alerts`,
    renderLayout: (): ReactElement => {
      return <HomeLayout {...pageProps} />;
    },
  },
  {
    family: "user-profile",
    parentRoute: "/dashboard/user-profile",
    initialLeaf: "overview",
    initialPath: "/dashboard/user-profile/overview",
    targetLeaf: "password-management",
    targetPath: "/dashboard/user-profile/password-management",
    renderLayout: (): ReactElement => {
      return <UserProfileLayout />;
    },
  },
  {
    family: "settings",
    parentRoute: "/dashboard/:projectId/settings",
    initialPath: `/dashboard/${project._id}/settings`,
    targetLeaf: "danger-zone",
    targetPath: `/dashboard/${project._id}/settings/danger-zone`,
    renderLayout: (): ReactElement => {
      return <SettingsLayout {...pageProps} />;
    },
  },
  {
    family: "monitor",
    initialLeaf: (RouteMap[PageMap.MONITORS] as Route).toString(),
    initialPath: projectPath(PageMap.MONITORS),
    targetLeaf: (RouteMap[PageMap.MONITOR_GROUPS] as Route).toString(),
    targetPath: projectPath(PageMap.MONITOR_GROUPS),
    renderLayout: (): ReactElement => {
      return <MonitorLayout {...pageProps} />;
    },
  },
  {
    family: "network",
    initialLeaf: (RouteMap[PageMap.NETWORK_DEVICES] as Route).toString(),
    initialPath: projectPath(PageMap.NETWORK_DEVICES),
    targetLeaf: (RouteMap[PageMap.NETWORK_SITES] as Route).toString(),
    targetPath: projectPath(PageMap.NETWORK_SITES),
    renderLayout: (): ReactElement => {
      return <NetworkLayout />;
    },
  },
  {
    family: "inventory",
    initialLeaf: (RouteMap[PageMap.INVENTORY] as Route).toString(),
    initialPath: projectPath(PageMap.INVENTORY),
    targetLeaf: (RouteMap[PageMap.TOPOLOGY] as Route).toString(),
    targetPath: projectPath(PageMap.TOPOLOGY),
    renderLayout: (): ReactElement => {
      return <InventoryLayout {...pageProps} />;
    },
  },
];

interface ModelDetailCase {
  name: string;
  family: "monitor" | "network" | "inventory";
  page: PageMap;
  renderLayout: () => ReactElement;
}

const modelDetailCases: Array<ModelDetailCase> = [
  {
    name: "monitor detail",
    family: "monitor",
    page: PageMap.MONITOR_VIEW,
    renderLayout: (): ReactElement => {
      return <MonitorLayout {...pageProps} />;
    },
  },
  {
    name: "monitor-group detail",
    family: "monitor",
    page: PageMap.MONITOR_GROUP_VIEW,
    renderLayout: (): ReactElement => {
      return <MonitorLayout {...pageProps} />;
    },
  },
  {
    name: "network-device detail",
    family: "network",
    page: PageMap.NETWORK_DEVICE_VIEW,
    renderLayout: (): ReactElement => {
      return <NetworkLayout />;
    },
  },
  {
    name: "network-site detail",
    family: "network",
    page: PageMap.NETWORK_SITE_VIEW,
    renderLayout: (): ReactElement => {
      return <NetworkLayout />;
    },
  },
  {
    name: "inventory-item detail",
    family: "inventory",
    page: PageMap.INVENTORY_VIEW,
    renderLayout: (): ReactElement => {
      return <InventoryLayout {...pageProps} />;
    },
  },
];

function modelPath(page: PageMap): string {
  return projectPath(page).replace(
    ":modelId",
    "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6c",
  );
}

function resetLifecycle(): void {
  for (const family of Object.keys(sideMenuLifecycle) as Array<LayoutFamily>) {
    sideMenuLifecycle[family].mounts = 0;
    sideMenuLifecycle[family].unmounts = 0;
    sideMenuLifecycle[family].countInitializations = 0;
  }
}

/*
 * Transitions off. Every react-router v7 router wraps its location update in
 * React.startTransition unless told otherwise, and under a transition React
 * keeps the previous UI on screen rather than showing the fallback of a
 * boundary that was already mounted - which is precisely the boundary these
 * cases are about. With transitions on, the suspending outlet never renders
 * its loader and the "important intermediate frame" below cannot be
 * observed at all.
 */
function renderLayoutCase(layoutCase: LayoutCase, gate: SuspensionGate): void {
  render(
    <MemoryRouter
      initialEntries={[layoutCase.initialPath]}
      useTransitions={false}
    >
      <Routes>
        <PageRoute
          path={layoutCase.parentRoute}
          element={layoutCase.renderLayout()}
        >
          {layoutCase.initialLeaf ? (
            <PageRoute
              path={layoutCase.initialLeaf}
              element={
                <InitialPane
                  family={layoutCase.family}
                  targetPath={layoutCase.targetPath}
                />
              }
            />
          ) : (
            <PageRoute
              index={true}
              element={
                <InitialPane
                  family={layoutCase.family}
                  targetPath={layoutCase.targetPath}
                />
              }
            />
          )}
          <PageRoute
            path={layoutCase.targetLeaf}
            element={
              <SuspendedPane
                family={layoutCase.family}
                gate={gate}
                initialPath={layoutCase.initialPath}
              />
            }
          />
        </PageRoute>
      </Routes>
    </MemoryRouter>,
  );
}

function getRightPane(sideMenu: HTMLElement): HTMLElement {
  const rightPane: Element | null = sideMenu.nextElementSibling;

  if (!rightPane) {
    throw new Error("The Page rendered no content pane beside its side menu.");
  }

  return rightPane as HTMLElement;
}

beforeEach(() => {
  resetLifecycle();
  localStorage.clear();
  sessionStorage.clear();

  /*
   * SettingsLayout asks this singleton for its breadcrumb route. App normally
   * keeps it synchronized from useLocation; the isolated router harness only
   * needs a stable Settings breadcrumb key.
   */
  jest
    .spyOn(Navigation, "getRoutePath")
    .mockReturnValue(RouteMap[PageMap.SETTINGS]!.toString());
  jest
    .spyOn(Navigation, "getBreadcrumbRoute")
    .mockReturnValue(RouteMap[PageMap.SETTINGS] as Route);
  jest
    .spyOn(Navigation, "getCurrentPath")
    .mockReturnValue(RouteMap[PageMap.SETTINGS] as Route);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("persistent side-menu layouts", () => {
  test.each(layoutCases)(
    "$family keeps the exact side menu, its state and its initialization while only the outlet suspends",
    async (layoutCase: LayoutCase) => {
      const gate: SuspensionGate = createSuspensionGate();
      renderLayoutCase(layoutCase, gate);

      const title: string = familyTitle[layoutCase.family];
      const sideMenu: HTMLElement = screen.getByTestId(
        `${layoutCase.family}-side-menu`,
      );
      const rightPane: HTMLElement = getRightPane(sideMenu);
      const sectionToggle: HTMLElement = screen.getByRole("button", {
        name: `${title} test section`,
      });
      const localNote: HTMLInputElement = screen.getByLabelText(
        `${title} side menu note`,
      ) as HTMLInputElement;

      expect(sideMenuLifecycle[layoutCase.family]).toEqual({
        mounts: 1,
        unmounts: 0,
        countInitializations: 1,
      });
      expect(sectionToggle).toHaveAttribute("aria-expanded", "true");
      expect(rightPane).toContainElement(
        screen.getByTestId(`${layoutCase.family}-initial-content`),
      );

      fireEvent.click(sectionToggle);
      fireEvent.change(localNote, { target: { value: "keep this state" } });

      expect(sectionToggle).toHaveAttribute("aria-expanded", "false");
      expect(localNote).toHaveValue("keep this state");

      fireEvent.click(
        screen.getByRole("button", {
          name: `Open ${title} lazy child`,
        }),
      );

      const loader: HTMLElement = await screen.findByTestId("bar-loader");

      /*
       * This is the regression's important intermediate frame. The old App-
       * wide boundary rendered the same loader with no Page around it, so a
       * visibility-only assertion on the menu after the chunk resolved could
       * never catch the blink or its state reset.
       */
      expect(
        screen.queryByTestId(`${layoutCase.family}-initial-content`),
      ).not.toBeVisible();
      expect(rightPane).toContainElement(loader);
      expect(sideMenu).toBe(
        screen.getByTestId(`${layoutCase.family}-side-menu`),
      );
      expect(rightPane).toBe(getRightPane(sideMenu));
      expect(sideMenu.isConnected).toBe(true);
      expect(sideMenu).toBeVisible();
      expect(rightPane).toBeVisible();
      expect(loader).toBeVisible();
      expect(sectionToggle).toHaveAttribute("aria-expanded", "false");
      expect(localNote).toHaveValue("keep this state");
      expect(sideMenuLifecycle[layoutCase.family]).toEqual({
        mounts: 1,
        unmounts: 0,
        countInitializations: 1,
      });

      await act(async () => {
        gate.resolve();
        await gate.promise;
      });

      const targetContent: HTMLElement = await screen.findByTestId(
        `${layoutCase.family}-target-content`,
      );

      expect(rightPane).toContainElement(targetContent);
      expect(screen.queryByTestId("bar-loader")).toBeNull();
      expect(sideMenu).toBe(
        screen.getByTestId(`${layoutCase.family}-side-menu`),
      );
      expect(rightPane).toBe(getRightPane(sideMenu));
      expect(sectionToggle).toHaveAttribute("aria-expanded", "false");
      expect(localNote).toHaveValue("keep this state");
      expect(sideMenuLifecycle[layoutCase.family]).toEqual({
        mounts: 1,
        unmounts: 0,
        countInitializations: 1,
      });

      /* The layout must also survive the completed child-to-child trip back. */
      fireEvent.click(
        screen.getByRole("button", {
          name: `Return to ${title} initial child`,
        }),
      );

      expect(
        await screen.findByTestId(`${layoutCase.family}-initial-content`),
      ).toBeInTheDocument();
      expect(sideMenu).toBe(
        screen.getByTestId(`${layoutCase.family}-side-menu`),
      );
      expect(rightPane).toBe(getRightPane(sideMenu));
      expect(sectionToggle).toHaveAttribute("aria-expanded", "false");
      expect(localNote).toHaveValue("keep this state");
      expect(sideMenuLifecycle[layoutCase.family]).toEqual({
        mounts: 1,
        unmounts: 0,
        countInitializations: 1,
      });
    },
  );

  test.each(modelDetailCases)(
    "$name passes through to one model-specific shell without the shared side menu",
    (detailCase: ModelDetailCase) => {
      jest
        .spyOn(Navigation, "getRoutePath")
        .mockReturnValue((RouteMap[detailCase.page] as Route).toString());

      render(
        <MemoryRouter initialEntries={[modelPath(detailCase.page)]}>
          <Routes>
            <PageRoute element={detailCase.renderLayout()}>
              <PageRoute
                path={(RouteMap[detailCase.page] as Route).toString()}
                element={
                  <section data-testid={`${detailCase.family}-model-shell`}>
                    <aside data-testid={`${detailCase.family}-model-side-menu`}>
                      Model-specific side menu
                    </aside>
                    <div>Model-specific detail content</div>
                  </section>
                }
              />
            </PageRoute>
          </Routes>
        </MemoryRouter>,
      );

      expect(
        screen.queryByTestId(`${detailCase.family}-side-menu`),
      ).not.toBeInTheDocument();
      expect(
        screen.getByTestId(`${detailCase.family}-model-shell`),
      ).toBeVisible();
      expect(
        screen.getAllByTestId(`${detailCase.family}-model-side-menu`),
      ).toHaveLength(1);
    },
  );
});

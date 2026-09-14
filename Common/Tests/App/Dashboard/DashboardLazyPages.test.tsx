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
import * as Router from "react-router-dom";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import type PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import type { ComponentProps as MasterPageProps } from "../../../../App/FeatureSet/Dashboard/src/Components/MasterPage/MasterPage";
import type Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import { CHUNK_LOAD_RELOAD_STORAGE_KEY } from "../../../UI/Components/ErrorBoundary";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Render the real App, router, Suspense and error boundary. Mock page bodies at
 * the module boundary so we can observe when each import actually executes,
 * without making API calls or importing every feature's UI into this suite.
 */
const dashboardSource: string = "../../../../App/FeatureSet/Dashboard/src";
const project: Project = { _id: "project-one", name: "Project One" } as Project;
const homePath: string = "/dashboard/project-one/home/";
const loadedPages: Array<string> = [];
const eagerPages: Array<string> = [];
const pageProps: Map<
  string,
  PageComponentProps & { onProjectDeleted?: () => Promise<void> }
> = new Map();
const getListMock: MockFunction = getJestMockFunction();
const navigateMock: MockFunction = getJestMockFunction();
const coldAppTestTimeout: number = 300_000;
const lazyLeafFindTimeout: number = 120_000;
let navigateHook: Router.NavigateFunction;
let currentPath: string = homePath;
let failingModule: string | undefined;
let suspendedModule: string | undefined;
let pageSuspensionGate: SuspensionGate | undefined;

type PersistentLayoutFamily =
  | "home"
  | "user-profile"
  | "settings"
  | "monitor"
  | "network"
  | "inventory";

interface SuspensionGate {
  promise: Promise<void>;
  resolved: boolean;
  resolve: () => void;
}

interface LayoutLifecycle {
  mounts: number;
  unmounts: number;
  countInitializations: number;
}

const layoutLifecycle: Record<PersistentLayoutFamily, LayoutLifecycle> = {
  home: { mounts: 0, unmounts: 0, countInitializations: 0 },
  "user-profile": { mounts: 0, unmounts: 0, countInitializations: 0 },
  settings: { mounts: 0, unmounts: 0, countInitializations: 0 },
  monitor: { mounts: 0, unmounts: 0, countInitializations: 0 },
  network: { mounts: 0, unmounts: 0, countInitializations: 0 },
  inventory: { mounts: 0, unmounts: 0, countInitializations: 0 },
};

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

function resetLayoutLifecycle(): void {
  for (const family of Object.keys(
    layoutLifecycle,
  ) as Array<PersistentLayoutFamily>) {
    layoutLifecycle[family].mounts = 0;
    layoutLifecycle[family].unmounts = 0;
    layoutLifecycle[family].countInitializations = 0;
  }
}

const MockLayoutCountInitializer: React.FunctionComponent<{
  family: PersistentLayoutFamily;
}> = (props: { family: PersistentLayoutFamily }): React.ReactElement => {
  React.useEffect(() => {
    layoutLifecycle[props.family].countInitializations++;
  }, []);

  return <span>Side-menu count initialized</span>;
};

const MockPersistentRouteLayout: React.FunctionComponent<{
  family: PersistentLayoutFamily;
}> = (props: { family: PersistentLayoutFamily }): React.ReactElement => {
  const [isCollapsed, setIsCollapsed] = React.useState<boolean>(false);
  const [localNote, setLocalNote] = React.useState<string>("");

  React.useEffect(() => {
    layoutLifecycle[props.family].mounts++;

    return () => {
      layoutLifecycle[props.family].unmounts++;
    };
  }, []);

  return (
    <div data-testid={`${props.family}-app-route-layout`}>
      <aside data-testid={`${props.family}-app-route-side-menu`}>
        <button
          type="button"
          aria-expanded={!isCollapsed}
          onClick={() => {
            setIsCollapsed(!isCollapsed);
          }}
        >
          Toggle {props.family} route section
        </button>
        <label>
          {props.family} route note
          <input
            aria-label={`${props.family} route note`}
            value={localNote}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              setLocalNote(event.target.value);
            }}
          />
        </label>
        <MockLayoutCountInitializer family={props.family} />
      </aside>
      <main data-testid={`${props.family}-app-route-content`}>
        <React.Suspense
          fallback={<div data-testid="page-loader">Loading page</div>}
        >
          <Router.Outlet />
        </React.Suspense>
      </main>
    </div>
  );
};

const persistentRouteLayoutModules: Array<{
  family: PersistentLayoutFamily;
  module: string;
}> = [
  { family: "home", module: "Home/Layout" },
  { family: "user-profile", module: "Global/UserProfile/Layout" },
  { family: "settings", module: "Settings/Layout" },
  { family: "monitor", module: "Monitor/Layout" },
  { family: "network", module: "Network/Layout" },
  { family: "inventory", module: "Inventory/Layout" },
];

const settingsProjectPageModule: string = "Settings/ProjectSettings";

/*
 * SettingsRoutes owns the route tree under test, but most of its leaf page
 * modules are eagerly imported and unrelated to lazy-route wiring. Mock those
 * bodies so this focused suite does not transform every Settings feature just
 * to reach the independently lazy Danger Zone leaf.
 */
const settingsEagerLeafModules: Array<string> = [
  "Settings/APIKeys",
  "Settings/APIKeyView",
  "Settings/TelemetryIngestionKeys",
  "Settings/TelemetryIngestionKeyView",
  "Settings/TelemetrySettings",
  "Settings/Labels",
  "Settings/FeatureFlags",
  "Settings/Domains",
  "Settings/Billing",
  "Settings/SSO",
  "Settings/OIDC",
  "Settings/SCIM",
  "Settings/NotificationLogs",
  "Settings/NotificationSettings",
  "Settings/Invoices",
  "Settings/MicrosoftTeamsIntegration",
  "Settings/UsageHistory",
  "Settings/SlackIntegration",
  "Settings/MobileApps",
  "Settings/AuditLogs",
  "Settings/AuditLogsSettings",
  "Settings/LlmProviders",
  "Settings/LlmProviderView",
  "Settings/Runners",
  "Settings/RunnerView",
  "Settings/RunnerCredentials",
  "Settings/AICredits",
  "Settings/AIGuardrails",
  "Settings/AILogs",
  "Settings/McpServer",
];

const persistentSharedRouteBundles: Array<string> = [
  "MonitorsRoutes",
  "MonitorGroupRoutes",
  "NetworkDeviceRoutes",
  "NetworkSiteRoutes",
  "InventoryRoutes",
  "TopologyRoutes",
];

interface PageCase {
  page: PageMap;
  module: string;
}

const secondaryPages: Array<PageCase> = [
  { page: PageMap.PROJECT_SSO, module: "Onboarding/SSO" },
  { page: PageMap.AI_COPILOT, module: "AICopilot/AICopilot" },
  { page: PageMap.AI_COPILOT_CONVERSATION, module: "AICopilot/AICopilot" },
  {
    page: PageMap.HOME_NOT_OPERATIONAL_MONITORS,
    module: "Home/NotOperationalMonitors",
  },
  { page: PageMap.HOME_ACTIVE_ALERTS, module: "Home/ActiveAlerts" },
  {
    page: PageMap.HOME_ONGOING_SCHEDULED_MAINTENANCE_EVENTS,
    module: "Home/OngoingScheduledMaintenance",
  },
  { page: PageMap.HOME_ACTIVE_EPISODES, module: "Home/ActiveEpisodes" },
  {
    page: PageMap.HOME_ACTIVE_INCIDENT_EPISODES,
    module: "Home/ActiveIncidentEpisodes",
  },
  { page: PageMap.SETTINGS_DANGERZONE, module: "Settings/DangerZone" },
  { page: PageMap.USER_PROFILE_PICTURE, module: "Global/UserProfile/Picture" },
  { page: PageMap.USER_PROFILE_OVERVIEW, module: "Global/UserProfile/Index" },
  {
    page: PageMap.USER_PROFILE_PASSWORD,
    module: "Global/UserProfile/Password",
  },
  { page: PageMap.USER_PASSKEYS, module: "Global/UserProfile/Passkeys" },
  {
    page: PageMap.USER_TWO_FACTOR_AUTH,
    module: "Global/UserProfile/TwoFactorAuth",
  },
  {
    page: PageMap.USER_PROFILE_DELETE,
    module: "Global/UserProfile/DeleteAccount",
  },
  { page: PageMap.PROJECT_INVITATIONS, module: "Global/ProjectInvitations" },
  { page: PageMap.ACTIVE_INCIDENTS, module: "Global/ActiveIncidents" },
  { page: PageMap.ACTIVE_ALERTS, module: "Global/ActiveAlerts" },
  { page: PageMap.ACTIVE_ALERT_EPISODES, module: "Global/ActiveAlertEpisodes" },
  {
    page: PageMap.ACTIVE_INCIDENT_EPISODES,
    module: "Global/ActiveIncidentEpisodes",
  },
  { page: PageMap.MY_ON_CALL_POLICIES, module: "Global/MyOnCallPolicies" },
];

jest.mock("../../../UI/Config", () => {
  return {
    BILLING_ENABLED: false,
    APP_API_URL: {
      toString: () => {
        return "http://localhost/api";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ErrorSupportBundle", () => {
  return { downloadErrorSupportBundle: jest.fn() };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      setNavigateHook: (hook: Router.NavigateFunction) => {
        navigateHook = hook;
      },
      setLocation: (location: Router.Location) => {
        currentPath = location.pathname;
      },
      setParams: jest.fn(),
      getCurrentRoute: () => {
        return new Route(currentPath);
      },
      navigate: (route: Route) => {
        navigateMock(route);
        navigateHook(route.toString());
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return { __esModule: true, default: { setCurrentProject: jest.fn() } };
});

jest.mock("../../../UI/Utils/GlobalEvents", () => {
  return {
    __esModule: true,
    default: { addEventListener: jest.fn(), removeEventListener: jest.fn() },
  };
});

jest.mock("../../../Models/DatabaseModels/Project", () => {
  return { __esModule: true, default: class Project {} };
});

jest.mock("../../../Models/DatabaseModels/BillingPaymentMethod", () => {
  return { __esModule: true, default: class BillingPaymentMethod {} };
});

jest.mock("../../../UI/Components/Loader/PageLoader", () => {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid="page-loader">Loading page</div>;
    },
  };
});

function pathFor(page: PageMap): string {
  return RouteMap[page]!.toString()
    .replace(":projectId", "project-one")
    .replace(":id", "conversation-one");
}

interface AppRouteWiringCase {
  family: PersistentLayoutFamily;
  initialPage: PageMap;
  initialContent: string;
  targetPage: PageMap;
  targetModule: string;
}

const appRouteWiringCases: Array<AppRouteWiringCase> = [
  {
    family: "home",
    initialPage: PageMap.HOME,
    initialContent: "Home/Home",
    targetPage: PageMap.HOME_ACTIVE_ALERTS,
    targetModule: "Home/ActiveAlerts",
  },
  {
    family: "user-profile",
    initialPage: PageMap.USER_PROFILE_OVERVIEW,
    initialContent: "Global/UserProfile/Index",
    targetPage: PageMap.USER_PROFILE_PASSWORD,
    targetModule: "Global/UserProfile/Password",
  },
  {
    family: "settings",
    initialPage: PageMap.SETTINGS,
    initialContent: "Settings/ProjectSettings",
    targetPage: PageMap.SETTINGS_DANGERZONE,
    targetModule: "Settings/DangerZone",
  },
  {
    family: "monitor",
    initialPage: PageMap.MONITORS,
    initialContent: "Routes/MonitorsRoutes",
    targetPage: PageMap.MONITOR_GROUPS,
    targetModule: "Routes/MonitorGroupRoutes",
  },
  {
    family: "network",
    initialPage: PageMap.NETWORK_DEVICES,
    initialContent: "Routes/NetworkDeviceRoutes",
    targetPage: PageMap.NETWORK_SITES,
    targetModule: "Routes/NetworkSiteRoutes",
  },
  {
    family: "inventory",
    initialPage: PageMap.INVENTORY,
    initialContent: "Routes/InventoryRoutes",
    targetPage: PageMap.TOPOLOGY,
    targetModule: "Routes/TopologyRoutes",
  },
];

function mockSecondaryPage(module: string): void {
  jest.doMock(`${dashboardSource}/Pages/${module}`, () => {
    loadedPages.push(module);
    if (module === failingModule) {
      throw new Error("Failed to fetch dynamically imported module");
    }
    return {
      __esModule: true,
      default: (props: PageComponentProps): React.ReactElement => {
        pageProps.set(module, props);

        const gate: SuspensionGate | undefined = pageSuspensionGate;
        if (module === suspendedModule && gate && !gate.resolved) {
          throw gate.promise;
        }

        return <div data-testid="secondary-page">{module}</div>;
      },
    };
  });
}

function mockPersistentSharedRouteBundle(module: string): void {
  const moduleName: string = `Routes/${module}`;

  jest.doMock(`${dashboardSource}/Routes/${module}`, () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        const gate: SuspensionGate | undefined = pageSuspensionGate;
        if (moduleName === suspendedModule && gate && !gate.resolved) {
          throw gate.promise;
        }

        return <div data-testid="secondary-route-bundle">{moduleName}</div>;
      },
    };
  });
}

function mockPersistentRouteLayouts(): void {
  for (const layout of persistentRouteLayoutModules) {
    jest.doMock(`${dashboardSource}/Pages/${layout.module}`, () => {
      return {
        __esModule: true,
        default: (): React.ReactElement => {
          return <MockPersistentRouteLayout family={layout.family} />;
        },
      };
    });
  }

  jest.doMock(`${dashboardSource}/Pages/${settingsProjectPageModule}`, () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div>Settings/ProjectSettings</div>;
      },
    };
  });

  for (const module of settingsEagerLeafModules) {
    jest.doMock(`${dashboardSource}/Pages/${module}`, () => {
      return {
        __esModule: true,
        default: (): React.ReactElement => {
          return <div>{module}</div>;
        },
      };
    });
  }
}

beforeEach(() => {
  // Each test starts with a cold module cache, like a fresh dashboard document.
  jest.resetModules();
  jest.clearAllMocks();
  loadedPages.length = 0;
  eagerPages.length = 0;
  pageProps.clear();
  failingModule = undefined;
  suspendedModule = undefined;
  pageSuspensionGate = undefined;
  resetLayoutLifecycle();
  currentPath = homePath;
  getListMock.mockResolvedValue({ data: [project], count: 1 });
  sessionStorage.clear();

  // Keep the renderer and router on the same React instance after resetting.
  jest.doMock("react", () => {
    return React;
  });
  jest.doMock("react-router-dom", () => {
    return Router;
  });
  mockPersistentRouteLayouts();

  for (const module of new Set(
    secondaryPages.map((page: PageCase): string => {
      return page.module;
    }),
  )) {
    mockSecondaryPage(module);
  }

  for (const module of persistentSharedRouteBundles) {
    mockPersistentSharedRouteBundle(module);
  }

  for (const module of [
    "Home/Home",
    "Onboarding/Welcome",
    "Logout/Logout",
    "PageNotFound/PageNotFound",
  ]) {
    jest.doMock(`${dashboardSource}/Pages/${module}`, () => {
      eagerPages.push(module);
      return {
        __esModule: true,
        default: (props: PageComponentProps): React.ReactElement => {
          pageProps.set(module, props);
          return <div data-testid="eager-page">{module}</div>;
        },
      };
    });
  }

  for (const module of [
    "AIChat/AIChatPanel",
    "CommandPalette/DashboardCommandPalette",
    "KeyboardShortcuts/DashboardKeyboardShortcuts",
    "UserTimezone/UserTimezoneInit",
  ]) {
    jest.doMock(`${dashboardSource}/Components/${module}`, () => {
      return {
        __esModule: true,
        default: () => {
          return null;
        },
      };
    });
  }

  jest.doMock(`${dashboardSource}/Components/MasterPage/MasterPage`, () => {
    return {
      __esModule: true,
      default: (props: MasterPageProps): React.ReactElement => {
        return (
          <div>
            <header>Dashboard shell</header>
            <button
              onClick={() => {
                props.onProjectSelected(project);
              }}
            >
              Select project
            </button>
            <div data-testid="project-count">{props.projects.length}</div>
            {props.children}
          </div>
        );
      },
    };
  });

  jest.doMock(`${dashboardSource}/Routes/InitRoutes`, () => {
    return {
      __esModule: true,
      default: () => {
        return <div>Project selection</div>;
      },
    };
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  sessionStorage.clear();
});

/*
 * `useRouterTransition: false` is how a caller asks to OBSERVE the Suspense
 * fallback at all.
 *
 * Every react-router v7 router wraps its location update in
 * React.startTransition unless it is told not to (BrowserRouter and
 * MemoryRouter both take `useTransitions`). Under a transition React keeps
 * the previous UI on screen while the new subtree suspends, and it only
 * shows a fallback for a boundary the navigation itself mounted - so a
 * PERSISTENT layout's boundary, which is exactly what the wiring cases
 * below are about, never renders its loader and the assertion times out
 * against a right pane still showing the page it started on.
 *
 * These two branches used to differ by a v7 future flag, which was removed
 * when it stopped being a flag; the parameter outlived its wiring and both
 * branches became the same render.
 */
function renderApp(path: string, useRouterTransition: boolean = true): void {
  const App: React.FunctionComponent = (
    jest.requireActual(`${dashboardSource}/App`) as {
      default: React.FunctionComponent;
    }
  ).default;

  render(
    <Router.MemoryRouter
      initialEntries={[path]}
      useTransitions={useRouterTransition}
    >
      <App />
    </Router.MemoryRouter>,
  );
}

describe("dashboard secondary page loading", () => {
  test(
    "renders Home without loading any secondary leaf modules",
    async () => {
      renderApp(homePath);

      expect(screen.getByTestId("eager-page")).toHaveTextContent("Home/Home");
      expect(screen.queryByTestId("page-loader")).not.toBeInTheDocument();
      await waitFor(() => {
        expect(screen.getByTestId("project-count")).toHaveTextContent("1");
      });
      expect(loadedPages).toEqual([]);
      expect(eagerPages).toEqual([
        "Onboarding/Welcome",
        "Home/Home",
        "Logout/Logout",
        "PageNotFound/PageNotFound",
      ]);
      expect(pageProps.get("Home/Home")).toMatchObject({
        projects: [project],
        isLoadingProjects: false,
      });
    },
    coldAppTestTimeout,
  );

  test.each(secondaryPages)(
    "loads only $module for a direct $page navigation and keeps its props",
    async (page: PageCase) => {
      renderApp(pathFor(page.page));

      expect(screen.getByTestId("page-loader")).toBeInTheDocument();
      expect(screen.getByText("Dashboard shell")).toBeInTheDocument();
      expect(
        await screen.findByTestId(
          "secondary-page",
          {},
          { timeout: lazyLeafFindTimeout },
        ),
      ).toHaveTextContent(page.module);
      expect(screen.queryByTestId("page-loader")).not.toBeInTheDocument();
      expect(loadedPages).toEqual([page.module]);
      expect(pageProps.get(page.module)).toMatchObject({
        currentProject: null,
        hasPaymentMethod: true,
      });
      expect(pageProps.get(page.module)!.pageRoute.toString()).toBe(
        RouteMap[page.page]!.toString(),
      );

      fireEvent.click(screen.getByRole("button", { name: "Select project" }));
      await waitFor(() => {
        expect(pageProps.get(page.module)!.currentProject).toBe(project);
      });
      expect(pageProps.get(page.module)!.pageRoute.toString()).toBe(
        RouteMap[page.page]!.toString(),
      );
      expect(loadedPages).toEqual([page.module]);
      expect(navigateMock).not.toHaveBeenCalled();
    },
    coldAppTestTimeout,
  );

  test("loads pages when navigating from Home and reuses them on return", async () => {
    renderApp(homePath);
    await waitFor(() => {
      expect(screen.getByTestId("project-count")).toHaveTextContent("1");
    });
    expect(loadedPages).toEqual([]);

    await act(async () => {
      navigateHook(pathFor(PageMap.USER_PROFILE_OVERVIEW));
    });
    expect(await screen.findByTestId("secondary-page")).toHaveTextContent(
      "Global/UserProfile/Index",
    );
    await act(async () => {
      navigateHook(pathFor(PageMap.ACTIVE_ALERTS));
    });
    expect(await screen.findByTestId("secondary-page")).toHaveTextContent(
      "Global/ActiveAlerts",
    );
    await act(async () => {
      navigateHook(pathFor(PageMap.USER_PROFILE_OVERVIEW));
    });
    expect(screen.getByTestId("secondary-page")).toHaveTextContent(
      "Global/UserProfile/Index",
    );
    expect(loadedPages).toEqual([
      "Global/UserProfile/Index",
      "Global/ActiveAlerts",
    ]);
  });

  test.each(appRouteWiringCases)(
    "$family child routes stay inside their persistent layout in the real App route tree",
    async (routeCase: AppRouteWiringCase) => {
      const gate: SuspensionGate = createSuspensionGate();
      suspendedModule = routeCase.targetModule;
      pageSuspensionGate = gate;

      /*
       * Transitions off, so the controlled lazy child actually exposes the
       * layout's nearest Suspense fallback - see renderApp. What is under
       * test is WHERE that boundary sits, not how React schedules it.
       */
      renderApp(pathFor(routeCase.initialPage), false);
      expect(
        await screen.findByText(routeCase.initialContent),
      ).toBeInTheDocument();

      const sideMenu: HTMLElement = screen.getByTestId(
        `${routeCase.family}-app-route-side-menu`,
      );
      const rightPane: HTMLElement = screen.getByTestId(
        `${routeCase.family}-app-route-content`,
      );
      const sectionToggle: HTMLElement = screen.getByRole("button", {
        name: `Toggle ${routeCase.family} route section`,
      });
      const localNote: HTMLInputElement = screen.getByLabelText(
        `${routeCase.family} route note`,
      ) as HTMLInputElement;

      fireEvent.click(sectionToggle);
      fireEvent.change(localNote, {
        target: { value: "preserve App route state" },
      });

      expect(sectionToggle).toHaveAttribute("aria-expanded", "false");
      expect(localNote).toHaveValue("preserve App route state");
      expect(layoutLifecycle[routeCase.family]).toEqual({
        mounts: 1,
        unmounts: 0,
        countInitializations: 1,
      });

      await act(async () => {
        navigateHook(pathFor(routeCase.targetPage));
      });

      const loader: HTMLElement = await screen.findByTestId("page-loader");

      /*
       * These assertions exercise App.tsx (and SettingsRoutes for Danger),
       * rather than a hand-built route tree. Making a leaf route a sibling of
       * its layout moves this loader to App's outer boundary, disconnects this
       * exact menu node and resets both pieces of local state.
       */
      expect(rightPane).toContainElement(loader);
      expect(sideMenu).toBe(
        screen.getByTestId(`${routeCase.family}-app-route-side-menu`),
      );
      expect(sideMenu.isConnected).toBe(true);
      expect(sideMenu).toBeVisible();
      expect(rightPane).toBeVisible();
      expect(loader).toBeVisible();
      expect(sectionToggle).toHaveAttribute("aria-expanded", "false");
      expect(localNote).toHaveValue("preserve App route state");
      expect(layoutLifecycle[routeCase.family]).toEqual({
        mounts: 1,
        unmounts: 0,
        countInitializations: 1,
      });

      await act(async () => {
        gate.resolve();
        await gate.promise;
      });

      expect(
        await screen.findByText(routeCase.targetModule),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("page-loader")).not.toBeInTheDocument();
      expect(sideMenu).toBe(
        screen.getByTestId(`${routeCase.family}-app-route-side-menu`),
      );
      expect(rightPane).toBe(
        screen.getByTestId(`${routeCase.family}-app-route-content`),
      );
      expect(sectionToggle).toHaveAttribute("aria-expanded", "false");
      expect(localNote).toHaveValue("preserve App route state");
      expect(layoutLifecycle[routeCase.family]).toEqual({
        mounts: 1,
        unmounts: 0,
        countInitializations: 1,
      });
    },
  );

  test("preserves the project-deleted callback on the deferred danger zone page", async () => {
    renderApp(pathFor(PageMap.SETTINGS_DANGERZONE));
    await screen.findByTestId("secondary-page");
    fireEvent.click(screen.getByRole("button", { name: "Select project" }));
    expect(pageProps.get("Settings/DangerZone")!.currentProject).toBe(project);
    getListMock.mockResolvedValueOnce({ data: [], count: 0 });

    await act(async () => {
      await pageProps.get("Settings/DangerZone")!.onProjectDeleted!();
    });

    expect(await screen.findByText("Project selection")).toBeInTheDocument();
    expect(getListMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("project-count")).toHaveTextContent("0");
    expect(navigateMock.mock.calls[0]![0].toString()).toBe(
      RouteMap[PageMap.INIT]!.toString(),
    );
  });

  test("contains a failed page import and recovers when navigating Home", async () => {
    failingModule = "Global/UserProfile/Index";
    // Exercise fallback after the existing one-reload chunk recovery is exhausted.
    sessionStorage.setItem(
      CHUNK_LOAD_RELOAD_STORAGE_KEY,
      Date.now().toString(),
    );
    jest.spyOn(console, "error").mockImplementation(() => {
      return;
    });
    renderApp(pathFor(PageMap.USER_PROFILE_OVERVIEW));

    expect(
      await screen.findByTestId("error-boundary-fallback"),
    ).toBeInTheDocument();
    expect(screen.getByText("Dashboard shell")).toBeInTheDocument();
    expect(
      screen.getByTestId("error-boundary-error-message"),
    ).toHaveTextContent("Failed to fetch dynamically imported module");
    expect(loadedPages).toEqual(["Global/UserProfile/Index"]);

    await act(async () => {
      navigateHook(homePath);
    });

    expect(screen.getByTestId("eager-page")).toHaveTextContent("Home/Home");
    expect(
      screen.queryByTestId("error-boundary-fallback"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Dashboard shell")).toBeInTheDocument();
  });
});

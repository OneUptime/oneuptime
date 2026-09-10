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
let navigateHook: Router.NavigateFunction;
let currentPath: string = homePath;
let failingModule: string | undefined;

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

beforeEach(() => {
  // Each test starts with a cold module cache, like a fresh dashboard document.
  jest.resetModules();
  jest.clearAllMocks();
  loadedPages.length = 0;
  eagerPages.length = 0;
  pageProps.clear();
  failingModule = undefined;
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

  for (const module of new Set(
    secondaryPages.map((page: PageCase): string => {
      return page.module;
    }),
  )) {
    jest.doMock(`${dashboardSource}/Pages/${module}`, () => {
      loadedPages.push(module);
      if (module === failingModule) {
        throw new Error("Failed to fetch dynamically imported module");
      }
      return {
        __esModule: true,
        default: (props: PageComponentProps): React.ReactElement => {
          pageProps.set(module, props);
          return <div data-testid="secondary-page">{module}</div>;
        },
      };
    });
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

function renderApp(path: string): void {
  const App: React.FunctionComponent = (
    jest.requireActual(`${dashboardSource}/App`) as {
      default: React.FunctionComponent;
    }
  ).default;
  render(
    <Router.MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
    </Router.MemoryRouter>,
  );
}

describe("dashboard secondary page loading", () => {
  test("renders Home without loading any secondary page modules", async () => {
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
  });

  test.each(secondaryPages)(
    "loads only $module for a direct $page navigation and keeps its props",
    async (page: PageCase) => {
      renderApp(pathFor(page.page));

      expect(screen.getByTestId("page-loader")).toBeInTheDocument();
      expect(screen.getByText("Dashboard shell")).toBeInTheDocument();
      expect(await screen.findByTestId("secondary-page")).toHaveTextContent(
        page.module,
      );
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

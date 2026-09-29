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
import React, { ReactElement, useEffect } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { format } from "util";
import EventName from "../../../../App/FeatureSet/Dashboard/src/Utils/EventName";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import type Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import SSOAuthorizationException from "../../../Types/Exception/SsoAuthorizationException";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import Navigation from "../../../UI/Utils/Navigation";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * App.tsx keeps the shell's error in state and hands it to the master page,
 * which turns an SSO error into a redirect to the project's SSO page. Nothing
 * ever cleared that error, so once it was set it stayed set: the redirect ran
 * again whenever the shell re-rendered (bouncing a user who had left /sso back
 * to it), and a later SSO failure could not redirect at all, because setting
 * the same string again is not a state change.
 *
 * The only thing that set that error was the billing payment-method count,
 * so with billing disabled the shell's own redirect could never run. (Pages
 * whose data comes through ModelAPI redirect on their own, but only once the
 * project's details are cached.) The header's on-call lookup, which runs for
 * every project, now reports it too.
 *
 * The real App, real master page, real router and real Navigation run here.
 * Page bodies, the chrome around them (header, nav bar, footer), project
 * storage, config and the network are stubbed.
 */

// Shaped like a real project id.
const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const HOME_PATH: string = `/dashboard/${PROJECT_ID}/home`;
const SSO_PATH: string = RouteMap[PageMap.PROJECT_SSO]!.toString().replace(
  ":projectId",
  PROJECT_ID,
);
const SSO_ERROR: string = new SSOAuthorizationException().message;
const project: Project = { _id: PROJECT_ID, name: "Project One" } as Project;

const getListMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
let billingEnabled: boolean = true;

jest.mock("../../../UI/Config", () => {
  const config: Record<string, unknown> = {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
  };
  Object.defineProperty(config, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabled;
    },
  });
  return config;
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      count: (...args: Array<unknown>) => {
        return countMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: Error): string => {
        return error.message;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  const actualObjectId: typeof import("../../../Types/ObjectID") =
    jest.requireActual(
      "../../../Types/ObjectID",
    ) as typeof import("../../../Types/ObjectID");
  return {
    __esModule: true,
    default: {
      setCurrentProject: jest.fn(),
      getCurrentProjectId: () => {
        return new actualObjectId.default(
          "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
        );
      },
      setIsSubscriptionInactiveOrOverdue: () => {
        return false;
      },
    },
  };
});

/*
 * The header is where a user picks a project in the real shell, and where the
 * on-call lookup reports an SSO error. Its stand-in keeps only those two.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Header/Header",
  () => {
    const react: typeof React = jest.requireActual("react") as typeof React;
    return {
      __esModule: true,
      default: (props: {
        projects: Array<Project>;
        onProjectSelected: (project: Project) => void;
        onSsoAuthorizationRequired?: (() => void) | undefined;
      }): ReactElement => {
        return react.createElement(
          react.Fragment,
          null,
          react.createElement(
            "button",
            {
              onClick: () => {
                props.onProjectSelected(props.projects[0]!);
              },
            },
            "Select project",
          ),
          react.createElement(
            "button",
            {
              onClick: () => {
                props.onSsoAuthorizationRequired?.();
              },
            },
            "On-call lookup needs SSO",
          ),
        );
      },
    };
  },
);

function mockEmpty(): { __esModule: true; default: () => null } {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
}

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NavBar/NavBar",
  () => {
    return mockEmpty();
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Footer/Footer",
  () => {
    return mockEmpty();
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/AIChatPanel",
  () => {
    return mockEmpty();
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPalette",
  () => {
    return mockEmpty();
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/KeyboardShortcuts/DashboardKeyboardShortcuts",
  () => {
    return mockEmpty();
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/UserTimezone/UserTimezoneInit",
  () => {
    return mockEmpty();
  },
);
jest.mock("../../../../App/FeatureSet/Dashboard/src/Routes/InitRoutes", () => {
  return mockEmpty();
});
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Onboarding/Welcome",
  () => {
    return mockEmpty();
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Logout/Logout",
  () => {
    return mockEmpty();
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/PageNotFound/PageNotFound",
  () => {
    return mockEmpty();
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Inventory/Layout",
  () => {
    return mockEmpty();
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Layout",
  () => {
    return mockEmpty();
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Network/Layout",
  () => {
    return mockEmpty();
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/Layout",
  () => {
    return mockEmpty();
  },
);
jest.mock("../../../../App/FeatureSet/Dashboard/src/Pages/Home/Layout", () => {
  const router: typeof import("react-router-dom") = jest.requireActual(
    "react-router-dom",
  ) as typeof import("react-router-dom");
  const react: typeof React = jest.requireActual("react") as typeof React;
  return {
    __esModule: true,
    default: (): ReactElement => {
      return react.createElement(router.Outlet);
    },
  };
});
jest.mock("../../../../App/FeatureSet/Dashboard/src/Pages/Home/Home", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;
  return {
    __esModule: true,
    default: (): ReactElement => {
      return react.createElement("div", { "data-testid": "home-page" });
    },
  };
});
// Lazy in App.tsx, so it loads only once the redirect lands on /sso.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Onboarding/SSO",
  () => {
    const react: typeof React = jest.requireActual("react") as typeof React;
    return {
      __esModule: true,
      default: (): ReactElement => {
        return react.createElement("div", { "data-testid": "sso-page" });
      },
    };
  },
);

interface CallRecorder {
  mock: { calls: Array<Array<unknown>> };
}

let visitedPaths: Array<string> = [];
let navigateSpy: CallRecorder;
let consoleErrorSpy: CallRecorder;
let consoleWarnSpy: CallRecorder;

const LocationProbe: () => ReactElement = (): ReactElement => {
  const location: ReturnType<typeof useLocation> = useLocation();

  useEffect(() => {
    visitedPaths.push(location.pathname);
  }, [location.key]);

  return <output data-testid="current-path">{location.pathname}</output>;
};

/*
 * Loaded through a computed path, the way DashboardLazyPages does it: a
 * static import would pull App.tsx's whole lazy route graph (rrweb and all)
 * into `npm run compile-tests`, where only Common's packages are installed.
 */
const APP_MODULE: string = "../../../../App/FeatureSet/Dashboard/src/App";

function loadApp(): React.FunctionComponent {
  return (
    jest.requireActual(`${APP_MODULE}`) as { default: React.FunctionComponent }
  ).default;
}

async function renderApp(): Promise<void> {
  const App: React.FunctionComponent = loadApp();

  await act(async () => {
    render(
      <MemoryRouter initialEntries={[HOME_PATH]} useTransitions={false}>
        <App />
        <LocationProbe />
      </MemoryRouter>,
    );
  });
}

function currentPath(): string {
  return screen.getByTestId("current-path").textContent || "";
}

function ssoNavigations(): number {
  return navigateSpy.mock.calls.filter((call: Array<unknown>): boolean => {
    return String(call[0]) === SSO_PATH;
  }).length;
}

function consoleMessages(spy: CallRecorder): Array<string> {
  return spy.mock.calls.map((call: Array<unknown>): string => {
    return format(...call);
  });
}

function expectNoRenderPhaseNavigation(): void {
  expect(
    consoleMessages(consoleErrorSpy).filter((message: string): boolean => {
      return message.includes("Cannot update a component");
    }),
  ).toEqual([]);
  expect(
    consoleMessages(consoleWarnSpy).filter((message: string): boolean => {
      return message.includes(
        "You should call navigate() in a React.useEffect",
      );
    }),
  ).toEqual([]);
}

/*
 * Buttons are found before act() opens: inside an async act scope React
 * queues renders until the scope closes, so a findBy there cannot wait for
 * anything new.
 */
async function click(text: string): Promise<void> {
  const button: HTMLElement = await screen.findByText(text);

  await act(async () => {
    fireEvent.click(button);
  });
}

// Select the project; its payment-method count fails with the SSO error.
async function failBillingLookupWithSso(): Promise<void> {
  countMock.mockRejectedValueOnce(new Error(SSO_ERROR));
  await click("Select project");
}

async function failOnCallLookupWithSso(): Promise<void> {
  await click("On-call lookup needs SSO");
}

async function leaveSsoPage(): Promise<void> {
  await act(async () => {
    Navigation.navigate(new Route(HOME_PATH));
  });
}

async function refreshProjects(): Promise<void> {
  await act(async () => {
    GlobalEvents.dispatchEvent(EventName.PROJECT_INVITATIONS_REFRESH);
  });
}

beforeEach(() => {
  visitedPaths = [];
  billingEnabled = true;
  getListMock.mockReset();
  countMock.mockReset();
  getListMock.mockResolvedValue({ data: [project], count: 1 });
  countMock.mockResolvedValue(1);
  navigateSpy = getJestSpyOn(Navigation, "navigate");
  consoleErrorSpy = getJestSpyOn(console, "error").mockImplementation(() => {});
  consoleWarnSpy = getJestSpyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("dashboard shell SSO error handling", () => {
  test("an SSO failure redirects to the project's SSO page once", async () => {
    await renderApp();
    await failBillingLookupWithSso();

    expect(await screen.findByTestId("sso-page")).toBeInTheDocument();
    expect(currentPath()).toBe(SSO_PATH);
    expect(ssoNavigations()).toBe(1);
    expectNoRenderPhaseNavigation();
  });

  test("leaving /sso does not bounce the user back, even as the shell re-renders", async () => {
    await renderApp();
    await failBillingLookupWithSso();
    await screen.findByTestId("sso-page");

    await leaveSsoPage();
    // A project refresh re-renders the whole shell (loading on, then off).
    await refreshProjects();

    expect(await screen.findByTestId("home-page")).toBeInTheDocument();
    expect(currentPath()).toBe(HOME_PATH);
    expect(visitedPaths).toEqual([HOME_PATH, SSO_PATH, HOME_PATH]);
    expect(ssoNavigations()).toBe(1);
    expectNoRenderPhaseNavigation();
  });

  test("the handled SSO error is cleared, so a later SSO failure redirects again", async () => {
    await renderApp();
    await failBillingLookupWithSso();
    await screen.findByTestId("sso-page");
    await leaveSsoPage();
    await screen.findByTestId("home-page");

    await failOnCallLookupWithSso();

    expect(await screen.findByTestId("sso-page")).toBeInTheDocument();
    expect(currentPath()).toBe(SSO_PATH);
    expect(visitedPaths).toEqual([HOME_PATH, SSO_PATH, HOME_PATH, SSO_PATH]);
    expect(ssoNavigations()).toBe(2);
    expectNoRenderPhaseNavigation();
  });

  test("with billing disabled, the header's SSO report still reaches the SSO page", async () => {
    billingEnabled = false;

    await renderApp();
    await click("Select project");
    // Nothing billing-related runs, so only the header's report can redirect.
    expect(countMock).not.toHaveBeenCalled();
    expect(currentPath()).toBe(HOME_PATH);

    await failOnCallLookupWithSso();

    expect(await screen.findByTestId("sso-page")).toBeInTheDocument();
    expect(currentPath()).toBe(SSO_PATH);
    expect(ssoNavigations()).toBe(1);
    expect(screen.queryByText(SSO_ERROR)).not.toBeInTheDocument();
    expectNoRenderPhaseNavigation();
  });

  test("an SSO report on the SSO page itself stays put and is cleared", async () => {
    await renderApp();
    await failBillingLookupWithSso();
    await screen.findByTestId("sso-page");

    // Already there: no new history entry, and no error dialog.
    await failOnCallLookupWithSso();
    expect(currentPath()).toBe(SSO_PATH);
    expect(visitedPaths).toEqual([HOME_PATH, SSO_PATH]);
    expect(screen.queryByText(SSO_ERROR)).not.toBeInTheDocument();

    await leaveSsoPage();
    await refreshProjects();
    expect(await screen.findByTestId("home-page")).toBeInTheDocument();
    expect(visitedPaths).toEqual([HOME_PATH, SSO_PATH, HOME_PATH]);

    // Had the in-place report lingered, this one would not be a state change.
    await failOnCallLookupWithSso();

    expect(await screen.findByTestId("sso-page")).toBeInTheDocument();
    expect(visitedPaths).toEqual([HOME_PATH, SSO_PATH, HOME_PATH, SSO_PATH]);
    expectNoRenderPhaseNavigation();
  });
});

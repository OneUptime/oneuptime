import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import EventName from "../../../../App/FeatureSet/Dashboard/src/Utils/EventName";
import { resumePendingMcpAuthorization } from "../../../../App/FeatureSet/Dashboard/src/Utils/McpAuthorizationResume";
import type Project from "../../../Models/DatabaseModels/Project";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import McpOAuthPendingAuthorization from "../../../UI/Utils/McpOAuthPendingAuthorization";
import Navigation from "../../../UI/Utils/Navigation";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * An MCP authorization that had to stop for a sign-in, picked back up.
 *
 * The consent screen leaves the request in a cookie before it finds out
 * nobody is signed in. Every way of signing in ends on the dashboard, so the
 * dashboard, once its project list has loaded, sends the browser back to the
 * consent screen with the request.
 *
 * The real App shell, the real resume helper, the real cookie and the real
 * Navigation run here; only the full-page navigation itself is recorded
 * rather than performed (jsdom cannot navigate). Page bodies, the chrome
 * around them, project storage, config and the network are stubbed, the same
 * way DashboardAppSsoError.test.tsx stubs them.
 *
 * What is pinned:
 *
 *  - a request that is waiting sends the browser to the consent screen, as a
 *    full page load, exactly once - and the dashboard does not render itself
 *    underneath a navigation that is already leaving;
 *  - nothing waiting: the dashboard loads as it always has;
 *  - a cookie that is not a request is thrown away rather than followed;
 *  - with no session (the project list fails), the request stays where it is
 *    for after the sign-in - the dashboard must not eat it on the way to the
 *    sign-in page.
 */

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const HOME_PATH: string = `/dashboard/${PROJECT_ID}/home`;
const project: Project = { _id: PROJECT_ID, name: "Project One" } as Project;

const COOKIE_NAME: string = "oneuptime-mcp-oauth-pending-request";
const TICKET: string = `v1.${"cGF5bG9hZA".repeat(4)}.${"s".repeat(43)}`;
const CONSENT_ROUTE: string = `/accounts/mcp-authorize?request=${TICKET}`;

const getListMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Config", () => {
  return {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
    __esModule: true,
    BILLING_ENABLED: false,
  };
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

function mockEmpty(): { __esModule: true; default: () => null } {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
}

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Header/Header",
  () => {
    return mockEmpty();
  },
);
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

interface ForcedNavigation {
  to: string;
  options: unknown;
}

let forcedNavigations: Array<ForcedNavigation> = [];

/*
 * Loaded through a computed path, the way DashboardLazyPages does it: a
 * static import would pull App.tsx's whole lazy route graph into `npm run
 * compile-tests`, where only Common's packages are installed.
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
      </MemoryRouter>,
    );
  });
}

async function refreshProjects(): Promise<void> {
  await act(async () => {
    GlobalEvents.dispatchEvent(EventName.PROJECT_INVITATIONS_REFRESH);
  });
}

function isRequestStillWaiting(): boolean {
  return document.cookie.includes(`${COOKIE_NAME}=`);
}

// As the consent screen leaves it: for the dashboard's path.
function leaveCookie(value: string): void {
  document.cookie = `${COOKIE_NAME}=${value}; path=/dashboard`;
}

function consentNavigations(): Array<ForcedNavigation> {
  return forcedNavigations.filter((navigation: ForcedNavigation): boolean => {
    return navigation.to.startsWith("/accounts/mcp-authorize");
  });
}

beforeEach(() => {
  forcedNavigations = [];

  /*
   * The document is where the dashboard is: the pending request's cookie is
   * kept for the dashboard's path, so nothing served from anywhere else can
   * see it - including this suite, if it stayed on jsdom's default "/".
   */
  window.history.pushState({}, "", HOME_PATH);

  McpOAuthPendingAuthorization.clear();

  getListMock.mockReset();
  countMock.mockReset();
  getListMock.mockResolvedValue({ data: [project], count: 1 });
  countMock.mockResolvedValue(1);

  /*
   * A forced navigation replaces the document, which jsdom cannot do; it is
   * recorded instead. Router navigations go through untouched.
   */
  const realNavigate: typeof Navigation.navigate =
    Navigation.navigate.bind(Navigation);

  getJestSpyOn(Navigation, "navigate").mockImplementation(
    (
      to: Parameters<typeof Navigation.navigate>[0],
      options?: Parameters<typeof Navigation.navigate>[1],
    ): void => {
      if (options?.forceNavigate) {
        forcedNavigations.push({ to: to.toString(), options });
        return;
      }

      realNavigate(to, options);
    },
  );

  getJestSpyOn(console, "error").mockImplementation(() => {});
  getJestSpyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  McpOAuthPendingAuthorization.clear();
  window.history.pushState({}, "", "/");
});

describe("the resume helper, with a real cookie", () => {
  test("a remembered request is followed once, then forgotten", () => {
    expect(McpOAuthPendingAuthorization.remember(TICKET)).toBe(true);
    expect(isRequestStillWaiting()).toBe(true);

    expect(resumePendingMcpAuthorization()).toBe(true);

    expect(forcedNavigations).toEqual([
      { to: CONSENT_ROUTE, options: { forceNavigate: true } },
    ]);
    expect(isRequestStillWaiting()).toBe(false);

    // Nothing left to follow.
    expect(resumePendingMcpAuthorization()).toBe(false);
    expect(forcedNavigations).toHaveLength(1);
  });

  test("the address it goes to is one Navigation accepts for a full page load", () => {
    /*
     * A forced navigation refuses anything that is not a same-origin path,
     * and throws. Run unrecorded, to prove the consent route passes that
     * check rather than throwing inside the dashboard's load.
     */
    jest.restoreAllMocks();
    getJestSpyOn(console, "error").mockImplementation(() => {});

    McpOAuthPendingAuthorization.remember(TICKET);

    expect(
      Navigation.isSafeInternalRoute(
        McpOAuthPendingAuthorization.getConsentRoute(TICKET),
      ),
    ).toBe(true);
    expect(() => {
      resumePendingMcpAuthorization();
    }).not.toThrow();
  });

  test("nothing remembered: nowhere to go", () => {
    expect(resumePendingMcpAuthorization()).toBe(false);
    expect(forcedNavigations).toEqual([]);
  });

  test("the request is the dashboard's to pick up: it is visible from any dashboard page", () => {
    McpOAuthPendingAuthorization.remember(TICKET);

    window.history.pushState({}, "", "/dashboard");
    expect(isRequestStillWaiting()).toBe(true);

    window.history.pushState({}, "", `${HOME_PATH}/deeper/still`);
    expect(isRequestStillWaiting()).toBe(true);

    expect(resumePendingMcpAuthorization()).toBe(true);
    expect(forcedNavigations).toEqual([
      { to: CONSENT_ROUTE, options: { forceNavigate: true } },
    ]);
  });

  /*
   * What counts as a request is the cookie reader's own business, and its
   * suite covers that in full. These two are here for the other half: a value
   * that is not a request never becomes a navigation.
   */
  test.each([
    ["words", "not-a-ticket"],
    ["an address", "https%3A%2F%2Fevil.example%2Fsteal"],
  ])(
    "a cookie holding %s is thrown away, not followed",
    (_label: string, value: string) => {
      leaveCookie(value);
      expect(isRequestStillWaiting()).toBe(true);

      expect(resumePendingMcpAuthorization()).toBe(false);

      expect(forcedNavigations).toEqual([]);
      expect(isRequestStillWaiting()).toBe(false);
    },
  );
});

describe("the dashboard shell", () => {
  test("with a request waiting: once the projects have loaded, the browser is sent back to the consent screen", async () => {
    McpOAuthPendingAuthorization.remember(TICKET);

    await renderApp();

    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(consentNavigations()).toEqual([
      { to: CONSENT_ROUTE, options: { forceNavigate: true } },
    ]);
    expect(isRequestStillWaiting()).toBe(false);
  });

  test("and the dashboard does not draw itself underneath a navigation that is leaving", async () => {
    McpOAuthPendingAuthorization.remember(TICKET);

    await renderApp();

    expect(screen.queryByTestId("home-page")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  test("the request is followed exactly once: a later project refresh goes nowhere", async () => {
    McpOAuthPendingAuthorization.remember(TICKET);

    await renderApp();
    await refreshProjects();
    await refreshProjects();

    expect(getListMock).toHaveBeenCalledTimes(3);
    expect(consentNavigations()).toHaveLength(1);
  });

  test("a member with no projects yet is still sent back: the consent screen is what tells them so", async () => {
    getListMock.mockResolvedValue({ data: [], count: 0 });
    McpOAuthPendingAuthorization.remember(TICKET);

    await renderApp();

    expect(consentNavigations()).toEqual([
      { to: CONSENT_ROUTE, options: { forceNavigate: true } },
    ]);
  });

  test("with nothing waiting: the dashboard loads as it always has", async () => {
    await renderApp();

    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(consentNavigations()).toEqual([]);
    expect(await screen.findByTestId("home-page")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  test("a cookie that is not a request is discarded, and the dashboard loads", async () => {
    leaveCookie("not-a-ticket");

    await renderApp();

    expect(consentNavigations()).toEqual([]);
    expect(isRequestStillWaiting()).toBe(false);
    expect(await screen.findByTestId("home-page")).toBeInTheDocument();
  });

  test("with no session: the project list fails, and the request is left where it is for after the sign-in", async () => {
    getListMock.mockRejectedValue(new Error("Not signed in"));
    McpOAuthPendingAuthorization.remember(TICKET);

    await renderApp();

    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(consentNavigations()).toEqual([]);
    expect(isRequestStillWaiting()).toBe(true);

    // Still the request it was: the next successful load picks it up.
    getListMock.mockResolvedValue({ data: [project], count: 1 });
    await refreshProjects();

    expect(consentNavigations()).toEqual([
      { to: CONSENT_ROUTE, options: { forceNavigate: true } },
    ]);
    expect(isRequestStillWaiting()).toBe(false);
  });
});

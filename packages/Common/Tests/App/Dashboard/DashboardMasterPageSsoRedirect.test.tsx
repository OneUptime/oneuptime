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
import {
  MemoryRouter,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { format } from "util";
import DashboardMasterPage from "../../../../App/FeatureSet/Dashboard/src/Components/MasterPage/MasterPage";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import SSOAuthorizationException from "../../../Types/Exception/SsoAuthorizationException";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * The dashboard shell sends a user whose project requires SSO to the
 * project's SSO page. That redirect used to be a Navigation.navigate() call in
 * the middle of DashboardMasterPage's render:
 *
 *  - when the error is already there on the first render, react-router
 *    drops it ("You should call navigate() in a React.useEffect()"), and the
 *    SSO error itself was swallowed, so the user saw the normal page with no
 *    redirect and no message;
 *  - on any later render it updates the router while rendering the master
 *    page ("Cannot update a component while rendering a different
 *    component"), and every re-render with the error still set - including
 *    the one caused by leaving /sso - navigates back to /sso again.
 *
 * The real master page is rendered inside a real MemoryRouter, with
 * Navigation wired to the router exactly the way App.tsx wires it, so these
 * assertions observe actual router locations rather than a mocked navigate.
 */

/*
 * Header, NavBar and Footer have their own suites. The header stand-in keeps
 * only the SSO report, so a test can check it is wired up.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Header/Header",
  () => {
    const react: typeof React = jest.requireActual("react") as typeof React;

    return {
      __esModule: true,
      default: (props: {
        onSsoAuthorizationRequired?: (() => void) | undefined;
      }): ReactElement => {
        return react.createElement(
          "button",
          {
            onClick: () => {
              props.onSsoAuthorizationRequired?.();
            },
          },
          "Report SSO required",
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NavBar/NavBar",
  () => {
    const react: typeof React = jest.requireActual("react") as typeof React;

    return {
      __esModule: true,
      default: (props: { show: boolean }): ReactElement => {
        return react.createElement("nav", {
          "data-testid": "dashboard-navbar",
          "data-show": String(props.show),
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Footer/Footer",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

// Shaped like a real project id.
const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const HOME_PATH: string = `/dashboard/${PROJECT_ID}/home`;
const SSO_PATH: string = RouteMap[PageMap.PROJECT_SSO]!.toString().replace(
  ":projectId",
  PROJECT_ID,
);
const SSO_ERROR: string = new SSOAuthorizationException().message;
const OTHER_ERROR: string = "Could not load your projects.";

interface CallRecorder {
  mock: { calls: Array<Array<unknown>> };
}

let visitedPaths: Array<string> = [];
let navigateSpy: CallRecorder;
let consoleErrorSpy: CallRecorder;
let consoleWarnSpy: CallRecorder;
let onSsoErrorHandled: MockFunction;
let onSsoAuthorizationRequired: MockFunction;

// Every location the router actually committed, in order.
const LocationProbe: () => ReactElement = (): ReactElement => {
  const location: ReturnType<typeof useLocation> = useLocation();

  useEffect(() => {
    visitedPaths.push(location.pathname);
  }, [location.key]);

  return <output data-testid="current-path">{location.pathname}</output>;
};

interface ShellProps {
  error: string;
  showProjectModal?: boolean | undefined;
}

// Mirrors how App.tsx hands the router to Navigation on every render.
const Shell: (props: ShellProps) => ReactElement = (
  props: ShellProps,
): ReactElement => {
  const location: ReturnType<typeof useLocation> = useLocation();
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(location);
  Navigation.setParams(useParams());

  const project: Project = new Project();
  project.id = new ObjectID(PROJECT_ID);

  return (
    <>
      <DashboardMasterPage
        isLoading={false}
        projects={[project]}
        error={props.error}
        onProjectSelected={() => {}}
        showProjectModal={Boolean(props.showProjectModal)}
        onProjectModalClose={() => {}}
        selectedProject={null}
        hideNavBarOn={[RouteMap[PageMap.PROJECT_SSO]!]}
        onSsoErrorHandled={onSsoErrorHandled}
        onSsoAuthorizationRequired={onSsoAuthorizationRequired}
      >
        <div data-testid="page-body">Page body</div>
      </DashboardMasterPage>
      <LocationProbe />
    </>
  );
};

function app(
  error: string,
  options?: { showProjectModal?: boolean; initialPath?: string },
): ReactElement {
  return (
    <MemoryRouter
      initialEntries={[options?.initialPath || HOME_PATH]}
      useTransitions={false}
    >
      <Shell error={error} showProjectModal={options?.showProjectModal} />
    </MemoryRouter>
  );
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

function currentPath(): string {
  return screen.getByTestId("current-path").textContent || "";
}

beforeEach(() => {
  visitedPaths = [];
  onSsoErrorHandled = getJestMockFunction();
  onSsoAuthorizationRequired = getJestMockFunction();
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  // Call through: the redirect must really reach the router.
  navigateSpy = getJestSpyOn(Navigation, "navigate");
  consoleErrorSpy = getJestSpyOn(console, "error").mockImplementation(() => {});
  consoleWarnSpy = getJestSpyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("dashboard master page SSO redirect", () => {
  test("the SSO error is the one the shell recognises", () => {
    expect(SSOAuthorizationException.isException(SSO_ERROR)).toBe(true);
  });

  test("redirects once, after mount, when the first render already carries the SSO error", async () => {
    await act(async () => {
      render(app(SSO_ERROR));
    });

    expect(currentPath()).toBe(SSO_PATH);
    expect(visitedPaths).toEqual([HOME_PATH, SSO_PATH]);
    expect(ssoNavigations()).toBe(1);
    expect(onSsoErrorHandled).toHaveBeenCalledTimes(1);
    expectNoRenderPhaseNavigation();
  });

  test("redirects once when the SSO error arrives after mount", async () => {
    let view!: ReturnType<typeof render>;

    await act(async () => {
      view = render(app(""));
    });
    expect(currentPath()).toBe(HOME_PATH);
    expect(onSsoErrorHandled).not.toHaveBeenCalled();

    await act(async () => {
      view.rerender(app(SSO_ERROR));
    });

    expect(currentPath()).toBe(SSO_PATH);
    expect(visitedPaths).toEqual([HOME_PATH, SSO_PATH]);
    expect(ssoNavigations()).toBe(1);
    expect(onSsoErrorHandled).toHaveBeenCalledTimes(1);
    expectNoRenderPhaseNavigation();
  });

  test("does not navigate again when re-rendered with the same error", async () => {
    let view!: ReturnType<typeof render>;

    await act(async () => {
      view = render(app(SSO_ERROR));
    });
    await act(async () => {
      view.rerender(app(SSO_ERROR, { showProjectModal: true }));
    });
    await act(async () => {
      view.rerender(app(SSO_ERROR, { showProjectModal: false }));
    });

    expect(ssoNavigations()).toBe(1);
    expect(onSsoErrorHandled).toHaveBeenCalledTimes(1);
    expect(visitedPaths).toEqual([HOME_PATH, SSO_PATH]);
    expectNoRenderPhaseNavigation();
  });

  test("does not bounce the user back to /sso after they leave it", async () => {
    await act(async () => {
      render(app(SSO_ERROR));
    });
    expect(currentPath()).toBe(SSO_PATH);

    // The user follows a link away from the SSO page.
    await act(async () => {
      Navigation.navigate(new Route(HOME_PATH));
    });

    expect(currentPath()).toBe(HOME_PATH);
    expect(visitedPaths).toEqual([HOME_PATH, SSO_PATH, HOME_PATH]);
    expect(ssoNavigations()).toBe(1);
    expectNoRenderPhaseNavigation();
  });

  test("redirects again when the error is cleared and the SSO failure recurs", async () => {
    let view!: ReturnType<typeof render>;

    await act(async () => {
      view = render(app(SSO_ERROR));
    });
    // What App does once told the error was handled.
    await act(async () => {
      view.rerender(app(""));
    });
    await act(async () => {
      Navigation.navigate(new Route(HOME_PATH));
    });
    await act(async () => {
      view.rerender(app(SSO_ERROR));
    });

    expect(currentPath()).toBe(SSO_PATH);
    expect(visitedPaths).toEqual([HOME_PATH, SSO_PATH, HOME_PATH, SSO_PATH]);
    expect(ssoNavigations()).toBe(2);
    expect(onSsoErrorHandled).toHaveBeenCalledTimes(2);
    expectNoRenderPhaseNavigation();
  });

  test("renders the page, not an error dialog, and hides the nav bar on /sso", async () => {
    await act(async () => {
      render(app(SSO_ERROR));
    });

    expect(screen.queryByText(SSO_ERROR)).not.toBeInTheDocument();
    expect(screen.getByTestId("page-body")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-navbar")).toHaveAttribute(
      "data-show",
      "false",
    );
  });

  test("hides the nav bar on the SSO page whatever the case of the URL", async () => {
    // React Router renders the SSO page for this URL too.
    const upperCasePath: string = SSO_PATH.replace(/\/sso$/, "/SSO");

    await act(async () => {
      render(app("", { initialPath: upperCasePath }));
    });

    expect(currentPath()).toBe(upperCasePath);
    expect(screen.getByTestId("dashboard-navbar")).toHaveAttribute(
      "data-show",
      "false",
    );
  });

  test("shows the nav bar away from the SSO page", async () => {
    await act(async () => {
      render(app(""));
    });

    expect(screen.getByTestId("dashboard-navbar")).toHaveAttribute(
      "data-show",
      "true",
    );
  });

  test("shows any other error and stays where it is", async () => {
    await act(async () => {
      render(app(OTHER_ERROR));
    });

    expect(screen.getByText(OTHER_ERROR)).toBeInTheDocument();
    expect(screen.queryByTestId("page-body")).not.toBeInTheDocument();
    expect(currentPath()).toBe(HOME_PATH);
    expect(visitedPaths).toEqual([HOME_PATH]);
    expect(ssoNavigations()).toBe(0);
    expect(onSsoErrorHandled).not.toHaveBeenCalled();
    expectNoRenderPhaseNavigation();
  });

  test("shows the SSO error rather than swallowing it when there is no project to send the user to", async () => {
    getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(null);

    await act(async () => {
      render(app(SSO_ERROR));
    });

    expect(screen.getByText(SSO_ERROR)).toBeInTheDocument();
    expect(currentPath()).toBe(HOME_PATH);
    expect(navigateSpy.mock.calls).toEqual([]);
    expect(onSsoErrorHandled).not.toHaveBeenCalled();
    expectNoRenderPhaseNavigation();
  });

  test("redirects once the project id is known if the SSO error arrived first", async () => {
    let projectId: ObjectID | null = null;
    getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockImplementation(() => {
      return projectId;
    });
    let view!: ReturnType<typeof render>;

    await act(async () => {
      view = render(app(SSO_ERROR));
    });
    expect(ssoNavigations()).toBe(0);

    projectId = new ObjectID(PROJECT_ID);
    await act(async () => {
      view.rerender(app(SSO_ERROR, { showProjectModal: true }));
    });

    expect(currentPath()).toBe(SSO_PATH);
    expect(ssoNavigations()).toBe(1);
    expect(onSsoErrorHandled).toHaveBeenCalledTimes(1);
    expectNoRenderPhaseNavigation();
  });

  test("passes the header's SSO report up to the shell", async () => {
    await act(async () => {
      render(app(""));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Report SSO required"));
    });

    expect(onSsoAuthorizationRequired).toHaveBeenCalledTimes(1);
  });
});

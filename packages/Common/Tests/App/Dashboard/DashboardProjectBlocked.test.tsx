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
import {
  MemoryRouter,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import DashboardMasterPage from "../../../../App/FeatureSet/Dashboard/src/Components/MasterPage/MasterPage";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";

/*
 * A project a master admin blocked answers every request with a 403 that
 * says so, and its members see why in place of the page they opened - with
 * the header, and its project picker, still there to switch to another
 * project, and no menu of pages that would not open. Their own pages
 * (profile, log out) open as usual.
 *
 * The real master page in a real MemoryRouter, wired to Navigation as
 * App.tsx wires it. The header, nav bar and footer have suites of their own.
 */

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Header/Header",
  () => {
    const react: typeof React = jest.requireActual("react") as typeof React;

    return {
      __esModule: true,
      default: (): ReactElement => {
        return react.createElement("header", {
          "data-testid": "dashboard-header",
        });
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

const PROJECT_ID: string = "b6000000-0000-4000-8000-0000000000b1";
const HOME_PATH: string = `/dashboard/${PROJECT_ID}/home`;
const PROFILE_PATH: string =
  RouteMap[PageMap.USER_PROFILE_OVERVIEW]!.toString();
const BLOCKED_TITLE: string = "This project has been blocked";

interface ShellProps {
  isSelectedProjectBlocked: boolean;
}

const Shell: (props: ShellProps) => ReactElement = (
  props: ShellProps,
): ReactElement => {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  const project: Project = new Project();
  project.id = new ObjectID(PROJECT_ID);
  project.name = "Spam Films";

  return (
    <DashboardMasterPage
      isLoading={false}
      projects={[project]}
      error=""
      onProjectSelected={() => {}}
      showProjectModal={false}
      onProjectModalClose={() => {}}
      selectedProject={project}
      isSelectedProjectBlocked={props.isSelectedProjectBlocked}
      hideNavBarOn={[RouteMap[PageMap.PROJECT_SSO]!]}
    >
      <div data-testid="page-body">Page body</div>
    </DashboardMasterPage>
  );
};

const renderAt: (
  path: string,
  isSelectedProjectBlocked: boolean,
) => Promise<void> = async (
  path: string,
  isSelectedProjectBlocked: boolean,
): Promise<void> => {
  /*
   * The browser's address, as BrowserRouter keeps it: whether a route is a
   * project's is read from it (ProjectUtil.getProjectIdFromUrl).
   */
  window.history.pushState({}, "", path);

  await act(async () => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Shell isSelectedProjectBlocked={isSelectedProjectBlocked} />
      </MemoryRouter>,
    );
  });
};

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the dashboard of a blocked project", () => {
  test("shows why in place of the page, with the header and no menu", async () => {
    await renderAt(HOME_PATH, true);

    expect(screen.getByText(BLOCKED_TITLE)).toBeInTheDocument();
    expect(screen.queryByTestId("page-body")).not.toBeInTheDocument();
    expect(screen.getByTestId("dashboard-header")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-navbar")).toHaveAttribute(
      "data-show",
      "false",
    );
  });

  test("says what has stopped and how to carry on", async () => {
    await renderAt(HOME_PATH, true);

    expect(screen.getByTestId("project-blocked-description")).toHaveTextContent(
      "switch to another project with the project picker above",
    );
  });

  test("the person's own pages still open", async () => {
    await renderAt(PROFILE_PATH, true);

    expect(screen.getByTestId("page-body")).toBeInTheDocument();
    expect(screen.queryByText(BLOCKED_TITLE)).not.toBeInTheDocument();
  });

  test("a project that is not blocked shows its pages as before", async () => {
    await renderAt(HOME_PATH, false);

    expect(screen.getByTestId("page-body")).toBeInTheDocument();
    expect(screen.queryByText(BLOCKED_TITLE)).not.toBeInTheDocument();
    expect(screen.getByTestId("dashboard-navbar")).toHaveAttribute(
      "data-show",
      "true",
    );
  });
});

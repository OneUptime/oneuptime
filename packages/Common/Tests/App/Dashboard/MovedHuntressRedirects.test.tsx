import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";
import {
  Location,
  MemoryRouter,
  NavigationType,
  Route as RouterRoute,
  Routes,
  useLocation,
  useNavigationType,
} from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { MOVED_HUNTRESS_PATHS } from "../../../../App/FeatureSet/Dashboard/src/Routes/MovedPagePaths";
import Route from "../../../Types/API/Route";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * Huntress used to be set up under Incidents > Integrations > Huntress: a
 * list of connections, and a page per connection. It is a workflow trigger
 * now, and each connection became a workflow that kept the connection's id.
 * The old addresses are in bookmarks, in tickets and in the docs other
 * people wrote, so they keep arriving: the list at Workflows, and a
 * connection's page at the workflow it became.
 *
 * This mounts the REAL Incidents route group, every page of it replaced by
 * a marker that names it, beside a stand-in for the Workflows pages, and
 * visits the old URLs.
 */

const DASHBOARD: string = "../../../../App/FeatureSet/Dashboard/src";

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

const ROUTES_MODULE: string = "Routes/IncidentsRoutes";
const CONNECTION_ID: string = "6d1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b";

/*
 * Every page module the route group imports, read from its source so a page
 * added later is mocked too rather than dragging its whole feature into this
 * suite.
 */
function pageModules(): Array<string> {
  const source: string = fs.readFileSync(
    path.join(DASHBOARD_SRC, `${ROUTES_MODULE}.tsx`),
    "utf8",
  );

  return Array.from(
    new Set(
      Array.from(
        source.matchAll(/"\.\.\/Pages\/(Incidents\/[A-Za-z/]+)"/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1]!;
      }),
    ),
  );
}

// Called on every render of the Incidents layout: a forward never draws it.
const layoutRenderMock: MockFunction = getJestMockFunction();

// Reports where the router ended up, and how it got there.
function LocationProbe(props: { name: string }): React.ReactElement {
  const location: Location = useLocation();
  const navigationType: NavigationType = useNavigationType();

  return (
    <div data-testid="location" data-where={props.name}>
      <span data-testid="pathname">{location.pathname}</span>
      <span data-testid="search">{location.search}</span>
      <span data-testid="hash">{location.hash}</span>
      <span data-testid="navigation-type">{navigationType}</span>
    </div>
  );
}

for (const module of pageModules()) {
  jest.doMock(`${DASHBOARD}/Pages/${module}`, () => {
    if (module === "Incidents/Layout") {
      return {
        __esModule: true,
        default: (): React.ReactElement => {
          layoutRenderMock("Incidents");
          const { Outlet } = jest.requireActual("react-router-dom") as {
            Outlet: React.ComponentType;
          };
          return (
            <div data-testid="layout">
              <LocationProbe name="incidents" />
              <Outlet />
            </div>
          );
        },
      };
    }

    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div data-testid="page">{module}</div>;
      },
    };
  });
}

// Required after the mocks above, which jest.doMock does not hoist.
const IncidentsRoutes: React.FunctionComponent<Record<string, unknown>> = (
  jest.requireActual(`${DASHBOARD}/${ROUTES_MODULE}`) as {
    default: React.FunctionComponent<Record<string, unknown>>;
  }
).default;

function incidents(projectId: string = PROJECT_ID): string {
  return `/dashboard/${projectId}/incidents`;
}

function workflows(projectId: string = PROJECT_ID): string {
  return `/dashboard/${projectId}/workflows`;
}

function visit(url: string): void {
  /*
   * RouteUtil fills the project id in from window.location, which a
   * MemoryRouter does not touch, so the address bar is put there too.
   */
  goTo(url.split(/[?#]/)[0]!);

  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <RouterRoute
          path={RouteMap[PageMap.INCIDENTS_ROOT]!.toString()}
          element={
            <IncidentsRoutes
              pageRoute={new Route(incidents())}
              currentProject={null}
              hasPaymentMethod={true}
            />
          }
        />
        <RouterRoute
          path={RouteMap[PageMap.WORKFLOWS_ROOT]!.toString()}
          element={<LocationProbe name="workflows" />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function landedOn(): string {
  return (
    (screen.getByTestId("pathname").textContent ?? "") +
    (screen.getByTestId("search").textContent ?? "") +
    (screen.getByTestId("hash").textContent ?? "")
  );
}

function where(): string | null {
  return screen.getByTestId("location").getAttribute("data-where");
}

beforeEach(() => {
  layoutRenderMock.mockReset();
  goTo(`/dashboard/${PROJECT_ID}`);
});

afterEach(() => {
  cleanup();
});

describe("the forwarding table", () => {
  test("names the two addresses Huntress had, relative to Incidents", () => {
    expect(MOVED_HUNTRESS_PATHS).toEqual({
      connections: "integrations/huntress",
      connectionView: "integrations/huntress/:id",
    });
  });

  test("no page is at an old address any more", () => {
    for (const route of Object.values(RouteMap)) {
      expect(route.toString()).not.toContain("/incidents/integrations");
    }
  });

  test("the route group mounts both forwards, outside its layout, and no Huntress page", () => {
    const source: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, `${ROUTES_MODULE}.tsx`),
      "utf8",
    );
    const layoutAt: number = source.indexOf('path="/"');

    for (const key of ["connections", "connectionView"]) {
      const at: number = source.indexOf(`MOVED_HUNTRESS_PATHS.${key}`);

      expect({ key, mounted: at > -1, beforeLayout: at < layoutAt }).toEqual({
        key,
        mounted: true,
        beforeLayout: true,
      });
    }

    expect(
      pageModules().filter((module: string): boolean => {
        return module.toLowerCase().includes("huntress");
      }),
    ).toEqual([]);
    expect(
      fs.existsSync(
        path.join(DASHBOARD_SRC, "Pages", "Incidents", "Integrations"),
      ),
    ).toBe(false);
  });
});

describe("the old Huntress URLs", () => {
  test("the connections list arrives at Workflows, without drawing the Incidents menu", () => {
    visit(`${incidents()}/integrations/huntress`);

    expect(where()).toBe("workflows");
    expect(landedOn()).toBe(workflows());
    expect(layoutRenderMock).not.toHaveBeenCalled();
  });

  test("a connection's page arrives at the workflow it became, which kept its id", () => {
    visit(`${incidents()}/integrations/huntress/${CONNECTION_ID}`);

    expect(where()).toBe("workflows");
    expect(landedOn()).toBe(`${workflows()}/${CONNECTION_ID}`);
    expect(RouteMap[PageMap.WORKFLOW_VIEW]!.toString()).toBe(
      "/dashboard/:projectId/workflows/:id",
    );
  });

  test("the forward replaces the history entry, so Back does not bounce", () => {
    visit(`${incidents()}/integrations/huntress/${CONNECTION_ID}`);

    expect(screen.getByTestId("navigation-type")).toHaveTextContent("REPLACE");
  });

  test("its query string and hash come along", () => {
    visit(`${incidents()}/integrations/huntress?search=acme#top`);

    expect(landedOn()).toBe(`${workflows()}?search=acme#top`);
  });

  test("the project in the URL is the project it forwards within", () => {
    const otherProjectId: string = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

    visit(
      `${incidents(otherProjectId)}/integrations/huntress/${CONNECTION_ID}`,
    );

    expect(landedOn()).toBe(`${workflows(otherProjectId)}/${CONNECTION_ID}`);
  });

  test("an address under them that never existed is not forwarded", () => {
    visit(`${incidents()}/integrations/huntress/${CONNECTION_ID}/reports`);

    expect(
      screen
        .queryAllByTestId("location")
        .map((element: HTMLElement): string | null => {
          return element.getAttribute("data-where");
        }),
    ).not.toContain("workflows");
  });
});

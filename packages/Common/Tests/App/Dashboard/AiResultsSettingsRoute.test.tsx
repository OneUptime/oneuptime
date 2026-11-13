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
  Route as RouterRoute,
  Routes,
  useLocation,
} from "react-router-dom";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * …/settings/ai-results OPENS THE AI RESULTS PAGE, INSIDE PROJECT SETTINGS.
 *
 * This mounts the REAL Settings route group (every Settings page replaced by
 * a marker, the Settings layout by one that draws its child, the AI Results
 * page by a probe that reports how it was reached and what it was given)
 * and visits the page's address: the page is drawn inside the Settings
 * layout, with its own route, and AI Logs' address still opens AI Logs.
 */

const DASHBOARD: string = "../../../../App/FeatureSet/Dashboard/src";

const SETTINGS_ROUTES_SOURCE: string = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "App",
    "FeatureSet",
    "Dashboard",
    "src",
    "Routes",
    "SettingsRoutes.tsx",
  ),
  "utf8",
);

// Every Settings page the route group imports, read from its source.
const SETTINGS_PAGE_MODULES: Array<string> = Array.from(
  new Set(
    Array.from(
      SETTINGS_ROUTES_SOURCE.matchAll(/"\.\.\/Pages\/(Settings\/[A-Za-z]+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    }),
  ),
);

interface ProbeProps {
  pageRoute?: Route | undefined;
  currentProject?: { name?: string } | null | undefined;
  hasPaymentMethod?: boolean | undefined;
}

// What the route group is handed as the current project, to see it passed on.
const CURRENT_PROJECT: { name: string } = { name: "Probe Project" };

// Stands where the AI Results page is, and reports how it was reached.
const AiResultsPageProbe: React.FunctionComponent<ProbeProps> = (
  props: ProbeProps,
): React.ReactElement => {
  const location: Location = useLocation();

  return (
    <div data-testid="ai-results-page">
      <span data-testid="pathname">{location.pathname}</span>
      <span data-testid="page-route">{props.pageRoute?.toString() ?? ""}</span>
      <span data-testid="current-project">
        {props.currentProject?.name ?? "none"}
      </span>
      <span data-testid="has-payment-method">
        {String(props.hasPaymentMethod)}
      </span>
    </div>
  );
};

for (const module of SETTINGS_PAGE_MODULES) {
  jest.doMock(`${DASHBOARD}/Pages/${module}`, () => {
    if (module === "Settings/Layout") {
      return {
        __esModule: true,
        default: (): React.ReactElement => {
          const { Outlet } = jest.requireActual("react-router-dom") as {
            Outlet: React.ComponentType;
          };
          return (
            <div data-testid="settings-layout">
              <Outlet />
            </div>
          );
        },
      };
    }

    if (module === "Settings/AIResults") {
      return { __esModule: true, default: AiResultsPageProbe };
    }

    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div data-testid="settings-page">{module}</div>;
      },
    };
  });
}

// Required after the mocks above, which jest.doMock does not hoist.
const settingsRoutesModule: {
  default: React.FunctionComponent<Record<string, unknown>>;
} = jest.requireActual(`${DASHBOARD}/Routes/SettingsRoutes`) as {
  default: React.FunctionComponent<Record<string, unknown>>;
};

const SettingsRoutes: React.FunctionComponent<Record<string, unknown>> =
  settingsRoutesModule.default;

const SETTINGS: string = `/dashboard/${PROJECT_ID}/settings`;

function visit(url: string): void {
  goTo(url);

  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <RouterRoute
          path={RouteMap[PageMap.SETTINGS_ROOT]!.toString()}
          element={
            <SettingsRoutes
              pageRoute={new Route(SETTINGS)}
              currentProject={CURRENT_PROJECT}
              hasPaymentMethod={false}
              onProjectDeleted={() => {}}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}`);
});

afterEach(() => {
  cleanup();
});

describe("the suite's own scaffolding", () => {
  test("found the Settings pages to mock, the AI Results page among them", () => {
    expect(SETTINGS_PAGE_MODULES).toEqual(
      expect.arrayContaining([
        "Settings/Layout",
        "Settings/AIResults",
        "Settings/AILogs",
      ]),
    );
  });
});

describe("the AI Results address", () => {
  test("…/settings/ai-results draws the AI Results page", () => {
    visit(`${SETTINGS}/ai-results`);

    expect(screen.getByTestId("ai-results-page")).toBeInTheDocument();
    expect(screen.getByTestId("pathname")).toHaveTextContent(
      `${SETTINGS}/ai-results`,
    );
  });

  test("inside the Settings layout, so the Settings menu is beside it", () => {
    visit(`${SETTINGS}/ai-results`);

    expect(
      screen
        .getByTestId("settings-layout")
        .contains(screen.getByTestId("ai-results-page")),
    ).toBe(true);
  });

  test("hands the page its own route, and the props the group was given", () => {
    visit(`${SETTINGS}/ai-results`);

    expect(screen.getByTestId("page-route")).toHaveTextContent(
      RouteMap[PageMap.SETTINGS_AI_RESULTS]!.toString(),
    );
    expect(screen.getByTestId("page-route")).toHaveTextContent(
      "/dashboard/:projectId/settings/ai-results",
    );
    expect(screen.getByTestId("current-project")).toHaveTextContent(
      "Probe Project",
    );
    expect(screen.getByTestId("has-payment-method")).toHaveTextContent("false");
  });

  test("AI Logs' address still opens AI Logs, not AI Results", () => {
    visit(`${SETTINGS}/ai-logs`);

    expect(screen.queryByTestId("ai-results-page")).not.toBeInTheDocument();
    expect(screen.getByTestId("settings-page")).toHaveTextContent(
      "Settings/AILogs",
    );
  });

  test("a near miss is not the page", () => {
    visit(`${SETTINGS}/ai-result`);

    expect(screen.queryByTestId("ai-results-page")).not.toBeInTheDocument();
  });
});

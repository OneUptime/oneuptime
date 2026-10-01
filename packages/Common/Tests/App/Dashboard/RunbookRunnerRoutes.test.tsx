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
import * as React from "react";
import { MemoryRouter, Route as RouterRoute, Routes } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RunbookRoutePath,
  SettingsRoutePath,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import RunbookLabelRule from "../../../Models/DatabaseModels/RunbookLabelRule";
import RunbookOwnerRule from "../../../Models/DatabaseModels/RunbookOwnerRule";
import Route from "../../../Types/API/Route";
import { PROJECT_ID } from "./SideMenuHarness";

/*
 * The Runner pages live in the Runbooks route group. This renders that whole
 * group through React Router at every URL the product has, with each page
 * replaced by a marker that records its props, and pins what reading the
 * route table cannot:
 *
 *  - the three Runner pages render inside the Runbooks layout (so under the
 *    Runbooks side menu and breadcrumbs), each with its own pageRoute;
 *  - "runners" and "runner-credentials" are never read as a runbook id — they
 *    sit next to `/runbooks/:id`, and losing that race would open the runbook
 *    view layout for a runbook called "runners";
 *  - nothing that was already in the group moved while they were added.
 */

const DASHBOARD: string = "../../../../App/FeatureSet/Dashboard/src";

const NAMES_A_RUNNER: RegExp = /runner/i;
// A "runner", "runners" or "runner-…" path segment.
const RUNNER_PATH_SEGMENT: RegExp = /\/runners?(-|\/|$)/;

const routedPagesMock: MockFunction = getJestMockFunction();

// Page module (under Pages/Runbook) -> the marker it renders.
const PAGE_MODULES: Record<string, string> = {
  Runbooks: "Runbooks",
  Executions: "Executions",
  Secrets: "Secrets",
  "Runners/Runners": "Runners",
  "Runners/RunnerView": "RunnerView",
  "Runners/RunnerCredentials": "RunnerCredentials",
  "Settings/OwnerRules": "OwnerRules",
  "Settings/LabelRules": "LabelRules",
  "View/Index": "Overview",
  "View/Steps": "Steps",
  "View/Executions": "RunbookExecutions",
  "View/ExecutionView": "ExecutionView",
  "View/Owners": "Owners",
  "View/AuditLogs": "AuditLogs",
  "View/Settings": "RunbookSettings",
  "View/Delete": "Delete",
};

const LAYOUT_MODULES: Record<string, string> = {
  Layout: "product-layout",
  "View/Layout": "view-layout",
};

for (const [module, marker] of Object.entries(PAGE_MODULES)) {
  jest.doMock(`${DASHBOARD}/Pages/Runbook/${module}`, () => {
    return {
      __esModule: true,
      default: (props: unknown): React.ReactElement => {
        routedPagesMock(marker, props);
        return <div data-testid="page">{marker}</div>;
      },
    };
  });
}

for (const [module, testId] of Object.entries(LAYOUT_MODULES)) {
  jest.doMock(`${DASHBOARD}/Pages/Runbook/${module}`, () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        const { Outlet } = jest.requireActual("react-router-dom") as {
          Outlet: React.ComponentType;
        };
        return (
          <div data-testid={testId}>
            <Outlet />
          </div>
        );
      },
    };
  });
}

// Required after the mocks above, which jest.doMock does not hoist.
const RunbookRoutes: React.FunctionComponent<Record<string, unknown>> = (
  jest.requireActual(`${DASHBOARD}/Routes/RunbookRoutes`) as {
    default: React.FunctionComponent<Record<string, unknown>>;
  }
).default;

const ID: string = "5d9e2c11-7a3b-4c1d-9e8f-00000000a0b1";
const SUB_ID: string = "9c1f4e22-3b7a-4d6e-8f10-00000000c0d2";
const BASE: string = `/dashboard/${PROJECT_ID}/runbooks`;

function visit(url: string): void {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <RouterRoute
          path={RouteMap[PageMap.RUNBOOKS_ROOT]!.toString()}
          element={
            <RunbookRoutes
              pageRoute={new Route(BASE)}
              currentProject={null}
              hasPaymentMethod={true}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function routedProps(page: string): Record<string, any> {
  const calls: Array<Array<unknown>> = routedPagesMock.mock.calls.filter(
    (call: Array<unknown>): boolean => {
      return call[0] === page;
    },
  );
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![1] as Record<string, any>;
}

beforeEach(() => {
  routedPagesMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("the Runner pages are routed inside Runbooks", () => {
  test.each([
    [`${BASE}/runners`, "Runners", PageMap.RUNBOOKS_RUNNERS],
    [`${BASE}/runners/${ID}`, "RunnerView", PageMap.RUNBOOKS_RUNNER_VIEW],
    [
      `${BASE}/runner-credentials`,
      "RunnerCredentials",
      PageMap.RUNBOOKS_RUNNER_CREDENTIALS,
    ],
  ])(
    "%s renders %s under the Runbooks layout",
    (url: string, page: string, key: string) => {
      visit(url);

      expect(screen.getByTestId("product-layout")).toBeInTheDocument();
      expect(screen.queryByTestId("view-layout")).not.toBeInTheDocument();
      expect(screen.getAllByTestId("page")).toHaveLength(1);
      expect(screen.getByTestId("page")).toHaveTextContent(page);
      expect(routedProps(page)["pageRoute"]).toBe(RouteMap[key]);
    },
  );

  test("the page shell's props reach each Runner page", () => {
    for (const [url, page] of [
      [`${BASE}/runners`, "Runners"],
      [`${BASE}/runners/${ID}`, "RunnerView"],
      [`${BASE}/runner-credentials`, "RunnerCredentials"],
    ] as Array<[string, string]>) {
      visit(url);
      expect(routedProps(page)["hasPaymentMethod"]).toBe(true);
      expect(routedProps(page)["currentProject"]).toBeNull();
      cleanup();
    }
  });

  test("the Runner pages are never read as a runbook id", () => {
    for (const segment of ["runners", "runner-credentials"]) {
      visit(`${BASE}/${segment}`);
      expect(screen.queryByTestId("view-layout")).not.toBeInTheDocument();
      expect(routedPagesMock).not.toHaveBeenCalledWith(
        "Overview",
        expect.anything(),
      );
      cleanup();
    }
  });

  test("a Runner's page is not one of a runbook's tabs", () => {
    /*
     * `/runbooks/runners/<id>` has the same shape as `/runbooks/<id>/<tab>`.
     * It must reach the Runner, not a runbook called "runners".
     */
    visit(`${BASE}/runners/${ID}`);

    expect(screen.getByTestId("page")).toHaveTextContent("RunnerView");
    for (const runbookTab of [
      "Steps",
      "RunbookExecutions",
      "Owners",
      "AuditLogs",
      "RunbookSettings",
      "Delete",
    ]) {
      expect(routedPagesMock).not.toHaveBeenCalledWith(
        runbookTab,
        expect.anything(),
      );
    }
  });

  test("a runbook tab named like a Runner page still belongs to the runbook", () => {
    // `/runbooks/<id>/executions` vs `/runbooks/runners/<id>`: no crossover.
    visit(`${BASE}/${ID}/executions`);

    expect(screen.getByTestId("view-layout")).toBeInTheDocument();
    expect(screen.getByTestId("page")).toHaveTextContent("RunbookExecutions");
  });

  test.each([
    `${BASE}/runners/${ID}/anything`,
    `${BASE}/runner-credentials/${ID}`,
  ])("%s is not a page", (url: string) => {
    visit(url);

    for (const page of ["Runners", "RunnerView", "RunnerCredentials"]) {
      expect(routedPagesMock).not.toHaveBeenCalledWith(page, expect.anything());
    }
  });
});

describe("the rest of the Runbooks route group is where it was", () => {
  test.each([
    [BASE, "Runbooks", "product-layout", PageMap.RUNBOOKS],
    [
      `${BASE}/executions`,
      "Executions",
      "product-layout",
      PageMap.RUNBOOKS_EXECUTIONS,
    ],
    [
      `${BASE}/settings/secrets`,
      "Secrets",
      "product-layout",
      PageMap.RUNBOOKS_SECRETS,
    ],
    [
      `${BASE}/settings/owner-rules`,
      "OwnerRules",
      "product-layout",
      PageMap.RUNBOOKS_SETTINGS_OWNER_RULES,
    ],
    [
      `${BASE}/settings/owner-rules/${ID}`,
      "OwnerRules",
      "product-layout",
      PageMap.RUNBOOKS_SETTINGS_OWNER_RULE_VIEW,
    ],
    [
      `${BASE}/settings/label-rules`,
      "LabelRules",
      "product-layout",
      PageMap.RUNBOOKS_SETTINGS_LABEL_RULES,
    ],
    [
      `${BASE}/settings/label-rules/${ID}`,
      "LabelRules",
      "product-layout",
      PageMap.RUNBOOKS_SETTINGS_LABEL_RULE_VIEW,
    ],
    [`${BASE}/${ID}`, "Overview", "view-layout", PageMap.RUNBOOK_VIEW],
    [`${BASE}/${ID}/steps`, "Steps", "view-layout", PageMap.RUNBOOK_VIEW_STEPS],
    [
      `${BASE}/${ID}/executions`,
      "RunbookExecutions",
      "view-layout",
      PageMap.RUNBOOK_VIEW_EXECUTIONS,
    ],
    [
      `${BASE}/${ID}/executions/${SUB_ID}`,
      "ExecutionView",
      "view-layout",
      PageMap.RUNBOOK_VIEW_EXECUTION,
    ],
    [
      `${BASE}/${ID}/owners`,
      "Owners",
      "view-layout",
      PageMap.RUNBOOK_VIEW_OWNERS,
    ],
    [
      `${BASE}/${ID}/audit-logs`,
      "AuditLogs",
      "view-layout",
      PageMap.RUNBOOK_VIEW_AUDIT_LOGS,
    ],
    [
      `${BASE}/${ID}/settings`,
      "RunbookSettings",
      "view-layout",
      PageMap.RUNBOOK_VIEW_SETTINGS,
    ],
    [
      `${BASE}/${ID}/delete`,
      "Delete",
      "view-layout",
      PageMap.RUNBOOK_VIEW_DELETE,
    ],
  ])(
    "%s renders %s in the %s",
    (url: string, page: string, layout: string, key: string) => {
      visit(url);

      expect(screen.getByTestId(layout)).toBeInTheDocument();
      expect(screen.getAllByTestId("page")).toHaveLength(1);
      expect(screen.getByTestId("page")).toHaveTextContent(page);
      expect(routedProps(page)["pageRoute"]).toBe(RouteMap[key]);
    },
  );

  test("only a rule VIEW route passes its rule model", () => {
    visit(`${BASE}/settings/owner-rules`);
    expect(routedProps("OwnerRules")["ruleViewModelType"]).toBeUndefined();
    cleanup();

    visit(`${BASE}/settings/owner-rules/${ID}`);
    expect(routedProps("OwnerRules")["ruleViewModelType"]).toBe(
      RunbookOwnerRule,
    );
    cleanup();

    visit(`${BASE}/settings/label-rules`);
    expect(routedProps("LabelRules")["ruleViewModelType"]).toBeUndefined();
    cleanup();

    visit(`${BASE}/settings/label-rules/${ID}`);
    expect(routedProps("LabelRules")["ruleViewModelType"]).toBe(
      RunbookLabelRule,
    );
  });
});

describe("the route table puts Runners under Runbooks and nowhere else", () => {
  test("the three Runner pages have Runbooks URLs", () => {
    expect(RouteMap[PageMap.RUNBOOKS_RUNNERS]!.toString()).toBe(
      "/dashboard/:projectId/runbooks/runners",
    );
    expect(RouteMap[PageMap.RUNBOOKS_RUNNER_VIEW]!.toString()).toBe(
      "/dashboard/:projectId/runbooks/runners/:id",
    );
    expect(RouteMap[PageMap.RUNBOOKS_RUNNER_CREDENTIALS]!.toString()).toBe(
      "/dashboard/:projectId/runbooks/runner-credentials",
    );
  });

  test("the Runbooks path table carries them", () => {
    expect(RunbookRoutePath[PageMap.RUNBOOKS_RUNNERS]).toBe("runners");
    expect(RunbookRoutePath[PageMap.RUNBOOKS_RUNNER_VIEW]).toBe("runners/:id");
    expect(RunbookRoutePath[PageMap.RUNBOOKS_RUNNER_CREDENTIALS]).toBe(
      "runner-credentials",
    );
  });

  test("no page key, and no Settings path, still names a Runner page", () => {
    const pageKeys: Array<string> = Object.values(PageMap);

    expect(
      pageKeys.filter((key: string): boolean => {
        return key.startsWith("SETTINGS_") && key.includes("RUNNER");
      }),
    ).toEqual([]);
    expect(
      Object.entries(SettingsRoutePath).filter(
        ([key, routePath]: [string, string]): boolean => {
          return NAMES_A_RUNNER.test(key) || NAMES_A_RUNNER.test(routePath);
        },
      ),
    ).toEqual([]);
  });

  test("every route that names a Runner is a Runbooks route", () => {
    const runnerRoutes: Array<string> = Object.values(RouteMap)
      .map((route: Route): string => {
        return route.toString();
      })
      .filter((route: string): boolean => {
        return RUNNER_PATH_SEGMENT.test(route);
      });

    expect(runnerRoutes.sort()).toEqual([
      "/dashboard/:projectId/runbooks/runner-credentials",
      "/dashboard/:projectId/runbooks/runners",
      "/dashboard/:projectId/runbooks/runners/:id",
    ]);
  });
});

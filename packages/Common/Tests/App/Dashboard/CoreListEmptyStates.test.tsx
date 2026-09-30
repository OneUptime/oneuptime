import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * What a brand-new project sees on the core lists of the Dashboard.
 *
 * Every one of them used to say "No X found." with an underlined "Refresh?"
 * under it - which, on a project that simply has none yet, reads like a failed
 * load - and the only way on was a button in the card's header. The pages now
 * use the table's own "No X yet." sentence, and under it the table repeats its
 * header's "Create X" button (same label, handler and permission gate) as the
 * primary action.
 *
 * The "slices" of a list - active incidents, monitors that are not
 * operational - word their own empty state ("Nice work! No Active Incidents so
 * far."), and a big Create button is the wrong answer there, so they keep
 * their sentence and the Refresh link.
 *
 * The real pages are rendered, with an empty project behind ModelAPI and a
 * project admin's permissions.
 */

let isMasterAdminForTest: boolean = false;
let permissionsForTest: Array<unknown> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: [...permissionsForTest] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return isMasterAdminForTest;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

// An empty project: every list is empty, every count is zero.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
      getItem: async (): Promise<null> => {
        return null;
      },
      count: async (): Promise<number> => {
        return 0;
      },
      deleteItem: async (): Promise<void> => {
        return undefined;
      },
      updateById: async (): Promise<void> => {
        return undefined;
      },
      createOrUpdate: async (): Promise<null> => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return "00000000-0000-4000-8000-000000000001";
          },
        };
      },
      getCurrentProject: (): null => {
        return null;
      },
      getCurrentPlan: (): null => {
        return null;
      },
    },
  };
});

import DashboardsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/Dashboards";
import IncidentsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Incidents";
import ActiveIncidentsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Unresolved";
import MonitorsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Monitors";
import NotOperationalMonitorsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/NotOperationalMonitors";
import OnCallDutyPoliciesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutyPolicies";
import OnCallDutySchedulesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutySchedules";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import RunbooksPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Runbooks";
import StatusPagesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/StatusPages";
import WorkflowsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/Workflows";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import Permission from "../../../Types/Permission";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import { getJestSpyOn } from "../../Spy";

const PROJECT_ID: string = "00000000-0000-4000-8000-000000000001";

let navigateCalls: Array<string> = [];

const pageProps: PageComponentProps = {
  pageRoute: RouteMap[PageMap.HOME] as Route,
  hasPaymentMethod: true,
  currentProject: null,
} as unknown as PageComponentProps;

interface CoreList {
  name: string;
  render: () => ReactElement;
  emptySentence: string;
  createLabel: string;
  // What the header shows today, which the empty state must repeat exactly.
  oldFoundSentence: string;
}

const CORE_LISTS: Array<CoreList> = [
  {
    name: "Monitors",
    render: (): ReactElement => {
      return <MonitorsPage {...pageProps} />;
    },
    emptySentence: "No monitors yet.",
    createLabel: "Create Monitor",
    oldFoundSentence: "No monitors found.",
  },
  {
    name: "Incidents",
    render: (): ReactElement => {
      return <IncidentsPage {...pageProps} />;
    },
    emptySentence: "No incidents yet.",
    createLabel: "Declare Incident",
    oldFoundSentence: "No incidents found.",
  },
  {
    name: "Status Pages",
    render: (): ReactElement => {
      return <StatusPagesPage {...pageProps} />;
    },
    emptySentence: "No status pages yet.",
    createLabel: "Create Status Page",
    oldFoundSentence: "No status pages found.",
  },
  {
    name: "On-Call Policies",
    render: (): ReactElement => {
      return <OnCallDutyPoliciesPage {...pageProps} />;
    },
    emptySentence: "No on-call duty policies yet.",
    createLabel: "Create On-Call Policy",
    oldFoundSentence: "No on-call policy found.",
  },
  {
    name: "On-Call Schedules",
    render: (): ReactElement => {
      return <OnCallDutySchedulesPage {...pageProps} />;
    },
    emptySentence: "No on-call schedules yet.",
    createLabel: "Create On-Call Schedule",
    oldFoundSentence: "No on-call schedule found.",
  },
  {
    name: "Workflows",
    render: (): ReactElement => {
      return <WorkflowsPage {...pageProps} />;
    },
    emptySentence: "No workflows yet.",
    createLabel: "Create Workflow",
    oldFoundSentence: "No workflows found.",
  },
  {
    name: "Dashboards",
    render: (): ReactElement => {
      return <DashboardsPage {...pageProps} />;
    },
    emptySentence: "No dashboards yet.",
    createLabel: "Create Dashboard",
    oldFoundSentence: "No dashboards found.",
  },
  {
    name: "Runbooks",
    render: (): ReactElement => {
      return <RunbooksPage {...pageProps} />;
    },
    emptySentence: "No runbooks yet.",
    createLabel: "Create Runbook",
    oldFoundSentence: "No runbooks created yet.",
  },
];

function emptyStateButton(): HTMLElement | null {
  return screen.queryByTestId("empty-table-create-button");
}

async function renderEmpty(list: CoreList): Promise<void> {
  render(list.render());
  await screen.findByText(list.emptySentence, {}, { timeout: 10000 });
}

beforeEach(() => {
  isMasterAdminForTest = false;
  permissionsForTest = [Permission.ProjectAdmin];
  navigateCalls = [];
  PermissionGate.clearPermissionPropsCache();
  window.history.replaceState(
    window.history.state,
    "",
    `/dashboard/${PROJECT_ID}/home`,
  );
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();

  /*
   * Spied rather than stubbed wholesale: the tables' URL-state helpers call
   * several other Navigation methods on mount, and only page transitions
   * matter here.
   */
  getJestSpyOn(Navigation, "navigate").mockImplementation(
    (route: unknown): void => {
      navigateCalls.push(String(route));
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each(CORE_LISTS)("$name, empty", (list: CoreList) => {
  test("says the table's own 'No X yet.'", async () => {
    await renderEmpty(list);

    expect(screen.getByText(list.emptySentence)).toBeInTheDocument();
    expect(screen.queryByText(list.oldFoundSentence)).toBeNull();
    expect(document.body.textContent || "").not.toMatch(/ found\./);
  });

  test("offers the header's create action as the primary button", async () => {
    await renderEmpty(list);

    await waitFor(() => {
      expect(emptyStateButton()).not.toBeNull();
    });
    expect(emptyStateButton()).toHaveTextContent(list.createLabel);
    expect(emptyStateButton()).not.toBeDisabled();
  });

  test("the empty state has no Refresh? link", async () => {
    await renderEmpty(list);
    await waitFor(() => {
      expect(emptyStateButton()).not.toBeNull();
    });

    expect(screen.queryByTestId("refresh-button")).toBeNull();
    expect(screen.queryByText("Refresh?")).toBeNull();
  });

  test("the button sits with the sentence, below the table", async () => {
    await renderEmpty(list);
    await waitFor(() => {
      expect(emptyStateButton()).not.toBeNull();
    });

    const sentence: HTMLElement = screen.getByText(list.emptySentence);
    const block: HTMLElement | null = sentence.closest(
      '[data-testid$="-no-items"]',
    );
    expect(block).not.toBeNull();
    expect(block!.contains(emptyStateButton()!)).toBe(true);
    // Not inside a table row that spans every column.
    expect(block!.closest("table")).toBeNull();
  });
});

describe("where the empty-state buttons lead", () => {
  test("Create Monitor opens the monitor create page", async () => {
    await renderEmpty(CORE_LISTS[0]!);
    await waitFor(() => {
      expect(emptyStateButton()).not.toBeNull();
    });

    fireEvent.click(emptyStateButton()!);

    expect(navigateCalls).toEqual([
      (RouteMap[PageMap.MONITOR_CREATE] as Route)
        .toString()
        .replace(":projectId", PROJECT_ID),
    ]);
  });

  test("Declare Incident opens the incident create page", async () => {
    await renderEmpty(CORE_LISTS[1]!);
    await waitFor(() => {
      expect(emptyStateButton()).not.toBeNull();
    });

    fireEvent.click(emptyStateButton()!);

    expect(navigateCalls).toEqual([
      (RouteMap[PageMap.INCIDENT_CREATE] as Route)
        .toString()
        .replace(":projectId", PROJECT_ID),
    ]);
  });

  test("Create Status Page opens the same create form as the header's button", async () => {
    await renderEmpty(CORE_LISTS[2]!);
    await waitFor(() => {
      expect(emptyStateButton()).not.toBeNull();
    });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(emptyStateButton()!);

    const dialog: HTMLElement = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Create Status Page");
    expect(navigateCalls).toEqual([]);
  });

  test("Create On-Call Schedule opens its create form", async () => {
    await renderEmpty(CORE_LISTS[4]!);
    await waitFor(() => {
      expect(emptyStateButton()).not.toBeNull();
    });

    fireEvent.click(emptyStateButton()!);

    const dialog: HTMLElement = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Create On-Call Schedule");
    expect(dialog).not.toHaveTextContent("On-Call Policy Schedule");
  });
});

describe("the empty-state button is gated like the header's", () => {
  test("a viewer sees Create Monitor locked, and clicking it goes nowhere", async () => {
    permissionsForTest = [Permission.Viewer];
    await renderEmpty(CORE_LISTS[0]!);
    await waitFor(() => {
      expect(emptyStateButton()).not.toBeNull();
    });

    expect(emptyStateButton()).toBeDisabled();
    fireEvent.click(emptyStateButton()!);
    expect(navigateCalls).toEqual([]);
  });

  test("while permissions have not loaded, there is no button to offer", async () => {
    permissionsForTest = [];
    await renderEmpty(CORE_LISTS[0]!);

    expect(emptyStateButton()).toBeNull();
    // With nothing to do instead, the Refresh link stays.
    expect(screen.getByTestId("refresh-button")).toBeInTheDocument();
  });
});

describe("slices of a list keep their own empty state", () => {
  test("Active Incidents says its own sentence, with no Create button", async () => {
    render(<ActiveIncidentsPage {...pageProps} />);

    await screen.findByText(
      "Nice work! No Active Incidents so far.",
      {},
      { timeout: 10000 },
    );
    expect(emptyStateButton()).toBeNull();
    expect(screen.getByTestId("refresh-button")).toBeInTheDocument();
  });

  test("Not Operational Monitors says none is reporting a problem, with no Create button", async () => {
    render(<NotOperationalMonitorsPage {...pageProps} />);

    await screen.findByText(
      "No monitors are reporting a problem.",
      {},
      { timeout: 10000 },
    );
    expect(emptyStateButton()).toBeNull();
    expect(screen.queryByText("All monitors in operational state.")).toBeNull();
    expect(
      screen.getAllByText("Not Operational Monitors").length,
    ).toBeGreaterThan(0);
  });
});

describe("the new list descriptions", () => {
  test.each([
    [
      "On-Call Schedules",
      (): ReactElement => {
        return <OnCallDutySchedulesPage {...pageProps} />;
      },
      "Rotations that decide who is on call at any moment.",
    ],
    [
      "Workflows",
      (): ReactElement => {
        return <WorkflowsPage {...pageProps} />;
      },
      "No-code automations that run when something happens",
    ],
    [
      "Dashboards",
      (): ReactElement => {
        return <DashboardsPage {...pageProps} />;
      },
      "Your own views of metrics, logs, traces, monitors and incidents",
    ],
    [
      "Active Incidents",
      (): ReactElement => {
        return <ActiveIncidentsPage {...pageProps} />;
      },
      "Incidents that are not resolved yet",
    ],
    [
      "Not Operational Monitors",
      (): ReactElement => {
        return <NotOperationalMonitorsPage {...pageProps} />;
      },
      "Monitors whose current status is not operational",
    ],
  ])(
    "%s explains what the list holds",
    async (_name: string, page: () => ReactElement, start: string) => {
      render(page());

      await waitFor(() => {
        expect(document.body.textContent || "").toContain(start);
      });
      expect(document.body.textContent || "").not.toContain(
        "Here is a list of",
      );
    },
  );
});

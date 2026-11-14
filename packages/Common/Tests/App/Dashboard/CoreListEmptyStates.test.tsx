// UX rule: Docs/ux/README.md#empty-states-and-suggestions
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
 * load - and the only way on was a button in the card's header. Each now
 * shows a real empty state: headed by the table's own "No X yet", saying what
 * the list is for (the card's description, which leaves the header while the
 * state shows it), and repeating its header's "Create X" button (same label,
 * handler and permission gate), drawn the way the header's is rather than as
 * a filled indigo one.
 *
 * A product's own list (Monitors, Incidents, Status Pages, On-Call Policies,
 * Workflows, Dashboards, Runbooks) explains the product under that empty
 * state while the project has none (Components/ProductOnboarding), and the
 * explanation's button is the list's Create: the empty state leaves its own
 * to it, unless the explanation has none to offer - a read-only member
 * reads it without one, and the empty state keeps its locked button and
 * the note that says why. A project that has had one (an archived one
 * counts) gets the empty state's own button.
 *
 * The "slices" of a list - active incidents, monitors that are not
 * operational - are all clear when empty: a green check, the good news, and
 * no Create button, which is the wrong answer there.
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

/*
 * What ModelAPI.count answers: a new project's zero, unless a test says the
 * project has had some.
 */
let mockCount: number = 0;

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
        return mockCount;
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
  /*
   * The product that explains itself under the list while the project has
   * none, as its showcase names it (ProductKey): none for a list that is
   * not a product's first page.
   */
  product?: string | undefined;
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
    product: "monitors",
  },
  {
    name: "Incidents",
    render: (): ReactElement => {
      return <IncidentsPage {...pageProps} />;
    },
    emptySentence: "No incidents yet.",
    createLabel: "Declare Incident",
    oldFoundSentence: "No incidents found.",
    product: "incidents",
  },
  {
    name: "Status Pages",
    render: (): ReactElement => {
      return <StatusPagesPage {...pageProps} />;
    },
    emptySentence: "No status pages yet.",
    createLabel: "Create Status Page",
    oldFoundSentence: "No status pages found.",
    product: "status-pages",
  },
  {
    name: "On-Call Policies",
    render: (): ReactElement => {
      return <OnCallDutyPoliciesPage {...pageProps} />;
    },
    emptySentence: "No on-call policies yet.",
    createLabel: "Create On-Call Policy",
    oldFoundSentence: "No on-call policy found.",
    product: "on-call",
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
    product: "workflows",
  },
  {
    name: "Dashboards",
    render: (): ReactElement => {
      return <DashboardsPage {...pageProps} />;
    },
    emptySentence: "No dashboards yet.",
    createLabel: "Create Dashboard",
    oldFoundSentence: "No dashboards found.",
    product: "dashboards",
  },
  {
    name: "Runbooks",
    render: (): ReactElement => {
      return <RunbooksPage {...pageProps} />;
    },
    emptySentence: "No runbooks yet.",
    createLabel: "Create Runbook",
    oldFoundSentence: "No runbooks created yet.",
    product: "runbooks",
  },
];

function emptyStateButton(): HTMLElement | null {
  return screen.queryByTestId("empty-table-create-button");
}

// The product's explanation under the list, while the project has none.
function showcase(): HTMLElement | null {
  return screen.queryByTestId("product-showcase");
}

// The explanation's button: the list's Create, under the empty state.
function showcaseButton(): HTMLElement | null {
  const drawn: HTMLElement | null = showcase();

  return drawn
    ? within(drawn).queryByTestId("resource-showcase-add-button")
    : null;
}

/*
 * The button a new project is offered first: the explanation's on a
 * product's own list, the empty state's on any other.
 */
async function firstButton(list: CoreList): Promise<HTMLElement> {
  return await waitFor((): HTMLElement => {
    const button: HTMLElement | null = list.product
      ? showcaseButton()
      : emptyStateButton();

    if (!button) {
      throw new Error(`No ${list.createLabel} button yet`);
    }

    return button;
  });
}

// The sentence is drawn as the empty state's title: a heading, no stop.
function titleOf(list: CoreList): string {
  return list.emptySentence.replace(/\.$/, "");
}

async function renderEmpty(list: CoreList): Promise<void> {
  render(list.render());
  await screen.findByText(titleOf(list), {}, { timeout: 10000 });
}

beforeEach(() => {
  isMasterAdminForTest = false;
  permissionsForTest = [Permission.ProjectAdmin];
  navigateCalls = [];
  mockCount = 0;
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
  test("is headed by the table's own 'No X yet'", async () => {
    await renderEmpty(list);

    const title: HTMLElement = screen.getByText(titleOf(list));

    expect(title.tagName).toBe("H3");
    expect(title.closest("[data-empty-state-kind]")).toHaveAttribute(
      "data-empty-state-kind",
      "empty",
    );
    expect(screen.queryByText(list.oldFoundSentence)).toBeNull();
    expect(document.body.textContent || "").not.toMatch(/ found\./);
  });

  test("says what the list is for, once, in the empty state", async () => {
    await renderEmpty(list);
    await firstButton(list);

    const description: HTMLElement = screen.getByTestId(
      "table-empty-state-description",
    );

    expect((description.textContent || "").trim().length).toBeGreaterThan(20);
    // Not said twice: the card's header leaves it out while the state shows it.
    expect(screen.queryByTestId("card-description")).toBeNull();
    // ...and the explanation under it, if any, does not say it again.
    expect(screen.queryByTestId("resource-showcase-description")).toBeNull();
  });

  test("offers the header's create action once: under the empty state, or in it", async () => {
    await renderEmpty(list);

    const button: HTMLElement = await firstButton(list);

    expect(button).toHaveTextContent(list.createLabel);
    expect(button).not.toBeDisabled();

    if (list.product) {
      // The product explains itself, and its button is the list's Create.
      expect(showcase()).toHaveAttribute("data-product", list.product);
      expect(emptyStateButton()).toBeNull();
    } else {
      // Drawn the way the header's is, not as a filled indigo one.
      expect(button.className).not.toContain("bg-indigo");
      expect(button.className).toContain("bg-white");
      expect(showcase()).toBeNull();
    }
  });

  test("the empty state has no Refresh? link", async () => {
    await renderEmpty(list);
    await firstButton(list);

    expect(screen.queryByTestId("refresh-button")).toBeNull();
    expect(screen.queryByText("Refresh?")).toBeNull();
  });

  test("the button sits with the sentence, or under it in the explanation, below the table", async () => {
    await renderEmpty(list);
    const button: HTMLElement = await firstButton(list);

    const sentence: HTMLElement = screen.getByText(titleOf(list));
    const block: HTMLElement | null = sentence.closest(
      '[data-testid$="-no-items"]',
    );
    expect(block).not.toBeNull();
    // Not inside a table row that spans every column.
    expect(block!.closest("table")).toBeNull();

    if (list.product) {
      // After the sentence, outside the table.
      expect(block!.contains(button)).toBe(false);
      expect(
        block!.compareDocumentPosition(showcase()!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(showcase()!.closest("table")).toBeNull();
    } else {
      expect(block!.contains(button)).toBe(true);
    }
  });

  test("a project that has had one: the empty state's own Create, as a plain button, and no explanation", async () => {
    // Archived ones, or ones another filter hides.
    mockCount = 3;
    await renderEmpty(list);

    await waitFor(() => {
      expect(emptyStateButton()).not.toBeNull();
    });
    expect(emptyStateButton()).toHaveTextContent(list.createLabel);
    expect(emptyStateButton()).not.toBeDisabled();
    expect(emptyStateButton()?.className).not.toContain("bg-indigo");
    expect(emptyStateButton()?.className).toContain("bg-white");
    expect(showcase()).toBeNull();
  });
});

describe("where a new project's first buttons lead", () => {
  test("Create Monitor opens the monitor create page", async () => {
    await renderEmpty(CORE_LISTS[0]!);

    fireEvent.click(await firstButton(CORE_LISTS[0]!));

    expect(navigateCalls).toEqual([
      (RouteMap[PageMap.MONITOR_CREATE] as Route)
        .toString()
        .replace(":projectId", PROJECT_ID),
    ]);
  });

  test("Declare Incident opens the incident create page", async () => {
    await renderEmpty(CORE_LISTS[1]!);

    fireEvent.click(await firstButton(CORE_LISTS[1]!));

    expect(navigateCalls).toEqual([
      (RouteMap[PageMap.INCIDENT_CREATE] as Route)
        .toString()
        .replace(":projectId", PROJECT_ID),
    ]);
  });

  test("Create Status Page opens the same create form as the header's button", async () => {
    await renderEmpty(CORE_LISTS[2]!);
    const button: HTMLElement = await firstButton(CORE_LISTS[2]!);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(button);

    const dialog: HTMLElement = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Create Status Page");
    expect(navigateCalls).toEqual([]);
  });

  test("Create On-Call Schedule opens its create form", async () => {
    await renderEmpty(CORE_LISTS[4]!);

    fireEvent.click(await firstButton(CORE_LISTS[4]!));

    const dialog: HTMLElement = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Create On-Call Schedule");
    // Never the model's retired name, still its API name (#6817).
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

  test("a viewer still reads what Monitors does, under the locked button, with no button of its own", async () => {
    permissionsForTest = [Permission.Viewer];
    await renderEmpty(CORE_LISTS[0]!);

    const explanation: HTMLElement = await screen.findByTestId(
      "product-showcase",
      {},
      { timeout: 10000 },
    );
    expect(explanation).toHaveAttribute("data-product", "monitors");
    expect(
      within(explanation).queryByTestId("resource-showcase-add-button"),
    ).toBeNull();
    expect(emptyStateButton()).toBeDisabled();
  });

  test("a viewer is told why, in words a phone can show", async () => {
    permissionsForTest = [Permission.Viewer];
    await renderEmpty(CORE_LISTS[0]!);
    await waitFor(() => {
      expect(emptyStateButton()).not.toBeNull();
    });

    expect(screen.getByTestId("table-empty-state-note")).toHaveTextContent(
      "You don't have permission to create these. Ask a project admin for access.",
    );
  });

  test("while permissions have not loaded, there is no button to offer", async () => {
    permissionsForTest = [];
    await renderEmpty(CORE_LISTS[0]!);

    expect(emptyStateButton()).toBeNull();
    // And no Refresh? link in its place: a reload shows the same nothing.
    expect(screen.queryByTestId("refresh-button")).toBeNull();
  });
});

describe("slices of a list are all clear when empty", () => {
  test("Active Incidents leads with the fact, then the good news, and offers no Create button", async () => {
    render(<ActiveIncidentsPage {...pageProps} />);

    const title: HTMLElement = await screen.findByText(
      "No active incidents",
      {},
      { timeout: 10000 },
    );

    expect(title.closest("[data-empty-state-kind]")).toHaveAttribute(
      "data-empty-state-kind",
      "all-clear",
    );
    expect(
      screen.getByText("Nice work! Every incident is resolved."),
    ).toBeInTheDocument();
    // Settle the header's create button, then look for its copy.
    await waitFor(() => {
      expect(screen.getAllByTestId("card-button").length).toBeGreaterThan(0);
    });
    expect(emptyStateButton()).toBeNull();
    expect(screen.queryByTestId("refresh-button")).toBeNull();
    // The list's description stays in its header.
    expect(screen.getByTestId("card-description")).toHaveTextContent(
      "Incidents that are not resolved yet",
    );
  });

  test("Not Operational Monitors says none is reporting a problem, with no Create button", async () => {
    render(<NotOperationalMonitorsPage {...pageProps} />);

    const title: HTMLElement = await screen.findByText(
      "No monitors are reporting a problem",
      {},
      { timeout: 10000 },
    );

    expect(title.closest("[data-empty-state-kind]")).toHaveAttribute(
      "data-empty-state-kind",
      "all-clear",
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

/*
 * The lists a team moving from another tool fills first - Monitors,
 * On-Call Policies and Schedules, Status Pages - offer the importer while
 * empty (#6809): one quiet link beside the list's Create, naming the tools
 * that fill that list, which opens the importer on those tools and says
 * where it came from. Only to someone who may create the list's record;
 * the other lists offer nothing of the kind.
 */
describe("the lists a team moving over fills first offer the importer", () => {
  const IMPORTER_PATH: string = (
    RouteMap[PageMap.SETTINGS_IMPORT_FROM_TOOL] as Route
  )
    .toString()
    .replace(":projectId", PROJECT_ID);

  const IMPORT_LISTS: Array<[string, CoreList, string, string]> = [
    [
      "Monitors",
      CORE_LISTS[0]!,
      "Import from UptimeRobot, Better Stack, Pingdom and others",
      "?from=monitors-empty&kind=Monitor",
    ],
    [
      "Status Pages",
      CORE_LISTS[2]!,
      "Import from UptimeRobot, Atlassian Statuspage or Better Stack",
      "?from=status-pages-empty&kind=StatusPage",
    ],
    [
      "On-Call Policies",
      CORE_LISTS[3]!,
      "Import from Opsgenie, PagerDuty, incident.io and others",
      "?from=on-call-policies-empty&kind=OnCallPolicy",
    ],
    [
      "On-Call Schedules",
      CORE_LISTS[4]!,
      "Import from Opsgenie, PagerDuty, incident.io and others",
      "?from=on-call-schedules-empty&kind=OnCallSchedule",
    ],
  ];

  function importLink(): HTMLElement | null {
    return screen.queryByTestId("empty-table-import-link");
  }

  async function findImportLink(): Promise<HTMLElement> {
    return await waitFor((): HTMLElement => {
      const found: HTMLElement | null = importLink();

      if (!found) {
        throw new Error("No import link yet");
      }

      return found;
    });
  }

  test.each(IMPORT_LISTS)(
    "%s: one quiet link in the empty state, naming the tools that fill the list",
    async (_name: string, list: CoreList, words: string) => {
      await renderEmpty(list);
      await firstButton(list);

      const link: HTMLElement = await findImportLink();

      expect(link).toHaveTextContent(words);
      expect(screen.getAllByTestId("empty-table-import-link")).toHaveLength(1);
      // In the empty state, with its sentence, not a banner over the page.
      expect(
        link
          .closest('[data-testid$="-no-items"]')
          ?.contains(screen.getByText(titleOf(list))),
      ).toBe(true);
      // A link, not a second button beside Create.
      expect(link.className).not.toContain("bg-white");
      expect(link.className).not.toContain("bg-indigo");
    },
  );

  test.each(IMPORT_LISTS)(
    "%s: the link opens the importer on the tools that fill the list, saying where it came from",
    async (_name: string, list: CoreList, _words: string, query: string) => {
      await renderEmpty(list);
      await firstButton(list);

      fireEvent.click(await findImportLink());

      expect(navigateCalls).toEqual([`${IMPORTER_PATH}${query}`]);
    },
  );

  test.each(IMPORT_LISTS)(
    "%s: a read-only member is not offered it",
    async (_name: string, list: CoreList) => {
      permissionsForTest = [Permission.Viewer];
      await renderEmpty(list);
      await waitFor(() => {
        expect(emptyStateButton()).not.toBeNull();
      });

      expect(importLink()).toBeNull();
    },
  );

  test("a project that has had a monitor (archived, or hidden by another filter) still offers it, after the empty state's own Create", async () => {
    mockCount = 3;
    await renderEmpty(CORE_LISTS[0]!);
    await waitFor(() => {
      expect(emptyStateButton()).not.toBeNull();
    });

    const link: HTMLElement = await findImportLink();

    expect(
      emptyStateButton()!.compareDocumentPosition(link) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test.each(
    CORE_LISTS.filter((list: CoreList): boolean => {
      return ![
        "Monitors",
        "Status Pages",
        "On-Call Policies",
        "On-Call Schedules",
      ].includes(list.name);
    }).map((list: CoreList): [string, CoreList] => {
      return [list.name, list];
    }),
  )(
    "%s offers no import: no tool OneUptime imports from fills it",
    async (_name: string, list: CoreList) => {
      await renderEmpty(list);
      await firstButton(list);

      expect(importLink()).toBeNull();
    },
  );
});

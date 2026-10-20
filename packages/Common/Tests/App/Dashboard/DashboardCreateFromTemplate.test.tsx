import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Dashboards > Create Dashboard, on the real page, table and dialog.
 *
 * The maintainer: "The workflow templates model is a lot easier to
 * understand and use. Please make the dashboard templates model like
 * workflow templates." Create Dashboard used to open Create from Template,
 * a wall of sixteen cards where a click on any card went straight on to a
 * second dialog, Create New Dashboard, with no way back to the cards. It
 * now opens one dialog, Create a dashboard, which picks its template the
 * way Create a workflow does and then asks for a name - filled in from the
 * template and numbered past the project's dashboards, since a dashboard's
 * name is unique in its project. Create opens the new dashboard.
 *
 * Only transport, permissions and translation are stubbed; ModelAPI answers
 * as an empty list, except for the names lookup and the create. The dialog
 * on its own is covered in CreateDashboardModal.test.tsx, and in a real
 * browser in packages/E2E/DashboardTemplates.
 */

const PROJECT_ID: string = "00000000-0000-4000-8000-000000000001";
const NEW_DASHBOARD_ID: string = "55555555-5555-4555-8555-555555555555";

jest.setTimeout(60000);

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return ["ProjectAdmin"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: ["ProjectAdmin"] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
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

const getListMock: jest.Mock<any> = jest.fn() as jest.Mock<any>;
const createMock: jest.Mock<any> = jest.fn() as jest.Mock<any>;
const createOrUpdateMock: jest.Mock<any> = jest.fn() as jest.Mock<any>;

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
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
      create: (...args: Array<unknown>): unknown => {
        return createMock(...args);
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
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
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { dashboardTemplateOptionDomId } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardTemplatePicker";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import Route from "../../../Types/API/Route";
import {
  DASHBOARD_TEMPLATE_MISC_DATA_KEY,
  DashboardTemplateType,
  RECOMMENDED_DASHBOARD_TEMPLATE_TYPES,
} from "../../../Types/Dashboard/DashboardTemplates";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import { getJestSpyOn } from "../../Spy";

const pageProps: PageComponentProps = {
  pageRoute: RouteMap[PageMap.DASHBOARDS] as Route,
  hasPaymentMethod: true,
  currentProject: null,
} as unknown as PageComponentProps;

const NEW_DASHBOARD_PATH: string = `/dashboard/${PROJECT_ID}/dashboards/${NEW_DASHBOARD_ID}`;

// A dialog drawn after a click has a slow CI runner's worth of time to show.
const SLOW_CI: { timeout: number } = { timeout: 10000 };

interface ListRequest {
  modelType: unknown;
  query: JSONObject;
  select: JSONObject;
  limit: number;
}

interface CreateRequest {
  model: Dashboard;
  modelType: unknown;
  miscDataProps: JSONObject;
}

interface ListResponse {
  data: Array<JSONObject>;
  count: number;
  skip: number;
  limit: number;
}

// What the project already has, archived dashboards included.
let existingDashboardNames: Array<string> = [];
let navigateCalls: Array<string> = [];

function listOf(rows: Array<JSONObject>): ListResponse {
  return { data: rows, count: rows.length, skip: 0, limit: 10 };
}

// The dialog's own lookup: every dashboard's name, nothing else.
function isNamesRequest(request: ListRequest): boolean {
  return (
    request.modelType === Dashboard &&
    JSON.stringify(request.select) === JSON.stringify({ name: true })
  );
}

function namesRequests(): Array<ListRequest> {
  return getListMock.mock.calls
    .map((call: Array<unknown>): ListRequest => {
      return call[0] as ListRequest;
    })
    .filter(isNamesRequest);
}

function answerNames(): ListResponse {
  return listOf(
    existingDashboardNames.map((name: string): JSONObject => {
      return { name };
    }),
  );
}

function createRequests(): Array<CreateRequest> {
  return createMock.mock.calls.map((call: Array<unknown>): CreateRequest => {
    return call[0] as CreateRequest;
  });
}

async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    for (let turn: number = 0; turn < 3; turn++) {
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 0);
      });
    }
  });
}

async function renderPage(): Promise<UserEvent> {
  render(<DashboardsPage {...pageProps} />);
  await screen.findByText("No dashboards yet", {}, { timeout: 10000 });
  await waitFor(() => {
    expect(
      screen.getAllByRole("button", { name: "Create Dashboard" }).length,
    ).toBeGreaterThan(0);
  });
  return userEvent.setup({ delay: null });
}

function dialog(): HTMLElement {
  return screen.getByRole("dialog", { name: "Create a dashboard" });
}

function queryDialog(): HTMLElement | null {
  return screen.queryByRole("dialog", { name: "Create a dashboard" });
}

function row(type: string): HTMLElement {
  return within(dialog()).getByTestId(dashboardTemplateOptionDomId(type));
}

function nameInput(): HTMLInputElement {
  return within(dialog()).getByTestId(
    "dashboard-name-input",
  ) as HTMLInputElement;
}

async function openDialog(user: UserEvent): Promise<void> {
  // The header's button (an empty list repeats it under its message).
  await user.click(
    screen.getAllByRole("button", { name: "Create Dashboard" })[0]!,
  );
  await screen.findByRole("dialog", { name: "Create a dashboard" }, SLOW_CI);
  // The names lookup the dialog starts as it opens.
  await settle();
}

async function useTemplate(user: UserEvent, type: string): Promise<void> {
  if (!within(dialog()).queryByTestId(dashboardTemplateOptionDomId(type))) {
    fireEvent.change(
      within(dialog()).getByTestId("dashboard-template-view-select"),
      { target: { value: "all" } },
    );
  }

  await user.click(row(type));
  await user.click(
    within(dialog()).getByRole("button", { name: "Use this template" }),
  );
  await waitFor(() => {
    expect(nameInput()).toBeInTheDocument();
  });
}

async function pressCreate(user: UserEvent): Promise<void> {
  await user.click(within(dialog()).getByTestId("modal-footer-submit-button"));
  await settle();
}

beforeEach(() => {
  existingDashboardNames = [];
  navigateCalls = [];
  PermissionGate.clearPermissionPropsCache();
  window.history.replaceState(
    window.history.state,
    "",
    `/dashboard/${PROJECT_ID}/dashboards`,
  );
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
  Element.prototype.scrollIntoView = jest.fn() as unknown as (
    arg?: boolean | ScrollIntoViewOptions,
  ) => void;

  getListMock.mockReset();
  getListMock.mockImplementation((request: unknown): Promise<ListResponse> => {
    if (isNamesRequest(request as ListRequest)) {
      return Promise.resolve(answerNames());
    }

    return Promise.resolve(listOf([]));
  });

  createMock.mockReset();
  createMock.mockImplementation((request: unknown): unknown => {
    const model: Dashboard = (request as CreateRequest).model;
    const created: Dashboard = new Dashboard();
    created._id = NEW_DASHBOARD_ID;
    created.name = model.name || "";

    return Promise.resolve({ data: created, miscData: {} });
  });

  createOrUpdateMock.mockReset();

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

describe("Create Dashboard", () => {
  test("opens Create a dashboard, and looks the project's dashboard names up as it opens", async () => {
    const user: UserEvent = await renderPage();

    expect(namesRequests()).toHaveLength(0);

    await openDialog(user);

    expect(
      within(dialog()).getByTestId("dashboard-start-from-scratch"),
    ).toBeVisible();
    await waitFor(() => {
      expect(namesRequests()).toHaveLength(1);
    });
    // Every dashboard, archived ones too: the server's unique check counts them.
    expect(namesRequests()[0]!.query).toEqual({});
  });

  test("opens on the way Create a workflow does: Start from scratch, then six recommended templates as rows", async () => {
    const user: UserEvent = await renderPage();
    await openDialog(user);

    expect(
      within(within(dialog()).getByRole("listbox"))
        .getAllByRole("option")
        .map((option: HTMLElement): string => {
          return option.getAttribute("data-testid") || "";
        }),
    ).toEqual(
      RECOMMENDED_DASHBOARD_TEMPLATE_TYPES.map((type: string): string => {
        return dashboardTemplateOptionDomId(type);
      }),
    );
    // Not the wall of cards it was, nor its second dialog.
    expect(
      screen.queryByRole("dialog", { name: "Create from Template" }),
    ).toBeNull();
    expect(screen.queryAllByTestId("dashboard-template-card")).toEqual([]);
  });

  test("the empty list's own Create Dashboard opens it too", async () => {
    const user: UserEvent = await renderPage();

    await user.click(screen.getByTestId("empty-table-create-button"));

    expect(
      await screen.findByRole(
        "dialog",
        { name: "Create a dashboard" },
        SLOW_CI,
      ),
    ).toBeVisible();
    await settle();
    expect(
      within(dialog()).getByTestId("dashboard-start-from-scratch"),
    ).toHaveFocus();
  });

  test("a template's row is named by its title and described by its description", async () => {
    const user: UserEvent = await renderPage();
    await openDialog(user);

    expect(row(DashboardTemplateType.Kubernetes)).toHaveAccessibleName(
      "Kubernetes Dashboard",
    );
    expect(row(DashboardTemplateType.Kubernetes)).toHaveAccessibleDescription(
      /Pod\/node CPU and memory averages/,
    );
  });
});

describe("from a template", () => {
  test("is a pick, Use this template, and Create: the name filled in, the template built, the new dashboard opened", async () => {
    const user: UserEvent = await renderPage();
    await openDialog(user);
    await useTemplate(user, DashboardTemplateType.Kubernetes);

    expect(nameInput()).toHaveValue("Kubernetes Dashboard");

    await pressCreate(user);

    await waitFor(() => {
      expect(navigateCalls).toEqual([NEW_DASHBOARD_PATH]);
    });

    const requests: Array<CreateRequest> = createRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.modelType).toBe(Dashboard);
    expect(requests[0]!.model.name).toBe("Kubernetes Dashboard");
    expect(requests[0]!.miscDataProps[DASHBOARD_TEMPLATE_MISC_DATA_KEY]).toBe(
      DashboardTemplateType.Kubernetes,
    );
    await waitFor(() => {
      expect(queryDialog()).toBeNull();
    });
    // The table's own create form is never used.
    expect(createOrUpdateMock).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("dialog", { name: "Create New Dashboard" }),
    ).toBeNull();
  });

  test("numbers the name past the dashboards the project has, archived ones included", async () => {
    existingDashboardNames = [
      "Kubernetes Dashboard",
      "kubernetes dashboard 2",
      "Kubernetes Cost Dashboard",
    ];
    const user: UserEvent = await renderPage();
    await openDialog(user);
    await useTemplate(user, DashboardTemplateType.Kubernetes);

    expect(nameInput()).toHaveValue("Kubernetes Dashboard 3");
  });

  test("a template off the recommended list is found under All templates and builds itself", async () => {
    const user: UserEvent = await renderPage();
    await openDialog(user);
    await useTemplate(user, DashboardTemplateType.StorageArray);
    await pressCreate(user);

    await waitFor(() => {
      expect(createRequests()).toHaveLength(1);
    });
    expect(createRequests()[0]!.model.name).toBe("Storage Array Dashboard");
    expect(
      createRequests()[0]!.miscDataProps[DASHBOARD_TEMPLATE_MISC_DATA_KEY],
    ).toBe(DashboardTemplateType.StorageArray);
  });

  /*
   * Two people creating "Kubernetes Dashboard" at once both get it filled
   * in; the server takes the first. The second sees why, in the dialog, can
   * change the name there - and the retry still builds the template.
   */
  test("a name taken meanwhile is refused in the dialog, and the retry still builds the template", async () => {
    createMock.mockImplementationOnce((): Promise<unknown> => {
      return Promise.reject(
        new BadDataException("Dashboard with the same name already exists."),
      );
    });
    const user: UserEvent = await renderPage();
    await openDialog(user);
    await useTemplate(user, DashboardTemplateType.Kubernetes);
    await pressCreate(user);

    expect(
      await within(dialog()).findByText(
        "Dashboard with the same name already exists.",
      ),
    ).toBeVisible();
    expect(navigateCalls).toEqual([]);

    await user.clear(nameInput());
    await user.type(nameInput(), "Kubernetes Dashboard 2");
    await pressCreate(user);

    await waitFor(() => {
      expect(navigateCalls).toEqual([NEW_DASHBOARD_PATH]);
    });
    expect(createRequests()).toHaveLength(2);
    expect(createRequests()[1]!.model.name).toBe("Kubernetes Dashboard 2");
    expect(
      createRequests()[1]!.miscDataProps[DASHBOARD_TEMPLATE_MISC_DATA_KEY],
    ).toBe(DashboardTemplateType.Kubernetes);
  });
});

describe("from scratch", () => {
  test("asks for a name, then opens an empty dashboard built from no template", async () => {
    const user: UserEvent = await renderPage();
    await openDialog(user);
    await user.click(
      within(dialog()).getByTestId("dashboard-start-from-scratch"),
    );

    expect(nameInput()).toHaveValue("");
    await pressCreate(user);

    expect(
      within(dialog()).getByText(
        "Please give this dashboard a name of at least 2 letters.",
      ),
    ).toBeVisible();
    expect(createRequests()).toHaveLength(0);

    await user.type(nameInput(), "Checkout on-call");
    await pressCreate(user);

    await waitFor(() => {
      expect(navigateCalls).toEqual([NEW_DASHBOARD_PATH]);
    });
    expect(createRequests()[0]!.model.name).toBe("Checkout on-call");
    expect(createRequests()[0]!.miscDataProps).not.toHaveProperty(
      DASHBOARD_TEMPLATE_MISC_DATA_KEY,
    );
  });
});

describe("closing", () => {
  test("creates nothing and opens nothing", async () => {
    const user: UserEvent = await renderPage();
    await openDialog(user);
    await useTemplate(user, DashboardTemplateType.Ceph);
    await user.click(within(dialog()).getByTestId("close-button"));

    await waitFor(() => {
      expect(queryDialog()).toBeNull();
    });
    expect(createRequests()).toHaveLength(0);
    expect(navigateCalls).toEqual([]);
  });

  test("the dialog opened again starts afresh, and looks the names up again", async () => {
    existingDashboardNames = ["Network Dashboard"];
    const user: UserEvent = await renderPage();
    await openDialog(user);
    await useTemplate(user, DashboardTemplateType.Network);
    expect(nameInput()).toHaveValue("Network Dashboard 2");
    await user.click(within(dialog()).getByTestId("close-button"));
    await waitFor(() => {
      expect(queryDialog()).toBeNull();
    });

    // A dashboard someone created in between counts too.
    existingDashboardNames = ["Network Dashboard", "Network Dashboard 2"];
    await openDialog(user);

    expect(
      within(dialog()).getByTestId("dashboard-wizard-step-content"),
    ).toHaveAttribute("data-step", "pick-template");
    expect(
      within(dialog()).queryByTestId("dashboard-template-details"),
    ).toBeNull();

    await useTemplate(user, DashboardTemplateType.Network);

    expect(nameInput()).toHaveValue("Network Dashboard 3");
    expect(namesRequests()).toHaveLength(2);
  });
});

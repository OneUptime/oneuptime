import "@testing-library/jest-dom";
import {
  act,
  cleanup,
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
 * Dashboards > Create Dashboard, on the real page, table, modal and form.
 *
 * The maintainer: "make software as simple as possible to use and reduce
 * decision paralysis". Creating a dashboard from a template used to take a
 * template card, then a second dialog asking for a Name from scratch -
 * right after the user had said "Kubernetes Dashboard" - and left them on
 * the list afterwards to find the new row and open it. Now a card opens the
 * form with the name filled in (numbered past the project's dashboards,
 * because a dashboard's name is unique in its project), the description
 * waits under More fields, and Create opens the new dashboard.
 *
 * Only transport, permissions and translation are stubbed; ModelAPI answers
 * as an empty list, except for the names lookup and the create.
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
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import Route from "../../../Types/API/Route";
import {
  DASHBOARD_TEMPLATE_MISC_DATA_KEY,
  DashboardTemplateType,
} from "../../../Types/Dashboard/DashboardTemplates";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import { getJestSpyOn } from "../../Spy";
import { listedNames } from "../../UI/Components/FoldedSection/FoldedSectionQueries";

const pageProps: PageComponentProps = {
  pageRoute: RouteMap[PageMap.DASHBOARDS] as Route,
  hasPaymentMethod: true,
  currentProject: null,
} as unknown as PageComponentProps;

const NEW_DASHBOARD_PATH: string = `/dashboard/${PROJECT_ID}/dashboards/${NEW_DASHBOARD_ID}`;

interface ListRequest {
  modelType: unknown;
  query: JSONObject;
  select: JSONObject;
  limit: number;
}

interface CreateRequest {
  model: Dashboard;
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

// The page's own lookup: every dashboard's name, nothing else.
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
  return createOrUpdateMock.mock.calls.map(
    (call: Array<unknown>): CreateRequest => {
      return call[0] as CreateRequest;
    },
  );
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

function picker(): HTMLElement {
  return screen.getByRole("dialog", { name: "Create from Template" });
}

function queryPicker(): HTMLElement | null {
  return screen.queryByRole("dialog", { name: "Create from Template" });
}

function card(name: string): HTMLElement {
  return within(picker()).getByRole("button", { name });
}

function createForm(): HTMLElement {
  return screen.getByRole("dialog", { name: "Create New Dashboard" });
}

function queryCreateForm(): HTMLElement | null {
  return screen.queryByRole("dialog", { name: "Create New Dashboard" });
}

function nameInput(): HTMLInputElement {
  return within(createForm()).getByRole("textbox", {
    name: "Name",
  }) as HTMLInputElement;
}

function descriptionInput(): HTMLElement {
  return within(createForm()).getByPlaceholderText("Description");
}

function createButton(): HTMLElement {
  return within(createForm()).getByTestId("modal-footer-submit-button");
}

async function openPicker(user: UserEvent): Promise<void> {
  // The header's button (an empty list repeats it under its message).
  await user.click(
    screen.getAllByRole("button", { name: "Create Dashboard" })[0]!,
  );
  await screen.findByRole("dialog", { name: "Create from Template" });
}

async function pickTemplate(user: UserEvent, name: string): Promise<void> {
  await openPicker(user);
  await user.click(card(name));
  await screen.findByRole("dialog", { name: "Create New Dashboard" });
  // BasicForm takes the initial values in an effect: let it settle.
  await settle();
}

async function pressCreate(user: UserEvent): Promise<void> {
  await waitFor(() => {
    expect(createButton()).toHaveTextContent("Create Dashboard");
  });
  await user.click(createButton());
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

  getListMock.mockReset();
  getListMock.mockImplementation((request: unknown): Promise<ListResponse> => {
    if (isNamesRequest(request as ListRequest)) {
      return Promise.resolve(answerNames());
    }

    return Promise.resolve(listOf([]));
  });

  createOrUpdateMock.mockReset();
  createOrUpdateMock.mockImplementation((request: unknown): unknown => {
    const model: Dashboard = (request as CreateRequest).model;

    return Promise.resolve({
      data: {
        _id: NEW_DASHBOARD_ID,
        name: model.name,
        description: model.description,
      },
      miscData: {},
    });
  });

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
  test("opens the template picker, and looks up the project's dashboard names while it is read", async () => {
    const user: UserEvent = await renderPage();

    expect(namesRequests()).toHaveLength(0);

    await openPicker(user);

    expect(card("Blank Dashboard")).toBeVisible();
    expect(card("Kubernetes Dashboard")).toBeVisible();
    await waitFor(() => {
      expect(namesRequests()).toHaveLength(1);
    });
    // Every dashboard, archived ones too: the server's unique check counts them.
    expect(namesRequests()[0]!.query).toEqual({});
  });

  test("a template card is named by its title and described by its description", async () => {
    const user: UserEvent = await renderPage();
    await openPicker(user);

    const kubernetes: HTMLElement = card("Kubernetes Dashboard");

    expect(kubernetes).toHaveAccessibleDescription(
      /Pod\/node CPU and memory averages/,
    );
    // Not confused with its neighbour, whose title contains the same words.
    expect(card("Kubernetes Cost Dashboard")).not.toBe(kubernetes);
  });
});

describe("picking a template", () => {
  test("opens the create form with the template's name filled in", async () => {
    const user: UserEvent = await renderPage();

    await pickTemplate(user, "Kubernetes Dashboard");

    expect(queryPicker()).toBeNull();
    expect(nameInput()).toHaveValue("Kubernetes Dashboard");
  });

  test("numbers the name past the dashboards the project has, archived ones included", async () => {
    existingDashboardNames = [
      "Kubernetes Dashboard",
      "kubernetes dashboard 2",
      "Kubernetes Cost Dashboard",
    ];
    const user: UserEvent = await renderPage();

    await pickTemplate(user, "Kubernetes Dashboard");

    expect(nameInput()).toHaveValue("Kubernetes Dashboard 3");
  });

  test("asks for nothing else: the description waits under More fields", async () => {
    const user: UserEvent = await renderPage();

    await pickTemplate(user, "Incident Dashboard");

    const moreFields: HTMLElement = within(createForm()).getByRole("button", {
      name: /More fields/,
    });

    expect(moreFields).toHaveAttribute("aria-expanded", "false");
    expect(listedNames(createForm())).toEqual(["Description"]);
    expect(descriptionInput()).not.toBeVisible();
    // One page: no steps to walk.
    expect(
      within(createForm()).queryByRole("navigation", { name: "Progress" }),
    ).toBeNull();
    expect(
      within(createForm()).queryByTestId("modal-footer-next-button"),
    ).toBeNull();
    expect(createButton()).toHaveTextContent("Create Dashboard");
  });

  test("Blank Dashboard leaves the name to its creator", async () => {
    existingDashboardNames = ["Blank Dashboard"];
    const user: UserEvent = await renderPage();

    await pickTemplate(user, "Blank Dashboard");

    expect(nameInput()).toHaveValue("");
    expect(nameInput()).toHaveAttribute("placeholder", "Production API Health");
  });

  test("a lookup that fails still fills in the template's own name", async () => {
    getListMock.mockImplementation((request: unknown): Promise<unknown> => {
      if (isNamesRequest(request as ListRequest)) {
        return Promise.reject(new Error("Network error"));
      }

      return Promise.resolve(listOf([]));
    });
    const user: UserEvent = await renderPage();

    await pickTemplate(user, "Alert Dashboard");

    expect(nameInput()).toHaveValue("Alert Dashboard");
  });
});

describe("Create", () => {
  test("is one click: the filled-in name and the template are sent, and the new dashboard opens", async () => {
    const user: UserEvent = await renderPage();

    await pickTemplate(user, "Kubernetes Dashboard");
    await pressCreate(user);

    await waitFor(() => {
      expect(navigateCalls).toEqual([NEW_DASHBOARD_PATH]);
    });

    const requests: Array<CreateRequest> = createRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.model.name).toBe("Kubernetes Dashboard");
    expect(requests[0]!.miscDataProps[DASHBOARD_TEMPLATE_MISC_DATA_KEY]).toBe(
      DashboardTemplateType.Kubernetes,
    );
    await waitFor(() => {
      expect(queryCreateForm()).toBeNull();
    });
  });

  test("sends a name typed over the filled-in one", async () => {
    existingDashboardNames = ["Hosts Dashboard"];
    const user: UserEvent = await renderPage();

    await pickTemplate(user, "Hosts Dashboard");
    expect(nameInput()).toHaveValue("Hosts Dashboard 2");

    await user.clear(nameInput());
    await user.type(nameInput(), "EU hosts");
    await pressCreate(user);

    await waitFor(() => {
      expect(navigateCalls).toEqual([NEW_DASHBOARD_PATH]);
    });
    expect(createRequests()[0]!.model.name).toBe("EU hosts");
    expect(
      createRequests()[0]!.miscDataProps[DASHBOARD_TEMPLATE_MISC_DATA_KEY],
    ).toBe(DashboardTemplateType.Host);
  });

  test("sends a description typed under More fields", async () => {
    const user: UserEvent = await renderPage();

    await pickTemplate(user, "Monitor Dashboard");
    await user.click(
      within(createForm()).getByRole("button", { name: /More fields/ }),
    );
    await user.type(descriptionInput(), "For the on-call standup");
    await pressCreate(user);

    await waitFor(() => {
      expect(createRequests()).toHaveLength(1);
    });
    expect(createRequests()[0]!.model.description).toBe(
      "For the on-call standup",
    );
  });

  test("a Blank dashboard needs its name, then opens empty, built from no template", async () => {
    const user: UserEvent = await renderPage();

    await pickTemplate(user, "Blank Dashboard");
    await pressCreate(user);

    expect(await within(createForm()).findByText("Name is required.")).toBe(
      within(createForm()).getByText("Name is required."),
    );
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

  /*
   * Two people creating "Kubernetes Dashboard" at once both get it filled
   * in; the server takes the first. The second sees why, in the form, can
   * change the name there - and the retry still builds the template (it was
   * once dropped on the first press of Create, so a retry made a blank
   * dashboard).
   */
  test("a name taken meanwhile is refused in the form, and the retry still builds the template", async () => {
    createOrUpdateMock.mockImplementationOnce((): Promise<unknown> => {
      return Promise.reject(
        new BadDataException("Dashboard with the same name already exists."),
      );
    });
    const user: UserEvent = await renderPage();

    await pickTemplate(user, "Kubernetes Dashboard");
    await pressCreate(user);

    expect(
      await within(createForm()).findByText(
        "Dashboard with the same name already exists.",
      ),
    ).toBeVisible();
    expect(navigateCalls).toEqual([]);
    expect(nameInput()).toHaveValue("Kubernetes Dashboard");

    await user.clear(nameInput());
    await user.type(nameInput(), "Kubernetes Dashboard 2");
    await pressCreate(user);

    await waitFor(() => {
      expect(navigateCalls).toEqual([NEW_DASHBOARD_PATH]);
    });

    const requests: Array<CreateRequest> = createRequests();
    expect(requests).toHaveLength(2);
    expect(requests[1]!.model.name).toBe("Kubernetes Dashboard 2");
    expect(requests[1]!.miscDataProps[DASHBOARD_TEMPLATE_MISC_DATA_KEY]).toBe(
      DashboardTemplateType.Kubernetes,
    );
  });

  test("closing the form creates nothing and opens nothing", async () => {
    const user: UserEvent = await renderPage();

    await pickTemplate(user, "Ceph Dashboard");
    await user.click(within(createForm()).getByTestId("close-button"));

    await waitFor(() => {
      expect(queryCreateForm()).toBeNull();
    });
    expect(createRequests()).toHaveLength(0);
    expect(navigateCalls).toEqual([]);
  });

  test("after closing one form, the next card picked starts afresh", async () => {
    existingDashboardNames = ["Network Dashboard"];
    const user: UserEvent = await renderPage();

    await pickTemplate(user, "Network Dashboard");
    expect(nameInput()).toHaveValue("Network Dashboard 2");
    await user.click(within(createForm()).getByTestId("close-button"));
    await waitFor(() => {
      expect(queryCreateForm()).toBeNull();
    });
    // The table tells the page the form closed from an effect: let it land.
    await settle();

    // A dashboard someone created in between counts too: looked up again.
    existingDashboardNames = ["Network Dashboard", "Network Dashboard 2"];
    await pickTemplate(user, "Blank Dashboard");

    expect(nameInput()).toHaveValue("");
    await user.type(nameInput(), "Edge routers");
    await pressCreate(user);

    await waitFor(() => {
      expect(createRequests()).toHaveLength(1);
    });
    // Blank: not the Network template picked before.
    expect(createRequests()[0]!.miscDataProps).not.toHaveProperty(
      DASHBOARD_TEMPLATE_MISC_DATA_KEY,
    );
    expect(namesRequests()).toHaveLength(2);
  });
});

describe("while the names are on the way", () => {
  let resolveNames: ((response: ListResponse) => void) | null = null;

  beforeEach(() => {
    resolveNames = null;
    getListMock.mockImplementation((request: unknown): Promise<unknown> => {
      if (isNamesRequest(request as ListRequest)) {
        return new Promise<ListResponse>(
          (resolve: (response: ListResponse) => void): void => {
            resolveNames = resolve;
          },
        );
      }

      return Promise.resolve(listOf([]));
    });
  });

  test("the picked card says it is busy, and the form opens with a unique name once they arrive", async () => {
    existingDashboardNames = ["SLO Dashboard"];
    const user: UserEvent = await renderPage();

    await openPicker(user);
    await user.click(card("SLO Dashboard"));

    expect(card("SLO Dashboard")).toHaveAttribute("aria-busy", "true");
    expect(card("Alert Dashboard")).not.toHaveAttribute("aria-busy");
    expect(queryCreateForm()).toBeNull();

    await act(async (): Promise<void> => {
      resolveNames?.(answerNames());
    });

    await screen.findByRole("dialog", { name: "Create New Dashboard" });
    await settle();
    expect(nameInput()).toHaveValue("SLO Dashboard 2");
  });

  test("closing the picker drops the pick: no form opens later", async () => {
    const user: UserEvent = await renderPage();

    await openPicker(user);
    await user.click(card("Metrics Dashboard"));
    await user.click(within(picker()).getByTestId("close-button"));

    expect(queryPicker()).toBeNull();

    await act(async (): Promise<void> => {
      resolveNames?.(answerNames());
    });
    await settle();

    expect(queryCreateForm()).toBeNull();
  });

  test("the last card picked is the one whose form opens", async () => {
    const user: UserEvent = await renderPage();

    await openPicker(user);
    await user.click(card("Proxmox Dashboard"));
    await user.click(card("VMware Dashboard"));

    expect(card("Proxmox Dashboard")).not.toHaveAttribute("aria-busy");
    expect(card("VMware Dashboard")).toHaveAttribute("aria-busy", "true");

    await act(async (): Promise<void> => {
      resolveNames?.(answerNames());
    });
    await screen.findByRole("dialog", { name: "Create New Dashboard" });
    await settle();

    expect(nameInput()).toHaveValue("VMware Dashboard");
    await pressCreate(user);
    await waitFor(() => {
      expect(createRequests()).toHaveLength(1);
    });
    expect(
      createRequests()[0]!.miscDataProps[DASHBOARD_TEMPLATE_MISC_DATA_KEY],
    ).toBe(DashboardTemplateType.VMware);
  });

  test("Blank Dashboard does not wait for them", async () => {
    const user: UserEvent = await renderPage();

    await openPicker(user);
    await user.click(card("Blank Dashboard"));

    await screen.findByRole("dialog", { name: "Create New Dashboard" });
    expect(resolveNames).not.toBeNull();
  });
});

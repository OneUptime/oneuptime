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
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { ComponentProps as MonitorTableProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorTable";
import { CardButtonSchema } from "../../../UI/Components/Card/Card";
import ActionButtonSchema from "../../../UI/Components/ActionButton/ActionButtonSchema";
import Monitor from "../../../Models/DatabaseModels/Monitor";

/*
 * Putting monitors in a monitor group, and taking them out, on the real
 * pages against a stubbed API.
 *
 * A new group used to open on an operational status and a full uptime bar,
 * with the one thing to do next - add its monitors - on another page, behind
 * Assign Monitor, one monitor per dialog. Now:
 *
 *   - the Overview of an empty group says so, with Add Monitors, which opens
 *     the group's Monitors page with its picker open (?addMonitors=true);
 *   - Add Monitors picks several monitors in one dialog, offering only the
 *     project's live monitors the group does not hold, and creates one row
 *     per pick, so one refusal does not lose the others: the dialog stays,
 *     says how many were added and why the rest were not, and keeps the
 *     picks that were not;
 *   - Remove asks first, names the monitor, and deletes only the row that
 *     pairs it with the group - never the monitor;
 *   - with nothing to pick - a project with no monitor yet, or a group that
 *     holds every one - the dialog says which, in place of an empty picker,
 *     and offers Create Monitor; when the monitors cannot be read it says
 *     why and offers Try again;
 *   - after an add or a remove the table is read again in place: the page
 *     is not swapped for its loader, so an open dialog does not flash away.
 *
 * The monitors table is a stand-in that draws the page's own card buttons
 * and row actions; the dialogs, the form and its picker are the real ones.
 */

const mockGetList: MockFunction = getJestMockFunction();
const mockCount: MockFunction = getJestMockFunction();
const mockPost: MockFunction = getJestMockFunction();
const mockCreate: MockFunction = getJestMockFunction();
const mockDeleteItem: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return mockGetList(...args);
      },
      count: (...args: Array<unknown>): unknown => {
        return mockCount(...args);
      },
      post: (...args: Array<unknown>): unknown => {
        return mockPost(...args);
      },
      create: (...args: Array<unknown>): unknown => {
        return mockCreate(...args);
      },
      deleteItem: (...args: Array<unknown>): unknown => {
        return mockDeleteItem(...args);
      },
    },
  };
});

let mockTableProps: MonitorTableProps | undefined;
let mockRows: Array<Monitor> = [];
// How many times the table was mounted: once, unless the page was swapped out.
let mockTableMounts: number = 0;
// The members the table was first drawn with.
let mockFirstTableQuery: string | undefined;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorTable",
  () => {
    return {
      __esModule: true,
      default: (props: MonitorTableProps): React.ReactElement => {
        mockTableProps = props;

        if (mockFirstTableQuery === undefined) {
          mockFirstTableQuery = JSON.stringify(props.query?._id);
        }

        React.useEffect(() => {
          mockTableMounts++;
        }, []);

        return (
          <section data-testid="monitors-table">
            <h2>{props.title}</h2>
            {(props.cardButtons || []).map(
              (button: CardButtonSchema, index: number): React.ReactElement => {
                return (
                  <button
                    key={index}
                    data-testid="table-card-button"
                    disabled={button.disabled}
                    title={button.tooltip}
                    onClick={button.onClick}
                  >
                    {button.title}
                  </button>
                );
              },
            )}
            {mockRows.map((row: Monitor): React.ReactElement => {
              return (
                <div key={row._id} data-testid={`row-${row._id}`}>
                  <span>{row.name}</span>
                  {(props.actionButtons || []).map(
                    (
                      action: ActionButtonSchema<Monitor>,
                      index: number,
                    ): React.ReactElement => {
                      return (
                        <button
                          key={index}
                          onClick={() => {
                            action.onClick(
                              row,
                              () => {},
                              () => {},
                            );
                          }}
                        >
                          {action.title}
                        </button>
                      );
                    },
                  )}
                </div>
              );
            })}
          </section>
        );
      },
    };
  },
);

/*
 * The group's details card, standing in for CardModelDetail: it draws each
 * field the page computes itself (Current Status), by its title.
 */
interface MockDetailField {
  title?: string;
  getElement?: (item: unknown) => ReactElement;
}

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: {
      modelDetailProps: { fields: Array<MockDetailField> };
    }): ReactElement => {
      return (
        <div data-testid="group-details">
          {props.modelDetailProps.fields.map(
            (field: MockDetailField, index: number): ReactElement => {
              return (
                <div key={index} data-testid={`detail-${field.title}`}>
                  {field.getElement ? field.getElement({}) : null}
                </div>
              );
            },
          )}
        </div>
      );
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const ObjectIDClass: new (id: string) => unknown = (
          jest.requireActual("../../../Types/ObjectID") as {
            default: new (id: string) => unknown;
          }
        ).default;
        return new ObjectIDClass("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

import MonitorGroupMonitors from "../../../../App/FeatureSet/Dashboard/src/Pages/MonitorGroup/View/Monitors";
import MonitorGroupView from "../../../../App/FeatureSet/Dashboard/src/Pages/MonitorGroup/View/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import MonitorGroupResource from "../../../Models/DatabaseModels/MonitorGroupResource";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import Route from "../../../Types/API/Route";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const GROUP_ID: string = "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a";
const CHECKOUT_ID: string = "c0ffee00-0000-4000-8000-00000000c001";
const STOREFRONT_ID: string = "c0ffee00-0000-4000-8000-00000000c002";
const PAYMENTS_ID: string = "c0ffee00-0000-4000-8000-00000000c003";
// The row that pairs Checkout API with the group.
const PAIRING_ID: string = "b0b0b0b0-0000-4000-8000-00000000b001";

const NOT_ALLOWED: string =
  "You need the Create Monitor Group Resource permission to do this.";
const REFUSAL: string = "This monitor cannot be put in a group.";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/monitor-groups/view"),
  currentProject: null,
  hasPaymentMethod: true,
};

// The group's members, as the server holds them.
let groupMonitorIds: Array<string> = [];
// The rows Remove finds pairing a monitor with the group.
let pairingRows: Array<string> = [];
// The project's live monitors, by name.
let projectMonitors: Array<{ id: string; name: string }> = [];
let addMonitorsQuery: string | null = null;
// May the reader put a monitor in a group?
let permission: PermissionGateResult = { isAllowed: true };
// May the reader create a monitor?
let createMonitorPermission: PermissionGateResult = { isAllowed: true };
let navigateSpy: ReturnType<typeof jest.spyOn>;
let setQueryStringSpy: ReturnType<typeof jest.spyOn>;

function monitor(id: string, name: string): Monitor {
  const item: Monitor = new Monitor();
  item._id = id;
  item.id = new ObjectID(id);
  item.name = name;
  return item;
}

function listOf<T>(data: Array<T>): unknown {
  return {
    data: data,
    count: data.length,
    skip: 0,
    limit: 10000,
  };
}

interface ListRequest {
  modelType: unknown;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
}

function listRequests(modelType: unknown): Array<ListRequest> {
  return mockGetList.mock.calls
    .map((call: Array<unknown>): ListRequest => {
      return call[0] as ListRequest;
    })
    .filter((request: ListRequest): boolean => {
      return request.modelType === modelType;
    });
}

interface CreateRequest {
  model: MonitorGroupResource;
  modelType: unknown;
}

function createdRows(): Array<CreateRequest> {
  return mockCreate.mock.calls.map((call: Array<unknown>): CreateRequest => {
    return call[0] as CreateRequest;
  });
}

beforeEach(() => {
  mockGetList.mockReset();
  mockCount.mockReset();
  mockPost.mockReset();
  mockCreate.mockReset();
  mockDeleteItem.mockReset();
  mockTableProps = undefined;
  mockRows = [];
  mockTableMounts = 0;
  mockFirstTableQuery = undefined;

  groupMonitorIds = [CHECKOUT_ID];
  pairingRows = [PAIRING_ID];
  projectMonitors = [
    { id: CHECKOUT_ID, name: "Checkout API" },
    { id: PAYMENTS_ID, name: "Payments" },
    { id: STOREFRONT_ID, name: "Storefront" },
  ];
  addMonitorsQuery = null;
  permission = { isAllowed: true };
  createMonitorPermission = { isAllowed: true };

  const operational: MonitorStatus = new MonitorStatus();
  operational.id = new ObjectID("22222222-2222-4222-8222-222222222222");
  operational.name = "Operational";
  operational.isOperationalState = true;

  mockGetList.mockImplementation((...args: Array<unknown>) => {
    const request: ListRequest = args[0] as ListRequest;

    if (request.modelType === MonitorGroupResource) {
      // Remove reads the one row that pairs a monitor with the group.
      if (request.select["_id"]) {
        return Promise.resolve(
          listOf(
            pairingRows.map((id: string): MonitorGroupResource => {
              const row: MonitorGroupResource = new MonitorGroupResource();
              row.id = new ObjectID(id);
              return row;
            }),
          ),
        );
      }

      return Promise.resolve(
        listOf(
          groupMonitorIds.map((id: string): MonitorGroupResource => {
            const row: MonitorGroupResource = new MonitorGroupResource();
            row.monitorId = new ObjectID(id);
            return row;
          }),
        ),
      );
    }

    if (request.modelType === Monitor) {
      return Promise.resolve(
        listOf(
          projectMonitors.map(
            (entry: { id: string; name: string }): Monitor => {
              return monitor(entry.id, entry.name);
            },
          ),
        ),
      );
    }

    if (request.modelType === MonitorStatus) {
      return Promise.resolve(listOf([operational]));
    }

    if (request.modelType === MonitorStatusTimeline) {
      return Promise.resolve(listOf([]));
    }

    return Promise.resolve(listOf([]));
  });

  // The server takes every row unless a test says otherwise.
  mockCreate.mockImplementation((...args: Array<unknown>) => {
    const request: CreateRequest = args[0] as CreateRequest;
    groupMonitorIds.push(request.model.monitorId!.toString());
    return Promise.resolve(request.model);
  });
  mockDeleteItem.mockImplementation(() => {
    return Promise.resolve();
  });
  mockPost.mockResolvedValue(operational);

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(GROUP_ID));
  jest
    .spyOn(Navigation, "getQueryStringByName")
    .mockImplementation((name: string): string | null => {
      return name === "addMonitors" ? addMonitorsQuery : null;
    });
  navigateSpy = jest.spyOn(Navigation, "navigate").mockImplementation(() => {
    return undefined;
  });
  setQueryStringSpy = jest
    .spyOn(Navigation, "setQueryString")
    .mockImplementation(() => {
      return undefined;
    });
  jest
    .spyOn(PermissionGate, "check")
    .mockImplementation((model: unknown): PermissionGateResult => {
      return model instanceof Monitor ? createMonitorPermission : permission;
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function monitorsPage(): ReactElement {
  return (
    <MemoryRouter>
      <MonitorGroupMonitors {...PAGE_PROPS} />
    </MemoryRouter>
  );
}

async function renderMonitorsPage(): Promise<void> {
  const view: RenderResult = render(monitorsPage());
  await screen.findByTestId("monitors-table");

  /*
   * Run the page's pending effects - the table's mount among them - before
   * a test looks. findByTestId returns once the table is drawn, and a busy
   * runner can run its effects a frame later: the table had then counted no
   * mount (Common Test on master, run 39183698213).
   */
  await act(async () => {
    view.rerender(monitorsPage());
  });
}

function dialog(): HTMLElement {
  return screen.getByTestId("modal");
}

function picker(): HTMLElement {
  return within(dialog()).getByRole("combobox");
}

// The picker's entries, its menu opened.
function offered(): Array<string> {
  fireEvent.keyDown(picker(), { key: "ArrowDown", code: "ArrowDown" });

  return Array.from(
    document.querySelectorAll<HTMLElement>(".ou-select__option"),
  ).map((element: HTMLElement): string => {
    return element.textContent || "";
  });
}

function pick(label: string): void {
  fireEvent.keyDown(picker(), { key: "ArrowDown", code: "ArrowDown" });

  const option: HTMLElement | undefined = Array.from(
    document.querySelectorAll<HTMLElement>(".ou-select__option"),
  ).find((element: HTMLElement): boolean => {
    return element.textContent === label;
  });

  expect(option).toBeDefined();
  fireEvent.click(option as HTMLElement);
}

function picked(): Array<string> {
  return Array.from(
    document.querySelectorAll<HTMLElement>(".ou-select__multi-value__label"),
  ).map((chip: HTMLElement): string => {
    return chip.textContent || "";
  });
}

// Opens Add Monitors and waits for the project's monitors to be read.
async function openAddMonitorsDialog(): Promise<void> {
  fireEvent.click(screen.getByTestId("table-card-button"));
  await waitFor(() => {
    expect(within(dialog()).getByText("Add Monitors to Group")).toBeVisible();
  });
  // The project's monitors are read as the dialog opens.
  await waitFor(() => {
    expect(listRequests(Monitor)).toHaveLength(1);
  });
}

// ...and waits for its picker.
async function openAddMonitors(): Promise<void> {
  await openAddMonitorsDialog();
  await within(dialog()).findByRole("combobox");
}

const NO_MONITORS_IN_PROJECT: string =
  "This project has no monitors yet. Create one, then add it to this group.";
const EVERY_MONITOR_IN_GROUP: string =
  "Every monitor in this project is already in this group.";

function footerButtons(): Array<string> {
  return within(within(dialog()).getByTestId("modal-footer"))
    .getAllByRole("button")
    .map((button: HTMLElement): string => {
      return button.textContent || "";
    });
}

async function submitAddMonitors(): Promise<void> {
  await act(async () => {
    fireEvent.click(within(dialog()).getByTestId("modal-footer-submit-button"));
  });
}

describe("the group's Monitors page: Add Monitors", () => {
  test("lists the group's members, with Add Monitors as its button and Remove as each row's action", async () => {
    await renderMonitorsPage();

    expect(mockTableProps?.title).toBe("Monitors in Group");
    // Only Remove: deleting a monitor from here would delete it everywhere.
    expect(mockTableProps?.isDeleteable).toBe(false);
    expect(mockTableProps?.disableCreate).toBe(true);
    expect(
      (mockTableProps?.actionButtons || []).map(
        (action: ActionButtonSchema<Monitor>): string => {
          return action.title;
        },
      ),
    ).toEqual(["Remove"]);
    expect(screen.getByTestId("table-card-button")).toHaveTextContent(
      "Add Monitors",
    );
    expect(screen.getByTestId("table-card-button")).toBeEnabled();
    expect(screen.queryByTestId("modal")).toBeNull();
  });

  test("draws the table once, with the group's members: never an empty group first", async () => {
    await renderMonitorsPage();

    // Drawn before the members were read, it said the group had none.
    expect(mockFirstTableQuery).toContain(CHECKOUT_ID);
    expect(mockTableMounts).toBe(1);
  });

  test("offers the project's live monitors the group does not hold, by name", async () => {
    await renderMonitorsPage();
    await openAddMonitors();

    expect(
      within(dialog()).getByText(
        "Pick the monitors that make up this service. The group shows the worst status among them.",
      ),
    ).toBeVisible();

    const request: ListRequest = listRequests(Monitor)[0]!;
    expect(request.query["isArchived"]).toBe(false);
    expect(String(request.query["projectId"])).toBe(PROJECT_ID);
    expect(request.sort).toEqual({ name: SortOrder.Ascending });

    // Checkout API is in the group already.
    expect(offered()).toEqual(["Payments", "Storefront"]);
  });

  test("adds every picked monitor at once, one row each, then closes", async () => {
    await renderMonitorsPage();
    await openAddMonitors();

    pick("Storefront");
    pick("Payments");
    expect(picked()).toEqual(["Storefront", "Payments"]);

    await submitAddMonitors();

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).toBeNull();
    });
    // Closing takes ?addMonitors off the address, so a reload does not reopen it.
    expect(setQueryStringSpy).toHaveBeenCalledWith({ addMonitors: null });

    const rows: Array<CreateRequest> = createdRows();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.modelType).toBe(MonitorGroupResource);
      expect(row.model.monitorGroupId?.toString()).toBe(GROUP_ID);
      expect(row.model.projectId?.toString()).toBe(PROJECT_ID);
    }
    expect(
      rows.map((row: CreateRequest): string => {
        return row.model.monitorId!.toString();
      }),
    ).toEqual([STOREFRONT_ID, PAYMENTS_ID]);

    // The table is read again, now with all three.
    await waitFor(() => {
      expect(mockTableProps?.query?._id).toBeDefined();
    });
    const memberRequests: Array<ListRequest> = listRequests(
      MonitorGroupResource,
    ).filter((request: ListRequest): boolean => {
      return Boolean(request.select["monitorId"]);
    });
    expect(memberRequests.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(mockTableProps?.query?._id)).toContain(PAYMENTS_ID);
    expect(JSON.stringify(mockTableProps?.query?._id)).toContain(STOREFRONT_ID);
  });

  test("adding the last monitors closes the dialog: it never says there is nothing left to add", async () => {
    let noticesDrawn: number = 0;
    const observer: MutationObserver = new MutationObserver(
      (records: Array<MutationRecord>): void => {
        for (const record of records) {
          for (const node of Array.from(record.addedNodes)) {
            if ((node.textContent || "").includes(EVERY_MONITOR_IN_GROUP)) {
              noticesDrawn++;
            }
          }
        }
      },
    );

    await renderMonitorsPage();
    await openAddMonitors();

    pick("Storefront");
    pick("Payments");

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    await submitAddMonitors();

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).toBeNull();
    });
    observer.disconnect();

    // The group now holds every monitor, and nothing said so on the way out.
    expect(createdRows()).toHaveLength(2);
    expect(noticesDrawn).toBe(0);
  });

  test("one refused monitor does not lose the others: how many were added, why the rest were not, and the refused one still picked", async () => {
    mockCreate.mockImplementation((...args: Array<unknown>) => {
      const request: CreateRequest = args[0] as CreateRequest;
      const id: string = request.model.monitorId!.toString();

      if (id === PAYMENTS_ID) {
        return Promise.reject(new Error(REFUSAL));
      }

      groupMonitorIds.push(id);
      return Promise.resolve(request.model);
    });

    await renderMonitorsPage();
    await openAddMonitors();

    pick("Storefront");
    pick("Payments");
    await submitAddMonitors();

    await waitFor(() => {
      expect(
        within(dialog()).getByText(
          `Added 1 of 2 monitors. Those still picked were not added: ${REFUSAL}`,
        ),
      ).toBeVisible();
    });

    // Both were tried, each on its own.
    expect(createdRows()).toHaveLength(2);

    // The dialog keeps the one that was not added, ready to try again...
    await waitFor(() => {
      expect(picked()).toEqual(["Payments"]);
    });

    /*
     * ...and no longer offers the one that was: Storefront is in the group
     * now, and the menu leaves out Payments, which is picked.
     */
    expect(offered()).toEqual([]);
    // A pick kept for another try is still something to add: no notice.
    expect(within(dialog()).queryByText(EVERY_MONITOR_IN_GROUP)).toBeNull();
    expect(within(dialog()).getByRole("combobox")).toBeInTheDocument();

    // The page was never swapped for its loader: the table stayed mounted.
    expect(mockTableMounts).toBe(1);

    // Trying again adds the one left - and only it, not Storefront twice.
    mockCreate.mockImplementation((...args: Array<unknown>) => {
      const request: CreateRequest = args[0] as CreateRequest;
      groupMonitorIds.push(request.model.monitorId!.toString());
      return Promise.resolve(request.model);
    });

    await submitAddMonitors();

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).toBeNull();
    });
    expect(
      createdRows().map((row: CreateRequest): string => {
        return row.model.monitorId!.toString();
      }),
    ).toEqual([STOREFRONT_ID, PAYMENTS_ID, PAYMENTS_ID]);
  });

  test("when none is added, it says so, with the reason, and keeps every pick", async () => {
    mockCreate.mockImplementation(() => {
      return Promise.reject(new Error(REFUSAL));
    });

    await renderMonitorsPage();
    await openAddMonitors();

    pick("Storefront");
    pick("Payments");
    await submitAddMonitors();

    await waitFor(() => {
      expect(
        within(dialog()).getByText(`No monitor was added: ${REFUSAL}`),
      ).toBeVisible();
    });
    await waitFor(() => {
      expect(picked()).toEqual(["Storefront", "Payments"]);
    });
  });

  test("a group that holds every monitor says so in place of an empty picker, and offers Create Monitor", async () => {
    groupMonitorIds = [CHECKOUT_ID, PAYMENTS_ID, STOREFRONT_ID];

    await renderMonitorsPage();
    await openAddMonitorsDialog();

    await waitFor(() => {
      expect(within(dialog()).getByText(EVERY_MONITOR_IN_GROUP)).toBeVisible();
    });
    // Drawn like the product's other "nothing to add" dialogs.
    const notice: HTMLElement = within(dialog()).getByTestId(
      "monitor-group-nothing-to-add",
    );
    expect(notice).toHaveAttribute("role", "status");
    expect(within(notice).getByText("Nothing to add")).toBeVisible();
    expect(
      within(notice).getByTestId("monitor-group-nothing-to-add-reason"),
    ).toHaveTextContent(EVERY_MONITOR_IN_GROUP);
    expect(within(dialog()).queryByText(NO_MONITORS_IN_PROJECT)).toBeNull();
    expect(within(dialog()).queryByRole("combobox")).toBeNull();
    expect(footerButtons()).toEqual(["Cancel", "Create Monitor"]);

    fireEvent.click(within(dialog()).getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).toBeNull();
    });
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect((navigateSpy.mock.calls[0]![0] as Route).toString()).toBe(
      `/dashboard/${PROJECT_ID}/monitors/create`,
    );
    expect(setQueryStringSpy).toHaveBeenCalledWith({ addMonitors: null });
    expect(createdRows()).toHaveLength(0);
  });

  test("a project with no monitor yet says so - not that the group holds them all - and offers Create Monitor", async () => {
    groupMonitorIds = [];
    projectMonitors = [];

    await renderMonitorsPage();
    await openAddMonitorsDialog();

    await waitFor(() => {
      expect(within(dialog()).getByText(NO_MONITORS_IN_PROJECT)).toBeVisible();
    });
    expect(within(dialog()).queryByText(EVERY_MONITOR_IN_GROUP)).toBeNull();
    expect(within(dialog()).queryByRole("combobox")).toBeNull();
    expect(
      within(dialog()).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Create Monitor");

    // Cancel closes it, and goes nowhere.
    fireEvent.click(within(dialog()).getByText("Cancel"));
    await waitFor(() => {
      expect(screen.queryByTestId("modal")).toBeNull();
    });
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  test("for whoever may not create a monitor, nothing to pick is a notice with one way out", async () => {
    groupMonitorIds = [];
    projectMonitors = [];
    createMonitorPermission = {
      isAllowed: false,
      disabledReason: "You need the Create Monitor permission to do this.",
    };

    await renderMonitorsPage();
    await openAddMonitorsDialog();

    await waitFor(() => {
      expect(within(dialog()).getByText(NO_MONITORS_IN_PROJECT)).toBeVisible();
    });
    expect(footerButtons()).toEqual(["Close"]);

    fireEvent.click(within(dialog()).getByTestId("modal-footer-close-button"));
    await waitFor(() => {
      expect(screen.queryByTestId("modal")).toBeNull();
    });
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  test("when the monitors cannot be read, it says why - not that there is nothing to add - and Try again reads them again", async () => {
    const READ_FAILURE: string = "The monitors could not be read.";
    let failedOnce: boolean = false;
    const listImplementation: (...args: Array<unknown>) => unknown =
      mockGetList.getMockImplementation() as (
        ...args: Array<unknown>
      ) => unknown;

    mockGetList.mockImplementation((...args: Array<unknown>) => {
      const request: ListRequest = args[0] as ListRequest;

      if (request.modelType === Monitor && !failedOnce) {
        failedOnce = true;
        return Promise.reject(new Error(READ_FAILURE));
      }

      return listImplementation(...args);
    });

    await renderMonitorsPage();
    await openAddMonitorsDialog();

    await waitFor(() => {
      expect(within(dialog()).getByText(READ_FAILURE)).toBeVisible();
    });
    expect(within(dialog()).queryByText(EVERY_MONITOR_IN_GROUP)).toBeNull();
    expect(within(dialog()).queryByText(NO_MONITORS_IN_PROJECT)).toBeNull();
    expect(within(dialog()).queryByRole("combobox")).toBeNull();
    expect(footerButtons()).toEqual(["Cancel", "Try again"]);

    fireEvent.click(within(dialog()).getByTestId("modal-footer-submit-button"));

    await within(dialog()).findByRole("combobox");
    expect(listRequests(Monitor)).toHaveLength(2);
    expect(within(dialog()).queryByText(READ_FAILURE)).toBeNull();
    expect(offered()).toEqual(["Payments", "Storefront"]);
  });

  test("opens afresh: closed and opened again, it reads the monitors again before it offers any", async () => {
    await renderMonitorsPage();
    await openAddMonitors();

    fireEvent.click(within(dialog()).getByText("Cancel"));
    await waitFor(() => {
      expect(screen.queryByTestId("modal")).toBeNull();
    });

    // Someone created a monitor meanwhile.
    projectMonitors.push({
      id: "c0ffee00-0000-4000-8000-00000000c004",
      name: "Search API",
    });

    // The second read waits until the test lets it answer.
    let answerRead: () => void = (): void => {};
    const listImplementation: (...args: Array<unknown>) => unknown =
      mockGetList.getMockImplementation() as (
        ...args: Array<unknown>
      ) => unknown;
    mockGetList.mockImplementation((...args: Array<unknown>) => {
      const request: ListRequest = args[0] as ListRequest;

      if (request.modelType === Monitor) {
        return new Promise((resolve: (value: unknown) => void) => {
          answerRead = (): void => {
            resolve(listImplementation(...args));
          };
        });
      }

      return listImplementation(...args);
    });

    /*
     * Every picker drawn from here on, even for a moment: opened on its old
     * answer, the dialog would draw the old picker before it reads again.
     */
    let pickersDrawn: number = 0;
    const observer: MutationObserver = new MutationObserver(
      (records: Array<MutationRecord>): void => {
        for (const record of records) {
          for (const node of Array.from(record.addedNodes)) {
            if (
              node instanceof Element &&
              (node.matches("[role='combobox']") ||
                node.querySelector("[role='combobox']"))
            ) {
              pickersDrawn++;
            }
          }
        }
      },
    );
    observer.observe(document.body, { childList: true, subtree: true });

    fireEvent.click(screen.getByTestId("table-card-button"));
    await waitFor(() => {
      expect(listRequests(Monitor)).toHaveLength(2);
    });

    // While it reads, no picker - and none was drawn on the old answer.
    expect(within(dialog()).getByText("Add Monitors to Group")).toBeVisible();
    expect(within(dialog()).queryByRole("combobox")).toBeNull();
    observer.disconnect();
    expect(pickersDrawn).toBe(0);

    await act(async () => {
      answerRead();
    });

    await within(dialog()).findByRole("combobox");
    expect(offered()).toEqual(["Payments", "Storefront", "Search API"]);
  });

  test("opens with the page when the Overview sent the reader here to add monitors", async () => {
    addMonitorsQuery = "true";

    await renderMonitorsPage();

    await waitFor(() => {
      expect(within(dialog()).getByText("Add Monitors to Group")).toBeVisible();
    });
    await waitFor(() => {
      expect(listRequests(Monitor)).toHaveLength(1);
    });
  });

  test("for whoever may not put a monitor in a group: no dialog with the page, and the button is locked with the reason", async () => {
    addMonitorsQuery = "true";
    permission = { isAllowed: false, disabledReason: NOT_ALLOWED };

    await renderMonitorsPage();

    expect(screen.queryByTestId("modal")).toBeNull();
    expect(listRequests(Monitor)).toHaveLength(0);

    const button: HTMLElement = screen.getByTestId("table-card-button");
    expect(button).toHaveTextContent("Add Monitors");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", NOT_ALLOWED);
  });
});

describe("the group's Monitors page: Remove", () => {
  async function removeCheckout(): Promise<void> {
    mockRows = [monitor(CHECKOUT_ID, "Checkout API")];
    await renderMonitorsPage();

    fireEvent.click(
      within(screen.getByTestId(`row-${CHECKOUT_ID}`)).getByRole("button", {
        name: "Remove",
      }),
    );

    await waitFor(() => {
      expect(within(dialog()).getByText("Remove from Group")).toBeVisible();
    });
  }

  test("asks first, naming the monitor, and says the monitor itself does not change", async () => {
    await removeCheckout();

    expect(
      within(dialog()).getByText(
        "Checkout API leaves this group. The monitor itself does not change.",
      ),
    ).toBeVisible();
    expect(
      within(dialog()).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Remove");
    expect(mockDeleteItem).not.toHaveBeenCalled();
  });

  test("deletes only the row that pairs the monitor with the group, never the monitor", async () => {
    await removeCheckout();

    await act(async () => {
      fireEvent.click(
        within(dialog()).getByTestId("modal-footer-submit-button"),
      );
    });

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).toBeNull();
    });

    expect(mockDeleteItem).toHaveBeenCalledTimes(1);

    // The table is read again in place: the page was not swapped out.
    await waitFor(() => {
      expect(
        listRequests(MonitorGroupResource).filter(
          (request: ListRequest): boolean => {
            return Boolean(request.select["monitorId"]);
          },
        ),
      ).toHaveLength(2);
    });
    expect(mockTableMounts).toBe(1);

    const removed: { modelType: unknown; id: ObjectID } = mockDeleteItem.mock
      .calls[0]![0] as { modelType: unknown; id: ObjectID };
    expect(removed.modelType).toBe(MonitorGroupResource);
    expect(removed.id.toString()).toBe(PAIRING_ID);

    // Looked up by this monitor and this group.
    const lookup: ListRequest = listRequests(MonitorGroupResource).find(
      (request: ListRequest): boolean => {
        return Boolean(request.select["_id"]);
      },
    )!;
    expect(String(lookup.query["monitorId"])).toBe(CHECKOUT_ID);
    expect(String(lookup.query["monitorGroupId"])).toBe(GROUP_ID);
  });

  test("a monitor someone already took out says so, and deletes nothing", async () => {
    pairingRows = [];
    await removeCheckout();

    await act(async () => {
      fireEvent.click(
        within(dialog()).getByTestId("modal-footer-submit-button"),
      );
    });

    await waitFor(() => {
      expect(
        within(dialog()).getByText("This monitor is no longer in the group."),
      ).toBeVisible();
    });
    expect(mockDeleteItem).not.toHaveBeenCalled();
  });
});

describe("the Overview of a group", () => {
  async function renderOverview(monitorCount: number): Promise<void> {
    mockCount.mockResolvedValue(monitorCount);

    render(
      <MemoryRouter>
        <MonitorGroupView {...PAGE_PROPS} />
      </MemoryRouter>,
    );
    await screen.findByTestId("group-details");
  }

  test("with no monitors says so, with Add Monitors in place of an uptime bar", async () => {
    await renderOverview(0);

    expect(screen.getByText("Monitors in Group")).toBeVisible();
    expect(screen.getByText("No monitors in this group yet")).toBeVisible();
    expect(
      screen.getByText(
        "Add the monitors that make up this service. The group shows the worst status among them.",
      ),
    ).toBeVisible();
    expect(screen.queryByText("Uptime Graph")).toBeNull();
    expect(screen.queryByTestId("day-uptime-graph")).toBeNull();

    // Nothing to be operational about: its status says it has no monitors.
    const status: HTMLElement = screen.getByTestId("detail-Current Status");
    expect(status).toHaveTextContent("No monitors yet");
    expect(status).not.toHaveTextContent("Operational");

    // It counted this group's monitors.
    const counted: { modelType: unknown; query: Record<string, unknown> } =
      mockCount.mock.calls[0]![0] as {
        modelType: unknown;
        query: Record<string, unknown>;
      };
    expect(counted.modelType).toBe(MonitorGroupResource);
    expect(String(counted.query["monitorGroupId"])).toBe(GROUP_ID);
  });

  test("Add Monitors opens the group's Monitors page with its picker open", async () => {
    await renderOverview(0);

    const button: HTMLElement = screen.getByTestId(
      "monitor-group-add-monitors",
    );
    expect(button).toHaveTextContent("Add Monitors");

    fireEvent.click(button);

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    const target: Route = navigateSpy.mock.calls[0]![0] as Route;
    expect(target.toString()).toBe(
      `/dashboard/${PROJECT_ID}/monitor-groups/${GROUP_ID}/monitors?addMonitors=true`,
    );
  });

  test("for whoever may not put a monitor in a group, says so without the button", async () => {
    permission = { isAllowed: false, disabledReason: NOT_ALLOWED };

    await renderOverview(0);

    expect(screen.getByText("No monitors in this group yet")).toBeVisible();
    expect(screen.queryByTestId("monitor-group-add-monitors")).toBeNull();
  });

  test("with monitors, draws its uptime graph and no empty state", async () => {
    await renderOverview(2);

    expect(screen.getByText("Uptime Graph")).toBeVisible();
    expect(screen.queryByText("No monitors in this group yet")).toBeNull();
    expect(screen.queryByTestId("monitor-group-add-monitors")).toBeNull();
    expect(screen.getByTestId("detail-Current Status")).toHaveTextContent(
      "Operational",
    );
  });
});

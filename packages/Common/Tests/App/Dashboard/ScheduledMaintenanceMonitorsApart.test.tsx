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
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Create Scheduled Maintenance Event's Resources Affected step, drawn for
 * real - the page's own fields in the real ModelForm and BasicForm, the real
 * pickers and the status page suggestions under the status page picker -
 * with only the network, the clock, the permissions and the address stubbed.
 *
 * The maintainer, on the incident form (#4354), and the same question here:
 *
 *   "we also need to have monitors and other affected resources as seperate
 *   things (so change monitor sttate to makes more sense), only show that
 *   dropdown if any monitor is selected."
 *
 * So the step asks for the event's monitors in a picker of their own, then
 * "Change Monitor Status to" right under them - only once a monitor is
 * picked, never folded - then the other affected resources, then the status
 * pages and the one line about subscribers. And what is created is what the
 * one picker created for the same picks: each pick in the column it always
 * went to, and no monitor status without a monitor for it to change.
 *
 * Every event here walks to the review with Next and is created from there,
 * as a person does.
 */

configure({ asyncUtilTimeout: 15000 });

jest.mock("../../../UI/Utils/Permission", () => {
  const actualPermission: Record<string, unknown> = jest.requireActual(
    "../../../Types/Permission",
  ) as Record<string, unknown>;
  const PermissionEnum: Record<string, string> = actualPermission[
    "default"
  ] as Record<string, string>;
  const granted: Array<string> = [
    PermissionEnum["ProjectOwner"]!,
    PermissionEnum["User"]!,
    PermissionEnum["Public"]!,
  ];

  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return granted;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: granted };
      },
    },
  };
});

// A project owner, not a master admin: the form shows what a person sees.
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

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      count: async (): Promise<number> => {
        return 0;
      },
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "project-1" };
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

import ScheduledMaintenanceCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Create";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Host from "../../../Models/DatabaseModels/Host";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import StatusPageEventType from "../../../Types/StatusPage/StatusPageEventType";
import StatusPagesListingMonitors from "../../../Types/StatusPage/StatusPagesListingMonitors";
import Timezone from "../../../Types/Timezone";
import API from "../../../UI/Utils/API/API";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";

const NOW: Date = new Date("2026-10-04T09:20:00.000Z");

const MONITOR_ID: string = "33333333-3333-4333-8333-000000000001";
const OTHER_MONITOR_ID: string = "33333333-3333-4333-8333-000000000002";
const HOST_ID: string = "44444444-4444-4444-8444-000000000001";
const OTHER_HOST_ID: string = "44444444-4444-4444-8444-000000000002";
const SITE_ID: string = "45444444-4444-4444-8444-000000000001";
const UNDER_MAINTENANCE_ID: string = "55555555-5555-4555-8555-000000000001";
const DEGRADED_ID: string = "55555555-5555-4555-8555-000000000002";
const STATUS_PAGE_ID: string = "66666666-6666-4666-8666-000000000001";
const TEMPLATE_ID: string = "77777777-7777-4777-8777-000000000001";
const CREATED_ID: string = "99999999-9999-4999-8999-000000000001";

const EVENT_STATUS_DESCRIPTION: string =
  "When the event starts, its monitors change to this status, and back to operational when it ends.";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(
    "/dashboard/project/scheduled-maintenance-events/create",
  ),
  currentProject: null,
  hasPaymentMethod: true,
};

interface ModelRequest {
  modelType: { new (): BaseModel };
  id?: ObjectID;
  select?: Record<string, unknown>;
  query?: Record<string, unknown>;
}

// The address the page is opened with.
let queryInUrl: Record<string, string> = {};

// What the server answers when the page looks a record up, by its ID.
let recordsOnServer: Record<string, BaseModel> = {};

let postMock: MockFunction;

function named<T extends BaseModel>(
  modelType: { new (): T },
  id: string,
  name: string,
  extra?: Record<string, unknown>,
): T {
  const model: T = new modelType();
  model._id = id;
  (model as unknown as Record<string, unknown>)["name"] = name;

  for (const [key, value] of Object.entries(extra || {})) {
    (model as unknown as Record<string, unknown>)[key] = value;
  }

  return model;
}

function listOf(data: Array<BaseModel>): unknown {
  return { data: data, count: data.length, skip: 0, limit: data.length };
}

// What the project has, by model: what a picker or dropdown lists.
function projectRecords(modelType: unknown): Array<BaseModel> {
  if (modelType === Monitor) {
    return [
      named(Monitor, MONITOR_ID, "Checkout API"),
      named(Monitor, OTHER_MONITOR_ID, "Payments API"),
    ];
  }

  if (modelType === Host) {
    return [
      named(Host, HOST_ID, "db-primary"),
      named(Host, OTHER_HOST_ID, "db-replica"),
    ];
  }

  if (modelType === NetworkSite) {
    return [named(NetworkSite, SITE_ID, "Frankfurt DC")];
  }

  if (modelType === MonitorStatus) {
    return [
      named(MonitorStatus, DEGRADED_ID, "Degraded", { priority: 2 }),
      named(MonitorStatus, UNDER_MAINTENANCE_ID, "Under Maintenance", {
        priority: 3,
      }),
    ];
  }

  if (modelType === StatusPage) {
    return [named(StatusPage, STATUS_PAGE_ID, "Acme Public Status")];
  }

  return [];
}

// A list request, answered from the project's records - by ID when it asks so.
async function answerList(request: ModelRequest): Promise<unknown> {
  const records: Array<BaseModel> = projectRecords(request.modelType);
  const idQuery: unknown = request.query?.["_id"];

  if (idQuery instanceof Includes) {
    const ids: Array<string> = idQuery.values.map((value: unknown): string => {
      return String(value);
    });

    return listOf(
      records.filter((record: BaseModel): boolean => {
        return ids.includes(String(record._id));
      }),
    );
  }

  return listOf(records);
}

async function answerItem(request: ModelRequest): Promise<unknown> {
  return recordsOnServer[request.id?.toString() || ""] || null;
}

// The models the page's pickers and dropdowns asked the API to list.
function listedModels(): Array<unknown> {
  return getListMock.mock.calls.map((call: Array<unknown>): unknown => {
    return (call[0] as ModelRequest).modelType;
  });
}

function form(): HTMLElement {
  return document.getElementById("create-scheduledMaintenance-form")!;
}

async function renderPage(): Promise<UserEvent> {
  await act(async (): Promise<void> => {
    render(
      <MemoryRouter>
        <ScheduledMaintenanceCreate {...PAGE_PROPS} />
      </MemoryRouter>,
    );
  });

  // The form, once whatever the page looked up is in.
  await screen.findByRole("navigation", { name: "Progress" });

  // The window's defaults land in an effect after the fields are drawn.
  await waitFor(() => {
    const startsAt: HTMLInputElement | null = form().querySelector(
      "input[type='datetime-local']",
    );

    expect(startsAt?.value || "").not.toBe("");
  });
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });

  return userEvent.setup({ delay: null });
}

function currentStepTitle(): string {
  const current: Element | null = screen
    .getByRole("navigation", { name: "Progress" })
    .querySelector("[aria-current='step']");

  return (current?.textContent || "").trim();
}

async function goToNextStep(expectedTitle: string): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Next", exact: true }));

  await waitFor(() => {
    expect(currentStepTitle()).toBe(expectedTitle);
  });
}

// A title: all an event cannot be scheduled without.
async function openResourcesAffected(): Promise<void> {
  const title: HTMLInputElement = within(form()).getByRole("textbox", {
    name: "Title",
  }) as HTMLInputElement;

  if (!title.value) {
    fireEvent.change(title, { target: { value: "Database upgrade" } });
    await act(async () => {});
  }

  await goToNextStep("Resources Affected");
}

// From the step on screen to the review, with Next.
async function walkToTheReview(): Promise<void> {
  for (let step: number = 0; step < 5; step++) {
    if (currentStepTitle() === "Summary") {
      return;
    }

    const before: string = currentStepTitle();

    fireEvent.click(screen.getByRole("button", { name: "Next", exact: true }));

    await waitFor(() => {
      expect(currentStepTitle()).not.toBe(before);
    });
  }

  expect(currentStepTitle()).toBe("Summary");
}

// From the step on screen: walk to the review, and create there.
async function create(): Promise<ScheduledMaintenance> {
  await walkToTheReview();

  fireEvent.click(
    screen.getByRole("button", { name: "Create Scheduled Maintenance Event" }),
  );

  await waitFor(() => {
    expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
  });

  return (
    createOrUpdateMock.mock.calls[0]![0] as { model: ScheduledMaintenance }
  ).model;
}

function monitorsPicker(): HTMLElement {
  return screen.getByRole("combobox", { name: /^Monitors/ });
}

function otherResourcesPicker(): HTMLElement {
  return screen.getByRole("combobox", { name: /^Other Affected Resources/ });
}

// The field a control belongs to: the label naming it, and what is under it.
function fieldOf(control: HTMLElement): HTMLElement {
  const labelId: string | null = control.getAttribute("aria-labelledby");

  expect(labelId).toBeTruthy();

  return document.getElementById(labelId!)!.parentElement as HTMLElement;
}

function monitorStatusLabel(): HTMLElement | null {
  return screen.queryByText("Change Monitor Status to");
}

// A dropdown opens on a click; its options are listed under it.
async function pickOption(
  user: UserEvent,
  combobox: HTMLElement,
  optionText: string,
): Promise<void> {
  await user.click(combobox);
  const options: Array<HTMLElement> = await screen.findAllByText(optionText, {
    exact: true,
  });
  await user.click(options[options.length - 1]!);
}

// A picker opens on a click and lists what it offers; a click on one picks it.
async function pickResource(
  user: UserEvent,
  picker: HTMLElement,
  name: string,
): Promise<void> {
  await user.click(picker);
  await user.click(await screen.findByRole("option", { name: name }));
  // The pick is written back a microtask later; its chip says it landed.
  await screen.findByRole("button", { name: `Remove ${name}` });
}

async function pickMonitorStatus(
  user: UserEvent,
  statusName: string,
): Promise<void> {
  await pickOption(
    user,
    await screen.findByRole("combobox", {
      name: /^Change Monitor Status to/,
    }),
    statusName,
  );
}

function isBefore(first: Node, second: Node): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

function idsOf(items: unknown): Array<string> {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item: unknown): string => {
    if (typeof item === "string") {
      return item;
    }

    const record: { _id?: unknown; id?: unknown } = item as {
      _id?: unknown;
      id?: unknown;
    };

    return String(record._id || record.id || "");
  });
}

// Every affected-resource relation an event has, by the IDs it holds.
function resourcesOf(
  event: ScheduledMaintenance,
): Record<string, Array<string>> {
  return {
    monitors: idsOf(event.monitors),
    hosts: idsOf(event.hosts),
    kubernetesClusters: idsOf(event.kubernetesClusters),
    dockerHosts: idsOf(event.dockerHosts),
    podmanHosts: idsOf(event.podmanHosts),
    proxmoxClusters: idsOf(event.proxmoxClusters),
    vmwareVCenters: idsOf(event.vmwareVCenters),
    cephClusters: idsOf(event.cephClusters),
    storageArrays: idsOf(event.storageArrays),
    dockerSwarmClusters: idsOf(event.dockerSwarmClusters),
    iotFleets: idsOf(event.iotFleets),
    databaseServers: idsOf(event.databaseServers),
    networkSites: idsOf(event.networkSites),
    services: idsOf(event.services),
  };
}

function noResources(): Record<string, Array<string>> {
  return {
    monitors: [],
    hosts: [],
    kubernetesClusters: [],
    dockerHosts: [],
    podmanHosts: [],
    proxmoxClusters: [],
    vmwareVCenters: [],
    cephClusters: [],
    storageArrays: [],
    dockerSwarmClusters: [],
    iotFleets: [],
    databaseServers: [],
    networkSites: [],
    services: [],
  };
}

function monitorStatusOf(event: ScheduledMaintenance): string | undefined {
  return (
    event.changeMonitorStatusTo?._id?.toString() ||
    event.changeMonitorStatusToId?.toString()
  );
}

// A template the page is opened from: ?scheduledMaintenanceTemplateId=.
function template(data: {
  monitors?: Array<Monitor>;
  hosts?: Array<Host>;
  changeMonitorStatusToId?: string;
}): void {
  const model: ScheduledMaintenanceTemplate =
    new ScheduledMaintenanceTemplate();
  model._id = TEMPLATE_ID;
  model.title = "Weekly database patching";

  if (data.monitors) {
    model.monitors = data.monitors;
  }

  if (data.hosts) {
    model.hosts = data.hosts;
  }

  if (data.changeMonitorStatusToId) {
    model.changeMonitorStatusToId = new ObjectID(data.changeMonitorStatusToId);
  }

  recordsOnServer[TEMPLATE_ID] = model;
  queryInUrl = { scheduledMaintenanceTemplateId: TEMPLATE_ID };
}

// The status page listing answer: the one page shows every monitor asked about.
function listingAnswer(): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    StatusPagesListingMonitors.toJSON({
      statusPages: [
        { statusPageId: STATUS_PAGE_ID, name: "Acme Public Status" },
      ],
    }),
    {},
  );
}

beforeEach(() => {
  queryInUrl = {};
  recordsOnServer = {
    [HOST_ID]: named(Host, HOST_ID, "db-primary"),
    [SITE_ID]: named(NetworkSite, SITE_ID, "Frankfurt DC"),
  };
  PermissionGate.clearPermissionPropsCache();

  getListMock.mockReset().mockImplementation(answerList as never);
  getItemMock.mockReset().mockImplementation(answerItem as never);
  createOrUpdateMock.mockReset().mockImplementation(((data: {
    model: BaseModel;
  }): Promise<unknown> => {
    return Promise.resolve({
      data: {
        ...BaseModel.toJSON(data.model, ScheduledMaintenance),
        _id: CREATED_ID,
      },
    });
  }) as never);

  postMock = getJestMockFunction();
  postMock.mockImplementation(async (): Promise<HTTPResponse<JSONObject>> => {
    return listingAnswer();
  });
  jest.spyOn(API, "post").mockImplementation(postMock as never);

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  OneUptimeDate.setUserTimezone(Timezone.UTC);
  jest
    .spyOn(Navigation, "getQueryStringByName")
    .mockImplementation((name: string): string | null => {
      return queryInUrl[name] || null;
    });
  jest.spyOn(Navigation, "navigate").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
});

describe("Resources Affected: the monitors apart, and the status they change to right under them", () => {
  test("asks for the monitors, then the other resources, each in a picker named by its own label", async () => {
    await renderPage();
    await openResourcesAffected();

    const monitors: HTMLElement = monitorsPicker();
    const others: HTMLElement = otherResourcesPicker();

    expect(monitors).toHaveAttribute("placeholder", "Search monitors...");
    // The other picker names what it searches, monitors not among them.
    expect(others.getAttribute("placeholder")).toMatch(/^Search host, /);
    expect(others.getAttribute("placeholder")).toContain("network site");
    expect(others.getAttribute("placeholder")).not.toContain("monitor");
    expect(isBefore(fieldOf(monitors), fieldOf(others))).toBe(true);
    expect(
      within(fieldOf(monitors)).getByText(
        "Search and attach the monitors affected by this scheduled maintenance.",
      ),
    ).toBeVisible();
    expect(
      within(fieldOf(others)).getByText(
        "Search and attach hosts, clusters, container hosts, databases, IoT fleets, network sites, or services affected by this scheduled maintenance. Attaching a network site covers every site beneath it.",
      ),
    ).toBeVisible();

    // No monitor picked: nothing for a status to change.
    expect(monitorStatusLabel()).toBeNull();
    // Both pickers come before the status pages and who hears.
    expect(
      isBefore(
        fieldOf(others),
        screen.getByText("Show event on these status pages", { exact: false }),
      ),
    ).toBe(true);
    // ...and no field is titled "Resources Affected" any more: that is the step.
    expect(
      within(fieldOf(monitors)).queryByText("Resources Affected"),
    ).toBeNull();
  });

  test("picking a monitor brings Change Monitor Status to, right under the monitors and never folded; removing the last one takes it away", async () => {
    const user: UserEvent = await renderPage();

    await openResourcesAffected();
    await pickResource(user, monitorsPicker(), "Checkout API");

    const status: HTMLElement = await screen.findByRole("combobox", {
      name: /^Change Monitor Status to/,
    });

    // Under the monitors it acts on, above everything else.
    expect(isBefore(fieldOf(monitorsPicker()), fieldOf(status))).toBe(true);
    expect(isBefore(fieldOf(status), fieldOf(otherResourcesPicker()))).toBe(
      true,
    );
    // On screen as soon as it is there: there is no More fields on the step.
    expect(status).toBeVisible();
    expect(screen.queryByRole("button", { name: "More fields" })).toBeNull();
    // It says what a maintenance event does with it.
    expect(
      within(fieldOf(status)).getByText(EVENT_STATUS_DESCRIPTION),
    ).toBeVisible();
    // It starts from nothing: no status is picked for the user.
    expect(status).toHaveValue("");

    await user.click(
      screen.getByRole("button", { name: "Remove Checkout API" }),
    );

    await waitFor(() => {
      expect(monitorStatusLabel()).toBeNull();
    });
  });

  test("a host or a network site picked among the other resources brings no monitor status", async () => {
    const user: UserEvent = await renderPage();

    await openResourcesAffected();
    await pickResource(user, otherResourcesPicker(), "db-primary");
    await pickResource(user, otherResourcesPicker(), "Frankfurt DC");

    expect(monitorStatusLabel()).toBeNull();
    // The chips are the other picker's, not the monitors'.
    for (const name of ["db-primary", "Frankfurt DC"]) {
      expect(
        within(fieldOf(otherResourcesPicker())).getByRole("button", {
          name: `Remove ${name}`,
        }),
      ).toBeInTheDocument();
    }
    expect(
      within(fieldOf(monitorsPicker())).queryByRole("button", {
        name: /^Remove /,
      }),
    ).toBeNull();
  });

  test("the Monitors picker lists monitors alone, and the other picker everything but monitors", async () => {
    const user: UserEvent = await renderPage();

    await openResourcesAffected();

    getListMock.mockClear();
    await user.click(monitorsPicker());
    await screen.findByRole("option", { name: "Checkout API" });

    expect(new Set(listedModels())).toEqual(new Set([Monitor]));

    // Closed again, and the other picker opened.
    await user.keyboard("{Escape}");
    getListMock.mockClear();
    await user.click(otherResourcesPicker());
    await screen.findByRole("option", { name: "db-primary" });

    expect(listedModels()).toEqual(expect.arrayContaining([Host, NetworkSite]));
    expect(listedModels()).not.toContain(Monitor);
    expect(screen.queryByRole("option", { name: "Checkout API" })).toBeNull();
  });
});

describe("what is created", () => {
  /*
   * The values the one "Resources Affected" picker sent for the same picks:
   * the monitor in `monitors`, the host in `hosts`, the site in
   * `networkSites`, the status and the status page each in their own column
   * - nothing moved.
   */
  test("a monitor, a host, a network site, a status and a status page: each stored where it always was", async () => {
    const user: UserEvent = await renderPage();

    await openResourcesAffected();
    await pickResource(user, monitorsPicker(), "Checkout API");
    await pickMonitorStatus(user, "Under Maintenance");
    await pickResource(user, otherResourcesPicker(), "db-primary");
    await pickResource(user, otherResourcesPicker(), "Frankfurt DC");
    await pickOption(
      user,
      screen.getByRole("combobox", {
        name: /^Show event on these status pages/,
      }),
      "Acme Public Status",
    );

    const event: ScheduledMaintenance = await create();

    expect(event.title).toBe("Database upgrade");
    expect(resourcesOf(event)).toEqual({
      ...noResources(),
      monitors: [MONITOR_ID],
      hosts: [HOST_ID],
      networkSites: [SITE_ID],
    });
    expect(monitorStatusOf(event)).toBe(UNDER_MAINTENANCE_ID);
    expect(idsOf(event.statusPages)).toEqual([STATUS_PAGE_ID]);
    // Subscribers hear as the folded line said, untouched.
    expect(event.shouldStatusPageSubscribersBeNotifiedOnEventCreated).toBe(
      true,
    );
    expect(
      event.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing,
    ).toBe(true);
    expect(
      event.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded,
    ).toBe(true);
    // And then the event's page.
    await waitFor(() => {
      expect(Navigation.navigate).toHaveBeenCalled();
    });
  });

  test("created with nothing picked on the step: no resources and no status", async () => {
    await renderPage();
    await openResourcesAffected();

    const event: ScheduledMaintenance = await create();

    expect(resourcesOf(event)).toEqual(noResources());
    expect(monitorStatusOf(event)).toBeUndefined();
    expect(idsOf(event.statusPages)).toEqual([]);
  });

  test("each picker writes back only its own: a template's hosts stay when a monitor is picked, and its monitors when a host is", async () => {
    template({
      monitors: [named(Monitor, MONITOR_ID, "Checkout API")],
      hosts: [named(Host, HOST_ID, "db-primary")],
    });

    const user: UserEvent = await renderPage();

    await screen.findByDisplayValue("Weekly database patching");
    await goToNextStep("Resources Affected");

    await pickResource(user, monitorsPicker(), "Payments API");
    await pickResource(user, otherResourcesPicker(), "db-replica");

    const event: ScheduledMaintenance = await create();

    expect(resourcesOf(event)).toEqual({
      ...noResources(),
      monitors: [MONITOR_ID, OTHER_MONITOR_ID],
      hosts: [HOST_ID, OTHER_HOST_ID],
    });
  });

  test("no monitor picked: no monitor status is sent, not even the one the template set", async () => {
    template({
      hosts: [named(Host, HOST_ID, "db-primary")],
      changeMonitorStatusToId: UNDER_MAINTENANCE_ID,
    });

    await renderPage();

    await screen.findByDisplayValue("Weekly database patching");
    await goToNextStep("Resources Affected");

    expect(monitorStatusLabel()).toBeNull();

    const event: ScheduledMaintenance = await create();

    expect(idsOf(event.hosts)).toEqual([HOST_ID]);
    expect(monitorStatusOf(event)).toBeUndefined();
    expect("changeMonitorStatusTo" in event).toBe(false);
    expect("changeMonitorStatusToId" in event).toBe(false);
  });

  test("a template's monitors bring its status along, already picked, and both are sent", async () => {
    template({
      monitors: [named(Monitor, MONITOR_ID, "Checkout API")],
      changeMonitorStatusToId: UNDER_MAINTENANCE_ID,
    });

    await renderPage();

    await screen.findByDisplayValue("Weekly database patching");
    await goToNextStep("Resources Affected");

    // A picked dropdown reads as a button with its value, named by its label.
    const status: HTMLElement = await screen.findByRole("button", {
      name: /^Change Monitor Status to/,
    });

    await waitFor(() => {
      expect(within(status).getByText("Under Maintenance")).toBeVisible();
    });
    expect(isBefore(fieldOf(monitorsPicker()), status)).toBe(true);

    const event: ScheduledMaintenance = await create();

    expect(idsOf(event.monitors)).toEqual([MONITOR_ID]);
    expect(monitorStatusOf(event)).toBe(UNDER_MAINTENANCE_ID);
  });

  test("a template's status shows, already picked, once a monitor is picked, and is sent with it", async () => {
    template({ changeMonitorStatusToId: DEGRADED_ID });

    const user: UserEvent = await renderPage();

    await screen.findByDisplayValue("Weekly database patching");
    await goToNextStep("Resources Affected");

    expect(monitorStatusLabel()).toBeNull();

    await pickResource(user, monitorsPicker(), "Payments API");

    const status: HTMLElement = await screen.findByRole("button", {
      name: /^Change Monitor Status to/,
    });

    await waitFor(() => {
      expect(within(status).getByText("Degraded")).toBeVisible();
    });

    const event: ScheduledMaintenance = await create();

    expect(idsOf(event.monitors)).toEqual([OTHER_MONITOR_ID]);
    expect(monitorStatusOf(event)).toBe(DEGRADED_ID);
  });

  test("a status picked, then the last monitor removed: hidden, and not sent", async () => {
    const user: UserEvent = await renderPage();

    await openResourcesAffected();
    await pickResource(user, monitorsPicker(), "Checkout API");
    await pickMonitorStatus(user, "Degraded");

    await user.click(
      screen.getByRole("button", { name: "Remove Checkout API" }),
    );

    await waitFor(() => {
      expect(monitorStatusLabel()).toBeNull();
    });

    const event: ScheduledMaintenance = await create();

    expect(idsOf(event.monitors)).toEqual([]);
    expect(monitorStatusOf(event)).toBeUndefined();
  });

  test("picked again, a monitor brings the status back as it was, and it is sent", async () => {
    const user: UserEvent = await renderPage();

    await openResourcesAffected();
    await pickResource(user, monitorsPicker(), "Checkout API");
    await pickMonitorStatus(user, "Degraded");

    await user.click(
      screen.getByRole("button", { name: "Remove Checkout API" }),
    );
    await waitFor(() => {
      expect(monitorStatusLabel()).toBeNull();
    });

    await pickResource(user, monitorsPicker(), "Payments API");

    const status: HTMLElement = await screen.findByRole("button", {
      name: /^Change Monitor Status to/,
    });

    await waitFor(() => {
      expect(within(status).getByText("Degraded")).toBeVisible();
    });

    const event: ScheduledMaintenance = await create();

    expect(idsOf(event.monitors)).toEqual([OTHER_MONITOR_ID]);
    expect(monitorStatusOf(event)).toBe(DEGRADED_ID);
  });
});

describe("opened from a record's own Scheduled Maintenance tab", () => {
  test("from a host's tab: the host is among the other resources, and no status is asked", async () => {
    queryInUrl = { hostId: HOST_ID };

    await renderPage();
    await openResourcesAffected();

    expect(
      within(fieldOf(otherResourcesPicker())).getByRole("button", {
        name: "Remove db-primary",
      }),
    ).toBeInTheDocument();
    expect(
      within(fieldOf(monitorsPicker())).queryByRole("button", {
        name: /^Remove /,
      }),
    ).toBeNull();
    expect(monitorStatusLabel()).toBeNull();

    const event: ScheduledMaintenance = await create();

    expect(resourcesOf(event)).toEqual({
      ...noResources(),
      hosts: [HOST_ID],
    });
  });

  test("from a network site's tab: the site is among the other resources", async () => {
    queryInUrl = { networkSiteId: SITE_ID };

    await renderPage();
    await openResourcesAffected();

    expect(
      within(fieldOf(otherResourcesPicker())).getByRole("button", {
        name: "Remove Frankfurt DC",
      }),
    ).toBeInTheDocument();

    const event: ScheduledMaintenance = await create();

    expect(resourcesOf(event)).toEqual({
      ...noResources(),
      networkSites: [SITE_ID],
    });
  });
});

describe("the status pages that show the monitors are still suggested", () => {
  test("a monitor picked in the Monitors picker: its pages are suggested, one click adds one, and the event is created on it", async () => {
    const user: UserEvent = await renderPage();

    await openResourcesAffected();
    await pickResource(user, monitorsPicker(), "Checkout API");

    const suggestions: HTMLElement = await screen.findByRole("group", {
      name: "Status pages that show the affected monitor:",
    });

    // Asked about the picked monitor, for a maintenance event.
    const request: Record<string, unknown> = postMock.mock.calls[
      postMock.mock.calls.length - 1
    ]![0] as Record<string, unknown>;

    expect(request["data"]).toEqual({
      monitorIds: [MONITOR_ID],
      eventType: StatusPageEventType.ScheduledEvent,
    });

    fireEvent.click(
      within(suggestions).getByRole("button", {
        name: "Add Acme Public Status",
      }),
    );

    expect(
      await screen.findByRole("button", { name: "Remove Acme Public Status" }),
    ).toBeInTheDocument();

    const event: ScheduledMaintenance = await create();

    expect(idsOf(event.monitors)).toEqual([MONITOR_ID]);
    expect(idsOf(event.statusPages)).toEqual([STATUS_PAGE_ID]);
  });

  test("only other resources picked: nothing is asked, and nothing is suggested", async () => {
    const user: UserEvent = await renderPage();

    await openResourcesAffected();
    await pickResource(user, otherResourcesPicker(), "db-primary");

    // Longer than the suggestions wait for picking to settle.
    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 600);
      });
    });

    expect(postMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("status-page-suggestions-line")).toBeNull();
  });
});

describe("the review step", () => {
  // The review's section for the step: its heading and the rows under it.
  async function reviewOfResourcesAffected(): Promise<HTMLElement> {
    await walkToTheReview();

    return (await screen.findByRole("heading", { name: "Resources Affected" }))
      .parentElement as HTMLElement;
  }

  test("names the monitors and the other resources apart, and asks no status without a monitor", async () => {
    const user: UserEvent = await renderPage();

    await openResourcesAffected();
    await pickResource(user, otherResourcesPicker(), "db-primary");

    const review: HTMLElement = await reviewOfResourcesAffected();

    expect(
      within(review).getByText(
        "No monitors affected by this scheduled maintenance event.",
      ),
    ).toBeInTheDocument();
    expect(await within(review).findByText("db-primary")).toBeInTheDocument();
    // No monitor: no status to confirm.
    expect(within(review).queryByText("Change Monitor Status to")).toBeNull();
    // Who hears is still said in the section's line.
    expect(
      within(review).getByTestId("form-summary-section-summary"),
    ).toBeInTheDocument();
  });

  test("with a monitor, confirms the status it changes to - none picked included", async () => {
    const user: UserEvent = await renderPage();

    await openResourcesAffected();
    await pickResource(user, monitorsPicker(), "Checkout API");

    const review: HTMLElement = await reviewOfResourcesAffected();

    expect(await within(review).findByText("Checkout API")).toBeInTheDocument();
    expect(
      within(review).getByText("Change Monitor Status to"),
    ).toBeInTheDocument();
    expect(
      within(review).getByText(
        "Status of the monitors will not be changed when this scheduled maintenance event starts.",
      ),
    ).toBeInTheDocument();
    expect(
      within(review).getByText(
        "No other resources affected by this scheduled maintenance event.",
      ),
    ).toBeInTheDocument();
  });

  test("with a monitor and a status, names the status", async () => {
    const user: UserEvent = await renderPage();

    await openResourcesAffected();
    await pickResource(user, monitorsPicker(), "Checkout API");
    await pickMonitorStatus(user, "Under Maintenance");

    const review: HTMLElement = await reviewOfResourcesAffected();

    expect(
      await within(review).findByText("Under Maintenance"),
    ).toBeInTheDocument();
  });
});

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
 * Declare Incident's Resources Affected step, drawn for real - the page's
 * own fields in the real ModelForm and BasicForm, with only the network,
 * the permissions and the address stubbed. The maintainer:
 *
 *   "Limit to these status pages and notifiy subscribers should be in
 *   advanced. change monitor stattus page to should be outside of advanced."
 *
 *   "we also need to have monitors and other affected resources as seperate
 *   things (so change monitor sttate to makes more sense), only show that
 *   dropdown if any monitor is selected."
 *
 * So the step asks for the monitors in a picker of their own, then "Change
 * Monitor Status to" right under them - only once a monitor is picked, and
 * starting from what it was handed (empty, or a template's status) - then
 * the other affected resources; the status page limit and the notify box
 * wait, folded, under Advanced. And what is declared is what the one picker
 * declared for the same picks: each pick in the column it always went to,
 * and no monitor status without a monitor for it to change.
 *
 * Every declaration here walks to the review with Next and declares from
 * there, as a person does.
 */

configure({ asyncUtilTimeout: 15000 });

const CRITICAL_ID: string = "22222222-2222-4222-8222-000000000001";
const MONITOR_ID: string = "33333333-3333-4333-8333-000000000001";
const OTHER_MONITOR_ID: string = "33333333-3333-4333-8333-000000000002";
const HOST_ID: string = "44444444-4444-4444-8444-000000000001";
const OTHER_HOST_ID: string = "44444444-4444-4444-8444-000000000002";
const DEGRADED_ID: string = "55555555-5555-4555-8555-000000000001";
const OFFLINE_ID: string = "55555555-5555-4555-8555-000000000002";
const SITE_ID: string = "66666666-6666-4666-8666-000000000001";
const TEMPLATE_ID: string = "77777777-7777-4777-8777-000000000001";
const CREATED_ID: string = "99999999-9999-4999-8999-000000000001";

const OPENED_AT: Date = new Date("2026-10-04T09:30:00.000Z");

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();

// The address the page is opened with.
let queryInUrl: Record<string, string> = {};

// What the server answers when the page looks a record up, by its ID.
let recordsOnServer: Record<string, unknown> = {};

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
        i18n: { language: "en" },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      count: async (): Promise<number> => {
        return 0;
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
      },
      create: (...args: Array<unknown>): unknown => {
        return createMock(...args);
      },
    },
  };
});

// The "Will notify" audience and the preview: not what this is about.
jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: async (): Promise<never> => {
        return new Promise<never>(() => {});
      },
      getFriendlyMessage: (err: unknown): string => {
        return err instanceof Error ? err.message : "Something went wrong";
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return true;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const ObjectIDClass: { new (id: string): unknown } = (
          jest.requireActual("../../../Types/ObjectID") as {
            default: { new (id: string): unknown };
          }
        ).default;
        return new ObjectIDClass("11111111-1111-4111-8111-111111111111");
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

import IncidentCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Create";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Host from "../../../Models/DatabaseModels/Host";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import Project from "../../../Models/DatabaseModels/Project";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";

interface ModelRequest {
  modelType: { new (): BaseModel };
  id?: ObjectID;
  select?: Record<string, unknown>;
  query?: Record<string, unknown>;
}

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
  if (modelType === IncidentSeverity) {
    return [named(IncidentSeverity, CRITICAL_ID, "Critical", { order: 1 })];
  }

  if (modelType === Monitor) {
    return [
      named(Monitor, MONITOR_ID, "Checkout API"),
      named(Monitor, OTHER_MONITOR_ID, "Payments API"),
    ];
  }

  if (modelType === Host) {
    return [
      named(Host, HOST_ID, "web-01"),
      named(Host, OTHER_HOST_ID, "web-02"),
    ];
  }

  if (modelType === MonitorStatus) {
    return [
      named(MonitorStatus, DEGRADED_ID, "Degraded", { priority: 2 }),
      named(MonitorStatus, OFFLINE_ID, "Offline", { priority: 3 }),
    ];
  }

  if (modelType === StatusPage) {
    return [named(StatusPage, SITE_ID, "Site 03")];
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
  const answer: unknown = recordsOnServer[request.id?.toString() || ""];

  if (answer instanceof Error) {
    throw answer;
  }

  return answer === undefined ? null : answer;
}

// The models the page's pickers and dropdowns asked the API to list.
function listedModels(): Array<unknown> {
  return getListMock.mock.calls.map((call: Array<unknown>): unknown => {
    return (call[0] as ModelRequest).modelType;
  });
}

async function renderPage(): Promise<UserEvent> {
  await act(async (): Promise<void> => {
    render(
      <MemoryRouter>
        <IncidentCreate
          pageRoute={new Route("/create")}
          currentProject={new Project()}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  });

  // The form, once whatever the page looked up is in.
  await screen.findByRole("navigation", { name: "Progress" });

  return userEvent.setup({ delay: null });
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

// Title and severity: all an incident cannot be declared without.
async function fillDetails(user: UserEvent): Promise<void> {
  await user.type(
    await screen.findByRole("textbox", { name: /^Title/ }),
    "Checkout is down",
  );
  await pickOption(
    user,
    screen.getByRole("combobox", { name: /^Incident Severity/ }),
    "Critical",
  );
}

async function openResourcesAffected(user: UserEvent): Promise<void> {
  await fillDetails(user);
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

// From the step on screen: walk to the review, and declare there.
async function declare(): Promise<Incident> {
  await walkToTheReview();

  fireEvent.click(screen.getByRole("button", { name: "Declare Incident" }));

  await waitFor(() => {
    expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
  });

  return (createOrUpdateMock.mock.calls[0]![0] as { model: Incident }).model;
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

// Every affected-resource relation an incident has, by the IDs it holds.
function resourcesOf(incident: Incident): Record<string, Array<string>> {
  return {
    monitors: idsOf(incident.monitors),
    hosts: idsOf(incident.hosts),
    kubernetesClusters: idsOf(incident.kubernetesClusters),
    dockerHosts: idsOf(incident.dockerHosts),
    podmanHosts: idsOf(incident.podmanHosts),
    proxmoxClusters: idsOf(incident.proxmoxClusters),
    vmwareVCenters: idsOf(incident.vmwareVCenters),
    cephClusters: idsOf(incident.cephClusters),
    dockerSwarmClusters: idsOf(incident.dockerSwarmClusters),
    iotFleets: idsOf(incident.iotFleets),
    databaseServers: idsOf(incident.databaseServers),
    services: idsOf(incident.services),
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
    dockerSwarmClusters: [],
    iotFleets: [],
    databaseServers: [],
    services: [],
  };
}

function monitorStatusOf(incident: Incident): string | undefined {
  return (
    incident.changeMonitorStatusTo?._id?.toString() ||
    incident.changeMonitorStatusToId?.toString()
  );
}

// A template the page is opened from: ?incidentTemplateId=.
function template(data: {
  monitors?: Array<Monitor>;
  hosts?: Array<Host>;
  changeMonitorStatusToId?: string;
}): void {
  const model: IncidentTemplate = new IncidentTemplate();
  model._id = TEMPLATE_ID;
  model.title = "Payments are failing";
  model.incidentSeverityId = new ObjectID(CRITICAL_ID);

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
  queryInUrl = { incidentTemplateId: TEMPLATE_ID };
}

beforeEach(() => {
  queryInUrl = {};
  recordsOnServer = {
    [MONITOR_ID]: named(Monitor, MONITOR_ID, "Checkout API"),
    [HOST_ID]: named(Host, HOST_ID, "web-01"),
  };

  getListMock.mockReset().mockImplementation(answerList as never);
  getItemMock.mockReset().mockImplementation(answerItem as never);
  createMock.mockReset().mockResolvedValue({ data: {} } as never);
  createOrUpdateMock.mockReset().mockImplementation(((data: {
    model: BaseModel;
  }): Promise<unknown> => {
    data.model._id = CREATED_ID;
    return Promise.resolve({ data: data.model });
  }) as never);

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(OPENED_AT);
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
});

describe("Resources Affected: the monitors apart, and the status they change to right under them", () => {
  test("asks for the monitors, then the other resources, each in a picker named by its own label", async () => {
    const user: UserEvent = await renderPage();

    await openResourcesAffected(user);

    const monitors: HTMLElement = monitorsPicker();
    const others: HTMLElement = otherResourcesPicker();

    expect(monitors).toHaveAttribute("placeholder", "Search monitors...");
    expect(others.getAttribute("placeholder")).toMatch(/^Search host, /);
    expect(isBefore(fieldOf(monitors), fieldOf(others))).toBe(true);
    expect(
      within(fieldOf(monitors)).getByText(
        "Search and attach the monitors affected by this incident. The status pages that list them show it.",
      ),
    ).toBeVisible();
    expect(
      within(fieldOf(others)).getByText(
        "Search and attach hosts, Kubernetes clusters, Docker hosts, databases, or services affected by this incident.",
      ),
    ).toBeVisible();

    // No monitor picked: nothing for a status to change.
    expect(monitorStatusLabel()).toBeNull();
    // ...and no field titled "Resources Affected" any more: that is the step.
    expect(
      within(fieldOf(monitors)).queryByText("Resources Affected"),
    ).toBeNull();
  });

  test("picking a monitor brings Change Monitor Status to, right under the monitors; removing the last one takes it away", async () => {
    const user: UserEvent = await renderPage();

    await openResourcesAffected(user);
    await pickResource(user, monitorsPicker(), "Checkout API");

    const status: HTMLElement = await screen.findByRole("combobox", {
      name: /^Change Monitor Status to/,
    });

    // Under the monitors it acts on, above everything else.
    expect(isBefore(fieldOf(monitorsPicker()), fieldOf(status))).toBe(true);
    expect(isBefore(fieldOf(status), fieldOf(otherResourcesPicker()))).toBe(
      true,
    );
    // Outside Advanced: on screen as soon as it is there.
    expect(status).toBeVisible();
    expect(screen.getByRole("button", { name: "Advanced" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    // It starts from nothing: no status is picked for the user.
    expect(status).toHaveValue("");

    await user.click(
      screen.getByRole("button", { name: "Remove Checkout API" }),
    );

    await waitFor(() => {
      expect(monitorStatusLabel()).toBeNull();
    });
  });

  test("a host picked among the other resources brings no monitor status", async () => {
    const user: UserEvent = await renderPage();

    await openResourcesAffected(user);
    await pickResource(user, otherResourcesPicker(), "web-01");

    expect(monitorStatusLabel()).toBeNull();
    // The host's chip is the other picker's, not the monitors'.
    expect(
      within(fieldOf(otherResourcesPicker())).getByRole("button", {
        name: "Remove web-01",
      }),
    ).toBeInTheDocument();
    expect(
      within(fieldOf(monitorsPicker())).queryByRole("button", {
        name: /^Remove /,
      }),
    ).toBeNull();
  });

  test("the Monitors picker lists monitors alone, and the other picker everything but monitors", async () => {
    const user: UserEvent = await renderPage();

    await openResourcesAffected(user);

    getListMock.mockClear();
    await user.click(monitorsPicker());
    await screen.findByRole("option", { name: "Checkout API" });

    expect(new Set(listedModels())).toEqual(new Set([Monitor]));

    // Closed again, and the other picker opened.
    await user.keyboard("{Escape}");
    getListMock.mockClear();
    await user.click(otherResourcesPicker());
    await screen.findByRole("option", { name: "web-01" });

    expect(listedModels()).toContain(Host);
    expect(listedModels()).not.toContain(Monitor);
    expect(screen.queryByRole("option", { name: "Checkout API" })).toBeNull();
  });

  test("Limit to these status pages and Notify Status Page Subscribers wait, folded, under Advanced at the end of the step", async () => {
    const user: UserEvent = await renderPage();

    await openResourcesAffected(user);

    const advanced: HTMLElement = screen.getByRole("button", {
      name: "Advanced",
    });

    expect(advanced).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Limit to these status pages")).not.toBeVisible();
    expect(
      screen.getByText("Notify Status Page Subscribers"),
    ).not.toBeVisible();
    // Last on the step.
    expect(isBefore(fieldOf(otherResourcesPicker()), advanced)).toBe(true);
    // Nothing set in it yet: it says nothing.
    expect(within(advanced).queryByText("Configured")).toBeNull();

    await user.click(advanced);

    expect(screen.getByText("Limit to these status pages")).toBeVisible();
    // Folding it changed no default: subscribers are still notified.
    expect(
      screen.getByRole("checkbox", { name: /Notify Status Page Subscribers/ }),
    ).toBeChecked();
  });
});

describe("what is declared", () => {
  /*
   * The values the one "Resources Affected" picker sent for the same picks:
   * the monitor in `monitors`, the host in `hosts`, the status, the status
   * page and the notify box each in their own column - nothing moved.
   */
  test("a monitor, a host, a status, a status page and notifying off: each stored where it always was", async () => {
    const user: UserEvent = await renderPage();

    await openResourcesAffected(user);
    await pickResource(user, monitorsPicker(), "Checkout API");
    await pickOption(
      user,
      await screen.findByRole("combobox", {
        name: /^Change Monitor Status to/,
      }),
      "Degraded",
    );
    await pickResource(user, otherResourcesPicker(), "web-01");

    await user.click(screen.getByRole("button", { name: "Advanced" }));
    await pickOption(
      user,
      screen.getByRole("combobox", { name: /^Limit to these status pages/ }),
      "Site 03",
    );
    await user.click(
      screen.getByRole("checkbox", { name: /Notify Status Page Subscribers/ }),
    );

    const incident: Incident = await declare();

    expect(incident.title).toBe("Checkout is down");
    expect(incident.incidentSeverity?._id?.toString()).toBe(CRITICAL_ID);
    expect(resourcesOf(incident)).toEqual({
      ...noResources(),
      monitors: [MONITOR_ID],
      hosts: [HOST_ID],
    });
    expect(monitorStatusOf(incident)).toBe(DEGRADED_ID);
    expect(idsOf(incident.statusPages)).toEqual([SITE_ID]);
    expect(
      incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
    ).toBe(false);
  });

  test("declared with nothing picked on the step: no resources, no status, and subscribers notified", async () => {
    const user: UserEvent = await renderPage();

    await openResourcesAffected(user);

    const incident: Incident = await declare();

    expect(resourcesOf(incident)).toEqual(noResources());
    expect(monitorStatusOf(incident)).toBeUndefined();
    expect(idsOf(incident.statusPages)).toEqual([]);
    expect(
      incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
    ).toBe(true);
  });

  test("each picker writes back only its own: a template's hosts stay when a monitor is picked, and its monitors when a host is", async () => {
    template({
      monitors: [named(Monitor, MONITOR_ID, "Checkout API")],
      hosts: [named(Host, HOST_ID, "web-01")],
    });

    const user: UserEvent = await renderPage();

    await screen.findByDisplayValue("Payments are failing");
    await goToNextStep("Resources Affected");

    await pickResource(user, monitorsPicker(), "Payments API");
    await pickResource(user, otherResourcesPicker(), "web-02");

    const incident: Incident = await declare();

    expect(resourcesOf(incident)).toEqual({
      ...noResources(),
      monitors: [MONITOR_ID, OTHER_MONITOR_ID],
      hosts: [HOST_ID, OTHER_HOST_ID],
    });
  });

  test("no monitor picked: no monitor status is sent, not even the one the template set", async () => {
    template({ changeMonitorStatusToId: DEGRADED_ID });

    await renderPage();

    await screen.findByDisplayValue("Payments are failing");
    await goToNextStep("Resources Affected");

    expect(monitorStatusLabel()).toBeNull();

    const incident: Incident = await declare();

    expect(monitorStatusOf(incident)).toBeUndefined();
    expect("changeMonitorStatusTo" in incident).toBe(false);
  });

  test("a template's status shows, already picked, once a monitor is picked, and is sent with it", async () => {
    template({ changeMonitorStatusToId: DEGRADED_ID });

    const user: UserEvent = await renderPage();

    await screen.findByDisplayValue("Payments are failing");
    await goToNextStep("Resources Affected");
    await pickResource(user, monitorsPicker(), "Checkout API");

    // A picked dropdown reads as a button with its value, named by its label.
    const status: HTMLElement = await screen.findByRole("button", {
      name: /^Change Monitor Status to/,
    });

    await waitFor(() => {
      expect(within(status).getByText("Degraded")).toBeVisible();
    });

    const incident: Incident = await declare();

    expect(idsOf(incident.monitors)).toEqual([MONITOR_ID]);
    expect(monitorStatusOf(incident)).toBe(DEGRADED_ID);
  });

  test("a status picked, then the last monitor removed: hidden, and not sent", async () => {
    const user: UserEvent = await renderPage();

    await openResourcesAffected(user);
    await pickResource(user, monitorsPicker(), "Checkout API");
    await pickOption(
      user,
      await screen.findByRole("combobox", {
        name: /^Change Monitor Status to/,
      }),
      "Offline",
    );

    await user.click(
      screen.getByRole("button", { name: "Remove Checkout API" }),
    );

    await waitFor(() => {
      expect(monitorStatusLabel()).toBeNull();
    });

    const incident: Incident = await declare();

    expect(idsOf(incident.monitors)).toEqual([]);
    expect(monitorStatusOf(incident)).toBeUndefined();
  });

  test("picked again, a monitor brings the status back as it was, and it is sent", async () => {
    const user: UserEvent = await renderPage();

    await openResourcesAffected(user);
    await pickResource(user, monitorsPicker(), "Checkout API");
    await pickOption(
      user,
      await screen.findByRole("combobox", {
        name: /^Change Monitor Status to/,
      }),
      "Offline",
    );

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
      expect(within(status).getByText("Offline")).toBeVisible();
    });

    const incident: Incident = await declare();

    expect(idsOf(incident.monitors)).toEqual([OTHER_MONITOR_ID]);
    expect(monitorStatusOf(incident)).toBe(OFFLINE_ID);
  });
});

describe("opened from a record's own tab", () => {
  test("from a monitor's Incidents tab: the monitor is among the monitors, and its status is asked at once", async () => {
    queryInUrl = { monitorId: MONITOR_ID };

    const user: UserEvent = await renderPage();

    await openResourcesAffected(user);

    expect(
      within(fieldOf(monitorsPicker())).getByRole("button", {
        name: "Remove Checkout API",
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("combobox", {
        name: /^Change Monitor Status to/,
      }),
    ).toBeVisible();

    const incident: Incident = await declare();

    expect(resourcesOf(incident)).toEqual({
      ...noResources(),
      monitors: [MONITOR_ID],
    });
  });

  test("from a host's Incidents tab: the host is among the other resources, and no status is asked", async () => {
    queryInUrl = { hostId: HOST_ID };

    const user: UserEvent = await renderPage();

    await openResourcesAffected(user);

    expect(
      within(fieldOf(otherResourcesPicker())).getByRole("button", {
        name: "Remove web-01",
      }),
    ).toBeInTheDocument();
    expect(monitorStatusLabel()).toBeNull();

    const incident: Incident = await declare();

    expect(resourcesOf(incident)).toEqual({
      ...noResources(),
      hosts: [HOST_ID],
    });
  });
});

describe("the review step", () => {
  // The review's section for the step: its heading and the rows under it.
  async function reviewOfResourcesAffected(): Promise<HTMLElement> {
    await walkToTheReview();

    return (await screen.findByRole("heading", { name: "Resources Affected" }))
      .parentElement as HTMLElement;
  }

  test("names the monitors and the other resources apart, and lists the notify box though it is folded and untouched", async () => {
    const user: UserEvent = await renderPage();

    await openResourcesAffected(user);
    await pickResource(user, otherResourcesPicker(), "web-01");

    const review: HTMLElement = await reviewOfResourcesAffected();

    expect(
      within(review).getByText("No monitors affected by this incident."),
    ).toBeInTheDocument();
    expect(await within(review).findByText("web-01")).toBeInTheDocument();
    // Whether subscribers are emailed is always confirmed here.
    expect(
      within(review).getByText("Notify Status Page Subscribers"),
    ).toBeInTheDocument();
    expect(
      within(review).getByTestId("incident-create-notify-subscribers-value"),
    ).toBeInTheDocument();
    // The folded option nobody touched is left off.
    expect(
      within(review).queryByText("Limit to these status pages"),
    ).toBeNull();
    // No monitor: no status to confirm.
    expect(within(review).queryByText("Change Monitor Status to")).toBeNull();
  });

  test("with a monitor, confirms the status it changes to - none picked included", async () => {
    const user: UserEvent = await renderPage();

    await openResourcesAffected(user);
    await pickResource(user, monitorsPicker(), "Checkout API");

    const review: HTMLElement = await reviewOfResourcesAffected();

    expect(await within(review).findByText("Checkout API")).toBeInTheDocument();
    expect(
      within(review).getByText("Change Monitor Status to"),
    ).toBeInTheDocument();
    expect(
      within(review).getByText(
        "Status of the monitors will not be changed when this incident is created.",
      ),
    ).toBeInTheDocument();
    expect(
      within(review).getByText("No other resources affected by this incident."),
    ).toBeInTheDocument();
  });
});

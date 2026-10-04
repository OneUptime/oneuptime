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
import {
  Location,
  MemoryRouter,
  Route as RouterRoute,
  Routes,
} from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Creating from a record's own tab keeps that record picked: Declare
 * Incident, Create Alert and Create Scheduled Maintenance Event, drawn for
 * real - the pages' own fields in the real ModelForm and BasicForm, inside
 * their real layouts for the breadcrumbs - with only the network, the
 * permissions and the address stubbed.
 *
 * "Please also find similar issues across the project and fix them as
 * well. The idea is to make software as simple as possible to use and
 * reduce decision paralysis." - the maintainer.
 *
 * From a monitor's Incidents tab, Declare Incident opened the project's form
 * with nothing picked; Create Alert on its Alerts tab did the same, and so
 * did every host's, cluster's and service's tab. Now:
 *
 *   - the record named in the address (?monitorId=, ?hostId=, ...) is looked
 *     up with the viewer's own permissions and picked where the form names
 *     it - Resources Affected, the alert's Monitor, the maintenance event's
 *     resources - first, ahead of a template's picks;
 *   - a record of a type the forms did not offer before (a Proxmox cluster,
 *     an IoT fleet) is offered and kept;
 *   - an address that names nothing real asks the server for nothing, and a
 *     record the viewer cannot read, or that is gone, leaves the form as the
 *     project's list opens it, without an error;
 *   - the breadcrumbs go back through the record's tab;
 *   - opened from a project's list, nothing is looked up and the page is as
 *     it always was.
 */

configure({ asyncUtilTimeout: 15000 });

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const CRITICAL_ID: string = "22222222-2222-4222-8222-000000000001";
const MONITOR_ID: string = "33333333-3333-4333-8333-000000000001";
const OTHER_MONITOR_ID: string = "33333333-3333-4333-8333-000000000002";
const HOST_ID: string = "44444444-4444-4444-8444-000000000001";
const OTHER_HOST_ID: string = "44444444-4444-4444-8444-000000000002";
const PROXMOX_ID: string = "55555555-5555-4555-8555-000000000001";
const IOT_FLEET_ID: string = "66666666-6666-4666-8666-000000000001";
const NETWORK_SITE_ID: string = "77777777-7777-4777-8777-000000000001";
const TEMPLATE_ID: string = "88888888-8888-4888-8888-000000000001";
const CREATED_ID: string = "99999999-9999-4999-8999-000000000001";

const OPENED_AT: Date = new Date("2026-10-04T09:30:00.000Z");

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();

// The address the page is opened with.
let queryInUrl: Record<string, string> = {};

/*
 * What the server answers when the page looks a record up, by its ID: the
 * record, an empty record (its answer for one that is gone or in another
 * project), or a refusal.
 */
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

// "Will notify" and the status page suggestions: not what this is about.
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
import IncidentsLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Layout";
import AlertCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Create";
import AlertsLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Layout";
import ScheduledMaintenanceCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Create";
import ScheduledMaintenancesLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Layout";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import LayoutPageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/LayoutPageComponentProps";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Host from "../../../Models/DatabaseModels/Host";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import IoTFleet from "../../../Models/DatabaseModels/IoTFleet";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import Project from "../../../Models/DatabaseModels/Project";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import Route from "../../../Types/API/Route";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";

interface ModelRequest {
  modelType: { new (): BaseModel };
  id?: ObjectID;
  select?: Record<string, unknown>;
  query?: Record<string, unknown>;
}

const INCIDENT_CREATE_PATH: string = `/dashboard/${PROJECT_ID}/incidents/create`;
const ALERT_CREATE_PATH: string = `/dashboard/${PROJECT_ID}/alerts/create`;
const MAINTENANCE_CREATE_PATH: string = `/dashboard/${PROJECT_ID}/scheduled-maintenance-events/create`;

function named<T extends BaseModel>(
  modelType: { new (): T },
  id: string,
  name: string,
): T {
  const model: T = new modelType();
  model._id = id;
  (model as unknown as Record<string, unknown>)["name"] = name;
  return model;
}

function listOf(data: Array<BaseModel>): unknown {
  return { data: data, count: data.length, skip: 0, limit: data.length };
}

function severity<T extends BaseModel>(modelType: { new (): T }): T {
  const model: T = named(modelType, CRITICAL_ID, "Critical");
  (model as unknown as Record<string, unknown>)["order"] = 1;
  return model;
}

async function answerList(request: ModelRequest): Promise<unknown> {
  if (request.modelType === IncidentSeverity) {
    return listOf([severity(IncidentSeverity)]);
  }

  if (request.modelType === AlertSeverity) {
    return listOf([severity(AlertSeverity)]);
  }

  // Create Alert's Monitor dropdown lists the project's monitors.
  if (request.modelType === Monitor) {
    return listOf([
      named(Monitor, MONITOR_ID, "Checkout API"),
      named(Monitor, OTHER_MONITOR_ID, "Payments API"),
    ]);
  }

  return listOf([]);
}

async function answerItem(request: ModelRequest): Promise<unknown> {
  const answer: unknown = recordsOnServer[request.id?.toString() || ""];

  if (answer instanceof Error) {
    throw answer;
  }

  return answer === undefined ? null : answer;
}

// The record lookups the page made, by the model they asked about.
function lookupsOf(modelType: { new (): BaseModel }): Array<ModelRequest> {
  return getItemMock.mock.calls
    .map((call: Array<unknown>): ModelRequest => {
      return call[0] as ModelRequest;
    })
    .filter((request: ModelRequest): boolean => {
      return request.modelType === modelType;
    });
}

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/create"),
  currentProject: new Project(),
  hasPaymentMethod: true,
};

async function renderPage(
  Page: React.FunctionComponent<PageComponentProps>,
): Promise<UserEvent> {
  await act(async (): Promise<void> => {
    render(
      <MemoryRouter>
        <Page {...PAGE_PROPS} />
      </MemoryRouter>,
    );
  });

  // The form, once whatever the page looked up is in.
  await screen.findByRole("navigation", { name: "Progress" });

  return userEvent.setup({ delay: null });
}

// The create page inside its product's layout, at its own address.
async function renderInLayout(data: {
  Layout: React.FunctionComponent<LayoutPageComponentProps>;
  Page: React.FunctionComponent<PageComponentProps>;
  path: string;
}): Promise<void> {
  window.history.replaceState(null, "", data.path);
  Navigation.setLocation({
    pathname: data.path,
    search: "",
    hash: "",
    state: null,
    key: "test",
  } as Location);

  await act(async (): Promise<void> => {
    render(
      <MemoryRouter initialEntries={[data.path]}>
        <Routes>
          <RouterRoute
            element={<data.Layout {...PAGE_PROPS} hideSideMenu={true} />}
          >
            <RouterRoute
              path={data.path}
              element={<data.Page {...PAGE_PROPS} />}
            />
          </RouterRoute>
        </Routes>
      </MemoryRouter>,
    );
  });

  await screen.findByRole("navigation", { name: "Progress" });
}

function breadcrumbs(): Array<{ title: string; href: string | null }> {
  return Array.from(
    screen
      .getByRole("navigation", { name: "Breadcrumb" })
      .querySelectorAll("li"),
  ).map((item: HTMLLIElement) => {
    return {
      title: (item.textContent || "").trim(),
      href: item.querySelector("a")?.getAttribute("href") || null,
    };
  });
}

function crumbTitles(): Array<string> {
  return breadcrumbs().map((link: { title: string }): string => {
    return link.title;
  });
}

// react-select opens on a click; its options are portalled to the body.
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

// Title and severity: all an incident or an alert cannot be made without.
async function fillDetails(
  user: UserEvent,
  severityLabel: RegExp,
): Promise<void> {
  await user.type(
    await screen.findByRole("textbox", { name: /^Title/ }),
    "Checkout is down",
  );
  await pickOption(
    user,
    screen.getByRole("combobox", { name: severityLabel }),
    "Critical",
  );
}

function sentModel<T extends BaseModel>(): T {
  expect(createOrUpdateMock).toHaveBeenCalledTimes(1);

  return (createOrUpdateMock.mock.calls[0]![0] as { model: T }).model;
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

async function submit(name: string): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: name }));

  await waitFor(() => {
    expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
  });
}

beforeEach(() => {
  queryInUrl = {};
  recordsOnServer = {
    [MONITOR_ID]: named(Monitor, MONITOR_ID, "Checkout API"),
    [HOST_ID]: named(Host, HOST_ID, "web-01"),
    [PROXMOX_ID]: named(ProxmoxCluster, PROXMOX_ID, "pve-east"),
    [IOT_FLEET_ID]: named(IoTFleet, IOT_FLEET_ID, "Thermostats"),
    [NETWORK_SITE_ID]: named(NetworkSite, NETWORK_SITE_ID, "Frankfurt DC"),
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
  window.history.replaceState(null, "", "/");
});

describe("Declare Incident, from a monitor's Incidents tab", () => {
  beforeEach(() => {
    queryInUrl = { monitorId: MONITOR_ID };
  });

  test("looks the monitor up, by its ID and for its name only", async () => {
    await renderPage(IncidentCreate);

    const lookups: Array<ModelRequest> = lookupsOf(Monitor);

    expect(lookups).toHaveLength(1);
    expect(lookups[0]!.id?.toString()).toBe(MONITOR_ID);
    expect(lookups[0]!.select).toEqual({ _id: true, name: true });
  });

  test("has the monitor picked on Resources Affected, by its name", async () => {
    const user: UserEvent = await renderPage(IncidentCreate);

    await fillDetails(user, /^Incident Severity/);
    await goToNextStep("Resources Affected");

    expect(
      screen.getByRole("button", { name: "Remove Checkout API" }),
    ).toBeInTheDocument();
  });

  test("declares the incident on the monitor from the first step", async () => {
    const user: UserEvent = await renderPage(IncidentCreate);

    await fillDetails(user, /^Incident Severity/);
    await submit("Declare Incident");

    expect(idsOf(sentModel<Incident>().monitors)).toEqual([MONITOR_ID]);
  });

  test("a template opened from the tab keeps the monitor first, then the template's, each once", async () => {
    queryInUrl = { monitorId: MONITOR_ID, incidentTemplateId: TEMPLATE_ID };

    const template: IncidentTemplate = new IncidentTemplate();
    template._id = TEMPLATE_ID;
    template.title = "Payments are failing";
    template.incidentSeverityId = new ObjectID(CRITICAL_ID);
    template.monitors = [
      named(Monitor, OTHER_MONITOR_ID, "Payments API"),
      named(Monitor, MONITOR_ID, "Checkout API"),
    ];
    recordsOnServer[TEMPLATE_ID] = template;

    await renderPage(IncidentCreate);
    await screen.findByDisplayValue("Payments are failing");

    await submit("Declare Incident");

    expect(idsOf(sentModel<Incident>().monitors)).toEqual([
      MONITOR_ID,
      OTHER_MONITOR_ID,
    ]);
  });

  test("a monitor the viewer cannot read leaves the form as the project's list opens it, without an error", async () => {
    recordsOnServer[MONITOR_ID] = new Error(
      "You do not have permission to read this monitor.",
    );

    const user: UserEvent = await renderPage(IncidentCreate);

    expect(
      screen.queryByText("You do not have permission to read this monitor."),
    ).toBeNull();

    await fillDetails(user, /^Incident Severity/);
    await submit("Declare Incident");

    expect(idsOf(sentModel<Incident>().monitors)).toEqual([]);
  });

  test("a monitor that is gone, or in another project, is not picked", async () => {
    // The API answers an empty record for a record it cannot find.
    recordsOnServer[MONITOR_ID] = new Monitor();

    const user: UserEvent = await renderPage(IncidentCreate);

    await fillDetails(user, /^Incident Severity/);
    await submit("Declare Incident");

    expect(idsOf(sentModel<Incident>().monitors)).toEqual([]);
  });

  test("an address that names no real monitor asks the server for nothing", async () => {
    queryInUrl = { monitorId: "not-a-monitor" };

    const user: UserEvent = await renderPage(IncidentCreate);

    expect(getItemMock).not.toHaveBeenCalled();

    await fillDetails(user, /^Incident Severity/);
    await submit("Declare Incident");

    expect(idsOf(sentModel<Incident>().monitors)).toEqual([]);
  });

  test("lands on the new incident, as from the project's list", async () => {
    const user: UserEvent = await renderPage(IncidentCreate);

    await fillDetails(user, /^Incident Severity/);
    await submit("Declare Incident");

    await waitFor(() => {
      expect(Navigation.navigate).toHaveBeenCalled();
    });
    expect(
      (
        (Navigation.navigate as unknown as MockFunction).mock
          .calls[0]![0] as Route
      ).toString(),
    ).toBe(`/dashboard/${PROJECT_ID}/incidents/${CREATED_ID}`);
  });
});

describe("Declare Incident, from other resources' Incidents tabs", () => {
  test("a host is picked among the resources", async () => {
    queryInUrl = { hostId: HOST_ID };

    const user: UserEvent = await renderPage(IncidentCreate);

    await fillDetails(user, /^Incident Severity/);
    await goToNextStep("Resources Affected");

    expect(
      screen.getByRole("button", { name: "Remove web-01" }),
    ).toBeInTheDocument();

    await submit("Declare Incident");

    const incident: Incident = sentModel<Incident>();

    expect(idsOf(incident.hosts)).toEqual([HOST_ID]);
    expect(idsOf(incident.monitors)).toEqual([]);
  });

  test("a Proxmox cluster - a type the form did not offer before - is picked and kept", async () => {
    queryInUrl = { proxmoxClusterId: PROXMOX_ID };

    const user: UserEvent = await renderPage(IncidentCreate);

    await fillDetails(user, /^Incident Severity/);
    await goToNextStep("Resources Affected");

    expect(
      screen.getByRole("button", { name: "Remove pve-east" }),
    ).toBeInTheDocument();

    await submit("Declare Incident");

    expect(idsOf(sentModel<Incident>().proxmoxClusters)).toEqual([PROXMOX_ID]);
  });

  test("a network site is not something an incident names: nothing is looked up", async () => {
    queryInUrl = { networkSiteId: NETWORK_SITE_ID };

    await renderPage(IncidentCreate);

    expect(lookupsOf(NetworkSite)).toHaveLength(0);
  });
});

describe("Declare Incident, from the project's list", () => {
  test("looks nothing up, and opens as it always did", async () => {
    const user: UserEvent = await renderPage(IncidentCreate);

    expect(getItemMock).not.toHaveBeenCalled();

    await fillDetails(user, /^Incident Severity/);
    await goToNextStep("Resources Affected");

    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
  });
});

describe("Create Alert", () => {
  test("from a monitor's Alerts tab: the alert is raised on that monitor", async () => {
    queryInUrl = { monitorId: MONITOR_ID };

    const user: UserEvent = await renderPage(AlertCreate);

    await fillDetails(user, /^Alert Severity/);
    await goToNextStep("Resources & On-Call");

    // The Monitor dropdown shows the monitor picked, ready to be cleared.
    const monitorField: HTMLElement = screen.getByRole("button", {
      name: "Monitor (Optional)",
    });
    expect(within(monitorField).getByText("Checkout API")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Clear selection" }),
    ).toBeInTheDocument();

    await submit("Create Alert");

    expect(sentModel<Alert>().monitor?._id?.toString()).toBe(MONITOR_ID);
  });

  test("from a host's Alerts tab: the host is among Other Affected Resources", async () => {
    queryInUrl = { hostId: HOST_ID };

    const user: UserEvent = await renderPage(AlertCreate);

    await fillDetails(user, /^Alert Severity/);
    await goToNextStep("Resources & On-Call");

    expect(
      screen.getByRole("button", { name: "Remove web-01" }),
    ).toBeInTheDocument();

    await submit("Create Alert");

    const alert: Alert = sentModel<Alert>();

    expect(idsOf(alert.hosts)).toEqual([HOST_ID]);
    expect(alert.monitor).toBeUndefined();
  });

  test("from an IoT fleet's Alerts tab: a type the form did not offer before is kept", async () => {
    queryInUrl = { iotFleetId: IOT_FLEET_ID };

    const user: UserEvent = await renderPage(AlertCreate);

    await fillDetails(user, /^Alert Severity/);
    await submit("Create Alert");

    expect(idsOf(sentModel<Alert>().iotFleets)).toEqual([IOT_FLEET_ID]);
  });

  test("a monitor the viewer cannot read is not picked, and nothing is said", async () => {
    queryInUrl = { monitorId: MONITOR_ID };
    recordsOnServer[MONITOR_ID] = new Error("Permission denied.");

    const user: UserEvent = await renderPage(AlertCreate);

    expect(screen.queryByText("Permission denied.")).toBeNull();

    await fillDetails(user, /^Alert Severity/);
    await submit("Create Alert");

    expect(sentModel<Alert>().monitor).toBeUndefined();
  });

  test("from the project's list: nothing is looked up, and the form opens at once", async () => {
    const user: UserEvent = await renderPage(AlertCreate);

    expect(getItemMock).not.toHaveBeenCalled();

    await fillDetails(user, /^Alert Severity/);
    await submit("Create Alert");

    expect(sentModel<Alert>().monitor).toBeUndefined();
  });
});

describe("Create Scheduled Maintenance Event", () => {
  async function writeEvent(): Promise<void> {
    fireEvent.change(await screen.findByRole("textbox", { name: /^Title/ }), {
      target: { value: "Rack migration" },
    });
    await act(async () => {});
  }

  test("from a host's Scheduled Maintenance tab: the host is picked", async () => {
    queryInUrl = { hostId: HOST_ID };

    await renderPage(ScheduledMaintenanceCreate);
    await writeEvent();
    await goToNextStep("Resources Affected");

    expect(
      screen.getByRole("button", { name: "Remove web-01" }),
    ).toBeInTheDocument();

    await submit("Create Scheduled Maintenance Event");

    expect(idsOf(sentModel<ScheduledMaintenance>().hosts)).toEqual([HOST_ID]);
  });

  test("from a network site's Scheduled Maintenance tab: the site is picked", async () => {
    queryInUrl = { networkSiteId: NETWORK_SITE_ID };

    await renderPage(ScheduledMaintenanceCreate);
    await writeEvent();
    await submit("Create Scheduled Maintenance Event");

    expect(idsOf(sentModel<ScheduledMaintenance>().networkSites)).toEqual([
      NETWORK_SITE_ID,
    ]);
  });

  test("from a template opened on a host's tab: the host first, then the template's hosts", async () => {
    queryInUrl = {
      hostId: HOST_ID,
      scheduledMaintenanceTemplateId: TEMPLATE_ID,
    };

    const template: ScheduledMaintenanceTemplate =
      new ScheduledMaintenanceTemplate();
    template._id = TEMPLATE_ID;
    template.title = "Weekly patching";
    template.hosts = [named(Host, OTHER_HOST_ID, "web-02")];
    recordsOnServer[TEMPLATE_ID] = template;

    await renderPage(ScheduledMaintenanceCreate);
    await screen.findByDisplayValue("Weekly patching");

    await submit("Create Scheduled Maintenance Event");

    expect(idsOf(sentModel<ScheduledMaintenance>().hosts)).toEqual([
      HOST_ID,
      OTHER_HOST_ID,
    ]);
  });

  test("a monitor has no Scheduled Maintenance tab: its address picks nothing here", async () => {
    queryInUrl = { monitorId: MONITOR_ID };

    await renderPage(ScheduledMaintenanceCreate);
    await writeEvent();
    await submit("Create Scheduled Maintenance Event");

    expect(lookupsOf(Monitor)).toHaveLength(0);
    expect(idsOf(sentModel<ScheduledMaintenance>().monitors)).toEqual([]);
  });
});

describe("the breadcrumbs go back through the record's tab", () => {
  test("Declare Incident from a monitor: Project > Monitors > View Monitor > Incidents", async () => {
    queryInUrl = { monitorId: MONITOR_ID };

    await renderInLayout({
      Layout: IncidentsLayout,
      Page: IncidentCreate,
      path: INCIDENT_CREATE_PATH,
    });

    await waitFor(() => {
      expect(crumbTitles()).toEqual([
        "Project",
        "Monitors",
        "View Monitor",
        "Incidents",
        "Declare New Incident",
      ]);
    });

    const links: Array<{ title: string; href: string | null }> = breadcrumbs();

    expect(links[1]!.href).toBe(`/dashboard/${PROJECT_ID}/monitors`);
    expect(links[2]!.href).toBe(
      `/dashboard/${PROJECT_ID}/monitors/${MONITOR_ID}`,
    );
    expect(links[3]!.href).toBe(
      `/dashboard/${PROJECT_ID}/monitors/${MONITOR_ID}/incidents`,
    );
    // The page itself, drawn as text: the address keeps what it was opened with.
    expect(links[4]!.href).toBeNull();
  });

  test("Declare Incident from the project's list keeps the layout's own trail", async () => {
    await renderInLayout({
      Layout: IncidentsLayout,
      Page: IncidentCreate,
      path: INCIDENT_CREATE_PATH,
    });

    expect(crumbTitles()).toEqual([
      "Project",
      "Incidents",
      "Declare New Incident",
    ]);
  });

  test("a record that cannot be read keeps the layout's own trail", async () => {
    queryInUrl = { monitorId: MONITOR_ID };
    recordsOnServer[MONITOR_ID] = new Error("Permission denied.");

    await renderInLayout({
      Layout: IncidentsLayout,
      Page: IncidentCreate,
      path: INCIDENT_CREATE_PATH,
    });

    expect(crumbTitles()).toEqual([
      "Project",
      "Incidents",
      "Declare New Incident",
    ]);
  });

  test("Create Alert from a host: Project > Hosts > View Host > Alerts", async () => {
    queryInUrl = { hostId: HOST_ID };

    await renderInLayout({
      Layout: AlertsLayout,
      Page: AlertCreate,
      path: ALERT_CREATE_PATH,
    });

    await waitFor(() => {
      expect(crumbTitles()).toEqual([
        "Project",
        "Hosts",
        "View Host",
        "Alerts",
        "Create Alert",
      ]);
    });
    expect(breadcrumbs()[3]!.href).toBe(
      `/dashboard/${PROJECT_ID}/host/${HOST_ID}/alerts`,
    );
  });

  test("Create Scheduled Maintenance Event from a network site: Project > Network > View Site > Scheduled Maintenance", async () => {
    queryInUrl = { networkSiteId: NETWORK_SITE_ID };

    await renderInLayout({
      Layout: ScheduledMaintenancesLayout,
      Page: ScheduledMaintenanceCreate,
      path: MAINTENANCE_CREATE_PATH,
    });

    await waitFor(() => {
      expect(crumbTitles()).toEqual([
        "Project",
        "Network",
        "View Site",
        "Scheduled Maintenance",
        "New Scheduled Maintenance Event",
      ]);
    });
    expect(breadcrumbs()[2]!.href).toBe(
      `/dashboard/${PROJECT_ID}/network-sites/view/${NETWORK_SITE_ID}`,
    );
    expect(breadcrumbs()[3]!.href).toBe(
      `/dashboard/${PROJECT_ID}/network-sites/view/${NETWORK_SITE_ID}/scheduled-maintenance`,
    );
  });
});

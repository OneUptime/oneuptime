/**
 * @timezone UTC
 */
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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE MONITORS OF A SERVICE, ON ITS PAGE (#10296).
 *
 * A host's Windows service page and its systemd unit page, rendered for
 * real against a fake server, show under the service's status:
 *
 *   - the monitors that already watch it, each a link to its page with its
 *     status - or "No monitor watches this service yet.";
 *   - Create Monitor, which opens Monitor Create carrying the host and the
 *     service, and says "Create Another Monitor" while a monitor watches it,
 *     still opening Monitor Create;
 *   - for a reader who may not create monitors, Create Monitor locked with
 *     why, and nothing for one who may neither read nor create them;
 *   - why the list could not be read, with Try again.
 */

const HOST_ID: string = "84858d6c-1111-4aaa-8bbb-000000000001";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const MONITOR_ID: string = "5a5a5a5a-1111-4aaa-8bbb-000000000001";

const getItemMock: MockFunction = getJestMockFunction();
const modelListMock: MockFunction = getJestMockFunction();
const analyticsListMock: MockFunction = getJestMockFunction();
const lastParamMock: MockFunction = getJestMockFunction();
const navigateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return modelListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return analyticsListMock(...args);
      },
      aggregate: (): unknown => {
        return Promise.resolve({ data: [] });
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown): string => {
        return String((error as Error)?.message || error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("84858d6c-1111-4aaa-8bbb-000000000001");
      },
      getLastParamAsString: (): unknown => {
        return lastParamMock();
      },
      navigate: (...args: Array<unknown>): void => {
        navigateMock(...args);
      },
      getQueryStringByName: (): null => {
        return null;
      },
      getCurrentRoute: (): unknown => {
        const { default: RouteType } = jest.requireActual(
          "../../../Types/API/Route",
        ) as { default: new (route: string) => unknown };
        return new RouteType("/dashboard");
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

import HostServiceView from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/ServiceView";
import HostSystemdUnitView from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/SystemdUnitView";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Host from "../../../Models/DatabaseModels/Host";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Metric from "../../../Models/AnalyticsModels/Metric";
import Includes from "../../../Types/BaseDatabase/Includes";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import { buildHostMonitorConfig } from "../../../Types/Monitor/HostAlertTemplates";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { MetricMonitorQueryLanguage } from "../../../Types/Monitor/MonitorStepMetricMonitor";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import { UNEXPLAINED_ERROR_MESSAGES } from "../../../Types/Exception/UnexplainedError";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import { getJestSpyOn } from "../../Spy";

// The Host pages read their ids from the route, not from these props.
const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

type Row = Record<string, unknown>;

interface ListRequest {
  modelType: unknown;
  query: Record<string, unknown>;
  select?: Record<string, unknown>;
}

// What the reader may do with monitors, per test.
let gates: Partial<Record<ModelAction, PermissionGateResult>> = {};

let monitorRows: Array<Monitor> = [];
let monitorListFailure: Error | null = null;

function host(): Host {
  const row: Host = new Host();
  row.id = new ObjectID(HOST_ID);
  row.name = "Web 01";
  row.hostIdentifier = "web-01";
  return row;
}

// The page's metric read: the service Running in every sample.
function windowsServiceRows(): Array<Row> {
  return [
    {
      time: new Date("2026-11-20T11:59:30.000Z"),
      value: 4,
      attributes: { name: "Spooler", startup_mode: "auto_start" },
    },
    {
      time: new Date("2026-11-20T11:59:00.000Z"),
      value: 4,
      attributes: { name: "Spooler", startup_mode: "auto_start" },
    },
  ];
}

function systemdUnitRows(): Array<Row> {
  return [
    {
      time: new Date("2026-11-20T11:59:30.000Z"),
      value: 1,
      attributes: {
        "resource.systemd.unit.name": "nginx.service",
        "systemd.unit.active_state": "active",
      },
    },
  ];
}

function hostStepFor(data: {
  resourceId: string;
  metricName: string;
  attributes: Record<string, string>;
  groupByAttributeKeys?: Array<string>;
}): MonitorStep {
  const steps: MonitorSteps = new MonitorSteps();
  const step: MonitorStep = steps.data!.monitorStepsInstanceArray[0]!;

  step.setHostMonitor({
    ...buildHostMonitorConfig({
      hostIdentifier: "web-01",
      metricName: data.metricName,
      metricAlias: "a",
      rollingTime: RollingTime.Past5Minutes,
      aggregationType: MetricsAggregationType.Max,
      attributes: data.attributes,
      groupByAttributeKeys: data.groupByAttributeKeys,
    }),
    resourceId: data.resourceId,
  });

  return step;
}

function monitorWith(data: {
  id: string;
  name: string;
  step: MonitorStep;
  status?: { name: string; color: string };
  isDisabled?: boolean;
}): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = data.id;
  monitor.name = data.name;
  monitor.monitorType = MonitorType.Host;

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data!.monitorStepsInstanceArray = [data.step];
  monitor.monitorSteps = monitorSteps;

  if (data.status) {
    monitor.currentMonitorStatus = data.status as never;
  }

  monitor.disableActiveMonitoring = Boolean(data.isDisabled);

  return monitor;
}

const SPOOLER_MONITOR: Monitor = monitorWith({
  id: MONITOR_ID,
  name: "Spooler on Web 01",
  step: hostStepFor({
    resourceId: HOST_ID,
    metricName: "windows.service.status",
    attributes: { name: "Spooler" },
  }),
  status: { name: "Operational", color: "#22c55e" },
});

// A Metrics monitor written in PromQL (#10452), the project's every metric its scope.
function promQLMonitorWith(data: {
  id: string;
  name: string;
  promQLQuery: string;
}): Monitor {
  const steps: MonitorSteps = new MonitorSteps();
  const step: MonitorStep = steps.data!.monitorStepsInstanceArray[0]!;

  step.setMetricMonitor({
    queryLanguage: MetricMonitorQueryLanguage.PromQL,
    promQLQuery: data.promQLQuery,
    metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
    rollingTime: RollingTime.Past5Minutes,
  });

  const monitor: Monitor = monitorWith({
    id: data.id,
    name: data.name,
    step: step,
    status: { name: "Operational", color: "#22c55e" },
  });

  monitor.monitorType = MonitorType.Metrics;

  return monitor;
}

// Another service's monitor on the same host: not this service's.
const W3SVC_MONITOR: Monitor = monitorWith({
  id: "5a5a5a5a-1111-4aaa-8bbb-000000000002",
  name: "W3SVC on Web 01",
  step: hostStepFor({
    resourceId: HOST_ID,
    metricName: "windows.service.status",
    attributes: { name: "W3SVC" },
  }),
  status: { name: "Operational", color: "#22c55e" },
});

function renderServicePage(): void {
  render(
    <MemoryRouter>
      <HostServiceView {...PAGE_PROPS} />
    </MemoryRouter>,
  );
}

function renderUnitPage(): void {
  render(
    <MemoryRouter>
      <HostSystemdUnitView {...PAGE_PROPS} />
    </MemoryRouter>,
  );
}

async function card(): Promise<HTMLElement> {
  return await screen.findByTestId("host-service-monitors");
}

function createButton(): HTMLElement {
  return screen.getByTestId("host-service-monitors-create");
}

// Where a press of Create Monitor went.
function navigatedTo(): { path: string; params: URLSearchParams } {
  expect(navigateMock).toHaveBeenCalledTimes(1);

  const route: string = String(navigateMock.mock.calls[0]![0]);

  return {
    path: route.substring(0, route.indexOf("?")),
    params: new URLSearchParams(route.substring(route.indexOf("?") + 1)),
  };
}

beforeEach(() => {
  gates = {
    [ModelAction.Read]: { isAllowed: true },
    [ModelAction.Create]: { isAllowed: true },
  };
  monitorRows = [];
  monitorListFailure = null;

  getItemMock.mockReset().mockImplementation((request: unknown) => {
    if ((request as { modelType: unknown }).modelType === Host) {
      return Promise.resolve(host());
    }

    return Promise.resolve(null);
  });

  modelListMock.mockReset().mockImplementation((request: unknown) => {
    if ((request as ListRequest).modelType === Monitor) {
      if (monitorListFailure) {
        return Promise.reject(monitorListFailure);
      }

      return Promise.resolve({
        data: monitorRows,
        count: monitorRows.length,
        skip: 0,
        limit: monitorRows.length,
      });
    }

    return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
  });

  analyticsListMock.mockReset().mockImplementation((request: unknown) => {
    const list: ListRequest = request as ListRequest;

    if (list.modelType !== Metric) {
      return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
    }

    const rows: Array<Row> =
      list.query["name"] === "windows.service.status"
        ? windowsServiceRows()
        : systemdUnitRows();

    return Promise.resolve({
      data: rows,
      count: rows.length,
      skip: 0,
      limit: rows.length,
    });
  });

  lastParamMock.mockReset().mockReturnValue("Spooler");
  navigateMock.mockReset();

  getJestSpyOn(PermissionGate, "check").mockImplementation(
    (_model: unknown, action: unknown): PermissionGateResult => {
      return gates[action as ModelAction] || { isAllowed: false };
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a Windows service's page, with no monitor watching the service", () => {
  test("says so under the service's status, and offers Create Monitor", async () => {
    renderServicePage();

    const monitors: HTMLElement = await card();

    expect(within(monitors).getByText("Monitors")).toBeInTheDocument();
    expect(
      within(monitors).getByText(
        "Monitors that watch this service and open an incident when it stops running.",
      ),
    ).toBeInTheDocument();
    expect(
      await within(monitors).findByText("No monitor watches this service yet."),
    ).toBeInTheDocument();
    expect(createButton()).toHaveTextContent("Create Monitor");
    expect(createButton()).not.toHaveTextContent("Another");
    expect(createButton()).toBeEnabled();

    // Under the tiles that say how the service is, before its timeline.
    const tileTitle: HTMLElement = screen.getByText("Current Status");
    expect(
      tileTitle.compareDocumentPosition(monitors) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("Create Monitor opens Monitor Create carrying this host and this service", async () => {
    renderServicePage();
    await card();
    await screen.findByText("No monitor watches this service yet.");

    fireEvent.click(createButton());

    const target: { path: string; params: URLSearchParams } = navigatedTo();

    expect(target.path).toBe(`/dashboard/${PROJECT_ID}/monitors/create`);
    expect(target.params.get("hostId")).toBe(HOST_ID);
    expect(target.params.get("windowsService")).toBe("Spooler");
    expect(target.params.get("systemdUnit")).toBeNull();
  });

  test("reads the project's Host and Metrics monitors that are not archived, with their steps", async () => {
    renderServicePage();
    await screen.findByText("No monitor watches this service yet.");

    const request: ListRequest = modelListMock.mock.calls
      .map((call: Array<unknown>): ListRequest => {
        return call[0] as ListRequest;
      })
      .find((list: ListRequest): boolean => {
        return list.modelType === Monitor;
      })!;

    expect(request.query["isArchived"]).toBe(false);
    expect((request.query["monitorType"] as Includes).values).toEqual([
      MonitorType.Host,
      MonitorType.Metrics,
    ]);
    expect(request.select).toEqual(
      expect.objectContaining({ monitorSteps: true, name: true }),
    );
  });

  test("a name with characters an address escapes is the service's own", async () => {
    lastParamMock.mockReturnValue(encodeURIComponent("MSSQL$SQL EXPRESS"));

    renderServicePage();
    await screen.findByText("No monitor watches this service yet.");

    fireEvent.click(createButton());

    expect(navigatedTo().params.get("windowsService")).toBe(
      "MSSQL$SQL EXPRESS",
    );
  });
});

describe("a Windows service's page, with a monitor watching the service", () => {
  test("lists it, a link to its page with its status, and not another service's monitor", async () => {
    monitorRows = [SPOOLER_MONITOR, W3SVC_MONITOR];

    renderServicePage();

    const monitors: HTMLElement = await card();
    const link: HTMLElement = await within(monitors).findByRole("link", {
      name: "Spooler on Web 01",
    });

    expect(link).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/monitors/${MONITOR_ID}`,
    );
    expect(
      within(monitors).getAllByTestId("host-service-monitors-item"),
    ).toHaveLength(1);
    expect(within(monitors).getByText("Operational")).toBeInTheDocument();
    expect(within(monitors).queryByText("W3SVC on Web 01")).toBeNull();
    expect(
      within(monitors).queryByText("No monitor watches this service yet."),
    ).toBeNull();
  });

  test("Create Monitor says there is one, and still opens Monitor Create for another", async () => {
    monitorRows = [SPOOLER_MONITOR];

    renderServicePage();
    await screen.findByRole("link", { name: "Spooler on Web 01" });

    expect(createButton()).toHaveTextContent("Create Another Monitor");
    expect(createButton()).toBeEnabled();

    fireEvent.click(createButton());

    expect(navigatedTo().params.get("windowsService")).toBe("Spooler");
  });

  test("a monitor someone switched off reads Disabled, not its last status", async () => {
    monitorRows = [
      monitorWith({
        id: MONITOR_ID,
        name: "Spooler (paused)",
        step: hostStepFor({
          resourceId: HOST_ID,
          metricName: "windows.service.status",
          attributes: { name: "Spooler" },
        }),
        status: { name: "Offline", color: "#ef4444" },
        isDisabled: true,
      }),
    ];

    renderServicePage();

    const monitors: HTMLElement = await card();
    await within(monitors).findByRole("link", { name: "Spooler (paused)" });

    expect(within(monitors).getByText("Disabled")).toBeInTheDocument();
    expect(within(monitors).queryByText("Offline")).toBeNull();
  });
});

/*
 * #10452: a Metrics monitor written in PromQL is read by its expression. The
 * card lists one whose expression reads this service on this host, leaves
 * out one it should not claim, and lists one it cannot be sure of with what
 * it could not check - without saying "Create Another Monitor" for it.
 */
describe("a Windows service's page, with monitors written in PromQL", () => {
  const PROMQL_ID: string = "5a5a5a5a-1111-4aaa-8bbb-0000000000a1";
  const DOUBTFUL_ID: string = "5a5a5a5a-1111-4aaa-8bbb-0000000000a2";

  const SPOOLER_IN_PROMQL: Monitor = promQLMonitorWith({
    id: PROMQL_ID,
    name: "Spooler down (PromQL)",
    promQLQuery:
      'windows_service_status{name="Spooler", resource_host_name="web-01"} != 4',
  });

  test("lists one whose expression reads this service on this host, and Create Monitor says there is one", async () => {
    monitorRows = [SPOOLER_IN_PROMQL];

    renderServicePage();

    const monitors: HTMLElement = await card();
    const link: HTMLElement = await within(monitors).findByRole("link", {
      name: "Spooler down (PromQL)",
    });

    expect(link).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/monitors/${PROMQL_ID}`,
    );
    expect(
      within(monitors).queryByTestId("host-service-monitors-doubt"),
    ).toBeNull();
    expect(createButton()).toHaveTextContent("Create Another Monitor");
  });

  test("leaves out the ones it should not claim: another service, another host, another metric, an expression that does not parse", async () => {
    monitorRows = [
      promQLMonitorWith({
        id: "5a5a5a5a-1111-4aaa-8bbb-0000000000b1",
        name: "W3SVC down (PromQL)",
        promQLQuery: 'windows_service_status{name="W3SVC"} != 4',
      }),
      promQLMonitorWith({
        id: "5a5a5a5a-1111-4aaa-8bbb-0000000000b2",
        name: "Spooler on web-02 (PromQL)",
        promQLQuery:
          'windows_service_status{name="Spooler", resource_host_name="web-02"} != 4',
      }),
      promQLMonitorWith({
        id: "5a5a5a5a-1111-4aaa-8bbb-0000000000b3",
        name: "Busy CPU (PromQL)",
        promQLQuery:
          'system_cpu_utilization{resource_host_name="web-01"} > 0.9',
      }),
      promQLMonitorWith({
        id: "5a5a5a5a-1111-4aaa-8bbb-0000000000b4",
        name: "Half written (PromQL)",
        promQLQuery: 'windows_service_status{name="Spooler"',
      }),
    ];

    renderServicePage();

    const monitors: HTMLElement = await card();

    expect(
      await within(monitors).findByText("No monitor watches this service yet."),
    ).toBeInTheDocument();
    expect(
      within(monitors).queryAllByTestId("host-service-monitors-item"),
    ).toEqual([]);
    expect(createButton()).toHaveTextContent("Create Monitor");
    expect(createButton()).not.toHaveTextContent("Another");
  });

  test("lists one it cannot be sure of, says which labels it could not check, and Create Monitor stays Create Monitor", async () => {
    monitorRows = [
      promQLMonitorWith({
        id: DOUBTFUL_ID,
        name: "Auto-start services down",
        promQLQuery:
          'windows_service_status{startup_mode="auto_start", job="windows"} != 4',
      }),
    ];

    renderServicePage();

    const monitors: HTMLElement = await card();

    await within(monitors).findByRole("link", {
      name: "Auto-start services down",
    });

    expect(
      within(monitors).getByTestId("host-service-monitors-doubt"),
    ).toHaveTextContent(
      "May not watch this service: its PromQL expression also filters by startup_mode, job, which this page can't check.",
    );
    expect(createButton()).toHaveTextContent("Create Monitor");
    expect(createButton()).not.toHaveTextContent("Another");
  });

  test("an expression that may leave the service out says so", async () => {
    monitorRows = [
      promQLMonitorWith({
        id: DOUBTFUL_ID,
        name: "Services down, Spooler aside",
        promQLQuery:
          'windows_service_status != 4 unless windows_service_status{name=~"Spool.*"}',
      }),
    ];

    renderServicePage();

    const monitors: HTMLElement = await card();

    await within(monitors).findByRole("link", {
      name: "Services down, Spooler aside",
    });

    expect(
      within(monitors).getByTestId("host-service-monitors-doubt"),
    ).toHaveTextContent(
      "May not watch this service: its PromQL expression can leave some of the series it reads out, which this page can't check.",
    );
  });

  test("beside a monitor it is sure of, one it is not says so alone, and Create Monitor says there is one", async () => {
    monitorRows = [
      promQLMonitorWith({
        id: DOUBTFUL_ID,
        name: "Auto-start services down",
        promQLQuery: 'windows_service_status{startup_mode="auto_start"} != 4',
      }),
      SPOOLER_MONITOR,
    ];

    renderServicePage();

    const monitors: HTMLElement = await card();

    await within(monitors).findByRole("link", { name: "Spooler on Web 01" });

    const items: Array<HTMLElement> = within(monitors).getAllByTestId(
      "host-service-monitors-item",
    );

    expect(items).toHaveLength(2);
    expect(
      within(items[0]!).getByTestId("host-service-monitors-doubt"),
    ).toBeInTheDocument();
    expect(
      within(items[1]!).queryByTestId("host-service-monitors-doubt"),
    ).toBeNull();
    expect(createButton()).toHaveTextContent("Create Another Monitor");
  });

  test("on a systemd unit's page, the PromQL alert of every failed unit is listed, and the unit's own words say a doubt", async () => {
    lastParamMock.mockReturnValue("nginx.service");
    monitorRows = [
      promQLMonitorWith({
        id: PROMQL_ID,
        name: "Failed units (PromQL)",
        promQLQuery:
          'systemd_unit_state{systemd_unit_active_state="failed"} == 1',
      }),
      promQLMonitorWith({
        id: DOUBTFUL_ID,
        name: "Units of a job",
        promQLQuery: 'systemd_unit_state{job="systemd"} == 0',
      }),
    ];

    renderUnitPage();

    const monitors: HTMLElement = await card();

    await within(monitors).findByRole("link", {
      name: "Failed units (PromQL)",
    });

    expect(
      within(monitors).getByTestId("host-service-monitors-doubt"),
    ).toHaveTextContent(
      "May not watch this unit: its PromQL expression also filters by job, which this page can't check.",
    );
    expect(createButton()).toHaveTextContent("Create Another Monitor");
  });
});

describe("who may do what", () => {
  test("a reader who may not create monitors sees Create Monitor locked, with why", async () => {
    gates[ModelAction.Create] = {
      isAllowed: false,
      disabledReason: "You do not have permission to create this Monitor.",
    };

    renderServicePage();
    await screen.findByText("No monitor watches this service yet.");

    expect(createButton()).toBeDisabled();

    fireEvent.click(createButton());
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test("while what the reader may do is not known yet, Create Monitor is left out rather than locked", async () => {
    gates[ModelAction.Create] = { isAllowed: false };

    renderServicePage();
    await screen.findByText("No monitor watches this service yet.");

    expect(screen.queryByTestId("host-service-monitors-create")).toBeNull();
  });

  test("a reader who may neither read nor create monitors gets no card, and no monitor is read", async () => {
    gates = {};

    renderServicePage();
    await screen.findByText("Current Status");

    expect(screen.queryByTestId("host-service-monitors")).toBeNull();
    expect(
      modelListMock.mock.calls.some((call: Array<unknown>): boolean => {
        return (call[0] as ListRequest).modelType === Monitor;
      }),
    ).toBe(false);
  });

  test("a reader who may create but not read monitors still gets Create Monitor", async () => {
    gates[ModelAction.Read] = { isAllowed: false };

    renderServicePage();

    await card();
    expect(createButton()).toBeEnabled();
    expect(
      screen.queryByText("No monitor watches this service yet."),
    ).toBeNull();
  });
});

describe("when the monitors cannot be read", () => {
  test("a failure nobody explained says what failed first, and Try again reads them again", async () => {
    monitorListFailure = new Error(UNEXPLAINED_ERROR_MESSAGES.server);

    renderServicePage();

    const monitors: HTMLElement = await card();

    await waitFor(() => {
      expect(monitors).toHaveTextContent(
        "Couldn't read the monitors that watch this service.",
      );
    });
    // Create Monitor still works: the list is a help, not a gate.
    expect(createButton()).toBeEnabled();

    monitorListFailure = null;
    monitorRows = [SPOOLER_MONITOR];

    fireEvent.click(within(monitors).getByTestId("refresh-button"));

    expect(
      await within(monitors).findByRole("link", { name: "Spooler on Web 01" }),
    ).toBeInTheDocument();
  });

  test("a refusal the server explained is said as it said it, in the card", async () => {
    monitorListFailure = new Error("The project's monitors are being moved.");

    renderServicePage();

    const monitors: HTMLElement = await card();

    expect(
      await within(monitors).findByText(
        "The project's monitors are being moved.",
      ),
    ).toBeInTheDocument();
    expect(within(monitors).getByTestId("refresh-button")).toBeInTheDocument();
  });

  test("on a systemd unit's page, it names the unit's monitors", async () => {
    lastParamMock.mockReturnValue("nginx.service");
    monitorListFailure = new Error(UNEXPLAINED_ERROR_MESSAGES.server);

    renderUnitPage();

    const monitors: HTMLElement = await card();

    await waitFor(() => {
      expect(monitors).toHaveTextContent(
        "Couldn't read the monitors that watch this unit.",
      );
    });
  });
});

describe("a systemd unit's page", () => {
  beforeEach(() => {
    lastParamMock.mockReturnValue("nginx.service");
  });

  test("says no monitor watches the unit yet, and Create Monitor opens Monitor Create for this unit", async () => {
    renderUnitPage();

    const monitors: HTMLElement = await card();

    expect(
      within(monitors).getByText(
        "Monitors that watch this unit and open an incident when it stops being active.",
      ),
    ).toBeInTheDocument();
    expect(
      await within(monitors).findByText("No monitor watches this unit yet."),
    ).toBeInTheDocument();

    fireEvent.click(createButton());

    const target: { path: string; params: URLSearchParams } = navigatedTo();

    expect(target.path).toBe(`/dashboard/${PROJECT_ID}/monitors/create`);
    expect(target.params.get("hostId")).toBe(HOST_ID);
    expect(target.params.get("systemdUnit")).toBe("nginx.service");
    expect(target.params.get("windowsService")).toBeNull();
  });

  test("lists the host's alert that watches every unit, and Create Monitor says there is one", async () => {
    monitorRows = [
      monitorWith({
        id: MONITOR_ID,
        name: "web-01 - Systemd Unit Failed",
        step: hostStepFor({
          resourceId: HOST_ID,
          metricName: "systemd.unit.state",
          attributes: { "systemd.unit.active_state": "failed" },
          groupByAttributeKeys: ["resource.systemd.unit.name"],
        }),
        status: { name: "Operational", color: "#22c55e" },
      }),
    ];

    renderUnitPage();

    expect(
      await screen.findByRole("link", { name: "web-01 - Systemd Unit Failed" }),
    ).toBeInTheDocument();
    expect(createButton()).toHaveTextContent("Create Another Monitor");
  });
});

describe("the card waits for the host", () => {
  test("a host that cannot be found draws no card", async () => {
    getItemMock.mockImplementation(() => {
      return Promise.resolve(null);
    });

    renderServicePage();

    await waitFor(() => {
      expect(screen.getByText("Host not found.")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("host-service-monitors")).toBeNull();
  });
});

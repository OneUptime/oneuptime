import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
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
  screen,
  waitFor,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { getJestSpyOn } from "../../Spy";

/*
 * MONITOR CREATE, OPENED FROM A SERVICE ON A HOST (#10296).
 *
 * Create Monitor on a host's Windows service page or systemd unit page
 * links to Monitor Create with the host's id and the service's name. The
 * page reads the host - its host name is what its metrics carry, its name
 * what the monitor is called - and the project's statuses and severities,
 * and opens the form on the monitor HostServiceMonitorPrefill builds; or
 * says why it cannot, in place of the form.
 *
 * Driven with ModelForm mocked to capture what it is handed, as
 * MonitorCreateFromAIInsight.test.tsx does. One test goes the whole way:
 * the service's page is drawn, its Create Monitor pressed, and Monitor
 * Create opened at the address it went to.
 */

type CapturedFormProps = {
  initialValues: Record<string, unknown>;
};

let capturedForm: CapturedFormProps | null = null;

jest.mock("../../../UI/Components/Forms/ModelForm", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Components/Forms/ModelForm",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    default: (props: CapturedFormProps): React.ReactElement => {
      capturedForm = props;
      return <div data-testid="model-form" />;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorSteps",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div data-testid="monitor-steps" />;
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: (): Promise<Array<unknown>> => {
        return Promise.resolve([]);
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

const HOST_ID: string = "84858d6c-1111-4aaa-8bbb-000000000001";
const ONLINE_STATUS_ID: string = "44444444-4444-4444-8444-444444444444";
const OFFLINE_STATUS_ID: string = "55555555-5555-4555-8555-555555555555";
const CRITICAL_INCIDENT_ID: string = "66666666-6666-4666-8666-666666666661";
const MAJOR_INCIDENT_ID: string = "66666666-6666-4666-8666-666666666662";
const HIGH_ALERT_ID: string = "77777777-7777-4777-8777-777777777771";

let hostRow: () => Promise<unknown> = (): Promise<unknown> => {
  return Promise.resolve(null);
};
let statusListFailure: Error | null = null;
let monitorStatusRows: Array<unknown> = [];
let incidentSeverityRows: Array<unknown> = [];
let alertSeverityRows: Array<unknown> = [];
let hostRequests: Array<{
  id?: { toString: () => string } | undefined;
  select?: Record<string, boolean> | undefined;
}> = [];

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (request: {
        modelType: unknown;
        id?: { toString: () => string } | undefined;
        select?: Record<string, boolean> | undefined;
      }): Promise<unknown> => {
        if (request.modelType === Host) {
          hostRequests.push(request);
          return hostRow();
        }

        if (request.modelType === Project) {
          return Promise.resolve({
            doNotAddGlobalProbesByDefaultOnNewMonitors: false,
          });
        }

        return Promise.resolve(null);
      },
      getList: (request: { modelType: unknown }): Promise<unknown> => {
        let rows: Array<unknown> = [];

        if (
          request.modelType === MonitorStatus ||
          request.modelType === IncidentSeverity ||
          request.modelType === AlertSeverity
        ) {
          if (statusListFailure) {
            return Promise.reject(statusListFailure);
          }

          rows =
            request.modelType === MonitorStatus
              ? monitorStatusRows
              : request.modelType === IncidentSeverity
                ? incidentSeverityRows
                : alertSeverityRows;
        }

        return Promise.resolve({
          data: rows,
          count: rows.length,
          skip: 0,
          limit: rows.length,
        });
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (): Promise<unknown> => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
      aggregate: (): Promise<unknown> => {
        return Promise.resolve({ data: [] });
      },
    },
  };
});

import MonitorCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Create";
import HostServiceView from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/ServiceView";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  HOST_SERVICE_MONITOR_HOST_GONE_ERROR,
  HOST_SERVICE_MONITOR_LINK_ERROR,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/HostServiceMonitorPrefill";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import Host from "../../../Models/DatabaseModels/Host";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import { FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import UiAnalytics from "../../../UI/Utils/Analytics";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { standInForGlobalConfig } from "../../Helpers/GlobalConfigStandIn";

const PROJECT_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-000000000001",
);

function withId<T extends { id: ObjectID | null }>(row: T, id: string): T {
  row.id = new ObjectID(id);
  return row;
}

function monitorStatus(data: {
  id: string;
  isOperationalState: boolean;
  isOfflineState: boolean;
}): MonitorStatus {
  const status: MonitorStatus = withId(new MonitorStatus(), data.id);
  status.isOperationalState = data.isOperationalState;
  status.isOfflineState = data.isOfflineState;
  return status;
}

function aHost(): Host {
  const host: Host = withId(new Host(), HOST_ID);
  host.name = "Web 01";
  host.hostIdentifier = "web-01";
  return host;
}

function linkTo(params: Record<string, string>): void {
  getJestSpyOn(Navigation, "getQueryStringByName").mockImplementation(
    (paramName: string): string | null => {
      return params[paramName] ?? null;
    },
  );
}

// Monitor Create, at an address: what it reads of it.
function linkToRoute(route: string): void {
  const search: URLSearchParams = new URLSearchParams(
    route.substring(route.indexOf("?") + 1),
  );

  getJestSpyOn(Navigation, "getQueryStringByName").mockImplementation(
    (paramName: string): string | null => {
      return search.get(paramName) || null;
    },
  );
  getJestSpyOn(Navigation, "getQueryString").mockImplementation((): string => {
    return route.substring(route.indexOf("?"));
  });
}

function renderCreatePage(): void {
  const project: Project = new Project();
  project.id = PROJECT_ID;

  render(
    <MemoryRouter>
      <MonitorCreate
        pageRoute={new Route("/dashboard/monitors/create")}
        currentProject={project}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );
}

async function openForm(): Promise<CapturedFormProps> {
  renderCreatePage();

  await waitFor(() => {
    expect(capturedForm).not.toBeNull();
  });

  return capturedForm!;
}

function stepOf(form: CapturedFormProps): MonitorStep {
  return MonitorSteps.fromJSON(form.initialValues["monitorSteps"] as JSONObject)
    .data!.monitorStepsInstanceArray[0]!;
}

function criteriaOf(form: CapturedFormProps): Array<MonitorCriteriaInstance> {
  return stepOf(form).data!.monitorCriteria.data!.monitorCriteriaInstanceArray;
}

beforeEach((): void => {
  // The server's global config, answered here rather than over the network.
  standInForGlobalConfig();

  capturedForm = null;
  hostRequests = [];
  statusListFailure = null;
  hostRow = (): Promise<unknown> => {
    return Promise.resolve(aHost());
  };

  monitorStatusRows = [
    monitorStatus({
      id: ONLINE_STATUS_ID,
      isOperationalState: true,
      isOfflineState: false,
    }),
    monitorStatus({
      id: OFFLINE_STATUS_ID,
      isOperationalState: false,
      isOfflineState: true,
    }),
  ];
  incidentSeverityRows = [
    withId(new IncidentSeverity(), CRITICAL_INCIDENT_ID),
    withId(new IncidentSeverity(), MAJOR_INCIDENT_ID),
  ];
  alertSeverityRows = [withId(new AlertSeverity(), HIGH_ALERT_ID)];

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  getJestSpyOn(Navigation, "navigate").mockImplementation((): void => {});
  getJestSpyOn(UiAnalytics, "captureRevenueEvent").mockImplementation(
    (): void => {},
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Monitor Create, opened from a Windows service's page", () => {
  test("reads the host by the id in the link: its name and its host name", async () => {
    linkTo({ hostId: HOST_ID, windowsService: "Spooler" });

    await openForm();

    expect(hostRequests).toHaveLength(1);
    expect(hostRequests[0]!.id?.toString()).toBe(HOST_ID);
    expect(hostRequests[0]!.select).toEqual({
      name: true,
      hostIdentifier: true,
    });
  });

  test("opens on a Host monitor of the host that watches the service, named after both", async () => {
    linkTo({ hostId: HOST_ID, windowsService: "Spooler" });

    const form: CapturedFormProps = await openForm();

    expect(form.initialValues["monitorType"]).toBe(MonitorType.Host);
    expect(form.initialValues["name"]).toBe("Spooler on Web 01");
    expect(form.initialValues["description"]).toBe(
      "Opens an incident when the Windows service Spooler on Web 01 is not running, or when its status stops arriving.",
    );

    const step: MonitorStep = stepOf(form);

    expect(step.data!.hostMonitor!.hostIdentifier).toBe("web-01");
    expect(step.data!.hostMonitor!.resourceId).toBe(HOST_ID);
    expect(
      step.data!.hostMonitor!.metricViewConfig.queryConfigs[0]!.metricQueryData
        .filterData,
    ).toEqual(
      expect.objectContaining({
        metricName: "windows.service.status",
        attributes: { name: "Spooler" },
      }),
    );
  });

  test("its criteria are built with the project's own statuses and its most severe severity", async () => {
    linkTo({ hostId: HOST_ID, windowsService: "Spooler" });

    const form: CapturedFormProps = await openForm();
    const criteria: Array<MonitorCriteriaInstance> = criteriaOf(form);

    expect(
      criteria.map((instance: MonitorCriteriaInstance) => {
        return instance.data!.name;
      }),
    ).toEqual([
      "Spooler is running on Web 01",
      "Spooler is not running on Web 01",
      "Spooler stopped reporting on Web 01",
    ]);
    expect(criteria[0]!.data!.monitorStatusId?.toString()).toBe(
      ONLINE_STATUS_ID,
    );
    expect(criteria[1]!.data!.monitorStatusId?.toString()).toBe(
      OFFLINE_STATUS_ID,
    );
    expect(criteria[1]!.data!.createIncidents).toBe(true);
    expect(
      criteria[1]!.data!.incidents[0]!.incidentSeverityId?.toString(),
    ).toBe(CRITICAL_INCIDENT_ID);
    expect(
      MonitorSteps.fromJSON(
        form.initialValues["monitorSteps"] as JSONObject,
      ).data!.defaultMonitorStatusId?.toString(),
    ).toBe(ONLINE_STATUS_ID);
  });

  test("statuses and severities that cannot be read leave those parts to the form", async () => {
    statusListFailure = new Error("The server did not answer.");
    linkTo({ hostId: HOST_ID, windowsService: "Spooler" });

    const form: CapturedFormProps = await openForm();

    expect(form.initialValues["name"]).toBe("Spooler on Web 01");

    for (const instance of criteriaOf(form)) {
      expect(instance.data!.monitorStatusId).toBeUndefined();
      expect(instance.data!.incidents).toEqual([]);
    }
  });

  test("a link that is not a service on a host says so, in place of the form", async () => {
    linkTo({ hostId: "not-an-id", windowsService: "Spooler" });

    renderCreatePage();

    expect(
      await screen.findByText(HOST_SERVICE_MONITOR_LINK_ERROR),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("model-form")).toBeNull();
    expect(hostRequests).toHaveLength(0);
  });

  test("a host that no longer exists says so, in place of the form", async () => {
    hostRow = (): Promise<unknown> => {
      return Promise.resolve(null);
    };
    linkTo({ hostId: HOST_ID, windowsService: "Spooler" });

    renderCreatePage();

    expect(
      await screen.findByText(HOST_SERVICE_MONITOR_HOST_GONE_ERROR),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("model-form")).toBeNull();
  });

  test("a host that cannot be read says why, in place of the form", async () => {
    hostRow = (): Promise<unknown> => {
      return Promise.reject(new Error("You may not read this host."));
    };
    linkTo({ hostId: HOST_ID, windowsService: "Spooler" });

    renderCreatePage();

    expect(
      await screen.findByText("You may not read this host."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("model-form")).toBeNull();
  });
});

describe("Monitor Create, opened from a systemd unit's page", () => {
  test("opens on a Host monitor of the unit's active state", async () => {
    linkTo({ hostId: HOST_ID, systemdUnit: "nginx.service" });

    const form: CapturedFormProps = await openForm();

    expect(form.initialValues["monitorType"]).toBe(MonitorType.Host);
    expect(form.initialValues["name"]).toBe("nginx.service on Web 01");
    expect(
      stepOf(form).data!.hostMonitor!.metricViewConfig.queryConfigs[0]!
        .metricQueryData.filterData,
    ).toEqual(
      expect.objectContaining({
        metricName: "systemd.unit.state",
        attributes: {
          "resource.systemd.unit.name": "nginx.service",
          "systemd.unit.active_state": "active",
        },
      }),
    );
    expect(criteriaOf(form)[1]!.data!.filters[0]!.filterType).toBe(
      FilterType.LessThan,
    );
  });
});

describe("from the service's page to the form", () => {
  const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

  test("Create Monitor on the page opens Monitor Create filled in for that service on that host", async () => {
    getJestSpyOn(Navigation, "getLastParamAsObjectID").mockImplementation(
      (): ObjectID => {
        return new ObjectID(HOST_ID);
      },
    );
    getJestSpyOn(Navigation, "getLastParamAsString").mockImplementation(
      (): string => {
        return encodeURIComponent("Print Spooler");
      },
    );
    getJestSpyOn(PermissionGate, "check").mockImplementation(
      (): PermissionGateResult => {
        return { isAllowed: true };
      },
    );

    const navigate: jest.SpyInstance<any, any> = getJestSpyOn(
      Navigation,
      "navigate",
    ).mockImplementation((): void => {});

    render(
      <MemoryRouter>
        <HostServiceView {...PAGE_PROPS} />
      </MemoryRouter>,
    );

    await screen.findByText("No monitor watches this service yet.");
    fireEvent.click(screen.getByTestId("host-service-monitors-create"));

    expect(navigate).toHaveBeenCalledTimes(1);

    const route: string = String(navigate.mock.calls[0]![0]);

    cleanup();
    linkToRoute(route);

    const form: CapturedFormProps = await openForm();

    expect(form.initialValues["monitorType"]).toBe(MonitorType.Host);
    expect(form.initialValues["name"]).toBe("Print Spooler on Web 01");
    expect(stepOf(form).data!.hostMonitor!.resourceId).toBe(HOST_ID);
    expect(
      stepOf(form).data!.hostMonitor!.metricViewConfig.queryConfigs[0]!
        .metricQueryData.filterData,
    ).toEqual(
      expect.objectContaining({ attributes: { name: "Print Spooler" } }),
    );
    expect(criteriaOf(form)).toHaveLength(3);
  });
});

/*
 * Last in the file: it switches the language, and puts English back after.
 */
describe("in the reader's language", () => {
  beforeAll(async () => {
    await i18next.use(initReactI18next).init({
      lng: "en",
      fallbackLng: "en",
      resources: {
        de: { translation: readDashboardLocale("de") },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  afterAll(async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("en");
    });
  });

  test("the monitor and its criteria are named in the language of the person creating it", async () => {
    linkTo({ hostId: HOST_ID, windowsService: "Spooler" });

    await act(async (): Promise<void> => {
      await i18next.changeLanguage("de");
    });

    const form: CapturedFormProps = await openForm();

    expect(form.initialValues["name"]).toBe("Spooler auf Web 01");
    expect(
      criteriaOf(form).map((instance: MonitorCriteriaInstance) => {
        return instance.data!.name;
      }),
    ).toEqual([
      "Spooler auf Web 01 läuft",
      "Spooler auf Web 01 läuft nicht",
      "Spooler auf Web 01 meldet nichts mehr",
    ]);
  });
});

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * The "Create Ping Monitor" button on a monitor-backed device's page opens
 * the monitor create page with `?networkDeviceId=<id>`. What that page
 * opens WITH, and what it does with the monitor once saved, is the whole
 * change (OneUptime/oneuptime#3447): before, the link seeded a Network
 * Device monitor — the SNMP shape, which neither pings the address nor binds
 * to the device — and the save landed on the monitor, leaving the device on
 * "Pending" with the binding still to be done by hand.
 *
 * MonitorCreateNetworkDeviceDeepLink.test.ts (App/Tests) pins the source.
 * This drives the real page: the real deep-link read, the real seed-id
 * resolver, the real Ping builder, the real bind helper — with ModelForm
 * mocked to capture the props it is handed, the same approach as
 * AddNeighborToMonitoringModal.test.tsx. The captured onSuccess is then
 * invoked the way ModelForm would invoke it, un-awaited, so the bind and its
 * failure path run exactly as they do in the browser.
 */

type CapturedFormProps = {
  initialValues: Record<string, unknown>;
  onSuccess?: ((createdItem: unknown) => void) | undefined;
};

/** The two criteria switches the Ping builder sets deliberately. */
type CriteriaFlags = {
  createIncidents?: boolean | undefined;
  changeMonitorStatus?: boolean | undefined;
};

let capturedForm: CapturedFormProps | null = null;

jest.mock("../../../UI/Components/Forms/ModelForm", () => {
  /*
   * Everything but the component is real: Create.tsx imports FormType from
   * here, and PayAsYouGo imports the ModelField type.
   */
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

const DEVICE_ID: string = "22222222-2222-4222-8222-222222222222";
const MONITOR_ID: string = "33333333-3333-4333-8333-333333333333";
const ONLINE_STATUS_ID: string = "44444444-4444-4444-8444-444444444444";
const OFFLINE_STATUS_ID: string = "55555555-5555-4555-8555-555555555555";
const INCIDENT_SEVERITY_ID: string = "66666666-6666-4666-8666-666666666666";
const ALERT_SEVERITY_ID: string = "77777777-7777-4777-8777-777777777777";
// The probe assigned to the device — the one that can reach it.
const DEVICE_PROBE_ID: string = "88888888-8888-4888-8888-888888888888";
// A global probe flagged "auto enable on new monitors": the project default.
const GLOBAL_PROBE_ID: string = "99999999-9999-4999-8999-999999999999";

/*
 * The step editor is only rendered through ModelForm's getCustomElement,
 * which the mock above never calls — and its import graph is most of the
 * dashboard. A stub keeps the suite to the page under test.
 */
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

/** The device's probe, and a global one flagged "auto enable": the default. */
const BRANCH_PROBE_ROW: Record<string, unknown> = {
  _id: DEVICE_PROBE_ID,
  name: "Branch probe",
  isGlobalProbe: false,
  shouldAutoEnableProbeOnNewMonitors: false,
};
const GLOBAL_PROBE_ROW: Record<string, unknown> = {
  _id: GLOBAL_PROBE_ID,
  name: "Global probe",
  isGlobalProbe: true,
  shouldAutoEnableProbeOnNewMonitors: true,
};

/*
 * What the probe list request returns, swapped per test: the two probes by
 * default, a list without the device's probe, or a rejection for the page's
 * "probe list could not be loaded" path.
 */
let probeListResult: () => Promise<
  Array<Record<string, unknown>>
> = (): Promise<Array<Record<string, unknown>>> => {
  return Promise.resolve([BRANCH_PROBE_ROW, GLOBAL_PROBE_ROW]);
};

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: (): Promise<Array<Record<string, unknown>>> => {
        return probeListResult();
      },
    },
  };
});

/*
 * What the page reads and writes through ModelAPI, dispatched on the model
 * so one mock serves the device read, the probe-default project read, the
 * three seed-id lists, and the bind. Every request is recorded so the tests
 * can assert what was asked for, not only what came back.
 */
let deviceRow: NetworkDevice | null = null;
let monitorStatusRows: Array<MonitorStatus> = [];
let incidentSeverityRows: Array<IncidentSeverity> = [];
let alertSeverityRows: Array<AlertSeverity> = [];
let getItemRequests: Array<{
  modelType: unknown;
  select?: Record<string, boolean> | undefined;
}> = [];
let updateRequests: Array<{
  modelType: unknown;
  id: ObjectID;
  data: Record<string, unknown>;
}> = [];
let deleteRequests: Array<unknown> = [];
let bindResult: () => Promise<void> = (): Promise<void> => {
  return Promise.resolve();
};

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (request: {
        modelType: unknown;
        select?: Record<string, boolean> | undefined;
      }): Promise<unknown> => {
        getItemRequests.push(request);

        if (request.modelType === NetworkDevice) {
          return Promise.resolve(deviceRow);
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

        if (request.modelType === MonitorStatus) {
          rows = monitorStatusRows;
        } else if (request.modelType === IncidentSeverity) {
          rows = incidentSeverityRows;
        } else if (request.modelType === AlertSeverity) {
          rows = alertSeverityRows;
        }

        return Promise.resolve({
          data: rows,
          count: rows.length,
          skip: 0,
          limit: rows.length,
        });
      },
      updateById: (request: {
        modelType: unknown;
        id: ObjectID;
        data: Record<string, unknown>;
      }): Promise<void> => {
        updateRequests.push(request);
        return bindResult();
      },
      deleteItem: (request: unknown): Promise<void> => {
        deleteRequests.push(request);
        return Promise.resolve();
      },
    },
  };
});

import MonitorCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Create";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import UiAnalytics from "../../../UI/Utils/Analytics";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  PING_MONITOR_INTERVAL,
  PingMonitorOrigin,
  buildPingMonitorDescription,
} from "../../../Utils/NetworkDiscovery/PingMonitorBuilder";

/*
 * Below the imports on purpose: the jest.mock factories above are hoisted,
 * which leaves the imports evaluated AFTER any module-level constant that
 * precedes them, and constructing an ObjectID up there runs before the
 * class has been required.
 */
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

function monitorStatus(data: {
  id: string;
  isOperationalState: boolean;
  isOfflineState: boolean;
}): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status.id = new ObjectID(data.id);
  status.isOperationalState = data.isOperationalState;
  status.isOfflineState = data.isOfflineState;
  return status;
}

function incidentSeverity(id: string): IncidentSeverity {
  const severity: IncidentSeverity = new IncidentSeverity();
  severity.id = new ObjectID(id);
  return severity;
}

function alertSeverity(id: string): AlertSeverity {
  const severity: AlertSeverity = new AlertSeverity();
  severity.id = new ObjectID(id);
  return severity;
}

function networkDevice(data: {
  monitoringMethod: string;
  probeId: string | null;
}): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice();
  device.id = new ObjectID(DEVICE_ID);
  device.name = "Lobby AP";
  device.hostname = "10.0.12.41";
  device.monitoringMethod = data.monitoringMethod;
  if (data.probeId) {
    device.probeId = new ObjectID(data.probeId);
  }
  return device;
}

const navigateMock: MockFunction = getJestMockFunction();

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

/** What ModelForm hands onSuccess after a successful create. */
function createdMonitor(): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.id = new ObjectID(MONITOR_ID);
  monitor.monitorType = MonitorType.Ping;
  return monitor;
}

function navigatedTo(): string {
  expect(navigateMock).toHaveBeenCalledTimes(1);

  const destination: { toString: () => string } = navigateMock.mock
    .calls[0]![0] as { toString: () => string };

  return destination.toString();
}

describe("the monitor create page opened from a network device", () => {
  beforeEach(() => {
    capturedForm = null;
    getItemRequests = [];
    updateRequests = [];
    deleteRequests = [];
    navigateMock.mockReset();
    bindResult = (): Promise<void> => {
      return Promise.resolve();
    };
    probeListResult = (): Promise<Array<Record<string, unknown>>> => {
      return Promise.resolve([BRANCH_PROBE_ROW, GLOBAL_PROBE_ROW]);
    };

    deviceRow = networkDevice({
      monitoringMethod: "Monitor",
      probeId: DEVICE_PROBE_ID,
    });
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
    incidentSeverityRows = [incidentSeverity(INCIDENT_SEVERITY_ID)];
    alertSeverityRows = [alertSeverity(ALERT_SEVERITY_ID)];

    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    jest
      .spyOn(Navigation, "getQueryStringByName")
      .mockImplementation((paramName: string): string | null => {
        return paramName === "networkDeviceId" ? DEVICE_ID : null;
      });
    getJestSpyOn(Navigation, "navigate").mockImplementation(
      (...args: Array<unknown>): void => {
        navigateMock(...args);
      },
    );
    // Off the network: the revenue event is not what is under test.
    getJestSpyOn(UiAnalytics, "captureRevenueEvent").mockImplementation(
      (): void => {},
    );
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe("a monitor-backed device", () => {
    test("opens on a Ping monitor for the device's address, not the SNMP shape", async () => {
      const form: CapturedFormProps = await openForm();

      expect(form.initialValues["monitorType"]).toBe(MonitorType.Ping);
      expect(form.initialValues["name"]).toBe("Ping Lobby AP");
      expect(form.initialValues["description"]).toBe(
        buildPingMonitorDescription({
          address: "10.0.12.41",
          origin: PingMonitorOrigin.DevicePage,
        }),
      );
      expect(form.initialValues["monitoringInterval"]).toBe(
        PING_MONITOR_INTERVAL,
      );
    });

    test("the step pings the device's address, on the project's statuses, without opening incidents", async () => {
      const form: CapturedFormProps = await openForm();

      const steps: MonitorSteps = MonitorSteps.fromJSON(
        form.initialValues["monitorSteps"] as JSONObject,
      );
      const step: MonitorStep | undefined =
        steps.data?.monitorStepsInstanceArray[0];

      expect(step?.data?.monitorDestination?.toString()).toBe("10.0.12.41");
      expect(steps.data?.defaultMonitorStatusId?.toString()).toBe(
        ONLINE_STATUS_ID,
      );

      /*
       * The device page is one of the bulk-ish surfaces: an operator
       * recording an access point wants its status, not a page for every
       * missed ping. changeMonitorStatus stays on — that is what moves the
       * device's pill.
       */
      const criteria: Array<CriteriaFlags> = (
        step?.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || []
      ).map((instance: MonitorCriteriaInstance): CriteriaFlags => {
        return {
          createIncidents: instance.data?.createIncidents,
          changeMonitorStatus: instance.data?.changeMonitorStatus,
        };
      });

      expect(criteria.length).toBeGreaterThan(0);
      for (const instance of criteria) {
        expect(instance.createIncidents).toBe(false);
      }
      expect(
        criteria.some((instance: CriteriaFlags): boolean => {
          return instance.changeMonitorStatus === true;
        }),
      ).toBe(true);
    });

    test("reads the method, address and probe in the one device request", async () => {
      await openForm();

      const deviceRead: { select?: Record<string, boolean> | undefined } =
        getItemRequests.find((request: { modelType: unknown }) => {
          return request.modelType === NetworkDevice;
        })!;

      expect(deviceRead).toBeDefined();
      expect(deviceRead.select).toEqual({
        name: true,
        hostname: true,
        monitoringMethod: true,
        probeId: true,
      });
    });

    test("pins the device's own probe over the project's default", async () => {
      /*
       * The default here is a GLOBAL probe, which lives on the public
       * internet and cannot reach 10.0.12.41. Attaching it would fail every
       * check and drive the device to Offline — a worse dead end than
       * Pending, because it looks like an outage.
       */
      const form: CapturedFormProps = await openForm();

      expect(form.initialValues["probes"]).toEqual([DEVICE_PROBE_ID]);
    });

    test("falls back to the project's default probes when the device has none", async () => {
      deviceRow = networkDevice({ monitoringMethod: "Monitor", probeId: null });

      const form: CapturedFormProps = await openForm();

      expect(form.initialValues["probes"]).toEqual([GLOBAL_PROBE_ID]);
    });

    test("submits no probe selection when the probe list cannot be loaded", async () => {
      /*
       * The device's probe is known, but the picker has no options to show
       * it in. Seeding it anyway would have BasicForm filter it against the
       * (empty) options and submit probes: [] — which the server honours as
       * "attach no probes", leaving a monitor nothing evaluates bound to the
       * device, reading Up forever. No "probes" key at all is what makes the
       * server fall back to the project defaults, as it did before the pin.
       */
      probeListResult = (): Promise<Array<Record<string, unknown>>> => {
        return Promise.reject(new Error("Service Unavailable"));
      };

      const form: CapturedFormProps = await openForm();

      expect("probes" in form.initialValues).toBe(false);
    });

    test("falls back to the defaults when the device's probe is not among the options", async () => {
      // The device's probe was deleted, or is one this user cannot see.
      probeListResult = (): Promise<Array<Record<string, unknown>>> => {
        return Promise.resolve([GLOBAL_PROBE_ROW]);
      };

      const form: CapturedFormProps = await openForm();

      expect(form.initialValues["probes"]).toEqual([GLOBAL_PROBE_ID]);
    });

    test("binds the saved monitor to the device and lands on the device", async () => {
      const form: CapturedFormProps = await openForm();

      act(() => {
        form.onSuccess!(createdMonitor());
      });

      await waitFor(() => {
        expect(updateRequests).toHaveLength(1);
      });

      expect(updateRequests[0]!.modelType).toBe(NetworkDevice);
      expect(updateRequests[0]!.id.toString()).toBe(DEVICE_ID);
      expect(updateRequests[0]!.data).toEqual({ monitorId: MONITOR_ID });

      /*
       * The device, not the monitor: binding re-stamps the device's status,
       * and the device page is where that is visible.
       */
      await waitFor(() => {
        expect(navigateMock).toHaveBeenCalled();
      });
      expect(navigatedTo()).toContain(`/network-devices/${DEVICE_ID}`);
      expect(navigatedTo()).not.toContain(MONITOR_ID);
    });

    test("a bind that fails is reported in place of the form, and the monitor is kept", async () => {
      bindResult = async (): Promise<void> => {
        throw new Error("Forbidden");
      };

      const form: CapturedFormProps = await openForm();

      act(() => {
        form.onSuccess!(createdMonitor());
      });

      /*
       * ModelForm does not await onSuccess, so a rejection would vanish. The
       * message names what happened and where to finish the job by hand.
       */
      await screen.findByText(
        "The monitor was created but could not be bound to the device: Forbidden. Bind it under the device's Settings → Monitor.",
      );

      expect(navigateMock).not.toHaveBeenCalled();
      expect(screen.queryByTestId("model-form")).toBeNull();
      // The operator reviewed and saved this monitor; it is not thrown away.
      expect(deleteRequests).toHaveLength(0);
    });
  });

  describe("an SNMP device", () => {
    beforeEach(() => {
      deviceRow = networkDevice({
        monitoringMethod: "SNMP",
        probeId: DEVICE_PROBE_ID,
      });
    });

    test("still opens on the Network Device shape", async () => {
      const form: CapturedFormProps = await openForm();

      expect(form.initialValues["monitorType"]).toBe(MonitorType.NetworkDevice);
      expect(form.initialValues["name"]).toBe("Lobby AP Monitor");
      // The probe pin is a Ping-monitor concern; the SNMP shape keeps defaults.
      expect(form.initialValues["probes"]).toEqual([GLOBAL_PROBE_ID]);
    });

    test("still lands on the monitor, and binds nothing", async () => {
      const form: CapturedFormProps = await openForm();

      act(() => {
        form.onSuccess!(createdMonitor());
      });

      await waitFor(() => {
        expect(navigateMock).toHaveBeenCalled();
      });
      expect(navigatedTo()).toContain(MONITOR_ID);
      expect(navigatedTo()).not.toContain(`/network-devices/${DEVICE_ID}`);
      expect(updateRequests).toHaveLength(0);
    });
  });

  describe("a project that cannot seed a Ping monitor", () => {
    test("shows the resolver's message instead of a form that cannot be saved", async () => {
      // No offline status: nothing for the "unreachable" criteria to move to.
      monitorStatusRows = [
        monitorStatus({
          id: ONLINE_STATUS_ID,
          isOperationalState: true,
          isOfflineState: false,
        }),
      ];

      renderCreatePage();

      await screen.findByText(
        "This project needs both an operational and an offline monitor status before Ping monitors can be created. Add them under Project Settings, then try again.",
      );

      expect(capturedForm).toBeNull();
    });
  });
});

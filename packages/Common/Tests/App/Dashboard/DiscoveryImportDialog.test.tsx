import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import DiscoveryImportDialog, {
  scrollToTopOfScroller,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/DiscoveryImportDialog";
import DiscoveryImportRowStatus from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/DiscoveryImportRowStatus";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import NetworkAlertPolicy from "../../../Models/DatabaseModels/NetworkAlertPolicy";
import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import Probe from "../../../Models/DatabaseModels/Probe";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import { ActiveMonitorLimitKind } from "../../../Types/Monitor/ActiveMonitorLimit";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  DEFAULT_DISCOVERY_IMPORT_SETTINGS,
  DISCOVERY_IMPORT_STOPPED_REASON,
  DiscoveryImportAlerting,
  DiscoveryImportDeviceOutcome,
  DiscoveryImportStatus,
  DiscoveryImportView,
  MAX_HOSTS_PER_DISCOVERY_IMPORT,
  emptyDiscoveryImportProgress,
} from "../../../Types/NetworkDevice/DiscoveryImport";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { RECOMMENDED_TEMPLATE_NAME } from "../../../Utils/NetworkDevice/NetworkAlertPolicyBootstrapUtil";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import ProjectUtil from "../../../UI/Utils/Project";
import DiscoveryImportFakeServer, {
  FAKE_IMPORT_ROUTES,
  FakeImportRecord,
} from "./DiscoveryImportFakeServer";

/*
 * THE DISCOVERED-DEVICES IMPORT, RENDERED (OneUptime issues #4811-#4815).
 *
 * The real dialog - its three steps, the real Modal, the real host list,
 * facets and search, the real monitoring step and progress panel - driven
 * against an in-memory import API that keeps a server-shaped record
 * (DiscoveryImportFakeServer). What these pin is what a reviewer sees and
 * what the server is asked for:
 *
 *   - what is imported is what is ticked AND shown, and every count says so;
 *   - the monitoring step says what the import will do, with the choices
 *     the server will be sent - interval, vendor templates, template;
 *   - progress counts devices and monitors apart, lists failures by their
 *     reason, retries only what failed, and stops when asked;
 *   - the import is the server's: closing and reopening shows it where it
 *     stands.
 *
 * Fake timers drive the dialog's two-second polling; clicks are fireEvent,
 * so nothing waits on real time.
 */

interface MutableConfig {
  billingEnabled: boolean;
}

const config: MutableConfig = { billingEnabled: false };

(
  globalThis as unknown as { __discoveryImportDialogConfig: MutableConfig }
).__discoveryImportDialogConfig = config;

// BILLING_ENABLED is read when the module loads: a getter, switchable per test.
jest.mock("../../../UI/Config", () => {
  const mocked: Record<string, unknown> = {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
  };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return Boolean(
        (
          globalThis as unknown as {
            __discoveryImportDialogConfig: MutableConfig | undefined;
          }
        ).__discoveryImportDialogConfig?.billingEnabled,
      );
    },
  });

  return mocked;
});

const PROJECT_ID: ObjectID = new ObjectID(
  "4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
);
const SCAN_ID: ObjectID = new ObjectID("5a2b3c4d-6e7f-4a8b-9c0d-1e2f3a4b5c6d");
const PROBE_ID: ObjectID = new ObjectID("6b3c4d5e-7f80-4b9c-8d1e-2f3a4b5c6d7e");
const ONLINE_ID: ObjectID = new ObjectID(
  "7c4d5e6f-8091-4cad-9e2f-3a4b5c6d7e8f",
);
const OFFLINE_ID: ObjectID = new ObjectID(
  "8d5e6f70-91a2-4dbe-8f30-4b5c6d7e8f90",
);
const CRITICAL_ID: ObjectID = new ObjectID(
  "9e6f7081-a2b3-4ecf-9041-5c6d7e8f90a1",
);
const WARNING_ID: ObjectID = new ObjectID(
  "af708192-b3c4-4fd0-8152-6d7e8f90a1b2",
);
const WALK_TEMPLATE_ID: ObjectID = new ObjectID(
  "b08192a3-c4d5-4e01-9263-7e8f90a1b2c3",
);
const CREATED_TEMPLATE_ID: ObjectID = new ObjectID(
  "c192a3b4-d5e6-4f12-8374-8f90a1b2c3d4",
);

/*
 * A scan of a store network: two switches that answered SNMP, a register
 * named by NetBIOS, a kitchen display named by reverse DNS, a host nothing
 * named, and a switch already in the inventory.
 */
const HOSTS: Array<DiscoveredNetworkDevice> = [
  {
    ipAddress: "10.48.11.1",
    sysName: "core-sw-01",
    sysObjectId: "1.3.6.1.4.1.9.1.2695",
    sysDescr: "Cisco IOS XE Software, Catalyst L3 Switch",
    snmpReachable: true,
  },
  {
    ipAddress: "10.48.11.2",
    sysName: "edge-sw-02",
    sysObjectId: "1.3.6.1.4.1.2636.1.1.1.2.21",
    sysDescr: "Juniper Networks EX2300",
    snmpReachable: true,
  },
  {
    ipAddress: "10.48.12.31",
    netbiosName: "WB1100REG01",
    snmpReachable: false,
  },
  {
    ipAddress: "10.48.12.40",
    dnsHostname: "wb-0660-kds01.wbhq.com",
    snmpReachable: false,
  },
  { ipAddress: "10.48.12.99", snmpReachable: false },
  {
    ipAddress: "10.48.11.3",
    sysName: "core-sw-03",
    snmpReachable: true,
    isAlreadyRegistered: true,
  },
];

const IMPORTABLE: Array<string> = [
  "10.48.11.1",
  "10.48.11.2",
  "10.48.12.31",
  "10.48.12.40",
  "10.48.12.99",
];

function scanRow(
  overrides: Partial<NetworkDeviceDiscoveryScan> = {},
): NetworkDeviceDiscoveryScan {
  return Object.assign(new NetworkDeviceDiscoveryScan(), {
    id: SCAN_ID,
    _id: SCAN_ID.toString(),
    projectId: PROJECT_ID,
    name: "Store 1100",
    cidr: "10.48.11.0/23",
    status: "Completed",
    probeId: PROBE_ID,
    isSnmpEnabled: true,
    discoveredDevices: HOSTS,
    ...overrides,
  });
}

function probe(): Probe {
  return Object.assign(new Probe(), {
    id: PROBE_ID,
    name: "Store probe",
    isGlobalProbe: false,
  });
}

function criterion(data: {
  name: string;
  checkOn: CheckOn;
  incident?: boolean;
  alert?: boolean;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: ObjectID.generate().toString(),
    name: data.name,
    description: "",
    monitorStatusId: OFFLINE_ID,
    filterCondition: FilterCondition.All,
    filters: [
      { checkOn: data.checkOn, filterType: FilterType.False, value: undefined },
    ],
    incidents: data.incident
      ? [
          {
            id: ObjectID.generate().toString(),
            title: data.name,
            description: "",
            incidentSeverityId: CRITICAL_ID,
          },
        ]
      : [],
    alerts: data.alert
      ? [
          {
            id: ObjectID.generate().toString(),
            title: data.name,
            description: "",
            alertSeverityId: WARNING_ID,
          },
        ]
      : [],
    createIncidents: Boolean(data.incident),
    createAlerts: Boolean(data.alert),
    changeMonitorStatus: Boolean(data.incident),
    isEnabled: true,
  };
  return instance;
}

// A template every check of which reads the SNMP walk.
function walkOnlyTemplate(): MonitorTemplate {
  const steps: MonitorSteps = new MonitorSteps();
  const step: MonitorStep = new MonitorStep();
  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = {
    monitorCriteriaInstanceArray: [
      criterion({
        name: "Interface down",
        checkOn: CheckOn.SnmpInterfaceIsDown,
        incident: true,
      }),
    ],
  };
  step.data!.monitorCriteria = monitorCriteria;
  steps.data!.monitorStepsInstanceArray = [step];

  return Object.assign(new MonitorTemplate(), {
    id: WALK_TEMPLATE_ID,
    templateName: "Uplinks only",
    monitorType: MonitorType.NetworkDevice,
    monitorSteps: steps,
  });
}

interface ProjectLists {
  templates: Array<MonitorTemplate>;
  policies: Array<NetworkAlertPolicy>;
}

const lists: ProjectLists = { templates: [], policies: [] };

let server: DiscoveryImportFakeServer;
let getItemSpy: jest.SpyInstance;
let createSpy: jest.SpyInstance;
let onClose: jest.Mock;
let onImportsChanged: jest.Mock;
let monitorLimit: JSONObject | null = null;

function grant(permissions: Array<Permission>): void {
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

// Let the dialog's timers - its polling and its clock - run for `ms`.
async function advance(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await flush();
}

async function openDialog(
  props: { importId?: string; scan?: NetworkDeviceDiscoveryScan } = {},
): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <DiscoveryImportDialog
          scan={props.scan || scanRow()}
          probes={[probe()]}
          onClose={onClose}
          onImportsChanged={onImportsChanged}
          importId={props.importId}
        />
      </MemoryRouter>,
    );
  });
  await flush();
  await flush();
}

function button(name: string | RegExp): HTMLElement {
  return screen.getByRole("button", { name: name });
}

function chooseSummary(): string {
  return (
    screen.getByTestId("discovery-import-choose-summary").textContent || ""
  );
}

function checkbox(ipAddress: string): HTMLInputElement {
  return screen.getByTestId(
    `discovered-device-checkbox-${ipAddress}`,
  ) as HTMLInputElement;
}

async function search(text: string): Promise<void> {
  await act(async () => {
    fireEvent.change(screen.getByTestId("discovered-host-search"), {
      target: { value: text },
    });
  });
}

async function next(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
  });
  await flush();
  await flush();
}

async function pickMonitorsForEachDevice(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId("discovery-import-alerting-template"));
  });
  await flush();
}

async function submitImport(): Promise<void> {
  await act(async () => {
    fireEvent.click(button(/^Import \d+ devices?$/));
  });
  await flush();
  await flush();
  await flush();
}

// react-select opens on ArrowDown; its options are portalled to the body.
async function pick(comboboxName: string, optionText: string): Promise<void> {
  const combobox: HTMLElement = screen.getByRole("combobox", {
    name: comboboxName,
  });

  await act(async () => {
    fireEvent.focus(combobox);
    fireEvent.keyDown(combobox, { key: "ArrowDown", keyCode: 40 });
  });

  const option: HTMLElement = await screen.findByRole("option", {
    name: optionText,
  });

  await act(async () => {
    fireEvent.click(option);
  });
}

function lastStart(): JSONObject {
  const bodies: Array<JSONObject> = server.startBodies;

  expect(bodies.length).toBeGreaterThan(0);

  return bodies[bodies.length - 1]!;
}

function outcomeLine(key: string): HTMLElement {
  return screen.getByTestId(`discovery-import-outcome-${key}`);
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["performance"] });
  jest.setSystemTime(new Date("2026-10-15T09:00:00Z"));
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  config.billingEnabled = false;
  monitorLimit = null;
  lists.templates = [];
  lists.policies = [];
  onClose = jest.fn();
  onImportsChanged = jest.fn();

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest
    .spyOn(PermissionUtil, "getProjectPermissions")
    .mockReturnValue(null as never);
  grant([Permission.ProjectOwner]);
  jest
    .spyOn(API, "getFriendlyMessage")
    .mockImplementation((err: unknown): string => {
      return (err as { message?: string }).message || String(err);
    });

  getItemSpy = jest
    .spyOn(ModelAPI, "getItem")
    .mockResolvedValue(scanRow() as never);

  jest.spyOn(ModelAPI, "getList").mockImplementation((async (request: {
    modelType: unknown;
  }) => {
    const data: Array<unknown> =
      request.modelType === MonitorTemplate
        ? lists.templates
        : request.modelType === MonitorStatus
          ? [
              Object.assign(new MonitorStatus(), {
                id: ONLINE_ID,
                name: "Operational",
                isOperationalState: true,
              }),
              Object.assign(new MonitorStatus(), {
                id: OFFLINE_ID,
                name: "Offline",
                isOfflineState: true,
              }),
            ]
          : request.modelType === IncidentSeverity
            ? [
                Object.assign(new IncidentSeverity(), {
                  id: CRITICAL_ID,
                  name: "Critical",
                }),
              ]
            : request.modelType === AlertSeverity
              ? [
                  Object.assign(new AlertSeverity(), {
                    id: WARNING_ID,
                    name: "Warning",
                  }),
                ]
              : request.modelType === NetworkAlertPolicy
                ? lists.policies
                : [];

    return { data: data, count: data.length, skip: 0, limit: data.length };
  }) as never);

  createSpy = jest.spyOn(ModelAPI, "create").mockResolvedValue({
    data: Object.assign(new MonitorTemplate(), { id: CREATED_TEMPLATE_ID }),
  } as never);

  server = new DiscoveryImportFakeServer().install({
    get: (path: string) => {
      if (path.endsWith("/monitor/active-monitor-limit") && monitorLimit) {
        return new HTTPResponse<JSONObject>(200, monitorLimit, {});
      }

      return undefined as never;
    },
  });

  // The names the server gives the devices: the names the rows show.
  for (const [address, name] of [
    ["10.48.11.1", "core-sw-01"],
    ["10.48.11.2", "edge-sw-02"],
    ["10.48.12.31", "WB1100REG01"],
    ["10.48.12.40", "wb-0660-kds01.wbhq.com"],
  ] as Array<[string, string]>) {
    server.control.names.set(address, name);
  }

  for (const address of ["10.48.12.31", "10.48.12.40", "10.48.12.99"]) {
    server.control.pingOnly.add(address);
  }

  server.control.monitorTemplateNames.set(
    CREATED_TEMPLATE_ID.toString(),
    RECOMMENDED_TEMPLATE_NAME,
  );
  server.control.monitorTemplateNames.set(
    WALK_TEMPLATE_ID.toString(),
    "Uplinks only",
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("opening the import", () => {
  test("reads the scan fresh, asks for its last import, and ticks every host that can be imported", async () => {
    await openDialog();

    expect(getItemSpy).toHaveBeenCalledTimes(1);
    expect(getItemSpy.mock.calls[0]![0].id.toString()).toBe(SCAN_ID.toString());
    expect(server.countCalls("GET", FAKE_IMPORT_ROUTES.latest)).toBe(1);

    for (const address of IMPORTABLE) {
      expect(checkbox(address)).toBeChecked();
    }

    // Already a device: listed, never ticked, and says so.
    expect(checkbox("10.48.11.3")).not.toBeChecked();
    expect(checkbox("10.48.11.3")).toBeDisabled();
    expect(
      within(screen.getByTestId("discovered-host-row-10.48.11.3")).getByText(
        "Already added",
      ),
    ).toBeInTheDocument();

    expect(chooseSummary()).toBe("5 hosts will be imported");
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
    expect(screen.getByTestId("discovery-import-steps")).toHaveTextContent(
      "Choose devices",
    );
  });

  test("an import of this scan that is still running opens straight on its progress", async () => {
    server.seed({
      scanId: SCAN_ID.toString(),
      status: DiscoveryImportStatus.Running,
      results: [
        {
          ipAddress: "10.48.11.1",
          name: "core-sw-01",
          isPingOnly: false,
          device: DiscoveryImportDeviceOutcome.Created,
          monitor: "NotRequested" as never,
        },
        {
          ipAddress: "10.48.11.2",
          name: "edge-sw-02",
          isPingOnly: false,
          device: DiscoveryImportDeviceOutcome.Pending,
          monitor: "NotRequested" as never,
        },
      ],
    });
    server.control.hold = true;

    await openDialog();

    expect(
      screen.getByTestId("discovery-import-progress-title"),
    ).toHaveTextContent("Importing 2 devices…");
    expect(
      screen.getByTestId("discovery-import-devices-counts"),
    ).toHaveTextContent("1 imported");
    expect(
      screen.queryByTestId("discovered-host-table"),
    ).not.toBeInTheDocument();
  });

  test("a finished import of this scan is mentioned, and its results are one click away", async () => {
    const last: FakeImportRecord = server.seed({
      scanId: SCAN_ID.toString(),
      status: DiscoveryImportStatus.Completed,
      completedAt: "2026-10-15T08:00:00.000Z",
      results: [
        {
          ipAddress: "10.48.11.1",
          name: "core-sw-01",
          isPingOnly: false,
          device: DiscoveryImportDeviceOutcome.Created,
          monitor: "NotRequested" as never,
        },
        {
          ipAddress: "10.48.11.2",
          name: "edge-sw-02",
          isPingOnly: false,
          device: DiscoveryImportDeviceOutcome.Failed,
          deviceError: "A device named edge-sw-02 already exists.",
          monitor: "NotRequested" as never,
        },
      ],
    });

    await openDialog();

    expect(screen.getByTestId("discovery-import-last")).toHaveTextContent(
      "1 imported, 1 failed.",
    );
    /*
     * How long ago, from the browser's own words for it (Intl), not
     * moment's fromNow - which is English on every page, a German one too.
     */
    expect(screen.getByTestId("discovery-import-last")).toHaveTextContent(
      "Last import from this scan, 1 hour ago: 1 imported, 1 failed.",
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("discovery-import-view-last"));
    });
    await flush();

    expect(
      screen.getByTestId("discovery-import-progress-title"),
    ).toHaveTextContent("Import finished");
    expect(screen.getByTestId("discovery-import-issues")).toHaveTextContent(
      "A device named edge-sw-02 already exists.",
    );
    expect(last.id).toBeTruthy();
  });

  test("a scan that cannot be read says why, and offers only to try again", async () => {
    getItemSpy.mockRejectedValue(
      new Error("This discovery scan could not be found."),
    );

    await openDialog();

    expect(
      screen.getByText("This discovery scan could not be found."),
    ).toBeInTheDocument();
    // Nothing to choose from: no steps, no count, no Next.
    expect(
      screen.queryByRole("button", { name: "Next" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("discovery-import-steps"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("discovery-import-choose-summary"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("modal-footer-close-button")).toHaveTextContent(
      "Close",
    );
    expect(button("Try again")).toBeEnabled();
  });

  test("Try again reads the scan again, and a read that works opens the choice of hosts", async () => {
    getItemSpy.mockRejectedValueOnce(
      new Error("The scan could not be read. Check your connection."),
    );

    await openDialog();

    expect(getItemSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(button("Try again"));
    });
    await flush();
    await flush();

    expect(getItemSpy).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByText("The scan could not be read. Check your connection."),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("discovered-host-table")).toBeInTheDocument();
    expect(chooseSummary()).toBe("5 hosts will be imported");
    expect(
      screen.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
  });
});

describe("choosing the hosts", () => {
  test("a search narrows the list, the count follows, and the hidden ticks are said to stay behind", async () => {
    await openDialog();
    await search("core-sw");

    expect(
      screen.getByTestId("discovered-host-row-10.48.11.1"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("discovered-host-row-10.48.12.31"),
    ).not.toBeInTheDocument();
    expect(chooseSummary()).toBe("1 host will be imported");
    expect(
      screen.getByTestId("discovered-host-hidden-selection"),
    ).toHaveTextContent(
      "4 selected hosts are hidden by the filters and will not be imported.",
    );

    await next();
    await submitImport();

    expect(lastStart()["ipAddresses"]).toEqual(["10.48.11.1"]);
  });

  test("a subnet finds the hosts in it", async () => {
    await openDialog();
    await search("10.48.12.0/24");

    expect(chooseSummary()).toBe("3 hosts will be imported");

    await next();
    await submitImport();

    expect(lastStart()["ipAddresses"]).toEqual([
      "10.48.12.31",
      "10.48.12.40",
      "10.48.12.99",
    ]);
  });

  test("the facets count what pressing them shows, and narrow the import with the list", async () => {
    await openDialog();

    const answered: HTMLElement = screen.getByTestId(
      "discovered-host-answered-facet",
    );
    const named: HTMLElement = screen.getByTestId("discovered-host-name-facet");

    expect(answered).toHaveTextContent("All (6)");
    expect(answered).toHaveTextContent("SNMP (3)");
    expect(answered).toHaveTextContent("No SNMP (3)");
    expect(named).toHaveTextContent("Named (5)");
    expect(named).toHaveTextContent("Address only (1)");

    await act(async () => {
      fireEvent.click(within(answered).getByText("No SNMP (3)"));
    });

    // The other facet counts within what the pressed one shows.
    expect(named).toHaveTextContent("Named (2)");
    expect(chooseSummary()).toBe("3 hosts will be imported");

    await act(async () => {
      fireEvent.click(within(named).getByText("Named (2)"));
    });

    expect(chooseSummary()).toBe("2 hosts will be imported");

    await next();
    await submitImport();

    expect(lastStart()["ipAddresses"]).toEqual(["10.48.12.31", "10.48.12.40"]);
  });

  test("an ICMP-only scan has no SNMP facet to offer", async () => {
    getItemSpy.mockResolvedValue(
      scanRow({
        isSnmpEnabled: false,
        discoveredDevices: HOSTS.filter((host: DiscoveredNetworkDevice) => {
          return host.snmpReachable === false;
        }),
      }) as never,
    );

    await openDialog();

    expect(
      screen.queryByTestId("discovered-host-answered-facet"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("discovered-host-name-facet"),
    ).toBeInTheDocument();
    /*
     * What a ping-only host imports as is said on its No SNMP pill and in
     * the monitoring step's summary; the dialog's description is the scan.
     */
    expect(screen.getByTestId("modal-description")).toHaveTextContent(
      /^Store 1100 \(10\.48\.11\.0\/23\)$/,
    );
  });

  test("select all and clear act on the hosts shown", async () => {
    await openDialog();

    await act(async () => {
      fireEvent.click(screen.getByTestId("discovered-host-clear-selection"));
    });

    expect(chooseSummary()).toBe("0 hosts will be imported");
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    await search("10.48.12.0/24");
    await act(async () => {
      fireEvent.click(screen.getByTestId("discovered-host-select-shown"));
    });

    expect(chooseSummary()).toBe("3 hosts will be imported");

    await search("");

    expect(checkbox("10.48.11.1")).not.toBeChecked();
    expect(checkbox("10.48.12.31")).toBeChecked();
    expect(chooseSummary()).toBe("3 hosts will be imported");
  });

  test("a row's box is the same box across a facet change, so ticks never flicker", async () => {
    await openDialog();

    const before: HTMLElement = checkbox("10.48.12.31");

    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId("discovered-host-answered-facet")).getByText(
          "No SNMP (3)",
        ),
      );
    });

    expect(checkbox("10.48.12.31")).toBe(before);
    expect(before).toBeChecked();
  });

  test("the hosts already added can be hidden", async () => {
    await openDialog();

    await act(async () => {
      fireEvent.click(screen.getByTestId("discovered-host-hide-already-added"));
    });

    expect(
      screen.queryByTestId("discovered-host-row-10.48.11.3"),
    ).not.toBeInTheDocument();
    expect(chooseSummary()).toBe("5 hosts will be imported");
  });

  test("a search nothing matches says so, and offers the way back", async () => {
    await openDialog();
    await search("no-such-host");

    expect(screen.getByTestId("discovered-host-empty")).toHaveTextContent(
      "No host matches the search and filters.",
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("discovered-host-clear-filters"));
    });

    expect(chooseSummary()).toBe("5 hosts will be imported");
    expect(
      (screen.getByTestId("discovered-host-search") as HTMLInputElement).value,
    ).toBe("");
  });

  test(`more than ${MAX_HOSTS_PER_DISCOVERY_IMPORT} hosts are refused before the next step, with how to go on`, async () => {
    const many: Array<DiscoveredNetworkDevice> = Array.from(
      { length: MAX_HOSTS_PER_DISCOVERY_IMPORT + 1 },
      (_value: unknown, index: number): DiscoveredNetworkDevice => {
        return {
          ipAddress: `10.${60 + Math.floor(index / 65536)}.${Math.floor(index / 256) % 256}.${index % 256}`,
          snmpReachable: false,
        };
      },
    );
    getItemSpy.mockResolvedValue(scanRow({ discoveredDevices: many }) as never);

    await openDialog();

    expect(chooseSummary()).toBe(
      "One import brings in up to 5,000 hosts: narrow the selection, then import the rest after.",
    );
    // Said in the warning colour, not as one more grey count.
    expect(screen.getByTestId("discovery-import-choose-summary")).toHaveClass(
      "text-amber-700",
    );
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    // A Next that cannot be pressed looks it: Button's disabled look.
    expect(screen.getByRole("button", { name: "Next" })).toHaveClass(
      "opacity-50",
      "cursor-not-allowed",
    );
    // Fifty rows at a time, however large the scan.
    expect(screen.getAllByTestId(/^discovered-host-row-/)).toHaveLength(50);
  });
});

describe("how the devices are monitored", () => {
  test("starts on every five minutes, vendor templates on, status only - and says what that adds up to", async () => {
    await openDialog();
    await next();

    expect(screen.getByTestId("discovery-import-steps")).toHaveTextContent(
      "Monitoring",
    );
    expect(
      screen.getByRole("combobox", { name: "Check every" }).closest("div[id]"),
    ).toHaveTextContent("Every 5 minutes");
    expect(
      screen.getByTestId("discovered-device-apply-vendor-templates"),
    ).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("discovery-import-alerting-none")).toBeChecked();

    expect(outcomeLine("snmp")).toHaveTextContent(
      "2 devices answered SNMP: they are walked every 5 min",
    );
    expect(outcomeLine("ping")).toHaveTextContent(
      "3 devices answered ping only: they are pinged every 5 min.",
    );
    expect(outcomeLine("vendor")).toBeInTheDocument();
    // A template can be picked here, so the summary says so.
    expect(outcomeLine("nobody")).toHaveTextContent(
      "No monitors: nobody is alerted when one of these devices goes down. Pick a monitor template, or set up an alert policy later.",
    );

    await submitImport();

    expect(lastStart()["settings"]).toEqual({
      pollingIntervalInMinutes: 5,
      applyVendorTemplates: true,
      alerting: DiscoveryImportAlerting.None,
    });
  });

  test("a different interval is what every sentence and the import say", async () => {
    await openDialog();
    await next();
    await pick("Check every", "Every minute");

    expect(outcomeLine("ping")).toHaveTextContent("pinged every 1 min.");

    await submitImport();

    expect(
      (lastStart()["settings"] as JSONObject)["pollingIntervalInMinutes"],
    ).toBe(1);
  });

  test("vendor templates can be left off, and are not offered when no host answered SNMP", async () => {
    await openDialog();
    await next();

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("discovered-device-apply-vendor-templates"),
      );
    });

    expect(screen.queryByTestId("discovery-import-outcome-vendor")).toBeNull();

    await submitImport();

    expect(
      (lastStart()["settings"] as JSONObject)["applyVendorTemplates"],
    ).toBe(false);

    cleanup();
    getItemSpy.mockResolvedValue(
      scanRow({
        discoveredDevices: HOSTS.filter((host: DiscoveredNetworkDevice) => {
          return host.snmpReachable === false;
        }),
      }) as never,
    );
    await openDialog();
    await next();

    expect(
      screen.queryByTestId("discovered-device-apply-vendor-templates"),
    ).not.toBeInTheDocument();
  });

  test("a monitor per device from the recommended template: previewed, created on import, and sent", async () => {
    await openDialog();
    await next();
    await pickMonitorsForEachDevice();

    const picker: HTMLElement = screen.getByTestId(
      "discovery-import-template-picker",
    );
    expect(picker).toHaveTextContent(
      `${RECOMMENDED_TEMPLATE_NAME} - created when you import`,
    );

    // What each monitor checks, in the project's own severities.
    const preview: HTMLElement = screen.getByTestId(
      "discovery-import-template-preview",
    );
    expect(preview).toHaveTextContent("Device unreachable");
    expect(preview).toHaveTextContent("Opens an incident (Critical)");
    expect(preview).toHaveTextContent("Marks the monitor Offline");
    expect(preview).toHaveTextContent("Creates an alert (Warning)");
    // Walk-only checks are marked, since three of the hosts answer ping only.
    expect(
      within(preview).getAllByText("SNMP devices only").length,
    ).toBeGreaterThan(0);
    expect(preview).toHaveTextContent(
      "Checked each time a device is polled: every 5 min.",
    );

    expect(outcomeLine("monitors")).toHaveTextContent(
      `5 monitors, one per device, from “${RECOMMENDED_TEMPLATE_NAME}”, which opens incidents and creates alerts as its checks are met.`,
    );
    expect(
      screen.queryByTestId("discovery-import-outcome-ping-silent"),
    ).toBeNull();

    await submitImport();

    // The template is made first, then named in the request.
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(
      (createSpy.mock.calls[0]![0] as { model: MonitorTemplate }).model
        .templateName,
    ).toBe(RECOMMENDED_TEMPLATE_NAME);
    expect(lastStart()["settings"]).toEqual({
      pollingIntervalInMinutes: 5,
      applyVendorTemplates: true,
      alerting: DiscoveryImportAlerting.MonitorTemplate,
      monitorTemplateId: CREATED_TEMPLATE_ID.toString(),
    });
  });

  test("a template that only reads the walk says the ping-only devices will raise nothing", async () => {
    lists.templates = [walkOnlyTemplate()];

    await openDialog();
    await next();
    await pickMonitorsForEachDevice();
    await pick("Monitor template", "Uplinks only");

    expect(outcomeLine("ping-silent")).toHaveTextContent(
      "The 3 devices that answer ping only will raise nothing",
    );

    await submitImport();

    expect(createSpy).not.toHaveBeenCalled();
    expect((lastStart()["settings"] as JSONObject)["monitorTemplateId"]).toBe(
      WALK_TEMPLATE_ID.toString(),
    );
  });

  test("someone who may not create monitors gets status only, and is told why", async () => {
    grant([
      Permission.ReadNetworkDeviceDiscoveryScan,
      Permission.CreateNetworkDevice,
      Permission.ReadMonitorTemplate,
    ]);

    await openDialog();
    await next();

    expect(
      screen.getByTestId("discovery-import-alerting-template"),
    ).toBeDisabled();
    expect(
      screen.getByTestId("discovery-import-alerting-locked-reason"),
    ).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("discovery-import-alerting-none")).toBeChecked();
    // The summary does not suggest a template that cannot be picked.
    expect(outcomeLine("nobody")).toHaveTextContent(
      /^No monitors: nobody is alerted when one of these devices goes down\.$/,
    );
  });

  test("a plan at its monitor limit locks the monitors, and says so", async () => {
    config.billingEnabled = true;
    monitorLimit = {
      limit: { limit: 10, kind: ActiveMonitorLimitKind.FreePlan },
      activeMonitors: 10,
    };

    await openDialog();
    await next();

    expect(
      screen.getByTestId("discovery-import-alerting-template"),
    ).toBeDisabled();
    expect(
      screen.getByTestId("discovery-import-alerting-locked-reason"),
    ).toHaveTextContent(
      "Your plan has no room for more monitors, so the devices are imported without one.",
    );
    expect(outcomeLine("nobody")).toHaveTextContent(
      /^No monitors: nobody is alerted when one of these devices goes down\.$/,
    );
  });

  test("a plan with room for some monitors says how many devices go without", async () => {
    config.billingEnabled = true;
    monitorLimit = {
      limit: { limit: 10, kind: ActiveMonitorLimitKind.FreePlan },
      activeMonitors: 8,
    };

    await openDialog();
    await next();
    await pickMonitorsForEachDevice();

    expect(outcomeLine("room")).toHaveTextContent(
      "Your plan has room for 2 more monitors, so 3 devices will be imported without one.",
    );
  });

  test("an alert policy covering every device is named, whichever is chosen", async () => {
    lists.policies = [
      Object.assign(new NetworkAlertPolicy(), {
        name: "Alert on every device",
        isEnabled: true,
        monitorTemplateId: WALK_TEMPLATE_ID,
      }),
    ];

    await openDialog();
    await next();

    expect(
      screen.getByTestId("discovery-import-policy-note"),
    ).toHaveTextContent(
      "Your alert policy “Alert on every device” also gives every device a monitor of its own",
    );
    expect(outcomeLine("policies")).toBeInTheDocument();
  });

  test("Back keeps what was chosen", async () => {
    await openDialog();
    await search("10.48.12.0/24");
    await next();
    await pick("Check every", "Every 15 minutes");

    await act(async () => {
      fireEvent.click(screen.getByTestId("discovery-import-back"));
    });

    expect(chooseSummary()).toBe("3 hosts will be imported");

    await next();

    expect(outcomeLine("ping")).toHaveTextContent("pinged every 15 min.");
  });

  test("a refused start stays on the step with the server's words", async () => {
    server.control.refuseStart =
      "You may not create network devices in this project, so you cannot import them.";

    await openDialog();
    await next();
    await submitImport();

    expect(
      screen.getByText(
        "You may not create network devices in this project, so you cannot import them.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("discovery-import-monitoring-step"),
    ).toBeInTheDocument();
  });
});

describe("the import as it runs", () => {
  test("devices and monitors are counted apart as the import moves, and the finish says where everything is", async () => {
    server.control.hostsPerRead = 2;
    server.control.queuedReads = 1;

    await openDialog();
    await next();
    await pickMonitorsForEachDevice();
    await submitImport();

    expect(onImportsChanged).toHaveBeenCalledTimes(1);
    expect(
      screen.getByTestId("discovery-import-progress-title"),
    ).toHaveTextContent("Starting the import…");

    await advance(2000);

    expect(
      screen.getByTestId("discovery-import-progress-title"),
    ).toHaveTextContent("Importing 5 devices…");
    expect(
      screen.getByTestId("discovery-import-devices-counts"),
    ).toHaveTextContent("2 imported");
    expect(
      screen.getByTestId("discovery-import-monitors-counts"),
    ).toHaveTextContent("2 created");
    // The import carries on with the window closed.
    expect(
      screen.getByText(
        "You can close this window: the import carries on, and Review Results shows where it stands.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("discovery-import-stop")).toBeInTheDocument();

    await advance(2000);
    await advance(2000);

    expect(
      screen.getByTestId("discovery-import-progress-title"),
    ).toHaveTextContent("Import finished");
    expect(
      screen.getByTestId("discovery-import-devices-counts"),
    ).toHaveTextContent("5 imported");
    expect(
      screen.getByText(
        `Every host is in the inventory, monitored from “${RECOMMENDED_TEMPLATE_NAME}”.`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("View devices")).toBeInTheDocument();
    expect(screen.getByText("View monitors")).toBeInTheDocument();
    expect(onImportsChanged).toHaveBeenCalledTimes(2);

    // Polling stops once it is done.
    const reads: number = server.countCalls("GET", FAKE_IMPORT_ROUTES.import);
    await advance(10000);
    expect(server.countCalls("GET", FAKE_IMPORT_ROUTES.import)).toBe(reads);

    await act(async () => {
      fireEvent.click(button("Done"));
    });
    expect(onClose).toHaveBeenCalled();
  });

  test("failures are listed by their reason, and Retry tries only those hosts again", async () => {
    server.control.failDevices.set(
      "10.48.12.99",
      "A device named 10.48.12.99 already exists in this project.",
    );
    server.control.failMonitors.set(
      "10.48.11.2",
      "Your plan allows 10 active monitors.",
    );
    server.control.failMonitors.set(
      "10.48.12.31",
      "Your plan allows 10 active monitors.",
    );

    await openDialog();
    await next();
    await pickMonitorsForEachDevice();
    await submitImport();

    expect(
      screen.getByTestId("discovery-import-progress-title"),
    ).toHaveTextContent("Import finished");

    const deviceIssue: HTMLElement = screen.getByTestId(
      "discovery-import-issue-DeviceFailed",
    );
    expect(deviceIssue).toHaveTextContent("1 host was not imported");
    expect(deviceIssue).toHaveTextContent(
      "A device named 10.48.12.99 already exists in this project.",
    );

    const monitorIssue: HTMLElement = screen.getByTestId(
      "discovery-import-issue-MonitorFailed",
    );
    expect(monitorIssue).toHaveTextContent(
      "2 devices were imported without their monitors",
    );
    expect(monitorIssue).toHaveTextContent(
      "Your plan allows 10 active monitors.",
    );
    expect(monitorIssue).toHaveTextContent("edge-sw-02 (10.48.11.2)");

    expect(
      screen.getByText(
        "Fix what is listed below, then retry: only those hosts are tried again, and nothing is created twice.",
      ),
    ).toBeInTheDocument();

    server.control.failDevices.clear();
    server.control.failMonitors.clear();

    await act(async () => {
      fireEvent.click(button("Retry 3 hosts"));
    });
    await flush();
    await flush();

    expect(server.countCalls("POST", FAKE_IMPORT_ROUTES.retry)).toBe(1);

    const retried: FakeImportRecord = Array.from(
      server.imports.values(),
    ).pop()!;
    expect(
      retried.results.map((result: { ipAddress: string }): string => {
        return result.ipAddress;
      }),
    ).toEqual(["10.48.11.2", "10.48.12.31", "10.48.12.99"]);

    await advance(2000);

    expect(
      screen.getByTestId("discovery-import-progress-title"),
    ).toHaveTextContent("Import finished");
    expect(button("Done")).toBeInTheDocument();
  });

  test("Stop stops before the next host, keeps what was created, and lists the rest to retry", async () => {
    server.control.hostsPerRead = 1;

    await openDialog();
    await next();
    await submitImport();

    expect(
      screen.getByTestId("discovery-import-devices-counts"),
    ).toHaveTextContent("1 imported");

    // The worker is busy with its current host when the stop is asked for.
    server.control.hold = true;

    await act(async () => {
      fireEvent.click(screen.getByTestId("discovery-import-stop"));
    });
    await flush();

    expect(server.countCalls("POST", FAKE_IMPORT_ROUTES.stop)).toBe(1);
    expect(
      screen.getByTestId("discovery-import-progress-title"),
    ).toHaveTextContent("Stopping after the host being imported now…");
    expect(
      screen.getByText("What it has imported so far stays."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/the import carries on/)).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("discovery-import-stop"),
    ).not.toBeInTheDocument();

    server.control.hold = false;
    await advance(2000);

    expect(
      screen.getByTestId("discovery-import-progress-title"),
    ).toHaveTextContent("Import stopped");
    expect(
      screen.getByTestId("discovery-import-issue-NotReached"),
    ).toHaveTextContent("4 hosts were not reached");
    // One reason for all four, worded for a heading over any number of hosts.
    expect(
      within(
        screen.getByTestId("discovery-import-issue-NotReached"),
      ).getByTestId("discovery-import-issue-reason"),
    ).toHaveTextContent(DISCOVERY_IMPORT_STOPPED_REASON);
    expect(button("Retry 4 hosts")).toBeInTheDocument();

    /*
     * The bar shows how far the import got - one host of five - not a full
     * bar over "4 not reached".
     */
    const devices: HTMLElement = screen.getByTestId(
      "discovery-import-devices-progress",
    );
    expect(within(devices).getByTestId("progress-bar-count")).toHaveTextContent(
      "1 of 5 Devices",
    );
    expect(within(devices).getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "20",
    );
    expect(
      screen.getByTestId("discovery-import-devices-counts"),
    ).toHaveTextContent("1 imported · 4 not reached");

    // Nothing to fix after a stop: what stays, and what Retry does.
    expect(
      screen.getByText(
        "What it imported before it stopped stays. Retry tries the rest again, and nothing is created twice.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/^Fix what is listed below/),
    ).not.toBeInTheDocument();
  });

  test("an import queued behind another says it is waiting, not stuck", async () => {
    server.control.queuedReads = 100;

    await openDialog();
    await next();
    await submitImport();

    expect(
      screen.getByTestId("discovery-import-progress-title"),
    ).toHaveTextContent("Starting the import…");

    await advance(20000);

    expect(
      screen.getByTestId("discovery-import-progress-title"),
    ).toHaveTextContent("Waiting for another import in this project to finish");
  });

  test("a read that fails keeps the last progress on screen, says so, and recovers", async () => {
    server.control.hostsPerRead = 1;

    await openDialog();
    await next();
    await submitImport();

    server.control.refuseReads = "The server could not be reached.";
    await advance(2000);

    expect(screen.getByTestId("discovery-import-poll-error")).toHaveTextContent(
      "Showing the last progress received. Retrying: The server could not be reached.",
    );
    expect(
      screen.getByTestId("discovery-import-devices-counts"),
    ).toHaveTextContent("1 imported");

    server.control.refuseReads = null;
    server.control.hostsPerRead = Infinity;
    await advance(5000);

    expect(screen.queryByTestId("discovery-import-poll-error")).toBeNull();
    expect(
      screen.getByTestId("discovery-import-progress-title"),
    ).toHaveTextContent("Import finished");
  });

  test("every host's outcome is one click away, with links to what was created", async () => {
    await openDialog();
    await next();
    await pickMonitorsForEachDevice();
    await submitImport();

    await act(async () => {
      fireEvent.click(screen.getByTestId("discovery-import-show-all"));
    });
    await flush();

    // Every host, not only the ones that need a look: asked for in full.
    const results: HTMLElement = screen.getByTestId("discovery-import-results");
    expect(within(results).getAllByRole("listitem")).toHaveLength(5);
    expect(
      within(results).getByText("core-sw-01").closest("a"),
    ).toHaveAttribute("href", expect.stringContaining("device-10.48.11.1"));
    expect(
      within(results).getAllByText("Monitor created")[0]!.closest("a"),
    ).toHaveAttribute("href", expect.stringContaining("monitor-10.48.11.1"));
    expect(
      server.calls.some((call: { query?: string | undefined }): boolean => {
        return call.query === "results=all";
      }),
    ).toBe(true);
  });

  test("after an import, the hosts it brought in read as added, and more can be imported", async () => {
    getItemSpy.mockResolvedValue(scanRow() as never);

    await openDialog();
    await search("10.48.11.0/24");
    await next();
    await submitImport();

    expect(
      screen.getByTestId("discovery-import-progress-title"),
    ).toHaveTextContent("Import finished");

    await act(async () => {
      fireEvent.click(screen.getByTestId("discovery-import-more"));
    });
    await flush();

    expect(checkbox("10.48.11.1")).toBeDisabled();
    expect(checkbox("10.48.11.2")).toBeDisabled();
    expect(checkbox("10.48.12.31")).toBeChecked();
    expect(chooseSummary()).toBe("3 hosts will be imported");
  });

  test("opened on an import from the scans table, it shows that import", async () => {
    const record: FakeImportRecord = server.seed({
      scanId: SCAN_ID.toString(),
      status: DiscoveryImportStatus.Running,
      results: [
        {
          ipAddress: "10.48.11.1",
          name: "core-sw-01",
          isPingOnly: false,
          device: DiscoveryImportDeviceOutcome.Pending,
          monitor: "NotRequested" as never,
        },
      ],
    });
    server.control.hold = true;

    await openDialog({ importId: record.id });

    expect(server.countCalls("GET", FAKE_IMPORT_ROUTES.latest)).toBe(0);
    expect(
      screen.getByTestId("discovery-import-progress-title"),
    ).toHaveTextContent("Importing 1 device…");
  });
});

/*
 * What the UI review of the dialog changed (PR #4849): the header says
 * which scan, every step opens at its top, the facets are named for a screen
 * reader, a long group of failed hosts scrolls, and the loading and lone-bar
 * states read as the rest of the product does.
 */
describe("the dialog, as a reader meets it", () => {
  test("the description is the scan it imports from, on every step", async () => {
    await openDialog();

    const description: () => string = (): string => {
      return screen.getByTestId("modal-description").textContent || "";
    };

    expect(description()).toBe("Store 1100 (10.48.11.0/23)");

    await next();
    expect(description()).toBe("Store 1100 (10.48.11.0/23)");

    await submitImport();
    expect(description()).toBe("Store 1100 (10.48.11.0/23)");
  });

  test("each facet is a radio group named after what it filters by", async () => {
    await openDialog();

    const responded: HTMLElement = screen.getByRole("radiogroup", {
      name: "Responded",
    });
    const name: HTMLElement = screen.getByRole("radiogroup", { name: "Name" });

    expect(
      within(responded).getByRole("radio", { name: "SNMP (3)" }),
    ).toBeInTheDocument();
    expect(
      within(name).getByRole("radio", { name: "Address only (1)" }),
    ).toBeInTheDocument();
    // No group is left with the shared component's generic name.
    expect(
      screen.queryByRole("radiogroup", { name: "Filter options" }),
    ).not.toBeInTheDocument();
  });

  test("the search box's name says everything it finds a host by", async () => {
    await openDialog();

    expect(
      screen.getByRole("textbox", {
        name: "Search hosts by name, address, subnet or vendor",
      }),
    ).toHaveAttribute("placeholder", "Search by name, address or subnet");
  });

  test("the selection's links are the product's links, not grey text", async () => {
    await openDialog();

    expect(screen.getByTestId("discovered-host-clear-selection")).toHaveClass(
      "text-indigo-600",
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("discovered-host-clear-selection"));
    });

    expect(screen.getByTestId("discovered-host-select-shown")).toHaveClass(
      "text-indigo-600",
    );
    expect(screen.getByTestId("discovered-host-select-shown")).not.toHaveClass(
      "text-gray-400",
    );
  });

  test("a new step takes the keyboard's focus, so it is read from its top", async () => {
    await openDialog();
    await next();

    expect(document.activeElement).toBe(
      screen.getByTestId("discovery-import-dialog"),
    );
    expect(
      screen.getByTestId("discovery-import-monitoring-step"),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId("discovery-import-back"));
    });
    await flush();

    expect(document.activeElement).toBe(
      screen.getByTestId("discovery-import-dialog"),
    );
    expect(screen.getByTestId("discovered-host-table")).toBeInTheDocument();
  });

  test("a new step opens at the top of the dialog's scrolling body, whatever lies between", () => {
    const scroller: HTMLDivElement = document.createElement("div");
    const between: HTMLDivElement = document.createElement("div");
    const content: HTMLDivElement = document.createElement("div");

    scroller.style.overflowY = "auto";
    // A box that does not scroll is passed over, though it may be tall.
    between.style.overflowY = "visible";
    Object.defineProperty(scroller, "scrollHeight", { value: 2400 });
    Object.defineProperty(scroller, "clientHeight", { value: 600 });
    Object.defineProperty(between, "scrollHeight", { value: 2400 });
    Object.defineProperty(between, "clientHeight", { value: 600 });

    scroller.appendChild(between);
    between.appendChild(content);
    document.body.appendChild(scroller);

    scroller.scrollTop = 1500;
    between.scrollTop = 0;
    scrollToTopOfScroller(content);

    expect(scroller.scrollTop).toBe(0);

    // Nothing to scroll, or nothing at all: nothing happens, nothing throws.
    expect(() => {
      scrollToTopOfScroller(null);
      scrollToTopOfScroller(document.createElement("div"));
    }).not.toThrow();

    scroller.remove();
  });

  test("on a phone, the one-line step names itself to a screen reader", async () => {
    await openDialog();

    const line: HTMLElement = screen.getByTestId("discovery-import-step-phone");

    expect(line).not.toHaveAttribute("aria-hidden");
    expect(line).toHaveTextContent("Choose devices · Step 1 of 3");
  });

  test("while the project is read, the choices' box holds the product's loader", async () => {
    let releaseTemplates: () => void = (): void => {};
    const getList: jest.SpyInstance = jest.spyOn(ModelAPI, "getList");
    const answer: (request: { modelType: unknown }) => Promise<unknown> =
      getList.getMockImplementation() as never;

    getList.mockImplementation((async (request: { modelType: unknown }) => {
      if (request.modelType === MonitorTemplate) {
        await new Promise<void>((resolve: () => void) => {
          releaseTemplates = resolve;
        });
      }

      return answer(request);
    }) as never);

    await openDialog();
    await next();

    expect(
      screen.getByTestId("discovery-import-facts-loading"),
    ).toHaveAttribute("aria-busy", "true");
    expect(
      within(screen.getByTestId("discovery-import-facts-loading")).getByRole(
        "status",
        { name: "Loading" },
      ),
    ).toBeInTheDocument();
    expect(button(/^Import \d+ devices?$/)).toBeDisabled();

    await act(async () => {
      releaseTemplates();
    });
    await flush();
    await flush();

    expect(
      screen.queryByTestId("discovery-import-facts-loading"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("discovery-import-alerting")).toBeInTheDocument();
  });

  test("an import with no monitors draws its one bar across the panel", async () => {
    await openDialog();
    await next();
    await submitImport();

    const devices: HTMLElement = screen.getByTestId(
      "discovery-import-devices-progress",
    );

    expect(
      screen.queryByTestId("discovery-import-monitors-progress"),
    ).not.toBeInTheDocument();
    expect(devices.parentElement).not.toHaveClass("md:grid-cols-2");
  });

  test("an import with monitors draws its two bars side by side", async () => {
    await openDialog();
    await next();
    await pickMonitorsForEachDevice();
    await submitImport();

    expect(
      screen.getByTestId("discovery-import-devices-progress").parentElement,
    ).toHaveClass("md:grid-cols-2");
  });

  test("a group of more hosts than it names opens into a list of every host, in a box of its own", async () => {
    const many: Array<DiscoveredNetworkDevice> = Array.from(
      { length: 30 },
      (_value: unknown, index: number): DiscoveredNetworkDevice => {
        return { ipAddress: `10.70.0.${index + 1}`, snmpReachable: false };
      },
    );
    getItemSpy.mockResolvedValue(scanRow({ discoveredDevices: many }) as never);

    for (const host of many) {
      server.control.failDevices.set(
        host.ipAddress,
        "This project has reached its plan's limit of network devices.",
      );
    }

    await openDialog();
    await next();
    await submitImport();

    const group: HTMLElement = screen.getByTestId(
      "discovery-import-issue-DeviceFailed",
    );

    expect(group).toHaveTextContent("30 hosts were not imported");
    // Twelve named, the rest counted.
    expect(group).toHaveTextContent("10.70.0.12");
    expect(group).not.toHaveTextContent("10.70.0.13,");

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("discovery-import-issue-more-DeviceFailed"),
      );
    });

    const hosts: HTMLElement = screen.getByTestId(
      "discovery-import-issue-hosts-DeviceFailed",
    );

    // Every host, one a line, in a box that scrolls rather than grows.
    expect(within(hosts).getAllByRole("listitem")).toHaveLength(30);
    expect(hosts).toHaveClass("max-h-48", "overflow-y-auto");
    expect(within(hosts).getByText("10.70.0.30")).toBeInTheDocument();
    expect(
      screen.queryByTestId("discovery-import-issue-more-DeviceFailed"),
    ).not.toBeInTheDocument();
  });
});

/*
 * A scan's running import on its row of the scans table: how far it has got,
 * and the way back to its progress - for whoever closed the dialog, and for
 * a colleague who never opened it.
 */
describe("the scans table row of a scan being imported", () => {
  function rowView(
    status: DiscoveryImportStatus,
    devicesCreated: number,
  ): DiscoveryImportView {
    return {
      id: "import-on-row",
      scanId: SCAN_ID.toString(),
      status: status,
      settings: { ...DEFAULT_DISCOVERY_IMPORT_SETTINGS },
      progress: {
        ...emptyDiscoveryImportProgress(),
        hosts: 514,
        hostsDone: devicesCreated,
        devicesCreated: devicesCreated,
      },
      createdAt: "2026-10-15T09:00:00.000Z",
      isMine: false,
    };
  }

  test("a queued import says it is waiting, and how many devices it will bring in", async () => {
    await act(async () => {
      render(
        <DiscoveryImportRowStatus
          view={rowView(DiscoveryImportStatus.Queued, 0)}
          onView={() => {}}
        />,
      );
    });

    expect(
      screen.getByTestId(`discovery-import-row-${SCAN_ID.toString()}`),
    ).toHaveTextContent("Waiting to import 514 devices");
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
  });

  test("a running import counts what it has done, and View progress opens it", async () => {
    const onView: jest.Mock = jest.fn();

    await act(async () => {
      render(
        <DiscoveryImportRowStatus
          view={rowView(DiscoveryImportStatus.Running, 257)}
          onView={onView}
        />,
      );
    });

    expect(
      screen.getByTestId(`discovery-import-row-${SCAN_ID.toString()}`),
    ).toHaveTextContent("Importing devices: 257 of 514");
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "50",
    );
    expect(screen.getByRole("progressbar")).toHaveAccessibleName(
      "Import progress: 50%",
    );

    await act(async () => {
      fireEvent.click(
        screen.getByTestId(`discovery-import-row-view-${SCAN_ID.toString()}`),
      );
    });

    expect(onView).toHaveBeenCalledTimes(1);
  });
});

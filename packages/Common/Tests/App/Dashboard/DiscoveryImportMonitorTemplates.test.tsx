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
import DiscoveryImportDialog from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/DiscoveryImportDialog";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import NetworkAlertPolicy from "../../../Models/DatabaseModels/NetworkAlertPolicy";
import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import Probe from "../../../Models/DatabaseModels/Probe";
import Hostname from "../../../Types/API/Hostname";
import URL from "../../../Types/API/URL";
import Includes from "../../../Types/BaseDatabase/Includes";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import IP from "../../../Types/IP/IP";
import { JSONObject } from "../../../Types/JSON";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { DiscoveryImportAlerting } from "../../../Types/NetworkDevice/DiscoveryImport";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Port from "../../../Types/Port";
import { DEVICE_MONITOR_TEMPLATE_TYPES } from "../../../Utils/Monitor/DeviceMonitorTemplateUtil";
import { RECOMMENDED_TEMPLATE_NAME } from "../../../Utils/NetworkDevice/NetworkAlertPolicyBootstrapUtil";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import ProjectUtil from "../../../UI/Utils/Project";
import DiscoveryImportFakeServer from "./DiscoveryImportFakeServer";

/*
 * THE IMPORT'S MONITORING STEP AND ITS TEMPLATES (OneUptime issue #5145).
 *
 * A self-hosted customer's own "WB KDS Ping Monitor Template" never showed in
 * the import: the step read Network Device templates only. It lists every
 * kind a device's monitor can be made from now - Network Device templates,
 * whose monitors read each device's polls, and Ping, IP, Port and NTP ones,
 * whose monitors check each device's address - says in one line which kinds
 * are listed, beside a link to the templates, and reads them again when the
 * reader comes back from making one. These render the real dialog, its real
 * Dropdown and preview, against the project's templates as the API hands
 * them back, and pin what the reader sees and what the import is sent.
 */

interface MutableConfig {
  billingEnabled: boolean;
}

const config: MutableConfig = { billingEnabled: false };

(
  globalThis as unknown as { __monitorTemplatesStepConfig: MutableConfig }
).__monitorTemplatesStepConfig = config;

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
            __monitorTemplatesStepConfig: MutableConfig | undefined;
          }
        ).__monitorTemplatesStepConfig?.billingEnabled,
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
const CREATED_TEMPLATE_ID: ObjectID = new ObjectID(
  "c192a3b4-d5e6-4f12-8374-8f90a1b2c3d4",
);

const POS_ID: string = "d1a2b3c4-0000-4000-8000-000000000001";
const KDS_ID: string = "d1a2b3c4-0000-4000-8000-000000000002";
const PRINTERS_ID: string = "d1a2b3c4-0000-4000-8000-000000000003";
const TIME_ID: string = "d1a2b3c4-0000-4000-8000-000000000004";
const REGISTERS_ID: string = "d1a2b3c4-0000-4000-8000-000000000005";
const STOREFRONT_ID: string = "d1a2b3c4-0000-4000-8000-000000000006";
const UPLINKS_ID: string = "d1a2b3c4-0000-4000-8000-000000000007";

const SNMP_HOSTS: Array<DiscoveredNetworkDevice> = [
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
    snmpReachable: true,
  },
];

// Kitchen displays and registers that answer ping only, as in #5145.
const PING_ONLY_HOSTS: Array<DiscoveredNetworkDevice> = [
  { ipAddress: "10.48.24.31", netbiosName: "WB0024KDS01", snmpReachable: false },
  { ipAddress: "10.48.24.32", netbiosName: "WB0024KDS02", snmpReachable: false },
  { ipAddress: "10.48.24.33", snmpReachable: false },
];

function scanRow(hosts: Array<DiscoveredNetworkDevice>): NetworkDeviceDiscoveryScan {
  return Object.assign(new NetworkDeviceDiscoveryScan(), {
    id: SCAN_ID,
    _id: SCAN_ID.toString(),
    projectId: PROJECT_ID,
    name: "WB Unit Franchise KDS",
    cidr: "10.48.24.0/24",
    status: "Completed",
    probeId: PROBE_ID,
    isSnmpEnabled: true,
    discoveredDevices: hosts,
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
  isEnabled?: boolean;
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
    isEnabled: data.isEnabled !== false,
  };
  return instance;
}

function networkDeviceTemplate(
  id: string,
  name: string,
  criteria: Array<MonitorCriteriaInstance>,
): MonitorTemplate {
  const steps: MonitorSteps = new MonitorSteps();
  const step: MonitorStep = new MonitorStep();
  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = { monitorCriteriaInstanceArray: criteria };
  step.data!.monitorCriteria = monitorCriteria;
  steps.data!.monitorStepsInstanceArray = [step];

  return Object.assign(new MonitorTemplate(), {
    id: new ObjectID(id),
    templateName: name,
    monitorType: MonitorType.NetworkDevice,
    monitorSteps: steps,
  });
}

// A template whose monitor checks an address, as the template form makes one.
function addressTemplate(data: {
  id: string;
  name: string;
  monitorType: MonitorType;
  destination?: IP | Hostname | URL;
  ports?: Array<number>;
  monitoringInterval?: string;
}): MonitorTemplate {
  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: (data.ports || [0]).map(
      (port: number): MonitorStep => {
        const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
          monitorName: data.name,
          monitorType: data.monitorType,
          onlineMonitorStatusId: ONLINE_ID,
          offlineMonitorStatusId: OFFLINE_ID,
          defaultIncidentSeverityId: CRITICAL_ID,
          defaultAlertSeverityId: WARNING_ID,
        });
        step.setMonitorDestination(
          data.destination || IP.fromString("192.0.2.10"),
        );
        if (port) {
          step.setPort(new Port(port));
        }
        return step;
      },
    ),
    defaultMonitorStatusId: ONLINE_ID,
  };

  return Object.assign(new MonitorTemplate(), {
    id: new ObjectID(data.id),
    templateName: data.name,
    monitorType: data.monitorType,
    monitorSteps: steps,
    ...(data.monitoringInterval
      ? { monitoringInterval: data.monitoringInterval }
      : {}),
  });
}

function posTemplate(): MonitorTemplate {
  return networkDeviceTemplate(POS_ID, "POS ping availability", [
    criterion({
      name: "Register stops answering",
      checkOn: CheckOn.SnmpIsOnline,
      incident: true,
    }),
  ]);
}

function kdsTemplate(): MonitorTemplate {
  return addressTemplate({
    id: KDS_ID,
    name: "WB KDS Ping Monitor Template",
    monitorType: MonitorType.Ping,
    monitoringInterval: "*/5 * * * *",
  });
}

function printersTemplate(): MonitorTemplate {
  return addressTemplate({
    id: PRINTERS_ID,
    name: "Receipt printers",
    monitorType: MonitorType.Port,
    ports: [9100],
    monitoringInterval: "* * * * *",
  });
}

function timeTemplate(): MonitorTemplate {
  return addressTemplate({
    id: TIME_ID,
    name: "Store time servers",
    monitorType: MonitorType.NTP,
    destination: new Hostname("time.wbhq.com"),
    monitoringInterval: "*/10 * * * *",
  });
}

function registersTemplate(): MonitorTemplate {
  return addressTemplate({
    id: REGISTERS_ID,
    name: "Registers by IP",
    monitorType: MonitorType.IP,
  });
}

// Checks a URL: the read should not return it, and the step never shows it.
function storefrontTemplate(): MonitorTemplate {
  return addressTemplate({
    id: STOREFRONT_ID,
    name: "Storefront website",
    monitorType: MonitorType.Website,
    destination: URL.fromString("https://shop.wbhq.com"),
  });
}

// Every check reads the SNMP walk.
function uplinksTemplate(): MonitorTemplate {
  return networkDeviceTemplate(UPLINKS_ID, "Uplinks only", [
    criterion({
      name: "Interface down",
      checkOn: CheckOn.SnmpInterfaceIsDown,
      incident: true,
    }),
  ]);
}

interface ProjectLists {
  templates: Array<MonitorTemplate>;
  templatesError: Error | null;
}

const lists: ProjectLists = { templates: [], templatesError: null };

let server: DiscoveryImportFakeServer;
let getListSpy: jest.SpyInstance;
let createSpy: jest.SpyInstance;

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function settle(): Promise<void> {
  for (let round: number = 0; round < 4; round++) {
    await flush();
  }
}

async function openDialog(
  props: {
    hosts?: Array<DiscoveredNetworkDevice>;
    probes?: Array<Probe>;
  } = {},
): Promise<void> {
  jest
    .spyOn(ModelAPI, "getItem")
    .mockResolvedValue(
      scanRow(props.hosts || [...SNMP_HOSTS, ...PING_ONLY_HOSTS]) as never,
    );

  await act(async () => {
    render(
      <MemoryRouter>
        <DiscoveryImportDialog
          scan={scanRow(props.hosts || [...SNMP_HOSTS, ...PING_ONLY_HOSTS])}
          probes={props.probes || [probe()]}
          onClose={jest.fn()}
          onImportsChanged={jest.fn()}
        />
      </MemoryRouter>,
    );
  });
  await settle();
}

async function toMonitoring(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
  });
  await settle();
}

async function monitorsForEachDevice(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId("discovery-import-alerting-template"));
  });
  await flush();
}

async function openTemplateMenu(): Promise<HTMLElement> {
  const combobox: HTMLElement = screen.getByRole("combobox", {
    name: "Monitor template",
  });

  await act(async () => {
    fireEvent.focus(combobox);
    fireEvent.keyDown(combobox, { key: "ArrowDown", keyCode: 40 });
  });

  return await screen.findByRole("listbox");
}

// The menu's options by name: a name, then its description when it has one.
function optionTexts(menu: HTMLElement): Array<string> {
  return within(menu)
    .getAllByRole("option")
    .map((option: HTMLElement): string => {
      return Array.from(option.querySelectorAll("span"))
        .map((span: HTMLElement): string => {
          return span.textContent || "";
        })
        .filter((text: string): boolean => {
          return Boolean(text);
        })
        .join(" | ");
    });
}

async function pickTemplate(name: RegExp): Promise<void> {
  const menu: HTMLElement = await openTemplateMenu();
  const option: HTMLElement = within(menu).getByRole("option", { name: name });

  await act(async () => {
    fireEvent.click(option);
  });
  await flush();
}

async function submitImport(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Import \d+ devices?$/ }));
  });
  await settle();
}

function lastStart(): JSONObject {
  const bodies: Array<JSONObject> = server.startBodies;
  expect(bodies.length).toBeGreaterThan(0);
  return bodies[bodies.length - 1]!;
}

function templateReads(): Array<{ query: Record<string, unknown> }> {
  return getListSpy.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as { modelType: unknown; query: Record<string, unknown> };
    })
    .filter((request: { modelType: unknown }): boolean => {
      return request.modelType === MonitorTemplate;
    });
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["performance"] });
  jest.setSystemTime(new Date("2026-10-21T09:00:00Z"));
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  config.billingEnabled = false;
  lists.templates = [];
  lists.templatesError = null;

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest
    .spyOn(PermissionUtil, "getProjectPermissions")
    .mockReturnValue(null as never);
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue([Permission.ProjectOwner]);
  jest
    .spyOn(API, "getFriendlyMessage")
    .mockImplementation((err: unknown): string => {
      return (err as { message?: string }).message || String(err);
    });

  getListSpy = jest.spyOn(ModelAPI, "getList").mockImplementation((async (request: {
    modelType: unknown;
  }) => {
    if (request.modelType === MonitorTemplate && lists.templatesError) {
      throw lists.templatesError;
    }

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
                ? []
                : [];

    return { data: data, count: data.length, skip: 0, limit: data.length };
  }) as never);

  createSpy = jest.spyOn(ModelAPI, "create").mockResolvedValue({
    data: Object.assign(new MonitorTemplate(), { id: CREATED_TEMPLATE_ID }),
  } as never);

  server = new DiscoveryImportFakeServer().install();

  for (const host of PING_ONLY_HOSTS) {
    server.control.pingOnly.add(host.ipAddress);
  }

  server.control.monitorTemplateNames.set(
    KDS_ID,
    "WB KDS Ping Monitor Template",
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("which templates the step lists (issue #5145)", () => {
  test("Network Device templates, then the Ping, IP, Port and NTP ones, each under its heading - and nothing else", async () => {
    lists.templates = [
      kdsTemplate(),
      storefrontTemplate(),
      posTemplate(),
      printersTemplate(),
      timeTemplate(),
      registersTemplate(),
    ];

    await openDialog();
    await toMonitoring();
    await monitorsForEachDevice();

    const menu: HTMLElement = await openTemplateMenu();

    expect(optionTexts(menu)).toEqual([
      `${RECOMMENDED_TEMPLATE_NAME} - created when you import`,
      "POS ping availability",
      "WB KDS Ping Monitor Template | Pings each device",
      "Receipt printers | Checks port 9100 on each device",
      "Store time servers | Asks each device for the time",
      "Registers by IP | Pings each device's IP address",
    ]);

    // Each kind under a heading that says which it is, in that order.
    const headings: Array<string> = ["Network Device templates", "Ping, IP, Port and NTP templates"];
    const text: string = menu.textContent || "";
    expect(text.indexOf(headings[0]!)).toBeGreaterThanOrEqual(0);
    expect(text.indexOf(headings[1]!)).toBeGreaterThan(
      text.indexOf("POS ping availability"),
    );
    expect(text.indexOf(headings[1]!)).toBeLessThan(
      text.indexOf("WB KDS Ping Monitor Template"),
    );

    // A template that checks a URL has nothing of a device's to check.
    expect(menu).not.toHaveTextContent("Storefront website");
  });

  test("the project's templates are read for exactly the kinds a device's monitor can be made from", async () => {
    await openDialog();
    await toMonitoring();

    expect(templateReads()).toHaveLength(1);
    const query: Record<string, unknown> = templateReads()[0]!.query;
    expect(query["monitorType"]).toBeInstanceOf(Includes);
    expect((query["monitorType"] as Includes).values).toEqual([
      ...DEVICE_MONITOR_TEMPLATE_TYPES,
    ]);
  });

  test("templates of one kind alone need no heading", async () => {
    lists.templates = [posTemplate()];

    await openDialog();
    await toMonitoring();
    await monitorsForEachDevice();

    const menu: HTMLElement = await openTemplateMenu();

    expect(menu).not.toHaveTextContent("Network Device templates");
    expect(menu).not.toHaveTextContent("Ping, IP, Port and NTP templates");
    expect(optionTexts(menu)).toHaveLength(2);
  });

  test("one line says which kinds are listed, beside a link to the templates that opens in a new tab", async () => {
    await openDialog();
    await toMonitoring();
    await monitorsForEachDevice();

    expect(screen.getByTestId("discovery-import-template-rule")).toHaveTextContent(
      "Network Device, Ping, IP, Port and NTP templates are listed: other kinds cannot check a device. Manage templates",
    );

    const link: HTMLElement = screen.getByTestId(
      "discovery-import-manage-templates",
    );
    expect(link).toHaveTextContent("Manage templates");
    expect(link).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID.toString()}/monitors/settings/templates`,
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  test("a template saved with no name is named in the reader's language, and drawn as named otherwise", async () => {
    const unnamed: MonitorTemplate = kdsTemplate();
    delete unnamed.templateName;
    // A name someone gave a template is never looked up as a translation.
    const labels: MonitorTemplate = posTemplate();
    labels.templateName = "Labels";
    lists.templates = [labels, unnamed];

    await openDialog();
    await toMonitoring();
    await monitorsForEachDevice();

    const menu: HTMLElement = await openTemplateMenu();

    expect(optionTexts(menu)).toEqual([
      `${RECOMMENDED_TEMPLATE_NAME} - created when you import`,
      "Labels",
      "Unnamed template | Pings each device",
    ]);
  });
});

describe("picking a template whose monitors check each device's address", () => {
  test("a Ping template: each device gets a Ping monitor on its own address, from the scan's probe, on the template's schedule", async () => {
    lists.templates = [posTemplate(), kdsTemplate()];

    await openDialog();
    await toMonitoring();
    await monitorsForEachDevice();
    await pickTemplate(/^WB KDS Ping Monitor Template/);

    expect(screen.getByTestId("discovery-import-template-lead")).toHaveTextContent(
      "Each device gets a Ping monitor that pings its own address from Store probe.",
    );
    expect(
      screen.getByTestId("discovery-import-template-schedule"),
    ).toHaveTextContent("Checked on the template's schedule: every 5 minutes.");

    // Every check is listed, none marked for SNMP devices only.
    const preview: HTMLElement = screen.getByTestId(
      "discovery-import-template-preview",
    );
    expect(
      within(preview).getAllByTestId("discovery-import-template-check").length,
    ).toBeGreaterThan(0);
    expect(preview).toHaveTextContent("Opens an incident (Critical)");
    expect(
      screen.queryByTestId("discovery-import-template-walk-checks"),
    ).toBeNull();
    expect(preview).not.toHaveTextContent("SNMP devices only");

    // What the import does, said beside it.
    expect(
      screen.getByTestId("discovery-import-outcome-monitors"),
    ).toHaveTextContent(
      "5 monitors, one per device, from “WB KDS Ping Monitor Template”, which opens incidents",
    );
    expect(
      screen.getByTestId("discovery-import-outcome-address"),
    ).toHaveTextContent("Each monitor checks its device's address from Store probe.");
    expect(
      screen.queryByTestId("discovery-import-outcome-ping-silent"),
    ).toBeNull();
  });

  test("the import is sent the Ping template, and no template is made", async () => {
    lists.templates = [kdsTemplate()];

    await openDialog();
    await toMonitoring();
    await monitorsForEachDevice();
    await pickTemplate(/^WB KDS Ping Monitor Template/);
    await submitImport();

    expect(createSpy).not.toHaveBeenCalled();
    expect(lastStart()["settings"]).toEqual({
      pollingIntervalInMinutes: 5,
      applyVendorTemplates: true,
      alerting: DiscoveryImportAlerting.MonitorTemplate,
      monitorTemplateId: KDS_ID,
    });
  });

  test.each([
    [
      /^Receipt printers/,
      "Each device gets a Port monitor that checks port 9100 on its own address from Store probe.",
      "Checked on the template's schedule: every minute.",
    ],
    [
      /^Store time servers/,
      "Each device gets an NTP monitor that asks its own address for the time from Store probe.",
      "Checked on the template's schedule: every 10 minutes.",
    ],
    [
      /^Registers by IP/,
      "Each device gets an IP monitor that pings its own IP address from Store probe.",
      "Checked on the template's schedule.",
    ],
  ])(
    "%s is previewed as what each device gets",
    async (name: RegExp, lead: string, schedule: string) => {
      lists.templates = [printersTemplate(), timeTemplate(), registersTemplate()];

      await openDialog();
      await toMonitoring();
      await monitorsForEachDevice();
      await pickTemplate(name);

      expect(
        screen.getByTestId("discovery-import-template-lead"),
      ).toHaveTextContent(lead);
      expect(
        screen.getByTestId("discovery-import-template-schedule"),
      ).toHaveTextContent(schedule);
    },
  );

  test("a scan whose probe the dialog does not know names it as the probe that ran the scan", async () => {
    lists.templates = [kdsTemplate()];

    await openDialog({ probes: [] });
    await toMonitoring();
    await monitorsForEachDevice();
    await pickTemplate(/^WB KDS Ping Monitor Template/);

    expect(screen.getByTestId("discovery-import-template-lead")).toHaveTextContent(
      "Each device gets a Ping monitor that pings its own address from the probe that ran the scan.",
    );
    expect(
      screen.getByTestId("discovery-import-outcome-address"),
    ).toHaveTextContent(
      "Each monitor checks its device's address from the probe that ran the scan.",
    );
  });

  test("a Network Device template's monitors are checked on every poll, at the interval picked here", async () => {
    lists.templates = [posTemplate(), kdsTemplate()];

    await openDialog();
    await toMonitoring();
    await monitorsForEachDevice();
    await pickTemplate(/^POS ping availability/);

    expect(screen.getByTestId("discovery-import-template-lead")).toHaveTextContent(
      "Each device gets a Network Device monitor that reads what its polls find.",
    );
    expect(
      screen.getByTestId("discovery-import-template-schedule"),
    ).toHaveTextContent("Checked each time a device is polled: every 5 min.");
    expect(screen.queryByTestId("discovery-import-outcome-address")).toBeNull();
  });
});

describe("a Network Device template, on devices that answer ping only", () => {
  test("every device answers ping only: the checks that read a walk fold into one line that opens and closes", async () => {
    await openDialog({ hosts: PING_ONLY_HOSTS });
    await toMonitoring();
    await monitorsForEachDevice();

    const preview: HTMLElement = screen.getByTestId(
      "discovery-import-template-preview",
    );

    // What can fire on these devices is what the reader sees.
    expect(
      within(preview)
        .getAllByTestId("discovery-import-template-check")
        .map((line: HTMLElement): string => {
          return line.querySelector("p")?.textContent || "";
        }),
    ).toEqual(["Device unreachable"]);

    const folded: HTMLElement = screen.getByTestId(
      "discovery-import-template-walk-checks-folded",
    );
    const count: number = Number(
      (folded.textContent || "").split(" ")[0] || "0",
    );
    expect(count).toBeGreaterThan(1);
    expect(folded).toHaveTextContent(
      `${count} more checks read an SNMP walk: they stay quiet until these devices have SNMP credentials.`,
    );
    expect(
      screen.queryByTestId("discovery-import-template-walk-check"),
    ).toBeNull();

    const toggle: HTMLElement = screen.getByTestId(
      "discovery-import-template-walk-checks-toggle",
    );
    expect(toggle).toHaveTextContent("Show them");
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(toggle).toHaveTextContent("Hide them");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getAllByTestId("discovery-import-template-walk-check"),
    ).toHaveLength(count);
    expect(preview).toHaveTextContent("Interface down");

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(
      screen.queryByTestId("discovery-import-template-walk-check"),
    ).toBeNull();
  });

  test("some devices answer SNMP: the walk checks are listed apart, under SNMP devices only", async () => {
    await openDialog();
    await toMonitoring();
    await monitorsForEachDevice();

    const section: HTMLElement = screen.getByTestId(
      "discovery-import-template-walk-checks",
    );
    expect(section).toHaveTextContent("SNMP devices only");
    expect(section).toHaveTextContent(
      "These read an SNMP walk, so they never fire on a device that answers ping only until it has SNMP credentials.",
    );
    expect(
      within(section).getAllByTestId("discovery-import-template-walk-check")
        .length,
    ).toBeGreaterThan(1);
    expect(
      screen.queryByTestId("discovery-import-template-walk-checks-toggle"),
    ).toBeNull();
  });

  test("no device answers ping only: every check is listed, none set apart", async () => {
    await openDialog({ hosts: SNMP_HOSTS });
    await toMonitoring();
    await monitorsForEachDevice();

    expect(
      screen.queryByTestId("discovery-import-template-walk-checks"),
    ).toBeNull();
    expect(
      screen.getAllByTestId("discovery-import-template-check").length,
    ).toBeGreaterThan(5);
  });

  test("a template none of whose checks can fire on these devices says so, and folds the one it has", async () => {
    lists.templates = [uplinksTemplate()];

    await openDialog({ hosts: PING_ONLY_HOSTS });
    await toMonitoring();
    await monitorsForEachDevice();
    await pickTemplate(/^Uplinks only/);

    expect(
      screen.getByTestId("discovery-import-template-no-ping-checks"),
    ).toHaveTextContent(
      "None of its checks can fire on a device that answers ping only: each one reads an SNMP walk.",
    );
    expect(
      screen.getByTestId("discovery-import-template-walk-checks-folded"),
    ).toHaveTextContent(
      "1 more check reads an SNMP walk: it stays quiet until these devices have SNMP credentials.",
    );
    expect(
      screen.getByTestId("discovery-import-outcome-ping-silent"),
    ).toHaveTextContent("The 3 devices that answer ping only will raise nothing");
  });

  test("checks turned off in the template are counted, and a template with none on says it raises nothing", async () => {
    lists.templates = [
      networkDeviceTemplate(POS_ID, "Partly off", [
        criterion({
          name: "Register stops answering",
          checkOn: CheckOn.SnmpIsOnline,
          incident: true,
        }),
        criterion({
          name: "Register walk failing",
          checkOn: CheckOn.SnmpWalkIsSucceeding,
          alert: true,
          isEnabled: false,
        }),
      ]),
      networkDeviceTemplate(UPLINKS_ID, "All off", [
        criterion({
          name: "Register stops answering",
          checkOn: CheckOn.SnmpIsOnline,
          incident: true,
          isEnabled: false,
        }),
      ]),
    ];

    await openDialog();
    await toMonitoring();
    await monitorsForEachDevice();
    await pickTemplate(/^Partly off/);

    expect(
      screen.getByTestId("discovery-import-template-turned-off"),
    ).toHaveTextContent("1 more check is turned off in this template.");

    await pickTemplate(/^All off/);

    expect(
      screen.getByTestId("discovery-import-template-no-checks"),
    ).toHaveTextContent(
      "This template has no checks turned on, so its monitors raise nothing.",
    );
  });
});

describe("what the choice says about the plan", () => {
  test("a self-hosted install has no plan to count monitors against", async () => {
    config.billingEnabled = false;

    await openDialog();
    await toMonitoring();

    const choice: HTMLElement = screen
      .getByTestId("discovery-import-alerting-template")
      .closest("label") as HTMLElement;
    expect(
      screen.getByText("Each device gets a monitor from the template you pick."),
    ).toBeInTheDocument();
    expect(choice || document.body).not.toHaveTextContent(
      "counts towards your plan",
    );
  });

  test("on a plan, each monitor counts towards it, and the choice says so", async () => {
    config.billingEnabled = true;

    await openDialog();
    await toMonitoring();

    expect(
      screen.getByText(
        "Each device gets a monitor from the template you pick. Each monitor counts towards your plan.",
      ),
    ).toBeInTheDocument();
  });
});

describe("the templates, read again when the reader comes back to the dialog", () => {
  async function focusWindow(): Promise<void> {
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await settle();
  }

  test("a template made in another tab is listed on coming back, and the pick is kept", async () => {
    lists.templates = [kdsTemplate()];

    await openDialog();
    await toMonitoring();
    await monitorsForEachDevice();
    await pickTemplate(/^WB KDS Ping Monitor Template/);

    lists.templates = [kdsTemplate(), printersTemplate()];
    const readsBefore: number = templateReads().length;
    await focusWindow();

    expect(templateReads()).toHaveLength(readsBefore + 1);
    expect(
      screen.getByTestId("discovery-import-template-lead"),
    ).toHaveTextContent("Each device gets a Ping monitor");

    const menu: HTMLElement = await openTemplateMenu();
    expect(menu).toHaveTextContent("Receipt printers");
  });

  test("a picked template deleted meanwhile gives way to the first, the recommended one", async () => {
    lists.templates = [kdsTemplate()];

    await openDialog();
    await toMonitoring();
    await monitorsForEachDevice();
    await pickTemplate(/^WB KDS Ping Monitor Template/);

    lists.templates = [];
    await focusWindow();

    expect(
      screen.getByTestId("discovery-import-template-lead"),
    ).toHaveTextContent(
      "Each device gets a Network Device monitor that reads what its polls find.",
    );
    expect(
      screen.getByTestId("discovery-import-outcome-monitors"),
    ).toHaveTextContent(`from “${RECOMMENDED_TEMPLATE_NAME}”`);
  });

  test("a read that fails keeps the list the step has", async () => {
    lists.templates = [kdsTemplate()];

    await openDialog();
    await toMonitoring();
    await monitorsForEachDevice();
    await pickTemplate(/^WB KDS Ping Monitor Template/);

    lists.templatesError = new Error("The connection was interrupted.");
    await focusWindow();

    expect(
      screen.getByTestId("discovery-import-template-lead"),
    ).toHaveTextContent("Each device gets a Ping monitor");
    expect(screen.queryByTestId("discovery-import-facts-error")).toBeNull();
  });

  test("nothing is read while the hosts are chosen", async () => {
    await openDialog();
    await focusWindow();

    expect(templateReads()).toHaveLength(0);
  });
});

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
import AddDiscoveredDevicesDialog from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveredDevices/AddDiscoveredDevicesDialog";
import { DiscoveredDeviceItem } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveredDevices/DiscoveredDeviceItems";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import NetworkAlertPolicy from "../../../Models/DatabaseModels/NetworkAlertPolicy";
import NetworkDeviceRole from "../../../Models/DatabaseModels/NetworkDeviceRole";
import NetworkSnmpCredentialProfile from "../../../Models/DatabaseModels/NetworkSnmpCredentialProfile";
import { JSONObject } from "../../../Types/JSON";
import {
  DiscoveryImportAlerting,
  DiscoveryImportDeviceOutcome,
  DiscoveryImportMonitorOutcome,
  DiscoveryImportSource,
  DiscoveryImportStatus,
  MAX_HOSTS_PER_DISCOVERY_IMPORT,
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
} from "./DiscoveryImportFakeServer";

/*
 * ADDING DISCOVERED DEVICES TO MONITORING, RENDERED (OneUptime issue #5775).
 *
 * The real dialog - the discovery import's own Monitoring step and progress
 * panel, with what the devices are and the SNMP credentials they are walked
 * with asked first - driven against the in-memory import API
 * (DiscoveryImportFakeServer), which answers an import from the list the
 * way the server does. What these pin:
 *
 *   - only devices with an address and not monitored already are sent, and
 *     the rest are named, with why;
 *   - the server is asked for the list's rows by id, with the role, the
 *     credentials and the monitoring chosen - the same settings a scan's
 *     import sends;
 *   - the import is the server's: its progress, a duplicate it refused with
 *     its reason, and reopening a running one;
 *   - a selection that cannot be added cannot be submitted.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
);
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
const ROLE_ID: string = "d2a3b4c5-e6f7-4a81-9b2c-3d4e5f6a7b8c";
const PROFILE_ID: string = "e3b4c5d6-f7a8-4b92-8c3d-4e5f6a7b8c9d";

const CAMERA_ID: string = "10000000-0000-4000-8000-000000000001";
const PRINTER_ID: string = "10000000-0000-4000-8000-000000000002";
const NO_ADDRESS_ID: string = "10000000-0000-4000-8000-000000000003";
const ROUTER_ID: string = "10000000-0000-4000-8000-000000000005";

function item(
  overrides: Partial<DiscoveredDeviceItem> & { id: string; name: string },
): DiscoveredDeviceItem {
  return {
    _id: overrides.id,
    macAddress: "",
    isSeenRecently: true,
    isFromController: false,
    isHidden: false,
    isMonitored: false,
    isOnPage: true,
    ...overrides,
  } as DiscoveredDeviceItem;
}

const CAMERA: DiscoveredDeviceItem = item({
  id: CAMERA_ID,
  name: "Lobby camera",
  ipAddress: "10.20.0.11",
  macAddress: "00:1a:2b:3c:4d:01",
});
const PRINTER: DiscoveredDeviceItem = item({
  id: PRINTER_ID,
  name: "10.20.0.12",
  ipAddress: "10.20.0.12",
  macAddress: "00:1a:2b:3c:4d:02",
});
const NO_ADDRESS: DiscoveredDeviceItem = item({
  id: NO_ADDRESS_ID,
  name: "00:1a:2b:3c:4d:03",
  macAddress: "00:1a:2b:3c:4d:03",
});
const MONITORED: DiscoveredDeviceItem = item({
  id: ROUTER_ID,
  name: "Branch router",
  ipAddress: "10.20.0.1",
  isMonitored: true,
  monitoredDevice: { id: "30000000-0000-4000-8000-000000000002" },
});

interface ProjectLists {
  roles: Array<NetworkDeviceRole>;
  profiles: Array<NetworkSnmpCredentialProfile>;
  refuseRoles: string | null;
}

const lists: ProjectLists = { roles: [], profiles: [], refuseRoles: null };

let server: DiscoveryImportFakeServer;
let getListSpy: jest.SpyInstance;
let createSpy: jest.SpyInstance;
let onClose: jest.Mock;
let onImportsChanged: jest.Mock;

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
  props: { devices?: Array<DiscoveredDeviceItem>; importId?: string } = {},
): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <AddDiscoveredDevicesDialog
          devices={props.devices || [CAMERA, PRINTER]}
          importId={props.importId}
          onClose={onClose}
          onImportsChanged={onImportsChanged}
        />
      </MemoryRouter>,
    );
  });
  await flush();
  await flush();
}

function submitButton(): HTMLElement {
  return screen.getByTestId("modal-footer-submit-button");
}

async function submit(): Promise<void> {
  await act(async () => {
    fireEvent.click(submitButton());
  });
  await flush();
  await flush();
  await flush();
}

/*
 * react-select opens on ArrowDown; its options are portalled to the body.
 * Device Role and SNMP Credential Profile wait in the step's More fields fold.
 */
function moreFields(): HTMLElement {
  return screen.getByTestId("discovered-device-import-more-fields");
}

async function toggleMoreFields(): Promise<void> {
  await act(async () => {
    fireEvent.click(within(moreFields()).getByTestId("folded-section-header"));
  });
}

async function openMoreFields(): Promise<void> {
  if (moreFields().getAttribute("data-collapsed") === "true") {
    await toggleMoreFields();
  }
}

const MORE_FIELDS_PICKERS: Array<string> = [
  "Device Role",
  "SNMP Credential Profile",
];

async function pick(comboboxName: string, optionText: string): Promise<void> {
  if (MORE_FIELDS_PICKERS.includes(comboboxName)) {
    await openMoreFields();
  }

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

function outcomeLine(key: string): HTMLElement {
  return screen.getByTestId(`discovery-import-outcome-${key}`);
}

function lastStart(): JSONObject {
  const bodies: Array<JSONObject> = server.startFromDiscoveredDevicesBodies;

  expect(bodies.length).toBeGreaterThan(0);

  return bodies[bodies.length - 1]!;
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["performance"] });
  jest.setSystemTime(new Date("2026-11-09T09:00:00Z"));
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  lists.roles = [
    Object.assign(new NetworkDeviceRole(), {
      id: new ObjectID(ROLE_ID),
      name: "Camera",
    }),
  ];
  lists.profiles = [
    Object.assign(new NetworkSnmpCredentialProfile(), {
      id: new ObjectID(PROFILE_ID),
      name: "Office SNMP v3",
    }),
  ];
  lists.refuseRoles = null;
  onClose = jest.fn();
  onImportsChanged = jest.fn();

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

  getListSpy = jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation((async (request: { modelType: unknown }) => {
      if (request.modelType === NetworkDeviceRole && lists.refuseRoles) {
        throw new Error(lists.refuseRoles);
      }

      const data: Array<unknown> =
        request.modelType === NetworkDeviceRole
          ? lists.roles
          : request.modelType === NetworkSnmpCredentialProfile
            ? lists.profiles
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
                  : request.modelType === MonitorTemplate ||
                      request.modelType === NetworkAlertPolicy
                    ? []
                    : [];

      return { data: data, count: data.length, skip: 0, limit: data.length };
    }) as never);

  createSpy = jest.spyOn(ModelAPI, "create").mockResolvedValue({
    data: Object.assign(new MonitorTemplate(), { id: CREATED_TEMPLATE_ID }),
  } as never);

  server = new DiscoveryImportFakeServer().install();

  for (const device of [CAMERA, PRINTER, NO_ADDRESS, MONITORED]) {
    server.control.discoveredDevices.set(device.id, {
      name: device.name,
      ...(device.ipAddress ? { ipAddress: device.ipAddress } : {}),
    });
  }

  server.control.monitorTemplateNames.set(
    CREATED_TEMPLATE_ID.toString(),
    RECOMMENDED_TEMPLATE_NAME,
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("what the dialog adds", () => {
  test("names the devices it adds, and the ones it leaves out, with why", async () => {
    await openDialog({ devices: [CAMERA, PRINTER, NO_ADDRESS, MONITORED] });

    expect(
      screen.getByTestId("discovered-device-import-names"),
    ).toHaveTextContent("Lobby camera (10.20.0.11), 10.20.0.12");
    expect(
      screen.getByTestId("discovered-device-import-monitored"),
    ).toHaveTextContent(
      "1 selected device is monitored already, so it is left out.",
    );
    expect(
      screen.getByTestId("discovered-device-import-no-address"),
    ).toHaveTextContent(
      "1 selected device has no IP address yet, so it is left out",
    );
    expect(submitButton()).toHaveTextContent("Add 2 devices");
    expect(submitButton()).toBeEnabled();
  });

  test("one device is named by itself, and more than three are counted", async () => {
    await openDialog({ devices: [CAMERA] });

    expect(screen.getByRole("dialog")).toHaveTextContent("Lobby camera");
    expect(submitButton()).toHaveTextContent("Add 1 device");

    cleanup();

    const many: Array<DiscoveredDeviceItem> = [1, 2, 3, 4, 5].map(
      (index: number): DiscoveredDeviceItem => {
        return item({
          id: `10000000-0000-4000-8000-00000000010${index}`,
          name: `Sensor ${index}`,
          ipAddress: `10.20.1.${index}`,
        });
      },
    );

    await openDialog({ devices: many });

    expect(
      screen.getByTestId("discovered-device-import-names"),
    ).toHaveTextContent(
      "Sensor 1 (10.20.1.1), Sensor 2 (10.20.1.2), Sensor 3 (10.20.1.3) and 2 more",
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "5 devices from the Discovered Devices list",
    );
  });

  test("a selection none of which can be added says so, and cannot be submitted", async () => {
    await openDialog({ devices: [NO_ADDRESS, MONITORED] });

    expect(
      screen.getByTestId("discovered-device-import-nothing"),
    ).toHaveTextContent(
      "None of the selected devices can be added: each one is monitored already or has no IP address yet.",
    );
    expect(submitButton()).toBeDisabled();
    expect(
      screen.queryByTestId("discovered-device-import-role"),
    ).not.toBeInTheDocument();

    await submit();
    expect(server.startFromDiscoveredDevicesBodies).toHaveLength(0);
  });

  test("more devices than one import takes cannot be submitted, and the dialog says what to do", async () => {
    const tooMany: Array<DiscoveredDeviceItem> = [];

    for (
      let index: number = 0;
      index <= MAX_HOSTS_PER_DISCOVERY_IMPORT;
      index++
    ) {
      tooMany.push(
        item({
          id: ObjectID.generate().toString(),
          name: `Host ${index}`,
          ipAddress: `10.${Math.floor(index / 65536) % 256}.${Math.floor(index / 256) % 256}.${index % 256}`,
        }),
      );
    }

    await openDialog({ devices: tooMany });

    expect(
      screen.getByTestId("discovered-device-import-too-many"),
    ).toHaveTextContent("One import brings in up to 5,000 hosts");
    expect(submitButton()).toBeDisabled();
  });
});

describe("how the devices are monitored", () => {
  test("they are pinged until credentials are picked, then walked with them - as the step says", async () => {
    await openDialog();

    expect(outcomeLine("ping")).toHaveTextContent(
      "2 devices are pinged every 5 min. Those in a site with SNMP credentials are walked with them too.",
    );
    expect(screen.queryByTestId("discovery-import-outcome-snmp")).toBeNull();
    // The list's devices are polled by the probe of the switch that saw each one.
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "The probe of the switch that saw each device pings it on this schedule",
    );

    await pick("SNMP Credential Profile", "Office SNMP v3");

    expect(outcomeLine("snmp")).toHaveTextContent(
      "2 devices are walked every 5 min for interfaces, inventory and health, with the SNMP credentials you picked.",
    );
    expect(screen.queryByTestId("discovery-import-outcome-ping")).toBeNull();
  });

  test("starts the import with the list's rows by id, what they are and how they are walked", async () => {
    // Held where it is, so the dialog shows the import still running.
    server.control.hold = true;

    await openDialog({ devices: [CAMERA, PRINTER, NO_ADDRESS, MONITORED] });

    await pick("Device Role", "Camera");
    await pick("SNMP Credential Profile", "Office SNMP v3");
    await submit();

    // Only the devices it can add, by the list's ids; nothing else about them.
    expect(lastStart()).toEqual({
      endpointIds: [CAMERA_ID, PRINTER_ID],
      settings: {
        pollingIntervalInMinutes: 5,
        applyVendorTemplates: true,
        alerting: DiscoveryImportAlerting.None,
        networkDeviceRoleId: ROLE_ID,
        snmpCredentialProfileId: PROFILE_ID,
      },
    });
    // No scan is started, and nothing is created in the browser.
    expect(server.startBodies).toHaveLength(0);
    expect(createSpy).not.toHaveBeenCalled();
    expect(onImportsChanged).toHaveBeenCalledTimes(1);

    expect(
      screen.getByTestId("discovery-import-progress-title"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "You can close this window: the import carries on, and the Discovered Devices list shows where it stands.",
      ),
    ).toBeInTheDocument();
  });

  test("a monitor for each device makes the recommended template first, and the import is sent with it", async () => {
    await openDialog();

    await act(async () => {
      fireEvent.click(screen.getByTestId("discovery-import-alerting-template"));
    });
    await flush();
    await submit();

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(lastStart()["settings"]).toEqual({
      pollingIntervalInMinutes: 5,
      applyVendorTemplates: true,
      alerting: DiscoveryImportAlerting.MonitorTemplate,
      monitorTemplateId: CREATED_TEMPLATE_ID.toString(),
    });
  });

  test("what the devices are and their credentials wait folded under More fields, after the step's questions, and say what is picked", async () => {
    await openDialog();

    const fold: HTMLElement = moreFields();
    const header: HTMLElement = within(fold).getByTestId(
      "folded-section-header",
    );

    expect(fold).toHaveAttribute("data-collapsed", "true");
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(header).toHaveAccessibleName("More fields");
    expect(header).toHaveTextContent("Device Role, SNMP Credential Profile");
    // After who hears about a problem, not first in the dialog.
    expect(
      screen
        .getByTestId("discovery-import-alerting")
        .compareDocumentPosition(fold) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      fold.compareDocumentPosition(
        screen.getByTestId("discovered-device-import-names"),
      ) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();

    await pick("Device Role", "Camera");
    await pick("SNMP Credential Profile", "Office SNMP v3");
    await toggleMoreFields();

    expect(fold).toHaveAttribute("data-collapsed", "true");
    expect(
      within(fold)
        .getAllByTestId("folded-section-item")
        .map((entry: HTMLElement): string => {
          return entry.textContent || "";
        }),
    ).toEqual([
      "Device Role: Camera",
      "SNMP Credential Profile: Office SNMP v3",
    ]);
  });

  test("a role list that cannot be read locks its picker and says why, and the import still goes ahead", async () => {
    lists.refuseRoles = "Roles could not be read.";

    await openDialog();
    await openMoreFields();

    const role: HTMLElement = screen.getByTestId(
      "discovered-device-import-role",
    );
    expect(within(role).getByText("Roles could not be read.")).toBeVisible();

    await submit();

    expect(lastStart()["settings"]).not.toHaveProperty("networkDeviceRoleId");
    expect(lastStart()["endpointIds"]).toEqual([CAMERA_ID, PRINTER_ID]);
  });

  test("the pickers link to where roles and credential profiles are managed, in a new tab", async () => {
    await openDialog();
    await openMoreFields();

    for (const testId of [
      "discovered-device-import-manage-roles",
      "discovered-device-import-manage-profiles",
    ]) {
      const link: HTMLElement = screen.getByTestId(testId);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveTextContent("(opens in a new tab)");
    }
  });
});

describe("the import, on the server", () => {
  test("its progress runs on the server; a device already monitored is refused with its reason", async () => {
    server.control.alreadyAdded.add("10.20.0.11");

    await openDialog();
    await submit();

    await advance(2000);
    await advance(2000);

    expect(
      screen.getByTestId("discovery-import-progress-title"),
    ).toHaveTextContent("Import finished");

    await act(async () => {
      fireEvent.click(screen.getByTestId("discovery-import-show-all"));
    });
    await flush();

    const results: HTMLElement = screen.getByTestId("discovery-import-results");
    expect(within(results).getAllByRole("listitem")).toHaveLength(2);
    expect(results).toHaveTextContent("Lobby camera");
    expect(results).toHaveTextContent("Already added");

    // The list is read again once the import is done.
    expect(onImportsChanged.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test("a start the server refuses says why in the dialog, and nothing is started", async () => {
    server.control.refuseStart =
      "You have reached the number of active monitors your plan allows.";

    await openDialog();
    await submit();

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "You have reached the number of active monitors your plan allows.",
    );
    expect(onImportsChanged).not.toHaveBeenCalled();
    expect(submitButton()).toHaveTextContent("Add 2 devices");
  });

  test("reopened on an import that is still running, it opens on its progress without reading the project again", async () => {
    const running: { id: string } = server.seed({
      scanId: "",
      source: DiscoveryImportSource.DiscoveredDevices,
      status: DiscoveryImportStatus.Running,
      results: [
        {
          ipAddress: "10.20.0.11",
          name: "Lobby camera",
          isPingOnly: true,
          device: DiscoveryImportDeviceOutcome.Pending,
          monitor: DiscoveryImportMonitorOutcome.NotRequested,
        },
      ],
    });
    server.control.hold = true;

    await openDialog({ devices: [], importId: running.id });
    await advance(2000);

    expect(
      screen.getByTestId("discovery-import-progress-title"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("discovered-device-import-stop"),
    ).toBeInTheDocument();
    expect(getListSpy).not.toHaveBeenCalled();
    expect(server.countCalls("GET", FAKE_IMPORT_ROUTES.import)).toBeGreaterThan(
      0,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("discovered-device-import-stop"));
    });
    await flush();

    expect(server.countCalls("POST", FAKE_IMPORT_ROUTES.stop)).toBe(1);
  });
});

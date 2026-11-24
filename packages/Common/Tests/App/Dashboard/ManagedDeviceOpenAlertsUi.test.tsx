import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * A managed device's open alerts and incidents on its Inventory item
 * (#10007), rendered: a device the Android agent does not report has no
 * Host, so its device manager's monitors' alerts about it - one per device,
 * its series naming it - are found by its names and its connection's
 * monitors, listed on its device manager's card, each a link to its page,
 * and listed whole on the item's Alerts and Incidents pages. An alert of
 * another connection's monitor, about a device that shares its name, is
 * never this one's.
 */

const mockAlertsTableProps: Array<Record<string, unknown>> = [];
const mockIncidentsTableProps: Array<Record<string, unknown>> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Alert/AlertsTable",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): null => {
        mockAlertsTableProps.push(props);
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentsTable",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): null => {
        mockIncidentsTableProps.push(props);
        return null;
      },
    };
  },
);

import ManagedDeviceCard from "../../../../App/FeatureSet/Dashboard/src/Components/DeviceManagement/ManagedDeviceCard";
import ManagedDeviceRecordsTable from "../../../../App/FeatureSet/Dashboard/src/Components/DeviceManagement/ManagedDeviceRecordsTable";
import InventoryLinkedResource from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryLinkedResource";
import { LinkedResource } from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/LinkedResource";
import AlertStateUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/AlertState";
import IncidentStateUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/IncidentState";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import DeviceManagementConnection from "../../../Models/DatabaseModels/DeviceManagementConnection";
import Host from "../../../Models/DatabaseModels/Host";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import ManagedDevice from "../../../Models/DatabaseModels/ManagedDevice";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Includes from "../../../Types/BaseDatabase/Includes";
import Color from "../../../Types/Color";
import DeviceManagementProvider from "../../../Types/DeviceManagement/DeviceManagementProvider";
import { MANAGED_DEVICE_RESOURCE_TYPE } from "../../../Types/DeviceManagement/ManagedDeviceIdentity";
import { ManagedDevicePlatform } from "../../../Types/DeviceManagement/ManagedDevicePlatform";
import { JSONObject } from "../../../Types/JSON";
import { getManagedDeviceAlertTemplateById } from "../../../Types/Monitor/ManagedDeviceAlertTemplates";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import ObjectID from "../../../Types/ObjectID";
import EntityType from "../../../Types/Telemetry/EntityType";
import EmptyStateOptions from "../../../UI/Components/ModelTable/EmptyStateOptions";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

const CONNECTION_ID: string = "30000000-0000-4000-8000-000000000001";
const OTHER_CONNECTION_ID: string = "30000000-0000-4000-8000-0000000000ff";
const DEVICE_ID: string = "30000000-0000-4000-8000-000000000002";
const ITEM_ID: string = "30000000-0000-4000-8000-000000000003";
const MONITOR_ID: string = "40000000-0000-4000-8000-000000000001";
const OTHER_MONITOR_ID: string = "40000000-0000-4000-8000-000000000002";
const OPEN_STATE_ID: string = "50000000-0000-4000-8000-000000000001";

const LOW_BATTERY_ID: string = "60000000-0000-4000-8000-000000000001";
const STOPPED_ID: string = "60000000-0000-4000-8000-000000000002";

function device(): ManagedDevice {
  const value: ManagedDevice = new ManagedDevice();
  value._id = DEVICE_ID;
  value.connectionId = new ObjectID(CONNECTION_ID);
  value.deviceName = "ESP-ID-AAAAW";
  value.serialNumber = "R9KT30ABC12";
  value.providerDeviceId = "811a2d27-13fd-4358-8dc3-aed049e73ce7";
  value.platform = ManagedDevicePlatform.Android;
  value.lastCheckInAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
  value.batteryLevel = 12;

  const connection: DeviceManagementConnection =
    new DeviceManagementConnection();
  connection.name = "Store fleet";
  connection.provider = DeviceManagementProvider.Esper;
  connection.config = { tenant: "acme", readIntervalInMinutes: 15 };
  value.connection = connection;

  return value;
}

// A monitor made from one of the connection's templates.
function monitorOf(
  id: string,
  connectionId: string,
  templateId: string,
): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = id;
  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [
      getManagedDeviceAlertTemplateById(templateId)!.getMonitorStep({
        deviceManagementConnectionId: connectionId,
        onlineMonitorStatusId: ObjectID.generate(),
        offlineMonitorStatusId: ObjectID.generate(),
        defaultIncidentSeverityId: ObjectID.generate(),
        defaultAlertSeverityId: ObjectID.generate(),
        monitorName: templateId,
      }),
    ],
    defaultMonitorStatusId: ObjectID.generate(),
  };
  monitor.monitorSteps = steps;
  return monitor;
}

function alert(data: {
  id: string;
  title: string;
  number: string;
  monitorId: string;
  severity: string;
  color: string;
}): Alert {
  const value: Alert = new Alert();
  value._id = data.id;
  value.title = data.title;
  value.alertNumberWithPrefix = data.number;
  value.monitorId = new ObjectID(data.monitorId);
  value.createdAt = new Date("2026-11-19T10:00:00.000Z");
  const severity: AlertSeverity = new AlertSeverity();
  severity.name = data.severity;
  severity.color = new Color(data.color);
  value.alertSeverity = severity;
  return value;
}

const OPEN_ALERTS: Array<Alert> = [
  alert({
    id: LOW_BATTERY_ID,
    title: "[Esper] Low battery - Device: ESP-ID-AAAAW",
    number: "ALT-42",
    monitorId: MONITOR_ID,
    severity: "Warning",
    color: "#f59e0b",
  }),
  alert({
    id: STOPPED_ID,
    title: "[Esper] Device stopped checking in - Device: ESP-ID-AAAAW",
    number: "ALT-41",
    monitorId: MONITOR_ID,
    severity: "Critical",
    color: "#dc2626",
  }),
];

interface ListCall {
  modelType: unknown;
  query: JSONObject;
  select: JSONObject;
}

let listCalls: Array<ListCall>;
let raisedBy: Array<string>;
let openAlerts: Array<Alert>;

beforeEach(() => {
  mockAlertsTableProps.length = 0;
  mockIncidentsTableProps.length = 0;
  listCalls = [];
  raisedBy = [MONITOR_ID, OTHER_MONITOR_ID];
  openAlerts = OPEN_ALERTS;

  goTo(`/dashboard/${PROJECT_ID}/inventory/${ITEM_ID}`);
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  getJestSpyOn(ModelAPI, "getItem").mockImplementation((async (data: {
    modelType: unknown;
  }) => {
    if (data.modelType === InventoryItem) {
      const item: InventoryItem = new InventoryItem();
      item._id = ITEM_ID;
      item.entityType = EntityType.Host;
      item.displayName = "Store 12 Kiosk 3";
      item.identifyingAttributes = { "host.name": "esp-id-aaaaw" };
      item.resourceType = MANAGED_DEVICE_RESOURCE_TYPE;
      item.resourceId = new ObjectID(DEVICE_ID);
      return item;
    }

    return device();
  }) as never);
  getJestSpyOn(ModelAPI, "getList").mockImplementation((async (
    data: ListCall,
  ) => {
    listCalls.push(data);

    if (data.modelType === Host) {
      // No Host: the Android agent does not report the device.
      return { data: [], count: 0, skip: 0, limit: 1 };
    }

    if (data.modelType === Monitor) {
      return {
        data: [
          monitorOf(MONITOR_ID, CONNECTION_ID, "esper-low-battery"),
          // Another connection's monitor, about a device that shares the name.
          monitorOf(
            OTHER_MONITOR_ID,
            OTHER_CONNECTION_ID,
            "esper-device-stopped-checking-in",
          ),
        ],
        count: 2,
        skip: 0,
        limit: 2,
      };
    }

    if (data.modelType === Incident) {
      return { data: [], count: 0, skip: 0, limit: 10 };
    }

    // An alert list: the device's alerts' monitors, then its open alerts.
    if (data.query["currentAlertStateId"]) {
      return {
        data: openAlerts,
        count: openAlerts.length,
        skip: 0,
        limit: 5,
      };
    }

    return {
      data: raisedBy.map((monitorId: string): Alert => {
        const value: Alert = new Alert();
        value.monitorId = new ObjectID(monitorId);
        return value;
      }),
      count: raisedBy.length,
      skip: 0,
      limit: 1000,
    };
  }) as never);
  getJestSpyOn(AlertStateUtil, "getUnresolvedAlertStates").mockResolvedValue(
    (() => {
      const state: AlertState = new AlertState();
      state._id = OPEN_STATE_ID;
      return [state];
    })(),
  );
  getJestSpyOn(
    IncidentStateUtil,
    "getUnresolvedIncidentStates",
  ).mockResolvedValue([new IncidentState()]);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderCard(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <ManagedDeviceCard managedDeviceId={new ObjectID(DEVICE_ID)} />
      </MemoryRouter>,
    );
  });
}

describe("a managed device's card", () => {
  test("lists its open alerts, the newest first, each a link to its page, with its severity and number", async () => {
    await renderCard();

    const section: HTMLElement = screen.getByTestId(
      "managed-device-active-alerts",
    );

    expect(within(section).getByText("Active alerts (2)")).toBeInTheDocument();

    const lowBattery: HTMLElement = within(section).getByText(
      "[Esper] Low battery - Device: ESP-ID-AAAAW",
    );
    expect(lowBattery.closest("a")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/alerts/${LOW_BATTERY_ID}`,
    );
    expect(
      within(section)
        .getByText("[Esper] Device stopped checking in - Device: ESP-ID-AAAAW")
        .closest("a"),
    ).toHaveAttribute("href", `/dashboard/${PROJECT_ID}/alerts/${STOPPED_ID}`);

    expect(within(section).getByText("ALT-42")).toBeInTheDocument();
    expect(within(section).getByText("Warning")).toHaveStyle({
      color: "#f59e0b",
    });
    // No incident is open: no incidents' heading.
    expect(screen.queryByTestId("managed-device-active-incidents")).toBeNull();
  });

  test("finds them by the names its readings carry, from its own connection's monitors only", async () => {
    await renderCard();

    const firstAlertRead: ListCall = listCalls.find((call: ListCall) => {
      return call.modelType === Alert;
    })!;
    const names: unknown = (firstAlertRead.query["seriesLabels"] as JSONObject)[
      "oneuptime.managed_device.name"
    ];

    expect((names as Includes).values).toEqual([
      "ESP-ID-AAAAW",
      "ESP-ID-AAAAW (R9KT30ABC12)",
    ]);

    // The open alerts' read names this connection's monitor alone.
    const openRead: ListCall = listCalls.find((call: ListCall) => {
      return (
        call.modelType === Alert && Boolean(call.query["currentAlertStateId"])
      );
    })!;

    expect(
      (openRead.query["monitorId"] as Includes).values.map((id: unknown) => {
        return String(id);
      }),
    ).toEqual([MONITOR_ID]);
    expect(
      (openRead.query["currentAlertStateId"] as Includes).values.map(
        (id: unknown) => {
          return String(id);
        },
      ),
    ).toEqual([OPEN_STATE_ID]);
  });

  test("says nothing of alerts while none is open", async () => {
    openAlerts = [];

    await renderCard();

    expect(screen.queryByTestId("managed-device-open-records")).toBeNull();
    // The rest of the card stands.
    expect(screen.getByText("Battery")).toBeInTheDocument();
  });

  test("says nothing of alerts while no monitor has raised one about it", async () => {
    raisedBy = [];

    await renderCard();

    expect(screen.queryByTestId("managed-device-open-records")).toBeNull();
    expect(
      listCalls.some((call: ListCall): boolean => {
        return call.modelType === Monitor;
      }),
    ).toBe(false);
  });

  test("an alert list that cannot be read lists nothing, and the card stands", async () => {
    getJestSpyOn(ModelAPI, "getList").mockRejectedValue(
      new Error("Network Error") as never,
    );

    await renderCard();

    expect(screen.queryByTestId("managed-device-open-records")).toBeNull();
    expect(screen.getByText("Battery")).toBeInTheDocument();
  });
});

describe("the item's Alerts and Incidents pages", () => {
  async function renderPage(kind: "alert" | "incident"): Promise<void> {
    await act(async () => {
      render(
        <MemoryRouter>
          <InventoryLinkedResource
            modelId={new ObjectID(ITEM_ID)}
            signal={kind === "alert" ? "alerts" : "incidents"}
            renderManagedDevice={(
              managedDeviceId: ObjectID,
            ): React.ReactElement => {
              return (
                <ManagedDeviceRecordsTable
                  managedDeviceId={managedDeviceId}
                  kind={kind}
                />
              );
            }}
          >
            {(_resource: LinkedResource): React.ReactElement => {
              return <div data-testid="host-records" />;
            }}
          </InventoryLinkedResource>
        </MemoryRouter>,
      );
    });
  }

  test("a device no Host stands for lists the alerts its connection's monitors raised about it", async () => {
    await renderPage("alert");

    expect(screen.queryByTestId("host-records")).toBeNull();
    expect(
      screen.queryByText("No alerts for this item", { exact: false }),
    ).toBeNull();

    const props: Record<string, unknown> =
      mockAlertsTableProps[mockAlertsTableProps.length - 1]!;
    const query: JSONObject = props["query"] as JSONObject;

    expect(String(query["projectId"])).toBe(PROJECT_ID);
    expect(
      (
        (query["seriesLabels"] as JSONObject)[
          "oneuptime.managed_device.name"
        ] as Includes
      ).values,
    ).toEqual(["ESP-ID-AAAAW", "ESP-ID-AAAAW (R9KT30ABC12)"]);
    expect(
      (query["monitorId"] as Includes).values.map((id: unknown) => {
        return String(id);
      }),
    ).toEqual([MONITOR_ID]);
    // A record made by hand would not be about the device.
    expect(props["disableCreate"]).toBe(true);
  });

  test("with none raised yet, its list says how to get them: its connection's Set up alerts", async () => {
    raisedBy = [];
    const navigate: jest.SpyInstance<any, any> = getJestSpyOn(
      Navigation,
      "navigate",
    ).mockImplementation(() => {});

    await renderPage("alert");

    const props: Record<string, unknown> =
      mockAlertsTableProps[mockAlertsTableProps.length - 1]!;
    const query: JSONObject = props["query"] as JSONObject;

    // A query no alert matches, not every alert of the project.
    expect(
      (query["monitorId"] as Includes).values.map((id: unknown) => {
        return String(id);
      }),
    ).toEqual([ObjectID.getZeroObjectID().toString()]);

    const emptyState: EmptyStateOptions = props[
      "emptyState"
    ] as EmptyStateOptions;

    expect(emptyState.hideCreateButton).toBe(true);
    expect(String(emptyState.description)).toContain("stops checking in");
    expect(emptyState.actions![0]!.title).toBe("Set up alerts");

    emptyState.actions![0]!.onClick();

    expect(String(navigate.mock.calls[0]![0])).toBe(
      `/dashboard/${PROJECT_ID}/inventory/managed-devices/${CONNECTION_ID}/recommendations`,
    );
  });

  test("its Incidents page lists the incidents of the same scope, for a monitor made to raise incidents", async () => {
    await renderPage("incident");

    const props: Record<string, unknown> =
      mockIncidentsTableProps[mockIncidentsTableProps.length - 1]!;
    const query: JSONObject = props["query"] as JSONObject;

    expect(query["seriesLabels"]).toBeDefined();
    // None raised: the query names no incident.
    expect(
      (query["monitors"] as Includes).values.map((id: unknown) => {
        return String(id);
      }),
    ).toEqual([ObjectID.getZeroObjectID().toString()]);
    expect(props["disableCreate"]).toBe(true);
  });
});

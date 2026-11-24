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
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import { goTo } from "./SideMenuHarness";

/*
 * A DISCONNECTED IOT FLEET BLAMES NO DEVICE, ON ANY PAGE (#10014).
 *
 * #9730 decided what a fleet's Overview says while the fleet's own
 * connection is down: its counts say "fleet disconnected" and list no device
 * as offline. Its other pages still blamed every device - each row of the
 * Devices list and a device's own page read a red "Offline" from the
 * device's last state, which is from before the fleet stopped. A reader who
 * landed there from a search, a bookmark or an alert saw a wall of red that
 * pointed at the devices, when the thing to fix was the fleet's collector.
 *
 * Rendered for real - the Devices list with its real table, a device's
 * page, the fleet's side menu and the Fleets list's count - with only the
 * network replaced, while the fleet is connected, while it is disconnected,
 * and once it reports again.
 */

const FLEET_ID: string = "0193c0de-7777-4aaa-8bbb-000000010014";
const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const MINUTE: number = 60 * 1000;

const modelGetItemMock: MockFunction = getJestMockFunction();
const modelGetListMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return modelGetItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return modelGetListMock(...args);
      },
      count: (): Promise<number> => {
        return Promise.resolve(0);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

/*
 * The fleet's page frame, down to what this suite reads: its side menu, and
 * the page under it.
 */
jest.mock("../../../UI/Components/Page/ModelPage", () => {
  return {
    __esModule: true,
    default: (props: {
      sideMenu?: React.ReactNode;
      children?: React.ReactNode;
    }) => {
      return (
        <div data-testid="model-page">
          <nav data-testid="model-page-side-menu">{props.sideMenu}</nav>
          {props.children}
        </div>
      );
    },
  };
});

// A master admin reads every list, so the real table draws its rows.
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
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceMetricsTab",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="resource-metrics-tab" />;
      },
    };
  },
);

// No unresolved states: the side menu's Activity badges never reach for a count.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/IncidentState",
  () => {
    return {
      __esModule: true,
      default: {
        getUnresolvedIncidentStates: () => {
          return Promise.resolve([]);
        },
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/AlertState", () => {
  return {
    __esModule: true,
    default: {
      getUnresolvedAlertStates: () => {
        return Promise.resolve([]);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/ScheduledMaintenanceState",
  () => {
    return {
      __esModule: true,
      default: {
        getActiveScheduledMaintenanceStates: () => {
          return Promise.resolve([]);
        },
      },
    };
  },
);

import IoTFleetDevices from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/View/Devices";
import IoTFleetDeviceDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/View/DeviceDetail";
import IoTFleetSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/View/SideMenu";
import IoTFleetViewLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/View/Layout";
import IoTDeviceStatus from "../../../../App/FeatureSet/Dashboard/src/Components/IoT/IoTDeviceStatus";
import {
  IOT_DEVICE_FLEET_DISCONNECTED,
  IOT_DEVICE_FLEET_DISCONNECTED_TOOLTIP,
  IOT_DEVICE_LAST_REPORTED_OFFLINE,
  IOT_DEVICE_LAST_REPORTED_ONLINE,
  IOT_DEVICE_OFFLINE,
  IOT_DEVICE_ONLINE,
  IoTDeviceStatusReading,
  getIoTDeviceStatus,
  getIoTFleetDeviceCount,
  isIoTFleetConnected,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/Utils/IoTFleetConnection";
import { IOT_METRIC_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/IoTMetricDescriptions";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import { MemoryRouter, Route as PageRoute, Routes } from "react-router-dom";
import { NO_BREAK_SPACE } from "../../../Types/NoBreakSpaces";
import { PillTone } from "../../../UI/Components/Pill/PillTone";
import Navigation from "../../../UI/Utils/Navigation";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

// ---------------------------------------------------------------- fixtures

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE);
}

type Row = Record<string, unknown>;

// The collector went away three hours ago.
const FLEET_LAST_SEEN: Date = minutesAgo(180);

function fleet(status: string): Row {
  return {
    _id: FLEET_ID,
    name: "field-sensors",
    otelCollectorStatus: status,
    lastSeenAt: FLEET_LAST_SEEN,
    deviceCount: 3,
    onlineDeviceCount: 1,
  };
}

/*
 * The inventory as the fleet's last snapshot left it: one device online,
 * one offline (it was already down before the collector went away), and
 * one that never sent a heartbeat.
 */
const PUMP: Row = {
  kind: "Device",
  externalId: "dev-pump",
  name: "Pump A",
  isUp: true,
  latestBatteryPercent: 82,
  latestSignalStrengthDbm: -61,
  latestTemperatureCelsius: 21.4,
  metricsUpdatedAt: minutesAgo(181),
  lastSeenAt: minutesAgo(181),
};

const GATE: Row = {
  kind: "Device",
  externalId: "dev-gate",
  name: "Gate B",
  deviceType: "gate-controller",
  isUp: false,
  latestBatteryPercent: 15,
  metricsUpdatedAt: minutesAgo(300),
  lastSeenAt: minutesAgo(300),
};

const PROBE: Row = {
  kind: "Sensor",
  externalId: "dev-probe",
  name: "Probe C",
  isUp: null,
  lastSeenAt: minutesAgo(200),
};

const INVENTORY: Array<Row> = [PUMP, GATE, PROBE];

let fleetStatus: string = "connected";
let navigated: Array<string> = [];
let lastParam: string = "dev-pump";

function arrange(): void {
  modelGetItemMock.mockImplementation(async () => {
    return fleet(fleetStatus);
  });

  modelGetListMock.mockImplementation(async (args: unknown) => {
    const query: Record<string, unknown> =
      (args as { query?: Record<string, unknown> }).query || {};
    const rows: Array<Row> = query["externalId"]
      ? INVENTORY.filter((row: Row): boolean => {
          return row["externalId"] === query["externalId"];
        })
      : INVENTORY;
    return { data: rows, count: rows.length, skip: 0, limit: 10 };
  });
}

async function flush(): Promise<void> {
  for (let i: number = 0; i < 10; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const OVERVIEW_ROUTE: string = RouteUtil.populateRouteParams(
  RouteMap[PageMap.IOT_FLEET_VIEW] as Route,
  { modelId: new ObjectID(FLEET_ID) },
).toString();

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  fleetStatus = "connected";
  navigated = [];
  lastParam = "dev-pump";
  modelGetItemMock.mockReset();
  modelGetListMock.mockReset();
  arrange();

  getJestSpyOn(Navigation, "getLastParamAsObjectID").mockImplementation(
    (): ObjectID => {
      return new ObjectID(FLEET_ID);
    },
  );
  getJestSpyOn(Navigation, "getLastParamAsString").mockImplementation(
    (): string => {
      return lastParam;
    },
  );
  getJestSpyOn(Navigation, "navigate").mockImplementation(
    (to: unknown): void => {
      navigated.push(String(to));
    },
  );
  try {
    window.localStorage.clear();
  } catch {
    // Storage is optional for these pages.
  }
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

// ------------------------------------------------------------ the rules

describe("a device's state, by its fleet's connection", () => {
  test("a fleet reports while its collector is connected", () => {
    expect(isIoTFleetConnected("connected")).toBe(true);
    expect(isIoTFleetConnected("active")).toBe(true);
    expect(isIoTFleetConnected("disconnected")).toBe(false);
    expect(isIoTFleetConnected(undefined)).toBe(false);
  });

  test("while the fleet reports: Online in green, Offline in red", () => {
    expect(getIoTDeviceStatus({ isUp: true, isFleetConnected: true })).toEqual({
      label: IOT_DEVICE_ONLINE,
      tone: PillTone.Success,
    });
    expect(getIoTDeviceStatus({ isUp: false, isFleetConnected: true })).toEqual(
      { label: IOT_DEVICE_OFFLINE, tone: PillTone.Danger },
    );
  });

  test("while it does not: the fleet is disconnected, in grey, with what the device last reported and when", () => {
    const at: Date = minutesAgo(181);

    expect(
      getIoTDeviceStatus({
        isUp: true,
        isFleetConnected: false,
        lastSeenAt: at,
      }),
    ).toEqual({
      label: IOT_DEVICE_FLEET_DISCONNECTED,
      tone: PillTone.Neutral,
      tooltip: IOT_DEVICE_FLEET_DISCONNECTED_TOOLTIP,
      lastReport: { template: IOT_DEVICE_LAST_REPORTED_ONLINE, at: at },
    });

    // An offline device is not blamed either: it says what it last reported.
    const offline: IoTDeviceStatusReading | null = getIoTDeviceStatus({
      isUp: false,
      isFleetConnected: false,
      // As the API hands it: a string.
      lastSeenAt: at.toISOString(),
    });
    expect(offline?.label).toBe(IOT_DEVICE_FLEET_DISCONNECTED);
    expect(offline?.tone).toBe(PillTone.Neutral);
    expect(offline?.lastReport).toEqual({
      template: IOT_DEVICE_LAST_REPORTED_OFFLINE,
      at: at,
    });
  });

  test("a disconnected fleet's device with no report time says so without a date", () => {
    const reading: IoTDeviceStatusReading | null = getIoTDeviceStatus({
      isUp: false,
      isFleetConnected: false,
      lastSeenAt: "not a date",
    });
    expect(reading?.label).toBe(IOT_DEVICE_FLEET_DISCONNECTED);
    expect(reading?.lastReport).toBeUndefined();
  });

  test("before its first heartbeat a device has no state, connected or not", () => {
    for (const isFleetConnected of [true, false]) {
      expect(getIoTDeviceStatus({ isUp: null, isFleetConnected })).toBeNull();
      expect(
        getIoTDeviceStatus({ isUp: undefined, isFleetConnected }),
      ).toBeNull();
    }
  });

  test("the Fleets list counts the devices online while the fleet reports, and the devices it has while it does not", () => {
    expect(
      getIoTFleetDeviceCount({ total: 5, online: 4, isFleetConnected: true }),
    ).toEqual({ isOnlineCount: true, isRed: true });
    expect(
      getIoTFleetDeviceCount({ total: 5, online: 5, isFleetConnected: true }),
    ).toEqual({ isOnlineCount: true, isRed: false });
    // Every device read offline when the collector went: none is blamed.
    expect(
      getIoTFleetDeviceCount({ total: 5, online: 0, isFleetConnected: false }),
    ).toEqual({ isOnlineCount: false, isRed: false });
  });

  test("the words say what the pages do", () => {
    expect(IOT_METRIC_DESCRIPTIONS.statusColumn).toMatch(
      /While the fleet is disconnected, each device says so instead, with the state it last reported\./,
    );
    expect(IOT_METRIC_DESCRIPTIONS.deviceStatus).toMatch(
      /While its fleet is disconnected, it says so instead, with the state the device last reported and when\./,
    );
    expect(IOT_METRIC_DESCRIPTIONS.fleetDevices).toMatch(
      /While the fleet is disconnected, it counts the devices the fleet has: which of them are online is not known\./,
    );
  });
});

describe("IoTDeviceStatus, drawn", () => {
  test("disconnected, it says the fleet is, and what the device last reported, the moment itself under the pointer", () => {
    render(
      <IoTDeviceStatus
        isUp={false}
        isFleetConnected={false}
        lastSeenAt={minutesAgo(180)}
        testId="status"
        now={NOW}
      />,
    );

    expect(screen.getByText("Fleet disconnected")).toBeVisible();
    expect(screen.queryByText("Offline")).not.toBeInTheDocument();
    const lastReport: HTMLElement = screen.getByTestId("status-last-report");
    // The figure held to its word (#8669), the sentence whole.
    expect(lastReport.textContent).toBe(
      `Last reported offline 3${NO_BREAK_SPACE}hours ago`,
    );
    expect(lastReport.getAttribute("title")).toBeTruthy();
  });

  test("before its first heartbeat, the quiet dash", () => {
    render(<IoTDeviceStatus isUp={null} isFleetConnected={false} />);

    expect(screen.queryByText("Fleet disconnected")).not.toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

// ------------------------------------------------------------ the list

function row(name: string): HTMLElement {
  const cell: HTMLElement = screen.getAllByText(name)[0]!;
  return (cell.closest("tr") ||
    cell.closest("[data-testid*='row']") ||
    cell.closest("li")) as HTMLElement;
}

function pillTones(): Array<string> {
  return Array.from(document.querySelectorAll("[data-ou-pill]")).map(
    (pill: Element): string => {
      return `${pill.textContent?.trim()}:${pill.getAttribute("data-tone")}`;
    },
  );
}

async function renderDevices(): Promise<void> {
  render(<IoTFleetDevices {...PAGE_PROPS} />);
  await flush();
  await waitFor(() => {
    expect(screen.getAllByText("Pump A").length).toBeGreaterThan(0);
  });
}

describe("the Devices list", () => {
  test("while the fleet reports: each device's own state, Online in green and Offline in red, and no notice", async () => {
    await renderDevices();

    expect(screen.queryByTestId("iot-devices-fleet-disconnected")).toBeNull();
    expect(within(row("Pump A")).getByText("Online")).toBeVisible();
    expect(within(row("Gate B")).getByText("Offline")).toBeVisible();
    expect(pillTones()).toEqual(
      expect.arrayContaining(["Online:success", "Offline:danger"]),
    );
    expect(screen.queryByText("Fleet disconnected")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Last reported/)).not.toBeInTheDocument();
  });

  test("while the fleet is disconnected: one notice says so, and no row is a red Offline", async () => {
    fleetStatus = "disconnected";
    await renderDevices();

    const notice: HTMLElement = screen.getByTestId(
      "iot-devices-fleet-disconnected",
    );
    expect(notice).toHaveTextContent(
      "This fleet is disconnected, so no device's state is current. Each device shows the state it last reported.",
    );
    expect(notice).toHaveTextContent("See what to check");

    expect(screen.queryByText("Offline")).not.toBeInTheDocument();
    expect(screen.queryByText("Online")).not.toBeInTheDocument();
    for (const tone of pillTones()) {
      expect(tone).not.toMatch(/:danger$/);
    }
  });

  test("each device says the fleet is disconnected, in grey, with the state it last reported and when", async () => {
    fleetStatus = "disconnected";
    await renderDevices();

    const pump: HTMLElement = row("Pump A");
    expect(within(pump).getByText("Fleet disconnected")).toBeVisible();
    expect(
      within(pump).getByTestId("iot-device-status-dev-pump-last-report")
        .textContent,
    ).toBe(`Last reported online 3${NO_BREAK_SPACE}hours ago`);

    // Down before the collector went: what it said then, dated - not "Offline".
    const gate: HTMLElement = row("Gate B");
    expect(within(gate).getByText("Fleet disconnected")).toBeVisible();
    expect(
      within(gate).getByTestId("iot-device-status-dev-gate-last-report")
        .textContent,
    ).toBe(`Last reported offline 5${NO_BREAK_SPACE}hours ago`);

    expect(pillTones()).toEqual(
      expect.arrayContaining([
        "Fleet disconnected:neutral",
        "Fleet disconnected:neutral",
      ]),
    );
  });

  test("its last-known details stay: battery, signal and temperature as last sent", async () => {
    fleetStatus = "disconnected";
    await renderDevices();

    const pump: HTMLElement = row("Pump A");
    expect(within(pump).getByText("82.0%")).toBeInTheDocument();
    expect(within(pump).getByText("-61 dBm")).toBeInTheDocument();
    expect(within(pump).getByText("21.4 °C")).toBeInTheDocument();
  });

  test("a device that never sent a heartbeat has the quiet dash either way", async () => {
    fleetStatus = "disconnected";
    await renderDevices();

    const probe: HTMLElement = row("Probe C");
    expect(within(probe).queryByText("Fleet disconnected")).toBeNull();
    expect(
      within(probe).queryByTestId("iot-device-status-dev-probe"),
    ).toBeNull();
    // Its Status, like its other readings, is the quiet dash.
    expect(within(probe).getAllByText("—").length).toBeGreaterThan(0);
  });

  test("the notice leads to the fleet's Overview, where its connection card says what to check", async () => {
    fleetStatus = "disconnected";
    await renderDevices();

    fireEvent.click(screen.getByTestId("iot-devices-fleet-disconnected"));

    expect(navigated).toEqual([OVERVIEW_ROUTE]);
  });

  test("it reads the fleet's connection before it draws a single state", async () => {
    fleetStatus = "disconnected";
    let answer: (value: Row) => void = (): void => {};
    modelGetItemMock.mockImplementation(() => {
      return new Promise<Row>((resolve: (value: Row) => void) => {
        answer = resolve;
      });
    });

    render(<IoTFleetDevices {...PAGE_PROPS} />);
    await flush();

    // No row - and so no red Offline - while it does not know.
    expect(screen.queryByText("Pump A")).not.toBeInTheDocument();
    expect(screen.queryByText("Offline")).not.toBeInTheDocument();

    await act(async () => {
      answer(fleet("disconnected"));
    });
    await flush();
    await waitFor(() => {
      expect(screen.getAllByText("Pump A").length).toBeGreaterThan(0);
    });
    expect(screen.queryByText("Offline")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("iot-devices-fleet-disconnected"),
    ).toBeInTheDocument();
  });

  test("a fleet that could not be read says why and reads it again, drawing no state it cannot vouch for", async () => {
    modelGetItemMock.mockImplementationOnce(async () => {
      throw new Error("Request failed.");
    });

    render(<IoTFleetDevices {...PAGE_PROPS} />);
    await flush();

    // No list until the fleet's connection is known.
    expect(screen.queryByText("Pump A")).not.toBeInTheDocument();
    expect(modelGetListMock).not.toHaveBeenCalled();
    const retry: HTMLElement = screen.getByRole("button", {
      name: /Try again|Refresh/,
    });

    fireEvent.click(retry);
    await flush();
    await waitFor(() => {
      expect(screen.getAllByText("Pump A").length).toBeGreaterThan(0);
    });
    expect(modelGetItemMock).toHaveBeenCalledTimes(2);
  });

  test("once the fleet reports again, the states are the devices' own again", async () => {
    fleetStatus = "disconnected";
    await renderDevices();
    expect(screen.getAllByText("Fleet disconnected").length).toBe(2);
    cleanup();

    fleetStatus = "connected";
    await renderDevices();

    expect(screen.queryByText("Fleet disconnected")).not.toBeInTheDocument();
    expect(within(row("Gate B")).getByText("Offline")).toBeVisible();
  });
});

// ------------------------------------------------------- a device's page

async function renderDevicePage(externalId: string): Promise<void> {
  lastParam = externalId;
  render(<IoTFleetDeviceDetail {...PAGE_PROPS} />);
  await flush();
  await screen.findByText("External ID");
}

describe("a device's page", () => {
  test("while the fleet reports: the device's own state and no notice", async () => {
    await renderDevicePage("dev-gate");

    expect(screen.queryByTestId("iot-device-fleet-disconnected")).toBeNull();
    expect(screen.getByText("Offline")).toBeVisible();
    expect(screen.queryByText("Fleet disconnected")).not.toBeInTheDocument();
  });

  test("while the fleet is disconnected: it opens on a notice, and its Status says the fleet is, with what it last reported", async () => {
    fleetStatus = "disconnected";
    await renderDevicePage("dev-gate");

    const notice: HTMLElement = screen.getByTestId(
      "iot-device-fleet-disconnected",
    );
    expect(notice).toHaveTextContent(
      "This device's fleet is disconnected, so its state is not current. This page shows what it last reported.",
    );

    const status: HTMLElement = screen.getByTestId("iot-device-detail-status");
    expect(within(status).getByText("Fleet disconnected")).toBeVisible();
    expect(
      screen.getByTestId("iot-device-detail-status-last-report").textContent,
    ).toBe(`Last reported offline 5${NO_BREAK_SPACE}hours ago`);
    expect(screen.queryByText("Offline")).not.toBeInTheDocument();
  });

  test("its details stay, as it last sent them", async () => {
    fleetStatus = "disconnected";
    await renderDevicePage("dev-gate");

    expect(screen.getByText("gate-controller")).toBeInTheDocument();
    expect(screen.getByText("15.0%")).toBeInTheDocument();
    expect(screen.getByText("Last Seen")).toBeInTheDocument();
  });

  test("its notice leads to the fleet's Overview", async () => {
    fleetStatus = "disconnected";
    await renderDevicePage("dev-pump");

    fireEvent.click(screen.getByTestId("iot-device-fleet-disconnected"));

    expect(navigated).toEqual([OVERVIEW_ROUTE]);
  });

  test("an online device of a disconnected fleet is no green Online either", async () => {
    fleetStatus = "disconnected";
    await renderDevicePage("dev-pump");

    expect(screen.queryByText("Online")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("iot-device-detail-status-last-report").textContent,
    ).toBe(`Last reported online 3${NO_BREAK_SPACE}hours ago`);
  });

  test("the page reads the fleet's connection with its name", async () => {
    await renderDevicePage("dev-pump");

    const select: Record<string, unknown> = (
      modelGetItemMock.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;
    expect(select).toEqual({ name: true, otelCollectorStatus: true });
  });
});

// ------------------------------------------------------- the side menu

describe("the fleet's side menu", () => {
  function devicesEntry(): HTMLElement {
    const link: HTMLElement | undefined = Array.from(
      document.querySelectorAll("a"),
    ).find((anchor: HTMLAnchorElement): boolean => {
      return Boolean(
        anchor.textContent?.includes("Devices") === true &&
          !anchor.textContent.includes("Registry"),
      );
    }) as HTMLElement | undefined;
    expect(link).toBeDefined();
    return link!;
  }

  /*
   * The fleet's layout reads its counts from the inventory summary and
   * draws the menu with them. Connected with 1 of 3 devices online, or
   * disconnected with every device's last state offline, the menu counts
   * the fleet's 3 devices, in grey: it never blames one.
   */
  test.each([
    ["connected", { deviceCount: 3, onlineDeviceCount: 1 }],
    ["disconnected", { deviceCount: 3, onlineDeviceCount: 0 }],
  ])(
    "while the fleet is %s, Devices counts every device in grey, and says so to a screen reader",
    async (
      state: string,
      summary: { deviceCount: number; onlineDeviceCount: number },
    ) => {
      fleetStatus = state;
      const post: jest.SpyInstance = getJestSpyOn(
        API,
        "post",
      ).mockImplementation(async (): Promise<HTTPResponse<JSONObject>> => {
        return new HTTPResponse<JSONObject>(
          200,
          { ...summary, countsByKind: { Device: summary.deviceCount } },
          {},
        );
      });

      const path: string = `/iot/${FLEET_ID}`;
      // Where the breadcrumbs read the page from; the router serves it.
      goTo(OVERVIEW_ROUTE);
      render(
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <PageRoute
              path="/iot/:id"
              element={<IoTFleetViewLayout {...PAGE_PROPS} />}
            />
          </Routes>
        </MemoryRouter>,
      );
      await flush();

      // The one read the menu's counts come from.
      expect(
        String((post.mock.calls[0]![0] as { url: unknown }).url),
      ).toContain(`/iot-device/inventory-summary/${FLEET_ID}`);

      const entry: HTMLElement = devicesEntry();
      const badge: HTMLElement | null = entry.querySelector("[data-ou-pill]");
      expect(badge).toHaveTextContent("3");
      expect(badge?.getAttribute("data-tone")).toBe(PillTone.Neutral);
      expect(within(entry).getByText("3 devices")).toHaveClass("sr-only");
      // No red count anywhere in the fleet's menu.
      for (const pill of Array.from(
        document.querySelectorAll("[data-ou-pill]"),
      )) {
        expect(pill.getAttribute("data-tone")).not.toBe(PillTone.Danger);
      }
    },
  );

  test("a fleet with no devices has no badge, and nothing for a screen reader to hear", async () => {
    render(
      <IoTFleetSideMenu
        modelId={new ObjectID(FLEET_ID)}
        resourceCounts={{ devices: 0 }}
      />,
    );
    await flush();

    expect(devicesEntry().querySelector("[data-ou-pill]")).toBeNull();
    expect(
      screen.queryByText(/devices?$/, { selector: ".sr-only" }),
    ).toBeNull();
  });
});

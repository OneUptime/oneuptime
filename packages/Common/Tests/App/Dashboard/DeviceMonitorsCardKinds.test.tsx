import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import DeviceMonitorsCard, {
  getDeviceWebUiMonitorRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceMonitorsCard";
import Navigation from "../../../UI/Utils/Navigation";
import {
  DEVICE_MONITOR_CHECK_QUERY_PARAM,
  DeviceMonitorCheck,
} from "../../../Utils/NetworkDevice/DeviceWebUiUtil";

/*
 * A device's "Monitors alerting on this device" card, RENDERED, with the
 * kinds of monitor it lists since OneUptime issue #5145: a Network Device
 * monitor that reads the device's polls, and the Ping monitor a discovery
 * import made for the device from a Ping template. The card's own words
 * have to fit every row under them - "Network Device monitors that evaluate
 * this device's polls and traps" sat above a Ping monitor that does
 * neither.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const DEVICE_ID: string = "40000000-0000-4000-8000-000000000001";

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        return mockProjectObjectId;
      },
    },
  };
});

// Handed out by the Project mock; below the imports so ObjectID exists.
const mockProjectObjectId: ObjectID = new ObjectID(PROJECT_ID);

function monitor(data: {
  id: string;
  name: string;
  monitorType: MonitorType;
  madeForDevice?: boolean;
}): Monitor {
  const item: Monitor = new Monitor();
  item._id = data.id;
  item.name = data.name;
  item.monitorType = data.monitorType;

  if (data.madeForDevice) {
    item.autoProvisionedNetworkDeviceId = new ObjectID(DEVICE_ID);
  }

  return item;
}

const NETWORK_DEVICE_MONITOR: Monitor = monitor({
  id: "90000000-0000-4000-8000-000000000001",
  name: "WB0024KDS03 - Network device alert pack",
  monitorType: MonitorType.NetworkDevice,
});

const PING_MONITOR_FROM_IMPORT: Monitor = monitor({
  id: "90000000-0000-4000-8000-000000000002",
  name: "WB0024KDS03 - WB KDS Ping Monitor Template",
  monitorType: MonitorType.Ping,
  madeForDevice: true,
});

function renderCard(data: {
  monitors: Array<Monitor>;
  isMonitorBacked: boolean;
}): void {
  render(
    <MemoryRouter>
      <DeviceMonitorsCard
        monitors={data.monitors}
        isLoading={false}
        error=""
        networkDeviceId={DEVICE_ID}
        isMonitorBacked={data.isMonitorBacked}
      />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe("the device monitors card says what every monitor it lists does", () => {
  test("a probe-polled device: its Network Device monitor and the Ping monitor an import made for it, under words that fit both", () => {
    renderCard({
      monitors: [NETWORK_DEVICE_MONITOR, PING_MONITOR_FROM_IMPORT],
      isMonitorBacked: false,
    });

    expect(screen.getByText("Monitors alerting on this device")).toBeVisible();
    expect(
      screen.getByText(
        "Monitors that check this device and open incidents or alerts.",
      ),
    ).toBeVisible();
    expect(screen.getByText(NETWORK_DEVICE_MONITOR.name!)).toBeVisible();
    expect(screen.getByText(PING_MONITOR_FROM_IMPORT.name!)).toBeVisible();

    // The words that described Network Device monitors alone are gone.
    expect(document.body).not.toHaveTextContent(
      "Network Device monitors that evaluate this device's polls and traps",
    );
  });

  test("a device whose status comes from a bound monitor: the bound one decides, the others listed check it too", () => {
    renderCard({
      monitors: [
        monitor({
          id: "90000000-0000-4000-8000-000000000003",
          name: "lobby-camera ping",
          monitorType: MonitorType.Ping,
        }),
        monitor({
          id: "90000000-0000-4000-8000-000000000004",
          name: "lobby-camera - Receipt printers",
          monitorType: MonitorType.Port,
          madeForDevice: true,
        }),
      ],
      isMonitorBacked: true,
    });

    expect(screen.getByText("Monitors reporting on this device")).toBeVisible();
    expect(
      screen.getByText(
        "The monitor bound to this device decides its status; any other monitors here check it too.",
      ),
    ).toBeVisible();
    expect(screen.getByText("lobby-camera - Receipt printers")).toBeVisible();
    expect(document.body).not.toHaveTextContent(
      "plus any Network Device monitors that reference it",
    );
  });

  test("with nothing listed, the card keeps its words and its way forward", () => {
    renderCard({ monitors: [], isMonitorBacked: false });

    expect(
      screen.getByText(
        "Monitors that check this device and open incidents or alerts.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(/^Nothing alerts on this device yet\./),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Set up alerts" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Create Monitor" }),
    ).toBeVisible();
  });
});

/*
 * "Monitor web UI" (#5281, the follow-up of #5145's device web UI
 * templates): in the card's header, with monitors listed or none, it opens
 * Create Monitor on a Website monitor of the device's management page.
 */
describe("Monitor web UI", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the device's link asks Create Monitor for its web UI check", () => {
    const route: string = getDeviceWebUiMonitorRoute(DEVICE_ID).toString();
    const query: URLSearchParams = new URLSearchParams(
      route.slice(route.indexOf("?")),
    );

    expect(route.startsWith(`/dashboard/${PROJECT_ID}/monitors/create?`)).toBe(
      true,
    );
    expect(query.get("networkDeviceId")).toBe(DEVICE_ID);
    expect(query.get(DEVICE_MONITOR_CHECK_QUERY_PARAM)).toBe(
      DeviceMonitorCheck.WebUi,
    );
  });

  test.each([
    ["with monitors listed", [NETWORK_DEVICE_MONITOR]],
    ["with none", []],
  ])(
    "sits in the card's header %s, and opens Create Monitor on it",
    (_name: string, monitors: Array<Monitor>) => {
      const navigate: ReturnType<typeof jest.spyOn> = jest
        .spyOn(Navigation, "navigate")
        .mockImplementation((): void => {
          return undefined;
        });

      renderCard({ monitors: monitors, isMonitorBacked: false });

      const actions: HTMLElement = screen.getByTestId("card-header-actions");
      const button: HTMLElement = within(actions).getByRole("button", {
        name: "Monitor web UI",
      });

      fireEvent.click(button);

      expect(navigate).toHaveBeenCalledTimes(1);
      expect(String((navigate.mock.calls[0] as Array<unknown>)[0])).toBe(
        getDeviceWebUiMonitorRoute(DEVICE_ID).toString(),
      );
    },
  );

  test("a device whose status a bound monitor decides is offered it too", () => {
    renderCard({ monitors: [], isMonitorBacked: true });

    expect(
      screen.getByRole("button", { name: "Monitor web UI" }),
    ).toBeVisible();
    // The way out of no bound monitor stays the empty state's.
    expect(
      screen.getByRole("button", { name: "Create Ping Monitor" }),
    ).toBeVisible();
  });

  test("a card that names no device offers nothing to monitor", () => {
    render(
      <MemoryRouter>
        <DeviceMonitorsCard monitors={[]} isLoading={false} error="" />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("button", { name: "Monitor web UI" }),
    ).toBeNull();
  });

  test("the device's web UI monitor is listed with the others", () => {
    renderCard({
      monitors: [
        NETWORK_DEVICE_MONITOR,
        monitor({
          id: "90000000-0000-4000-8000-000000000005",
          name: "WB0024KDS03 web UI",
          monitorType: MonitorType.Website,
        }),
      ],
      isMonitorBacked: false,
    });

    expect(screen.getByText("WB0024KDS03 web UI")).toBeVisible();
  });
});

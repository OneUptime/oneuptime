import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import DeviceMonitorsCard from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceMonitorsCard";

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

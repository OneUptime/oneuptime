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

/*
 * The Transceivers card on a network device's Interfaces page, RENDERED.
 * The device row comes from a ModelAPI stub, so each case is one device:
 * optics present and judged, an optic pulled, a port shut, a direct-attach
 * cable with nothing to read - and a device that reports no optics at all,
 * which keeps the page exactly as it was.
 */

let deviceRow: unknown = null;
let failWith: Error | null = null;
let getItemSelects: Array<Record<string, unknown> | undefined> = [];

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (request: {
        select?: Record<string, unknown> | undefined;
      }): Promise<unknown> => {
        getItemSelects.push(request.select);

        if (failWith) {
          return Promise.reject(failWith);
        }

        return Promise.resolve(deviceRow);
      },
    },
  };
});

import TransceiverHealthCard from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/TransceiverHealthCard";
import {
  NetworkDeviceTransceiver,
  TransceiverFault,
  TransceiverHealth,
  TransceiverMibSource,
  TransceiverThresholds,
} from "../../../Types/Monitor/SnmpMonitor/SnmpTransceiver";
import ObjectID from "../../../Types/ObjectID";

const DEVICE_ID: ObjectID = new ObjectID(
  "0193c0de-7777-4aaa-8bbb-000000000042",
);

const LR_RX: TransceiverThresholds = {
  lowAlarm: -18.4,
  lowWarning: -14.4,
  highWarning: 0.5,
  highAlarm: 2.5,
};

const RECENTLY: string = new Date(Date.now() - 5 * 60 * 1000).toISOString();
const HALF_AN_HOUR_AGO: string = new Date(
  Date.now() - 30 * 60 * 1000,
).toISOString();
const AN_HOUR_AGO: string = new Date(Date.now() - 60 * 60 * 1000).toISOString();

// Healthy, but 2.5 dB below its best day of the month.
const FADING: NetworkDeviceTransceiver = {
  interfaceIndex: 1,
  interfaceName: "Te1/1/1",
  interfaceAlias: "Uplink to core",
  isPresent: true,
  vendor: "FLEXOPTIX",
  partNumber: "P.1396.10",
  serialNumber: "F7A2B91",
  type: "SFP+ 10GBASE-LR",
  wavelengthNm: 1310,
  source: TransceiverMibSource.CiscoEntitySensor,
  measurements: {
    rxPower: { readings: [{ value: -6.3 }], thresholds: LR_RX },
    txPower: {
      readings: [{ value: -2.1 }],
      thresholds: { lowAlarm: -8.2, highAlarm: 3.5 },
    },
    temperature: {
      readings: [{ value: 38.5 }],
      thresholds: { highWarning: 70, highAlarm: 75 },
    },
    voltage: { readings: [{ value: 3.29 }] },
    biasCurrent: { readings: [{ value: 6.2 }] },
  },
  health: TransceiverHealth.Healthy,
  firstSeenAt: "2026-08-01T00:00:00.000Z",
  lastSeenAt: RECENTLY,
  rxPowerHistory: {
    firstDay: "2026-09-14",
    dailyAverageDbm: [-3.8, -3.9, -4.4, -5.1, -5.8, -6.3],
    lastDaySamples: 40,
  },
};

const PULLED: NetworkDeviceTransceiver = {
  interfaceIndex: 2,
  interfaceName: "Te1/1/2",
  isPresent: false,
  vendor: "FS",
  partNumber: "SFP-10GSR-85",
  serialNumber: "C2203041",
  measurements: {},
  health: TransceiverHealth.NotDetected,
  missingSince: HALF_AN_HOUR_AGO,
  missingPolls: 4,
  lastSeenAt: AN_HOUR_AGO,
};

// A QSFP with one lane gone dark-ish, past its low alarm.
const FAILING_LANE: NetworkDeviceTransceiver = {
  interfaceIndex: 49,
  interfaceName: "Et49/1",
  isPresent: true,
  vendor: "Carritech",
  partNumber: "QSFP-40G-LR4",
  measurements: {
    rxPower: {
      readings: [
        { value: -2.1, lane: 1 },
        { value: -2.4, lane: 2 },
        { value: -19.6, lane: 3 },
        { value: -2.0, lane: 4 },
      ],
      thresholds: LR_RX,
    },
  },
  health: TransceiverHealth.Alarm,
  lastSeenAt: RECENTLY,
};

const SHUT_PORT: NetworkDeviceTransceiver = {
  interfaceIndex: 5,
  interfaceName: "Te1/1/5",
  isPresent: true,
  vendor: "FS",
  measurements: {
    txPower: {
      readings: [{ value: -40 }],
      thresholds: { lowAlarm: -8.2, highAlarm: 3.5 },
    },
  },
  health: TransceiverHealth.PortDisabled,
  lastSeenAt: RECENTLY,
};

const DIRECT_ATTACH: NetworkDeviceTransceiver = {
  interfaceIndex: 6,
  interfaceName: "Te1/1/6",
  isPresent: true,
  vendor: "FS",
  partNumber: "SFPP-PC015",
  measurements: {},
  health: TransceiverHealth.NotJudged,
  lastSeenAt: RECENTLY,
};

const NO_THRESHOLDS: NetworkDeviceTransceiver = {
  interfaceIndex: 7,
  interfaceName: "Te1/1/7",
  isPresent: true,
  measurements: { rxPower: { readings: [{ value: -5.5 }] } },
  health: TransceiverHealth.NotJudged,
  faults: undefined,
  lastSeenAt: RECENTLY,
};

function device(
  transceivers: Array<NetworkDeviceTransceiver> | undefined,
): unknown {
  return { transceiverSnapshot: transceivers };
}

async function renderCard(): Promise<void> {
  render(<TransceiverHealthCard networkDeviceId={DEVICE_ID} />);
  await waitFor(() => {
    expect(getItemSelects.length).toBeGreaterThan(0);
  });
}

function tableRows(): Array<HTMLElement> {
  return within(screen.getByTestId("transceiver-table")).getAllByTestId(
    /^transceiver-row-/,
  );
}

beforeEach(() => {
  deviceRow = null;
  failWith = null;
  getItemSelects = [];
});

afterEach(() => {
  cleanup();
});

describe("TransceiverHealthCard", () => {
  test("reads only the device's transceiver snapshot", async () => {
    deviceRow = device([FADING]);

    await renderCard();

    expect(getItemSelects[0]).toEqual({ transceiverSnapshot: true });
  });

  test("a device that reports no optics shows no card at all", async () => {
    for (const snapshot of [undefined, []]) {
      deviceRow = device(snapshot);
      getItemSelects = [];

      const { container } = render(
        <TransceiverHealthCard networkDeviceId={DEVICE_ID} />,
      );

      await waitFor(() => {
        expect(getItemSelects.length).toBe(1);
      });

      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByTestId("transceiver-card")).not.toBeInTheDocument();
      cleanup();
    }
  });

  test("a failed read says so instead of hiding the card", async () => {
    failWith = new Error("You do not have permission to read this device.");

    await renderCard();

    expect(await screen.findByTestId("transceiver-error")).toHaveTextContent(
      "You do not have permission to read this device.",
    );
  });

  test("problems first, each optic with its status in words", async () => {
    deviceRow = device([
      FADING,
      PULLED,
      FAILING_LANE,
      SHUT_PORT,
      DIRECT_ATTACH,
      NO_THRESHOLDS,
    ]);

    await renderCard();
    await screen.findByTestId("transceiver-card");

    expect(
      tableRows().map((row: HTMLElement) => {
        return row.getAttribute("data-testid");
      }),
    ).toEqual([
      "transceiver-row-2",
      "transceiver-row-49",
      "transceiver-row-1",
      "transceiver-row-6",
      "transceiver-row-7",
      "transceiver-row-5",
    ]);

    const statusOf: (index: number) => string = (index: number): string => {
      return (
        within(screen.getByTestId(`transceiver-row-${index}`)).getByTestId(
          "transceiver-status",
        ).textContent || ""
      );
    };

    expect(statusOf(2)).toBe("Not detected");
    expect(statusOf(49)).toBe("Alarm");
    expect(statusOf(1)).toBe("Healthy");
    expect(statusOf(6)).toBe("Detected");
    expect(statusOf(7)).toBe("No thresholds");
    expect(statusOf(5)).toBe("Port disabled");

    const summary: HTMLElement = screen.getByTestId("transceiver-summary");
    expect(summary).toHaveTextContent("1 not detected");
    expect(summary).toHaveTextContent("1 alarm");
    expect(summary).toHaveTextContent("1 healthy");
    expect(summary).not.toHaveTextContent("warning");
  });

  test("a QSFP shows its worst lane, past which threshold, in words", async () => {
    deviceRow = device([FAILING_LANE]);

    await renderCard();

    const cell: HTMLElement = within(
      await screen.findByTestId("transceiver-row-49"),
    ).getByTestId("transceiver-reading-rxPower");

    expect(cell).toHaveTextContent("-19.60 dBm");
    expect(cell).toHaveTextContent("Low alarm");
    expect(cell).toHaveTextContent("Worst of 4 lanes");
  });

  test("received power falling against its best day is said beside the value", async () => {
    deviceRow = device([FADING]);

    await renderCard();

    const row: HTMLElement = await screen.findByTestId("transceiver-row-1");

    expect(
      within(row).getByTestId("transceiver-rx-sparkline"),
    ).toBeInTheDocument();
    expect(within(row).getByTestId("transceiver-rx-drop")).toHaveTextContent(
      "2.5 dB below its best day",
    );
    expect(row).toHaveTextContent("FLEXOPTIX P.1396.10");
    expect(row).toHaveTextContent("S/N F7A2B91");
    expect(row).toHaveTextContent("Uplink to core");
  });

  test("a pulled optic says what was there and when it was last seen", async () => {
    deviceRow = device([PULLED]);

    await renderCard();

    const row: HTMLElement = await screen.findByTestId("transceiver-row-2");
    expect(row).toHaveTextContent("FS SFP-10GSR-85");
    expect(row).toHaveTextContent("Last seen an hour ago");
    // No readings while it is gone - never the last ones it had.
    expect(
      within(row).queryByTestId("transceiver-reading-rxPower"),
    ).not.toBeInTheDocument();

    fireEvent.click(within(row).getByRole("button", { name: "Te1/1/2" }));

    const details: HTMLElement = await screen.findByTestId(
      "transceiver-details",
    );
    expect(details).toHaveTextContent(
      "No optic has been detected in Te1/1/2 since",
    );
    expect(details).toHaveTextContent("the port is still enabled");
    expect(details).toHaveTextContent("Received power until it was last seen");
  });

  test("a shut port's dark laser is not judged", async () => {
    deviceRow = device([SHUT_PORT]);

    await renderCard();

    const cell: HTMLElement = within(
      await screen.findByTestId("transceiver-row-5"),
    ).getByTestId("transceiver-reading-txPower");
    expect(cell).toHaveTextContent("No light");
    expect(cell).not.toHaveTextContent("Low alarm");

    fireEvent.click(screen.getByTestId("transceiver-row-5"));

    expect(await screen.findByTestId("transceiver-details")).toHaveTextContent(
      "The port is administratively disabled, so its laser is off by design and its readings are not judged.",
    );
  });

  test("the details list every lane against the device's thresholds, and who made the optic", async () => {
    deviceRow = device([FAILING_LANE, FADING]);

    await renderCard();
    fireEvent.click(await screen.findByTestId("transceiver-row-49"));

    const details: HTMLElement = await screen.findByTestId(
      "transceiver-details",
    );
    const rx: HTMLElement = within(details).getByTestId(
      "transceiver-detail-rxPower",
    );

    expect(rx).toHaveTextContent("Lane 1");
    expect(rx).toHaveTextContent("Lane 3");
    expect(rx).toHaveTextContent("-19.60 dBm");
    expect(rx).toHaveTextContent(
      "Low alarm -18.40 dBm · Low warning -14.40 dBm · High warning 0.50 dBm · High alarm 2.50 dBm",
    );
    expect(within(rx).getAllByTestId("transceiver-threshold-bar")).toHaveLength(
      4,
    );
    expect(details).toHaveTextContent("Vendor");
    expect(details).toHaveTextContent("Carritech");
    expect(details).toHaveTextContent("QSFP-40G-LR4");
    expect(details).toHaveTextContent(
      "The trend fills in one point a day; the baseline needs one full day of readings.",
    );
  });

  test("the details of a fading optic name its best day and the drop", async () => {
    deviceRow = device([FADING]);

    await renderCard();
    fireEvent.click(await screen.findByTestId("transceiver-row-1"));

    const details: HTMLElement = await screen.findByTestId(
      "transceiver-details",
    );

    expect(
      within(details).getByTestId("transceiver-rx-trend"),
    ).toHaveTextContent("Received power, last 30 days");
    expect(details).toHaveTextContent("Best day -3.80 dBm on");
    expect(details).toHaveTextContent("Now -6.30 dBm, 2.50 dB below it.");
    expect(details).toHaveTextContent("1310 nm");
    expect(details).toHaveTextContent("CISCO-ENTITY-SENSOR-MIB");
    // A reading the device gives no thresholds for says so.
    expect(
      within(details).getByTestId("transceiver-detail-voltage"),
    ).toHaveTextContent("The device reports no thresholds for this reading.");
  });

  test("an optic with no diagnostics is detected, with nothing to read", async () => {
    deviceRow = device([DIRECT_ATTACH]);

    await renderCard();
    fireEvent.click(await screen.findByTestId("transceiver-row-6"));

    expect(await screen.findByTestId("transceiver-details")).toHaveTextContent(
      "This optic reports no diagnostics",
    );
  });

  test("a fault the device flags is spelled out", async () => {
    deviceRow = device([
      {
        ...FAILING_LANE,
        faults: [TransceiverFault.RxLossOfSignal, TransceiverFault.TxFault],
      },
    ]);

    await renderCard();
    fireEvent.click(await screen.findByTestId("transceiver-row-49"));

    const details: HTMLElement = await screen.findByTestId(
      "transceiver-details",
    );
    expect(details).toHaveTextContent(
      "The device reports a loss of signal on receive.",
    );
    expect(details).toHaveTextContent(
      "The device reports a transmitter fault.",
    );
  });

  test("ten rows, then Show all", async () => {
    deviceRow = device(
      Array.from({ length: 14 }, (_v: unknown, i: number) => {
        return {
          ...FADING,
          interfaceIndex: 100 + i,
          interfaceName: `Gi1/0/${i + 1}`,
          rxPowerHistory: undefined,
        };
      }),
    );

    await renderCard();
    await screen.findByTestId("transceiver-card");

    expect(tableRows()).toHaveLength(10);

    fireEvent.click(screen.getByTestId("transceiver-show-all"));

    expect(tableRows()).toHaveLength(14);
    expect(screen.getByTestId("transceiver-show-all")).toHaveTextContent(
      "Show fewer",
    );
  });

  test("a phone gets the same optics as a list", async () => {
    deviceRow = device([FADING, PULLED]);

    await renderCard();

    const list: HTMLElement = await screen.findByTestId("transceiver-list");
    const item: HTMLElement = within(list).getByTestId("transceiver-item-1");

    expect(item).toHaveTextContent("Te1/1/1");
    expect(item).toHaveTextContent("RX Power");
    expect(item).toHaveTextContent("-6.30 dBm");
    expect(item).toHaveTextContent("2.5 dB below its best day");
    expect(
      within(list).getByTestId("transceiver-item-2"),
    ).toHaveTextContent("Last seen");
  });
});

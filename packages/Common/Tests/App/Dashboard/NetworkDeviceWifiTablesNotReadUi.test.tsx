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
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * A customer's Cambium access points charted CPU, memory and clients, and
 * their Wi-Fi tab said "No Wi-Fi radios reported ... after its next
 * successful SNMP poll" - forever: the probe polling them predated SNMP
 * tables and answered every poll without walking them. These are the
 * device pages once the server stores such tables as not walked, RENDERED:
 * the Wi-Fi tab names the probe and says to update it, and says what is
 * wrong in the other cases where polled tables hold nothing. The device row
 * comes from a ModelAPI stub, so each case is one device shape.
 */

let deviceRow: unknown = null;
let getItemSelects: Array<Record<string, unknown> | undefined> = [];

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (request: {
        select?: Record<string, unknown> | undefined;
      }): Promise<unknown> => {
        getItemSelects.push(request.select);
        return Promise.resolve(deviceRow);
      },
      updateById: (): Promise<unknown> => {
        return Promise.reject(new Error("This page must not write here."));
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("0193c0de-7777-4aaa-8bbb-000000000007");
      },
      getCurrentRoute: (): unknown => {
        const { default: RouteType } = jest.requireActual(
          "../../../Types/API/Route",
        ) as { default: new (route: string) => unknown };
        return new RouteType("/dashboard/project/network-devices/x/wifi");
      },
      getFirstParam: (): undefined => {
        return undefined;
      },
      navigate: (): void => {
        return undefined;
      },
    },
  };
});

import NetworkDeviceWiFi from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/View/WiFi";
import NetworkDeviceTables from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/View/Tables";
import SnmpTableSnapshotCard from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/SnmpTableSnapshotCard";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import Probe from "../../../Models/DatabaseModels/Probe";
import Route from "../../../Types/API/Route";
import {
  PROBE_DID_NOT_WALK_TABLES_CAUSE,
  SnmpTableDefinition,
  SnmpTableFailureReason,
  SnmpTableResult,
  SnmpTableSnapshot,
} from "../../../Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpTableListUtil from "../../../Types/Monitor/SnmpMonitor/SnmpTableListUtil";
import SnmpVendorTemplateUtil from "../../../Types/Monitor/SnmpMonitor/SnmpVendorTemplate";

const RADIO: string = "1.3.6.1.4.1.17713.22.1.2.1";
const WLAN: string = "1.3.6.1.4.1.17713.22.1.4.1";

const CAMBIUM_TABLES: Array<SnmpTableDefinition> =
  SnmpVendorTemplateUtil.getById("cambium-wifi-ap")!.tables!;

const CAMBIUM_IDENTITY: Partial<NetworkDevice> = {
  sysObjectId: "1.3.6.1.4.1.17713.22",
  sysDescr: "Cambium X7-35X Access Point",
  snmpTables: CAMBIUM_TABLES,
};

const pageRoute: Route = new Route("/dashboard/project/network-devices/x");

// A Wi-Fi 7 access point as a probe that walks tables reads it.
const WIFI7_RESULTS: Array<SnmpTableResult> = [
  {
    key: "wifi_radios",
    rows: [
      {
        index: "0",
        values: {
          [`${RADIO}.3`]: "2.4GHz",
          [`${RADIO}.5`]: 0,
          [`${RADIO}.6`]: "-",
          [`${RADIO}.7`]: "20MHz",
          [`${RADIO}.8`]: 0,
          [`${RADIO}.13`]: "OFF",
        },
      },
      {
        index: "1",
        values: {
          [`${RADIO}.3`]: "5GHz",
          [`${RADIO}.5`]: 5,
          [`${RADIO}.6`]: "44",
          [`${RADIO}.7`]: "40MHz",
          [`${RADIO}.8`]: 17,
          [`${RADIO}.13`]: "ON",
          [`${RADIO}.16`]: "-107",
        },
      },
      {
        index: "2",
        values: {
          [`${RADIO}.3`]: "6GHz",
          [`${RADIO}.5`]: 4,
          [`${RADIO}.6`]: "5",
          [`${RADIO}.7`]: "80MHz",
          [`${RADIO}.8`]: 18,
          [`${RADIO}.13`]: "ON",
          [`${RADIO}.16`]: "-104",
        },
      },
    ],
  },
  {
    key: "wifi_ssids",
    rows: [
      {
        index: "0",
        values: {
          [`${WLAN}.2`]: "Workshop",
          [`${WLAN}.3`]: "5GHz,6GHz",
          [`${WLAN}.7`]: 9,
        },
      },
    ],
  },
];

function walked(
  results: Array<SnmpTableResult> = WIFI7_RESULTS,
): Array<SnmpTableSnapshot> {
  return SnmpTableListUtil.materialize({
    tables: CAMBIUM_TABLES,
    results: results,
    collectedAt: new Date(),
  });
}

// What the server stores after a poll by a probe that did not walk them.
function notWalkedByProbe(
  previous: Array<SnmpTableSnapshot> = [],
): Array<SnmpTableSnapshot> {
  return SnmpTableListUtil.mergeWithPrevious({
    current: SnmpTableListUtil.notWalked({
      tables: CAMBIUM_TABLES,
      failureCause: PROBE_DID_NOT_WALK_TABLES_CAUSE,
      failureReason: SnmpTableFailureReason.ProbeDidNotWalkTables,
    }),
    previous: previous,
    definedKeys: CAMBIUM_TABLES.map((table: SnmpTableDefinition) => {
      return table.key;
    }),
  });
}

function deviceWith(fields: Partial<NetworkDevice>): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice();
  Object.assign(device, fields);
  return device;
}

function probeNamed(name: string): Probe {
  const probe: Probe = new Probe();
  probe.name = name;
  return probe;
}

function renderInRouter(element: React.ReactElement): void {
  render(<MemoryRouter>{element}</MemoryRouter>);
}

function renderWiFi(): void {
  renderInRouter(
    <NetworkDeviceWiFi
      pageRoute={pageRoute}
      currentProject={null}
      hasPaymentMethod={true}
    />,
  );
}

async function waitForEmptyState(): Promise<HTMLElement> {
  await waitFor(() => {
    expect(
      screen.getByTestId("network-device-wifi-not-read-description"),
    ).toBeInTheDocument();
  });

  return screen.getByTestId("network-device-wifi-not-read-description");
}

beforeEach(() => {
  deviceRow = null;
  getItemSelects = [];
});

afterEach(() => {
  cleanup();
});

describe("the Wi-Fi tab of an access point whose probe does not walk tables", () => {
  test("names the probe and says to update it, instead of waiting for a poll", async () => {
    deviceRow = deviceWith({
      ...CAMBIUM_IDENTITY,
      snmpTableSnapshot: notWalkedByProbe(),
      probe: probeNamed("Customer site probe"),
    });

    renderWiFi();

    const description: HTMLElement = await waitForEmptyState();

    expect(
      screen.getByText("Update the probe to read Wi-Fi"),
    ).toBeInTheDocument();
    expect(description).toHaveTextContent(
      "Customer site probe, the probe that polls this device, answered its last poll without walking the device's Wi-Fi tables.",
    );
    expect(description).toHaveTextContent(
      "Probes released before version 14.0.18 do not walk SNMP tables.",
    );
    expect(description).toHaveTextContent(
      "Update the probe to the latest version",
    );

    // Not the promise the customer saw.
    expect(
      screen.queryByText("No Wi-Fi radios reported"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/next successful SNMP poll/)).toBeNull();
    // Nothing to count.
    expect(screen.queryByTestId("wifi-tiles")).not.toBeInTheDocument();
    expect(screen.queryByTestId("wifi-radios")).not.toBeInTheDocument();
  });

  test("links how to run the latest probe, in a new tab", async () => {
    deviceRow = deviceWith({
      ...CAMBIUM_IDENTITY,
      snmpTableSnapshot: notWalkedByProbe(),
      probe: probeNamed("Customer site probe"),
    });

    renderWiFi();

    await waitForEmptyState();

    const link: HTMLAnchorElement | null = screen
      .getByTestId("network-device-wifi-probe-docs")
      .querySelector("a");

    expect(link?.getAttribute("href")).toContain(
      "/probe/custom-probe#run-the-probe",
    );
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link).toHaveTextContent("How to run the latest probe");

    // The table of what each vendor reports is still one click away.
    expect(
      screen.getByTestId("network-device-wifi-vendors-docs"),
    ).toBeInTheDocument();
  });

  test("reads the probe's name along with the tables", async () => {
    deviceRow = deviceWith({
      ...CAMBIUM_IDENTITY,
      snmpTableSnapshot: notWalkedByProbe(),
    });

    renderWiFi();

    await waitForEmptyState();

    expect(getItemSelects[0]).toMatchObject({
      snmpTableSnapshot: true,
      snmpTables: true,
      probe: { _id: true, name: true },
    });
  });

  test("speaks of the probe that polls it when its name could not be read", async () => {
    deviceRow = deviceWith({
      ...CAMBIUM_IDENTITY,
      snmpTableSnapshot: notWalkedByProbe(),
    });

    renderWiFi();

    const description: HTMLElement = await waitForEmptyState();

    expect(description).toHaveTextContent(
      "The probe that polls this device answered its last poll without walking the device's Wi-Fi tables.",
    );
    expect(description).toHaveTextContent("14.0.18");
  });

  test("still lists what an earlier walk read, and says those values are from before", async () => {
    deviceRow = deviceWith({
      ...CAMBIUM_IDENTITY,
      snmpTableSnapshot: notWalkedByProbe(walked()),
      probe: probeNamed("Customer site probe"),
    });

    renderWiFi();

    await waitFor(() => {
      expect(screen.getByTestId("wifi-radios")).toBeInTheDocument();
    });

    expect(screen.getByTestId("wifi-not-walked-by-probe")).toHaveTextContent(
      "so these are the values from the last walk that read them",
    );
    expect(screen.getByTestId("wifi-not-walked-by-probe")).toHaveTextContent(
      "14.0.18",
    );
    // Not the walk-failed wording: nothing failed, the probe did not try.
    expect(
      screen.queryByText(/The last walk of the radio table failed/),
    ).toBeNull();
    expect(screen.getByTestId("wifi-radios")).toHaveTextContent("5220 MHz");
  });
});

describe("the Wi-Fi tab of an access point whose tables were polled and hold nothing", () => {
  test("a failed first walk says it failed, and why", async () => {
    deviceRow = deviceWith({
      ...CAMBIUM_IDENTITY,
      snmpTableSnapshot: walked([
        { key: "wifi_radios", rows: [], failureCause: "Request timed out" },
        { key: "wifi_ssids", rows: [], failureCause: "Request timed out" },
      ]),
    });

    renderWiFi();

    const description: HTMLElement = await waitForEmptyState();

    expect(
      screen.getByText("Wi-Fi tables could not be read"),
    ).toBeInTheDocument();
    expect(description).toHaveTextContent(
      "The last walk of this device's Wi-Fi tables failed, and no earlier walk read them.",
    );
    expect(
      screen.getByTestId("network-device-wifi-walk-failure"),
    ).toHaveTextContent("Request timed out");
    // No claim that values from an earlier walk are shown: there are none.
    expect(screen.queryByText(/values from the walk before it/)).toBeNull();
    expect(screen.queryByTestId("wifi-tiles")).not.toBeInTheDocument();
  });

  test("a walk that found nothing says the device reported nothing, and where to look", async () => {
    deviceRow = deviceWith({
      ...CAMBIUM_IDENTITY,
      snmpTableSnapshot: walked([
        { key: "wifi_radios", rows: [] },
        { key: "wifi_ssids", rows: [] },
      ]),
    });

    renderWiFi();

    const description: HTMLElement = await waitForEmptyState();

    expect(
      screen.getByText("The device reported no Wi-Fi radios"),
    ).toBeInTheDocument();
    expect(description).toHaveTextContent(
      "The device answered the walk of its Wi-Fi tables, but they hold no rows.",
    );

    const tablesLink: HTMLElement =
      within(description).getByText("SNMP Tables");
    expect(tablesLink.closest("a")?.getAttribute("href")).toContain(
      "/network-devices/0193c0de-7777-4aaa-8bbb-000000000007/tables",
    );
    expect(screen.queryByTestId("wifi-tiles")).not.toBeInTheDocument();
  });

  test("SSIDs with no radios are listed, and the radios card says there were none", async () => {
    deviceRow = deviceWith({
      ...CAMBIUM_IDENTITY,
      snmpTableSnapshot: walked([
        { key: "wifi_radios", rows: [] },
        WIFI7_RESULTS[1]!,
      ]),
    });

    renderWiFi();

    await waitFor(() => {
      expect(screen.getByTestId("wifi-ssids")).toBeInTheDocument();
    });

    expect(screen.getByTestId("wifi-no-radios")).toHaveTextContent(
      "The device reported no radios on its last walk.",
    );
    expect(screen.queryByTestId("wifi-radios")).not.toBeInTheDocument();
    expect(screen.getByTestId("wifi-ssids")).toHaveTextContent("Workshop");
  });

  test("an access point with no Wi-Fi tables polled yet still waits for its next poll", async () => {
    deviceRow = deviceWith({ ...CAMBIUM_IDENTITY });

    renderWiFi();

    await waitFor(() => {
      expect(screen.getByText("No Wi-Fi radios reported")).toBeInTheDocument();
    });

    expect(
      screen.getByTestId("network-device-wifi-empty-description"),
    ).toHaveTextContent("after its next successful SNMP poll");
  });
});

describe("the customer's access point, once an updated probe walks it", () => {
  test("lists all three radios - 2.4 GHz off, 5 GHz on 44, 6 GHz on 5 - and its SSID on two bands", async () => {
    deviceRow = deviceWith({
      ...CAMBIUM_IDENTITY,
      // Walked over the not-walked tables an older probe left.
      snmpTableSnapshot: SnmpTableListUtil.mergeWithPrevious({
        current: walked(),
        previous: notWalkedByProbe(),
        definedKeys: ["wifi_radios", "wifi_ssids"],
      }),
    });

    renderWiFi();

    await waitFor(() => {
      expect(screen.getByTestId("wifi-radios")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("wifi-not-walked-by-probe")).toBeNull();

    const rows: Array<HTMLElement> = within(
      screen.getByTestId("wifi-radios"),
    ).getAllByRole("row");

    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveTextContent("2.4GHz");
    expect(rows[1]).toHaveTextContent("Off");
    expect(rows[2]).toHaveTextContent("5 GHz");
    expect(rows[2]).toHaveTextContent("44");
    expect(rows[2]).toHaveTextContent("5220 MHz");
    expect(rows[2]).toHaveTextContent("40 MHz");
    expect(rows[2]).toHaveTextContent("17 dBm");
    expect(rows[3]).toHaveTextContent("6 GHz");
    expect(rows[3]).toHaveTextContent("5975 MHz");
    expect(rows[3]).toHaveTextContent("80 MHz");
    expect(rows[3]).toHaveTextContent("18 dBm");

    const tiles: HTMLElement = screen.getByTestId("wifi-tiles");
    expect(tiles).toHaveTextContent("Radios on");
    expect(tiles).toHaveTextContent("2 / 3");

    expect(screen.getByTestId("wifi-ssids")).toHaveTextContent("5GHz,6GHz");
  });
});

describe("the SNMP Tables tab of such a device", () => {
  test("lists the tables as not walked by the probe, not as waiting for a first walk", async () => {
    deviceRow = deviceWith({
      ...CAMBIUM_IDENTITY,
      snmpTableSnapshot: notWalkedByProbe(),
    });

    renderInRouter(
      <NetworkDeviceTables
        pageRoute={pageRoute}
        currentProject={null}
        hasPaymentMethod={true}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("snmp-table-wifi_radios-failure"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByTestId("snmp-table-wifi_radios-failure"),
    ).toHaveTextContent(
      "The probe that polls this device answered its last poll without walking this table.",
    );
    expect(
      screen.getByTestId("snmp-table-wifi_ssids-failure"),
    ).toHaveTextContent("14.0.18");
    expect(screen.queryByText("Waiting for the first walk")).toBeNull();
  });
});

describe("SnmpTableSnapshotCard, when its last walk read nothing", () => {
  function radios(): SnmpTableSnapshot {
    return walked()[0]!;
  }

  test("a table the probe did not walk, with no earlier rows: update the probe, and no 'returned no rows'", () => {
    renderInRouter(<SnmpTableSnapshotCard snapshot={notWalkedByProbe()[0]!} />);

    expect(
      screen.getByTestId("snmp-table-wifi_radios-failure"),
    ).toHaveTextContent(
      "Probes released before version 14.0.18 do not walk SNMP tables: update the probe to the latest version, and the rows appear after its next poll.",
    );
    expect(
      screen.queryByText(/The device returned no rows for this table/),
    ).toBeNull();
    expect(screen.queryByText(/The last walk of this table failed/)).toBeNull();
  });

  test("a table the probe did not walk, with earlier rows: they are shown as the last walk's", () => {
    renderInRouter(
      <SnmpTableSnapshotCard snapshot={notWalkedByProbe([radios()])[0]!} />,
    );

    expect(
      screen.getByTestId("snmp-table-wifi_radios-failure"),
    ).toHaveTextContent(
      "so these are the rows from the last walk that read it",
    );
    // The rows are drawn, the last one named by its band.
    expect(screen.getByTitle("Row index 2")).toHaveTextContent("6GHz");
  });

  test("a table whose first walk failed says it could not be walked, and why - not that the device returned no rows", () => {
    renderInRouter(
      <SnmpTableSnapshotCard
        snapshot={{ ...radios(), rows: [], failureCause: "Request timed out" }}
      />,
    );

    expect(
      screen.getByTestId("snmp-table-wifi_radios-failure"),
    ).toHaveTextContent(
      "This table could not be walked, and no earlier walk read it: Request timed out",
    );
    expect(
      screen.queryByText(/The device returned no rows for this table/),
    ).toBeNull();
  });

  test("a table that failed after a good walk keeps the earlier wording", () => {
    renderInRouter(
      <SnmpTableSnapshotCard
        snapshot={{ ...radios(), failureCause: "Request timed out" }}
      />,
    );

    expect(
      screen.getByTestId("snmp-table-wifi_radios-failure"),
    ).toHaveTextContent(
      "The last walk of this table failed, so these are the rows from the walk before it: Request timed out",
    );
  });

  test("a table walked cleanly with no rows still says the device returned none", () => {
    renderInRouter(
      <SnmpTableSnapshotCard snapshot={{ ...radios(), rows: [] }} />,
    );

    expect(
      screen.getByText(/The device returned no rows for this table/),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("snmp-table-wifi_radios-failure"),
    ).not.toBeInTheDocument();
  });
});

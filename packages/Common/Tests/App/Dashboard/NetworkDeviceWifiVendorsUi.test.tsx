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
import { MemoryRouter } from "react-router-dom";

/*
 * The Wi-Fi tab with each Wi-Fi vendor's data, RENDERED: a controller's
 * access points, a UniFi access point's radios filled in from its SSIDs,
 * and - for a device that reports no Wi-Fi yet - the empty tab that names
 * the device's own template and applies it with one click. The device row
 * comes from a ModelAPI stub; every write the tab makes is recorded.
 */

let deviceRow: unknown = null;
let freshRow: unknown = null;
let getItemCalls: Array<Record<string, unknown> | undefined> = [];
let updates: Array<{ id: string; data: Record<string, unknown> }> = [];
let updateError: Error | null = null;

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (request: {
        select?: Record<string, unknown> | undefined;
      }): Promise<unknown> => {
        getItemCalls.push(request.select);
        // The page's read first, the apply's fresh read after it.
        return Promise.resolve(
          getItemCalls.length > 1 && freshRow ? freshRow : deviceRow,
        );
      },
      updateById: (request: {
        id: { toString: () => string };
        data: Record<string, unknown>;
      }): Promise<unknown> => {
        if (updateError) {
          return Promise.reject(updateError);
        }

        updates.push({ id: request.id.toString(), data: request.data });
        return Promise.resolve({});
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
import SnmpTableEditor from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/SnmpTableEditor";
import SnmpTableSnapshotCard from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/SnmpTableSnapshotCard";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import SnmpOid from "../../../Types/Monitor/SnmpMonitor/SnmpOid";
import {
  SnmpTableDefinition,
  SnmpTableResult,
  SnmpTableSnapshot,
} from "../../../Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpTableListUtil from "../../../Types/Monitor/SnmpMonitor/SnmpTableListUtil";
import SnmpVendorTemplateUtil from "../../../Types/Monitor/SnmpMonitor/SnmpVendorTemplate";

const AI_AP: string = "1.3.6.1.4.1.14823.2.3.3.1.2.1.1";
const AI_RADIO: string = "1.3.6.1.4.1.14823.2.3.3.1.2.2.1";
const AI_SSID: string = "1.3.6.1.4.1.14823.2.3.3.1.1.7.1";
const UNIFI_RADIO: string = "1.3.6.1.4.1.41112.1.6.1.1.1";
const UNIFI_VAP: string = "1.3.6.1.4.1.41112.1.6.1.2.1";

const LOBBY: string = "0.11.134.1.2.3";
const STORE: string = "0.11.134.4.5.6";

const pageRoute: Route = new Route("/dashboard/project/network-devices/x");

function walk(
  id: string,
  results: Array<SnmpTableResult>,
): Array<SnmpTableSnapshot> {
  return SnmpTableListUtil.materialize({
    tables: SnmpVendorTemplateUtil.getById(id)!.tables!,
    results: results,
    collectedAt: new Date(),
  });
}

// An Instant cluster: two access points, one down, three radios.
function arubaInstant(): Array<SnmpTableSnapshot> {
  return walk("aruba-instant", [
    {
      key: "wifi_access_points",
      rows: [
        {
          index: LOBBY,
          values: { [`${AI_AP}.2`]: "lobby-ap", [`${AI_AP}.11`]: 1 },
        },
        {
          index: STORE,
          values: { [`${AI_AP}.2`]: "store-ap", [`${AI_AP}.11`]: 2 },
        },
      ],
    },
    {
      key: "wifi_radios",
      rows: [
        { index: LOBBY, values: { [`${AI_AP}.2`]: "lobby-ap" } },
        { index: STORE, values: { [`${AI_AP}.2`]: "store-ap" } },
        {
          index: `${LOBBY}.0`,
          values: {
            [`${AI_RADIO}.2`]: 0,
            [`${AI_RADIO}.4`]: "36E",
            [`${AI_RADIO}.5`]: 18,
            [`${AI_RADIO}.6`]: 93,
            [`${AI_RADIO}.21`]: 6,
            [`${AI_RADIO}.20`]: 1,
          },
        },
        {
          index: `${LOBBY}.1`,
          values: {
            [`${AI_RADIO}.2`]: 1,
            [`${AI_RADIO}.4`]: "11",
            [`${AI_RADIO}.21`]: 2,
            [`${AI_RADIO}.20`]: 1,
          },
        },
        {
          index: `${STORE}.0`,
          values: {
            [`${AI_RADIO}.2`]: 0,
            [`${AI_RADIO}.4`]: "149",
            [`${AI_RADIO}.21`]: 0,
            [`${AI_RADIO}.20`]: 2,
          },
        },
      ],
    },
    {
      key: "wifi_ssids",
      rows: [
        {
          index: "0",
          values: { [`${AI_SSID}.2`]: "Staff", [`${AI_SSID}.4`]: 8 },
        },
      ],
    },
  ]);
}

function unifi(): Array<SnmpTableSnapshot> {
  return walk("ubiquiti-unifi-ap", [
    {
      key: "wifi_radios",
      rows: [
        {
          index: "1",
          values: { [`${UNIFI_RADIO}.3`]: "ng", [`${UNIFI_RADIO}.6`]: 13 },
        },
      ],
    },
    {
      key: "wifi_ssids",
      rows: [
        {
          index: "1",
          values: {
            [`${UNIFI_VAP}.6`]: "Office",
            [`${UNIFI_VAP}.9`]: "ng",
            [`${UNIFI_VAP}.4`]: 11,
            [`${UNIFI_VAP}.8`]: 5,
            [`${UNIFI_VAP}.21`]: 20,
          },
        },
      ],
    },
  ]);
}

function deviceWith(fields: Partial<NetworkDevice>): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice();
  Object.assign(device, fields);
  return device;
}

function renderWiFi(): void {
  render(
    <MemoryRouter>
      <NetworkDeviceWiFi
        pageRoute={pageRoute}
        currentProject={null}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  deviceRow = null;
  freshRow = null;
  getItemCalls = [];
  updates = [];
  updateError = null;
});

afterEach(() => {
  cleanup();
});

describe("the Wi-Fi tab of a wireless controller", () => {
  test("lists its access points - the down one marked - with their radios and clients", async () => {
    deviceRow = deviceWith({ snmpTableSnapshot: arubaInstant() });

    renderWiFi();

    await waitFor(() => {
      expect(screen.getByTestId("wifi-access-points")).toBeInTheDocument();
    });

    const accessPoints: HTMLElement = screen.getByTestId("wifi-access-points");
    const rows: Array<HTMLElement> = within(accessPoints).getAllByRole("row");

    // A header row and one row per access point.
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Access Point");
    expect(rows[0]).toHaveTextContent("Radios");
    expect(rows[0]).toHaveTextContent("Clients");
    expect(rows[1]).toHaveTextContent("lobby-ap");
    expect(rows[1]).toHaveTextContent("up");
    // Two radios, eight clients between them.
    expect(rows[1]).toHaveTextContent("2");
    expect(rows[1]).toHaveTextContent("8");
    expect(rows[2]).toHaveTextContent("store-ap");
    expect(rows[2]).toHaveTextContent("down");
  });

  test("leads with how many access points are up", async () => {
    deviceRow = deviceWith({ snmpTableSnapshot: arubaInstant() });

    renderWiFi();

    await waitFor(() => {
      expect(screen.getByTestId("wifi-tiles")).toBeInTheDocument();
    });

    const tiles: HTMLElement = screen.getByTestId("wifi-tiles");
    expect(tiles).toHaveTextContent("Access points up");
    expect(tiles).toHaveTextContent("1 / 2");
    expect(tiles).toHaveTextContent("2 / 3");
    // The radios count their clients: 6 + 2 + 0.
    expect(tiles).toHaveTextContent("8");
  });

  test("names every radio by its access point, with its band, noise floor and state", async () => {
    deviceRow = deviceWith({ snmpTableSnapshot: arubaInstant() });

    renderWiFi();

    await waitFor(() => {
      expect(screen.getByTestId("wifi-radios")).toBeInTheDocument();
    });

    const radios: HTMLElement = screen.getByTestId("wifi-radios");
    expect(radios).toHaveTextContent("lobby-ap / Radio 0");
    expect(radios).toHaveTextContent("lobby-ap / Radio 1");
    expect(radios).toHaveTextContent("store-ap / Radio 0");
    expect(radios).toHaveTextContent("5180 MHz");
    expect(radios).toHaveTextContent("2462 MHz");
    expect(radios).toHaveTextContent("-93 dBm");
    expect(within(radios).getAllByText("down")).toHaveLength(1);
  });

  test("leaves out the columns no row fills, and says whose SSIDs these are", async () => {
    deviceRow = deviceWith({ snmpTableSnapshot: arubaInstant() });

    renderWiFi();

    await waitFor(() => {
      expect(screen.getByTestId("wifi-radios")).toBeInTheDocument();
    });

    const radioHeader: HTMLElement = within(
      screen.getByTestId("wifi-radios"),
    ).getAllByRole("row")[0]!;

    // Aruba Instant reports no channel width.
    expect(radioHeader).not.toHaveTextContent("Width");
    expect(radioHeader).toHaveTextContent("Noise Floor");

    const ssidHeader: HTMLElement = within(
      screen.getByTestId("wifi-ssids"),
    ).getAllByRole("row")[0]!;

    // The cluster's SSIDs carry no band.
    expect(ssidHeader).not.toHaveTextContent("Band");
    expect(ssidHeader).toHaveTextContent("Clients");

    expect(
      screen.getByText(
        "Every SSID its access points broadcast, and who is on it.",
      ),
    ).toBeInTheDocument();
  });
});

describe("the Wi-Fi tab of a UniFi access point", () => {
  test("shows each radio's channel, power and clients, which UniFi reports per SSID", async () => {
    deviceRow = deviceWith({ snmpTableSnapshot: unifi() });

    renderWiFi();

    await waitFor(() => {
      expect(screen.getByTestId("wifi-radios")).toBeInTheDocument();
    });

    const radios: HTMLElement = screen.getByTestId("wifi-radios");
    expect(radios).toHaveTextContent("2.4 GHz");
    expect(radios).toHaveTextContent("2462 MHz");
    expect(radios).toHaveTextContent("20 dBm");
    expect(radios).toHaveTextContent("13 %");

    // A single access point lists no access points, and three tiles.
    expect(screen.queryByTestId("wifi-access-points")).not.toBeInTheDocument();
    expect(screen.getByTestId("wifi-tiles")).not.toHaveTextContent(
      "Access points up",
    );

    // UniFi says nothing of whether a radio is on: a count, no claim.
    expect(screen.getByTestId("wifi-tiles")).not.toHaveTextContent("Radios on");
    expect(screen.getByTestId("wifi-tiles")).toHaveTextContent("Radios");
    expect(within(radios).getAllByRole("row")[0]!).not.toHaveTextContent(
      "Status",
    );

    const ssids: HTMLElement = screen.getByTestId("wifi-ssids");
    expect(ssids).toHaveTextContent("Office");
    expect(ssids).toHaveTextContent("2.4 GHz");
    expect(ssids).toHaveTextContent("5");
  });
});

describe("the empty Wi-Fi tab", () => {
  const UNIFI_IDENTITY: Partial<NetworkDevice> = {
    sysObjectId: "1.3.6.1.4.1.41112",
    sysDescr: "U6-Pro 6.5.28.14491",
  };

  test("asks for what it needs to name the device's template", async () => {
    deviceRow = deviceWith({});

    renderWiFi();

    await waitFor(() => {
      expect(screen.getByText("No Wi-Fi radios reported")).toBeInTheDocument();
    });

    expect(getItemCalls[0]).toMatchObject({
      snmpTableSnapshot: true,
      snmpTables: true,
      sysObjectId: true,
      sysDescr: true,
      monitoringMethod: true,
      oidTemplateId: true,
    });
  });

  test("offers the access point's own template, and applies it with one click", async () => {
    deviceRow = deviceWith(UNIFI_IDENTITY);
    const ownOid: SnmpOid = { oid: "1.3.6.1.2.1.1.3.0", name: "Uptime" };
    freshRow = deviceWith({ ...UNIFI_IDENTITY, snmpOids: [ownOid] });

    renderWiFi();

    await waitFor(() => {
      expect(screen.getByText("Wi-Fi template available")).toBeInTheDocument();
    });

    expect(
      screen.getByTestId("network-device-wifi-empty-description"),
    ).toHaveTextContent("Ubiquiti UniFi Access Points");

    fireEvent.click(screen.getByTestId("network-device-wifi-apply-template"));

    await waitFor(() => {
      expect(screen.getByText("Template applied")).toBeInTheDocument();
    });

    // A fresh read before the write, with everything the merge needs.
    expect(getItemCalls[1]).toMatchObject({
      snmpOids: true,
      snmpTables: true,
      monitoringMethod: true,
      oidTemplateId: true,
    });

    expect(updates).toHaveLength(1);
    expect(updates[0]!.id).toBe("0193c0de-7777-4aaa-8bbb-000000000007");

    const oids: Array<SnmpOid> = updates[0]!.data["snmpOids"] as Array<SnmpOid>;
    const tables: Array<SnmpTableDefinition> = updates[0]!.data[
      "snmpTables"
    ] as Array<SnmpTableDefinition>;

    // The device's own OID first and untouched, the template's after it.
    expect(oids[0]).toEqual(ownOid);
    expect(oids.length).toBe(
      1 + SnmpVendorTemplateUtil.getById("ubiquiti-unifi-ap")!.oids.length,
    );
    expect(
      tables.map((table: SnmpTableDefinition) => {
        return table.key;
      }),
    ).toEqual(["wifi_radios", "wifi_ssids", "cpu_cores"]);

    expect(
      screen.getByTestId("network-device-wifi-empty-description"),
    ).toHaveTextContent("after its next poll");
    expect(
      screen.queryByTestId("network-device-wifi-apply-template"),
    ).not.toBeInTheDocument();
  });

  test("says why it could not apply, and writes nothing", async () => {
    deviceRow = deviceWith(UNIFI_IDENTITY);
    freshRow = deviceWith(UNIFI_IDENTITY);
    updateError = new Error("You do not have permission to edit this device.");

    renderWiFi();

    await waitFor(() => {
      expect(
        screen.getByTestId("network-device-wifi-apply-template"),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("network-device-wifi-apply-template"));

    await waitFor(() => {
      expect(
        screen.getByTestId("network-device-wifi-apply-error"),
      ).toBeInTheDocument();
    });

    expect(updates).toHaveLength(0);
    expect(screen.queryByText("Template applied")).not.toBeInTheDocument();
  });

  test("does not write over a device that changed since the page opened", async () => {
    deviceRow = deviceWith(UNIFI_IDENTITY);
    // Someone linked it to an OID Collection Template meanwhile.
    freshRow = deviceWith({
      ...UNIFI_IDENTITY,
      oidTemplateId: new ObjectID("33333333-3333-4333-8333-333333333333"),
    });

    renderWiFi();

    await waitFor(() => {
      expect(
        screen.getByTestId("network-device-wifi-apply-template"),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("network-device-wifi-apply-template"));

    await waitFor(() => {
      expect(
        screen.getByTestId("network-device-wifi-apply-error"),
      ).toHaveTextContent("This device changed since the page opened");
    });

    expect(updates).toHaveLength(0);
  });

  test("waits for the next poll when the device already walks the template's tables", async () => {
    deviceRow = deviceWith({
      ...UNIFI_IDENTITY,
      snmpTables: SnmpVendorTemplateUtil.getById("ubiquiti-unifi-ap")!.tables,
    });

    renderWiFi();

    await waitFor(() => {
      expect(
        screen.getByTestId("network-device-wifi-empty-description"),
      ).toHaveTextContent("after its next successful SNMP poll");
    });

    expect(
      screen.queryByTestId("network-device-wifi-apply-template"),
    ).not.toBeInTheDocument();
  });

  test.each([
    [{}, "has not been read over SNMP yet"],
    [
      { ...UNIFI_IDENTITY, monitoringMethod: "Monitor" },
      "Switch it to probe polling",
    ],
    [
      {
        ...UNIFI_IDENTITY,
        oidTemplateId: new ObjectID("33333333-3333-4333-8333-333333333333"),
      },
      "OID Collection Template",
    ],
    [
      { sysObjectId: "1.3.6.1.4.1.9.1.1208", sysDescr: "Cisco IOS Software" },
      "Cambium, Ubiquiti UniFi, HPE Aruba and Extreme Networks",
    ],
  ])(
    "explains a device it cannot offer a template to (%j)",
    async (fields: Partial<NetworkDevice>, text: string) => {
      deviceRow = deviceWith(fields);

      renderWiFi();

      await waitFor(() => {
        expect(
          screen.getByTestId("network-device-wifi-empty-description"),
        ).toHaveTextContent(text);
      });

      expect(screen.getByText("No Wi-Fi radios reported")).toBeInTheDocument();
      expect(
        screen.queryByTestId("network-device-wifi-apply-template"),
      ).not.toBeInTheDocument();
    },
  );

  test("always links the table of what each vendor reports over SNMP", async () => {
    deviceRow = deviceWith({});

    renderWiFi();

    await waitFor(() => {
      expect(
        screen.getByTestId("network-device-wifi-vendors-docs"),
      ).toBeInTheDocument();
    });

    const link: HTMLAnchorElement | null = screen
      .getByTestId("network-device-wifi-vendors-docs")
      .querySelector("a");

    expect(link?.getAttribute("href")).toContain(
      "/monitor/network-device-monitor#supported-wi-fi-vendors",
    );
    expect(link?.getAttribute("target")).toBe("_blank");
  });
});

describe("the SNMP table editor and card for the Wi-Fi tables", () => {
  test("shows the arithmetic a template column reads its numbers with", () => {
    render(
      <MemoryRouter>
        <SnmpTableEditor
          value={SnmpVendorTemplateUtil.getById("aruba-instant")!.tables!}
          onChange={() => {
            return undefined;
          }}
        />
      </MemoryRouter>,
    );

    // The radio table's noise floor is its fourth column.
    expect(
      screen.getByTestId("snmp-table-1-column-3-adjustment"),
    ).toHaveTextContent("value × −1");
    // A column read as it comes says nothing.
    expect(
      screen.queryByTestId("snmp-table-1-column-1-adjustment"),
    ).not.toBeInTheDocument();
  });

  test("keeps a column's adjustment and a table's flags through an edit", () => {
    let latest: Array<SnmpTableDefinition> = [];

    render(
      <MemoryRouter>
        <SnmpTableEditor
          value={SnmpVendorTemplateUtil.getById("aruba-instant")!.tables!}
          onChange={(value: Array<SnmpTableDefinition>) => {
            latest = value;
          }}
        />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByTestId("snmp-table-1-column-3-name"), {
      target: { value: "Noise" },
    });

    expect(latest[1]!.columns[3]!.name).toBe("Noise");
    expect(latest[1]!.columns[3]!.scale).toBe(-1);
    expect(latest[1]!.skipNameOnlyRows).toBe(true);
  });

  test("says when a table is named by its text index", () => {
    render(
      <MemoryRouter>
        <SnmpTableEditor
          value={
            SnmpVendorTemplateUtil.getById("aruba-mobility-controller")!.tables!
          }
          onChange={() => {
            return undefined;
          }}
        />
      </MemoryRouter>,
    );

    // The SSID table, the third, is indexed by the SSID.
    expect(screen.getByTestId("snmp-table-2-index-is-text")).toHaveTextContent(
      "indexes this table by name",
    );
    expect(
      screen.queryByTestId("snmp-table-0-index-is-text"),
    ).not.toBeInTheDocument();
  });

  test("offers the access points kind", () => {
    render(
      <MemoryRouter>
        <SnmpTableSnapshotCard snapshot={arubaInstant()[0]!} />
      </MemoryRouter>,
    );

    expect(
      screen.getByText(/One row per access point the controller manages\./),
    ).toBeInTheDocument();
  });
});

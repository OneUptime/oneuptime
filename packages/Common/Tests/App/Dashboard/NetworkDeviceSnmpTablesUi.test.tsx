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
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * The SNMP table surfaces of a network device, RENDERED: the per-table card,
 * the SNMP Tables tab, the Wi-Fi tab and the table definition editor. The
 * device row comes from a ModelAPI stub, so each case is one device shape.
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
        return new RouteType("/dashboard/project/network-devices/x/tables");
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

import SnmpTableSnapshotCard from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/SnmpTableSnapshotCard";
import SnmpTableEditor from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/SnmpTableEditor";
import NetworkDeviceTables from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/View/Tables";
import NetworkDeviceWiFi from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/View/WiFi";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceOidTemplate from "../../../Models/DatabaseModels/NetworkDeviceOidTemplate";
import Route from "../../../Types/API/Route";
import {
  SnmpTableDefinition,
  SnmpTableSnapshot,
} from "../../../Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpTableListUtil from "../../../Types/Monitor/SnmpMonitor/SnmpTableListUtil";
import SnmpVendorTemplateUtil from "../../../Types/Monitor/SnmpMonitor/SnmpVendorTemplate";

const IPSEC: string = "1.3.6.1.4.1.2604.5.1.6.1.1.1.1";
const RADIO: string = "1.3.6.1.4.1.17713.22.1.2.1";

function sophosTunnels(): SnmpTableSnapshot {
  return SnmpTableListUtil.materialize({
    tables: SnmpVendorTemplateUtil.getById("sophos-sfos")!.tables!,
    collectedAt: new Date(),
    results: [
      {
        key: "ipsec_tunnels",
        rows: [
          {
            index: "1",
            values: {
              [`${IPSEC}.2`]: "HQ-Branch1",
              [`${IPSEC}.9`]: 1,
              [`${IPSEC}.10`]: 1,
              [`${IPSEC}.6`]: 2,
            },
          },
          {
            index: "2",
            values: {
              [`${IPSEC}.2`]: "HQ-Branch2",
              [`${IPSEC}.9`]: 0,
              [`${IPSEC}.10`]: 1,
              [`${IPSEC}.6`]: 2,
            },
          },
        ],
      },
    ],
  })[0]!;
}

function cambiumRadios(): Array<SnmpTableSnapshot> {
  return SnmpTableListUtil.materialize({
    tables: SnmpVendorTemplateUtil.getById("cambium-wifi-ap")!.tables!,
    collectedAt: new Date(),
    results: [
      {
        key: "wifi_radios",
        rows: [
          {
            index: "2",
            values: {
              [`${RADIO}.3`]: "5GHz",
              [`${RADIO}.6`]: "36",
              [`${RADIO}.7`]: "80MHz",
              [`${RADIO}.8`]: 21,
              [`${RADIO}.5`]: 11,
              [`${RADIO}.16`]: "-92",
              [`${RADIO}.18`]: "20/10/10/0",
              [`${RADIO}.13`]: "ON",
            },
          },
        ],
      },
      { key: "wifi_ssids", rows: [] },
    ],
  });
}

function renderInRouter(element: React.ReactElement): void {
  render(<MemoryRouter>{element}</MemoryRouter>);
}

const pageRoute: Route = new Route("/dashboard/project/network-devices/x");

beforeEach(() => {
  deviceRow = null;
  getItemSelects = [];
});

afterEach(() => {
  cleanup();
});

describe("SnmpTableSnapshotCard", () => {
  test("lists every row with labelled values and marks the unhealthy one", () => {
    renderInRouter(<SnmpTableSnapshotCard snapshot={sophosTunnels()} />);

    expect(screen.getByText("IPsec Tunnels")).toBeInTheDocument();
    expect(screen.getByText("HQ-Branch1")).toBeInTheDocument();
    expect(screen.getByText("HQ-Branch2")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("inactive")).toHaveClass("text-red-700");
    expect(screen.getByText("1 row is not healthy.")).toBeInTheDocument();
    expect(screen.getAllByText("site-to-site")).toHaveLength(2);
  });

  test("says when the last walk failed and when rows were cut", () => {
    renderInRouter(
      <SnmpTableSnapshotCard
        snapshot={{
          ...sophosTunnels(),
          failureCause: "Request timed out",
          isTruncated: true,
        }}
      />,
    );

    expect(
      screen.getByText(/The last walk of this table failed/),
    ).toHaveTextContent("Request timed out");
    expect(
      screen.getByText(/More rows exist than this table keeps/),
    ).toBeInTheDocument();
  });

  test("explains an empty table", () => {
    renderInRouter(
      <SnmpTableSnapshotCard snapshot={{ ...sophosTunnels(), rows: [] }} />,
    );

    expect(
      screen.getByText(/The device returned no rows for this table/),
    ).toBeInTheDocument();
  });
});

describe("SNMP Tables tab", () => {
  test("renders a card per walked table and lists tables still waiting", async () => {
    const template: NetworkDeviceOidTemplate = new NetworkDeviceOidTemplate();
    template.tables = SnmpVendorTemplateUtil.getById("sophos-sfos")!.tables!;

    const device: NetworkDevice = new NetworkDevice();
    device.snmpTableSnapshot = [sophosTunnels()];
    device.oidTemplate = template;
    deviceRow = device;

    renderInRouter(<NetworkDeviceTables pageRoute={pageRoute} />);

    await waitFor(() => {
      expect(screen.getByText("HQ-Branch2")).toBeInTheDocument();
    });

    // The CPU table is configured on the template but not walked yet.
    expect(screen.getByText("Waiting for the first walk")).toBeInTheDocument();
    expect(screen.getByText("CPU Cores")).toBeInTheDocument();

    expect(getItemSelects[0]).toMatchObject({
      snmpTableSnapshot: true,
      snmpTables: true,
      oidTemplate: { tables: true },
    });
  });

  test("explains how to get tables when the device has none", async () => {
    deviceRow = new NetworkDevice();

    renderInRouter(<NetworkDeviceTables pageRoute={pageRoute} />);

    await waitFor(() => {
      expect(
        screen.getByText("No SNMP tables on this device"),
      ).toBeInTheDocument();
    });
  });
});

describe("Wi-Fi tab", () => {
  test("shows each radio's channel, frequency, width and power", async () => {
    const device: NetworkDevice = new NetworkDevice();
    device.snmpTableSnapshot = cambiumRadios();
    deviceRow = device;

    renderInRouter(<NetworkDeviceWiFi pageRoute={pageRoute} />);

    await waitFor(() => {
      expect(screen.getByTestId("wifi-radios")).toBeInTheDocument();
    });

    const radios: HTMLElement = screen.getByTestId("wifi-radios");
    expect(radios).toHaveTextContent("5 GHz");
    expect(radios).toHaveTextContent("36");
    expect(radios).toHaveTextContent("5180 MHz");
    expect(radios).toHaveTextContent("80 MHz");
    expect(radios).toHaveTextContent("21 dBm");
    expect(radios).toHaveTextContent("-92 dBm");
    expect(radios).toHaveTextContent("20 %");
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
    // The clients tile and the radio's own row both read 11.
    expect(screen.getAllByText("11")).toHaveLength(2);
  });

  test("explains how to enable Wi-Fi data when no radio table is walked", async () => {
    deviceRow = new NetworkDevice();

    renderInRouter(<NetworkDeviceWiFi pageRoute={pageRoute} />);

    await waitFor(() => {
      expect(screen.getByText("No Wi-Fi radios reported")).toBeInTheDocument();
    });
  });
});

describe("SnmpTableEditor", () => {
  test("adds a table, edits it and reports a malformed column inline", () => {
    let latest: Array<SnmpTableDefinition> = [];

    renderInRouter(
      <SnmpTableEditor
        value={[]}
        onChange={(value: Array<SnmpTableDefinition>) => {
          latest = value;
        }}
      />,
    );

    fireEvent.click(screen.getByTestId("snmp-table-add"));
    expect(latest).toHaveLength(1);

    fireEvent.change(screen.getByTestId("snmp-table-0-name"), {
      target: { value: "IPsec Tunnels" },
    });
    expect(latest[0]!.name).toBe("IPsec Tunnels");

    fireEvent.change(screen.getByTestId("snmp-table-0-column-0-oid"), {
      target: { value: "not-an-oid" },
    });

    expect(screen.getByTestId("snmp-table-0-error")).toHaveTextContent(
      '"not-an-oid" is not a numeric OID',
    );

    fireEvent.change(screen.getByTestId("snmp-table-0-column-0-oid"), {
      target: { value: `${IPSEC}.9` },
    });
    expect(screen.queryByTestId("snmp-table-0-error")).not.toBeInTheDocument();
  });

  test("parses value labels and healthy values as they are typed", () => {
    let latest: Array<SnmpTableDefinition> = [];

    renderInRouter(
      <SnmpTableEditor
        value={[
          {
            key: "ipsec_tunnels",
            name: "IPsec Tunnels",
            columns: [{ oid: `${IPSEC}.9`, name: "Status" }],
          },
        ]}
        onChange={(value: Array<SnmpTableDefinition>) => {
          latest = value;
        }}
      />,
    );

    fireEvent.change(screen.getByTestId("snmp-table-0-column-0-value-labels"), {
      target: { value: "0=inactive, 1=active" },
    });
    fireEvent.change(screen.getByTestId("snmp-table-0-column-0-healthy"), {
      target: { value: "1" },
    });

    expect(latest[0]!.columns[0]!.valueLabels).toEqual({
      "0": "inactive",
      "1": "active",
    });
    expect(latest[0]!.columns[0]!.healthyValues).toEqual(["1"]);
  });

  test("adds and removes columns and tables", () => {
    let latest: Array<SnmpTableDefinition> = [];

    renderInRouter(
      <SnmpTableEditor
        value={[
          {
            key: "a",
            name: "A",
            columns: [{ oid: "1.3.6.1.4.1.9.1", name: "x" }],
          },
        ]}
        onChange={(value: Array<SnmpTableDefinition>) => {
          latest = value;
        }}
      />,
    );

    fireEvent.click(screen.getByTestId("snmp-table-0-add-column"));
    expect(latest[0]!.columns).toHaveLength(2);

    fireEvent.click(screen.getByTestId("snmp-table-0-column-0-remove"));
    expect(latest[0]!.columns).toHaveLength(1);

    fireEvent.click(screen.getByTestId("snmp-table-0-remove"));
    expect(latest).toEqual([]);
  });
});

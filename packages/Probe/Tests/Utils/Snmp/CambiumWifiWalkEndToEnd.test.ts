// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import dgram from "dgram";
import snmp from "net-snmp";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpMonitorResponse, {
  SnmpOidResponse,
} from "Common/Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import {
  SnmpTableResult,
  SnmpTableSnapshot,
} from "Common/Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpTableListUtil from "Common/Types/Monitor/SnmpMonitor/SnmpTableListUtil";
import SnmpVendorTemplateUtil, {
  SnmpVendorTemplate,
} from "Common/Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import WifiRadioUtil, {
  WifiBand,
  WifiSummary,
  WifiTablesState,
} from "Common/Utils/NetworkDevice/WifiRadioUtil";
import SnmpMonitor from "../../../Utils/Monitors/MonitorTypes/SnmpMonitor";

/*
 * The poll a probe runs for a Cambium Enterprise Wi-Fi access point, over a
 * real UDP socket: a net-snmp agent on loopback serves the CAMBIUM-AP-MIB
 * objects the vendor template reads - a Wi-Fi 7 access point with three
 * radios, numbered from 0 the way the access points number them - and the
 * probe's own SnmpMonitor polls it with the template's health OIDs and its
 * tables, as the server hands them out.
 *
 * It pins the promise behind ProbeCapability.SnmpTables: a walk whose config
 * lists tables always reports `tableResults`, one per table, whether the
 * device has the table or not. The server reads a walk WITHOUT them as one
 * by a probe from before SNMP tables (and asks for the probe to be updated),
 * so a probe that declared the capability and dropped them would be blamed
 * for being too old.
 */

const CAMBIUM: string = "1.3.6.1.4.1.17713.22";
const AP: string = `${CAMBIUM}.1.1.1`;
const RADIO_ENTRY: string = `${CAMBIUM}.1.2.1`;
const WLAN_ENTRY: string = `${CAMBIUM}.1.4.1`;

const COMMUNITY: string = "oneuptime-test";

type SnmpAgent = {
  getAuthorizer: () => { addCommunity: (community: string) => void };
  getMib: () => {
    registerProvider: (provider: unknown) => void;
    setScalarValue: (name: string, value: unknown) => void;
    addTableRow: (name: string, row: Array<unknown>) => void;
  };
  close: () => void;
};

function findFreeUdpPort(): Promise<number> {
  return new Promise(
    (resolve: (port: number) => void, reject: (reason?: Error) => void) => {
      const socket: dgram.Socket = dgram.createSocket("udp4");

      socket.once("error", (error: Error) => {
        reject(error);
      });

      socket.bind(0, "127.0.0.1", () => {
        const port: number = socket.address().port;
        socket.close(() => {
          resolve(port);
        });
      });
    },
  );
}

function scalar(
  agent: SnmpAgent,
  data: { name: string; oid: string; type: number; value: unknown },
): void {
  agent.getMib().registerProvider({
    name: data.name,
    type: snmp.MibProviderType.Scalar,
    oid: data.oid,
    scalarType: data.type,
    maxAccess: snmp.MaxAccess["read-only"],
  });
  agent.getMib().setScalarValue(data.name, data.value);
}

function column(
  number: number,
  name: string,
  type: number,
): Record<string, unknown> {
  return {
    number: number,
    name: name,
    type: type,
    maxAccess: snmp.MaxAccess["read-only"],
  };
}

async function startAgent(withWifiTables: boolean): Promise<{
  agent: SnmpAgent;
  port: number;
}> {
  const port: number = await findFreeUdpPort();

  const agent: SnmpAgent = snmp.createAgent(
    { port: port, disableAuthorization: false },
    () => {
      // Agent-side errors surface to the client as a timeout.
    },
  ) as unknown as SnmpAgent;

  agent.getAuthorizer().addCommunity(COMMUNITY);

  scalar(agent, {
    name: "sysObjectID",
    oid: "1.3.6.1.2.1.1.2",
    type: snmp.ObjectType.OID,
    value: CAMBIUM,
  });

  // The access point's own values, which its agent answers at ".0".
  scalar(agent, {
    name: "cambiumAPCPUUtilization",
    oid: `${AP}.6`,
    type: snmp.ObjectType.Integer,
    value: 53,
  });
  scalar(agent, {
    name: "cambiumAPMemoryFree",
    oid: `${AP}.7`,
    type: snmp.ObjectType.Integer,
    value: 25,
  });
  scalar(agent, {
    name: "cambiumAPCnmConstaus",
    oid: `${AP}.12`,
    type: snmp.ObjectType.OctetString,
    value: "Connected",
  });
  scalar(agent, {
    name: "cambiumAPTotalClients",
    oid: `${AP}.14`,
    type: snmp.ObjectType.Integer,
    value: 9,
  });

  if (withWifiTables) {
    agent.getMib().registerProvider({
      name: "cambiumRadioEntry",
      type: snmp.MibProviderType.Table,
      oid: RADIO_ENTRY,
      maxAccess: snmp.MaxAccess["not-accessible"],
      tableColumns: [
        column(1, "cambiumRadioIndex", snmp.ObjectType.Integer),
        column(3, "cambiumRadioBandType", snmp.ObjectType.OctetString),
        column(5, "cambiumRadioNumClients", snmp.ObjectType.Integer),
        column(6, "cambiumRadioChannel", snmp.ObjectType.OctetString),
        column(7, "cambiumRadioChannelWidth", snmp.ObjectType.OctetString),
        column(8, "cambiumRadioTransmitPower", snmp.ObjectType.Integer),
        column(13, "cambiumRadioState", snmp.ObjectType.OctetString),
        column(16, "cambiumRadioNoiseFloor", snmp.ObjectType.OctetString),
        column(18, "cambiumRadioAirtime", snmp.ObjectType.OctetString),
      ],
      tableIndex: [{ columnName: "cambiumRadioIndex" }],
    });

    const radios: Array<Array<unknown>> = [
      [0, "2.4GHz", 0, "-", "20MHz", 0, "OFF", "0", "0/0/0/0/0"],
      [1, "5GHz", 5, "44", "40MHz", 17, "ON", "-107", "5/1452/2/0/0"],
      [2, "6GHz", 4, "5", "80MHz", 18, "ON", "-104", "6/1533/3/2/0"],
    ];

    for (const radio of radios) {
      agent.getMib().addTableRow("cambiumRadioEntry", radio);
    }

    agent.getMib().registerProvider({
      name: "cambiumWlanEntry",
      type: snmp.MibProviderType.Table,
      oid: WLAN_ENTRY,
      maxAccess: snmp.MaxAccess["not-accessible"],
      tableColumns: [
        column(1, "cambiumWlanIndex", snmp.ObjectType.Integer),
        column(2, "cambiumWlanSsid", snmp.ObjectType.OctetString),
        column(3, "cambiumWlanBand", snmp.ObjectType.OctetString),
        column(4, "cambiumWlanVlan", snmp.ObjectType.Integer),
        column(7, "cambiumWlanNumClients", snmp.ObjectType.Integer),
      ],
      tableIndex: [{ columnName: "cambiumWlanIndex" }],
    });

    agent.getMib().addTableRow("cambiumWlanEntry", [
      0,
      "Workshop",
      "5GHz,6GHz",
      30,
      6,
    ]);
    agent.getMib().addTableRow("cambiumWlanEntry", [
      1,
      "Visitors",
      "5GHz,6GHz",
      40,
      3,
    ]);
  }

  return { agent: agent, port: port };
}

const template: SnmpVendorTemplate =
  SnmpVendorTemplateUtil.getById("cambium-wifi-ap")!;

// The poll config the server hands out for a device with the template applied.
function pollConfig(
  port: number,
  overrides: Partial<MonitorStepSnmpMonitor> = {},
): MonitorStepSnmpMonitor {
  return {
    snmpVersion: SnmpVersion.V2c,
    hostname: "127.0.0.1",
    port: port,
    communityString: COMMUNITY,
    oids: template.oids.map((oid: { oid: string; name?: string }) => {
      return { oid: oid.oid, name: oid.name };
    }),
    timeout: 4000,
    retries: 0,
    monitorInterfaces: false,
    tables: SnmpTableListUtil.toWalkRequests(template.tables!),
    ...overrides,
  };
}

async function poll(config: MonitorStepSnmpMonitor): Promise<SnmpMonitorResponse> {
  const response: SnmpMonitorResponse | null = await SnmpMonitor.query(config, {
    timeout: 4000,
  });

  expect(response).not.toBeNull();
  return response!;
}

let accessPoint: { agent: SnmpAgent; port: number } | undefined = undefined;
let tablelessAccessPoint: { agent: SnmpAgent; port: number } | undefined =
  undefined;

beforeAll(async () => {
  accessPoint = await startAgent(true);
  tablelessAccessPoint = await startAgent(false);
});

afterAll(() => {
  accessPoint?.agent.close();
  tablelessAccessPoint?.agent.close();
});

describe("a Cambium Wi-Fi 7 access point polled over UDP with the vendor template", () => {
  test("answers the template's health OIDs at their .0 instances", async () => {
    const response: SnmpMonitorResponse = await poll(
      pollConfig(accessPoint!.port),
    );

    expect(response.isOnline).toBe(true);

    const values: Record<string, unknown> = {};

    for (const oidResponse of response.oidResponses as Array<SnmpOidResponse>) {
      values[oidResponse.name || oidResponse.oid] = oidResponse.value;
    }

    expect(values).toEqual({
      "CPU %": 53,
      "Memory Free": 25,
      "Wi-Fi Clients": 9,
      "cnMaestro Connection": "Connected",
    });
  });

  test("walks every radio and SSID, rows numbered from 0", async () => {
    const response: SnmpMonitorResponse = await poll(
      pollConfig(accessPoint!.port),
    );

    const results: Array<SnmpTableResult> = response.tableResults!;

    expect(
      results.map((result: SnmpTableResult) => {
        return [result.key, result.failureCause];
      }),
    ).toEqual([
      ["wifi_radios", undefined],
      ["wifi_ssids", undefined],
    ]);

    expect(
      results[0]!.rows.map((row: { index: string }) => {
        return row.index;
      }),
    ).toEqual(["0", "1", "2"]);

    expect(results[0]!.rows[2]!.values).toEqual({
      [`${RADIO_ENTRY}.3`]: "6GHz",
      [`${RADIO_ENTRY}.6`]: "5",
      [`${RADIO_ENTRY}.7`]: "80MHz",
      [`${RADIO_ENTRY}.8`]: 18,
      [`${RADIO_ENTRY}.5`]: 4,
      [`${RADIO_ENTRY}.16`]: "-104",
      [`${RADIO_ENTRY}.18`]: "6/1533/3/2/0",
      [`${RADIO_ENTRY}.13`]: "ON",
    });

    expect(results[1]!.rows).toHaveLength(2);
  });

  test("gives the Wi-Fi tab every radio's band, channel, frequency, width and power", async () => {
    const response: SnmpMonitorResponse = await poll(
      pollConfig(accessPoint!.port),
    );

    const snapshots: Array<SnmpTableSnapshot> = SnmpTableListUtil.materialize({
      tables: template.tables!,
      results: response.tableResults,
      collectedAt: new Date(),
    });

    const summary: WifiSummary = WifiRadioUtil.getSummary(snapshots);

    expect(WifiRadioUtil.getTablesState(summary)).toBe(
      WifiTablesState.HasRows,
    );

    expect(
      summary.radios.map((radio: WifiSummary["radios"][number]) => {
        return [
          radio.band,
          radio.isOn,
          radio.channel,
          radio.frequencyMHz,
          radio.channelWidthMHz,
          radio.txPowerDbm,
          radio.clients,
        ];
      }),
    ).toEqual([
      [WifiBand.Band2_4GHz, false, undefined, undefined, 20, 0, 0],
      [WifiBand.Band5GHz, true, 44, 5220, 40, 17, 5],
      [WifiBand.Band6GHz, true, 5, 5975, 80, 18, 4],
    ]);

    expect(summary.totalClients).toBe(9);
    expect(
      summary.ssids.map((ssid: WifiSummary["ssids"][number]) => {
        return [ssid.ssid, ssid.bandText, ssid.band, ssid.clients];
      }),
    ).toEqual([
      ["Workshop", "5GHz,6GHz", undefined, 6],
      ["Visitors", "5GHz,6GHz", undefined, 3],
    ]);
  });
});

describe("what a probe that walks tables always reports", () => {
  test("a table the device does not have comes back as a table with no rows, not as no table", async () => {
    const response: SnmpMonitorResponse = await poll(
      pollConfig(tablelessAccessPoint!.port),
    );

    expect(response.isOnline).toBe(true);
    expect(response.tableResults).toEqual([
      { key: "wifi_radios", rows: [] },
      { key: "wifi_ssids", rows: [] },
    ]);

    // The Wi-Fi tab then says the device reported nothing - not "update the probe".
    const summary: WifiSummary = WifiRadioUtil.getSummary(
      SnmpTableListUtil.materialize({
        tables: template.tables!,
        results: response.tableResults,
      }),
    );

    expect(WifiRadioUtil.getTablesState(summary)).toBe(
      WifiTablesState.NoRows,
    );
  });

  test("a config that lists no tables reports no tableResults at all", async () => {
    const response: SnmpMonitorResponse = await poll(
      pollConfig(accessPoint!.port, { tables: undefined }),
    );

    expect(response.isOnline).toBe(true);
    expect("tableResults" in response).toBe(false);
  });

  test("a table whose walk fails still comes back, with why", async () => {
    // Nothing answers on this port: every request times out.
    const silentPort: number = await findFreeUdpPort();

    const results: Array<SnmpTableResult> = await SnmpMonitor.walkTables(
      pollConfig(silentPort, { timeout: 500 }),
      { timeout: 500 },
    );

    expect(
      results.map((result: SnmpTableResult) => {
        return result.key;
      }),
    ).toEqual(["wifi_radios", "wifi_ssids"]);

    for (const result of results) {
      expect(result.rows).toEqual([]);
      expect(result.failureCause).toBeTruthy();
    }
  });
});

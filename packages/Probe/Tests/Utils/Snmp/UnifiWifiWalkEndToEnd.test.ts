// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import dgram from "dgram";
import snmp from "net-snmp";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpOid from "Common/Types/Monitor/SnmpMonitor/SnmpOid";
import SnmpMonitorResponse, {
  SnmpOidResponse,
} from "Common/Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import {
  SnmpTableColumn,
  SnmpTableDefinition,
  SnmpTableResult,
  SnmpTableResultRow,
  SnmpTableSnapshot,
  SnmpTableSnapshotRow,
} from "Common/Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpTableListUtil from "Common/Types/Monitor/SnmpMonitor/SnmpTableListUtil";
import SnmpVendorTemplateUtil, {
  SnmpVendorTemplate,
} from "Common/Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import WifiRadioUtil, {
  WifiSummary,
} from "Common/Utils/NetworkDevice/WifiRadioUtil";
import SnmpMonitor from "../../../Utils/Monitors/MonitorTypes/SnmpMonitor";

/*
 * Issue #4730 over a real UDP socket: a net-snmp agent on loopback answers
 * the UBNT-UniFi-MIB objects the UniFi template reads, shaped like the
 * reported UAP-AC-Lite - two radios (wifi0 on channel 6, wifi1 on 149), and
 * a VAP table holding DEMO on both bands, UniFi's device adoption network
 * on both bands (usage "user", an athN interface, as the agent reports it)
 * and its wireless mesh link on 5 GHz (usage "downlink", interface vwire3).
 * The adoption and mesh ids are invented in the shape UniFi gives them.
 *
 * The probe walks every VAP: it knows nothing of networks. The server's
 * materialize then keeps DEMO's two rows, for a device set up from today's
 * template and for one that copied the template before the fix alike.
 */

const UNIFI: string = "1.3.6.1.4.1.41112";
const RADIO_ENTRY: string = `${UNIFI}.1.6.1.1.1`;
const VAP_ENTRY: string = `${UNIFI}.1.6.1.2.1`;

const COMMUNITY: string = "oneuptime-test";

const ADOPTION_ESSID: string = "element-c3a0f87e2d6b1594";
const MESH_LINK_ESSID: string = "vwire-58e1b2c9d70a4f36";

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

async function startAgent(): Promise<{ agent: SnmpAgent; port: number }> {
  const port: number = await findFreeUdpPort();

  const agent: SnmpAgent = snmp.createAgent(
    { port: port, disableAuthorization: false },
    () => {
      // Agent-side errors surface to the client as a timeout.
    },
  ) as unknown as SnmpAgent;

  agent.getAuthorizer().addCommunity(COMMUNITY);

  // The template's health OIDs.
  scalar(agent, {
    name: "unifiApSystemIsolated",
    oid: `${UNIFI}.1.6.3.2`,
    type: snmp.ObjectType.Integer,
    value: 2,
  });
  scalar(agent, {
    name: "memTotalReal",
    oid: "1.3.6.1.4.1.2021.4.5",
    type: snmp.ObjectType.Integer,
    value: 59656,
  });
  scalar(agent, {
    name: "memAvailReal",
    oid: "1.3.6.1.4.1.2021.4.6",
    type: snmp.ObjectType.Integer,
    value: 17208,
  });

  agent.getMib().registerProvider({
    name: "laEntry",
    type: snmp.MibProviderType.Table,
    oid: "1.3.6.1.4.1.2021.10.1",
    maxAccess: snmp.MaxAccess["not-accessible"],
    tableColumns: [
      column(1, "laIndex", snmp.ObjectType.Integer),
      column(3, "laLoad", snmp.ObjectType.OctetString),
    ],
    tableIndex: [{ columnName: "laIndex" }],
  });
  agent.getMib().addTableRow("laEntry", [1, "0.12"]);

  agent.getMib().registerProvider({
    name: "unifiRadioEntry",
    type: snmp.MibProviderType.Table,
    oid: RADIO_ENTRY,
    maxAccess: snmp.MaxAccess["not-accessible"],
    tableColumns: [
      column(1, "unifiRadioIndex", snmp.ObjectType.Integer),
      column(2, "unifiRadioName", snmp.ObjectType.OctetString),
      column(3, "unifiRadioRadio", snmp.ObjectType.OctetString),
      column(6, "unifiRadioCuTotal", snmp.ObjectType.Integer),
      column(7, "unifiRadioCuSelfRx", snmp.ObjectType.Integer),
      column(8, "unifiRadioCuSelfTx", snmp.ObjectType.Integer),
    ],
    tableIndex: [{ columnName: "unifiRadioIndex" }],
  });

  agent.getMib().addTableRow("unifiRadioEntry", [1, "wifi0", "ng", 22, 9, 4]);
  agent.getMib().addTableRow("unifiRadioEntry", [2, "wifi1", "na", 7, 2, 1]);

  agent.getMib().registerProvider({
    name: "unifiVapEntry",
    type: snmp.MibProviderType.Table,
    oid: VAP_ENTRY,
    maxAccess: snmp.MaxAccess["not-accessible"],
    tableColumns: [
      column(1, "unifiVapIndex", snmp.ObjectType.Integer),
      column(3, "unifiVapCcq", snmp.ObjectType.Integer),
      column(4, "unifiVapChannel", snmp.ObjectType.Integer),
      column(6, "unifiVapEssId", snmp.ObjectType.OctetString),
      column(7, "unifiVapName", snmp.ObjectType.OctetString),
      column(8, "unifiVapNumStations", snmp.ObjectType.Integer),
      column(9, "unifiVapRadio", snmp.ObjectType.OctetString),
      column(21, "unifiVapTxPower", snmp.ObjectType.Integer),
      column(22, "unifiVapUp", snmp.ObjectType.Integer),
      column(23, "unifiVapUsage", snmp.ObjectType.OctetString),
    ],
    tableIndex: [{ columnName: "unifiVapIndex" }],
  });

  // In the VAP table's order, as the issue's screenshot lists them.
  const vaps: Array<Array<unknown>> = [
    [1, 0, 6, ADOPTION_ESSID, "ath0", 0, "ng", 20, 1, "user"],
    [2, 0, 6, "DEMO", "ath1", 0, "ng", 20, 1, "user"],
    [3, 0, 149, ADOPTION_ESSID, "ath2", 0, "na", 20, 1, "user"],
    [4, 0, 149, MESH_LINK_ESSID, "vwire3", 0, "na", 20, 1, "downlink"],
    [5, 0, 149, "DEMO", "ath4", 0, "na", 20, 1, "user"],
  ];

  for (const vap of vaps) {
    agent.getMib().addTableRow("unifiVapEntry", vap);
  }

  return { agent: agent, port: port };
}

const template: SnmpVendorTemplate =
  SnmpVendorTemplateUtil.getById("ubiquiti-unifi-ap")!;

// The template's tables as a device set up before the fix copied them.
function tablesCopiedBeforeTheFix(): Array<SnmpTableDefinition> {
  return template.tables!.map(
    (table: SnmpTableDefinition): SnmpTableDefinition => {
      return {
        ...table,
        columns: table.columns.filter((tableColumn: SnmpTableColumn) => {
          return tableColumn.oid !== `${VAP_ENTRY}.7`;
        }),
      };
    },
  );
}

// The poll config the server hands out for a device with these tables.
function pollConfig(
  port: number,
  tables: Array<SnmpTableDefinition>,
): MonitorStepSnmpMonitor {
  return {
    snmpVersion: SnmpVersion.V2c,
    hostname: "127.0.0.1",
    port: port,
    communityString: COMMUNITY,
    oids: template.oids.map((oid: SnmpOid): SnmpOid => {
      return { oid: oid.oid, name: oid.name };
    }),
    timeout: 4000,
    retries: 0,
    monitorInterfaces: false,
    tables: SnmpTableListUtil.toWalkRequests(tables),
  };
}

async function poll(
  config: MonitorStepSnmpMonitor,
): Promise<SnmpMonitorResponse> {
  const response: SnmpMonitorResponse | null = await SnmpMonitor.query(config, {
    timeout: 4000,
  });

  expect(response).not.toBeNull();
  expect(response!.isOnline).toBe(true);
  return response!;
}

function ssidTableOf(
  results: Array<SnmpTableResult> | undefined,
): SnmpTableResult {
  const result: SnmpTableResult | undefined = (results || []).find(
    (candidate: SnmpTableResult): boolean => {
      return candidate.key === "wifi_ssids";
    },
  );

  expect(result).toBeDefined();
  return result!;
}

let accessPoint: { agent: SnmpAgent; port: number } | undefined = undefined;

beforeAll(async () => {
  accessPoint = await startAgent();
});

afterAll(() => {
  accessPoint?.agent.close();
});

describe("the issue #4730 UniFi access point, polled over UDP with the vendor template", () => {
  test("answers the template's health OIDs", async () => {
    const response: SnmpMonitorResponse = await poll(
      pollConfig(accessPoint!.port, template.tables!),
    );

    const values: Record<string, unknown> = {};

    for (const oidResponse of response.oidResponses as Array<SnmpOidResponse>) {
      values[oidResponse.name || oidResponse.oid] = oidResponse.value;
    }

    expect(values).toEqual({
      Isolated: 2,
      "Load Average (1 min)": "0.12",
      "Total RAM (KB)": 59656,
      "Available RAM (KB)": 17208,
    });
  });

  test("walks every VAP the access point reports, its interface and usage included", async () => {
    const response: SnmpMonitorResponse = await poll(
      pollConfig(accessPoint!.port, template.tables!),
    );

    const ssids: SnmpTableResult = ssidTableOf(response.tableResults);

    expect(ssids.failureCause).toBeUndefined();
    expect(
      ssids.rows.map((row: SnmpTableResultRow): Array<unknown> => {
        return [
          row.index,
          row.values[`${VAP_ENTRY}.6`],
          row.values[`${VAP_ENTRY}.7`],
          row.values[`${VAP_ENTRY}.23`],
        ];
      }),
    ).toEqual([
      ["1", ADOPTION_ESSID, "ath0", "user"],
      ["2", "DEMO", "ath1", "user"],
      ["3", ADOPTION_ESSID, "ath2", "user"],
      ["4", MESH_LINK_ESSID, "vwire3", "downlink"],
      ["5", "DEMO", "ath4", "user"],
    ]);
  });

  test("gives the Wi-Fi tab DEMO on each band, two radios and two SSIDs", async () => {
    const response: SnmpMonitorResponse = await poll(
      pollConfig(accessPoint!.port, template.tables!),
    );

    const snapshots: Array<SnmpTableSnapshot> = SnmpTableListUtil.materialize({
      tables: template.tables!,
      results: response.tableResults,
      collectedAt: new Date(),
    });

    const summary: WifiSummary = WifiRadioUtil.getSummary(snapshots);

    expect(
      summary.ssids.map((ssid: WifiSummary["ssids"][number]): string => {
        return `${ssid.ssid}|${ssid.band}|${ssid.clients}`;
      }),
    ).toEqual(["DEMO|2.4 GHz|0", "DEMO|5 GHz|0"]);

    expect(
      summary.radios.map((radio: WifiSummary["radios"][number]) => {
        return [
          radio.name,
          radio.channel,
          radio.frequencyMHz,
          radio.txPowerDbm,
          radio.clients,
          radio.utilizationPercent,
        ];
      }),
    ).toEqual([
      ["2.4 GHz / wifi0", 6, 2437, 20, 0, 22],
      ["5 GHz / wifi1", 149, 5745, 20, 0, 7],
    ]);
    expect(summary.totalClients).toBe(0);
  });

  test("leaves them out for a device that copied the template before the fix, which walks no interface", async () => {
    const tables: Array<SnmpTableDefinition> = tablesCopiedBeforeTheFix();

    const response: SnmpMonitorResponse = await poll(
      pollConfig(accessPoint!.port, tables),
    );

    const ssids: SnmpTableResult = ssidTableOf(response.tableResults);

    // The old copy walks no unifiVapName ...
    expect(
      ssids.rows.every((row: SnmpTableResultRow): boolean => {
        return row.values[`${VAP_ENTRY}.7`] === undefined;
      }),
    ).toBe(true);

    // ... and the SSIDs table it stores is DEMO's two rows all the same.
    const stored: SnmpTableSnapshot | undefined = SnmpTableListUtil.materialize(
      {
        tables: tables,
        results: response.tableResults,
        collectedAt: new Date(),
      },
    ).find((snapshot: SnmpTableSnapshot): boolean => {
      return snapshot.key === "wifi_ssids";
    });

    expect(
      stored?.rows.map((row: SnmpTableSnapshotRow): string => {
        return row.label;
      }),
    ).toEqual(["DEMO / 2.4 GHz", "DEMO / 5 GHz"]);
  });
});

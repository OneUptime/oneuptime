// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import snmp from "net-snmp";
import SnmpInterfaceRateUtil from "Common/Server/Utils/Monitor/SnmpInterfaceRateUtil";
import { JSONObject } from "Common/Types/JSON";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpAuthProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import {
  FIBRE_CHANNEL_IF_TYPE,
  FibreChannelCounter,
  FibreChannelPortType,
} from "Common/Types/Monitor/SnmpMonitor/SnmpFibreChannel";
import SnmpInterface from "Common/Types/Monitor/SnmpMonitor/SnmpInterface";
import SnmpMonitorResponse, {
  SnmpOidResponse,
} from "Common/Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import SnmpOid from "Common/Types/Monitor/SnmpMonitor/SnmpOid";
import SnmpPrivProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import SnmpSecurityLevel from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import {
  SnmpTableSnapshot,
  SnmpTableSnapshotRow,
} from "Common/Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpTableListUtil from "Common/Types/Monitor/SnmpMonitor/SnmpTableListUtil";
import {
  SnmpTransceiverResult,
  TransceiverMibSource,
  TransceiverReadingKind,
} from "Common/Types/Monitor/SnmpMonitor/SnmpTransceiver";
import SnmpVendorTemplateUtil, {
  SnmpVendorTemplate,
} from "Common/Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import SnmpMonitor from "../../../Utils/Monitors/MonitorTypes/SnmpMonitor";
import RecordedSnmpAgent, {
  counter64,
  simulatorRecording,
} from "../../TestingUtils/RecordedSnmpAgent";

/*
 * A Brocade G620 on Fabric OS 9.2, polled the way a probe polls it, from the
 * simulator's recording (Examples/snmp-simulator/data/brocade-g620) served
 * over a real UDP socket: its default logical switch (FID 128) in the
 * default context, and logical switch FID 20 in the SNMPv3 context "VF:20",
 * as a chassis with Virtual Fabrics serves them.
 *
 * The recording is modelled on SW-MIB, FCMGMT-MIB, FA-EXT-MIB and HA-MIB
 * (every value is ours, not a capture): eight Fibre Channel ports - four
 * F-Ports to hosts and an array, two E-Ports to the core, one cabled to
 * nothing (no light) and one disabled with its cage empty - eight sensors
 * with a stopped fan, six FRUs, and FCMGMT's 64-bit counters as the 8-byte
 * OCTET STRINGs Fabric OS sends.
 *
 * What it pins is #11014's "done when": the pack applies by itself, the
 * switch's status, sensors and FRUs read as tables, its optics come from
 * FA-EXT-MIB, each Fibre Channel port carries its own errors joined to its
 * interface, and a logical switch is polled through its SNMPv3 context.
 */

const COMMUNITY: string = "public";

const V3_USER: snmp.User = {
  name: "oneuptime",
  level: snmp.SecurityLevel.authPriv,
  authProtocol: snmp.AuthProtocols.sha,
  authKey: "authpass123",
  privProtocol: snmp.PrivProtocols.aes,
  privKey: "privpass123",
};

const FCMGMT_STAT: string = "1.3.6.1.3.94.4.5.1";
// connUnitId: the default switch's WWN, 10:00:c4:f5:7c:4a:1b:20, and eight zeros.
const DEFAULT_UNIT: string = "16.0.196.245.124.74.27.32.0.0.0.0.0.0.0.0";

const FC_PORT_0: number = 0x40000000;

function fcPort(port: number): number {
  return FC_PORT_0 + port;
}

const template: SnmpVendorTemplate =
  SnmpVendorTemplateUtil.getById("brocade-fos")!;

function pollConfig(
  port: number,
  overrides: Partial<MonitorStepSnmpMonitor> = {},
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
    monitorInterfaces: true,
    tables: SnmpTableListUtil.toWalkRequests(template.tables!),
    ...overrides,
  };
}

function v3Config(
  port: number,
  contextName: string | undefined,
): MonitorStepSnmpMonitor {
  return pollConfig(port, {
    snmpVersion: SnmpVersion.V3,
    communityString: undefined,
    snmpV3Auth: {
      securityLevel: SnmpSecurityLevel.AuthPriv,
      username: "oneuptime",
      authProtocol: SnmpAuthProtocol.SHA,
      authKey: "authpass123",
      privProtocol: SnmpPrivProtocol.AES,
      privKey: "privpass123",
      ...(contextName !== undefined ? { contextName: contextName } : {}),
    },
  });
}

async function poll(
  config: MonitorStepSnmpMonitor,
  collectTransceivers: boolean = false,
): Promise<SnmpMonitorResponse> {
  const response: SnmpMonitorResponse | null = await SnmpMonitor.query(config, {
    timeout: 4000,
    collectTransceivers: collectTransceivers,
    transceiverCacheKey: collectTransceivers
      ? `brocade-${config.port}-${config.snmpV3Auth?.contextName || ""}`
      : undefined,
  });

  expect(response).not.toBeNull();
  expect(response!.isOnline).toBe(true);
  return response!;
}

function oidValue(
  response: SnmpMonitorResponse,
  name: string,
): string | number | null | undefined {
  return response.oidResponses.find((oid: SnmpOidResponse) => {
    return oid.name === name;
  })?.value;
}

function interfaceAt(
  response: SnmpMonitorResponse,
  interfaceIndex: number,
): SnmpInterface {
  const found: SnmpInterface | undefined = response.interfaces?.find(
    (item: SnmpInterface) => {
      return item.interfaceIndex === interfaceIndex;
    },
  );

  expect(found).toBeDefined();
  return found!;
}

function snapshot(
  response: SnmpMonitorResponse,
  key: string,
): SnmpTableSnapshot {
  const snapshots: Array<SnmpTableSnapshot> = SnmpTableListUtil.materialize({
    tables: template.tables!,
    results: response.tableResults,
  });
  const found: SnmpTableSnapshot | undefined = snapshots.find(
    (table: SnmpTableSnapshot) => {
      return table.key === key;
    },
  );

  expect(found).toBeDefined();
  return found!;
}

// A cell of a row, by the column's name in the template.
function cell(
  table: SnmpTableSnapshot,
  row: SnmpTableSnapshotRow,
  columnName: string,
): { raw: string | number | null; display: string; isHealthy?: boolean } {
  const column: { oid: string } | undefined = table.columns.find(
    (candidate: { name: string }) => {
      return candidate.name === columnName;
    },
  );

  expect(column).toBeDefined();
  return row.cells[column!.oid] as {
    raw: string | number | null;
    display: string;
    isHealthy?: boolean;
  };
}

function rowLabelled(
  table: SnmpTableSnapshot,
  label: string,
): SnmpTableSnapshotRow {
  const row: SnmpTableSnapshotRow | undefined = table.rows.find(
    (candidate: SnmpTableSnapshotRow) => {
      return candidate.label === label;
    },
  );

  expect(row).toBeDefined();
  return row!;
}

let chassis: RecordedSnmpAgent | undefined = undefined;
let firstPoll: SnmpMonitorResponse | undefined = undefined;

beforeAll(async () => {
  chassis = await RecordedSnmpAgent.start({
    recording: simulatorRecording("brocade-g620", "public.snmprec"),
    community: COMMUNITY,
    users: [V3_USER],
    contexts: {
      "VF:20": simulatorRecording("brocade-g620", "fid20.snmprec"),
    },
  });

  firstPoll = await poll(pollConfig(chassis.port), true);
});

afterAll(() => {
  chassis?.close();
});

describe("a Brocade switch is recognised by itself", () => {
  test("its sysObjectID and sysDescr pick the Brocade Fabric OS pack", () => {
    const sysObjectId: string | undefined =
      firstPoll!.systemInfo?.sysObjectId;

    expect(sysObjectId).toBe("1.3.6.1.4.1.1588.2.1.1.1");
    expect(firstPoll!.systemInfo?.sysDescr).toBe("Fibre Channel Switch.");
    expect(
      SnmpVendorTemplateUtil.matchDevice({
        sysObjectId: sysObjectId,
        sysDescr: firstPoll!.systemInfo?.sysDescr,
      })?.id,
    ).toBe("brocade-fos");
  });
});

describe("the switch's health", () => {
  test("reads the switch state, firmware, CPU and memory", () => {
    // swOperStatus online(1).
    expect(oidValue(firstPoll!, "Switch State")).toBe(1);
    expect(oidValue(firstPoll!, "Firmware Version")).toBe("v9.2.0b");
    expect(oidValue(firstPoll!, "CPU %")).toBe(7);
    expect(oidValue(firstPoll!, "Memory %")).toBe(41);
  });

  test("reports one table result per table, whether it has rows or not", () => {
    expect(
      (firstPoll!.tableResults || [])
        .map((result: { key: string }) => {
          return result.key;
        })
        .sort(),
    ).toEqual(
      template
        .tables!.map((table: { key: string }) => {
          return table.key;
        })
        .sort(),
    );
  });

  test("the switch status row is named after the switch, and marginal is unhealthy", () => {
    const table: SnmpTableSnapshot = snapshot(firstPoll!, "switch_status");

    expect(table.rows).toHaveLength(1);

    const row: SnmpTableSnapshotRow = table.rows[0]!;

    expect(row.label).toBe("fabric-a-edge-01");
    // connUnitStatus warning(4): the stopped fan.
    expect(cell(table, row, "Status").raw).toBe(4);
    expect(cell(table, row, "Status").isHealthy).toBe(false);
  });

  test("sensors: each named as switchshow names it, the stopped fan unhealthy, power supplies with no reading", () => {
    const table: SnmpTableSnapshot = snapshot(firstPoll!, "sensors");

    expect(
      table.rows.map((row: SnmpTableSnapshotRow) => {
        return row.label;
      }),
    ).toEqual([
      "SLOT #0: TEMP #1",
      "SLOT #0: TEMP #2",
      "SLOT #0: TEMP #3",
      "FAN #1",
      "FAN #2",
      "FAN #3",
      "Power Supply #1",
      "Power Supply #2",
    ]);

    const temperature: SnmpTableSnapshotRow = rowLabelled(
      table,
      "SLOT #0: TEMP #2",
    );
    expect(cell(table, temperature, "Value").raw).toBe(41);
    expect(cell(table, temperature, "Status").isHealthy).toBe(true);

    const stoppedFan: SnmpTableSnapshotRow = rowLabelled(table, "FAN #3");
    // swSensorStatus faulty(2).
    expect(cell(table, stoppedFan, "Status").raw).toBe(2);
    expect(cell(table, stoppedFan, "Status").isHealthy).toBe(false);

    /*
     * A power supply's swSensorValue is -2147483648: no reading, which the
     * table shows as nothing rather than as minus two billion.
     */
    const powerSupply: SnmpTableSnapshotRow = rowLabelled(
      table,
      "Power Supply #1",
    );
    expect(cell(table, powerSupply, "Value").raw).toBe(-2147483648);
    expect(cell(table, powerSupply, "Value").display).toBe("");
    expect(cell(table, powerSupply, "Status").isHealthy).toBe(true);
  });

  test("FRUs are named by their ENTITY-MIB names, read by index, and the faulty fan is unhealthy", () => {
    const table: SnmpTableSnapshot = snapshot(firstPoll!, "frus");

    expect(
      table.rows.map((row: SnmpTableSnapshotRow) => {
        return row.label;
      }),
    ).toEqual([
      "Power Supply 1",
      "Power Supply 2",
      "Fan 1",
      "Fan 2",
      "Fan 3",
      "WWN Card",
    ]);

    // fruStatus faulty(5) against on(3).
    expect(cell(table, rowLabelled(table, "Fan 3"), "Status").isHealthy).toBe(
      false,
    );
    expect(
      cell(table, rowLabelled(table, "Power Supply 2"), "Status").isHealthy,
    ).toBe(true);
  });
});

describe("each Fibre Channel port, on its interface", () => {
  test("the management port has no Fibre Channel side; every FC port has one", () => {
    const interfaces: Array<SnmpInterface> = firstPoll!.interfaces || [];

    expect(interfaces).toHaveLength(9);
    expect(interfaceAt(firstPoll!, 1).fibreChannel).toBeUndefined();

    for (let port: number = 0; port < 8; port++) {
      const item: SnmpInterface = interfaceAt(firstPoll!, fcPort(port));

      expect(item.interfaceType).toBe(FIBRE_CHANNEL_IF_TYPE);
      expect(item.name).toBe(`0/${port}`);
      expect(item.fibreChannel).toBeDefined();
    }
  });

  test("port types: F-Ports to hosts and the array, E-Ports to the core", () => {
    expect(interfaceAt(firstPoll!, fcPort(0)).fibreChannel?.portType).toBe(
      FibreChannelPortType.F,
    );
    expect(interfaceAt(firstPoll!, fcPort(3)).fibreChannel?.portType).toBe(
      FibreChannelPortType.F,
    );
    expect(interfaceAt(firstPoll!, fcPort(4)).fibreChannel?.portType).toBe(
      FibreChannelPortType.E,
    );
    expect(interfaceAt(firstPoll!, fcPort(5)).fibreChannel?.portType).toBe(
      FibreChannelPortType.E,
    );
    // swFCPortBrcdType unknown(1): a port with nothing attached has no type.
    expect(
      interfaceAt(firstPoll!, fcPort(6)).fibreChannel?.portType,
    ).toBeUndefined();
  });

  test("why a down port is down, in switchshow's words", () => {
    const noLight: SnmpInterface = interfaceAt(firstPoll!, fcPort(6));

    expect(noLight.isOperationallyUp).toBe(false);
    expect(noLight.fibreChannel?.downReason).toBe("No light");

    const disabled: SnmpInterface = interfaceAt(firstPoll!, fcPort(7));

    expect(disabled.isAdministrativelyUp).toBe(false);
    expect(disabled.fibreChannel?.downReason).toBe("Disabled");

    expect(
      interfaceAt(firstPoll!, fcPort(0)).fibreChannel?.downReason,
    ).toBeUndefined();
  });

  test("the error counters come from FCMGMT-MIB's 8-byte OCTET STRINGs", () => {
    expect(interfaceAt(firstPoll!, fcPort(0)).fibreChannel?.counters).toEqual({
      [FibreChannelCounter.CrcErrors]: 0,
      [FibreChannelCounter.InvalidTransmissionWords]: 0,
      [FibreChannelCounter.LinkFailures]: 0,
      [FibreChannelCounter.LossOfSync]: 0,
      [FibreChannelCounter.LossOfSignal]: 0,
      [FibreChannelCounter.Discards]: 0,
      [FibreChannelCounter.BbCreditZero]: 120455,
    });

    expect(
      interfaceAt(firstPoll!, fcPort(2)).fibreChannel?.counters,
    ).toMatchObject({
      [FibreChannelCounter.CrcErrors]: 3,
      [FibreChannelCounter.LinkFailures]: 1,
    });

    expect(
      interfaceAt(firstPoll!, fcPort(6)).fibreChannel?.counters,
    ).toMatchObject({
      [FibreChannelCounter.LossOfSignal]: 4,
      [FibreChannelCounter.LossOfSync]: 2,
    });

    // An E-Port waits for credit millions of times; that is not an error.
    expect(
      interfaceAt(firstPoll!, fcPort(4)).fibreChannel?.counters?.[
        FibreChannelCounter.BbCreditZero
      ],
    ).toBe(2211904);
  });
});

describe("errors per second, between two polls", () => {
  test("a port taking CRC errors rates them, and a cleared counter rates nothing", async () => {
    const before: SnmpMonitorResponse = await poll(pollConfig(chassis!.port));
    const before64: string = DEFAULT_UNIT;

    // Ninety CRC errors on port 0/2 over the minute, and a statsclear on 0/0.
    chassis!.setValue(`${FCMGMT_STAT}.40.${before64}.3`, counter64(BigInt(93)));
    chassis!.setValue(`${FCMGMT_STAT}.8.${before64}.1`, counter64(BigInt(5)));
    chassis!.advance(60);

    const after: SnmpMonitorResponse = await poll(pollConfig(chassis!.port));
    const monitoredAt: Date = new Date("2026-11-26T10:00:00.000Z");

    SnmpInterfaceRateUtil.attachInterfaceRates({
      snmpResponse: after,
      previousWalkLog: {
        snmpResponse: JSON.parse(JSON.stringify(before)) as JSONObject,
        monitoredAt: monitoredAt.toISOString(),
      },
      now: new Date(monitoredAt.getTime() + 60000),
    });

    const crcPort: SnmpInterface = interfaceAt(after, fcPort(2));

    expect(crcPort.fibreChannel?.ratesPerSecond?.crcErrors).toBe(1.5);
    // The port's errors are its Fibre Channel errors: 90 in 60 seconds.
    expect(crcPort.errorsPerSecond).toBe(1.5);

    const clearedPort: SnmpInterface = interfaceAt(after, fcPort(0));

    // 120455 -> 5: the counter went backwards, so it has no rate this poll.
    expect(
      clearedPort.fibreChannel?.ratesPerSecond?.bbCreditZero,
    ).toBeUndefined();
    expect(clearedPort.fibreChannel?.ratesPerSecond?.crcErrors).toBe(0);
    expect(clearedPort.errorsPerSecond).toBe(0);

    // Still these counters on the next poll: the change was the device's.
    chassis!.setValue(`${FCMGMT_STAT}.40.${before64}.3`, counter64(BigInt(3)));
    chassis!.setValue(
      `${FCMGMT_STAT}.8.${before64}.1`,
      counter64(BigInt(120455)),
    );
  });
});

describe("optics, from FA-EXT-MIB", () => {
  test("one per port with a module, joined by its port, with no light read as the floor", () => {
    const optics: Array<SnmpTransceiverResult> =
      firstPoll!.transceiverResults || [];

    expect(firstPoll!.transceiverSource).toBe(
      TransceiverMibSource.BrocadeSfpStat,
    );
    // Ports 0/0 to 0/6: 0/7's cage is empty (gbicNotInstalled).
    expect(
      optics
        .map((optic: SnmpTransceiverResult) => {
          return optic.interfaceIndex;
        })
        .sort((a: number, b: number) => {
          return a - b;
        }),
    ).toEqual([0, 1, 2, 3, 4, 5, 6].map(fcPort));

    const arrayPort: SnmpTransceiverResult = optics.find(
      (optic: SnmpTransceiverResult) => {
        return optic.interfaceIndex === fcPort(2);
      },
    )!;

    expect(arrayPort.vendor).toBe("BROCADE");
    expect(arrayPort.serialNumber).toBe("HAF31940000T4K3");
    expect(arrayPort.source).toBe(TransceiverMibSource.BrocadeSfpStat);
    expect(
      arrayPort.measurements[TransceiverReadingKind.RxPower]?.readings[0]
        ?.value,
    ).toBe(-3.4);
    expect(
      arrayPort.measurements[TransceiverReadingKind.Temperature]?.readings[0]
        ?.value,
    ).toBe(36);
    // 3291.6 mV.
    expect(
      arrayPort.measurements[TransceiverReadingKind.Voltage]?.readings[0]
        ?.value,
    ).toBe(3.292);

    const dark: SnmpTransceiverResult = optics.find(
      (optic: SnmpTransceiverResult) => {
        return optic.interfaceIndex === fcPort(6);
      },
    )!;

    // "-inf": no light at all, charted at the -40 dBm floor.
    expect(
      dark.measurements[TransceiverReadingKind.RxPower]?.readings[0]?.value,
    ).toBe(-40);
  });
});

describe("a logical switch of a Virtual Fabric, through its SNMPv3 context", () => {
  test("VF:20 answers as logical switch 20, with its own ports", async () => {
    const logicalSwitch: SnmpMonitorResponse = await poll(
      v3Config(chassis!.port, "VF:20"),
    );

    expect(logicalSwitch.systemInfo?.sysName).toBe("fabric-b-ls20");
    expect(
      (logicalSwitch.interfaces || [])
        .filter((item: SnmpInterface) => {
          return item.interfaceType === FIBRE_CHANNEL_IF_TYPE;
        })
        .map((item: SnmpInterface) => {
          return item.name;
        }),
    ).toEqual(["0/8", "0/9", "0/10", "0/11"]);
  });

  test("its ports are joined by name, not by Fabric OS's ifIndex arithmetic", async () => {
    const logicalSwitch: SnmpMonitorResponse = await poll(
      v3Config(chassis!.port, "VF:20"),
    );

    /*
     * The logical switch numbers its ports from 1 (port index 2 is port 9)
     * while IF-MIB keeps the chassis' numbering: arithmetic on the port
     * index would put port 9's CRC errors on port 1, which this switch does
     * not have. swFCPortSpecifier "9" against "FC port 0/9" puts them on 0/9.
     */
    expect(
      interfaceAt(logicalSwitch, fcPort(9)).fibreChannel?.counters,
    ).toMatchObject({
      [FibreChannelCounter.CrcErrors]: 1544,
      [FibreChannelCounter.InvalidTransmissionWords]: 5121,
    });
    expect(interfaceAt(logicalSwitch, fcPort(10)).fibreChannel?.portType).toBe(
      FibreChannelPortType.E,
    );
    expect(
      interfaceAt(logicalSwitch, fcPort(11)).fibreChannel?.downReason,
    ).toBe("Disabled");
  });

  test("with no context, the same user reads the default logical switch", async () => {
    const defaultSwitch: SnmpMonitorResponse = await poll(
      v3Config(chassis!.port, undefined),
    );

    expect(defaultSwitch.systemInfo?.sysName).toBe("fabric-a-edge-01");
  });

  test("the context is sent only over SNMPv3, trimmed", () => {
    expect(
      SnmpMonitor.getV3ContextName(v3Config(chassis!.port, "  VF:20 ")),
    ).toBe("VF:20");
    expect(SnmpMonitor.getV3ContextName(v3Config(chassis!.port, ""))).toBe("");
    expect(
      SnmpMonitor.getV3ContextName(
        pollConfig(chassis!.port, {
          snmpV3Auth: {
            securityLevel: SnmpSecurityLevel.NoAuthNoPriv,
            username: "ignored",
            contextName: "VF:20",
          },
        }),
      ),
    ).toBe("");
  });
});

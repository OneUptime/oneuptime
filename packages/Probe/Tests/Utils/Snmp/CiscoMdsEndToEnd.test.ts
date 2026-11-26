// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import SnmpFibreChannelCriteria from "Common/Server/Utils/Monitor/Criteria/SnmpFibreChannelCriteria";
import SnmpInterfaceRateUtil from "Common/Server/Utils/Monitor/SnmpInterfaceRateUtil";
import { JSONObject } from "Common/Types/JSON";
import { CheckOn, CriteriaFilter } from "Common/Types/Monitor/CriteriaFilter";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import NetworkDeviceAlertPackUtil, {
  NetworkDeviceAlertPackItem,
} from "Common/Types/Monitor/SnmpMonitor/NetworkDeviceAlertPack";
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
import RmonAlarmTrapUtil from "Common/Utils/NetworkEvent/RmonAlarmTrap";
import SnmpMonitor from "../../../Utils/Monitors/MonitorTypes/SnmpMonitor";
import RecordedSnmpAgent, {
  simulatorRecording,
} from "../../TestingUtils/RecordedSnmpAgent";

/*
 * A Cisco MDS 9396S on NX-OS 9.4, polled the way a probe polls it, from the
 * simulator's recording (Examples/snmp-simulator/data/cisco-mds) served over
 * a real UDP socket.
 *
 * The recording is modelled on CISCO-FC-FE-MIB, CISCO-VSAN-MIB,
 * CISCO-ENTITY-FRU-CONTROL-MIB, CISCO-ENTITY-SENSOR-MIB and
 * CISCO-SYSTEM-EXT-MIB (every value is ours, not a capture): eight fc
 * interfaces - four F ports to hosts and an array, one of them taking CRC
 * errors and one draining slowly (losing credit, timing frames out), one
 * unplugged at the far end, two TE ports in an ISL port channel - the
 * management port, five VSANs, a power supply with no input power, and an
 * optic per port with its DOM sensors.
 *
 * What it pins is #11015's "done when": the MDS pack applies by itself and
 * not cisco-ios, health, FRUs, VSANs and optics read, each fc interface
 * carries its own errors joined by ifIndex, an interface losing credit
 * fires the recommended alert, and one taking CRC errors has the errors
 * per second that SNMP Interface Errors (per second) compares.
 */

const COMMUNITY: string = "public";

// fc1/1 is 0x1000000, and every next port 0x1000 more.
function fc(port: number): number {
  return 0x1000000 + (port - 1) * 0x1000;
}

const PORT_CHANNEL_1: number = 0x4000000;
const MGMT_0: number = 0x5000000;

const template: SnmpVendorTemplate =
  SnmpVendorTemplateUtil.getById("cisco-mds")!;

function pollConfig(port: number): MonitorStepSnmpMonitor {
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
  };
}

async function poll(
  port: number,
  collectTransceivers: boolean = false,
): Promise<SnmpMonitorResponse> {
  const response: SnmpMonitorResponse | null = await SnmpMonitor.query(
    pollConfig(port),
    {
      timeout: 4000,
      collectTransceivers: collectTransceivers,
      transceiverCacheKey: collectTransceivers ? `mds-${port}` : undefined,
    },
  );

  expect(response).not.toBeNull();
  expect(response!.isOnline).toBe(true);
  return response!;
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
  const found: SnmpTableSnapshot | undefined = SnmpTableListUtil.materialize({
    tables: template.tables!,
    results: response.tableResults,
  }).find((table: SnmpTableSnapshot) => {
    return table.key === key;
  });

  expect(found).toBeDefined();
  return found!;
}

function labels(table: SnmpTableSnapshot): Array<string> {
  return table.rows.map((row: SnmpTableSnapshotRow) => {
    return row.label;
  });
}

function healthOf(
  table: SnmpTableSnapshot,
  label: string,
): boolean | undefined {
  const row: SnmpTableSnapshotRow | undefined = table.rows.find(
    (candidate: SnmpTableSnapshotRow) => {
      return candidate.label === label;
    },
  );

  expect(row).toBeDefined();

  const judged: Array<boolean> = Object.values(row!.cells)
    .map((cell: { isHealthy?: boolean | undefined }) => {
      return cell.isHealthy;
    })
    .filter((isHealthy: boolean | undefined): isHealthy is boolean => {
      return isHealthy !== undefined;
    });

  return judged.length === 0
    ? undefined
    : judged.every((isHealthy: boolean) => {
        return isHealthy;
      });
}

function packItem(name: string): NetworkDeviceAlertPackItem {
  const item: NetworkDeviceAlertPackItem | undefined =
    NetworkDeviceAlertPackUtil.getPackItems(template.tables, "cisco-mds").find(
      (candidate: NetworkDeviceAlertPackItem) => {
        return candidate.name === name;
      },
    );

  expect(item).toBeDefined();
  return item!;
}

let mds: RecordedSnmpAgent | undefined = undefined;
let firstPoll: SnmpMonitorResponse | undefined = undefined;
let ratedPoll: SnmpMonitorResponse | undefined = undefined;

beforeAll(async () => {
  mds = await RecordedSnmpAgent.start({
    recording: simulatorRecording("cisco-mds", "public.snmprec"),
    community: COMMUNITY,
  });

  firstPoll = await poll(mds.port, true);

  // A minute later: the growing counters have grown by a minute's worth.
  mds.advance(60);
  ratedPoll = await poll(mds.port);

  const monitoredAt: Date = new Date("2026-11-26T10:00:00.000Z");

  SnmpInterfaceRateUtil.attachInterfaceRates({
    snmpResponse: ratedPoll,
    previousWalkLog: {
      snmpResponse: JSON.parse(JSON.stringify(firstPoll)) as JSONObject,
      monitoredAt: monitoredAt.toISOString(),
    },
    now: new Date(monitoredAt.getTime() + 60000),
  });
});

afterAll(() => {
  mds?.close();
});

describe("an MDS is recognised by itself", () => {
  test("its chassis sysObjectID picks the MDS pack, not cisco-ios", () => {
    expect(firstPoll!.systemInfo?.sysObjectId).toBe(
      "1.3.6.1.4.1.9.12.3.1.3.1660",
    );
    expect(
      SnmpVendorTemplateUtil.matchDevice({
        sysObjectId: firstPoll!.systemInfo?.sysObjectId,
        sysDescr: firstPoll!.systemInfo?.sysDescr,
      })?.id,
    ).toBe("cisco-mds");
  });

  test("so does its sysDescr alone, for a model the list does not have yet", () => {
    expect(
      SnmpVendorTemplateUtil.matchDevice({
        sysObjectId: "1.3.6.1.4.1.9.12.3.1.3.9999",
        sysDescr: firstPoll!.systemInfo?.sysDescr,
      })?.id,
    ).toBe("cisco-mds");
  });
});

describe("health, FRUs and VSANs", () => {
  test("CPU and memory", () => {
    const value: (name: string) => unknown = (name: string): unknown => {
      return firstPoll!.oidResponses.find((oid: SnmpOidResponse) => {
        return oid.name === name;
      })?.value;
    };

    expect(value("CPU %")).toBe(12);
    expect(value("Memory %")).toBe(38);
  });

  test("power supplies, modules and fan trays, named by ENTITY-MIB", () => {
    const power: SnmpTableSnapshot = snapshot(firstPoll!, "power_supplies");

    expect(labels(power)).toEqual(["PowerSupply-1", "PowerSupply-2"]);
    expect(healthOf(power, "PowerSupply-1")).toBe(true);
    // cefcFRUPowerOperStatus offEnvPower(5): no input power.
    expect(healthOf(power, "PowerSupply-2")).toBe(false);

    const modules: SnmpTableSnapshot = snapshot(firstPoll!, "modules");

    expect(labels(modules)).toEqual(["Slot 1"]);
    expect(healthOf(modules, "Slot 1")).toBe(true);

    const fans: SnmpTableSnapshot = snapshot(firstPoll!, "fan_trays");

    expect(labels(fans)).toEqual([
      "Fan Module-1",
      "Fan Module-2",
      "Fan Module-3",
      "Fan Module-4",
    ]);
    expect(healthOf(fans, "Fan Module-3")).toBe(true);
  });

  test("every VSAN by name, informational: an empty or isolated VSAN is down by design", () => {
    const vsans: SnmpTableSnapshot = snapshot(firstPoll!, "vsans");

    expect(labels(vsans)).toEqual([
      "VSAN0001",
      "FABRIC_B_PROD",
      "FABRIC_B_BACKUP",
      "FABRIC_B_RETIRED",
      "isolated_vsan",
    ]);
    expect(
      vsans.rows.map((row: SnmpTableSnapshotRow) => {
        return row.index;
      }),
    ).toEqual(["1", "10", "20", "30", "4094"]);
    expect(healthOf(vsans, "isolated_vsan")).toBeUndefined();
    expect(healthOf(vsans, "FABRIC_B_PROD")).toBeUndefined();
  });
});

describe("each fc interface, joined by its ifIndex", () => {
  test("fc interfaces and the port channel have a Fibre Channel side; mgmt0 has none", () => {
    for (let port: number = 1; port <= 8; port++) {
      const item: SnmpInterface = interfaceAt(firstPoll!, fc(port));

      expect(item.name).toBe(`fc1/${port}`);
      expect(item.interfaceType).toBe(FIBRE_CHANNEL_IF_TYPE);
      expect(item.fibreChannel).toBeDefined();
    }

    expect(interfaceAt(firstPoll!, PORT_CHANNEL_1).fibreChannel?.portType).toBe(
      FibreChannelPortType.TE,
    );
    expect(interfaceAt(firstPoll!, MGMT_0).fibreChannel).toBeUndefined();
  });

  test("operating modes: F to hosts, TE on the trunk", () => {
    expect(interfaceAt(firstPoll!, fc(1)).fibreChannel?.portType).toBe(
      FibreChannelPortType.F,
    );
    expect(interfaceAt(firstPoll!, fc(7)).fibreChannel?.portType).toBe(
      FibreChannelPortType.TE,
    );
  });

  test("why a down interface is down, in the switch's own words", () => {
    const unplugged: SnmpInterface = interfaceAt(firstPoll!, fc(6));

    expect(unplugged.isOperationallyUp).toBe(false);
    expect(unplugged.fibreChannel?.downReason).toBe(
      "Link failure or not-connected",
    );
    /*
     * fcIfOperMode auto(1): a port that is not up negotiated no mode, so it
     * has no type - not an "Auto" chip - and keeps the one it last had.
     */
    expect(unplugged.fibreChannel?.portType).toBeUndefined();
    // "none" is what an up interface says: no reason at all.
    expect(interfaceAt(firstPoll!, fc(1)).fibreChannel?.downReason).toBe(
      undefined,
    );
  });

  test("every error counter of fcIfErrorTable, in its 64-bit column where there is one", () => {
    expect(
      Object.keys(interfaceAt(firstPoll!, fc(2)).fibreChannel?.counters || {})
        .sort(),
    ).toEqual(
      [
        FibreChannelCounter.BbCreditZero,
        FibreChannelCounter.CrcErrors,
        FibreChannelCounter.CreditLoss,
        FibreChannelCounter.Discards,
        FibreChannelCounter.InvalidTransmissionWords,
        FibreChannelCounter.LinkFailures,
        FibreChannelCounter.LossOfSignal,
        FibreChannelCounter.LossOfSync,
        FibreChannelCounter.TimeoutDiscards,
      ].sort(),
    );
  });
});

describe("a minute later: errors and slow drain, per second", () => {
  test("the port with a dirty connector: CRC errors and invalid words, as its errors per second", () => {
    const dirty: SnmpInterface = interfaceAt(ratedPoll!, fc(3));

    expect(dirty.fibreChannel?.ratesPerSecond?.crcErrors).toBe(2);
    expect(dirty.fibreChannel?.ratesPerSecond?.invalidTransmissionWords).toBe(
      6,
    );
    // What SNMP Interface Errors (per second) compares: 8 against 0.1.
    expect(dirty.errorsPerSecond).toBe(8);
    expect(packItem("Fibre Channel port errors").filters[0]?.checkOn).toBe(
      CheckOn.SnmpInterfaceErrorsPerSecond,
    );
    expect(
      Number(packItem("Fibre Channel port errors").filters[0]?.value),
    ).toBeLessThan(dirty.errorsPerSecond!);
  });

  test("healthy ports rate no errors, and credit waits are not errors", () => {
    expect(interfaceAt(ratedPoll!, fc(1)).errorsPerSecond).toBe(0);

    const slow: SnmpInterface = interfaceAt(ratedPoll!, fc(5));

    expect(slow.fibreChannel?.ratesPerSecond?.bbCreditZero).toBe(4000);
    expect(slow.errorsPerSecond).toBe(0);
  });

  test("the slow-draining host: losing credit fires the recommended alert, naming its interface", () => {
    const slow: SnmpInterface = interfaceAt(ratedPoll!, fc(5));

    expect(slow.fibreChannel?.ratesPerSecond?.creditLoss).toBe(0.05);
    expect(slow.fibreChannel?.ratesPerSecond?.timeoutDiscards).toBe(0.5);

    const creditLoss: CriteriaFilter = packItem("Credit loss (slow drain)")
      .filters[0]!;

    expect(
      SnmpFibreChannelCriteria.evaluate({
        interfaces: ratedPoll!.interfaces || [],
        criteriaFilter: creditLoss,
      }),
    ).toContain("fc1/5");

    const timeouts: CriteriaFilter = packItem("Timeout discards (slow drain)")
      .filters[0]!;

    expect(
      SnmpFibreChannelCriteria.evaluate({
        interfaces: ratedPoll!.interfaces || [],
        criteriaFilter: timeouts,
      }),
    ).toContain("fc1/5");

    // No interface but fc1/5 is losing credit.
    expect(
      SnmpFibreChannelCriteria.evaluate({
        interfaces: (ratedPoll!.interfaces || []).filter(
          (item: SnmpInterface) => {
            return item.interfaceIndex !== fc(5);
          },
        ),
        criteriaFilter: creditLoss,
      }),
    ).toBeNull();
  });

  test("an RMON alarm on that interface's credit loss names it the way the walk does", () => {
    // The port-monitor alarm for fcIfCreditLoss on fc1/5.
    expect(
      RmonAlarmTrapUtil.mdsInterfaceName(fc(5)),
    ).toBe(interfaceAt(ratedPoll!, fc(5)).name);
    expect(RmonAlarmTrapUtil.mdsInterfaceName(PORT_CHANNEL_1)).toBe(
      interfaceAt(ratedPoll!, PORT_CHANNEL_1).name,
    );
  });
});

describe("optics, through CISCO-ENTITY-SENSOR-MIB", () => {
  test("every fc interface's optic maps to its interface, with its DOM readings", () => {
    const optics: Array<SnmpTransceiverResult> =
      firstPoll!.transceiverResults || [];

    expect(firstPoll!.transceiverSource).toBe(
      TransceiverMibSource.CiscoEntitySensor,
    );
    expect(
      optics
        .map((optic: SnmpTransceiverResult) => {
          return optic.interfaceIndex;
        })
        .sort((a: number, b: number) => {
          return a - b;
        }),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map(fc));

    const array: SnmpTransceiverResult = optics.find(
      (optic: SnmpTransceiverResult) => {
        return optic.interfaceIndex === fc(3);
      },
    )!;

    expect(array.serialNumber).toBe("FNS22100003");
    expect(array.partNumber || array.type).toBeTruthy();
    // -112 at precision 1: -11.2 dBm, just inside the optic's -12 dBm warning.
    expect(
      array.measurements[TransceiverReadingKind.RxPower]?.readings[0]?.value,
    ).toBe(-11.2);
    expect(
      array.measurements[TransceiverReadingKind.TxPower]?.readings[0]?.value,
    ).toBe(-2.4);
    expect(
      array.measurements[TransceiverReadingKind.Temperature]?.readings[0]
        ?.value,
    ).toBe(35.2);
    expect(
      array.measurements[TransceiverReadingKind.RxPower]?.thresholds,
    ).toBeDefined();

    const unplugged: SnmpTransceiverResult = optics.find(
      (optic: SnmpTransceiverResult) => {
        return optic.interfaceIndex === fc(6);
      },
    )!;

    expect(
      unplugged.measurements[TransceiverReadingKind.RxPower]?.readings[0]
        ?.value,
    ).toBe(-40);
  });
});

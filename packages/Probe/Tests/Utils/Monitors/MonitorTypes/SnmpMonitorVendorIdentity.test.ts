// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import { afterEach, describe, expect, jest, test } from "@jest/globals";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpEntityInfo from "Common/Types/Monitor/SnmpMonitor/SnmpEntityInfo";
import SnmpMonitorResponse from "Common/Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";

/*
 * Same seam as SnmpMonitorHelpers.test.ts: net-snmp keeps its real constants
 * and helpers, so these read varbinds the way the probe does, and only the
 * session factory is stubbed so no UDP socket can ever be opened from a test.
 */
jest.mock("net-snmp", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "net-snmp",
  ) as Record<string, unknown>;

  return {
    ...actual,
    createSession: jest.fn(() => {
      return { close: jest.fn(), on: jest.fn() };
    }),
  };
});

import snmp from "net-snmp";
import SnmpMonitor, {
  SnmpWalkResult,
} from "../../../../Utils/Monitors/MonitorTypes/SnmpMonitor";

/*
 * What ENTITY-MIB leaves empty, read from the vendor's own MIB (issue #5384).
 *
 * The answers below are what real devices send, as recorded for LibreNMS's
 * test suite. The other half of these tests is what the probe must NOT ask: a
 * Meraki device "fails to respond rather than returning a null" for an object
 * it lacks, so one wrong OID would cost every poll of it a timeout.
 */

const ENTITY_TABLE: string = "1.3.6.1.2.1.47.1.1.1";
const SYS_OBJECT_ID: string = "1.3.6.1.2.1.1.2.0";
const SYS_DESCR: string = "1.3.6.1.2.1.1.1.0";

const JNX_BOX_SERIAL: string = "1.3.6.1.4.1.2636.3.1.3.0";
const FN_SYS_SERIAL: string = "1.3.6.1.4.1.12356.100.1.1.1.0";
const FG_SYS_VERSION: string = "1.3.6.1.4.1.12356.101.4.1.1.0";

const CONFIG: MonitorStepSnmpMonitor = {
  snmpVersion: SnmpVersion.V2c,
  hostname: "10.0.0.1",
  port: 161,
  communityString: "public",
  oids: [],
  timeout: 1000,
  retries: 0,
  monitorInterfaces: true,
};

interface FakeDevice {
  // Scalars it answers: an instance OID and its value.
  scalars: Record<string, unknown>;
  // Its entPhysicalTable, or the error walking it ends in.
  entity?: Record<string, Record<string, unknown>> | Error | undefined;
  // A GET of anything but the system group fails like this.
  vendorGetFailure?: Error | undefined;
}

// Every GET the device was sent, after the one for the system group.
let vendorGets: Array<Array<string>> = [];

function isSystemGroupGet(oids: Array<string>): boolean {
  return oids.includes(SYS_DESCR);
}

function installDevice(device: FakeDevice): void {
  vendorGets = [];

  (
    snmp.createSession as unknown as {
      mockReturnValue: (value: unknown) => void;
    }
  ).mockReturnValue({
    tableColumns: (
      tableOid: string,
      _columns: Array<number>,
      callback: (err: Error | null, tbl?: unknown) => void,
    ): void => {
      if (tableOid === ENTITY_TABLE) {
        if (device.entity instanceof Error) {
          callback(device.entity);
          return;
        }

        callback(null, device.entity || {});
        return;
      }

      // One interface, so the walk is seen to carry on past the read.
      if (tableOid === "1.3.6.1.2.1.2.2") {
        callback(null, { "1": { "2": Buffer.from("ge-0/0/0") } });
        return;
      }

      callback(null, {});
    },
    get: (
      oids: Array<string>,
      callback: (error: Error | null, varbinds?: Array<unknown>) => void,
    ): void => {
      if (!isSystemGroupGet(oids)) {
        vendorGets.push(oids);

        if (device.vendorGetFailure) {
          callback(device.vendorGetFailure);
          return;
        }
      }

      callback(
        null,
        oids.map((oid: string): unknown => {
          return oid in device.scalars
            ? {
                oid: oid,
                type: snmp.ObjectType.OctetString,
                value: device.scalars[oid],
              }
            : { oid: oid, type: snmp.ObjectType.NoSuchObject, value: null };
        }),
      );
    },
    close: jest.fn(),
    on: jest.fn(),
  });
}

function text(value: string): Buffer {
  return Buffer.from(value);
}

function walk(): Promise<SnmpWalkResult> {
  return SnmpMonitor.walkInterfaces(CONFIG, {});
}

afterEach(() => {
  (
    snmp.createSession as unknown as {
      mockImplementation: (impl: () => unknown) => void;
    }
  ).mockImplementation(() => {
    return { close: jest.fn(), on: jest.fn() };
  });
});

describe("what a device's own MIB fills in", () => {
  test("a Juniper MX80 answers ENTITY-MIB with nothing: its serial number, from jnxBoxSerialNo", async () => {
    installDevice({
      scalars: {
        [SYS_OBJECT_ID]: "1.3.6.1.4.1.2636.1.1.1.2.57",
        [SYS_DESCR]: text("Juniper Networks, Inc. mx80 internet router"),
        [JNX_BOX_SERIAL]: text("G0290"),
      },
    });

    const result: SnmpWalkResult = await walk();

    expect(vendorGets).toEqual([[JNX_BOX_SERIAL]]);
    expect(result.entityInfo).toEqual({ serialNumber: "G0290" });
  });

  test("a FortiGate 60F's ENTITY-MIB has its serial number and model: only its release is asked for, once", async () => {
    installDevice({
      scalars: {
        [SYS_OBJECT_ID]: "1.3.6.1.4.1.12356.101.1.644",
        [FG_SYS_VERSION]: text("v7.2.6,build1575,230926 (GA.F)"),
      },
      entity: {
        "1": { "11": text("FGT60FTK00000000"), "13": text("FGT_60F") },
      },
    });

    const result: SnmpWalkResult = await walk();

    expect(vendorGets).toEqual([[FG_SYS_VERSION]]);
    expect(result.entityInfo).toEqual({
      serialNumber: "FGT60FTK00000000",
      model: "FGT_60F",
      firmwareVersion: "v7.2.6,build1575,230926 (GA.F)",
      softwareVersion: "7.2.6",
    });
  });

  test("a FortiGate whose ENTITY-MIB said nothing gets its serial number from fnSysSerial", async () => {
    installDevice({
      scalars: {
        [SYS_OBJECT_ID]: "1.3.6.1.4.1.12356.101.1.644",
        [FN_SYS_SERIAL]: text("FGT60FTK00000000"),
        [FG_SYS_VERSION]: text("v7.2.6,build1575,230926 (GA.F)"),
      },
    });

    expect((await walk()).entityInfo).toEqual({
      serialNumber: "FGT60FTK00000000",
      firmwareVersion: "v7.2.6,build1575,230926 (GA.F)",
      softwareVersion: "7.2.6",
    });
  });

  test("a MikroTik router: serial number, RouterBOOT, RouterOS and board", async () => {
    installDevice({
      scalars: {
        [SYS_OBJECT_ID]: "1.3.6.1.4.1.14988.1",
        "1.3.6.1.4.1.14988.1.1.7.3.0": text("D4F00D6A587B"),
        "1.3.6.1.4.1.14988.1.1.7.4.0": text("7.24.2"),
        "1.3.6.1.4.1.14988.1.1.4.4.0": text("7.24.2"),
        "1.3.6.1.4.1.14988.1.1.7.9.0": text("CCR2004-1G-12S+2XS"),
      },
    });

    expect((await walk()).entityInfo).toEqual({
      serialNumber: "D4F00D6A587B",
      firmwareVersion: "7.24.2",
      softwareVersion: "7.24.2",
      model: "CCR2004-1G-12S+2XS",
    });
    expect(vendorGets).toHaveLength(1);
  });

  test("a Sophos firewall: its key, its type and its firmware, which is its OS release", async () => {
    installDevice({
      scalars: {
        [SYS_OBJECT_ID]: "1.3.6.1.4.1.2604.5",
        "1.3.6.1.4.1.2604.5.1.1.2.0": text("SFVH_SO01_SFOS"),
        "1.3.6.1.4.1.2604.5.1.1.3.0": text("18.0.1 MR-1-Build396"),
        "1.3.6.1.4.1.2604.5.1.1.4.0": text("C01001GF24TPDE1"),
      },
    });

    expect((await walk()).entityInfo).toEqual({
      serialNumber: "C01001GF24TPDE1",
      model: "SFVH_SO01_SFOS",
      firmwareVersion: "18.0.1 MR-1-Build396",
      softwareVersion: "18.0.1 MR-1-Build396",
    });
    // The firmware and the release share an OID: it is asked for once.
    expect(vendorGets[0]).toHaveLength(3);
  });

  test("what ENTITY-MIB said is never replaced", async () => {
    installDevice({
      scalars: {
        [SYS_OBJECT_ID]: "1.3.6.1.4.1.2636.1.1.1.2.57",
        [JNX_BOX_SERIAL]: text("ANOTHER"),
      },
      entity: { "1": { "5": 3, "11": text("FROM-ENTITY-MIB") } },
    });

    expect((await walk()).entityInfo?.serialNumber).toBe("FROM-ENTITY-MIB");
    expect(vendorGets).toEqual([]);
  });
});

describe("what the probe does not ask", () => {
  test.each([
    ["a Meraki MX", "1.3.6.1.4.1.29671.2.111"],
    ["a Meraki access point", "1.3.6.1.4.1.29671.2.45"],
    ["a Linux host", "1.3.6.1.4.1.8072.3.2.10"],
    ["a Cisco switch", "1.3.6.1.4.1.9.1.1208"],
    ["a FortiSwitch", "1.3.6.1.4.1.12356.106.1.1"],
  ])("%s gets no second GET", async (_name: string, sysObjectId: string) => {
    installDevice({ scalars: { [SYS_OBJECT_ID]: sysObjectId } });

    const result: SnmpWalkResult = await walk();

    expect(vendorGets).toEqual([]);
    expect(result.entityInfo).toBeUndefined();
    expect(result.interfaces).toHaveLength(1);
  });

  test("a system group that could not be read leaves nothing to go by", async () => {
    installDevice({ scalars: {} });

    await walk();

    expect(vendorGets).toEqual([]);
  });

  test("a device ENTITY-MIB told everything the platform keeps elsewhere", async () => {
    installDevice({
      scalars: { [SYS_OBJECT_ID]: "1.3.6.1.4.1.2636.1.1.1.2.57" },
      entity: { "1": { "5": 3, "11": text("BOX1") } },
    });

    await walk();

    expect(vendorGets).toEqual([]);
  });
});

describe("a read that gives nothing leaves the walk as it was", () => {
  const JUNIPER: string = "1.3.6.1.4.1.2636.1.1.1.2.57";

  test("an object the agent lacks", async () => {
    installDevice({ scalars: { [SYS_OBJECT_ID]: JUNIPER } });

    const result: SnmpWalkResult = await walk();

    expect(vendorGets).toHaveLength(1);
    expect(result.entityInfo).toBeUndefined();
  });

  test("a blank answer: a virtual device has no serial number", async () => {
    installDevice({
      scalars: { [SYS_OBJECT_ID]: JUNIPER, [JNX_BOX_SERIAL]: text("   ") },
    });

    expect((await walk()).entityInfo).toBeUndefined();
  });

  test("an answer that is not text is not a serial number", async () => {
    installDevice({
      scalars: {
        [SYS_OBJECT_ID]: JUNIPER,
        [JNX_BOX_SERIAL]: Buffer.from([0x00, 0x18, 0x0a, 0x34]),
      },
    });

    expect((await walk()).entityInfo).toBeUndefined();
  });

  test("an answer of the wrong type is not one either", async () => {
    installDevice({
      scalars: { [SYS_OBJECT_ID]: JUNIPER, [JNX_BOX_SERIAL]: 42 },
    });

    expect((await walk()).entityInfo).toBeUndefined();
  });

  test("a release in no shape it knows fills the firmware and not the OS version", async () => {
    installDevice({
      scalars: {
        [SYS_OBJECT_ID]: "1.3.6.1.4.1.12356.101.1.644",
        [FG_SYS_VERSION]: text("unknown"),
      },
      entity: { "1": { "11": text("FGT1"), "13": text("FGT_60F") } },
    });

    expect((await walk()).entityInfo).toEqual({
      serialNumber: "FGT1",
      model: "FGT_60F",
      firmwareVersion: "unknown",
    });
  });

  test("a GET that fails - a timeout, or SNMPv1's noSuchName - costs the walk nothing", async () => {
    installDevice({
      scalars: { [SYS_OBJECT_ID]: "1.3.6.1.4.1.12356.101.1.644" },
      entity: { "1": { "11": text("FGT1") } },
      vendorGetFailure: new Error("RequestTimedOutError"),
    });

    const result: SnmpWalkResult = await walk();

    expect(result.entityInfo).toEqual({ serialNumber: "FGT1" });
    expect(result.interfaces).toHaveLength(1);
  });

  test("a device whose ENTITY-MIB walk failed is still asked", async () => {
    installDevice({
      scalars: {
        [SYS_OBJECT_ID]: JUNIPER,
        [JNX_BOX_SERIAL]: text("G0290"),
      },
      entity: new Error("RequestTimedOutError"),
    });

    expect((await walk()).entityInfo).toEqual({ serialNumber: "G0290" });
  });
});

describe("the response the server ingests", () => {
  test("carries it where the columns are written from", async () => {
    installDevice({
      scalars: {
        [SYS_OBJECT_ID]: "1.3.6.1.4.1.2636.1.1.1.2.57",
        [JNX_BOX_SERIAL]: text("G0290"),
      },
    });

    const response: SnmpMonitorResponse | null = await SnmpMonitor.query(
      CONFIG,
      { isOnlineCheckRequest: true },
    );
    const entityInfo: SnmpEntityInfo | undefined = response?.entityInfo;

    expect(response?.isOnline).toBe(true);
    expect(entityInfo).toEqual({ serialNumber: "G0290" });
  });
});
